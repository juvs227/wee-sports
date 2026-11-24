import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {BALL_RADIUS} from './physics';

export type PlayerHandedness = 'left' | 'right';

export function createBowlingBallVisual(): THREE.Group {
  const ball = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
    new THREE.MeshStandardMaterial({color: '#6e47ad', roughness: 0.16, metalness: 0.35}),
  );
  sphere.castShadow = true;
  ball.add(sphere);

  const holeMaterial = new THREE.MeshStandardMaterial({color: '#171526', roughness: 0.85});
  for (const [x, z, radius] of [
    [-0.024, -0.023, 0.009],
    [0.024, -0.023, 0.009],
    [0, 0.028, 0.012],
  ]) {
    const hole = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), holeMaterial);
    hole.position.set(x, Math.sqrt(BALL_RADIUS ** 2 - x ** 2 - z ** 2) - radius * 0.4, z);
    ball.add(hole);
  }
  return ball;
}

export interface PlayerController {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  handedness: PlayerHandedness;
  setHandedness: (handedness: PlayerHandedness) => void;
  holdBall: () => void;
  releaseBall: () => void;
  playSwing: () => void;
  update: (delta: number) => void;
  dispose: () => void;
}

export interface PlayerOptions {
  modelPath?: string;
  animationPath?: string;
  scale?: number;
  onLoad?: () => void;
  handedness?: PlayerHandedness;
}

export function createPlayer(
  x = 1.1,
  y = 0,
  z = -0.35,
  color = 0x2f80ed,
  options: PlayerOptions = {},
): PlayerController {
  const {
    modelPath = '/assets/player.glb',
    animationPath = '/assets/animations/bowling.glb',
    scale = 0.2,
    onLoad,
    handedness: initialHandedness = 'right',
  } = options;
  let handedness = initialHandedness;
  const group = new THREE.Group();
  group.position.set(
    Math.abs(x) * (handedness === 'left' ? -1 : 1),
    y,
    z,
  );
  let swingAction: THREE.AnimationAction | null = null;
  let swingRequested = false;
  let animations: THREE.AnimationClip[] = [];
  let heldBall: THREE.Group | null = null;
  let holdingBall = false;
  let disposed = false;
  const playSwingAction = (): void => {
    if (!swingAction) {
      swingRequested = true;
      return;
    }
    swingRequested = false;
    swingAction.reset();
    swingAction.enabled = true;
    swingAction.setEffectiveTimeScale(1);
    swingAction.setEffectiveWeight(1);
    swingAction.setLoop(THREE.LoopOnce, 1);
    swingAction.clampWhenFinished = false;
    swingAction.play();
  };
  const selectSwingAction = (): void => {
    if (!controller.mixer) return;
    swingAction?.stop();
    swingAction = null;
    const clipName = handedness === 'right' ? 'BowlRight' : 'BowlLeft';
    const clip = animations.find(animation => animation.name === clipName);
    if (!clip) {
      swingRequested = false;
      console.error(`Animation "${clipName}" not found in bowling animation asset.`);
      return;
    }
    swingAction = controller.mixer.clipAction(clip);
    if (swingRequested) playSwingAction();
  };
  const controller: PlayerController = {
    group,
    mixer: null,
    get handedness() {
      return handedness;
    },
    setHandedness(nextHandedness): void {
      const changed = nextHandedness !== handedness;
      handedness = nextHandedness;
      group.position.x = Math.abs(group.position.x) * (handedness === 'left' ? -1 : 1);
      if (!changed) return;
      selectSwingAction();
    },
    holdBall(): void {
      holdingBall = true;
      if (heldBall) heldBall.visible = true;
    },
    releaseBall(): void {
      holdingBall = false;
      if (heldBall) heldBall.visible = false;
    },
    playSwing(): void {
      playSwingAction();
    },
    update(delta: number): void {
      this.mixer?.update(delta);
    },
    dispose(): void {
      disposed = true;
      this.mixer?.stopAllAction();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map);
        }
      });
      textures.forEach(texture => texture.dispose());
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      group.clear();
    },
  };

  new GLTFLoader().load(
    modelPath,
    gltf => {
      if (disposed) return;
      const model = gltf.scene;
      model.scale.setScalar(scale);
      model.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const recolor = (material: THREE.Material): THREE.Material => {
          const cloned = material.clone();
          if ('color' in cloned) {
            (cloned as THREE.MeshStandardMaterial).color.setHex(color);
          }
          return cloned;
        };
        child.material = Array.isArray(child.material)
          ? child.material.map(recolor)
          : recolor(child.material);
      });
      group.add(model);

      const handSocket = model.getObjectByName('HandSocket');
      if (handSocket) {
        heldBall = createBowlingBallVisual();
        const socketScale = handSocket.getWorldScale(new THREE.Vector3());
        heldBall.scale.set(1 / socketScale.x, 1 / socketScale.y, 1 / socketScale.z);
        heldBall.position.set(
          0,
          BALL_RADIUS * 1.0 / socketScale.y,
          BALL_RADIUS * 0.4 / socketScale.z,
        );
        heldBall.visible = holdingBall;
        handSocket.add(heldBall);
      } else {
        console.warn('HandSocket not found in bowling player model. The ball was not attached.');
      }
      onLoad?.();

      new GLTFLoader().load(
        animationPath,
        animationGltf => {
          if (disposed) return;
          animations = animationGltf.animations;
          controller.mixer = new THREE.AnimationMixer(model);
          selectSwingAction();
        },
        undefined,
        error => console.error('Failed to load bowling player animation:', error),
      );
    },
    undefined,
    error => console.error('Failed to load bowling player model:', error),
  );

  return controller;
}
