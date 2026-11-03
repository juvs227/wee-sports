/* global __LAN_HOST__ */

/**
 * The URL a phone opens to join. Phones can't reach "localhost", so a TV page
 * running on localhost points its QR code at the laptop's Wi-Fi address
 * (found by vite.config.js) instead.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LAN_HOST = typeof __LAN_HOST__ === 'string' ? __LAN_HOST__ : null;

function onLocalhost() {
  return LOCAL_HOSTS.has(window.location.hostname);
}

export function joinOrigin(runtimeOrigin) {
  if (runtimeOrigin) return runtimeOrigin.replace(/\/$/, '');
  const configured = import.meta.env.VITE_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');
  const { protocol, port, origin } = window.location;
  if (onLocalhost() && LAN_HOST) return `${protocol}//${LAN_HOST}${port ? `:${port}` : ''}`;
  return origin;
}

export function joinUrl(code, runtimeOrigin) {
  return `${joinOrigin(runtimeOrigin)}/join?code=${code}`;
}

/** False only when the QR would point at localhost, which no phone can open. */
export function canReachFromPhones() {
  return Boolean(import.meta.env.VITE_PUBLIC_URL) || !onLocalhost() || Boolean(LAN_HOST);
}
