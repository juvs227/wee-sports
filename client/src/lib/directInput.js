import {isSwing, isStrokeResult} from '../../../shared/protocol.js';

const LEASE_MS = 3000, REGISTER_MS = 1000, CONNECT_MS = 6500;
const PING_MS = 500, HEALTH_MS = 1600, PACKET_AGE_MS = 160, ACK_MS = 1200;
const SWING_AGE_MS = 250;
const MAX_BYTES = 4096;
const events = {register:'direct:register', open:'direct:open', peer:'direct:peer',
  signal:'direct:signal', closed:'direct:closed', close:'direct:close', unregister:'direct:unregister'};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => Number.isFinite(value) && value >= 0;
const envelope = value => ({gameId:value.gameId,generation:value.generation,hostEpoch:value.hostEpoch,
  ...(value.player === undefined ? {} : {player:value.player})});
const cleanSwing = value => ({...envelope(value),type:'swing',id:value.id,label:value.label,hand:value.hand,
  ...(value.power === undefined ? {} : {power:value.power}),...(value.aim === undefined ? {} : {aim:value.aim}),
  ...(value.depth === undefined ? {} : {depth:value.depth})});


/** Optional same-network input. The server grants room-scoped peer identities;
 * the TV remains the game authority. No media permission, external ICE service,
 * replay queue, automatic action retry, or bowling delivery is involved. */
export function createDirectInput({socket, context, onSwing = () => false,
  onStrokeResult = () => {}, diagnostics,
  PeerConnection = globalThis.RTCPeerConnection, now = () => performance.now()} = {}) {
  const unavailable = {sendSwing:() => null, sendStrokeResult:() => false, dispose() {}};
  if (typeof PeerConnection !== 'function' || !['host','player'].includes(context?.role) ||
      !['tennis'].includes(context.sport) || !context.gameId) return unavailable;
  const scope = {gameId:context.gameId, generation:context.generation, hostEpoch:context.hostEpoch};
  const peers = new Map();
  let disposed = false, leaseUntil = 0, lastRegister = -Infinity, registrationPending = false;
  let openPending = false, lastOpen = -Infinity, pingSequence = 0, failedNegotiations = 0, nextOpenAt = 0;
  const count = key => diagnostics?.count?.('direct.' + key);
  // A polling POST occupies the transport for a whole HTTP round trip. Optional
  // lease renewals must not block the bounded, time-sensitive swing relay.
  // Recheck on each tick so a later WebSocket upgrade enables direct input.
  const canNegotiate = () => socket.io?.engine?.transport?.name === 'websocket';
  const active = () => !disposed && socket.connected && canNegotiate() && now() < leaseUntil;
  const matches = value => value?.gameId === scope.gameId && value.generation === scope.generation && value.hostEpoch === scope.hostEpoch;
  const admitInput = (peer, kind, at) => {
    const bucket = peer[kind + 'Bucket'], capacity = kind === 'swing' ? 20 : 6, rate = kind === 'swing' ? .01 : .06;
    bucket.tokens = Math.min(capacity,bucket.tokens+Math.max(0,at-bucket.at)*rate); bucket.at = at;
    if (bucket.tokens < 1) {count('rateDropped'); return false;}
    bucket.tokens--; return true;
  };
  const control = (event, payload, callback) => {
    if (disposed || !socket.connected || !canNegotiate()) return false;
    socket.timeout(1200).emit(event, payload, (error, result) => {
      if (!disposed) callback?.(error ? {ok:false,error:'timeout'} : result);
    });
    return true;
  };
  function closePeer(peer, notify = true) {
    if (!peer || peer.closed) return;
    if (context.role === 'player' && peer.lastPong === -Infinity) {
      failedNegotiations++;
      nextOpenAt = now() + Math.min(60000,5000 * 2 ** Math.min(failedNegotiations-1,4));
      count('negotiationUnavailable');
    }
    peer.closed = true; peers.delete(peer.id);
    for (const pending of peer.pending.values()) {
      clearTimeout(pending.timer); pending.resolve({ok:false,error:'outcome-unknown',id:pending.id});
    }
    peer.pending.clear(); peer.results.clear();
    peer.channel?.close(); peer.pc.close();
    if (notify && socket.connected && !disposed) control(events.close, {pairId:peer.id,...scope});
    count('closed');
  }
  const channelOpen = peer => active() && !peer.closed && peer.channel?.readyState === 'open';
  const channelWritable = peer => channelOpen(peer) && peer.channel.bufferedAmount === 0;
  const healthy = peer => channelOpen(peer) && peer.clockOffset !== null && peer.remoteReady && now() - peer.lastPong <= HEALTH_MS;
  function send(peer, packet, input = false) {
    if (!channelWritable(peer) || (input && !healthy(peer))) return false;
    let encoded;
    try {encoded = JSON.stringify({v:1,at:now(),...packet});} catch {return false;}
    if (encoded.length > MAX_BYTES) return false;
    try {peer.channel.send(encoded); return true;} catch {closePeer(peer); return false;}
  }
  function ping(peer) {
    if (!channelWritable(peer)) return;
    const id = ++pingSequence, sent = now();
    if (send(peer, {kind:'ping',id})) {
      peer.pings.set(id,sent); peer.lastPing = sent;
      for (const [key, at] of peer.pings) if (sent-at > HEALTH_MS) peer.pings.delete(key);
    }
  }
  function bindChannel(peer, channel) {
    if (peer.channel || channel.label !== 'wee-input-v1') {channel.close(); return;}
    peer.channel = channel;
    channel.onopen = () => {count('opened'); ping(peer);};
    channel.onclose = () => closePeer(peer);
    channel.onerror = () => closePeer(peer);
    channel.onmessage = event => receive(peer, event.data);
    if (channel.readyState === 'open') ping(peer);
  }
  function receive(peer, raw) {
    if (!active() || peer.closed || typeof raw !== 'string' || raw.length > MAX_BYTES) return;
    let packet;
    try {packet = JSON.parse(raw);} catch {return;}
    if (!object(packet) || packet.v !== 1 || !finite(packet.at)) return;
    const received = now(), elapsed = Math.max(0,received-peer.rateAt);
    peer.tokens = Math.min(160, peer.tokens + elapsed * .12); peer.rateAt = received;
    if (peer.tokens < 1) {count('rateDropped'); return;}
    peer.tokens--;
    if (packet.kind === 'ping' && Number.isSafeInteger(packet.id)) {
      send(peer,{kind:'pong',id:packet.id,remoteAt:received}); return;
    }
    if (packet.kind === 'pong' && finite(packet.remoteAt)) {
      const sent = peer.pings.get(packet.id);
      if (sent === undefined) return;
      peer.pings.delete(packet.id);
      const rtt = received-sent;
      if (rtt < 0 || rtt > PACKET_AGE_MS) return;
      peer.lastPong = received;
      failedNegotiations = 0; nextOpenAt = 0;
      if (peer.clockOffset === null || rtt <= peer.bestRtt + 2 || received-peer.clockAt > 30000) {
        peer.clockOffset = packet.remoteAt-(sent+received)/2; peer.bestRtt = rtt; peer.clockAt = received;
      }
      diagnostics?.observe?.('direct.roundTripMs',rtt);
      send(peer,{kind:'ready'}); return;
    }
    if (packet.kind === 'ready') {peer.remoteReady = true; return;}
    if (!healthy(peer)) return;
    // These clocks are aligned by local ping/pong, never by comparing device
    // wall clocks. Include half the best RTT as the clock estimate uncertainty.
    const age = received-(packet.at-peer.clockOffset);
    // Discrete strokes must survive a short TV frame stall, just as the server
    // route does. Pose samples can be superseded; a swing cannot. Both remain
    // bounded so a reliable-channel retransmit cannot play an old action.
    const maxAge = context.sport === 'tennis' ? SWING_AGE_MS : PACKET_AGE_MS;
    if (age > maxAge + peer.bestRtt/2 || age < -PACKET_AGE_MS) {
      count('staleDropped');
      if (context.role === 'host' && context.sport === 'tennis' && packet.kind === 'swing' &&
          object(packet.event) && matches(packet.event) && isSwing(packet.event)) {
        send(peer,{kind:'ack',id:packet.event.id,result:{ok:false,error:'input-expired'}});
      }
      return;
    }
    if (context.role === 'host' && packet.kind === 'swing') {
      if (!object(packet.event) || !matches(packet.event)) return;
      // The authenticated broker assigned this player; the packet cannot select
      // a different controller, match, host or input generation.
      const event = {...packet.event, ...scope, player:peer.player};
      if (packet.kind === 'swing' && context.sport === 'tennis' && isSwing(event)) {
        const cached = peer.swings.get(event.id);
        if (cached) {send(peer,{kind:'ack',id:event.id,result:cached}); return;}
        if (!admitInput(peer,'swing',received)) {send(peer,{kind:'ack',id:event.id,result:{ok:false,error:'rate-limited'}}); return;}
        // Make result correlation available before forwarding, including a
        // synchronous test/game callback. Keep this bounded and transient.
        peer.results.set(event.id,received+5000);
        const accepted = onSwing(cleanSwing(event)) === true;
        const result = accepted ? {ok:true,id:event.id,receivers:1} : {ok:false,error:'not-playing',id:event.id};
        if (!accepted) peer.results.delete(event.id);
        peer.swings.set(event.id,result);
        if (peer.swings.size > 128) peer.swings.delete(peer.swings.keys().next().value);
        count(accepted ? 'swingReceived' : 'swingRejected');
        send(peer,{kind:'ack',id:event.id,result});
      }
    } else if (context.role === 'player' && packet.kind === 'ack' && typeof packet.id === 'string' && typeof packet.result?.ok === 'boolean') {
      const pending = peer.pending.get(packet.id);
      if (!pending) return;
      clearTimeout(pending.timer); peer.pending.delete(packet.id);
      if (!packet.result.ok) peer.results.delete(packet.id);
      pending.resolve(packet.result.ok ? {ok:true,id:packet.id,receivers:1}
        : {ok:false,id:packet.id,error:['rate-limited','input-expired'].includes(packet.result.error) ? packet.result.error : 'not-playing'});
    } else if (context.role === 'player' && packet.kind === 'result' && isStrokeResult(packet.event) &&
        packet.event.gameId === scope.gameId && packet.event.player === peer.player && peer.results.has(packet.event.id)) {
      peer.results.delete(packet.event.id); onStrokeResult(packet.event);
    }
  }
  async function signal(payload) {
    const peer = peers.get(payload?.pairId);
    if (!active() || !peer || peer.closed) return;
    try {
      if (payload.description) {
        if (payload.description.type !== (context.role === 'host' ? 'answer' : 'offer') ||
            typeof payload.description.sdp !== 'string' || payload.description.sdp.length > 6500) return;
        await peer.pc.setRemoteDescription(payload.description);
        if (!active() || peer.closed) return;
        for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        if (context.role === 'player') {
          const answer = await peer.pc.createAnswer();
          if (!active() || peer.closed) return;
          await peer.pc.setLocalDescription(answer);
          if (active() && !peer.closed) control(events.signal,{pairId:peer.id,description:{type:answer.type,sdp:answer.sdp}});
        }
      } else if (Object.hasOwn(payload,'candidate')) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(payload.candidate);
        else if (peer.candidates.length < 64) peer.candidates.push(payload.candidate);
      }
    } catch {closePeer(peer);}
  }
  async function pair(payload) {
    if (!active() || !matches(payload) || payload.role !== context.role || payload.sport !== context.sport ||
        ![1,2].includes(payload.player) || typeof payload.pairId !== 'string' || payload.pairId.length > 100 ||
        (context.role === 'player' && payload.player !== context.player)) return;
    if (peers.has(payload.pairId)) return;
    for (const peer of peers.values()) if (peer.player === payload.player) closePeer(peer);
    if (peers.size >= (context.role === 'host' ? 2 : 1)) return;
    let pc;
    try {pc = new PeerConnection({iceServers:[]});} catch {
      count('unsupported'); control(events.close,{pairId:payload.pairId,...scope}); dispose(); return;
    }
    const peer = {id:payload.pairId,player:payload.player,pc,closed:false,channel:null,candidates:[],created:now(),
      pending:new Map(),results:new Map(),swings:new Map(),pings:new Map(),lastSequence:-1,
      clockOffset:null,bestRtt:Infinity,clockAt:0,lastPong:-Infinity,lastPing:-Infinity,remoteReady:false,tokens:160,rateAt:now(),
      swingBucket:{tokens:20,at:now()}};
    peers.set(peer.id,peer);
    pc.onicecandidate = event => {if (!peer.closed && active()) control(events.signal,{pairId:peer.id,candidate:event.candidate?.toJSON?.() ?? null});};
    pc.onconnectionstatechange = () => {if (['failed','closed','disconnected'].includes(pc.connectionState)) closePeer(peer);};
    pc.ondatachannel = event => bindChannel(peer,event.channel);
    if (context.role === 'host') {
      try {
        // Discrete swings can retransmit; the receiver enforces freshness and
        // deduplication. Unordered delivery avoids blocking the next swing.
        bindChannel(peer,pc.createDataChannel('wee-input-v1',{ordered:false}));
        const offer = await pc.createOffer();
        if (!active() || peer.closed) return;
        await pc.setLocalDescription(offer);
        if (active() && !peer.closed) control(events.signal,{pairId:peer.id,description:{type:offer.type,sdp:offer.sdp}});
      } catch {closePeer(peer);}
    }
  }
  const closed = payload => closePeer(peers.get(payload?.pairId),false);
  function renew() {
    if (disposed || !socket.connected || !canNegotiate() || registrationPending) return;
    registrationPending = true; lastRegister = now();
    // Grant age is measured from request start, not a delayed reply arrival.
    const requestedAt = now();
    control(events.register,scope,result => {
      registrationPending = false;
      if (result?.ok) leaseUntil = requestedAt + Math.min(LEASE_MS,result.leaseMs || LEASE_MS);
      else {leaseUntil = 0; for (const peer of peers.values()) closePeer(peer);}
    });
  }
  function tick() {
    if (disposed) return;
    const time = now();
    if (!socket.connected) {dispose(); return;}
    if (!canNegotiate()) {
      leaseUntil = 0; lastRegister = -Infinity;
      for (const peer of peers.values()) closePeer(peer,false);
      failedNegotiations = 0; nextOpenAt = 0;
      return;
    }
    if (time-lastRegister >= REGISTER_MS) renew();
    if (!active()) {for (const peer of peers.values()) closePeer(peer); return;}
    for (const peer of peers.values()) {
      for (const [id,until] of peer.results) if (until < time) peer.results.delete(id);
      if (time-peer.created > CONNECT_MS && !healthy(peer)) {closePeer(peer); continue;}
      if (time-peer.lastPing >= PING_MS) ping(peer);
    }
    if (context.role === 'player' && peers.size === 0 && !openPending && time >= nextOpenAt && time-lastOpen >= REGISTER_MS) {
      openPending = true; lastOpen = time;
      control(events.open,scope,result => {
        openPending = false;
        if (!result?.ok) {
          failedNegotiations++;
          nextOpenAt = now() + Math.min(30000,1000 * 2 ** Math.min(failedNegotiations-1,5));
        }
      });
    }
  }
  function sendSwing(event) {
    const peer = [...peers.values()][0];
    if (context.role !== 'player' || context.sport !== 'tennis' || !peer || !healthy(peer) || !matches(event) || !isSwing(event)) return null;
    if (peer.pending.has(event.id) || peer.results.has(event.id)) return Promise.resolve({ok:false,error:'duplicate-swing',id:event.id});
    if (peer.pending.size >= 32 || peer.results.size >= 128) return Promise.resolve({ok:false,error:'rate-limited',id:event.id});
    let resolve;
    const result = new Promise(done => {resolve = done;});
    const pending = {id:event.id,resolve,timer:setTimeout(() => {
      peer.pending.delete(event.id); resolve({ok:false,error:'outcome-unknown',id:event.id});
    },ACK_MS)};
    peer.pending.set(event.id,pending); peer.results.set(event.id,now()+5000);
    if (!send(peer,{kind:'swing',event:cleanSwing(event)},true)) {
      clearTimeout(pending.timer); peer.pending.delete(event.id); peer.results.delete(event.id);
      return null;
    }
    count('swingSent'); return result;
  }

  function sendStrokeResult(event) {
    if (context.role !== 'host' || !isStrokeResult(event) || event.gameId !== scope.gameId) return false;
    const peer = [...peers.values()].find(value => value.player === event.player && value.results.has(event.id));
    if (!peer || !send(peer,{kind:'result',event},true)) return false;
    peer.results.delete(event.id); return true;
  }
  function dispose() {
    if (disposed) return;
    if (socket.connected && canNegotiate()) control(events.unregister,scope);
    for (const peer of peers.values()) closePeer(peer);
    disposed = true; leaseUntil = 0; clearInterval(timer);
    socket.off(events.peer,pair); socket.off(events.signal,signal); socket.off(events.closed,closed); socket.off('disconnect',dispose);
  }
  socket.on(events.peer,pair); socket.on(events.signal,signal); socket.on(events.closed,closed); socket.on('disconnect',dispose);
  const timer = setInterval(tick,250);
  renew();
  return {sendSwing,sendStrokeResult,dispose};
}
