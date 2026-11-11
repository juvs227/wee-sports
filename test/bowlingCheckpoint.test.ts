import {expect, test, vi} from 'vitest';
import {BowlingMatch, FULL_RACK} from '../src/bowling/match';
import {BowlingPhysics, validSettledPins} from '../src/bowling/physics';
import {BowlingWorld} from '../src/bowling/World';
import * as THREE from 'three';
import {Vec3} from 'cannon-es';

test('checkpoint replay restores turn, scoring bonuses, rack IDs and tenth-frame fill balls', () => {
  const match = new BowlingMatch([{player: 1, name: 'Solo'}]);
  for (let frame = 0; frame < 9; frame++) match.record([]);
  match.record([]); // tenth-frame strike
  match.record([8, 9, 10]); // seven; next fill must retain these exact pins
  const restored = BowlingMatch.fromCheckpoint(JSON.parse(JSON.stringify(match.exportCheckpoint())));
  expect(restored.getState()).toEqual(match.getState());
  expect(restored.getState().ball).toBe(3);
  expect(restored.getState().pinsStanding).toEqual([8, 9, 10]);
  restored.record([]);
  expect(restored.getState().complete).toBe(true);
  expect(restored.getState().players[0].total).toBe(287);
  expect(() => BowlingMatch.fromCheckpoint({...restored.exportCheckpoint(), deliveries: [...restored.exportCheckpoint().deliveries, []]})).toThrow();
});

test('checkpoint replay rejects invented pins, duplicate pins, invalid players and malformed history', () => {
  const base = new BowlingMatch([{player: 1, name: 'Solo'}]).exportCheckpoint();
  for (const checkpoint of [null, {...base, version: 2}, {...base, deliveries: [[1, 1]]},
    {...base, deliveries: [[11]]}, {...base, deliveries: [[1], [2]]}, {...base, deliveries: [[1.5]]},
    {...base, deliveries: Array(169).fill([])}, {...base, players: [{player: 9, name: 'Solo'}]}]) {
    expect(() => BowlingMatch.fromCheckpoint(checkpoint)).toThrow();
  }
});

test('pin restoration preserves off-spot standing transforms and never restores moving deliveries', () => {
  const physics = new BowlingPhysics();
  physics.sweep([7, 10]);
  physics.pins[0].body.position.x += .025;
  physics.pins[0].body.quaternion.setFromAxisAngle(new Vec3(0, 1, 0), .3);
  const pins = physics.exportSettledPins([7, 10])!;
  expect(validSettledPins(pins, [7, 10])).toBe(true);
  const restored = new BowlingPhysics();
  expect(restored.restoreSettledPins(pins, [7, 10])).toBe(true);
  expect(restored.exportSettledPins([7, 10])).toEqual(pins);
  expect(restored.restoreSettledPins([{...pins[0], quaternion: [1, 0, 0, 0]}, pins[1]], [7, 10])).toBe(false);
  expect(restored.restoreSettledPins([{...pins[0], position: [Infinity, .2, 18]}, pins[1]], [7, 10])).toBe(false);
  expect(restored.exportSettledPins([7, 10])).toEqual(pins);
  restored.roll({aim: 0, power: .5, spin: 0});
  expect(restored.exportSettledPins([7, 10])).toBeNull();
  expect(restored.restoreSettledPins(pins, [7, 10])).toBe(false);
});

function scene() {
  const world = Object.create(BowlingWorld.prototype) as BowlingWorld;
  const physics = new BowlingPhysics();
  const match = new BowlingMatch([{player: 1, name: 'Solo'}]);
  Object.assign(world, {physics, match, players: [{player: 1, name: 'Solo'}],
    running: true, disposed: false, rolling: false, settlement: null, aim: 0,
    aimLine: new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial()),
    trail: {geometry: {setDrawRange: () => {}}, visible: false},
    syncBodies: vi.fn(), render: vi.fn()});
  return {world, physics, match};
}

test('world restores one coherent score/rack checkpoint and refuses mid-roll or foreign rosters', () => {
  const first = scene();
  first.match.record([7, 10]); first.physics.sweep([7, 10]);
  first.physics.pins[0].body.position.x += .02;
  const checkpoint = first.world.exportCheckpoint()!;
  const second = scene();
  expect(second.world.restoreCheckpoint(checkpoint)).toBe(true);
  expect(second.world.exportCheckpoint()).toEqual(checkpoint);
  expect(second.world.restoreCheckpoint({...checkpoint, match: {...checkpoint.match, players: [{player: 2, name: 'Other'}]}})).toBe(false);
  expect(second.world.exportCheckpoint()).toEqual(checkpoint);
  expect(second.world.roll({player: 1, power: .6, aim: 0, spin: 0})).toEqual({ok: true});
  expect(second.world.exportCheckpoint()).toBeNull();
  expect(second.world.restoreCheckpoint(checkpoint)).toBe(false);
});

test('solo practice resets a full rack after every settled delivery and cannot toggle mid-roll', () => {
  const {world} = scene();
  expect(world.setPractice(true)).toBe(true);
  expect(world.getState().practice).toBe(true);
  expect(world.roll({player: 1, power: .65, aim: 1, spin: 0}).ok).toBe(true);
  expect(world.setPractice(false)).toBe(false);
  const advance = world as unknown as {advanceDelivery(dt: number): void};
  for (let i = 0; i < 850 && world.getState().phase === 'rolling'; i++) advance.advanceDelivery(1 / 60);
  expect(world.getState()).toMatchObject({phase: 'ready', practice: true, pinsStanding: FULL_RACK, frame: 1, ball: 1,
    lastRoll: {pins: 0}, complete: false});
  expect(world.setPractice(false)).toBe(true);
  expect(world.getState().practice).toBeUndefined();
  expect(world.getState().lastRoll).toBeNull();
});
