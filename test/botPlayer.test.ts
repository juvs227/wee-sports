import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { chooseBotStroke, type BotStroke } from '../src/World/botPlayer.ts';

const position = { x: 0, y: 0, z: -10 };
const forehand: BotStroke = { backhand: false, duration: 0.3, offset: { x: 0.5, y: 1, z: 0 } };
const backhand: BotStroke = { backhand: true, duration: 0.3, offset: { x: -0.5, y: 1, z: 0 } };
const incoming = { position: { x: 0.5, y: 1, z: -8.5 }, velocity: { x: 0, y: 0, z: -0.2 }, gravity: 0 };

test('bot chooses a matching stroke shortly before the ball reaches its strike pose', () => {
    assert.equal(chooseBotStroke(incoming, position, [forehand, backhand]), forehand);
    assert.equal(chooseBotStroke({ ...incoming, position: { ...incoming.position, x: -0.5 } }, position, [forehand, backhand]), backhand);
});

test('bot waits for distant balls and does not chase outgoing or already passed balls', () => {
    assert.equal(chooseBotStroke({ ...incoming, position: { ...incoming.position, z: 0 } }, position, [forehand]), null);
    assert.equal(chooseBotStroke({ ...incoming, velocity: { x: 0, y: 0, z: 0.2 } }, position, [forehand]), null);
    assert.equal(chooseBotStroke({ ...incoming, position: { ...incoming.position, z: -11 } }, position, [forehand]), null);
});

test('bot does not manufacture hits outside its reach or with unavailable animations', () => {
    assert.equal(chooseBotStroke({ ...incoming, position: { ...incoming.position, x: 3 } }, position, [forehand]), null);
    assert.equal(chooseBotStroke({ ...incoming, position: { ...incoming.position, y: 3 } }, position, [forehand]), null);
    assert.equal(chooseBotStroke(incoming, position, []), null);
    assert.equal(chooseBotStroke(incoming, position, [{ ...forehand, duration: 0 }]), null);
});

test('bot accepts balls near either edge of the racket contact window', () => {
    const early = { ...incoming, position: { x: 0.5, y: 1, z: -9.1 } };
    const late = { ...incoming, position: { x: 0.5, y: 1, z: -8.1 } };
    assert.equal(chooseBotStroke(early, position, [forehand]), forehand);
    assert.equal(chooseBotStroke(late, position, [forehand]), forehand);
});
