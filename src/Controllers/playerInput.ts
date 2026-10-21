
export interface PlayerInput {
    moveX: number;
    moveZ: number;
    swing?: 'left' | 'right';
}

export const NEUTRAL_INPUT: PlayerInput = {
    moveX: 0,
    moveZ: 0,
};
