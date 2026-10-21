import { PlayerInput, NEUTRAL_INPUT } from './playerInput';

export class InputController {
    private input: PlayerInput = { ...NEUTRAL_INPUT };
    private keysPressed: Record<string, boolean> = {};

    constructor(private onInputChange: (input: PlayerInput) => void) {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    private updateInputFromKeys(): void {
        // Reset movement directions
        let moveX = 0;
        let moveZ = 0;

        // Map WASD / Arrow keys
        if (this.keysPressed['w'] || this.keysPressed['arrowup']) moveZ -= 1;
        if (this.keysPressed['s'] || this.keysPressed['arrowdown']) moveZ += 1;
        if (this.keysPressed['a'] || this.keysPressed['arrowleft']) moveX -= 1;
        if (this.keysPressed['d'] || this.keysPressed['arrowright']) moveX += 1;

        this.input.moveX = moveX;
        this.input.moveZ = moveZ;

        // Swing mapping (e.g., J for left swing, K for right swing)
        if (this.keysPressed['j']) {
            this.input.swing = 'left';
        } else if (this.keysPressed['k']) {
            this.input.swing = 'right';
        } else {
            this.input.swing = undefined;
        }

        // Notify listener
        this.onInputChange(this.input);
        this.input.swing = undefined;
    }

    private handleKeyDown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (this.keysPressed[key]) return; // Prevent repeat triggers from holding down
        this.keysPressed[key] = true;
        this.updateInputFromKeys();
    };

    private handleKeyUp = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        this.keysPressed[key] = false;
        this.updateInputFromKeys();
    };

    public dispose(): void {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    }
}