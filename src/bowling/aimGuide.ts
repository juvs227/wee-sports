import * as THREE from 'three';

// The preview uses the same release origin and heading as BowlingPhysics.roll.
const RELEASE_Z = 0.25;
const GUIDE_LENGTH = 7.1;

function arrowGeometry(shaft: number, head: number, length: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-shaft, .32);
  shape.lineTo(shaft, .32);
  shape.lineTo(shaft, length - .65);
  shape.lineTo(head, length - .65);
  shape.lineTo(0, length);
  shape.lineTo(-head, length - .65);
  shape.lineTo(-shaft, length - .65);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Filled geometry stays legible on TV; WebGL line widths are normally one pixel. */
export function createBowlingAimGuide(): THREE.Line {
  const guide = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({visible: false}));
  guide.name = 'Live bowling aim';
  const arrow = new THREE.Group();
  arrow.name = 'filled-aim-arrow';
  arrow.position.z = RELEASE_Z;
  for (const [name, width, head, y, color] of [
    ['aim-outline', .072, .24, .022, 0x173b3b],
    ['aim-fill', .035, .18, .026, 0xc5ffe0],
  ] as const) {
    const mesh = new THREE.Mesh(arrowGeometry(width, head, GUIDE_LENGTH),
      new THREE.MeshBasicMaterial({color, side: THREE.DoubleSide, toneMapped: false}));
    mesh.name = name;
    mesh.position.y = y;
    arrow.add(mesh);
  }
  guide.add(arrow);
  updateBowlingAimGuide(guide, 0);
  return guide;
}

export function updateBowlingAimGuide(guide: THREE.Line, aim: number, locked = false): void {
  const angle = -THREE.MathUtils.clamp(aim, -1, 1) * .06;
  const end = new THREE.Vector3(Math.sin(angle) * GUIDE_LENGTH, .026, RELEASE_Z + Math.cos(angle) * GUIDE_LENGTH);
  const positions = guide.geometry.getAttribute('position');
  if (positions?.count === 2) {
    positions.setXYZ(1, end.x, end.y, end.z);
    positions.needsUpdate = true;
  } else guide.geometry.setFromPoints([new THREE.Vector3(0, .026, RELEASE_Z), end]);
  guide.geometry.computeBoundingSphere();
  const arrow = guide.getObjectByName('filled-aim-arrow');
  if (arrow) arrow.rotation.y = angle;
  const fill = guide.getObjectByName('aim-fill') as THREE.Mesh | undefined;
  if (fill) (fill.material as THREE.MeshBasicMaterial).color.set(locked ? 0xffdb7d : 0xc5ffe0);
}
