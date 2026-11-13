/** A short visible sensor scheduling gap must not pause every player. Inputs
 * still stop in the controller immediately; only revoking an already accepted
 * motion setup is deferred. Backgrounding always flushes the revocation. */
export function createControllerSetupRelay({request, visible = () => !document.hidden,
  setTimer = setTimeout, clearTimer = clearTimeout, graceMs = 1500}) {
  let accepted, pending = null, revision = 0;
  const cancel = () => {
    if (!pending) return;
    clearTimer(pending.timer);
    pending.resolve({ok: false, error: 'setup-superseded'});
    pending = null;
  };
  async function deliver(value, version) {
    const result = await request(value);
    if (version === revision && result?.ok) accepted = value;
    return result;
  }
  function flush() {
    if (!pending) return;
    const current = pending;
    clearTimer(current.timer); pending = null;
    void deliver(null, current.version).then(current.resolve);
  }
  return {
    submit(value, {immediate = false} = {}) {
      cancel();
      const version = ++revision;
      if (value !== null || accepted !== 'motion' || immediate || !visible()) return deliver(value, version);
      return new Promise(resolve => {pending = {version, resolve, timer: setTimer(flush, graceMs)};});
    },
    flush,
    reset() {cancel(); revision++; accepted = undefined;},
  };
}
