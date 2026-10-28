/** Only an actual HTTPS origin can be advertised as the sensor-capable phone link. */
export function securePhoneOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function phoneLinkHandler(origin, next) {
  const publicOrigin = securePhoneOrigin(origin);
  return (request, response) => {
    const path = request.url?.split('?')[0];
    response.setHeader('Permissions-Policy', 'accelerometer=(self), gyroscope=(self), fullscreen=(self)');
    if (path === '/api/phone-link') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ origin: publicOrigin }));
      return;
    }
    // Old LAN QR links can recover too. Redirect the phone's whole join page
    // so its controller iframe and Socket.io connection keep the same origin.
    const fromTunnel = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
      && request.headers['x-forwarded-proto'] === 'https';
    if (publicOrigin && !fromTunnel && (path === '/join' || path === '/controller.html')) {
      response.writeHead(307, { location: `${publicOrigin}${request.url}`, 'cache-control': 'no-store' });
      response.end();
      return;
    }
    next(request, response);
  };
}
