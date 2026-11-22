import {isRoomCode} from '@wee/shared/protocol.js';

/** Accept only room links, never arbitrary URLs or QR-supplied redirects. */
export function scannedRoom(value, currentOrigin) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const plain = value.trim().toUpperCase();
  if (value.trim().length === 4 && isRoomCode(plain)) return `${currentOrigin}/join?code=${plain}`;
  try {
    const link = new URL(value);
    if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password ||
      link.pathname !== '/join' || link.searchParams.getAll('code').length !== 1) return null;
    const code = (link.searchParams.get('code') || '').trim().toUpperCase();
    if (!isRoomCode(code)) return null;
    const target = new URL('/join', link.origin);
    target.searchParams.set('code', code);
    return target.href;
  } catch { return null; }
}

/** Camera and decoder exist only during an explicitly opened scan session. */
export function startRoomCamera(video, {onCode, onError, onReady}) {
  let cancelled = false, stream = null, frame = 0, lastScan = 0;
  const stop = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  const fail = error => {
    if (cancelled) return;
    stop();
    onError(error.name === 'NotAllowedError' ? 'Camera access is off. Enter the TV code here, or allow the camera in your browser and try again.'
      : 'The camera couldn’t start. Enter the TV code here.');
  };
  (async () => {
    if (globalThis.isSecureContext === false) {
      stop(); onError('Scanning needs a secure connection. Use your phone’s Camera app to scan the TV, or enter its code here.'); return;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
    if (cancelled) {stream.getTracks().forEach(track => track.stop()); return;}
    video.srcObject = stream;
    await video.play();
    if (cancelled) return;
    let detector = null, decode = null;
    if (typeof BarcodeDetector !== 'undefined') {
      try {detector = new BarcodeDetector({formats: ['qr_code']});} catch { /* Use the shared browser fallback. */ }
    }
    if (!detector) decode = (await import('jsqr')).default;
    if (cancelled) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', {willReadFrequently: true});
    onReady();
    const tick = async now => {
      if (cancelled) return;
      if (document.hidden) {stop(); return;}
      if (now - lastScan >= 140 && video.readyState >= 2) {
        lastScan = now;
        let code = null;
        try {
          if (detector) code = (await detector.detect(video))[0]?.rawValue;
          else {
            canvas.width = Math.min(640, video.videoWidth);
            canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
            if (canvas.width && canvas.height) {
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const image = context.getImageData(0, 0, canvas.width, canvas.height);
              code = decode(image.data, image.width, image.height, {inversionAttempts: 'dontInvert'})?.data;
            }
          }
        } catch (error) {
          // Some browsers expose BarcodeDetector but cannot decode video.
          // Switch once to the portable decoder instead of failing every frame.
          if (detector) {
            detector = null;
            try {decode = (await import('jsqr')).default;} catch (error) {fail(error); return;}
          } else {fail(error); return;}
        }
        if (!cancelled && code && onCode(code)) {stop(); return;}
      }
      if (!cancelled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  })().catch(fail);
  return stop;
}
