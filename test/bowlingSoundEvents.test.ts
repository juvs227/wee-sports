import {expect, test, vi} from 'vitest';
import {BowlingWorld, BowlingSoundEvent} from '../src/bowling/World';
import {BowlingMatch, FULL_RACK} from '../src/bowling/match';
import {RollSettlement} from '../src/bowling/physics';

/** Exercise the delivery lifecycle without constructing a browser or WebGL renderer. */
function deliveryHarness(match = new BowlingMatch([{player: 1, name: 'Player 1'}])) {
  const events: BowlingSoundEvent[] = [];
  const physics = {
    roll: vi.fn(() => true),
    step: vi.fn<() => RollSettlement | null>(() => null),
    resetRack: vi.fn(), sweep: vi.fn(),
  };
  const world = Object.create(BowlingWorld.prototype) as BowlingWorld;
  Object.assign(world, {
    match, physics, players: [{player: 1, name: 'Player 1'}],
    running: true, disposed: false, rolling: false, settlement: null, revealTime: 0,
    trail: {geometry: {setDrawRange: vi.fn()}, visible: false}, aimLine: {visible: true},
    onSoundEvent: (event: BowlingSoundEvent) => events.push(event),
    onState: vi.fn(), syncBodies: vi.fn(), render: vi.fn(),
  });
  const lifecycle = world as unknown as {running: boolean; advanceDelivery(dt: number): void; pinContact(): void; gutterContact(): void};
  function settle(remaining: number[]) {
    physics.step.mockReturnValueOnce({remaining, gutter: false, elapsed: 5});
    lifecycle.advanceDelivery(1 / 60);
    for (let frame = 0; frame < 70; frame++) lifecycle.advanceDelivery(1 / 60);
  }
  return {world, physics, lifecycle, events, settle};
}

const delivery = {player: 1, power: 0.7, aim: 0, spin: 0};

test('release and roll sounds require an accepted delivery', () => {
  const {world, lifecycle, physics, events} = deliveryHarness();
  lifecycle.running = false;
  expect(world.roll(delivery).ok).toBe(false);
  lifecycle.running = true;
  expect(world.roll({...delivery, player: 2}).ok).toBe(false);
  expect(world.roll({...delivery, power: NaN}).ok).toBe(false);
  physics.roll.mockReturnValueOnce(false);
  expect(world.roll(delivery).ok).toBe(false);
  expect(events).toEqual([]);
  expect(world.roll(delivery).ok).toBe(true);
  expect(world.roll(delivery).ok).toBe(false);
  expect(events).toEqual(['release', 'roll']);
});

test('settlement stops the rolling cue once; pause, polling and reset do not replay outcomes', () => {
  const {world, lifecycle, physics, events} = deliveryHarness();
  world.roll(delivery);
  physics.step.mockReturnValueOnce({remaining: [...FULL_RACK], gutter: false, elapsed: 5});
  lifecycle.running = false;
  lifecycle.advanceDelivery(1 / 60);
  expect(events).toEqual(['release', 'roll']);
  lifecycle.running = true;
  lifecycle.advanceDelivery(1 / 60);
  expect(events).toEqual(['release', 'roll', 'roll-end']);
  lifecycle.running = false;
  for (let frame = 0; frame < 120; frame++) lifecycle.advanceDelivery(1 / 60);
  expect(events).toHaveLength(3);
  lifecycle.running = true;
  for (let frame = 0; frame < 120; frame++) lifecycle.advanceDelivery(1 / 60);
  for (let frame = 0; frame < 10; frame++) world.getState();
  expect(events).toEqual(['release', 'roll', 'roll-end', 'result']);
  world.reset();
  lifecycle.advanceDelivery(1 / 60);
  expect(events).toHaveLength(4);
});

test('strike, spare and match cues follow the recorded score, once per outcome', () => {
  const strike = deliveryHarness();
  strike.world.roll(delivery);
  strike.settle([]);
  expect(strike.events).toEqual(['release', 'roll', 'roll-end', 'strike']);

  const spareMatch = new BowlingMatch([{player: 1, name: 'Player 1'}]);
  spareMatch.record([8, 9, 10]);
  const spare = deliveryHarness(spareMatch);
  spare.world.roll(delivery);
  spare.settle([]);
  expect(spare.events).toEqual(['release', 'roll', 'roll-end', 'spare']);

  const finalMatch = new BowlingMatch([{player: 1, name: 'Player 1'}]);
  for (let roll = 0; roll < 11; roll++) finalMatch.record([]);
  const finish = deliveryHarness(finalMatch);
  finish.world.roll(delivery);
  finish.settle([]);
  expect(finish.events).toEqual(['release', 'roll', 'roll-end', 'match']);
  expect(finish.world.getState().players[0].total).toBe(300);
  expect(finish.world.roll(delivery).ok).toBe(false);
  finish.lifecycle.advanceDelivery(1 / 60);
  expect(finish.events).toHaveLength(4);
});

test.each(['pinContact', 'gutterContact'] as const)('rolling bed ends at %s before the pin settlement delay', contact => {
  const {world, lifecycle, physics, events, settle} = deliveryHarness();
  world.roll(delivery);
  lifecycle[contact]();
  expect(events).toEqual(['release', 'roll', 'roll-end', contact === 'pinContact' ? 'pin' : 'gutter']);
  for (let frame = 0; frame < 120; frame++) lifecycle.advanceDelivery(1 / 60);
  expect(physics.step).toHaveBeenCalledTimes(120);
  expect(events.filter(event => event === 'roll-end')).toHaveLength(1);
  settle([...FULL_RACK]);
  expect(events.filter(event => event === 'roll-end')).toHaveLength(1);
  expect(events.at(-1)).toBe('result');
});

test('reset stops an unfinished rolling bed without emitting a score outcome', () => {
  const {world, events} = deliveryHarness();
  world.roll(delivery);
  world.reset();
  world.reset();
  expect(events).toEqual(['release', 'roll', 'roll-end']);
});
