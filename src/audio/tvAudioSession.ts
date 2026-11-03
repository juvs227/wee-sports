interface AudioOutput {
  play(event: string): boolean;
  stop(event?: string): void;
  setActive(active: boolean): void;
}

export interface TvAudioState {
  gameId: string | null;
  phase: string | null;
  paused: boolean;
}

/** One TV audio lifetime, independent of iframe remounts and lobby snapshots. */
export function createTvAudioSession(sound: AudioOutput) {
  let state: TvAudioState = {gameId: null, phase: null, paused: true};
  let countedGame: string | null = null;
  let startedGame: string | null = null;
  let lowestTick = Infinity;

  function update(next: TvAudioState) {
    if (next.gameId !== state.gameId) {
      sound.stop();
      countedGame = null;
      startedGame = null;
      lowestTick = Infinity;
    }
    sound.setActive(!next.paused);
    if (next.phase === 'countdown' && next.gameId) countedGame = next.gameId;
    if (
      next.phase === 'tutorial' &&
      next.gameId &&
      startedGame !== next.gameId
    ) {
      // Observe completion even while paused/muted; reconnect must not replay it.
      startedGame = next.gameId;
      if (!next.paused && countedGame === next.gameId) sound.play('start');
    }
    if (next.phase !== 'countdown' && next.phase !== 'tutorial') sound.stop();
    state = next;
  }

  function countdown(seconds: number) {
    if (
      state.phase !== 'countdown' ||
      !state.gameId ||
      state.paused ||
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 5 ||
      seconds >= lowestTick
    )
      return;
    // A re-pinned clock or resumed tab cannot repeat or replay expired numbers.
    lowestTick = seconds;
    sound.play(
      seconds === 1
        ? 'countdown-1'
        : seconds === 2
          ? 'countdown-2'
          : 'countdown',
    );
  }

  function gameEvent(event: string) {
    if (event === 'stop' || event === 'roll-end') {
      sound.stop(event === 'roll-end' ? 'roll' : undefined);
      return;
    }
    if (!state.gameId || state.phase !== 'tutorial' || state.paused) return;
    sound.play(event);
  }

  return {update, countdown, gameEvent};
}
