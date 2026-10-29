import { expect, test, vi } from 'vitest';
import { createPhoneFeedback, createScreenAwake } from '../src/controller/phoneExperience.js';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function sentinel() {
  const listeners = new Map();
  return { release: vi.fn(async () => listeners.get('release')?.()),
    addEventListener: (event, callback) => listeners.set(event, callback),
    expire: () => listeners.get('release')?.() };
}

test('screen lock is coalesced, released on pause and reacquired on resume', async () => {
  const first = sentinel();
  const second = sentinel();
  const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const onState = vi.fn();
  const awake = createScreenAwake({ navigator: { wakeLock: { request } }, document: { hidden: false }, onState });
  awake.setActive(true);
  awake.setActive(true);
  awake.retry();
  await settle();
  expect(request).toHaveBeenCalledExactlyOnceWith('screen');
  expect(onState).toHaveBeenLastCalledWith('awake');
  awake.setActive(false);
  expect(first.release).toHaveBeenCalledTimes(1);
  awake.setActive(true);
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  awake.dispose();
  expect(second.release).toHaveBeenCalledTimes(1);
});

test('a wake-lock promise resolving after leave is immediately released', async () => {
  let grant;
  const granted = sentinel();
  const onState = vi.fn();
  const awake = createScreenAwake({ navigator: { wakeLock: { request: () => new Promise(resolve => { grant = resolve; }) } },
    document: { hidden: false }, onState });
  awake.setActive(true);
  awake.dispose();
  grant(granted);
  await settle();
  expect(granted.release).toHaveBeenCalledTimes(1);
  expect(onState).not.toHaveBeenCalledWith('awake');
});

test('wake-lock denial does not retry every render, but a new interaction can retry', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('Not allowed')).mockResolvedValueOnce(sentinel());
  const onState = vi.fn();
  const awake = createScreenAwake({ navigator: { wakeLock: { request } }, document: { hidden: false }, onState });
  awake.setActive(true);
  await settle();
  expect(onState).toHaveBeenLastCalledWith('unavailable');
  for (let i = 0; i < 60; i++) awake.setActive(true);
  expect(request).toHaveBeenCalledTimes(1);
  awake.retry();
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  awake.dispose();
});

test('hidden pages cannot request a wake lock and an OS release remains recoverable', async () => {
  const document = { hidden: true };
  const lock = sentinel();
  const request = vi.fn().mockResolvedValueOnce(lock).mockResolvedValueOnce(sentinel());
  const onState = vi.fn();
  const awake = createScreenAwake({ navigator: { wakeLock: { request } }, document, onState });
  awake.setActive(true);
  expect(request).not.toHaveBeenCalled();
  document.hidden = false;
  awake.setActive(true);
  await settle();
  lock.expire();
  expect(onState).toHaveBeenLastCalledWith('released');
  expect(request).toHaveBeenCalledTimes(1);
  awake.retry();
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  awake.dispose();
});

function experience({ reduced = false, supported = true } = {}) {
  const animations = [];
  const animate = vi.fn(() => { const animation = { cancel: vi.fn() }; animations.push(animation); return animation; });
  const visual = { style: { setProperty: vi.fn() }, animate: vi.fn(() => ({ cancel: vi.fn() })) };
  const navigator = supported ? { vibrate: vi.fn(() => true), userActivation: { hasBeenActive: true } } : {};
  const document = { hidden: false };
  const reducedMotion = { matches: reduced };
  const feedback = createPhoneFeedback({ visual, object: { animate }, navigator, document, reducedMotion });
  feedback.setActive(true);
  return { feedback, visual, navigator, document, animate, animations, reducedMotion };
}

test('visual motion follows bounded real sensor rates and stops when play pauses', () => {
  const { feedback, visual } = experience();
  feedback.motion({ rotationBeta: 220, rotationGamma: -175 }, 100);
  expect(visual.style.setProperty).toHaveBeenCalledWith('--motion-angle', '10.0deg');
  expect(visual.style.setProperty).toHaveBeenCalledWith('--motion-shift', '-5.0px');
  feedback.motion({ rotationBeta: 9999, rotationGamma: -9999 }, 140);
  expect(visual.style.setProperty).toHaveBeenCalledWith('--motion-angle', '28.0deg');
  expect(visual.style.setProperty).toHaveBeenCalledWith('--motion-shift', '-12.0px');
  feedback.setActive(false);
  visual.style.setProperty.mockClear();
  feedback.motion({ rotationBeta: 220 }, 200);
  expect(visual.style.setProperty).not.toHaveBeenCalled();
});

test('tennis swing and delivery feedback do not vibrate; confirmed contact does once', () => {
  const { feedback, navigator, animate } = experience();
  feedback.swing('Backhand');
  feedback.delivered('swing');
  expect(animate).toHaveBeenCalledTimes(1);
  expect(navigator.vibrate).not.toHaveBeenCalled();
  feedback.hit(100);
  feedback.hit(110);
  expect(navigator.vibrate).toHaveBeenCalledExactlyOnceWith(28);
});

test('accepted bowling delivery animates toward the TV and pause cancels feedback', () => {
  const { feedback, navigator, animate, animations } = experience();
  feedback.delivered('roll');
  expect(animate.mock.calls[0][0]).toContainEqual(expect.objectContaining({ transform: 'translateY(-110px) scale(.18)' }));
  expect(navigator.vibrate).toHaveBeenCalledWith(18);
  feedback.setActive(false);
  expect(animations[0].cancel).toHaveBeenCalledTimes(1);
  expect(navigator.vibrate).toHaveBeenLastCalledWith(0);
  feedback.delivered('roll');
  feedback.hit(200);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(navigator.vibrate).toHaveBeenCalledTimes(2);
});

test('reduced-motion preference skips movement while keeping quiet confirmation feedback', () => {
  const { feedback, visual, animate } = experience({ reduced: true });
  feedback.motion({ rotationBeta: 220 }, 100);
  feedback.swing('Forehand');
  feedback.delivered('roll');
  expect(visual.style.setProperty).not.toHaveBeenCalled();
  expect(animate).not.toHaveBeenCalled();
  expect(visual.animate).toHaveBeenCalledTimes(1);
});

test('unsupported vibration and wake lock are optional, and hidden or unactivated pages cannot pulse', () => {
  const unsupported = experience({ supported: false });
  expect(() => { unsupported.feedback.hit(100); unsupported.feedback.dispose(); }).not.toThrow();
  const onState = vi.fn();
  createScreenAwake({ navigator: {}, document: { hidden: false }, onState }).setActive(true);
  expect(onState).toHaveBeenCalledWith('unavailable');
  const { feedback, navigator, document } = experience();
  navigator.userActivation.hasBeenActive = false;
  feedback.hit(100);
  navigator.userActivation.hasBeenActive = true;
  document.hidden = true;
  feedback.hit(200);
  expect(navigator.vibrate).not.toHaveBeenCalled();
});
