import {expect, test} from 'vitest';
import {createFrameQuality} from '../src/rendering/frameQuality';

test('sustained expensive frames lower bounded presentation quality and recover slowly', () => {
    const quality = createFrameQuality({maxPixelRatio: 1.75});
    let now = 0;
    quality.sample(now, 0);
    for (let frame = 0; frame < 180; frame++) quality.sample(now += 35, 25);
    expect(quality.settings).toEqual({level: 3, pixelRatio: .65, shadowEvery: 3, shadows: true});
    for (let frame = 0; frame < 300; frame++) quality.sample(now += 1000 / 60, 4);
    expect(quality.settings.level).toBe(3);
    for (let frame = 0; frame < 500; frame++) quality.sample(now += 1000 / 60, 4);
    expect(quality.settings.level).toBe(2);
    expect(quality.diagnostics().frameP95Ms).toBeCloseTo(1000 / 60);
});

test('a stable low-refresh display and isolated spikes do not degrade visual quality', () => {
    for (const interval of [1000 / 30, 1000 / 60, 1000 / 120]) {
        const quality = createFrameQuality({maxPixelRatio: 1});
        let now = 0;
        for (let frame = 0; frame < 600; frame++) quality.sample(now += interval + (frame % 120 === 0 ? 30 : 0), 3);
        expect(quality.settings.level).toBe(0);
    }
});

test('hidden frames and isolated resume gaps do not poison frame percentiles', () => {
    const quality = createFrameQuality({maxPixelRatio: .6});
    quality.sample(0, 2); quality.sample(16, 2); quality.sample(32, 2);
    quality.sample(10000, 500, false); quality.sample(10016, 2); quality.sample(10032, 2);
    quality.sample(20000, 200); quality.sample(20016, 2);
    expect(quality.diagnostics().frameP99Ms).toBe(16);
    for (let time = 20050; time < 30000; time += 35) quality.sample(time, 25);
    expect(quality.settings.pixelRatio).toBe(.6);
    expect(quality.settings.shadowEvery).toBe(3);
});

test('repeated severe visible delays reduce GPU cost even when CPU submission is cheap', () => {
    for (const interval of [60, 366, 1200]) {
        const quality = createFrameQuality({maxPixelRatio: 1});
        let now = 0;
        quality.sample(now, 2);
        for (let frame = 0; frame < 2; frame++) quality.sample(now += interval, 2);
        expect(quality.settings.level).toBe(0);
        quality.sample(now += interval, 2);
        expect(quality.settings.level).toBe(1);
        expect(quality.settings.shadows).toBe(true);
        for (let frame = 0; frame < 60; frame++) quality.sample(now += interval, 2);
        expect(quality.settings).toEqual({level: 4, pixelRatio: .65, shadowEvery: 3, shadows: false});
        expect(quality.diagnostics().frameP95Ms).toBeCloseTo(interval);
    }
});

test('a single visible long stall or hidden frames cannot trigger emergency degradation', () => {
    const quality = createFrameQuality({maxPixelRatio: 1});
    let now = 0;
    quality.sample(now, 2);
    quality.sample(now += 10000, 600);
    for (let frame = 0; frame < 600; frame++) quality.sample(now += 1000 / 30, 2);
    expect(quality.settings.level).toBe(0);
    expect(quality.diagnostics().frameP95Ms).toBeCloseTo(1000 / 30);
    for (let frame = 0; frame < 20; frame++) quality.sample(now += 1200, 600, false);
    quality.sample(now += 1200, 2);
    quality.sample(NaN, 2);
    quality.sample(now += 1200, 2);
    quality.sample(now += 16, 2);
    expect(quality.settings.level).toBe(0);
});

test('a stable cheap 30Hz display recovers gradually after severe overload', () => {
    const quality = createFrameQuality({maxPixelRatio: 1});
    let now = 0;
    quality.sample(now, 2);
    for (let frame = 0; frame < 12; frame++) quality.sample(now += 366, 2);
    expect(quality.settings.level).toBe(4);
    for (let frame = 0; frame < 240; frame++) quality.sample(now += 1000 / 30, 2);
    expect(quality.settings.level).toBe(4);
    for (let frame = 0; frame < 120; frame++) quality.sample(now += 1000 / 30, 2);
    expect(quality.settings.level).toBe(3);
    expect(quality.settings.shadows).toBe(true);
    for (let frame = 0; frame < 1200; frame++) quality.sample(now += 1000 / 30, 2);
    expect(quality.settings.level).toBe(0);
});

test('stable GPU-bound 30 FPS is probed and the responsive budget stays stable', () => {
    const quality = createFrameQuality({maxPixelRatio: 1});
    let now = 0;
    // The CPU merely submits work. Rendering above this pixel budget misses
    // every other 60 Hz vblank; a lower buffer restores the real refresh rate.
    for (let frame = 0; frame < 1500; frame++) {
        quality.sample(now += quality.settings.pixelRatio > .75 ? 1000 / 30 : 1000 / 60, 2);
    }
    expect(quality.settings.pixelRatio).toBe(.7);
    expect(quality.diagnostics()).toMatchObject({resolutionProbes: 1, responsiveProbes: 1});
    expect(quality.diagnostics().frameP95Ms).toBeCloseTo(1000 / 60);
});

test('a resolution probe rolls back on a genuinely capped display', () => {
    const quality = createFrameQuality({maxPixelRatio: 1});
    let now = 0;
    for (let frame = 0; frame < 900; frame++) quality.sample(now += 1000 / 30, 2);
    expect(quality.settings.level).toBe(0);
    expect(quality.diagnostics()).toMatchObject({resolutionProbes: 1, responsiveProbes: 0});
});

test('an observed fast display detects later GPU slowdown even with cheap CPU submission', () => {
    const quality = createFrameQuality({maxPixelRatio: 1});
    let now = 0;
    for (let frame = 0; frame < 180; frame++) quality.sample(now += 1000 / 60, 2);
    for (let frame = 0; frame < 180; frame++) quality.sample(now += 1000 / 30, 2);
    expect(quality.settings.level).toBeGreaterThan(0);
});

test('large and retina viewports have a bounded drawing buffer without changing layout', () => {
    for (const [width, height, dpr] of [[3840, 2160, 1], [7680, 4320, 2], [1920, 1080, 2], [1280, 720, 1]]) {
        const quality = createFrameQuality({maxPixelRatio: dpr});
        const setting = quality.resize(width, height);
        expect(width * height * setting.pixelRatio ** 2).toBeLessThanOrEqual(1920 * 1080 + .001);
        expect(setting.pixelRatio).toBeLessThanOrEqual(dpr);
        const normal = quality.resize(1280, 720);
        expect(normal.pixelRatio).toBe(Math.min(dpr, 1.5));
        expect(quality.resize(NaN, 0)).toEqual(normal);
    }
});
