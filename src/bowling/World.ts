import * as THREE from 'three';
import {BowlingMatch, BowlingPlayer, BowlingState} from './match';
import {BALL_RADIUS, BowlingPhysics, LANE, PIN_COM, pinSpot, RollControls, RollSettlement, validRoll} from './physics';

export type {BowlingPlayer, BowlingState} from './match';
export interface BowlingRoll extends RollControls {player: number}

/** A TV-owned scene. Phones only request deliveries; all pinfall is simulated here. */
export class BowlingWorld {
  onState: ((state: BowlingState) => void) | null = null;
  private match: BowlingMatch;
  private players: BowlingPlayer[];
  private physics = new BowlingPhysics();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.03, 80);
  private renderer: THREE.WebGLRenderer;
  private pins = new Map<number, THREE.Group>();
  private ball = new THREE.Group();
  private aimLine: THREE.Line;
  private trail: THREE.Line;
  private trailPositions = new Float32Array(512 * 3);
  private trailCount = 0;
  private observer: ResizeObserver;
  private running = false;
  private disposed = false;
  private rolling = false;
  private settlement: RollSettlement | null = null;
  private revealTime = 0;
  private animation = 0;
  private lastTime = 0;
  private cameraPosition = new THREE.Vector3(0.1, 2.25, -4);
  private cameraTarget = new THREE.Vector3(0, 0.05, 7.8);
  private aim = 0;

  constructor(private container: HTMLElement, players: BowlingPlayer[]) {
    this.players = players.map(player => ({...player}));
    this.match = new BowlingMatch(players);
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('aria-label', 'Three-dimensional bowling lane and pins');
    this.container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#203a32');
    this.scene.fog = new THREE.Fog('#203a32', 25, 48);
    this.scene.add(new THREE.HemisphereLight(0xfff8e8, 0x3c5147, 2.0));
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.7);
    sun.position.set(-4, 8, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left: -3, right: 3, top: 12, bottom: -12, near: 0.1, far: 30});
    sun.shadow.bias = -0.00015;
    sun.target.position.set(0, 0, 11);
    this.scene.add(sun, sun.target);
    this.buildAlley();
    this.buildPins();
    this.buildBall();
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({
      color: 0x496c25, dashSize: 0.15, gapSize: 0.13, transparent: true, opacity: 0.65,
    }));
    this.scene.add(this.aimLine);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({color: '#edffbd', transparent: true, opacity: 0.72}));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.setAim(0);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    this.resize();
    this.syncBodies();
    this.render();
  }

  getState(): BowlingState { return this.match.getState(this.rolling); }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.animation = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animation);
    // Neither physical time nor the result-reveal timer advances while paused.
  }

  roll(roll: BowlingRoll): {ok: boolean; error?: string} {
    if (this.disposed || !this.running) return {ok: false, error: 'The game is paused. Reconnect all players to continue.'};
    const state = this.getState();
    if (state.complete) return {ok: false, error: 'This match is finished. Start a new match on the TV.'};
    if (state.currentPlayer !== roll.player) return {ok: false, error: 'Wait for your turn.'};
    if (this.rolling) return {ok: false, error: 'Wait for the ball and pins to settle.'};
    if (!validRoll(roll)) return {ok: false, error: 'Choose a valid aim, power, and spin.'};
    if (!this.physics.roll(roll)) return {ok: false, error: 'This delivery could not start.'};
    this.rolling = true;
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.trail.visible = true;
    this.aimLine.visible = false;
    this.onState?.(this.getState());
    return {ok: true};
  }

  /** Optional TV preview; the phone's authenticated roll remains authoritative. */
  setAim(aim: number): void {
    if (!Number.isFinite(aim)) return;
    this.aim = THREE.MathUtils.clamp(aim, -1, 1);
    this.aimLine?.geometry.dispose();
    if (this.aimLine) {
      this.aimLine.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.012, 0.35), new THREE.Vector3(Math.tan(this.aim * 0.06) * 7, 0.012, 7.35),
      ]);
      this.aimLine.computeLineDistances();
    }
  }

  reset(players: BowlingPlayer[] = this.players): void {
    this.players = players.map(player => ({...player}));
    this.match = new BowlingMatch(players);
    this.physics.resetRack();
    this.rolling = false;
    this.settlement = null;
    this.revealTime = 0;
    this.aimLine.visible = true;
    this.trail.visible = false;
    this.syncBodies();
    this.render();
    this.onState?.(this.getState());
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.observer.disconnect();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map);
        }
      }
    });
    textures.forEach(texture => texture.dispose());
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.onState = null;
  }

  private resize = (): void => {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  };

  private tick = (time: number): void => {
    if (!this.running) return;
    const dt = Math.min(Math.max((time - this.lastTime) / 1000, 0), 0.1);
    this.lastTime = time;
    if (this.rolling && !this.settlement) {
      this.settlement = this.physics.step(dt);
      if (this.settlement) this.revealTime = 1.1;
    } else if (this.settlement) {
      this.revealTime -= dt;
      if (this.revealTime <= 0) {
        const transition = this.match.record(this.settlement.remaining);
        if (transition.resetRack) this.physics.resetRack();
        else if (!this.match.getState().complete) this.physics.sweep(this.settlement.remaining);
        this.settlement = null;
        this.rolling = false;
        this.trail.visible = false;
        this.aimLine.visible = !this.match.getState().complete;
        this.onState?.(this.getState());
      }
    }
    this.syncBodies();
    this.updateTrail();
    const advance = this.rolling ? Math.max(0, Math.min(this.physics.ball.position.z - 2.2, 15.4)) : 0;
    this.cameraPosition.set(0.1, this.rolling ? 2.35 : 2.25, advance - (this.rolling ? 2.9 : 4));
    this.cameraTarget.set(0, 0.05, Math.min(advance + 7.8, 18.8));
    this.camera.position.lerp(this.cameraPosition, 1 - Math.exp(-dt * 3));
    const target = new THREE.Vector3();
    this.camera.getWorldDirection(target);
    target.multiplyScalar(10).add(this.camera.position).lerp(this.cameraTarget, 1 - Math.exp(-dt * 5));
    this.camera.lookAt(target);
    this.render();
    this.animation = requestAnimationFrame(this.tick);
  };

  private syncBodies(): void {
    const visible = new Set(this.physics.pins.map(pin => pin.id));
    for (const [id, mesh] of this.pins) mesh.visible = visible.has(id);
    for (const {id, body} of this.physics.pins) {
      const mesh = this.pins.get(id)!;
      mesh.position.copy(body.position as unknown as THREE.Vector3);
      mesh.quaternion.copy(body.quaternion as unknown as THREE.Quaternion);
    }
    this.ball.position.copy(this.physics.ball.position as unknown as THREE.Vector3);
    this.ball.quaternion.copy(this.physics.ball.quaternion as unknown as THREE.Quaternion);
  }

  /** Draw the measured path, so players can read their wrist-created hook. */
  private updateTrail(): void {
    const {x, z} = this.physics.ball.position;
    if (!this.rolling || z > LANE.length || Math.abs(x) > LANE.width / 2 || this.trailCount >= 512) return;
    const previous = (this.trailCount - 1) * 3;
    if (this.trailCount && Math.hypot(x - this.trailPositions[previous], z - this.trailPositions[previous + 2]) < 0.06) return;
    this.trailPositions.set([x, 0.014, z], this.trailCount++ * 3);
    this.trail.geometry.getAttribute('position').needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailCount);
  }

  private render(): void { this.renderer.render(this.scene, this.camera); }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private woodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 2048;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#cfaa70';
    context.fillRect(0, 0, 512, 2048);
    for (let board = 0; board < 39; board++) {
      const x = board * 512 / 39;
      const tone = 64 + ((board * 17) % 13);
      context.fillStyle = `hsl(35, 49%, ${tone}%)`;
      context.fillRect(x, 0, 512 / 39 - 0.6, 2048);
      for (let grain = 0; grain < 4; grain++) {
        context.strokeStyle = '#754b2825';
        context.lineWidth = 0.4;
        context.beginPath();
        context.moveTo(x + grain * 2.9 + 1.5, 0);
        context.bezierCurveTo(x + grain * 2.9 + 2.5, 512, x + grain * 2.9, 1536, x + grain * 2.9 + 2, 2048);
        context.stroke();
      }
      for (let joint = 0; joint < 6; joint++) {
        context.fillStyle = '#754b2835';
        context.fillRect(x, joint * 350 + (board * 89) % 350, 512 / 39, 1);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }

  private buildAlley(): void {
    const wood = new THREE.MeshStandardMaterial({map: this.woodTexture(), roughness: 0.32, metalness: 0.05});
    const gutter = new THREE.MeshStandardMaterial({color: '#344d43', roughness: 0.45, metalness: 0.3});
    const trim = new THREE.MeshStandardMaterial({color: '#f5f1e3', roughness: 0.5});
    const lime = new THREE.MeshStandardMaterial({color: '#b2d568', emissive: '#6b961d', emissiveIntensity: 0.2});
    this.mesh(new THREE.BoxGeometry(18, 0.15, 34), new THREE.MeshStandardMaterial({color: '#344c40', roughness: 0.9}), 0, -0.475, 10);
    for (const offset of [-3.2, -1.6, 0, 1.6, 3.2]) {
      this.mesh(new THREE.BoxGeometry(LANE.width, 0.2, LANE.deckEnd + 1.6), wood, offset, -0.1, (LANE.deckEnd - 1.6) / 2);
      for (const side of [-1, 1]) {
        this.mesh(new THREE.BoxGeometry(LANE.gutterWidth, 0.06, LANE.deckEnd), gutter,
          offset + side * (LANE.width + LANE.gutterWidth) / 2, -0.14, LANE.deckEnd / 2);
        this.mesh(new THREE.BoxGeometry(0.045, 0.24, LANE.deckEnd), trim,
          offset + side * (LANE.width / 2 + LANE.gutterWidth + 0.025), -0.04, LANE.deckEnd / 2);
        if (offset === 0) this.mesh(new THREE.BoxGeometry(0.016, 0.012, LANE.deckEnd), lime,
          side * (LANE.width / 2 + LANE.gutterWidth + 0.025), 0.086, LANE.deckEnd / 2);
      }
    }
    const dark = new THREE.MeshStandardMaterial({color: '#263a32', roughness: 0.75});
    const wall = new THREE.MeshStandardMaterial({color: '#3b5647', roughness: 0.85});
    const lamp = new THREE.MeshStandardMaterial({color: '#fff3cf', emissive: '#fff3cf', emissiveIntensity: 1.8, roughness: 0.3});
    // A small clubhouse around the existing lanes, keeping the pins and the
    // warm wood brightest rather than covering the game with new UI.
    for (const side of [-1, 1]) {
      this.mesh(new THREE.BoxGeometry(0.18, 4.5, 29), wall, side * 4.5, 1.7, 8);
      this.mesh(new THREE.BoxGeometry(0.025, 0.12, 27), lime, side * 4.39, 0.85, 8);
      for (const z of [0, 5, 10, 15]) {
        this.mesh(new THREE.BoxGeometry(0.2, 3.8, 0.09), dark, side * 4.35, 1.5, z);
      }
    }
    this.mesh(new THREE.BoxGeometry(9.2, 0.16, 29), dark, 0, 4, 8);
    for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) {
      this.mesh(new THREE.BoxGeometry(0.04, 0.025, 19.5), lamp, x, 3.9, 9);
    }
    this.mesh(new THREE.BoxGeometry(9, 2.5, 0.35), dark, 0, 1.0, 20.6);
    this.mesh(new THREE.BoxGeometry(8.5, 0.13, 0.45), lime, 0, 2.3, 20.3);
    this.mesh(new THREE.BoxGeometry(8.5, 0.5, 1.3), dark, 0, -0.37, 19.8);
    const sign = document.createElement('canvas');
    sign.width = 1024; sign.height = 256;
    const context = sign.getContext('2d')!;
    context.fillStyle = '#263a32'; context.fillRect(0, 0, 1024, 256);
    context.textAlign = 'center'; context.fillStyle = '#eff5e8';
    context.font = '800 72px sans-serif'; context.fillText('WEE SPORTS', 512, 120);
    context.fillStyle = '#bddf79'; context.font = '500 28px sans-serif';
    context.fillText('THE CLUBHOUSE LANES', 512, 182);
    const signTexture = new THREE.CanvasTexture(sign); signTexture.colorSpace = THREE.SRGBColorSpace;
    const signMesh = this.mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({map: signTexture}), 0, 1.25, 20.39);
    signMesh.rotation.y = Math.PI;
    for (let lane = 0; lane < 5; lane++) {
      const label = document.createElement('canvas');
      label.width = 128; label.height = 128;
      const paint = label.getContext('2d')!;
      paint.fillStyle = lane === 2 ? '#bedf7c' : '#47624e';
      paint.beginPath(); paint.arc(64, 64, 53, 0, Math.PI * 2); paint.fill();
      paint.textAlign = 'center'; paint.textBaseline = 'middle';
      paint.fillStyle = lane === 2 ? '#203a32' : '#f5f1e3';
      paint.font = '800 64px sans-serif'; paint.fillText(String(lane + 1).padStart(2, '0'), 64, 68);
      const map = new THREE.CanvasTexture(label); map.colorSpace = THREE.SRGBColorSpace;
      const number = this.mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshBasicMaterial({map, transparent: true}), (lane - 2) * 1.6, 0.33, 20.38);
      number.rotation.y = Math.PI;
    }
    this.mesh(new THREE.BoxGeometry(LANE.width, 0.004, 0.025), dark, 0, 0.004, 0.02);
    const arrowMaterial = new THREE.MeshBasicMaterial({color: '#716038'});
    for (let index = -3; index <= 3; index++) {
      const shape = new THREE.Shape();
      shape.moveTo(-0.019, 0); shape.lineTo(0, 0.11); shape.lineTo(0.019, 0); shape.closePath();
      const arrow = this.mesh(new THREE.ShapeGeometry(shape), arrowMaterial, index * 0.127, 0.006, 4.2 + Math.abs(index) * 0.18);
      arrow.rotation.x = -Math.PI / 2;
    }
    for (let id = 1; id <= 10; id++) {
      const spot = pinSpot(id);
      const mark = this.mesh(new THREE.CircleGeometry(0.0285, 16), arrowMaterial, spot.x, 0.004, spot.z);
      mark.rotation.x = -Math.PI / 2;
    }
  }

  private buildPins(): void {
    const profile = [[0, 0], [0.027, 0], [0.034, 0.025], [0.051, 0.07], [0.0605, 0.12],
      [0.058, 0.15], [0.046, 0.19], [0.029, 0.23], [0.0215, 0.265], [0.022, 0.3],
      [0.029, 0.326], [0.031, 0.35], [0.024, 0.371], [0.012, 0.379], [0, 0.381]];
    const geometry = new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height - PIN_COM)), 24);
    const white = new THREE.MeshStandardMaterial({color: '#fffff6', roughness: 0.23, metalness: 0.03});
    const red = new THREE.MeshStandardMaterial({color: '#da3b3f', roughness: 0.3});
    const band = new THREE.TorusGeometry(0.0227, 0.0037, 8, 24);
    for (let id = 1; id <= 10; id++) {
      const group = new THREE.Group();
      const pin = new THREE.Mesh(geometry, white);
      pin.castShadow = true;
      pin.receiveShadow = true;
      group.add(pin);
      for (const height of [0.273, 0.292]) {
        const stripe = new THREE.Mesh(band, red);
        stripe.rotation.x = Math.PI / 2;
        stripe.position.y = height - PIN_COM;
        group.add(stripe);
      }
      this.scene.add(group);
      this.pins.set(id, group);
    }
  }

  private buildBall(): void {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
      new THREE.MeshStandardMaterial({color: '#6e47ad', roughness: 0.16, metalness: 0.35}));
    ball.castShadow = true;
    this.ball.add(ball);
    const holeMaterial = new THREE.MeshStandardMaterial({color: '#171526', roughness: 0.85});
    for (const [x, z, radius] of [[-0.024, -0.023, 0.009], [0.024, -0.023, 0.009], [0, 0.028, 0.012]]) {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), holeMaterial);
      hole.position.set(x, Math.sqrt(BALL_RADIUS ** 2 - x ** 2 - z ** 2) - radius * 0.4, z);
      this.ball.add(hole);
    }
    this.scene.add(this.ball);
  }
}
