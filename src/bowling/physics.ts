import {Body, Box, ContactMaterial, Cylinder, GSSolver, Material, Sphere, Vec3, World} from 'cannon-es';
import {FULL_RACK} from './match';

// SI dimensions from the USBC Equipment Specifications manual (October 2025).
export const LANE = Object.freeze({length: 18.288, width: 1.0541, deckEnd: 19.18, gutterWidth: 0.235});
export const BALL_RADIUS = 0.1085;
export const PIN_HEIGHT = 0.381;
export const PIN_COM = 0.145;
export const FIXED_STEP = 1 / 240;
export interface RollControls {power: number; aim: number; spin: number}
export interface PinBody {id: number; body: Body}
export interface RollSettlement {remaining: number[]; gutter: boolean; elapsed: number}

export function pinSpot(id: number): {x: number; z: number} {
  let row = 0;
  while (id > (row + 1) * (row + 2) / 2) row++;
  const column = id - row * (row + 1) / 2 - 1;
  return {x: (column - row / 2) * 0.3048, z: LANE.length + row * 0.3048 * Math.sqrt(3) / 2};
}

export function validRoll(controls: RollControls): boolean {
  return Number.isFinite(controls.power) && controls.power >= 0 && controls.power <= 1 &&
    Number.isFinite(controls.aim) && Math.abs(controls.aim) <= 1 &&
    Number.isFinite(controls.spin) && Math.abs(controls.spin) <= 1;
}

/** The same simulation runs without WebGL in the physics regression tests. */
export class BowlingPhysics {
  onPinHit: (() => void) | null = null;
  readonly world: World;
  readonly pins: PinBody[] = [];
  readonly ball: Body;
  private active = false;
  private elapsed = 0;
  private accumulator = 0;
  private quiet = 0;
  private gutter = false;
  private pastDeck = false;
  private hitReported = false;
  private pinMaterial = new Material('pin');
  private ballLaneContact: ContactMaterial;

  constructor() {
    this.world = new World({gravity: new Vec3(0, -9.81, 0), allowSleep: true});
    (this.world.solver as GSSolver).iterations = 20;
    (this.world.solver as GSSolver).tolerance = 1e-7;
    const laneMaterial = new Material('lane');
    const ballMaterial = new Material('ball');
    this.ballLaneContact = new ContactMaterial(laneMaterial, ballMaterial, {friction: 0.004 * FIXED_STEP, restitution: 0.03});
    this.world.addContactMaterial(this.ballLaneContact);
    // The solver's friction limits are impulses; scale force coefficients by
    // the fixed timestep for pins too, so a fallen pin can slide and carry.
    this.world.addContactMaterial(new ContactMaterial(laneMaterial, this.pinMaterial, {friction: 0.28 * FIXED_STEP, restitution: 0.06}));
    this.world.addContactMaterial(new ContactMaterial(ballMaterial, this.pinMaterial, {friction: 0.16 * FIXED_STEP, restitution: 0.42}));
    this.world.addContactMaterial(new ContactMaterial(this.pinMaterial, this.pinMaterial, {friction: 0.2 * FIXED_STEP, restitution: 0.34}));
    const box = (size: Vec3, position: Vec3) => {
      const body = new Body({mass: 0, shape: new Box(size), material: laneMaterial, position});
      this.world.addBody(body);
    };
    box(new Vec3(LANE.width / 2, 0.1, LANE.deckEnd / 2), new Vec3(0, -0.1, LANE.deckEnd / 2));
    // Depressed gutters never bounce a ball back onto the lane.
    for (const side of [-1, 1]) {
      box(new Vec3(LANE.gutterWidth / 2, 0.05, 10), new Vec3(side * (LANE.width + LANE.gutterWidth) / 2, -0.16, 10));
      box(new Vec3(0.035, 0.25, 10), new Vec3(side * (LANE.width / 2 + LANE.gutterWidth + 0.035), 0.04, 10));
    }
    box(new Vec3(0.85, 0.1, 0.6), new Vec3(0, -0.3, 19.78));
    // A catch floor and pit walls retain deflected bodies instead of letting
    // them fall forever outside the narrow lane and delay the next player.
    box(new Vec3(4.4, 0.1, 10.3), new Vec3(0, -0.5, 10.1));
    box(new Vec3(4.4, 0.9, 0.08), new Vec3(0, 0.4, 20.4));
    for (const side of [-1, 1]) {
      box(new Vec3(0.08, 0.9, 10.3), new Vec3(side * 4.4, 0.4, 10.1));
    }
    this.ball = new Body({mass: 6.35, material: ballMaterial, shape: new Sphere(BALL_RADIUS),
      linearDamping: 0.008, angularDamping: 0.008, allowSleep: true});
    this.world.addBody(this.ball);
    this.ball.addEventListener('collide', ({body}: {body: Body}) => {
      if (!this.active || this.hitReported || this.gutter || this.pastDeck ||
          !this.pins.some(pin => pin.body === body)) return;
      // One feedback event for the first real ball/pin contact in a delivery.
      this.hitReported = true;
      this.onPinHit?.();
    });
    this.resetRack();
  }

  resetRack(ids: readonly number[] = FULL_RACK): void {
    for (const pin of this.pins) this.world.removeBody(pin.body);
    this.pins.length = 0;
    for (const id of ids) {
      const spot = pinSpot(id);
      const body = new Body({mass: 1.58, material: this.pinMaterial, collisionFilterGroup: 2,
        position: new Vec3(spot.x, PIN_COM + 0.001, spot.z),
        linearDamping: 0.13, angularDamping: 0.18, sleepSpeedLimit: 0.06, sleepTimeLimit: 0.55});
      // Four convex pieces retain a narrow neck and a stable flat base.
      const segments = [
        {bottom: 0.027, top: 0.0605, low: 0, high: 0.12},
        {bottom: 0.0605, top: 0.022, low: 0.12, high: 0.265},
        {bottom: 0.022, top: 0.022, low: 0.265, high: 0.32},
      ];
      for (const segment of segments) {
        body.addShape(new Cylinder(segment.top, segment.bottom, segment.high - segment.low, 12),
          new Vec3(0, (segment.high + segment.low) / 2 - PIN_COM, 0));
      }
      body.addShape(new Sphere(0.031), new Vec3(0, 0.35 - PIN_COM, 0));
      this.pins.push({id, body});
      this.world.addBody(body);
      body.sleep();
    }
    this.prepareBall();
  }

  /** Sweep only deadwood; leave upright off-spot pins exactly where they settled. */
  sweep(remaining: number[]): void {
    for (let index = this.pins.length - 1; index >= 0; index--) {
      const pin = this.pins[index];
      if (!remaining.includes(pin.id)) {
        this.world.removeBody(pin.body);
        this.pins.splice(index, 1);
      } else {
        pin.body.velocity.setZero();
        pin.body.angularVelocity.setZero();
        pin.body.sleep();
      }
    }
    this.prepareBall();
  }

  private prepareBall(): void {
    this.active = false;
    this.hitReported = false;
    this.accumulator = 0;
    this.ball.position.set(0, BALL_RADIUS + 0.002, 0.25);
    this.ball.quaternion.set(0, 0, 0, 1);
    this.ball.velocity.setZero();
    this.ball.angularVelocity.setZero();
    this.ball.force.setZero();
    this.ball.torque.setZero();
    this.ball.collisionFilterMask = -1;
    this.ball.aabbNeedsUpdate = true;
    this.ball.sleep();
  }

  roll(controls: RollControls): boolean {
    if (this.active || !validRoll(controls)) return false;
    this.prepareBall();
    this.active = true;
    this.elapsed = 0;
    this.quiet = 0;
    this.gutter = false;
    this.pastDeck = false;
    const speed = 4.5 + 4.5 * controls.power;
    const angle = controls.aim * 0.06;
    const vx = Math.sin(angle) * speed;
    const vz = Math.cos(angle) * speed;
    this.ball.velocity.set(vx, 0, vz);
    // A release initially skids. Side rotation produces lateral contact slip;
    // friction turns that into hook, then rolling once the slip is exhausted.
    // These are bounded game inputs, not a claim of measured phone ball speed.
    this.ball.angularVelocity.set(vz / BALL_RADIUS * 0.7, 0, -vx / BALL_RADIUS - controls.spin * 22);
    this.ball.wakeUp();
    return true;
  }

  /** Fixed 240 Hz avoids a 9 m/s ball jumping through a pin at low frame rates. */
  step(seconds: number): RollSettlement | null {
    if (!this.active || !Number.isFinite(seconds) || seconds <= 0) return null;
    this.accumulator += Math.min(seconds, 0.1);
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP;
      // A simple fixed house pattern: oil through the front of the lane, then a
      // smooth transition to dry boards. Only ball/lane friction changes; the
      // solver still supplies every contact force, including lateral hook.
      const dry = Math.min(1, Math.max(0, (this.ball.position.z - 10.5) / 3.0));
      // cannon-es 0.20's GSSolver clamps lambda (an impulse) to the friction
      // equation's force limits. Convert μmg to μmgΔt so the 240 Hz solver
      // does not spend all the release spin in the first few centimetres.
      this.ballLaneContact.friction = (0.004 + 0.16 * dry * dry * (3 - 2 * dry)) * FIXED_STEP;
      this.world.step(FIXED_STEP);
      this.elapsed += FIXED_STEP;
      if (this.ball.position.z < LANE.length &&
          Math.abs(this.ball.position.x) > LANE.width / 2 + BALL_RADIUS * 0.3 && this.ball.position.y < BALL_RADIUS * 0.8) {
        this.gutter = true;
      }
      // USBC 6b: neither a gutter ball nor a ball rebounding from the rear
      // cushion may knock down additional pins. Pin-to-pin rebounds stay legal.
      this.pastDeck ||= this.ball.position.z > LANE.deckEnd + 0.3;
      if (this.gutter || this.pastDeck) this.ball.collisionFilterMask = 1;
      const stopped = this.ball.velocity.lengthSquared() < 0.008;
      const pinsQuiet = this.pins.every(pin => pin.body.velocity.lengthSquared() < 0.006 && pin.body.angularVelocity.lengthSquared() < 0.035);
      if (this.elapsed > 2 && (this.pastDeck || stopped) && pinsQuiet) this.quiet += FIXED_STEP;
      else this.quiet = 0;
      if (this.quiet > 0.6 || this.elapsed >= 12) {
        this.active = false;
        return {remaining: this.standingPins(), gutter: this.gutter, elapsed: this.elapsed};
      }
    }
    return null;
  }

  standingPins(): number[] {
    return this.pins.filter(({body}) => {
      const up = body.quaternion.vmult(new Vec3(0, 1, 0));
      return up.y > 0.65 && body.position.y > PIN_COM * 0.65 &&
        Math.abs(body.position.x) <= LANE.width / 2 + 0.02 && body.position.z <= LANE.deckEnd;
    }).map(pin => pin.id);
  }
}
