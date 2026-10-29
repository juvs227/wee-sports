import { World } from '../World/World';

export class Menu {
    private world: World;
    private menu: HTMLElement = document.getElementById('pause-menu') as HTMLElement;
    private resumeButton: HTMLButtonElement = document.getElementById('resume') as HTMLButtonElement;
    private resetButton: HTMLButtonElement = document.getElementById('reset') as HTMLButtonElement;

    constructor(world: World) {
        this.world = world;
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.toggleMenu();
            }
        });
        this.resumeButton.addEventListener('click', () => {
            this.toggleMenu();
        });
    }

    // This will trigger the menu to pause the game and show the menu overlay,
    // and resume the game and hide the menu overlay when toggled again, 
    // going back and forth between the two states.
    private toggleMenu(): void {
        console.log('Toggling menu');
        if (!this.menu.hidden) {
            this.world.start();
        } else {
            this.world.stop();
        }
        this.menu.hidden = !this.menu.hidden;
    }

    // TODO: Implement resetting game in either World.ts or gameLogic.ts, and call that function here when the reset button is clicked.
}