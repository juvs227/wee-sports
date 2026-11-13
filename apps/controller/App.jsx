import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Gyroscope } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import { EVENTS, isGameOptions, normalizeCode, cleanName, NAME_MAX } from '../../shared/protocol.js';
import { createControllerCapabilities } from '../../shared/controllerCapabilities.js';
import { ControllerSession, parseRoomLink, serverOrigin } from './src/session.js';
import { NativeMotionController } from './src/motion.js';
import { profileRequest, readPrivate, writePrivate } from './src/storage.js';
import { createGuestClaimVault } from './src/guestClaims.js';
import { AutomaticControllerSetup } from './src/automaticSetup.js';

import { NativeBowlingActions } from './src/bowlingActions.js';
import {PlayArtwork} from './src/PlayArtwork.jsx';
import {startConfirmationKey} from '../../shared/startConfirmation.js';
import {CONTROLLER_SPORTS, controllerPlayState, matchSummary, sportChoice, sportTitle as title, waitingForTv} from './src/controllerPresentation.js';

const sportArtwork = {tennis:require('./assets/sports/tennis.png'), bowling:require('./assets/sports/bowling.png'), golf:require('./assets/sports/golf.png')};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const guestClaims = createGuestClaimVault({read: () => readPrivate('guestClaims'), write: values => writePrivate('guestClaims', values)});
function Button({ children, onPress, disabled, quiet = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:Boolean(disabled)}} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, quiet && styles.quietButton, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, quiet && styles.quietText]}>{children}</Text>
  </Pressable>;
}
function SportMark({sport,size=56}) {return <Image accessible={false} source={sportArtwork[sport] || sportArtwork.tennis} style={{width:size,height:size}} resizeMode="contain"/>;}
function SportTile({sport,seat,disabled,onPress}) {
  const choice=sportChoice(sport,seat),selected=seat?.sport===sport;
  const locked=disabled || !choice.available || !choice.fits || selected;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${choice.title}, ${choice.caption}`} accessibilityState={{disabled:Boolean(locked),selected}}
    disabled={locked} onPress={onPress} style={({pressed})=>[styles.sportTile,selected && styles.sportSelected,!choice.available && styles.comingSoon,pressed && styles.pressed]}>
    <SportMark sport={sport} size={42}/><Text style={styles.tileTitle}>{choice.title}{selected ? ' ✓' : ''}</Text><Text style={styles.small}>{choice.caption}</Text>
  </Pressable>;
}
function Field({ label, ...props }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#8792aa" style={styles.input} {...props}/></View>;
}
function Stepper({ label, value, change, min = -1, max = 1, step = .1 }) {
  return <View style={styles.stepper}><Text style={styles.label}>{label} {Math.round(value * 100)}%</Text>
    <View style={styles.row}><Button quiet onPress={() => change(clamp(value - step, min, max))}>−</Button><Button quiet onPress={() => change(clamp(value + step, min, max))}>+</Button></View></View>;
}
function KeepControllerAwake() { useKeepAwake('wee-controller', {suppressDeactivateWarnings:true}); return null; }

export default function App() {
  const [origin, setOrigin] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [scannedRoom, setScannedRoom] = useState(null);
  const [seat, setSeat] = useState(null);
  const [status, setStatus] = useState('Ready to join');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [savedSession, setSavedSession] = useState(null);
  const [setup, setSetup] = useState(null);
  const [mode, setMode] = useState('motion');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [motionStatus, setMotionStatus] = useState({ state: 'off' });
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(.55);
  const [spin, setSpin] = useState(0);
  const [rollState, setRollState] = useState(null);
  const [hand, setHand] = useState('Right');
  const [haptics, setHaptics] = useState(true);
  const [sensitivity, setSensitivity] = useState(1);
  const [strokeMode, setStrokeMode] = useState('auto');
  const [profileOpen, setProfileOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [history, setHistory] = useState([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStart, setConfirmStart] = useState(null);
  const [sportsOpen, setSportsOpen] = useState(false);
  const [playEvent, setPlayEvent] = useState(null);
  const visualId = useRef(0);
  const startPending = useRef(false);
  function animatePlay(type, label) {
    const session=sessionRef.current;
    if (!session?.playing() || session.controlsActive===false || session.seat?.gameState?.phase==='complete') return;
    setPlayEvent({id:++visualId.current,type,label});
  }
  const scrollRef = useRef(null);
  const sessionRef = useRef(null), motionRef = useRef(null), hapticsRef = useRef(true), flowRef = useRef(null);
  const roomRevision = useRef(0), taskRevision = useRef(0);
  const scanLock = useRef(false), preferencesRef = useRef({hand,sensitivity,strokeMode});

  preferencesRef.current = {hand,sensitivity,strokeMode};
  const boundaryRef = useRef(null);
  const rollActions = useRef(null);
  if (!rollActions.current) rollActions.current = new NativeBowlingActions({
    session:() => sessionRef.current, changed:setRollState, notice:setNotice,
    retry:session => {if (sessionRef.current === session) motionRef.current?.allowNewDelivery();},
  });

  hapticsRef.current = haptics;
  const buzz = type => {
    if (!hapticsRef.current) return;
    const task = type === 'contact' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) : Haptics.selectionAsync();
    task.catch(() => {});
  };
  const task = async work => { const revision=++taskRevision.current; setBusy(true); setNotice(''); try { await work(); } catch (error) { if (revision===taskRevision.current) setNotice(error.message); } finally { if (revision===taskRevision.current) setBusy(false); } };
  const result = value => { if (!value?.ok) throw new Error(value?.error === 'outcome-unknown' ? 'The outcome is unknown. Check the TV before trying another action.' : value?.error || 'The server did not accept this action.'); return value; };

  useEffect(() => {
    const revision=roomRevision.current;
    readPrivate('room').then(value => { if (revision===roomRevision.current && value?.origin && value?.code && value?.token) setSavedSession(value); }).catch(() => {});
    readPrivate('controllerPreferences').then(value => {
      if (['Right','Left'].includes(value?.hand)) setHand(value.hand);
      if (Number.isFinite(value?.sensitivity) && value.sensitivity>=.5 && value.sensitivity<=2) setSensitivity(value.sensitivity);
      if (typeof value?.haptics==='boolean') setHaptics(value.haptics);
      if (typeof value?.name==='string' && value.name.trim()) setName(value.name.slice(0,12));
    }).catch(() => {}).finally(() => setPreferencesLoaded(true));
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        flowRef.current?.stop(); setSetup(null); setMotionStatus({ state: 'off' }); setScanner(false);


        sessionRef.current?.background();
      } else if (state === 'inactive') {
        // Permission sheets are inactive too. Keep pending motion permission
        // and the room alive, but discard gestures while the sheet is open.
         motionRef.current?.resetInput(); sessionRef.current?.inactive();
      } else if (state === 'active') {
        motionRef.current?.resetInput(); sessionRef.current?.foreground();
      }
    });
    return () => { subscription.remove(); flowRef.current?.stop(); rollActions.current.reset(false); sessionRef.current?.dispose();  };
  }, []);
  useEffect(() => {sessionRef.current?.configure({hand}); motionRef.current?.updatePreferences({hand,sensitivity,strokeMode});}, [hand,sensitivity,strokeMode]);
  useEffect(() => {if (preferencesLoaded) writePrivate('controllerPreferences',{hand,sensitivity,haptics,name}).catch(() => {});}, [preferencesLoaded,hand,sensitivity,haptics,name]);
  useEffect(() => {scrollRef.current?.scrollTo({y:0,animated:false});}, [optionsOpen,profileOpen,scanner]);
  useEffect(() => {
    const active=!optionsOpen && !profileOpen;
    sessionRef.current?.setControlsActive(active);

    if(active) motionRef.current?.resetInput();
  }, [optionsOpen,profileOpen]);
  useEffect(() => {setConfirmReset(false);}, [seat?.gameId,seat?.sport]);

  useEffect(() => {
    if (!seat || seat.paused || !['game', 'ready', 'countdown'].includes(seat.phase)) motionRef.current?.resetInput();
  }, [seat?.gameState?.phase, seat?.phase, seat?.paused]);
  function saveRoom(value) {
    roomRevision.current++;
    setSavedSession(value);
    return writePrivate('room', value).catch(() => setNotice('Secure storage is unavailable. Your room can only be remembered while this app stays open.'));
  }
  function goHome() {
    taskRevision.current++;
    flowRef.current?.stop(); motionRef.current?.resetInput();
     rollActions.current.reset();
    sessionRef.current?.home();
    sessionRef.current = null;
    setSetup(null); setMotionStatus({state:'off'}); setScanner(false); setScannedRoom(null); setManualOpen(false);
    setOptionsOpen(false); setProfileOpen(false); setConfirmStart(null); setPlayEvent(null);
    setSeat(null); setStatus('Ready to join'); setNotice(''); setBusy(false);
    scrollRef.current?.scrollTo({y:0,animated:false});
  }
  async function makeSession(address) {
    const revision=taskRevision.current;
    flowRef.current?.stop(); rollActions.current.reset(); sessionRef.current?.dispose();   setSetup(null);
    const savedProfile = await readPrivate('profile').catch(() => null);
    if (revision!==taskRevision.current) return null;
    if (savedProfile?.origin === address && savedProfile.profile?.preferences) {
      const saved = savedProfile.profile.preferences;
      setHand(saved.hand); setSensitivity(saved.sensitivity); setHaptics(saved.haptics);
      preferencesRef.current = {...preferencesRef.current, hand:saved.hand, sensitivity:saved.sensitivity};
    }
    const session = new ControllerSession(address, {
      profileToken: savedProfile?.origin === address ? savedProfile.token : null,
      save: value => sessionRef.current === session ? saveRoom(value) : Promise.resolve(),
      saveClaim: (address, claim) => guestClaims.remember(address, claim),
      changed: (next, connection) => {
        if (sessionRef.current !== session) return;
        rollActions.current.observe();
        const boundary = next ? `${next.gameId}:${next.inputGeneration}:${next.hostEpoch}` : null;
        if (boundary !== boundaryRef.current) { motionRef.current?.resetInput();  setPlayEvent(null); }
        boundaryRef.current = boundary;
        const currentPlayer = next?.players?.find(value => value.slot === next.slot);
        if (currentPlayer?.setup === null) setSetup(null);
        setSeat(next); setStatus(connection);
        if (!next) {setOptionsOpen(false);setProfileOpen(false);setConfirmStart(null);setPlayEvent(null);setScannedRoom(null);setManualOpen(false);setScanner(false);}
        if (connection !== 'online') { setSetup(null);  }
        flowRef.current?.update(next, connection);
      },
      feedback: event => { if (event.player && event.player !== session.seat?.slot + 1) return; buzz('contact'); animatePlay('hit'); },
    });
    sessionRef.current = session;
    session.configure({hand:preferencesRef.current.hand});
    session.setControlsActive(!optionsOpen && !profileOpen);
    flowRef.current = new AutomaticControllerSetup({session,notice:setNotice,
      changed: update => {
        setMode(update.mode); setSetup(update.setup);
        setMotionStatus(previous => ({...previous,...update}));
        // Resume the touch heartbeat from accepted session state too. A quick
        // background/foreground cycle may batch React state to the same values.

      },
      makeMotion: onStatus => {
        const motion = new NativeMotionController({session,...preferencesRef.current,onStatus,
          onRelease: roll => { buzz('recognized'); release(roll).catch(error => setNotice(error.message)); },

          onSwing: swing => {
            animatePlay('swing',swing.label);
            buzz('recognized');
            session.action(EVENTS.PLAYER_SWING, swing).then(response => {
              if (!response.ok && !['not-playing','not-your-turn'].includes(response.error)) setNotice('That swing could not reach the TV. Try your next swing when connected.');
            });
          },
        });
        motionRef.current = motion;
        return motion;
      },
    });
    if(savedProfile?.origin===address && savedProfile.profile?.preferences?.touchControls) flowRef.current.select('touch');
    return session;
  }

  async function join(room = {origin,code}) {
    const revision=taskRevision.current;
    const playerName = cleanName(name);
    if (!playerName) throw new Error('Enter your playing name to join.');
    const address = serverOrigin(room.origin.trim(), __DEV__);
    const session = await makeSession(address);
    if (!session || revision!==taskRevision.current) return;
    const motionAvailable = await Gyroscope.isAvailableAsync().catch(() => false);
    if (revision!==taskRevision.current || session!==sessionRef.current) return;
    const joined=await session.join(room.code, playerName, createControllerCapabilities({
      sports: ['tennis', 'bowling'], motion: motionAvailable, orientation: motionAvailable, haptics, buttons: true }));
    if (revision!==taskRevision.current || session!==sessionRef.current) return;
    result(joined);
    setName(playerName); setScannedRoom(null); setOrigin(address); setScanner(false); setOptionsOpen(false); setProfileOpen(false); buzz('ready');
  }
  async function returnToRoom() {
    const revision=taskRevision.current, saved=savedSession;
    if (!saved) return;
    setOrigin(saved.origin);
    const session=await makeSession(saved.origin);
    if (session && revision===taskRevision.current && session===sessionRef.current) await session.restore(saved);
  }
  async function release(roll = { aim, power, spin }) {
    if (!rollActions.current.ticket) animatePlay('roll');
    await rollActions.current.release(roll);
  }
  async function checkRoll() {
    await rollActions.current.check();
  }
  const command = async (action, extra = {}) => result(await sessionRef.current.action(EVENTS.PLAYER_GAME_COMMAND, { action, ...extra }));


  async function openProfile() {
    const saved = await readPrivate('profile');
    const address = origin || saved?.origin || savedSession?.origin;
    setProfileOpen(true);
    if (!address) {setAccount(null); return;}
    setOrigin(address);
    if (saved?.origin !== address) { setAccount(null); return; }
    const current = await profileRequest(address, '', { token: saved.token });
    await sessionRef.current?.captureGuestClaim();
    await guestClaims.claimFor(address, claim => profileRequest(address, '/claim', {method:'POST',token:saved.token,body:{claim}}));
    setAccount({ ...saved, profile: current.profile });
    setHistory((await profileRequest(address, '/history', { token: saved.token })).history || []);
  }
  async function scanTv() {
    const revision=taskRevision.current;
    const granted=permission?.granted || (await requestPermission()).granted;
    if (revision!==taskRevision.current) return;
    if(!granted) {setManualOpen(true);throw new Error('Camera permission is off. Enter the room code, or allow Camera in Settings.');}
    if(sessionRef.current?.seat) {await sessionRef.current.leave();flowRef.current?.stop();setSetup(null);}
    if (revision!==taskRevision.current) return;
    scanLock.current = false; setScannedRoom(null); setOptionsOpen(false);setProfileOpen(false);setScanner(true);
  }
  function backToPlay() {setProfileOpen(false);setOptionsOpen(false);setConfirmReset(false);}
  async function authenticate(register) {
    const address = serverOrigin(origin.trim(), __DEV__);
    const auth = await profileRequest(address, register ? '/register' : '/login', { method: 'POST', body: { username, password, ...(register ? { displayName: name } : {}) } });
    if (!auth.token) throw new Error('This server does not support native profile sessions. Continue as a guest.');
    const saved = { origin: address, token: auth.token, profile: auth.profile };
    await writePrivate('profile', saved); setAccount(saved); setPassword(''); setName(auth.profile.displayName);
    await sessionRef.current?.captureGuestClaim();
    await guestClaims.claimFor(address, claim => profileRequest(address, '/claim', {method:'POST',token:auth.token,body:{claim}}));
    if (sessionRef.current?.origin === address) sessionRef.current.setProfileToken(auth.token);
    const preferences = auth.profile.preferences;
    if (preferences) { setHand(preferences.hand); setHaptics(preferences.haptics); setSensitivity(preferences.sensitivity); }
    setHistory((await profileRequest(address, '/history', { token: auth.token })).history || []);
  }

  const isLeader = seat?.slot === (seat?.leaderSlot ?? 0);
  const tvAway = waitingForTv(seat);
  const inLobby = ['lobby','ready'].includes(seat?.phase);
  const playable = seat?.phase === 'game' && !seat.paused && status === 'online';
  const canRoll = playable && !optionsOpen && !profileOpen && seat?.gameState?.phase === 'ready' && seat?.gameState?.currentPlayer === seat.slot + 1;
  const summary = matchSummary(seat);
  const completed = seat?.gameState?.phase === 'complete';
  const playState = controllerPlayState(seat,status,setup);
  const startKey = status === 'online' ? startConfirmationKey(seat) : null;
  useEffect(() => { if (confirmStart !== startKey) setConfirmStart(null); }, [startKey,confirmStart]);
  useEffect(() => {setSportsOpen(false);setPlayEvent(null);}, [seat?.sport,seat?.phase]);
  async function confirmGameStart() {
    if (startPending.current) return;
    if (!confirmStart || confirmStart !== startConfirmationKey(sessionRef.current?.seat)) {setConfirmStart(null);return;}
    startPending.current=true;setConfirmStart(null);
    try {await task(async () => result(await flowRef.current.startGame()));}
    finally {startPending.current=false;}
  }
  const gameOptions = seat?.gameOptions?.gameId === seat?.gameId && isGameOptions(seat?.gameOptions,seat?.sport) ? seat.gameOptions : null;
  const settings = gameOptions?.settings;
  const optionsLocked = !playable || !isLeader || !gameOptions || busy;
  const newMatch = () => command('new-match',seat?.sport === 'tennis' ? {format:'full'} : {});
  const configure = (key,value) => command('configure',{settings:{[key]:value}});

  useEffect(() => {
    if (canRoll && mode === 'touch' && setup) sessionRef.current?.latest('aim', {aim,locked:false});
  }, [canRoll,mode,setup,aim]);
  return <SafeAreaView style={styles.safe}>{seat ? <KeepControllerAwake /> : null}<ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><View><Text style={styles.brand}>wee<Text style={styles.brandAccent}> sports</Text></Text><Text style={styles.pill}>YOUR CONTROLLER</Text></View>
      {!optionsOpen && !profileOpen ? <Button quiet onPress={() => setOptionsOpen(true)}>Tools</Button> : null}</View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status === 'online' ? tvAway ? 'Waiting for the TV…' : '● Connected to your TV' : status === 'offline' ? 'Reconnecting to your room…' : status === 'suspended' ? 'Return to the app to reconnect' : status}</Text>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {seat ? <Button quiet onPress={goHome}>Go home</Button> : null}
    {profileOpen ? <View style={styles.card}>
      <Text style={styles.heading}>Your profile</Text><Text style={styles.copy}>Your preferences and match history. Guest play is always available.</Text>
      {account ? <>
        <Text style={styles.subheading}>{account.profile.displayName}</Text>
        <Button quiet onPress={() => setHand(hand === 'Right' ? 'Left' : 'Right')}>{hand} handed</Button>
        <Button quiet onPress={() => setHaptics(!haptics)}>Haptics {haptics ? 'on' : 'off'}</Button>
        <Stepper label="Sensitivity" value={sensitivity} change={setSensitivity} min={.5} max={2}/>
        <Button disabled={busy} onPress={() => task(async () => {
          const saved = await profileRequest(account.origin, '', { method: 'PATCH', token: account.token,
            body: { revision: account.profile.revision, preferences: { ...account.profile.preferences, hand, haptics, sensitivity } } });
          const updated = { ...account, profile: saved.profile }; setAccount(updated); await writePrivate('profile', updated);
        })}>Save preferences</Button>
        <Text style={styles.subheading}>Match history</Text>
        {history.length ? history.slice(0, 20).map((entry, index) => <Text key={entry.matchId || index} style={styles.copy}>{title(entry.sport)} · {entry.outcome || entry.status}{Number.isFinite(entry.score) ? ` · ${entry.score}` : ''}{Number.isFinite(entry.savedAt || entry.startedAt) ? ` · ${new Date(entry.savedAt || entry.startedAt).toLocaleDateString()}` : ''}</Text>) : <Text style={styles.copy}>No saved matches yet.</Text>}
        <Button quiet onPress={() => task(async () => { await profileRequest(account.origin, '/logout', { method: 'POST', token: account.token }); await writePrivate('profile', null); sessionRef.current?.setProfileToken(null); setAccount(null); })}>Sign out</Button>
      </> : <>
        {!origin ? <><Text style={styles.copy}>Connect to your TV once to use its profile and match history.</Text><Button onPress={() => task(scanTv)}>Scan TV code</Button></> : null}
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}/>
        <Field label="Password (12+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}/>
        <Button disabled={busy || !origin} onPress={() => task(() => authenticate(false))}>Sign in</Button>
        <Button quiet disabled={busy || !origin} onPress={() => task(() => authenticate(true))}>Create optional account</Button>
      </>}
    </View> : optionsOpen ? <>
      <View style={styles.card}><Text style={styles.eyebrow}>{seat ? `${title(seat.sport)} · ROOM ${seat.code}` : 'YOUR PHONE'}</Text><Text style={styles.heading}>Tools</Text>
        <Text style={styles.copy}>A few adjustments, then back to play.</Text>
        {seat && isLeader && !seat.resumeGame && (['ready','lobby'].includes(seat.phase) || completed) ? <>
          <Button quiet onPress={() => setSportsOpen(!sportsOpen)}>Change sport</Button>
          {sportsOpen ? <View style={styles.sportGrid}>{CONTROLLER_SPORTS.filter(sport=>sportChoice(sport,seat).available).map(sport=><SportTile key={sport} sport={sport} seat={seat} disabled={busy || status!=='online'}
            onPress={() => task(async () => {result(await sessionRef.current.request(EVENTS.PLAYER_SWITCH_SPORT,{sport,gameId:seat.gameId}));backToPlay();})}/>)}</View> : null}
        </> : null}
        {seat ? <View style={styles.row}><Button quiet disabled={mode==='motion' && Boolean(setup)} onPress={() => flowRef.current?.select('motion')}>Motion{mode==='motion' ? ' ✓' : ''}</Button><Button quiet disabled={mode==='touch' && Boolean(setup)} onPress={() => flowRef.current?.select('touch')}>Touch{mode==='touch' ? ' ✓' : ''}</Button></View> : <Field label="Your playing name" value={name} onChangeText={setName} maxLength={12}/>}
        {seat && mode==='touch' && motionStatus.motionIssue ? <>
          <Text style={styles.small}>{motionStatus.motionIssue.message}</Text>
          {motionStatus.motionIssue.code==='permission-denied' ? <Button quiet onPress={()=>task(()=>Linking.openSettings())}>Open Settings</Button> : null}
        </> : null}
        <Button quiet onPress={() => setHand(hand==='Right' ? 'Left' : 'Right')}>{hand} handed</Button>
        <Stepper label="Sensitivity" value={sensitivity} change={setSensitivity} min={.5} max={2}/>
        <Button quiet onPress={() => setHaptics(!haptics)}>Haptics {haptics ? 'on' : 'off'}</Button>
        {seat && typeof seat.soundMuted==='boolean' ? <Button quiet disabled={status!=='online' || busy} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.SOUND_SET,{muted:!seat.soundMuted})))}>TV sound {seat.soundMuted ? 'off' : 'on'}</Button> : null}
        {seat && mode==='motion' ? <Button quiet onPress={() => motionRef.current?.recenter()}>Center motion</Button> : null}
        {seat?.sport==='tennis' && mode==='motion' ? <View style={styles.row}>{['auto','Forehand','Backhand'].map(value=><Button quiet key={value} onPress={() => setStrokeMode(value)}>{value==='auto' ? 'Automatic strokes' : `Simple ${value.toLowerCase()}`}{strokeMode===value ? ' ✓' : ''}</Button>)}</View> : null}
        {seat?.sport==='bowling' && mode==='touch' ? <><Stepper label="Power" value={power} change={setPower} min={.2}/><Stepper label="Curve" value={spin} change={setSpin}/></> : null}
      </View>
      {seat && isLeader && seat.phase==='game' ? <View style={styles.card}><Text style={styles.subheading}>Game options</Text>
        <Button quiet disabled={status!=='online' || (completed && !seat.manuallyPaused)} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_PAUSE,{gameId:seat.gameId,paused:!seat.manuallyPaused})))}>{seat.manuallyPaused ? 'Resume game' : 'Pause game'}</Button>
        {gameOptions ? <>
          {seat.sport==='tennis' ? <>
            <Button quiet disabled={optionsLocked} onPress={() => task(() => configure('assistance',settings.assistance==='beginner' ? 'standard' : 'beginner'))}>Timing: {settings.assistance==='beginner' ? 'Easier' : 'Standard'}</Button>
            {!gameOptions.humanOpponent ? <Button quiet disabled={optionsLocked} onPress={() => task(() => configure('botDifficulty',settings.botDifficulty==='beginner' ? 'standard' : 'beginner'))}>Opponent: {settings.botDifficulty==='beginner' ? 'Rally' : 'Challenge'}</Button> : null}
          </> : (null)}
          {seat.players.length===1 ? <Button quiet disabled={optionsLocked} onPress={() => task(() => command(gameOptions.practice?.active ? 'practice-stop' : 'practice-start',seat.sport==='tennis' && !gameOptions.practice?.active ? {stroke:'alternate',hand} : {}))}>{gameOptions.practice?.active ? seat.sport==='tennis' ? 'Return to match' : 'Start a scored game' : seat.sport==='tennis' ? 'Practice returns' : 'Practice · resets score'}</Button> : null}
          {confirmReset ? <><Text style={styles.copy}>Start again with a fresh score for everyone?</Text><Button disabled={optionsLocked} onPress={() => task(async () => {await newMatch();setConfirmReset(false);backToPlay();})}>Reset score and start</Button><Button quiet onPress={() => setConfirmReset(false)}>Keep this game</Button></> : <Button quiet disabled={optionsLocked} onPress={() => setConfirmReset(true)}>New match</Button>}
        </> : <Text style={styles.copy}>Waiting for the TV’s game options…</Text>}
      </View> : null}
      <View style={styles.card}><Text style={styles.subheading}>Your controller</Text>
        <Button quiet onPress={() => task(openProfile)}>Profile & history</Button>
        {isLeader && ['countdown','vote','tutorial','game'].includes(seat?.phase) ? <Button quiet disabled={status!=='online'} onPress={() => task(async () => {result(await sessionRef.current.request(EVENTS.PLAYER_RETURN_TO_LOBBY,{gameId:seat.gameId}));backToPlay();})}>Return to lobby</Button> : null}
        <Button quiet disabled={busy} onPress={() => task(scanTv)}>{seat ? 'Leave & scan another TV' : 'Scan TV code'}</Button>
        {seat ? <Button quiet onPress={() => task(async () => {await sessionRef.current.leave();flowRef.current?.stop();setSetup(null);backToPlay();})}>Leave room</Button> : null}
      </View>
    </> : !seat ? <>
      {!scannedRoom ? <View style={styles.homeLead}><View style={styles.sportPreview}>{CONTROLLER_SPORTS.map(sport=><View key={sport} style={styles.previewIcon}><SportMark sport={sport} size={44}/><Text style={styles.previewLabel}>{title(sport)}</Text></View>)}</View>
      <Text style={styles.heading}>Ready to play?</Text><Text style={styles.copy}>Connect to your TV. Your phone does the rest.</Text></View> : null}
      {savedSession && !scannedRoom && !scanner ? <View style={styles.card}>
        <Text style={styles.eyebrow}>RECENT ROOM · {savedSession.code}</Text>
        <Text style={styles.copy}>Return while the room is still available. Your place is held briefly.</Text>
        <Button disabled={busy} onPress={() => task(returnToRoom)}>Return to room</Button>
        <Button quiet onPress={() => {goHome();void saveRoom(null);}}>Forget room</Button>
      </View> : null}
      {scanner && permission?.granted ? <View style={styles.cameraFrame}>
        <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
          if (scanLock.current) return;
          try {
            const scanned = parseRoomLink(data); scanLock.current = true;
            setOrigin(scanned.origin); setCode(scanned.code); setScanner(false);
            setScannedRoom(scanned); setManualOpen(false); setNotice('');
          } catch (error) { setNotice(error.message); }
        }}/><Button quiet onPress={() => setScanner(false)}>Cancel scan</Button>
      </View> : !scannedRoom ? <Button disabled={busy} onPress={() => task(scanTv)}>Scan TV code</Button> : null}
      {scannedRoom ? <View style={styles.card}>
        <Text style={styles.eyebrow}>ROOM {scannedRoom.code}</Text>
        <Text style={styles.heading}>Ready to play?</Text>
        <Field label="Your playing name" value={name} onChangeText={setName} maxLength={NAME_MAX} autoComplete="nickname" returnKeyType="go" onSubmitEditing={() => {if (cleanName(name) && !busy) task(() => join(scannedRoom));}}/>
        <Button disabled={busy || !cleanName(name)} onPress={() => task(() => join(scannedRoom))}>{busy ? 'Connecting…' : 'Play'}</Button>
        <Button quiet onPress={() => setScannedRoom(null)}>Cancel</Button>
      </View> : <Button quiet onPress={() => setManualOpen(!manualOpen)}>{manualOpen ? 'Close' : 'Enter room code'}</Button>}
      {manualOpen && !scannedRoom ? <View style={styles.card}>
        <Field label="HTTPS game server" placeholder="https://your-game.example" value={origin} onChangeText={setOrigin} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
        <Field label="Room code" placeholder="K7PM" value={code} onChangeText={value => setCode(normalizeCode(value))} autoCapitalize="characters" maxLength={4}/>
        <Field label="Your playing name" value={name} onChangeText={setName} maxLength={NAME_MAX}/>
        <Button disabled={busy || !origin || code.length !== 4 || !cleanName(name)} onPress={() => task(() => join())}>Play</Button>
        <Button quiet disabled={!origin || code.length !== 4} onPress={() => task(async () => { const address = serverOrigin(origin.trim(), __DEV__); await Linking.openURL(`${address}/join?code=${encodeURIComponent(code)}`); })}>Continue in browser</Button>
      </View> : null}
      <Button quiet onPress={() => task(openProfile)}>Profile & history</Button><Text style={styles.small}>No account needed to play. Golf is coming soon.</Text>
    </> : <>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ROOM {seat.code}{Number.isInteger(seat.slot) ? ` · PLAYER ${seat.slot + 1}` : ''}</Text>
        <View style={styles.sportHeading}><SportMark sport={seat.sport} size={38}/><Text style={[styles.heading,styles.sportHeadingText]}>{title(seat.sport)}</Text></View>
        {seat.phase === 'game' ? <>
          <PlayArtwork sport={seat.sport} source={sportArtwork[seat.sport]} event={playEvent}
            active={playable && Boolean(setup) && !completed && (seat.sport!=='bowling' || seat.gameState?.currentPlayer===seat.slot+1)}/>
          <Text accessibilityLiveRegion="polite" style={styles.playTitle}>{playState.title}</Text>
          <Text style={styles.playHint}>{playState.hint}</Text>
          {mode === 'touch' && !completed ? seat.sport === 'bowling' ? <>
            <Stepper label="Aim" value={aim} change={setAim}/>
            <Button disabled={!canRoll || !setup || Boolean(rollState)} onPress={() => {setNotice('');release().catch(error=>setNotice(error.message));}}>{rollState ? 'Watch the TV' : 'Roll'}</Button>
          </> : (<View style={styles.row}>{['Forehand','Backhand'].map(label=><Button key={label} disabled={!playable || !setup} onPress={()=>task(async()=>{animatePlay('swing',label);result(await sessionRef.current.action(EVENTS.PLAYER_SWING,{type:'swing',label,hand,power}));})}>{label}</Button>)}</View>) : null}
          {rollState?.status==='unknown' ? <Button quiet onPress={()=>{setNotice('');checkRoll().catch(error=>setNotice(error.message));}}>Check previous roll outcome</Button> : null}
          {summary ? <View style={styles.compactScore}>
            <Text style={styles.scoreDetail}>{summary.label}{summary.score ? ` · ${summary.score.join(' – ')}` : ''}</Text>
            {summary.tally ? <Text style={styles.small}>{summary.tally}</Text> : null}
            <Text style={styles.small}>{mode==='motion' ? 'Motion controls' : 'Touch controls'}</Text>
          </View> : null}
        </> : <>
          <Text style={styles.copy}>{status!=='online' ? 'Reconnecting. You can wait here or go home.' : tvAway ? 'Reopen this room on the TV, or go home and return while it is available.' : seat.resumeGame ? 'Choose Continue game or New game on the TV.' : seat.paused ? 'Waiting for the other controllers…' : !setup ? 'Getting ready…' : inLobby ? isLeader ? 'Start when everyone is in.' : 'Ready. Waiting for the group to start.' : 'Watch the TV. Get ready!'}</Text>
          {isLeader && inLobby && !seat.resumeGame ? <Button disabled={busy || !startKey || !setup} onPress={()=>setConfirmStart(startKey)}>Start game</Button> : null}
          {seat.phase==='countdown' ? <Text style={styles.meter}>Starting in {Math.ceil((seat.countdown?.msLeft || 0)/1000)}</Text> : null}
          {inLobby ? <Text style={styles.small}>{seat.players?.map(joined=>`${joined.name}${joined.ready ? ' ✓' : ''}`).join(' · ')}</Text> : null}
        </>}
        {mode==='touch' && motionStatus.motionIssue && seat.phase!=='game' ? <>
          <Text style={styles.small}>{motionStatus.motionIssue.message}</Text>
          <Button quiet onPress={()=>{setNotice('');flowRef.current?.select('motion');}}>Try motion again</Button>
          {motionStatus.motionIssue.code==='permission-denied' ? <Button quiet onPress={()=>task(()=>Linking.openSettings())}>Open Settings</Button> : null}
        </> : null}
      </View>
      {isLeader && seat.manuallyPaused ? <Button disabled={status!=='online'} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_PAUSE,{gameId:seat.gameId,paused:false})))}>Resume game</Button> : null}
      {completed && isLeader ? <Button disabled={!playable || busy} onPress={() => task(newMatch)}>Play again</Button> : null}
      {isLeader && (completed || ['countdown','vote','tutorial'].includes(seat.phase)) ? <Button quiet disabled={status!=='online'} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_RETURN_TO_LOBBY,{gameId:seat.gameId})))}>Back to lobby</Button> : null}
    </>}
    <Text style={styles.footer}>Watch the TV. Play with your phone.</Text>
  </ScrollView>{optionsOpen || profileOpen ? <View style={styles.backDock}><Button onPress={backToPlay}>{seat ? inLobby ? 'Back to lobby' : 'Back to play' : 'Back to controller'}</Button></View> : null}
    <Modal visible={Boolean(confirmStart && confirmStart===startKey)} transparent animationType="fade" onRequestClose={()=>setConfirmStart(null)}>
      <View style={styles.modalShade}><View style={[styles.card,styles.confirmCard]} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.subheading}>Start {title(seat?.sport)}?</Text>
        <Text style={styles.copy}>{seat?.players.length===1 ? 'Solo play' : `${seat?.players.length || 0} players`} · Everyone ready?</Text>
        <Button disabled={busy || !startKey} onPress={confirmGameStart}>Start now</Button>
        <Button quiet onPress={()=>setConfirmStart(null)}>Keep waiting</Button>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101626' }, page: { width:'100%',maxWidth:540,alignSelf:'center',padding: 20, paddingBottom: 28, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { fontSize: 24, fontWeight: '900', color: '#fff' }, brandAccent: { color: '#a6e8cf' },
  pill: { color: '#b9a9ff', fontSize: 10, fontWeight: '800', letterSpacing: 1.2,marginTop:4 }, status: { color: '#a6e8cf', fontSize: 13 },
  heading: { color: '#fff', fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -.8 }, subheading: { color: '#f6f5ff', fontSize: 20, fontWeight: '700' },
  copy: { color: '#c2cbdd', fontSize: 15, lineHeight: 23 }, small: { color: '#aab7ce', fontSize: 12,lineHeight:19 },
  card: { backgroundColor: '#1b2337', borderRadius: 22, padding: 20, gap: 15, borderWidth: 1, borderColor: '#2b354e' },
  eyebrow: { color: '#a6e8cf', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 }, field: { gap: 7 }, label: { color: '#ced6e8', fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: '#11182a', borderWidth: 1, borderColor: '#38445f', borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  button: { minHeight: 54, paddingVertical: 15, paddingHorizontal: 18, borderRadius: 16, backgroundColor: '#a6e8cf', alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  buttonText: { color: '#153328', fontWeight: '800', fontSize: 15, textAlign: 'center' }, quietButton: { backgroundColor: '#29334d', borderWidth: 1, borderColor: '#3a4666' }, quietText: { color: '#e0e5f4' }, disabled: { opacity: .4 }, pressed: { opacity: .7 },
  notice: { color: '#e7dcff', backgroundColor: '#302945', borderRadius: 12, padding: 14, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, stepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  meter: { color: '#a6e8cf', fontWeight: '700', fontSize: 18 }, cameraFrame: { gap: 12 }, camera: { height: 300, borderRadius: 20, overflow: 'hidden' },
  touchPad: { width: '100%', height: 200, borderRadius: 20, borderWidth: 1, borderColor: '#89cbb8', backgroundColor: '#1a3e3a', alignItems: 'center', justifyContent: 'center' }, touchText: { color: '#a6e8cf', fontWeight: '600' },
  playTitle:{fontSize:26,fontWeight:'800',color:'#f0fff9',textAlign:'center'},playHint:{fontSize:15,lineHeight:22,color:'#b9c8da',textAlign:'center'},
  compactScore:{borderTopWidth:1,borderTopColor:'#33405a',paddingTop:16,gap:5,alignItems:'center'},
  modalShade:{flex:1,backgroundColor:'#050d19cc',alignItems:'center',justifyContent:'center',padding:24},confirmCard:{width:'100%',maxWidth:420},
  backDock:{paddingHorizontal:20,paddingTop:12,paddingBottom:12,borderTopWidth:1,borderTopColor:'#33405a',backgroundColor:'#151e31',width:'100%',maxWidth:540,alignSelf:'center'},
  homeLead:{gap:16,alignItems:'center',paddingVertical:18},sportPreview:{flexDirection:'row',width:'100%',paddingBottom:16},previewIcon:{flex:1,alignItems:'center',gap:8},previewLabel:{fontSize:10,color:'#aab7ce',textAlign:'center'},
  sportGrid:{flexDirection:'row',flexWrap:'wrap',gap:12},sportTile:{flexBasis:'46%',flexGrow:1,alignItems:'center',justifyContent:'center',minHeight:124,padding:12,gap:6,borderWidth:1,borderColor:'#3a4666',borderRadius:18,backgroundColor:'#202c43'},
  sportSelected:{backgroundColor:'#1a3e3a',borderColor:'#a6e8cf'},comingSoon:{opacity:.55},tileTitle:{color:'#eff5ff',fontSize:14,fontWeight:'700',textAlign:'center'},
  sportHeading:{flexDirection:'row',alignItems:'center',gap:14},sportHeadingText:{flex:1,fontSize:28,lineHeight:34},
  scoreCard:{padding:16,gap:8,borderRadius:20,backgroundColor:'#172c32',alignItems:'center'},scoreRow:{flexDirection:'row',width:'100%',gap:12},scoreSide:{flex:1,alignItems:'center',gap:4},scoreValue:{fontSize:38,fontWeight:'800',color:'#ecfff7'},scoreDetail:{fontSize:14,fontWeight:'700',color:'#b9ebd7'},
  footer: { textAlign: 'center', color: '#7f8da7', fontSize: 12, marginTop: 10, lineHeight: 20 },
});
