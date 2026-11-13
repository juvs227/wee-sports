import {expect, test} from 'vitest';
import {SPORT_REGISTRY} from '../../shared/sportRegistry.js';
import {CONTROLLER_PROTOCOL, negotiateControllerCapabilities} from '../../shared/controllerCapabilities.js';
import {OPEN_SPORTS, PROTOCOL_VERSION, ERRORS} from '../../shared/protocol.js';
import {RoomStore} from '../src/RoomStore.js';

test('the split advertises and opens only tennis and bowling', () => {
  expect(OPEN_SPORTS).toEqual(['tennis', 'bowling']);
  expect(Object.keys(SPORT_REGISTRY)).toEqual(['tennis', 'bowling']);
  for (const sport of OPEN_SPORTS) {
    expect(new RoomStore().createRoom('tv', {v: PROTOCOL_VERSION, sport}).ok).toBe(true);
  }
  expect(new RoomStore().createRoom('tv', {v: PROTOCOL_VERSION, sport: 'table-tennis'}))
    .toMatchObject({ok: false, error: ERRORS.BAD_SPORT});
  expect(negotiateControllerCapabilities({protocol: CONTROLLER_PROTOCOL, sports: {'table-tennis': 1}}).ok).toBe(false);
});
