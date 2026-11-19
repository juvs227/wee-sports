import {fetchJson} from '../../../src/network/fetchJson.js';

export async function profileRequest(path = '', {method = 'GET', body, signal} = {}) {
  const {response, data} = await fetchJson(`/api/profile${path}`, {method, signal, credentials: 'same-origin',
    ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})});
  if (!response.ok) { const error = new Error(data.error || 'profile-unavailable'); error.status = response.status; throw error; }
  return data;
}

/** Keep a guest's private ownership proof out of public QR links and URLs. */
export function rememberGuestClaim(claim) {
  if (typeof claim !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(claim)) return;
  try {
    const existing = JSON.parse(sessionStorage.getItem('wee.guestClaims') || '[]');
    const claims = Array.isArray(existing) ? existing.filter(value => typeof value === 'string') : [];
    sessionStorage.setItem('wee.guestClaims', JSON.stringify([...new Set([...claims, claim])].slice(-20)));
  } catch { /* Guest play must work without browser storage. */ }
}

export async function claimGuestHistory({signal} = {}) {
  let claims;
  try { claims = JSON.parse(sessionStorage.getItem('wee.guestClaims') || '[]'); } catch { return; }
  if (!Array.isArray(claims)) return;
  const pending = [];
  for (let index = 0; index < claims.length; index++) {
    try { await profileRequest('/claim', {method: 'POST', body: {claim: claims[index]}, signal}); }
    catch (error) {
      if (error.status === 403) continue;
      // One unavailable connection must not consume a full timeout per claim.
      pending.push(...claims.slice(index)); break;
    }
  }
  try { sessionStorage.setItem('wee.guestClaims', JSON.stringify(pending)); } catch { /* Optional storage. */ }
}

export function captureGuestClaim(socket) {
  if (!socket?.connected) return;
  socket.timeout(2500).emit('profile:claim-token', {}, (error, result) => {
    if (!error && result?.ok) rememberGuestClaim(result.claim);
  });
}
