import {SPORT_REGISTRY} from '../../../shared/sportRegistry.js';

export const CONTROLLER_SPORTS = ['tennis', 'bowling', 'golf'];
export const sportTitle = sport => SPORT_REGISTRY[sport]?.name || (sport === 'golf' ? 'Golf' : 'Wee Sports');
export function sportChoice(sport, seat) {
  const entry=SPORT_REGISTRY[sport];
  return {title:sportTitle(sport),available:Boolean(entry),
    capacity:entry?.players.max || 0,
    fits:Boolean(entry) && (seat?.players?.length || 0)<=entry.players.max,
    caption:entry ? `1–${entry.players.max} players` : 'Coming soon'};
}
export function playerName(seat, number) {
  return seat?.players?.find(player=>player.slot+1===number)?.name ||
    (number===2 && seat?.sport!=='bowling' ? 'Bot' : `Player ${number}`);
}

export function waitingForTv(seat) {
  return Boolean(seat?.reconnecting?.some(member => member.role === 'host' || (!member.role && member.name === 'TV')));
}

/** One primary play message, with connection/pause taking priority over turns. */
export function controllerPlayState(seat, status, setup) {
  if (seat?.gameState?.phase === 'complete') return {title:'Match complete', hint:'See the result on your TV.', active:false};
  if (status !== 'online') return {title:'Reconnecting', hint:'You can wait here or go home and return while the room is available.', active:false};
  if (waitingForTv(seat)) return {title:'Waiting for the TV', hint:'Reopen this room on the TV, or go home on your phone.', active:false};
  if (seat?.paused) return {title:'Game paused', hint:'Your controller is ready when play resumes.', active:false};
  if (!setup) return {title:'Getting ready', hint:'Connecting your controls…', active:false};
  if (seat?.phase !== 'game') return {title:'Watch the TV', hint:'Your game is about to begin.', active:false};
  if (!seat.gameState) return {title:'Get ready', hint:'Your game is loading on the TV.', active:false};
  if (seat.sport === 'bowling') {
    if (seat.gameState?.currentPlayer !== seat.slot + 1) return {title:'Watch the TV', hint:`${playerName(seat,seat.gameState?.currentPlayer)} is bowling.`, active:false};
    if (seat.gameState?.phase !== 'ready') return {title:'Nice roll', hint:'Watch your ball on the TV.', active:false};
    return {title:'Your turn', hint:'Tilt to aim. Swing gently forward.', active:true};
  }
  return {title:'Swing to play', hint:'Small swings. Watch the ball on your TV.', active:true};
}
export function matchSummary(seat) {
  const state=seat?.gameState;
  if (!state || seat.phase!=='game') return null;
  const complete=state.phase==='complete';
  const winners=complete ? seat.sport==='bowling' ? state.winners || [] : state.winner ? [state.winner] : [] : [];
  const result=winners.length ? winners.map(number=>playerName(seat,number)).join(' & ') + (winners.length>1 ? ' share first place' : ' wins!') : complete ? 'Match complete' : null;
  if(seat.sport==='bowling')return {label:`Frame ${state.frame} of 10`,detail:complete ? Number.isInteger(state.winnerScore) ? `${state.winnerScore} points` : ''
    : state.currentPlayer===seat.slot+1 ? 'Your turn' : `${playerName(seat,state.currentPlayer)} is bowling`,result};
  const score=Array.isArray(state.score) && state.score.length===2 ? state.score : null;
  const names=[playerName(seat,1),playerName(seat,2)];
  if(seat.sport==='tennis') {
    const completed=Array.isArray(state.completedSets) ? state.completedSets.length : 0;
    const set=Math.max(1,Math.min(3,completed+(complete ? 0 : 1)));
    return {label:state.practice ? 'Practice' : `Set ${set} · Best of 3`,score,names,result,
      detail:state.practice ? 'Your match score is saved' : 'First to 7 points · Win by 2',
      tally:Array.isArray(state.sets) ? `${state.sets[0]}–${state.sets[1]} sets` : null};
  }
  return null;
}
