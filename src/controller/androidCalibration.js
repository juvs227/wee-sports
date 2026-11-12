/** PR 14's native quaternion source, with cancellation and error ownership. */
export function createAndroidOrientationSource({target = globalThis.window, permissions = globalThis.navigator?.permissions} = {}) {
  let currentQuat = null, currentNormal = null, sensor = null, generation = 0;
  let removeListeners = () => {};
  const source = {
    onReading: null,
    onError: null,
    async start() {
      source.stop();
      const attempt = generation;
      if (permissions?.query) {
        const grants = await Promise.all(['accelerometer', 'gyroscope', 'magnetometer'].map(name => permissions.query({name})));
        if (attempt !== generation) return;
        // The optional source must never add a surprise permission prompt.
        if (grants.some(grant => grant.state !== 'granted')) throw new Error('Absolute orientation permission is unavailable');
      }
      if (attempt !== generation) return;
      const next = new target.AbsoluteOrientationSensor({frequency: 30});
      sensor = next;
      const reading = () => {
        if (attempt !== generation || sensor !== next) return;
        const q = next.quaternion;
        if (!q || q.length !== 4 || !Array.from(q).every(Number.isFinite)) return;
        const length = Math.hypot(...q);
        if (length < .001) return;
        const [x, y, z, w] = Array.from(q, value => value / length);
        currentQuat = [x, y, z, w];
        currentNormal = [2 * (x*z + w*y), 2 * (y*z - w*x), 1 - 2 * (x*x + y*y)];
        source.onReading?.([...currentQuat], [...currentNormal]);
      };
      const error = event => {
        if (attempt !== generation || sensor !== next) return;
        source.stop();
        source.onError?.(event.error || new Error('Absolute orientation stopped'));
      };
      next.addEventListener('reading', reading);
      next.addEventListener('error', error);
      removeListeners = () => {next.removeEventListener('reading', reading); next.removeEventListener('error', error);};
      try {next.start();} catch (error) {source.stop(); throw error;}
    },
    stop() {
      generation++;
      removeListeners(); removeListeners = () => {};
      try {sensor?.stop();} catch { /* A failed optional sensor is already unavailable. */ } finally {sensor = null; currentQuat = null; currentNormal = null;}
    },
    getNormal: () => currentNormal && [...currentNormal],
    getQuaternion: () => currentQuat && [...currentQuat],
  };
  return source;
}
