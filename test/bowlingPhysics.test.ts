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
    const result = finish(new BowlingPhysics(), {power: 0.75, aim: -0.1, spin: 0});
    expect(result.remaining).toEqual([]);
    expect(result.gutter).toBe(false);
  });

  it('uses contact friction to make left and right spin produce different paths', () => {
    const left = new BowlingPhysics();
    const right = new BowlingPhysics();
    left.roll({power: 0.65, aim: 0, spin: -0.8});
    right.roll({power: 0.65, aim: 0, spin: 0.8});
    for (let frame = 0; frame < 90; frame++) { left.step(1 / 60); right.step(1 / 60); }
    expect(left.ball.position.x).toBeLessThan(-0.05);
    expect(right.ball.position.x).toBeGreaterThan(0.05);
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
