import {randomUUID} from 'node:crypto';

const LEASE_MS = 3000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => a && b && a.code === b.code && a.gameId === b.gameId &&
  a.generation === b.generation && a.hostEpoch === b.hostEpoch && a.sport === b.sport;
const boundedText = (value, max) => typeof value === 'string' && value.length <= max;

function cleanSignal(payload, role) {
  if (!record(payload) || !boundedText(payload.pairId, 64)) return null;
  if (Object.hasOwn(payload, 'description') === Object.hasOwn(payload, 'candidate')) return null;
  if (Object.hasOwn(payload, 'description')) {
    const value = payload.description;
    if (!record(value) || value.type !== (role === 'host' ? 'offer' : 'answer') ||
        !boundedText(value.sdp, 6500) || !/^v=0\r?\n/.test(value.sdp) ||
        !/^m=application /m.test(value.sdp) || /^m=(?!application )/m.test(value.sdp) ||
        !/^a=fingerprint:/m.test(value.sdp)) return null;
    return {pairId: payload.pairId, description: {type: value.type, sdp: value.sdp}};
  }
  const value = payload.candidate;
  if (value === null) return {pairId: payload.pairId, candidate: null};
  if (!record(value) || !boundedText(value.candidate, 2048) ||
      (value.candidate && !value.candidate.startsWith('candidate:')) ||
      (value.sdpMid !== undefined && value.sdpMid !== null && !boundedText(value.sdpMid, 64)) ||
      (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null &&
        (!Number.isInteger(value.sdpMLineIndex) || value.sdpMLineIndex < 0 || value.sdpMLineIndex > 4)) ||
      (value.usernameFragment !== undefined && value.usernameFragment !== null && !boundedText(value.usernameFragment, 256))) return null;
  return {pairId: payload.pairId, candidate: {candidate: value.candidate,
    ...(value.sdpMid === undefined ? {} : {sdpMid: value.sdpMid}),
    ...(value.sdpMLineIndex === undefined ? {} : {sdpMLineIndex: value.sdpMLineIndex}),
    ...(value.usernameFragment === undefined ? {} : {usernameFragment: value.usernameFragment})}};
}

/** Only current room members can negotiate a transient browser-to-TV channel.
 * No client selects a target socket or supplies its role/player identity.
 * Gameplay admission stays on the TV and is bound to this private lease.
 */
export function createDirectInputBroker({io, store, now = () => performance.now(), leaseMs = LEASE_MS, sweepMs = 250}) {
  const registrations = new Map(), pairs = new Map();
  let stopped = false;
  const reply = (ack, value) => {if (typeof ack === 'function') ack(value);};
  const socketFor = id => io.sockets.sockets.get(id);
  const current = id => socketFor(id)?.connected ? store.directInputContext(id) : null;
  const validRegistration = id => {
    const registered = registrations.get(id), context = current(id);
    return registered && registered.until > now() && same(registered, context) &&
      registered.memberId === context.memberId && registered.role === context.role ? registered : null;
  };
  const closePair = (pair, reason = 'not-playing') => {
    if (!pairs.delete(pair.id)) return;
    for (const id of [pair.host, pair.phone]) socketFor(id)?.emit('direct:closed', {pairId: pair.id, reason});
  };
  const validPair = pair => {
    const host = validRegistration(pair.host), phone = validRegistration(pair.phone);
    return same(host, phone) && same(pair, host) && host.role === 'host' && phone.role === 'player' &&
      phone.player === pair.player && phone.memberId === pair.phoneMember && host.memberId === pair.hostMember;
  };
  const sync = code => {
    // Room changes invalidate their own peers immediately. The periodic sweep
    // checks all rooms once, rather than every room on every peer renewal.
    for (const pair of pairs.values()) if ((!code || pair.code === code) && !validPair(pair)) closePair(pair);
    for (const [id, registered] of registrations) if ((!code || registered.code === code) && !validRegistration(id)) registrations.delete(id);
  };
  const closeSocket = id => {
    registrations.delete(id);
    for (const pair of pairs.values()) if (pair.host === id || pair.phone === id) closePair(pair, 'disconnected');
  };
  const onConnection = socket => {
    let tokens = 80, at = now();
    const allowed = () => {
      const time = now(); tokens = Math.min(80, tokens + Math.max(0, time - at) * .02); at = time;
      if (tokens < 1 || stopped) return false;
      tokens--; return true;
    };
    const register = (payload, ack) => {
      if (!allowed()) return reply(ack, {ok:false,error:'rate-limited'});
      const context = current(socket.id);
      const code = context?.code ?? registrations.get(socket.id)?.code;
      if (code) sync(code);
      if (!context || !record(payload) || payload.gameId !== context.gameId ||
          payload.generation !== context.generation || payload.hostEpoch !== context.hostEpoch) {
        if (!context || !same(registrations.get(socket.id), context)) closeSocket(socket.id);
        return reply(ack, {ok:false,error:'not-playing'});
      }
      registrations.set(socket.id, {...context, until: now() + leaseMs});
      reply(ack, {ok:true,leaseMs});
    };
    const open = (payload, ack) => {
      if (!allowed()) return reply(ack, {ok:false,error:'rate-limited'});
      const code = registrations.get(socket.id)?.code;
      if (code) sync(code);
      const phone = validRegistration(socket.id);
      if (!phone || phone.role !== 'player' || !record(payload) || payload.gameId !== phone.gameId ||
          payload.generation !== phone.generation || payload.hostEpoch !== phone.hostEpoch) return reply(ack, {ok:false,error:'not-controller'});
      const existing = [...pairs.values()].find(pair => pair.phone === socket.id);
      if (existing) return reply(ack, {ok:true,pairId:existing.id});
      const target = [...registrations.entries()].find(([id, peer]) => peer.role === 'host' && same(peer, phone) && validRegistration(id));
      if (!target) return reply(ack, {ok:false,error:'host-unavailable'});
      const [hostId, host] = target;
      if ([...pairs.values()].filter(pair => pair.host === hostId).length >= 2) return reply(ack, {ok:false,error:'room-full'});
      const pair = {...phone, id: randomUUID(), phone: socket.id, host: hostId,
        phoneMember: phone.memberId, hostMember: host.memberId, candidates: new Map(), descriptions: new Set()};
      pairs.set(pair.id, pair);
      const info = {pairId:pair.id, player:phone.player, gameId:phone.gameId, generation:phone.generation,
        hostEpoch:phone.hostEpoch, sport:phone.sport, leaseMs};
      socketFor(hostId)?.emit('direct:peer', {...info,role:'host'});
      socket.emit('direct:peer', {...info,role:'player'});
      reply(ack, {ok:true,pairId:pair.id});
    };
    const signal = (payload, ack) => {
      if (!allowed()) return reply(ack, {ok:false,error:'rate-limited'});
      const pair = record(payload) && pairs.get(payload.pairId);
      if (!pair || (pair.host !== socket.id && pair.phone !== socket.id)) return reply(ack, {ok:false,error:'unknown-peer'});
      if (!validPair(pair)) {closePair(pair);return reply(ack, {ok:false,error:'unknown-peer'});}
      const clean = cleanSignal(payload, pair.phone === socket.id ? 'player' : 'host');
      if (!clean) return reply(ack, {ok:false,error:'bad-signal'});
      if (clean.description) {
        if (pair.descriptions.has(socket.id)) return reply(ack, {ok:false,error:'already-signaled'});
        pair.descriptions.add(socket.id);
      } else {
        const count = (pair.candidates.get(socket.id) || 0) + 1;
        if (count > 64) return reply(ack, {ok:false,error:'rate-limited'});
        pair.candidates.set(socket.id, count);
      }
      socketFor(pair.phone === socket.id ? pair.host : pair.phone)?.emit('direct:signal', clean);
      reply(ack, {ok:true});
    };
    const close = (payload, ack) => {
      if (!allowed()) return reply(ack, {ok:false,error:'rate-limited'});
      const pair = record(payload) && pairs.get(payload.pairId);
      if (pair && (pair.host === socket.id || pair.phone === socket.id)) {
        closePair(pair, 'closed'); reply(ack, {ok:true});
      } else reply(ack, {ok:false,error:'unknown-peer'});
    };
    const unregister = (payload, ack) => {
      if (!allowed()) return reply(ack, {ok:false,error:'rate-limited'});
      const registered = registrations.get(socket.id);
      if (!registered || !record(payload) || registered.gameId !== payload.gameId ||
          registered.generation !== payload.generation || registered.hostEpoch !== payload.hostEpoch) return reply(ack, {ok:false,error:'not-playing'});
      closeSocket(socket.id); reply(ack, {ok:true});
    };
    socket.on('direct:register', register); socket.on('direct:open', open);
    socket.on('direct:signal', signal); socket.on('direct:close', close);
    socket.on('direct:unregister', unregister);
    socket.once('disconnect', () => closeSocket(socket.id));
  };
  io.on('connection', onConnection);
  const timer = setInterval(sync, sweepMs); timer.unref?.();
  return {sync, close() {
    if (stopped) return;
    stopped = true; clearInterval(timer); io.off('connection', onConnection);
    for (const pair of pairs.values()) closePair(pair, 'server-shutting-down');
    registrations.clear();
  }};
}
