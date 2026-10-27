// components/player.ts
import * as THREE from 'three';
import { forehandDrop, worldOffsetToLocal, DEFAULT_FOREHAND_DROP } from './forehandPose';
import { RacketHitbox, contactWindowCrossed } from './racketContact';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PlayerController {
    group: THREE.Group;
    racket: THREE.Object3D | null;
    handSocket: THREE.Object3D | null;
    mixer: THREE.AnimationMixer | null;
    actions: Record<string, THREE.AnimationAction>;
    currentAnimation: string | null;
    isSwinging: boolean;
    hitbox: RacketHitbox | null;
    contactActive: boolean;
    hitConsumed: boolean;
    swingBackhand: boolean;
    strikeOffsets: Record<string, THREE.Vector3>;

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
    forehandDrop?: number;
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
        modelPath = '/assets/player.glb',
        racketPath = '/assets/racket.glb',
        scale = 0.2,
        racketScale = 0.4,
        forehandDrop: forehandDropAmount = DEFAULT_FOREHAND_DROP,
    } = options;

    const loader = new GLTFLoader();
    let handBone: THREE.Object3D | null = null;
    const appliedHandOffset = new THREE.Vector3();
    function clearHandOffset(): void {
        handBone?.position.sub(appliedHandOffset);
        appliedHandOffset.set(0, 0, 0);
    }

    const controller: PlayerController = {
        group,
        racket: null,
        handSocket: null,
        mixer: null,
        actions: {},
        currentAnimation: null,
        isSwinging: false,
        hitbox: null,
        contactActive: false,
        hitConsumed: false,
        swingBackhand: false,
        strikeOffsets: {},

        playAnimation(name: string): void {
            const next = this.actions[name];

            if (!next) {
                return;
            }

            if (this.currentAnimation === name) {
                return;
            }

            clearHandOffset();
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
            this.contactActive = false;
            if (isSwing) this.hitConsumed = false;
        },

        stopAnimation(): void {
            clearHandOffset();
            Object.values(this.actions).forEach((action) => {
                action.stop();
            });
            this.currentAnimation = null;
            this.isSwinging = false;
            this.contactActive = false;
        },

        update(delta: number): void {
            clearHandOffset();
            const action = this.currentAnimation ? this.actions[this.currentAnimation] : undefined;
            const duration = action?.getClip().duration ?? 0;
            this.contactActive = this.isSwinging && !this.hitConsumed && !!action && duration > 0 &&
                contactWindowCrossed(action.time / duration, (action.time + delta) / duration,
                    this.swingBackhand);
            this.mixer?.update(delta);
            if (this.isSwinging && action && duration > 0 && handBone?.parent) {
                const drop = forehandDrop(action.time / duration, this.swingBackhand, forehandDropAmount);
                handBone.parent.updateWorldMatrix(true, false);
                appliedHandOffset.copy(worldOffsetToLocal(handBone.parent.matrixWorld, new THREE.Vector3(0, -drop, 0)));
                handBone.position.add(appliedHandOffset);
            }
        },

        move(dx: number, dz: number, delta: number): void {
            if (Math.abs(dx) + Math.abs(dz) <= 0.01) {
                return;
            }

            const length = Math.hypot(dx, dz);
            const nx = dx / Math.max(1, length);
            const nz = dz / Math.max(1, length);

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
                // This model groups both the Hand mesh and HandSocket under
                // one bone, so moving it keeps the hand attached to the racket.
                handBone = handSocket.parent;

                loader.load(
                    racketPath,
                    (racketGltf) => {
                        const racketScene = racketGltf.scene;
                        racketScene.scale.set(racketScale, racketScale, racketScale);
                        
                        handSocket.add(racketScene);
                        controller.racket = racketScene;
                        controller.hitbox = new RacketHitbox(racketScene);
                        // Cache the racket's strike position relative to the feet,
                        // so assisted movement aligns the racket, not the body.
                        const restore = controller.currentAnimation;
                        controller.stopAnimation();
                        for (const name of ['SwingLeft', 'SwingRight']) {
                            const action = controller.actions[name];
                            if (!action) continue;
                            controller.swingBackhand = name === 'SwingLeft';
                            controller.playAnimation(name);
                            action.stopFading();
                            action.setEffectiveWeight(1);
                            action.time = action.getClip().duration * 0.45;
                            controller.update(0);
                            const center = controller.hitbox.bounds.getCenter(new THREE.Vector3())
                                .applyMatrix4(controller.hitbox.pose());
                            controller.strikeOffsets[name] = center.sub(group.getWorldPosition(new THREE.Vector3()));
                            controller.stopAnimation();
                            controller.update(0);
                        }
                        controller.swingBackhand = false;
                        if (restore) controller.playAnimation(restore);
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
