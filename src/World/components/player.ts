
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PlayerController {
    group: THREE.Group;
    mixer: THREE.AnimationMixer | null;
    actions: Record<string, THREE.AnimationAction>;
    currentAnimation: string | null;

    playAnimation: (name: string) => void;
    update: (delta: number) => void;
    move: (dx: number, dz: number, delta: number) => void;
    setPosition: (x: number, z: number) => void;
}

export interface PlayerOptions {
    minX?: number;
    maxX?: number;
    minZ?: number;
    maxZ?: number;
    speed?: number;
    modelPath?: string;
    racketPath?: string;
    scale?: number;
    racketScale?: number;
}

export function createPlayer(
    x: number = 0,
    y: number = 0,
    z: number = 0,
    color: number = 0x00ff00,
    options: PlayerOptions = {}
): PlayerController {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const {
        minX = -4,
        maxX = 4,
        minZ = -10,
        maxZ = 10,
        speed = 4,
        modelPath = './assets/player.glb',
        racketPath = './assets/racket.glb',
        scale = 0.2,
        racketScale = 0.4,
    } = options;

    const loader = new GLTFLoader();

    const controller: PlayerController = {
        group,
        mixer: null,
        actions: {},
        currentAnimation: null,

        playAnimation(name: string): void {
            const next = this.actions[name];

            if (!next) {
                return;
            }

            if (this.currentAnimation === name && next.isRunning()) {
                return;
            }

            const previous = this.currentAnimation
                ? this.actions[this.currentAnimation]
                : undefined;

            if (previous && previous !== next) {
                previous.fadeOut(0.12);
            }

            next.reset();
            next.enabled = true;
            next.setEffectiveTimeScale(1);
            next.setEffectiveWeight(1);
            next.fadeIn(0.12);
            next.play();

            this.currentAnimation = name;
        },

        update(delta: number): void {
            this.mixer?.update(delta);
        },

        move(dx: number, dz: number, delta: number): void {
            const moving = Math.abs(dx) + Math.abs(dz) > 0.01;

            if (moving) {
                const length = Math.hypot(dx, dz);
                const nx = dx / length;
                const nz = dz / length;

                this.group.position.x = THREE.MathUtils.clamp(
                    this.group.position.x + nx * speed * delta,
                    minX,
                    maxX
                );

                this.group.position.z = THREE.MathUtils.clamp(
                    this.group.position.z + nz * speed * delta,
                    minZ,
                    maxZ
                );

                // Face the direction of travel.
                this.group.rotation.y = Math.atan2(nx, nz);

                if (this.actions['WalkCycle']) {
                    this.playAnimation('WalkCycle');
                }
            } else if (this.actions['Idle']) {
                this.playAnimation('Idle');
            }
        },

        setPosition(newX: number, newZ: number): void {
            this.group.position.x = THREE.MathUtils.clamp(
                newX,
                minX,
                maxX
            );

            this.group.position.z = THREE.MathUtils.clamp(
                newZ,
                minZ,
                maxZ
            );
        },
    };

    loader.load(
        modelPath,
        (gltf) => {
            const model = gltf.scene;
            model.scale.set(scale, scale, scale);
            model.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) {
                    return;
                }

                child.castShadow = true;
                child.receiveShadow = true;

                // Clone materials so recoloring one player does not
                // unintentionally recolor another player.
                const recolor = (material: THREE.Material) => {
                    const cloned = material.clone();

                    if ('color' in cloned) {
                        (cloned as THREE.MeshStandardMaterial)
                            .color.setHex(color);
                    }

                    return cloned;
                };

                if (Array.isArray(child.material)) {
                    child.material = child.material.map(recolor);
                } else {
                    child.material = recolor(child.material);
                }
            });

            group.add(model);

            // Set up animation clips.
            if (gltf.animations.length > 0) {
                controller.mixer = new THREE.AnimationMixer(model);

                for (const clip of gltf.animations) {
                    controller.actions[clip.name] =
                        controller.mixer.clipAction(clip);
                }

                // Prefer the requested animation names if present.
                const initialAnimation = controller.actions['Idle']
                    ? 'Idle'
                    : controller.actions['WalkCycle']
                        ? 'WalkCycle'
                        : null;

                if (initialAnimation) {
                    controller.playAnimation(initialAnimation);
                }
            }

            // Attach the racket to the animated hand socket.
            const handSocket = model.getObjectByName('HandSocket');

            if (handSocket) {
                loader.load(
                    racketPath,
                    (racketGltf) => {

                        const racketScene = racketGltf.scene;
                        racketScene.scale.set(racketScale, racketScale, racketScale);
                        handSocket.add(racketScene);
                    },
                    undefined,
                    (error) => {
                        console.error('Failed to load racket:', error);
                    }
                );
            } else {
                console.warn(
                    'HandSocket not found in player model. ' +
                    'The racket was not attached.'
                );
            }
        },
        undefined,
        (error) => {
            console.error('Failed to load player model:', error);
        }
    );

    return controller;
}
