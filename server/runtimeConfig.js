import {isIP} from 'node:net';
import {securePhoneOrigin} from './phoneLink.js';

function localHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  // Only globally routable IPv6 unicast addresses belong in a public QR URL.
  if (isIP(host) === 6) return !/^[23][0-9a-f]{3}:/.test(host);
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(host) || !host.includes('.')) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export function runtimeConfig(env = process.env, {production = false} = {}) {
  const port = Number(env.PORT ?? 5173);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || env.PORT === '') throw new Error('PORT must be an integer from 0 to 65535');
  const configured = env.PUBLIC_GAME_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    (!production && (env.VITE_PUBLIC_URL || (env.NGROK_HOST ? `https://${env.NGROK_HOST}` : '')));
  const publicOrigin = securePhoneOrigin(configured);
  if (configured && (!publicOrigin || (production && localHostname(new URL(publicOrigin).hostname)))) {
    throw new Error('The public phone URL must be an HTTPS origin without credentials, paths or local addresses');
  }
  const origins = (env.CLIENT_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let valid = false;
    try { const url = new URL(origin); valid = ['http:', 'https:'].includes(url.protocol) && url.origin === origin; } catch { /* Invalid URLs fail configuration below. */ }
    if (!valid) throw new Error('CLIENT_ORIGIN must contain comma-separated HTTP(S) origins without paths or credentials');
  }
  if (publicOrigin && !origins.includes(publicOrigin)) origins.push(publicOrigin);
  return {port, publicOrigin, origins};
}
