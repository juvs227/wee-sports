import {describe, expect, it} from 'vitest';
import {BowlingPhysics, FIXED_STEP, LANE, RollControls, RollSettlement} from '../src/bowling/physics';
import {BowlingMatch} from '../src/bowling/match';

function finish(physics: BowlingPhysics, controls: RollControls): RollSettlement {
  expect(physics.roll(controls)).toBe(true);
  for (let frame = 0; frame < 750; frame++) {
    const result = physics.step(1 / 60);
    if (result) return result;
  }
  throw new Error('Roll did not settle in the bounded simulation time.');
}

function atDistance(controls: RollControls, distance: number) {
  const physics = new BowlingPhysics();
  physics.roll(controls);
  let seconds = 0;
  while (physics.ball.position.z < distance && seconds < 8) {
    physics.step(FIXED_STEP);
    seconds += FIXED_STEP;
  }
  expect(physics.ball.position.z).toBeGreaterThanOrEqual(distance);
  return {x: physics.ball.position.x, speed: physics.ball.velocity.z, seconds};
}

describe('rigid-body bowling', () => {
  it('holds a stable rack and hits actual pins at maximum ball speed', () => {
    const physics = new BowlingPhysics();
    for (let frame = 0; frame < 240; frame++) physics.world.step(FIXED_STEP);
    expect(physics.standingPins()).toHaveLength(10);
    const result = finish(physics, {power: 1, aim: 0, spin: 0});
    expect(result.remaining.length).toBeLessThan(10);
    expect(result.elapsed).toBeLessThanOrEqual(12.01);
    expect(physics.pins.every(pin => Number.isFinite(pin.body.position.x))).toBe(true);
  });

  it('counts no pinfall from a gutter and is deterministic', () => {
    const first = finish(new BowlingPhysics(), {power: 0.65, aim: 1, spin: 0});
    const second = finish(new BowlingPhysics(), {power: 0.65, aim: 1, spin: 0});
    expect(first).toEqual(second);
    expect(first.gutter).toBe(true);
    expect(first.remaining).toHaveLength(10);
  });

  it('sweeps deadwood and preserves the real positions of remaining pins', () => {
    const physics = new BowlingPhysics();
    const result = finish(physics, {power: 0.7, aim: 0.18, spin: 0});
    const positions = new Map(physics.pins.map(pin => [pin.id, pin.body.position.clone()]));
    physics.sweep(result.remaining);
    expect(physics.pins.map(pin => pin.id)).toEqual(result.remaining);
    for (const pin of physics.pins) expect(pin.body.position).toEqual(positions.get(pin.id));
    physics.resetRack();
    expect(physics.standingPins()).toHaveLength(10);
  });

  it('rejects a duplicate delivery and invalid input, with no simulation progress while idle', () => {
    const physics = new BowlingPhysics();
    expect(physics.roll({power: NaN, aim: 0, spin: 0})).toBe(false);
    expect(physics.roll({power: 0.5, aim: 2, spin: 0})).toBe(false);
    expect(physics.step(5)).toBeNull();
    expect(physics.ball.position.z).toBe(0.25);
    expect(physics.roll({power: 0.5, aim: 0, spin: 0})).toBe(true);
    expect(physics.roll({power: 0.5, aim: 0, spin: 0})).toBe(false);
    physics.step(1 / 60);
    expect(physics.ball.position.z).toBeGreaterThan(0.25);
    expect(physics.ball.position.z).toBeLessThan(LANE.length);
  });

  it('can physically carry all ten pins from a pocket delivery', () => {
    const result = finish(new BowlingPhysics(), {power: 0.95, aim: -0.06, spin: 0});
    expect(result.remaining).toEqual([]);
    expect(result.gutter).toBe(false);
  });

  it('skids through oil, then hooks with the release spin instead of immediately drifting sideways', () => {
    const front = atDistance({power: 0.65, aim: 0, spin: 0.4}, 8);
    const left = atDistance({power: 0.65, aim: 0, spin: -0.4}, 16);
    const right = atDistance({power: 0.65, aim: 0, spin: 0.4}, 16);
    const straight = atDistance({power: 0.65, aim: 0, spin: 0}, 16);
    expect(Math.abs(front.x)).toBeLessThan(0.04);
    expect(left.x).toBeLessThan(-0.2);
    expect(right.x).toBeGreaterThan(0.2);
    expect(left.x).toBeCloseTo(-right.x, 7);
    expect(straight.x).toBeCloseTo(0, 7);
  });

  it('preserves faster sensor deliveries and gives a slower ball more time to hook', () => {
    const gentle = atDistance({power: 0.2, aim: 0, spin: 0.25}, 16);
    const strong = atDistance({power: 1, aim: 0, spin: 0.25}, 16);
    expect(strong.speed).toBeGreaterThan(gentle.speed + 2);
    expect(strong.seconds).toBeLessThan(gentle.seconds);
    expect(gentle.x).toBeGreaterThan(strong.x);
    expect(gentle.x).toBeLessThan(LANE.width / 2);
  });

  it('contains extreme legal deliveries and finishes without non-finite bodies or escape', () => {
    for (const power of [0, 1]) for (const aim of [-1, 0, 1]) for (const spin of [-1, 1]) {
      const physics = new BowlingPhysics();
      physics.roll({power, aim, spin});
      let settled: RollSettlement | null = null;
      for (let frame = 0; frame < 750 && !settled; frame++) {
        settled = physics.step(1 / 60);
        const {x, y, z} = physics.ball.position;
        expect([x, y, z].every(Number.isFinite)).toBe(true);
        expect(Math.abs(x)).toBeLessThan(4.5);
        expect(z).toBeLessThan(20.6);
        expect(y).toBeGreaterThan(-0.45);
      }
      expect(settled).not.toBeNull();
      expect(physics.pins.every(pin => [pin.body.position.x, pin.body.position.y, pin.body.position.z].every(Number.isFinite))).toBe(true);
    }
  }, 15000);

  it('keeps the delivery independent of render frame rate', () => {
    const slowFrames = new BowlingPhysics();
    const fastFrames = new BowlingPhysics();
    const controls = {power: 0.65, aim: -0.2, spin: 0.4};
    slowFrames.roll(controls);
    fastFrames.roll(controls);
    for (let frame = 0; frame < 60; frame++) slowFrames.step(1 / 30);
    for (let frame = 0; frame < 288; frame++) fastFrames.step(1 / 144);
    expect(slowFrames.ball.position.x).toBeCloseTo(fastFrames.ball.position.x, 6);
    expect(slowFrames.ball.position.z).toBeCloseTo(fastFrames.ball.position.z, 6);
  });

  it('completes a ten-frame four-player game using settled simulated deliveries', () => {
    const match = new BowlingMatch([1, 2, 3, 4].map(player => ({player, name: `P${player}`})));
    const physics = new BowlingPhysics();
    let deliveries = 0;
    while (!match.getState().complete) {
      const result = finish(physics, {power: 0.65, aim: 1, spin: 0});
      const transition = match.record(result.remaining);
      if (transition.resetRack) physics.resetRack();
      else physics.sweep(result.remaining);
      deliveries++;
      if (deliveries > 80) throw new Error('Turn progression failed.');
    }
    expect(deliveries).toBe(80);
    expect(match.getState().players.every(player => player.frames.length === 10 && player.total === 0)).toBe(true);
  }, 15000);
});
