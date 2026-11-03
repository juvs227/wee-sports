import type { Score } from './Tennis/scoreSystem';

export type TennisScore = 0 | 15 | 30 | 40 | "Adv" | "Win";

export function renderScore(element: HTMLElement, score: Score): void {
    element.textContent =

        `${score.roundsPlayer1} - ${score.roundsPlayer2}` + ` ${score.player1} - ${score.player2} `;
}
