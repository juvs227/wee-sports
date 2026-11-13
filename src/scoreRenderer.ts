import type { Score } from './Tennis/scoreSystem';

export type TennisScore = number;

export function renderScore(element: HTMLElement, score: Score): void {
    element.textContent = `Points ${score.player1}–${score.player2} · Sets ${score.setsPlayer1}–${score.setsPlayer2}`;
}
