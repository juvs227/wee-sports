/** Keep one wake lock while playing; a late permission result cannot outlive play. */
export function createScreenAwake({ navigator, document, onState = () => {} }) {
  let active = false;
  let disposed = false;
  let pending = false;
  let lock = null;
  const visible = () => !document.hidden;
  async function release(sentinel) {
    try { await sentinel?.release(); } catch { /* Already released by the browser. */ }
  }
  async function request() {
    if (!active || disposed || !visible() || pending || lock) return;
    if (!navigator?.wakeLock?.request) { onState('unavailable'); return; }
    pending = true;
    onState('requesting');
    try {
      const next = await navigator.wakeLock.request('screen');
      if (!active || disposed || !visible()) { await release(next); return; }
      lock = next;
      next.addEventListener('release', () => {
        if (lock !== next) return;
        lock = null;
        onState(active && visible() ? 'released' : 'inactive');
      });
      onState('awake');
    } catch {
      if (active && !disposed) onState('unavailable');
    } finally { pending = false; }
  }
  return {
    setActive(value) {
      const next = Boolean(value) && !disposed && visible();
      if (next === active) return;
      active = next;
      if (active) void request();
      else {
        const previous = lock;
        lock = null;
        void release(previous);
        onState('inactive');
      }
    },
    // Retry only on a fresh interaction/visibility transition, never every sensor tick.
    retry() { void request(); },
    dispose() {
      disposed = true;
      this.setActive(false);
    },
  };
}

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

/** Decorative feedback follows the sensors; game physics remain on the TV. */
export function createPhoneFeedback({ visual, object, navigator, document, reducedMotion }) {
  let active = false;
  let animation = null;
  let confirmation = null;
  let lastMotion = -Infinity;
  let lastHit = -Infinity;
  const reduced = () => reducedMotion?.matches === true;
  const set = (name, value) => visual.style?.setProperty(name, value);
  function reset() {
    animation?.cancel(); animation = null;
    confirmation?.cancel(); confirmation = null;
    set('--motion-angle', '0deg');
    set('--motion-shift', '0px');
    try { navigator?.vibrate?.(0); } catch { /* Optional device capability. */ }
  }
  function animate(frames, duration) {
    if (!active || document.hidden || reduced()) return;
    animation?.cancel();
    animation = object.animate?.(frames, { duration, easing: 'cubic-bezier(.2,.7,.2,1)' }) ?? null;
  }
  function pulse(length) {
    if (!active || document.hidden || navigator?.userActivation?.hasBeenActive === false) return;
    try { navigator?.vibrate?.(length); } catch { /* Optional device capability. */ }
  }
  function glow() {
    if (!active || document.hidden) return;
    confirmation?.cancel();
    // A brief color change also works for people who request reduced motion.
    confirmation = visual.animate?.([
      { backgroundColor: 'var(--accent-soft)' },
      { backgroundColor: 'transparent' },
    ], { duration: 450 }) ?? null;
  }
  const preferenceChanged = () => { if (reduced()) reset(); };
  reducedMotion?.addEventListener?.('change', preferenceChanged);
  return {
    setActive(value) {
      const next = Boolean(value) && !document.hidden;
      if (next === active) return;
      active = next;
      if (!active) reset();
    },
    motion(sample, now) {
      if (!active || document.hidden || reduced() || now - lastMotion < 32) return;
      lastMotion = now;
      const beta = Number.isFinite(sample.rotationBeta) ? sample.rotationBeta : 0;
      const gamma = Number.isFinite(sample.rotationGamma) ? sample.rotationGamma : 0;
      set('--motion-angle', `${clamp(beta / 22, 28).toFixed(1)}deg`);
      set('--motion-shift', `${clamp(gamma / 35, 12).toFixed(1)}px`);
    },
    swing(label) {
      const direction = label === 'Backhand' ? -1 : 1;
      animate([
        { transform: 'rotate(0deg)' },
        { transform: `rotate(${direction * 48}deg)`, offset: .45 },
        { transform: 'rotate(0deg)' },
      ], 320);
    },
    delivered(kind) {
      glow();
      if (kind !== 'roll') return;
      animate([
        { transform: 'translateY(0) scale(1)', opacity: 1 },
        { transform: 'translateY(-110px) scale(.18)', opacity: 0, offset: .8 },
        { transform: 'translateY(0) scale(1)', opacity: 0, offset: .81 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ], 850);
      pulse(18);
    },
    hit(now) {
      if (now - lastHit < 80) return;
      lastHit = now;
      glow();
      pulse(28);
    },
    dispose() { active = false; reset(); reducedMotion?.removeEventListener?.('change', preferenceChanged); },
  };
}
