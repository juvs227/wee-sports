import { createPrivateKey } from 'node:crypto';
import { World } from '../World/World';

export class Menu {
    private world: World;
    private paused: boolean = false;

    constructor(world: World) {
        this.world = world;
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.toggleMenu();
            }
        });
    }

    private toggleMenu(): void {
        console.log('Toggling menu');
        if (this.paused) {
            this.world.start();
        } else {
            this.world.stop();
        }
        this.paused = !this.paused;
    }
}