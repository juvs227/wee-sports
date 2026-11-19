import {expect, test} from 'vitest';
import * as THREE from 'three';
import {BowlingWorld} from '../src/bowling/World';
import {BowlingMatch} from '../src/bowling/match';
import {BowlingPhysics, FIXED_STEP} from '../src/bowling/physics';
import {createBowlingAimGuide} from '../src/bowling/aimGuide';

/** Exercise the real scene-to-physics boundary without a WebGL renderer. */
function lane() {
  const physics = new BowlingPhysics();
  const aimLine = createBowlingAimGuide();
  const world = Object.create(BowlingWorld.prototype) as BowlingWorld;
  Object.assign(world, {
    physics, aimLine,
    match: new BowlingMatch([{player: 1, name: 'Player 1'}]),
    running: true, disposed: false, rolling: false,
    trail: {geometry: {setDrawRange: () => {}}, visible: false},
  });
  // The game's lane runs toward +Z. Looking down it makes -X screen-right.
  const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 80);
  camera.position.set(0, 2.25, -4);
  camera.lookAt(0, 0.05, 7.8);
  camera.updateMatrixWorld();
  const screenX = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(camera).x;
  return {world, physics, aimLine, screenX};
}

test.each([-1, 1])('aim %s moves the preview and delivered ball to the same screen side', direction => {
  const {world, physics, aimLine, screenX} = lane();
  world.setAim(direction * 0.5);
  const points = aimLine.geometry.getAttribute('position');
  expect(Math.sign(screenX(points.getX(1), points.getY(1), points.getZ(1)))).toBe(direction);
  expect(world.roll({player: 1, power: 0.65, aim: direction * 0.5, spin: 0}).ok).toBe(true);
  expect(aimLine.visible).toBe(false);
  for (let frame = 0; frame < 480 && physics.ball.position.z < 8; frame++) physics.step(FIXED_STEP);
  const ball = physics.ball.position;
  expect(ball.z).toBeGreaterThanOrEqual(8);
  expect(Math.sign(screenX(ball.x, ball.y, ball.z))).toBe(direction);
  aimLine.geometry.dispose();
  (aimLine.material as THREE.Material).dispose();
});

test('TV aim has a filled outlined arrow, and locking changes colour without moving the target', () => {
  const {world, aimLine, screenX} = lane();
  world.setAim(.65);
  const target = aimLine.geometry.getAttribute('position');
  const original = [target.getX(1), target.getY(1), target.getZ(1)];
  const fill = aimLine.getObjectByName('aim-fill') as THREE.Mesh;
  const outline = aimLine.getObjectByName('aim-outline') as THREE.Mesh;
  expect(fill).toBeInstanceOf(THREE.Mesh);
  expect(outline).toBeInstanceOf(THREE.Mesh);
  expect((fill.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
  aimLine.updateMatrixWorld(true);
  const vertices = fill.geometry.getAttribute('position');
  const projected = Array.from({length: vertices.count}, (_, index) => {
    const point = new THREE.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(fill.matrixWorld);
    return screenX(point.x, point.y, point.z);
  });
  // This is physical mesh width on a 900px-high TV view, not an unsupported
  // WebGL lineWidth setting. It remains wider than a single raster pixel.
  expect((Math.max(...projected) - Math.min(...projected)) * 450).toBeGreaterThan(12);
  const liveColor = (fill.material as THREE.MeshBasicMaterial).color.getHex();
  world.setAim(.65, true);
  expect([target.getX(1), target.getY(1), target.getZ(1)]).toEqual(original);
  expect((fill.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(liveColor);
  world.setAim(.65, false);
  expect((fill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(liveColor);
});

test.each([-1, 1])('curve %s hooks to its named screen side after travelling through the oil', direction => {
  const {world, physics, aimLine, screenX} = lane();
  expect(world.roll({player: 1, power: 0.65, aim: 0, spin: direction * 0.4}).ok).toBe(true);
  for (let frame = 0; frame < 1400 && physics.ball.position.z < 16; frame++) physics.step(FIXED_STEP);
  const ball = physics.ball.position;
  expect(ball.z).toBeGreaterThanOrEqual(16);
  expect(Math.abs(ball.x)).toBeGreaterThan(0.2);
  expect(Math.sign(screenX(ball.x, ball.y, ball.z))).toBe(direction);
  aimLine.geometry.dispose();
  (aimLine.material as THREE.Material).dispose();
});
