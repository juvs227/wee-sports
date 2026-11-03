import './css/menu.css';
import './css/pause.css';

type MenuCallbacks = {
    onPauseChange: (paused: boolean) => void;
    onReset: () => void;
    onQuit?: () => void;
};

export class Menu {
    private paused: boolean = false;
    private menu: HTMLDivElement = document.createElement('div');
    private resumeButton: HTMLButtonElement;
    private resetButton: HTMLButtonElement;
    private quitButton: HTMLButtonElement;
    private pauseButton: HTMLButtonElement = document.createElement('button');

    constructor(private anchor: HTMLElement, private callbacks: MenuCallbacks) {
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
                <button id="quit">Return to Lobby</button>
            </div>
        `;
        this.anchor.appendChild(this.menu);

        // Get references to the buttons
        this.resumeButton = this.menu.querySelector('#resume')!;
        this.resetButton = this.menu.querySelector('#reset')!;
        this.quitButton = this.menu.querySelector('#quit')!;
        this.quitButton.hidden = !this.callbacks.onQuit;

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
        this.anchor.classList.add('pause-button-anchor');
        this.anchor.appendChild(this.pauseButton);

        // Add event listeners
        window.addEventListener('keydown', this.handleKeyDown);
        this.resumeButton.addEventListener('click', this.handleResume);
        this.resetButton.addEventListener('click', this.handleReset);
        this.quitButton.addEventListener('click', this.handleQuit);
        this.pauseButton.addEventListener('click', this.handlePauseButton);
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') this.toggle();
    };

    private readonly handleResume = (): void => {
        this.toggle();
    };

    private readonly handleReset = (): void => {
        this.toggle();
        this.callbacks.onReset();
    };

    private readonly handleQuit = (): void => {
        this.callbacks.onQuit?.();
    };

    private readonly handlePauseButton = (): void => {
        this.toggle();
    };

    get isPaused(): boolean {
        return this.paused;
    }

    public toggle(): void {
        this.paused = !this.paused;
        this.pauseButton.classList.toggle('is-paused', this.paused);
        this.pauseButton.setAttribute('aria-pressed', String(this.paused));
        this.pauseButton.setAttribute('aria-label', this.paused ? 'Resume' : 'Pause');
        this.menu.hidden = !this.paused;
        this.callbacks.onPauseChange(this.paused);
    }

    public dispose(): void {
        window.removeEventListener('keydown', this.handleKeyDown);
        this.resumeButton.removeEventListener('click', this.handleResume);
        this.resetButton.removeEventListener('click', this.handleReset);
        this.quitButton.removeEventListener('click', this.handleQuit);
        this.pauseButton.removeEventListener('click', this.handlePauseButton);
        this.menu.remove();
        this.pauseButton.remove();
        this.anchor.classList.remove('pause-button-anchor');
    }
}