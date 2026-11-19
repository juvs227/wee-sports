export interface FrameQualitySettings {
    level: number;
    pixelRatio: number;
    shadowEvery: number;
    shadows: boolean;
}

const percentile = (values: number[], fraction: number): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

/** Presentation only: never changes physics time, input cadence or camera framing.
 * Sustained expensive/jittery frames lower resolution; repeated severe delays
 * also catch GPU pressure that CPU submission timing cannot measure. A bounded
 * resolution probe distinguishes a slow GPU from a genuinely capped display.
 * Recovery is deliberately slower. No device model or user-agent guessing. */
export function createFrameQuality({maxPixelRatio = 1.75, minPixelRatio = .65, maxPixelCount = 1920 * 1080} = {}) {
    const maximum = Math.max(.5, Math.min(2, Number.isFinite(maxPixelRatio) ? maxPixelRatio : 1));
    const minimum = Math.min(maximum, Math.max(.5, Number.isFinite(minPixelRatio) ? minPixelRatio : .65));
    const ratios = [maximum, Math.max(minimum, maximum * .85), Math.max(minimum, maximum * .7), minimum, minimum];
    const pixelBudget = Number.isFinite(maxPixelCount) && maxPixelCount > 0 ? maxPixelCount : 1920 * 1080;
    let viewportScale = 1, viewportWidth = 0, viewportHeight = 0;
    const intervals: number[] = [], work: number[] = [];
    let windowFrames: number[] = [], windowWork: number[] = [];
    let previous: number | null = null, windowStart: number | null = null;
    let level = 0, frames = 0, slowFrames = 0, healthySince: number | null = null;
    let severeFrames = 0, lastReduction = -Infinity;
    let fastestStableMs = Infinity, resolutionFloor = 0, probeCompleted = false;
    let probe: {level: number; median: number} | null = null;
    let resolutionProbes = 0, responsiveProbes = 0;
    const settings = (): FrameQualitySettings => ({level, pixelRatio: ratios[level] * viewportScale, shadowEvery: level >= 3 ? 3 : level >= 2 ? 2 : 1, shadows: level < 4});
    const resetWindow = () => {windowFrames = []; windowWork = []; windowStart = null; healthySince = null;};
    return {
        get settings() {return settings();},
        resize(width: number, height: number): FrameQualitySettings {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return settings();
            const scale = Math.min(1, Math.sqrt(pixelBudget / (width * height * maximum * maximum)));
            if (width !== viewportWidth || height !== viewportHeight) {
                viewportScale = scale; viewportWidth = width; viewportHeight = height;
                // A smaller viewport can afford more detail. Recheck its own
                // budget rather than retaining a proof from another size.
                fastestStableMs = Infinity; resolutionFloor = 0; probeCompleted = false; probe = null;
                previous = null; severeFrames = 0; resetWindow();
            }
            return settings();
        },
        sample(now: number, workMs: number, visible = true): FrameQualitySettings | null {
            if (!visible || !Number.isFinite(now) || !Number.isFinite(workMs) || workMs < 0) {
                previous = null; severeFrames = 0; resetWindow(); return null;
            }
            const interval = previous === null ? null : now - previous;
            previous = now;
            if (interval === null || interval <= 0) {severeFrames = 0; resetWindow(); return null;}
            severeFrames = interval > 50 ? severeFrames + 1 : 0;
            // One debugger/resume gap is not evidence of overload. Repeated
            // visible seconds-long frames are: dropping every such sample
            // would leave the slowest TVs permanently at maximum quality.
            if (interval > 1000 && severeFrames < 3) {resetWindow(); return null;}
            frames++; if (interval > 22) slowFrames++;
            intervals.push(interval); work.push(workMs);
            if (intervals.length > 180) {intervals.shift(); work.shift();}
            if (severeFrames >= 3 && now - lastReduction >= 500 && level < ratios.length - 1) {
                level++; lastReduction = now; severeFrames = 0; resetWindow(); return settings();
            }
            windowStart ??= now;
            windowFrames.push(interval); windowWork.push(workMs);
            if (now - windowStart < 1500 || windowFrames.length < 12) return null;
            const median = percentile(windowFrames, .5), p95 = percentile(windowFrames, .95);
            const slowRatio = windowFrames.filter(value => value > 22).length / windowFrames.length;
            const busy = percentile(windowWork, .75) > 12;
            const unstable = p95 > Math.max(24, median * 1.35);
            const cheap = percentile(windowWork, .95) < 9;
            const stable = p95 < median * 1.15;
            if (cheap && stable) fastestStableMs = Math.min(fastestStableMs, median);
            const slowerThanObserved = Number.isFinite(fastestStableMs) && median > fastestStableMs * 1.35;
            const overloaded = slowRatio > .35 && (busy || unstable || slowerThanObserved);
            // A stable capped 30 Hz display must be able to recover after a
            // transient overload, just like 60/120 Hz displays.
            const healthy = cheap &&
                (p95 < 19 || (median >= 31 && median <= 35 && p95 < 37));
            windowFrames = []; windowWork = []; windowStart = now;
            if (probe) {
                const original = probe; probe = null; probeCompleted = true;
                if (stable && median < original.median * .8) {
                    // Resolution affected frame cadence: retain this safe floor
                    // for the viewport instead of oscillating back to 30 FPS.
                    resolutionFloor = level; responsiveProbes++;
                } else if (!overloaded) {
                    // A real 30 Hz display gains nothing from fewer pixels.
                    level = original.level; healthySince = null; return settings();
                }
            }
            if (!overloaded && cheap && !probeCompleted && level === 0 && stable && median >= 30 && median <= 50 &&
                ratios[2] < ratios[0] * .9) {
                // One short trial, not a permanent assumption that every
                // TV is weak. Two levels cross common 60→30 Hz GPU cliffs.
                probe = {level, median}; resolutionProbes++; level = 2;
                lastReduction = now; healthySince = null; return settings();
            }
            if (overloaded) {
                healthySince = null;
                // Shadows disappear only with sustained severe frame delays.
                if (level < 3) {level++; lastReduction = now; return settings();}
            } else if (healthy) {
                healthySince ??= now;
                if (level > resolutionFloor && now - healthySince >= 8000) {
                    level--; healthySince = now; return settings();
                }
            } else healthySince = null;
            return null;
        },
        diagnostics() {
            return {frames, slowFrames, frameP50Ms: percentile(intervals, .5), frameP95Ms: percentile(intervals, .95),
                frameP99Ms: percentile(intervals, .99), workP95Ms: percentile(work, .95), ...settings(),
                resolutionProbes, responsiveProbes, pixelBudget,
                scope: 'local frame intervals and CPU/render submission; not motion-to-screen or GPU completion latency'};
        },
    };
}
