import { predictBaselineIntercept, type BallForecast } from './autoPosition.ts';

export interface BotStroke {
    backhand: boolean;
    duration: number;
    offset: { x: number; y: number; z: number };
}

const CONTACT_START = 0.2;
const CONTACT_END = 0.7;
const POSITION_TOLERANCE_X = 0.75;
const POSITION_TOLERANCE_Y = 0.7;

// Player 2 tries one timed stroke when an incoming ball is about to reach the
// strike pose. It must still make ordinary racket contact; no guaranteed hit.
export function chooseBotStroke(ball: BallForecast,
    position: { x: number; y: number; z: number }, strokes: BotStroke[]): BotStroke | null {
    if (ball.velocity.z >= -0.001) return null;
    let selected: BotStroke | null = null;
    let bestError = Infinity;
    for (const stroke of strokes) {
        if (!Number.isFinite(stroke.duration) || stroke.duration <= 0) continue;
        const intercept = predictBaselineIntercept(ball, position.z + stroke.offset.z);
        if (!intercept || intercept.time > stroke.duration * CONTACT_END ||
            intercept.time < stroke.duration * (CONTACT_START * 0.5)) continue;
        const dx = Math.abs(intercept.x - position.x - stroke.offset.x);
        const dy = Math.abs(intercept.y - position.y - stroke.offset.y);
        if (dx > POSITION_TOLERANCE_X || dy > POSITION_TOLERANCE_Y) continue;
        const error = dx + dy + Math.abs(intercept.time - stroke.duration * 0.45);
        if (error < bestError) { bestError = error; selected = stroke; }
    }
    return selected;
}
