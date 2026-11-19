import {EVENTS} from '../../../shared/protocol.js';

const failure = response => new Error(response?.error === 'outcome-unknown'
  ? 'The outcome is unknown. Check the TV before trying another roll.'
  : 'That roll could not be confirmed. Check the TV and try again when ready.');

/** One unresolved delivery belongs to one session, game and bowling turn.
 * Pause generations can change without resolving it; a new match cannot
 * inherit it. Async replies must still own their original ticket to affect UI.
 */
export class NativeBowlingActions {
  constructor({session, changed = () => {}, notice = () => {}, retry = () => {}}) {
    Object.assign(this, {session,changed,notice,retry});
    this.ticket = null;
    this.unknown = null;
  }

  current(ticket) {
    const session = this.session();
    return ticket && this.ticket === ticket && session === ticket.session &&
      session.seat?.gameId === ticket.gameId && session.bowlingTurnKey === ticket.turnKey;
  }

  reset(notify = true) {
    this.ticket = this.unknown = null;
    if (notify) this.changed(null);
  }

  observe() {
    if (this.ticket && (!this.current(this.ticket) ||
        ['rolling','complete'].includes(this.session()?.seat?.gameState?.phase))) this.reset();
  }

  allowRetry(ticket) {
    if (!this.current(ticket)) return;
    this.reset();
    ticket.session.bowlingReleasedTurn = null;
    this.retry(ticket.session);
  }

  async release(roll) {
    this.observe();
    if (this.ticket) throw new Error('Wait for the TV to resolve the previous roll.');
    const session = this.session();
    const ticket = {session,gameId:session.seat?.gameId,turnKey:session.bowlingTurnKey};
    this.ticket = ticket;
    this.changed({status:'pending',gameId:ticket.gameId});
    const accepted = await session.action(EVENTS.PLAYER_ROLL, {type:'roll',power:roll.power,spin:roll.spin,aim:roll.aim});
    this.observe();
    if (!this.current(ticket)) return;
    if (!accepted.ok && accepted.error !== 'outcome-unknown') this.allowRetry(ticket);
    else {
      this.unknown = accepted.error === 'outcome-unknown' ? {id:accepted.id,gameId:ticket.gameId,status:'unknown'} : null;
      this.changed(this.unknown || {status:'pending',gameId:ticket.gameId});
    }
    if (!accepted.ok) throw failure(accepted);
    this.notice('Roll accepted by the TV');
  }

  async check() {
    this.observe();
    const ticket = this.ticket, unknown = this.unknown;
    if (!ticket || !unknown || !this.current(ticket)) return;
    const checked = await ticket.session.request(EVENTS.PLAYER_ACTION_STATUS, {id:unknown.id,gameId:ticket.gameId});
    this.observe();
    if (!this.current(ticket) || this.unknown !== unknown) return;
    if (!checked?.ok) throw failure(checked);
    if (checked.status === 'rejected') {
      this.allowRetry(ticket);
      this.notice('The TV rejected that roll. You may try a new delivery.');
    } else if (checked.status === 'accepted') {
      this.unknown = null;
      this.changed({status:'pending',gameId:ticket.gameId});
      this.notice('The TV accepted that roll. Wait for it to finish.');
    } else this.notice('The roll is still unresolved. Check the TV; no duplicate will be sent.');
  }
}
