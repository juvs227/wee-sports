/** Keep a controller action visible even when its iframe grows inside a
 * scrolled phone page. The parent owns the final viewport position. */
export function focusControllerSection(element, target = window) {
  if (!element) return;
  if (target.parent !== target) {
    // Scrolling the child first can clip it while ResizeObserver expands the
    // iframe. Report document coordinates and let only the phone page scroll.
    const offset = Math.max(0, (element.getBoundingClientRect?.().top ?? 0) + (target.scrollY ?? 0));
    target.parent.postMessage({type: 'wee:controller-focus', offset}, location.origin);
  } else element.scrollIntoView?.({block: 'start', behavior: 'instant'});
}
