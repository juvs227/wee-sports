import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSwingStream } from '../src/controller/swingStream.js';

for (const name of ['two-forehands-one-backhand', 'four-backhands', 'left-mixed', 'left-four-backhands-new', 'left-four-forehands']) {
  test(`fast confirmation preserves completion labels and peaks: ${name}`, () => {
    const data = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
    function replay(fast) {
      // Compare classifiers independently from the user-selectable recovery gate.
      const stream = createSwingStream(name.startsWith('left') ? 'Left' : 'Right', { fast, suppressReturns: false });
      const events = [];
      for (const sample of data.samples ?? data) {
        stream.push(sample);
        events.push(...stream.analyze());
      }
      return events;
    }
    const original = replay(false);
    const fast = replay(true);
    assert.deepEqual(fast.map(event => [event.label, event.peakTimeMs]), original.map(event => [event.label, event.peakTimeMs]));
    assert.ok(fast.some(event => event.fast));
    for (let i = 0; i < fast.length; i++) assert.ok(fast[i].endMs <= original[i].endMs);
  });
}
