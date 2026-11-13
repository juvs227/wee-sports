import {useLayoutEffect, useRef, useState} from 'react';
import {createIslandMotion} from '../lib/islandMotion.js';

/** An optional, bounded paint layer; the original image stays beneath. */
export function IslandMotion({source, variant, ocean = false, enabled}) {
  const canvas = useRef(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const surface = canvas.current;
    surface.dataset.ready = 'false';
    setReady(false);
    if (!enabled) return;
    const image = new Image();
    let stopped = false, renderer, observer, frame, start, previous = -Infinity;
    let lastFrame, windowStart, frames = 0, slowFrames = 0, slowWindows = 0, severeFrames = 0;
    let sized = false, painted = false;
    const show = value => {
      painted = value;
      // ResizeObserver and context-loss callbacks must hide an unavailable
      // frame immediately, without waiting for a React state commit.
      surface.dataset.ready = String(value);
      setReady(value);
    };
    const stop = () => {
      stopped = true;
      surface.dataset.ready = 'false';
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.dispose();
      renderer = null;
    };
    const contextLost = event => {
      event.preventDefault();
      show(false);
      stop();
    };
    surface.addEventListener('webglcontextlost', contextLost);
    image.onload = () => {
      if (stopped) return;
      renderer = createIslandMotion(surface, image, {variant, ocean});
      if (!renderer) return;
      const resize = () => {
        if (stopped) return;
        const now = performance.now();
        // Buffer reallocation while dragging a window is not sustained idle
        // overload. Evaluate a fresh frame window after the new size settles.
        lastFrame = undefined; windowStart = now;
        frames = slowFrames = slowWindows = severeFrames = 0;
        if (start === undefined) start = now;
        sized = renderer.resize(surface.clientWidth, surface.clientHeight, (now - start) / 1000);
        if (!sized) {show(false); return;}
        previous = now;
        if (!painted) show(true);
      };
      observer = new ResizeObserver(resize);
      observer.observe(surface);
      resize();
      const paint = now => {
        if (stopped) return;
        if (document.hidden) {
          lastFrame = undefined; windowStart = now;
          frames = slowFrames = slowWindows = severeFrames = 0;
          frame = requestAnimationFrame(paint); return;
        }
        if (start === undefined) start = now;
        // Sample every animation callback, not the intentionally capped draws.
        // Two sustained slow windows release decorative GPU work on weak TV
        // browsers. The unchanged still remains; a single load/resume stall
        // must not turn off motion. Toggling motion on retries the effect.
        const interval = lastFrame === undefined ? 0 : now - lastFrame;
        lastFrame = now;
        severeFrames = interval > 1000 ? severeFrames + 1 : 0;
        if (severeFrames >= 3) {show(false); stop(); return;}
        if (interval > 1000 || now - start < 1500) {
          windowStart = now; frames = slowFrames = slowWindows = 0;
        } else if (interval > 0) {
          windowStart ??= now;
          frames++; if (interval > 50) slowFrames++;
          if (now - windowStart >= 2000 && frames >= 12) {
            slowWindows = slowFrames / frames > .7 ? slowWindows + 1 : 0;
            windowStart = now; frames = slowFrames = 0;
            if (slowWindows >= 2) {show(false); stop(); return;}
          }
        }
        // Decorative motion is intentionally 30 fps; React does not run per frame.
        if (sized && now - previous >= 1000 / 30 - 1) {
          if (!renderer.draw((now - start) / 1000)) {show(false); stop(); return;}
          previous = now;
          if (!painted) show(true);
        }
        frame = requestAnimationFrame(paint);
      };
      frame = requestAnimationFrame(paint);
    };
    image.src = source;
    return () => {
      stop();
      image.onload = null;
      surface.removeEventListener('webglcontextlost', contextLost);
    };
  }, [source, variant, ocean, enabled]);
  return <canvas ref={canvas} className="island-motion" data-ready={enabled && ready}
    data-motion-layer={ocean ? 'ocean' : variant} aria-hidden="true" />;
}
