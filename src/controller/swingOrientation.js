import {createOrientationSource} from './orientationCalibration.js';
import {isNormalVector} from '../../shared/swingDetails.js';

/** Optional per-play reference. It neither classifies strokes nor gates setup. */
export function createSwingOrientation({createSource = createOrientationSource, clock = () => performance.now()} = {}) {
  let source = null, reference = null, latest = null, receivedAt = null;
  const stop = () => {
    const previous = source;
    source = null; reference = null; latest = null; receivedAt = null;
    previous?.stop();
  };
  return {
    async start(options) {
      stop();
      const candidate = createSource(options); source = candidate;
      candidate.onReset = () => {
        if (source === candidate) {reference = null; latest = null; receivedAt = null;}
      };
      candidate.onReading = (_quaternion, normal) => {
        if (source !== candidate || !isNormalVector(normal)) return;
        reference ??= [...normal]; latest = [...normal]; receivedAt = clock();
      };
      try {await candidate.start();} catch {if (source === candidate) stop();}
    },
    stop,
    details() {
      const age = receivedAt === null ? Infinity : clock() - receivedAt;
      return reference && latest && age >= 0 && age <= 250 ? {netNormal: [...reference], swingNormal: [...latest]} : null;
    },
  };
}
