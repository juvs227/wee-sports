/** Browsers send Origin on both polling and WebSocket handshakes. Native
 * controllers may omit it; room credentials still authorize every action. */
export function isAllowedOrigin(request, origins = []) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
    return url.host === request.headers.host || origins.includes(origin);
  } catch { return false; }
}
