import * as THREE from 'three';

export class WorldCamera {
    public readonly primary: THREE.PerspectiveCamera;
    public readonly secondary: THREE.PerspectiveCamera;
    private splitScreen = false;

    public get isSplitScreen(): boolean {
        return this.splitScreen;
    }

    public constructor() {
        this.primary = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        this.primary.position.set(0, 4, 15);
        this.primary.lookAt(0, 0, 0);

        this.secondary = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        this.secondary.position.set(0, 4, -15);
        this.secondary.lookAt(0, 0, 0);
    }

    public setSplitScreen(enabled: boolean, width: number, height: number): void {
        this.splitScreen = enabled;
        this.updateAspectRatios(width, height);
    }

    public resize(width: number, height: number): void {
        this.updateAspectRatios(width, height);
    }

    public render(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
        width: number, height: number): void {
        if (!this.splitScreen) {
            renderer.setViewport(0, 0, width, height);
            renderer.render(scene, this.primary);
            return;
        }

        const halfWidth = width / 2;
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, halfWidth, height);
        renderer.setViewport(0, 0, halfWidth, height);
        renderer.render(scene, this.primary);
        renderer.setScissor(halfWidth, 0, halfWidth, height);
        renderer.setViewport(halfWidth, 0, halfWidth, height);
        renderer.render(scene, this.secondary);
        renderer.setScissorTest(false);
    }

    private updateAspectRatios(width: number, height: number): void {
        const viewWidth = this.splitScreen ? width / 2 : width;
        this.primary.aspect = viewWidth / height;
        this.primary.updateProjectionMatrix();
        this.secondary.aspect = viewWidth / height;
        this.secondary.updateProjectionMatrix();
    }
}
