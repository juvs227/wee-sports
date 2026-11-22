/** Request only the permissions needed for this controller, on the Play tap.
 * Both iOS permission calls must happen before any network request is awaited.
 */
export function requestControllerIntent(target = globalThis.window) {
  const touch = permission => ({mode: 'touch', permission});
  if (!target?.isSecureContext || !target.DeviceMotionEvent) return Promise.resolve(touch('unavailable'));
  const policy = target.document?.permissionsPolicy ?? target.document?.featurePolicy;
  if (policy?.allowsFeature && ['accelerometer', 'gyroscope'].some(feature => !policy.allowsFeature(feature))) {
    return Promise.resolve(touch('unavailable'));
  }
  try {
    const ask = type => {
      try { return Promise.resolve(typeof type?.requestPermission === 'function' ? type.requestPermission() : 'granted').catch(() => 'denied'); }
      catch { return Promise.resolve('denied'); }
    };
    const motion = ask(target.DeviceMotionEvent);
    const orientation = ask(target.DeviceOrientationEvent);
    return Promise.all([motion, orientation]).then(([permission]) =>
      permission === 'granted' ? {mode: 'motion', permission: 'granted'} : touch('denied')).catch(() => touch('denied'));
  } catch {
    return Promise.resolve(touch('denied'));
  }
}

const MODE_KEY = 'wee:controller-mode';
export function rememberControllerIntent(intent, storage) {
  try { (storage ?? globalThis.sessionStorage)?.setItem(MODE_KEY, intent.mode); } catch { /* Play works without storage. */ }
}
export function rememberedControllerIntent(storage) {
  try {
    const mode = (storage ?? globalThis.sessionStorage)?.getItem(MODE_KEY);
    if (mode === 'motion' || mode === 'touch') return {mode, permission: mode === 'motion' ? 'granted' : 'unavailable'};
  } catch { /* The controller can still offer Play directly after a reload. */ }
  return null;
}
