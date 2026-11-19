import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import * as THREE from 'three';
import {BowlingWorld} from '../src/bowling/World';
import {createFrameQuality, FrameQualitySettings} from '../src/rendering/frameQuality';
import {BowlingPhysics} from '../src/bowling/physics';

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return {...actual, WebGLRenderer: class {
    domElement = {style: {}, setAttribute: vi.fn(), remove: vi.fn()};
    shadowMap = {enabled: false, autoUpdate: true, needsUpdate: false, type: 0};
    ratio = 1;
    shadowPasses = 0;
    size = [0, 0];
    allocations: number[] = [];
    setPixelRatio(value: number) {this.ratio = value; this.allocations.push(this.size[0] * this.size[1] * value * value);}
    getPixelRatio() {return this.ratio;}
    setDrawingBufferSize(width: number, height: number, ratio: number) {
      this.ratio = ratio; this.size = [width, height]; this.allocations.push(width * height * ratio * ratio);
    }
    render() {
      if (this.shadowMap.enabled && (this.shadowMap.autoUpdate || this.shadowMap.needsUpdate)) this.shadowPasses++;
      this.shadowMap.needsUpdate = false;
    }
    dispose() {}
  }};
});

type RenderHarness = {
  renderer: {getPixelRatio(): number; shadowPasses: number; shadowMap: {enabled: boolean}; allocations: number[]};
  frameQuality: ReturnType<typeof createFrameQuality>;
  scene: THREE.Scene;
  physics: BowlingPhysics;
  rolling: boolean;
  shadowsDirty: boolean;
  settlement: unknown;
  applyQuality(settings: FrameQualitySettings): void;
  render(): void;
  advanceDelivery(dt: number): void;
  tick(time: number): void;
  resize(): void;
};

beforeEach(() => {
  vi.stubGlobal('window', {devicePixelRatio: 2});
  vi.stubGlobal('document', {hidden: false});
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  // Keep the actual physics, rack, ball, cameras, quality controller, and frame
  // lifecycle. Only the decorative canvas textures need a browser DOM.
  vi.spyOn(BowlingWorld.prototype as unknown as {buildAlley(): void}, 'buildAlley').mockImplementation(() => {});
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

function lane(width = 1920, height = 1080) {
  const container = {clientWidth: width, clientHeight: height, append: vi.fn()} as unknown as HTMLElement;
  const world = new BowlingWorld(container, [{player: 1, name: 'Player'}]);
  return {world, view: world as unknown as RenderHarness, container};
}

test('bowling applies the shared pixel budget at 4K and avoids oversized intermediate resize allocations', () => {
  const {world, view, container} = lane(3840, 2160);
  const ratio = view.renderer.getPixelRatio();
  expect(3840 * 2160 * ratio * ratio).toBeLessThanOrEqual(1920 * 1080 + 1);
  expect(ratio).toBeGreaterThan(0);
  Object.assign(container, {clientWidth: 1920, clientHeight: 1080});
  view.resize();
  expect(view.renderer.getPixelRatio()).toBe(1);
  expect(Math.max(...view.renderer.allocations)).toBeLessThanOrEqual(1920 * 1080 + 1);
  world.dispose();
});

test('aim and camera frames reuse static shadows; moving balls and new racks refresh them', () => {
  const {world, view} = lane();
  const initial = view.renderer.shadowPasses;
  for (let frame = 0; frame < 30; frame++) {
    world.setAim(Math.sin(frame) * .5);
    view.render();
  }
  expect(view.renderer.shadowPasses).toBe(initial);
  world.start();
  expect(world.roll({player: 1, power: .6, aim: 0, spin: 0}).ok).toBe(true);
  view.render(); view.render();
  expect(view.renderer.shadowPasses).toBe(initial + 2);
  world.reset();
  expect(view.renderer.shadowPasses).toBe(initial + 3);
  view.render();
  expect(view.renderer.shadowPasses).toBe(initial + 3);
  expect(world.restoreCheckpoint(world.exportCheckpoint())).toBe(true);
  expect(view.renderer.shadowPasses).toBe(initial + 4);
  world.dispose();
});

test('quality limits shadow cadence but settlement always captures the final pin layout', () => {
  const {world, view} = lane();
  vi.spyOn(view.frameQuality, 'settings', 'get').mockReturnValue({level: 3, pixelRatio: .65, shadows: true, shadowEvery: 3});
  world.start(); world.roll({player: 1, power: .6, aim: 0, spin: 0});
  view.render(); // The first delivery frame bypasses cadence with fresh shadows.
  const first = view.renderer.shadowPasses;
  for (let frame = 0; frame < 6; frame++) view.render();
  expect(view.renderer.shadowPasses - first).toBe(2);
  vi.spyOn(view.physics, 'step').mockReturnValueOnce({remaining: [7, 10], gutter: false, elapsed: 5});
  view.advanceDelivery(1 / 60);
  const beforeSettlement = view.renderer.shadowPasses;
  view.render(); view.render();
  expect(view.renderer.shadowPasses).toBe(beforeSettlement + 1);
  world.dispose();
});

test('shadow recovery invalidates cached material variants and repaints the static lane', () => {
  const {world, view} = lane();
  const material = new THREE.MeshStandardMaterial();
  view.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const originalVersion = material.version;
  view.applyQuality({level: 4, pixelRatio: .65, shadows: false, shadowEvery: 3});
  view.render();
  const shadowPasses = view.renderer.shadowPasses;
  expect(view.renderer.shadowMap.enabled).toBe(false);
  expect(material.version).toBeGreaterThan(originalVersion);
  const disabledVersion = material.version;
  view.applyQuality({level: 3, pixelRatio: .65, shadows: true, shadowEvery: 3});
  view.render();
  expect(material.version).toBeGreaterThan(disabledVersion);
  expect(view.renderer.shadowPasses).toBe(shadowPasses + 1);
  world.dispose();
});

test('sustained slow frames reduce presentation cost without advancing an idle game', () => {
  const {world, view} = lane();
  const initial = world.getState();
  const ratio = view.renderer.getPixelRatio();
  world.start();
  const start = performance.now();
  for (let frame = 0; frame < 45; frame++) view.tick(start + frame * 60);
  expect(view.renderer.getPixelRatio()).toBeLessThan(ratio);
  expect(view.renderer.shadowMap.enabled).toBe(false);
  expect(world.getState()).toEqual(initial);
  world.stop();
  expect(view.frameQuality.sample(start + 20000, 1)).toBeNull();
  world.dispose();
});
