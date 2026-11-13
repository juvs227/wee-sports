import { EVENTS } from '../../../shared/protocol.js';

/** One user play intent survives reconnects. Every sensor restart still needs
 * fresh readings and a server-accepted setup before this controller is ready.
 */
export class AutomaticControllerSetup {
  constructor({session, makeMotion, changed = () => {}, notice = () => {}}) {
    this.session = session;
    this.makeMotion = makeMotion;
    this.changed = changed;
    this.notice = notice;
    this.mode = 'motion';
    this.requestedMode = 'motion';
    this.motionIssue = null;
    this.attempt = 0;
    this.online = false;
    this.setup = null;
    this.running = false;
    this.motion = null;
    this.playIntent = true;
  }

  update(seat, connection) {
    const returningToLobby = this.phase === 'game' && ['lobby','vote','ready'].includes(seat?.phase);
    this.phase = seat?.phase;
    const scope = seat && Number.isInteger(seat.slot) ? `${seat.code}:${seat.slot}:${seat.sport}` : null;
    const changedScope = scope !== this.scope;
    this.scope = scope;
    if ((changedScope && scope) || returningToLobby) {this.playIntent = true; this.readyKey = null;}
    if (seat?.phase === 'game') this.playIntent = false;
    const wasOnline = this.online;
    this.online = connection === 'online' && Boolean(scope);
    if (!this.online) { this.stop(); return; }
    if ((changedScope || !wasOnline) && this.requestedMode === 'motion') {this.mode = 'motion'; this.motionIssue = null;}
    const player = seat.players?.find(value => value.slot === seat.slot);
    if (changedScope || (this.setup && player?.setup === null)) this.stop();
    this.changed({mode:this.setup === 'buttons' ? 'touch' : this.mode,setup:this.setup,playIntent:this.playIntent,motionIssue:this.motionIssue});
    if (!this.running) this.start();
    else this.ready();
  }

  async start() {
    if (!this.online || this.running) return;
    this.running = true;
    const attempt = ++this.attempt;
    this.setup = null;
    const mode = this.mode;
    this.changed({mode,setup:null,state:'starting',motionIssue:this.motionIssue});
    this.session.inputSetup = null;
    const player = this.session.seat?.players?.find(value => value.slot === this.session.seat.slot);
    if (player?.setup) {
      await this.session.request(EVENTS.PLAYER_SETUP, {setup:null});
      if (attempt !== this.attempt || !this.online) return;
    }
    if (mode === 'touch') { await this.accept('buttons', attempt); return; }
    this.motion = this.makeMotion(status => {
      if (attempt !== this.attempt) return;
      if (status.state === 'ready') this.motionReady = true;
      if (status.state === 'warming' || status.state === 'no-readings') this.motionReady = false;
      this.changed({mode:'motion',setup:this.setup,...status});
      if (status.state === 'ready' && !this.setup && !this.accepting) this.accept('motion', attempt);
      if (status.state === 'warming' && this.setup) {
        this.setup = null; this.session.inputSetup = null; this.readyKey = null;
        this.session.request(EVENTS.PLAYER_SETUP, {setup:null});
      }
      if (status.state === 'no-readings') this.fallback(attempt, {code:status.reason || 'motion-no-readings',message:'Motion did not start. Try motion again, or keep playing with touch.'});
    });
    try { await this.motion.calibrate(); }
    catch (error) { this.fallback(attempt, error); }
  }

  async accept(setup, attempt) {
    if (attempt !== this.attempt || !this.online) return;
    this.accepting = true;
    const response = await this.session.request(EVENTS.PLAYER_SETUP, {setup});
    if (attempt !== this.attempt || !this.online) return;
    this.accepting = false;
    if (setup === 'motion' && !this.motionReady) {
      await this.session.request(EVENTS.PLAYER_SETUP, {setup:null});
      return;
    }
    if (!response?.ok) {
      this.notice('Could not start yet. Reconnect to your TV and try again.');
      this.stop();
      return;
    }
    this.setup = setup;
    this.session.inputSetup = setup;
    this.changed({mode:setup === 'buttons' ? 'touch' : 'motion',setup,state:'ready',motionIssue:this.motionIssue});
    this.ready();
  }

  async ready() {
    const seat = this.session.seat;
    if (!this.online || !seat || seat.paused || this.readyPending || !this.playIntent) return;
    const player = seat.players?.find(value => value.slot === seat.slot);
    const event = seat.phase === 'vote' ? EVENTS.TUTORIAL_VOTE :
      seat.phase === 'ready' && this.setup && !player?.ready ? EVENTS.PLAYER_READY : null;
    if (!event) return;
    const key = `${seat.gameId}:${seat.sport}:${seat.inputGeneration}:${event}`;
    if (key === this.readyKey) return;
    this.readyPending = true;
    const attempt = this.attempt;
    const response = await this.session.request(event, event === EVENTS.TUTORIAL_VOTE ? {watch:false} : {ready:true,skipTutorial:true});
    if (attempt !== this.attempt) return;
    this.readyPending = false;
    if (response?.ok) this.readyKey = key;
  }

  fallback(attempt, error = {}) {
    if (attempt !== this.attempt) return;
    this.motionIssue = {code:error.code || 'motion-unavailable',message:error.message || 'Motion is unavailable. Try again or use touch controls.'};
    this.mode = 'touch';
    this.stop();
    if (this.online) this.start();
  }

  play() {
    this.playIntent = true;
    this.readyKey = null;
    this.changed({mode:this.setup === 'buttons' ? 'touch' : this.mode,setup:this.setup,playIntent:true});
    this.ready();
  }

  async waitForFriends() {
    this.playIntent = false;
    this.readyKey = null;
    this.changed({mode:this.setup === 'buttons' ? 'touch' : this.mode,setup:this.setup,playIntent:false});
    if (this.online && ['ready','countdown'].includes(this.session.seat?.phase)) {
      await this.session.request(EVENTS.PLAYER_READY, {ready:false});
    }
  }

  select(mode) {
    this.requestedMode = mode;
    this.motionIssue = null;
    this.mode = mode;
    this.stop();
    if (this.online) this.start();
  }

  startGame() {
    return this.session.request(EVENTS.PLAYER_START, {});
  }

  stop() {
    this.attempt++;
    this.motion?.stop();
    this.motion = null;
    this.setup = null;
    this.session.inputSetup = null;
    this.running = false;
    this.accepting = false;
    this.motionReady = false;
    this.readyPending = false;
    this.readyKey = null;
  }
}
