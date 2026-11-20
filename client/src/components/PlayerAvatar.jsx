import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#2b9a66', '#e0a100'];

/** Render the same player model used by tennis in a compact ready-screen view. */
export function TennisPlayerAvatar({ slot, name, color, size = 96 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 1.15, 5.5);
    camera.lookAt(0, 1.05, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445547, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(-3, 5, 4);
    scene.add(light);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    let disposed = false;
    let model;

    new GLTFLoader().load('/assets/player.glb', (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const recolor = (material) => {
          const cloned = material.clone();
          if ('color' in cloned) cloned.color.set(color ?? PLAYER_COLORS[slot] ?? PLAYER_COLORS[0]);
          return cloned;
        };
        child.material = Array.isArray(child.material)
          ? child.material.map(recolor)
          : recolor(child.material);
      });

      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 2.1 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      modelRoot.add(model);
    });

    let frame;
    const animate = () => {
      if (disposed) return;
      if (model) model.rotation.y = Math.sin(performance.now() / 1800) * 0.15;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.dispose();
      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    };
  }, [slot, color]);



  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ display: 'block', width: `${size}px`, height: `${size}px`, maxWidth: '100%', maxHeight: '100%', flex: 'none' }}
      role="img"
      aria-label={`${name ?? `Player ${slot + 1}`} avatar`}
    />
  );
}
