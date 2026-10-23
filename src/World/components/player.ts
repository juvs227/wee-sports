// components/player.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PlayerController {
    group: THREE.Group;
    racket: THREE.Object3D | null;
    handSocket: THREE.Object3D | null;
    mixer: THREE.AnimationMixer | null;
    actions: Record<string, THREE.AnimationAction>;
    currentAnimation: string | null;
    isSwinging: boolean;

    playAnimation: (name: string) => void;
    stopAnimation: () => void;
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
        racket: null,
        handSocket: null,
        mixer: null,
        actions: {},
        currentAnimation: null,
        isSwinging: false,

        playAnimation(name: string): void {
            const next = this.actions[name];

            if (!next) {
                return;
            }

            if (this.currentAnimation === name) {
                return;
            }

            const previous = this.currentAnimation
                ? this.actions[this.currentAnimation]
                : undefined;

            if (previous && previous !== next) {
                previous.stop();
            }

            next.reset();
            next.enabled = true;
            next.setEffectiveTimeScale(1);
            next.setEffectiveWeight(1);
            const isSwing = name.startsWith('Swing');
            next.setLoop(
                isSwing ? THREE.LoopOnce : THREE.LoopRepeat,
                isSwing ? 1 : Infinity
            );
            next.clampWhenFinished = isSwing;
            next.fadeIn(0.12);
            next.play();

            this.currentAnimation = name;
            this.isSwinging = isSwing;
        },

        stopAnimation(): void {
            Object.values(this.actions).forEach((action) => {
                action.stop();
            });
            this.currentAnimation = null;
            this.isSwinging = false;
        },

        update(delta: number): void {
            // Only update the animation mixer; no manual quaternion hacks
            this.mixer?.update(delta);
        },

        move(dx: number, dz: number, delta: number): void {
            if (Math.abs(dx) + Math.abs(dz) <= 0.01) {
                return;
            }

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
            // unnecessary rotation for now, as the player model is facing forward by default
            // this.group.rotation.y = Math.atan2(nx, nz);
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
                controller.mixer.addEventListener('finished', (event) => {
                    const action = event.action;

                    if (
                        action === controller.actions['SwingLeft'] ||
                        action === controller.actions['SwingRight']
                    ) {
                        action.stop();
                        controller.isSwinging = false;
                        controller.currentAnimation = null;
                    }
                });

                for (const clip of gltf.animations) {
                    controller.actions[clip.name] =
                        controller.mixer.clipAction(clip);
                }

                const initialAnimation = controller.actions['Idle']
                    ? 'Idle'
                    : controller.actions['WalkCycle']
                        ? 'WalkCycle'
                        : null;

                if (initialAnimation) {
                    controller.playAnimation(initialAnimation);
                }
            }

            // Find the HandSocket bone/object inside the model hierarchy
            const handSocket = model.getObjectByName('HandSocket');

            if (handSocket) {
                controller.handSocket = handSocket;

                loader.load(
                    racketPath,
                    (racketGltf) => {
                        const racketScene = racketGltf.scene;
                        racketScene.scale.set(racketScale, racketScale, racketScale);
                        
                        handSocket.add(racketScene);
                        controller.racket = racketScene;
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