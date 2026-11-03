import { World } from '../World/World';
import './css/menu.css';
import './css/pause.css';

export class Menu {
    private paused: boolean = false;
    private world: World;
    private menu: HTMLElement = document.createElement('div') as HTMLDivElement;
    private resumeButton: HTMLElement;
    private resetButton: HTMLElement;
    private pauseButton: HTMLElement = document.createElement('button') as HTMLButtonElement;

    constructor(world: World) {
        // Set the world instance
        this.world = world;

        // Set up the menu overlay
        this.menu.id = 'pause-menu';
        this.menu.className = 'overlay';
        this.menu.hidden = true;
        this.menu.innerHTML =
        `
            <div class="panel" role="dialog" aria-modal="true" aria-labelledby="pause-title">
                <h2 id="pause-title">Paused</h2>
                <button id="resume">Resume</button>
                <button id="reset">Reset</button>
                <button id="quit">Quit</button>
            </div>
        `;
        document.body.appendChild(this.menu);

        // Get references to the buttons
        this.resumeButton = document.getElementById('resume') as HTMLButtonElement;
        this.resetButton = document.getElementById('reset') as HTMLButtonElement;

        // Set up pause button
        this.pauseButton.id = 'pause-btn';
        this.pauseButton.setAttribute('aria-label', 'Pause');
        this.pauseButton.innerHTML =
        `
            <svg class="icon-pause" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
            <svg class="icon-play" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                <polygon points="7,4 20,12 7,20" />
            </svg>
        `;
        document.body.appendChild(this.pauseButton);

        // Add event listeners
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
            console.log('Click!');
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