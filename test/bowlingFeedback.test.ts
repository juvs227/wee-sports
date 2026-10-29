import {expect, test} from 'vitest';
import {BowlingPhysics, RollSettlement} from '../src/bowling/physics';

function settle(physics: BowlingPhysics): RollSettlement {
  for (let frame = 0; frame < 750; frame++) {
    const result = physics.step(1 / 60);
    if (result) return result;
  }
  throw new Error('Delivery did not settle');
}

test('bowling impact feedback fires once on real pin contact and resets for the next roll', () => {
  const physics = new BowlingPhysics();
  const contactPositions: number[] = [];
  physics.onPinHit = () => contactPositions.push(physics.ball.position.z);
  physics.roll({power: 0.7, aim: 0, spin: 0});
  for (let frame = 0; frame < 60; frame++) physics.step(1 / 60);
  expect(contactPositions).toHaveLength(0); // Lane contact is not a hit.
  const result = settle(physics);
  expect(result.remaining.length).toBeLessThan(10);
  expect(contactPositions).toHaveLength(1);
  expect(contactPositions[0]).toBeGreaterThan(18);
  for (let frame = 0; frame < 60; frame++) physics.step(1 / 60);
  expect(contactPositions).toHaveLength(1);
  physics.resetRack();
  physics.roll({power: 0.7, aim: 0, spin: 0});
  expect(settle(physics)).toEqual(result);
  expect(contactPositions).toHaveLength(2);
});

test('gutter balls and idle racks produce no pin-impact feedback', () => {
  const physics = new BowlingPhysics();
  let hits = 0;
  physics.onPinHit = () => hits++;
  for (let frame = 0; frame < 60; frame++) physics.step(1 / 60);
  expect(hits).toBe(0);
  physics.roll({power: 0.65, aim: 1, spin: 0});
  expect(settle(physics).gutter).toBe(true);
  expect(hits).toBe(0);
});
