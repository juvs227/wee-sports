import { World } from '../World/World';

export class Menu {
    private paused: boolean = false;
    private world: World;
    private menu: HTMLElement = document.getElementById('pause-menu') as HTMLElement;
    private resumeButton: HTMLButtonElement = document.getElementById('resume') as HTMLButtonElement;
    private resetButton: HTMLButtonElement = document.getElementById('reset') as HTMLButtonElement;
    private pauseButton: HTMLButtonElement = document.getElementById('pause-btn') as HTMLButtonElement;

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
        this.resetButton.addEventListener('click', () => {
            this.toggleMenu();
            this.world.resetRound();
        });
        this.pauseButton.addEventListener('click', () => {
            this.toggleMenu();
        });
    }

    // This will trigger the menu to pause the game and show the menu overlay,
    // and resume the game and hide the menu overlay when toggled again, 
    // going back and forth between the two states.
    private toggleMenu(): void {
        if (this.paused) {
            this.world.start();
        } else {
            this.world.stop();
        }
        this.pauseButton.classList.toggle('is-paused', !this.paused);
        this.pauseButton.setAttribute('aria-pressed', !this.paused ? 'Resume' : 'Pause');
        this.menu.hidden = this.paused;
        this.paused = !this.paused;
    }
}