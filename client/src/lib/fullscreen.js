/** The game always has a viewport-filling fallback when browser fullscreen is unavailable. */
const requests = new WeakMap();

export function fullscreenElement(doc) {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.webkitCurrentFullScreenElement ?? null;
}

export function canEnterFullscreen(doc) {
  const element = doc.documentElement;
  if (typeof element?.requestFullscreen === 'function') return doc.fullscreenEnabled !== false;
  return (typeof element?.webkitRequestFullscreen === 'function' || typeof element?.webkitRequestFullScreen === 'function') &&
    doc.fullscreenEnabled !== false && doc.webkitFullscreenEnabled !== false && doc.webkitFullScreenEnabled !== false;
}

/** Invoke directly in a click handler: browsers require transient user activation. */
export function enterFullscreen(doc) {
  if (fullscreenElement(doc)) return Promise.resolve(true);
  if (requests.has(doc)) return requests.get(doc);
  if (!canEnterFullscreen(doc)) return Promise.resolve(false);
  const element = doc.documentElement;
  const request = [element.requestFullscreen, element.webkitRequestFullscreen, element.webkitRequestFullScreen]
    .find(method => typeof method === 'function');
  const completion = new Promise(resolve => {
    let finished = false;
    let timer;
    const finish = entered => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const name of ['fullscreenchange', 'webkitfullscreenchange']) doc.removeEventListener?.(name, changed);
      for (const name of ['fullscreenerror', 'webkitfullscreenerror']) doc.removeEventListener?.(name, failed);
      resolve(entered);
    };
    const changed = () => { if (fullscreenElement(doc)) finish(true); };
    const failed = () => finish(false);
    for (const name of ['fullscreenchange', 'webkitfullscreenchange']) doc.addEventListener?.(name, changed);
    for (const name of ['fullscreenerror', 'webkitfullscreenerror']) doc.addEventListener?.(name, failed);
    try {
      // Start inside the original gesture, rather than in a deferred callback.
      const result = request.call(element);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then(() => finish(Boolean(fullscreenElement(doc))), failed);
      } else if (fullscreenElement(doc)) {
        finish(true);
      } else if (!finished) {
        // Older WebKit returns void while entry is still pending. Observe its
        // native event rather than treating the first frame as a failed entry.
        timer = setTimeout(() => finish(Boolean(fullscreenElement(doc))), 1500);
      }
    } catch { failed(); }
  });
  const pending = completion.finally(() => { if (requests.get(doc) === pending) requests.delete(doc); });
  requests.set(doc, pending);
  return pending;
}

/** A TV remote's OK/Enter or a tap on the open stage can finish a denied
 * remote start. Never consume typing, menu actions, Escape or synthetic input. */
export function isFullscreenStartGesture(event) {
  return event.isTrusted === true && !event.defaultPrevented &&
    !event.altKey && !event.ctrlKey && !event.metaKey &&
    (event.type === 'click' || event.type === 'keydown' && event.key === 'Enter' && !event.repeat) &&
    !event.target?.closest?.('button, a, input, select, textarea, summary, [role="button"], [role="dialog"], [contenteditable="true"]');
}

/** Events do not bubble out of an iframe. Listen on our same-origin game
 * document too, so a real canvas tap/TV Enter can enter synchronously. */
export function listenForFullscreenStart(doc, onStart) {
  let child = null;
  const receive = event => {
    if (isFullscreenStartGesture(event)) onStart();
  };
  const attach = target => {
    target?.addEventListener('click', receive);
    target?.addEventListener('keydown', receive);
  };
  const detach = target => {
    target?.removeEventListener('click', receive);
    target?.removeEventListener('keydown', receive);
  };
  const loaded = event => {
    const frame = doc.querySelector('.game-session .game-frame iframe');
    if (event && event.target !== frame) return;
    let next = null;
    try { next = frame?.contentDocument || null; } catch { /* Cross-origin frames cannot lend a local gesture. */ }
    if (next === child) return;
    detach(child);
    child = next;
    attach(child);
  };
  attach(doc);
  doc.addEventListener('load', loaded, true);
  loaded();
  return () => {
    detach(doc);
    detach(child);
    doc.removeEventListener('load', loaded, true);
  };
}

/** Chrome can expose an existing automatic-fullscreen grant. Query/observe it
 * without prompting, changing permissions or pretending activation was granted. */
export function observeAutomaticFullscreen(doc, onGranted) {
  const permissions = doc.defaultView?.navigator?.permissions;
  if (!permissions?.query) return () => {};
  let disposed = false;
  let status;
  const changed = () => {
    if (!disposed && status?.state === 'granted') onGranted();
  };
  try {
    Promise.resolve(permissions.query({name: 'fullscreen', allowWithoutGesture: true})).then(value => {
      if (disposed) return;
      status = value;
      status.addEventListener?.('change', changed);
      changed();
    }).catch(() => {});
  } catch { /* Unsupported Permissions descriptors keep the normal gesture path. */ }
  return () => {
    disposed = true;
    status?.removeEventListener?.('change', changed);
  };
}

export async function exitFullscreen(doc) {
  if (!fullscreenElement(doc)) return;
  const exit = [doc.exitFullscreen, doc.webkitExitFullscreen, doc.webkitCancelFullScreen]
    .find(method => typeof method === 'function');
  try { await exit?.call(doc); } catch { /* Browser already exited or the tab lost focus. */ }
}
