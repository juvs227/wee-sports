import { useEffect, useRef, useState } from 'react';
import {EVENTS, isRoll, isSwing, isGameHit, isTennisState, isBowlingState, isStrokeResult, isGameSoundEvent, isGameCommand, isGameOptions, isAim} from '@wee/shared/protocol.js';
import { request, requestSwing, requestRoll, socket, useConnection } from '../lib/socket.js';
import { createInputId } from '../../../src/network/inputId.js';
import {createControllerSetupRelay} from '../lib/controllerSetupRelay.js';
import {browserDiagnostics, DIAGNOSTICS_PROBE} from '../../../shared/diagnostics.js';
import {createDirectInput} from '../lib/directInput.js';

const NO_PLAYERS = [];
/** Authenticated bridge between the lobby and an isolated WebGL game/controller.
 * Owns input delivery, lifecycle gating, checkpoint recovery, and feedback.
 */
export function GameFrame({ code, controller = false, controllerIntent = null, onControllerMode, player = 1, players = NO_PLAYERS, sport = 'tennis', gameId, gameState, generation = 0, hostEpoch = 1, matchRound = 0, playing = true, paused = false, manuallyPaused = false, showPause = paused, pauseMessage, onAudio, onPauseToggle, onSwing }) {
  const frame = useRef(null);
  const diagnosticScope = `bridge.${controller ? 'phone' : 'tv'}.${sport}`;
  const diagnosticRef = useRef(null);
  if (diagnosticRef.current?.scope !== diagnosticScope) diagnosticRef.current = {scope: diagnosticScope, value: browserDiagnostics(diagnosticScope)};
  const diagnostics = diagnosticRef.current.value;
  const ready = useRef(false);
  const pending = useRef(new Map());
  const pendingCommands = useRef(new Map());
  const checkpointRevision = useRef(0);
  const checkpointKey = useRef('');
  const checkpointQueue = useRef(Promise.resolve());
  const recovering = useRef(!controller);
  const recoveryRequest = useRef(null);
  const [saveIssue, setSaveIssue] = useState('');
  const stateKey = `${gameId}:${matchRound}`;
  if (checkpointKey.current !== stateKey) {checkpointKey.current = stateKey; checkpointRevision.current = 0;}
  const currentControl = useRef('');
  currentControl.current = `${gameId}:${generation}:${hostEpoch}`;
  const currentGame = useRef(gameId);
  const inputGeneration = useRef(0);
  currentGame.current = gameId;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(1050);
  const connection = useConnection();
  const directInput = useRef(null), directHandlers = useRef({});
  const inputContext = useRef(null);
  const inputKey = `${code}:${sport}:${gameId}:${generation}:${hostEpoch}`;
  inputContext.current = {key: inputKey, active: playing && !paused && connection === 'online'};
  const admittedInputs = useRef(null);
  if (admittedInputs.current?.key !== inputKey) admittedInputs.current = {key: inputKey, swings: new Set()};
  const setupRelay = useRef(null);
  const setupLifecycle = useRef(0);
  if (!setupRelay.current) setupRelay.current = createControllerSetupRelay({
    request: setup => request(EVENTS.PLAYER_SETUP, {setup}),
  });
  useEffect(() => {
    const visibility = () => {if (document.hidden) setupRelay.current.flush();};
    document.addEventListener('visibilitychange', visibility);
    return () => {document.removeEventListener('visibilitychange', visibility); setupRelay.current.reset();};
  }, []);
  const room = `lobby-${code}`;
  // A sport change is a bridge message, not a controller navigation: keep the
  // phone’s sensor permission and verified setup alive for the next game.
  const src = `/${controller ? ('controller') : (sport === 'bowling' ? 'bowling' : 'game')}.html?room=${encodeURIComponent(room)}&lobby=${code}&player=${player}${controller ? '' : `&sport=${sport}`}${diagnostics.enabled ? '&diagnostics=1' : ''}`;
  useEffect(() => {
    if (!playing || paused || connection !== 'online' || !gameId || !['tennis'].includes(sport)) return;
    let peer = null, disposed = false;
    const current = () => !disposed && inputContext.current?.key === inputKey && inputContext.current.active && socket.connected && !document.hidden;
    const close = () => {
      if (directInput.current === peer) directInput.current = null;
      peer?.dispose(); peer = null;
    };
    const connect = () => {
      close();
      if (!current()) return;
      // Negotiate while the game loads. Admission still requires its ready /
      // recovery handshake, and every input shares the server-path dedup gate.
      peer = createDirectInput({socket, context: {role: controller ? 'player' : 'host', code, sport, gameId, generation, hostEpoch, player}, diagnostics,
        onSwing: event => current() ? directHandlers.current.swing?.(event) ?? false : false,

        onStrokeResult: event => {if (current()) directHandlers.current.strokeResult?.(event);},
      });
      directInput.current = peer;
    };
    const visibility = () => {if (document.hidden) close(); else connect();};
    document.addEventListener('visibilitychange', visibility);
    connect();
    return () => {disposed = true; document.removeEventListener('visibilitychange', visibility); close();};
  }, [code, controller, sport, gameId, generation, hostEpoch, player, playing, paused, connection, src, attempt, diagnostics, inputKey]);
  useEffect(() => {
    if (!diagnostics.enabled || connection !== 'online') return;
    let active = true, waiting = false;
    const probe = async () => {
      if (waiting || !socket.connected) return;
      waiting = true;
      const started = performance.now();
      const response = await request(DIAGNOSTICS_PROBE, {enabled: true});
      waiting = false;
      if (!active) return;
      if (response?.ok) {
        diagnostics.observe('serverRoundTripMs', performance.now() - started);
        diagnostics.count(`transport.${response.transport === 'websocket' ? 'websocket' : 'polling'}`);
        diagnostics.remote('serverRelay', response.diagnostics);
      } else diagnostics.count('probeRejected');
    };
    void probe();
    const timer = setInterval(probe, 2000);
    return () => {active = false; clearInterval(timer); if (socket.connected) socket.emit(DIAGNOSTICS_PROBE, {enabled: false});};
  }, [diagnostics, connection]);
  useEffect(() => {setSaveIssue('');}, [stateKey, src, attempt]);
  useEffect(() => {setupLifecycle.current++; setupRelay.current.reset();}, [connection, src, attempt, sport]);
  function publishState() {
    const post = message => frame.current?.contentWindow?.postMessage(message, window.location.origin);
    post({ type: 'wee:lobby-state', paused: paused || connection !== 'online' || (!controller && recovering.current), manuallyPaused, connected: connection === 'online', players, playing, sport, gameId, generation, inputGeneration: generation, hostEpoch });
    if (controller && controllerIntent) post({type:'wee:controller-intent', ...controllerIntent});
    if (controller && sport === 'bowling') post({ type: 'wee:bowling-state', ...gameState,
      canRoll: playing && !paused && connection === 'online' && gameState?.phase === 'ready' && gameState.currentPlayer === player });

    if (controller && sport === 'tennis' && isTennisState(gameState)) {
      post({ type: 'wee:tennis-state', ...gameState, gameId });
    }
  }
  useEffect(() => {
    ready.current = false; recovering.current = !controller; recoveryRequest.current = null;
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => { if (!ready.current) setFailed(true); }, 15000);
    return () => {
      clearTimeout(timer);
      for (const { ack, timer } of pending.current.values()) { clearTimeout(timer); ack({ ok: false, error: 'outcome-unknown' }); }
      pending.current.clear();
    };
  }, [src, attempt]);
  useEffect(() => () => {
    inputGeneration.current++;
    for (const { ack, timer } of pendingCommands.current.values()) {
      clearTimeout(timer); ack({ ok: false, error: 'game-loading' });
    }
    pendingCommands.current.clear();
  }, [src, attempt, gameId, paused, playing, connection]);
  useEffect(() => {
    const post = message => frame.current?.contentWindow?.postMessage(message, window.location.origin);
    const recoverHost = async () => {
      if (controller || !ready.current || !recovering.current || connection !== 'online') return;
          const control = currentControl.current;
          if (recoveryRequest.current === control) return;
          recoveryRequest.current = control;
          const recovery = await request(EVENTS.HOST_RECOVERY, {gameId, hostEpoch});
          if (currentControl.current !== control) return;
          if (!recovery.ok) {setSaveIssue('Could not load saved progress. Reload the TV to retry.'); return;}
          if (recovery.ok && recovery.checkpoint) {
            checkpointRevision.current = recovery.checkpoint.revision;
            setSaveIssue('');
            post({type:'wee:restore-checkpoint',gameId,payload:recovery.checkpoint.payload});
          } else {
            recovering.current = false; publishState();
            setSaveIssue('');
            post({type:'wee:checkpoint-request',gameId});
          }
    };
    const receive = async event => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === 'wee:bridge-ready') {
        const firstReady = !ready.current;
        ready.current = true; setLoading(false); setFailed(false); publishState();
        if (!controller && firstReady) void recoverHost();
      } else if (!controller && data?.type === 'wee:restore-checkpoint-result' && data.gameId === gameId) {
        if (data.ok) {
          recovering.current = false; publishState();
          // A continued profile game has a new durable match identity. Commit
          // its restored boundary even before the player takes another turn.
          post({type:'wee:checkpoint-request',gameId});
        }
        setSaveIssue(data.ok ? '' : 'Could not restore this checkpoint. Return to the lobby to start again.');
      } else if (!controller && data?.type === 'wee:game-checkpoint' && data.gameId === gameId &&
          ['bowling', 'tennis'].includes(sport) && !recovering.current) {
        const key = checkpointKey.current;
        const control = currentControl.current;
        checkpointQueue.current = checkpointQueue.current.catch(() => {}).then(async () => {
          if (key !== checkpointKey.current || control !== currentControl.current) return;
          let result = await request(EVENTS.HOST_CHECKPOINT, {...data, generation, hostEpoch, expectedRevision:checkpointRevision.current});
          if (key !== checkpointKey.current || control !== currentControl.current) return;
          if (result.error === 'revision-conflict') {
            setSaveIssue('Progress changed in another TV session. Reload to recover the saved game.'); return;
          }
          if (result.ok) checkpointRevision.current = result.revision;
          setSaveIssue(result.ok && (result.saved || sport === 'tennis') ? '' : 'Progress is not saved to disk. Keep the TV open.');
        });
      } else if (controller && data?.type === 'wee:player-game-command' && isGameCommand(data.command, sport)) {
        const result = !ready.current || !playing || paused || data.command.gameId !== gameId ? {ok:false,error:'not-playing'}
          : await request(EVENTS.PLAYER_GAME_COMMAND, data.command);
        post({type:'wee:game-command-result',gameId,id:data.command.id,result});
      } else if (!controller && data?.type === 'wee:pause-toggle' && ready.current && playing &&
          connection === 'online' && data.gameId === gameId) {
        onPauseToggle?.();
      } else if (!controller && data?.type === 'wee:game-options' && ready.current &&
          connection === 'online' && data.gameId === gameId && isGameOptions(data, sport)) {
        await request(EVENTS.HOST_GAME_OPTIONS, { gameId, sport,
          ...(sport === 'tennis' ? { settings: data.settings, practice: data.practice, humanOpponent: data.humanOpponent } : (data.practice ? {practice: data.practice} : {})) });
      } else if (!controller && data?.type === 'wee:game-command-result' && data.gameId === gameId &&
          typeof data.result?.ok === 'boolean') {
        const delivery = pendingCommands.current.get(data.id);
        if (delivery) {
          clearTimeout(delivery.timer); pendingCommands.current.delete(data.id);
          delivery.ack({ ok: data.result.ok, ...(data.result.ok ? {} : {
            error: typeof data.result.error === 'string' && data.result.error.length <= 160 ? data.result.error : 'game-loading',
          }) });
        }
      } else if (controller && data?.type === 'wee:player-swing' && isSwing(data.event)) {
        diagnostics.mark(data.event.id, 'sendRequested');
        diagnostics.count('swingRequests');
        const inputGame = data.event.gameId;
        const inputToken = inputGeneration.current;
        const control = currentControl.current;
        let result = !ready.current || !playing || sport !== 'tennis' || !gameId || inputGame !== gameId
          ? { ok: false, error: 'not-playing' }
          : paused || connection !== 'online' ? { ok: false, error: 'paused' } : null;
        if (!result) {
          const envelope = {...data.event, generation, hostEpoch};
          const direct = directInput.current?.sendSwing(envelope);
          diagnostics.count(direct ? 'swingRoute.direct' : 'swingRoute.server');
          // Only an unsent action may fall back. A missing direct ACK is an
          // unknown outcome, never permission to send the same stroke twice.
          result = direct ? await direct : await requestSwing(EVENTS.PLAYER_SWING, envelope,
            () => currentGame.current === inputGame && inputGeneration.current === inputToken && currentControl.current === control);
        }
        diagnostics.mark(data.event.id, 'deliveryAck');
        diagnostics.measure(data.event.id, 'sendRequested', 'deliveryAck', 'swingDeliveryRoundTripMs');
        diagnostics.count(result?.ok ? 'swingDelivered' : 'swingRejected');
        // A late acknowledgement belongs to the old controller game, not its replacement.
        if (currentGame.current === gameId && currentControl.current === control) post({ type: 'wee:swing-ack', gameId: inputGame, result: { ...result, id: data.event.id } });
      } else if (controller && data?.type === 'wee:player-aim') {
        if (!ready.current || !playing || paused || connection !== 'online' || !socket.connected) return;
        const envelope = {...data.event, seq: data.event?.seq ?? data.event?.sequence, gameId, generation, hostEpoch};

        if (data.type === 'wee:player-aim' && sport === 'bowling' && isAim(envelope)) socket.volatile.emit(EVENTS.PLAYER_AIM, envelope);
      } else if (controller && data?.type === 'wee:player-roll' && isRoll(data.event)) {
        const control = currentControl.current;
        const inputToken = inputGeneration.current;
        diagnostics.mark(data.event.id, 'rollSendRequested');
        diagnostics.count('rollRequests');
        const result = paused || connection !== 'online' ? { ok: false, error: 'paused' }
          : !ready.current || !playing || sport !== 'bowling' || data.event.gameId && data.event.gameId !== gameId ? {ok:false,error:'not-playing'}
          : await requestRoll(EVENTS.PLAYER_ROLL, {...data.event, gameId, generation, hostEpoch},
            () => currentControl.current === control && inputGeneration.current === inputToken && currentGame.current === gameId);
        diagnostics.mark(data.event.id, 'rollDeliveryAck');
        diagnostics.measure(data.event.id, 'rollSendRequested', 'rollDeliveryAck', 'rollDeliveryRoundTripMs');
        diagnostics.count(result?.ok ? 'rollDelivered' : 'rollRejected');
        if (currentControl.current === control && ['timeout', 'outcome-unknown'].includes(result.error)) {
          const status = await request(EVENTS.PLAYER_ACTION_STATUS, {id: data.event.id, gameId});
          if (status.ok && status.result) Object.assign(result, status.result);
        }
        if (currentControl.current === control) post({ type: 'wee:roll-ack', result: {...result,id:data.event.id} });
      } else if (!controller && sport === 'bowling' && data?.type === 'wee:bowling-state' &&
          data.gameId === gameId && isBowlingState(data)) {
        await request(EVENTS.HOST_GAME_STATE, { gameId, phase: data.phase, frame: data.frame, currentPlayer: data.currentPlayer,
          ...(data.phase === 'complete' && data.winners !== undefined
            ? { winners: [...data.winners], winnerScore: data.winnerScore } : {}) });
      } else if (!controller && sport === 'tennis' && data?.type === 'wee:tennis-state' &&
          data.gameId === gameId && isTennisState(data)) {
        await request(EVENTS.HOST_GAME_STATE, { gameId, phase: data.phase, server: data.server, winner: data.winner,
          practice: data.practice, serveAttempt: data.serveAttempt,
          ...(data.score === undefined ? {} : {score: [...data.score], sets: [...data.sets],
            completedSets: data.completedSets.map(set => ({player1: set.player1, player2: set.player2})), targetPoints: 7, setsToWin: 2}) });
      } else if (!controller && data?.type === 'wee:game-audio' && ready.current && playing &&
          !paused && connection === 'online' && data.gameId === gameId && data.sport === sport &&
          isGameSoundEvent(sport, data.event)) {
        onAudio?.(data.event);
      } else if (!controller && sport === 'tennis' && data?.type === 'wee:stroke-result' &&
          ready.current && playing && !paused && connection === 'online' && socket.connected &&
          data.gameId === gameId && isStrokeResult(data)) {
        diagnostics.mark(data.id, data.result === 'hit' ? 'contactReported' : 'strokeResult');
        if (data.result === 'hit') diagnostics.measure(data.id, 'tvReceived', 'contactReported', 'tvBridgeReceiveToContactMs');
        if (!directInput.current?.sendStrokeResult(data)) socket.volatile.emit(EVENTS.HOST_STROKE_RESULT, data);
      } else if (!controller && data?.type === 'wee:game-hit' &&
          ready.current && playing && !paused && connection === 'online' && socket.connected && data.gameId === gameId) {
        const hit = { id: createInputId(), gameId, player: data.player, kind: sport };
        if (isGameHit(hit, sport)) socket.volatile.emit(EVENTS.HOST_GAME_HIT, hit);
      } else if (!controller && data?.type === 'wee:roll-result') {
        const delivery = pending.current.get(data.id);
        if (delivery) { clearTimeout(delivery.timer); pending.current.delete(data.id); delivery.ack(data.result); }
      } else if (controller && data?.type === 'wee:controller-setup') {
        const lifecycle = setupLifecycle.current;
        const result = await setupRelay.current.submit(data.setup, {immediate: data.reason === 'background' || data.reason === 'reset'});
        if (lifecycle === setupLifecycle.current) post({ type: 'wee:setup-ack', requestId: data.requestId, result });
      } else if (controller && data?.type === 'wee:controller-mode' && ['motion', 'touch'].includes(data.mode)) {
        onControllerMode?.(data.mode);
      } else if (controller && data?.type === 'wee:controller-focus' &&
          Number.isFinite(data.offset) && data.offset >= 0 && data.offset <= 2200) {
        const currentFrame = frame.current;
        const lifecycle = setupLifecycle.current;
        // ResizeObserver posts the new iframe height after the control changes.
        // Wait for that layout before positioning its action in the phone view.
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          if (frame.current !== currentFrame || setupLifecycle.current !== lifecycle) return;
          window.scrollTo({top: window.scrollY + currentFrame.getBoundingClientRect().top + data.offset - 16, behavior: 'instant'});
        }));
      } else if (controller && data?.type === 'wee:controller-height' && Number.isFinite(data.height)) {
        setHeight(Math.max(400, Math.min(2200, data.height)));
      }
    };
    const swing = (event, ack) => {
      const ok = inputContext.current?.key === inputKey && inputContext.current.active &&
        !controller && sport === 'tennis' && ready.current && !recovering.current && playing && !paused &&
        connection === 'online' && socket.connected && Boolean(gameId) && event?.gameId === gameId && isSwing(event) &&
        [1, 2].includes(event.player) && (event.generation === undefined || event.generation === generation && event.hostEpoch === hostEpoch);
      if (ok) {
        const identity = `${event.player}:${event.id}`, seen = admittedInputs.current.swings;
        if (!seen.has(identity)) {
          seen.add(identity); if (seen.size > 256) seen.delete(seen.values().next().value);
          diagnostics.mark(event.id, 'tvReceived'); diagnostics.count('swingsReceived');
          post({ type: 'wee:game-swing', event });
          onSwing?.(event);
        } else diagnostics.count('duplicateSwingDropped');
      }
      if (typeof ack === 'function') ack({ ok });
      return ok;
    };
    const roll = (event, ack = () => {}) => {
      if (controller || sport !== 'bowling' || !playing || !ready.current || recovering.current || paused || connection !== 'online' || event?.gameId !== gameId || !isRoll(event) ||
          (event.generation !== undefined && (event.generation !== generation || event.hostEpoch !== hostEpoch))) {
        ack({ ok: false, error: 'game-loading' }); return;
      }
      if (pending.current.has(event.id)) { ack({ok: false, error: 'duplicate-roll'}); return; }
      // Once posted, a lost iframe response cannot prove that the ball stayed
      // still. Keep the controller latched until authoritative turn state.
      const timer = setTimeout(() => { pending.current.delete(event.id); ack({ ok: false, error: 'outcome-unknown' }); }, 1800);
      pending.current.set(event.id, { ack, timer });
      post({ type: 'wee:game-roll', event });
    };
    const command = (event, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (controller || !ready.current || recovering.current || !playing || paused || connection !== 'online' ||
          event?.gameId !== gameId || !isGameCommand(event, sport)) {
        ack({ ok: false, error: 'game-loading' }); return;
      }
      if (pendingCommands.current.has(event.id)) { ack({ ok: false, error: 'duplicate-command' }); return; }
      const timer = setTimeout(() => {
        pendingCommands.current.delete(event.id); ack({ ok: false, error: 'game-loading' });
      }, 1800);
      pendingCommands.current.set(event.id, { ack, timer });
      post({ type: 'wee:game-command', command: event });
    };

    const aim = event => {
      if (!controller && sport === 'bowling' && ready.current && !recovering.current && playing && !paused &&
          event.gameId === gameId && event.generation === generation && event.hostEpoch === hostEpoch && isAim(event)) {
        post({type: 'wee:game-aim', event: {...event, sequence: event.seq, inputGeneration: event.generation}});
      }
    };
    const hit = event => {
      if (controller && ready.current && playing && !paused &&
          connection === 'online' && socket.connected && isGameHit(event, sport) &&
          event.kind === sport && event.gameId === gameId && event.player === player) {
        post({ type: 'wee:game-hit', kind: sport, player });
      }
    };
    const strokeResult = event => {
      if (controller && sport === 'tennis' && ready.current && playing && !paused &&
          connection === 'online' && event.gameId === gameId && event.player === player && isStrokeResult(event)) {
        diagnostics.mark(event.id, 'strokeResult');
        diagnostics.measure(event.id, 'sendRequested', 'strokeResult', 'sendToResultRoundTripMs');
        post({ ...event, type: 'wee:stroke-result' });
      }
    };
    directHandlers.current = {swing, strokeResult};
    window.addEventListener('message', receive);
    if (!controller) { socket.on(EVENTS.GAME_SWING, swing); socket.on(EVENTS.GAME_ROLL, roll); socket.on(EVENTS.GAME_COMMAND, command); socket.on(EVENTS.GAME_AIM, aim); }
    else { socket.on(EVENTS.GAME_HIT, hit); socket.on(EVENTS.GAME_STROKE_RESULT, strokeResult); }
    publishState();
    void recoverHost();
    return () => {
      window.removeEventListener('message', receive);
      socket.off(EVENTS.GAME_SWING, swing); socket.off(EVENTS.GAME_ROLL, roll);
      socket.off(EVENTS.GAME_COMMAND, command); socket.off(EVENTS.GAME_AIM, aim);
      socket.off(EVENTS.GAME_HIT, hit);
      socket.off(EVENTS.GAME_STROKE_RESULT, strokeResult);
    };
  }, [paused, manuallyPaused, connection, src, controller, controllerIntent, onControllerMode, attempt, players, playing, sport, gameId, gameState, generation, hostEpoch, matchRound, player, onAudio, onPauseToggle, onSwing]);
  return (
    <div className={`game-frame ${controller ? 'game-frame--phone' : ''}`}>
      {loading ? <p role="status">{failed ? 'Taking too long to load.' : `Loading ${controller ? 'controller' : sport}…`}
        {failed ? <button type="button" className="btn btn--ghost" onClick={() => setAttempt(value => value + 1)}>Retry loading</button> : null}</p> : null}
      {!controller && saveIssue ? <p className="game-save-issue" role="alert">{saveIssue}</p> : null}
      <iframe key={attempt} ref={frame} src={src} title={`${sport === 'bowling' ? 'Bowling' : ('Tennis')} ${controller ? 'phone controller' : 'game'}`}
        style={controller ? { height } : undefined}
        allow={controller ? 'accelerometer; gyroscope; screen-wake-lock' : undefined} onLoad={publishState} />
      {showPause ? <div className="game-frame__pause" role="status">{pauseMessage || 'Match paused. Reconnect and finish controller setup to continue.'}</div> : null}
    </div>
  );
}
