import * as THREE from 'three';

export const BALL_RADIUS = 0.1085;
const DEFAULT_BALL_COLOR: THREE.ColorRepresentation = '#6e47ad';
const HOLE_COLOR: THREE.ColorRepresentation = '#171526';

export interface BallController {
  group: THREE.Group;
  setColor: (color: THREE.ColorRepresentation) => void;
  dispose: () => void;
}

export function createBall(
  x = 0,
  y = BALL_RADIUS,
  z = 0,
  color: THREE.ColorRepresentation = DEFAULT_BALL_COLOR,
): BallController {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  const sphereGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 24);
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.16,
    metalness: 0.35,
  });

  const ballMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
  ballMesh.castShadow = true;
  group.add(ballMesh);

  const holeMaterial = new THREE.MeshStandardMaterial({
    color: HOLE_COLOR,
    roughness: 0.85,
  });
  const holeGeometries: THREE.BufferGeometry[] = [];

  for (const [hx, hz, radius] of [
    [-0.024, -0.023, 0.009],
    [0.024, -0.023, 0.009],
    [0, 0.028, 0.012],
  ] as const) {
    const holeGeometry = new THREE.SphereGeometry(radius, 12, 8);
    holeGeometries.push(holeGeometry);

    const hole = new THREE.Mesh(holeGeometry, holeMaterial);
    hole.position.set(
      hx,
      Math.sqrt(BALL_RADIUS ** 2 - hx ** 2 - hz ** 2) - radius * 0.4,
      hz,
    );
    group.add(hole);
  }

  return {
    group,
    setColor(nextColor: THREE.ColorRepresentation): void {
      sphereMaterial.color.set(nextColor);
    },
    dispose(): void {
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      for (const geometry of holeGeometries) {
        geometry.dispose();
      }
      holeMaterial.dispose();
      group.removeFromParent();
    },
  };
}