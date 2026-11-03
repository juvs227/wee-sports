// Isolated visual concepts only: no live game logic, input, networking or mutations.
import * as THREE from 'three';
import {createCourt} from '../../src/Tennis/components/court';
import {createNet} from '../../src/Tennis/components/net';
import {createPlayer} from '../../src/Tennis/components/player';

const palettes = {
  park: {sky: 0xc4d9d3, court: 0x357953, ground: 0x8caa72, edge: 0x315b41, light: 2.3},
  night: {sky: 0x122237, court: 0x286e68, ground: 0x223d42, edge: 0x213444, light: 2.6},
  clay: {sky: 0xeadbc4, court: 0xbd6d4b, ground: 0xceb68c, edge: 0x8d7155, light: 2.3},
  hall: {sky: 0x7f9690, court: 0x357968, ground: 0x82938a, edge: 0x687b75, light: 2.5},
};
const views = [];
function createView(target, kind) {
  const palette = palettes[kind];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.sky, 45, 110);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445547, palette.light));
  const sun = new THREE.DirectionalLight(kind === 'night' ? 0xd3eeff : 0xfff4db, 2.4);
  sun.position.set(-14, 25, 12); scene.add(sun);
  function box(x,y,z,w,h,d,color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({color, roughness: 1}));
    mesh.position.set(x,y,z); scene.add(mesh); return mesh;
  }
  box(0, -.11, 0, 160, .2, 160, palette.ground);
  const court = createCourt(); court.children[0].material.color.set(palette.court); scene.add(court, createNet());
  for (const sign of [-1,1]) {
    box(0, .9, sign * 28, 44, 1.8, .7, palette.edge);
    box(sign * 15, .9, 0, .7, 1.8, 56, palette.edge);
    // Simple benches and path edges outside the unchanged playing dimensions.
    box(sign * 12.5, .6, 6, 1.1, .15, 3.2, 0xb6a17b);
    box(sign * 12.5, .25, 5, .6, .5, .15, palette.edge);
    box(sign * 12.5, .25, 7, .6, .5, .15, palette.edge);
  }
  if (kind === 'park' || kind === 'clay') {
    for (let index = 0; index < 12; index++) {
      const x = (index % 6 - 2.5) * 10;
      const z = index < 6 ? -36 : 36;
      box(x, 2, z, .6, 4, .6, 0x6b5944);
      const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(3.7, 1), new THREE.MeshStandardMaterial({color: kind === 'clay' ? 0x5c7650 : 0x517849, roughness: 1}));
      tree.position.set(x,5.4,z); tree.scale.y = 1.3; scene.add(tree);
    }
  }
  if (kind === 'night') {
    for (const x of [-16,16]) for (const z of [-22,22]) {
      box(x,6,z,.18,12,.18,0x445d6b);
      const lamp = box(x,12,z,2,.22,.8,0xdbeeff);
      lamp.material.emissive = new THREE.Color(0xe3f4ff); lamp.material.emissiveIntensity = 2;
    }
  }
  if (kind === 'hall') {
    for (const x of [-23,23]) box(x,6,0,.7,12,74,0x9aa89e);
    for (const z of [-35,35]) {box(0,6,z,46,12,.7,0x92a499); box(0,6,z*.995,38,.4,.7,0xdbe8cf);}
    for (const z of [-28,-14,0,14,28]) box(0,12,z,46,.3,.3,0x536e62);
  }
  const p1 = createPlayer(-1,.25,9,0x3b82f6);
  const p2 = createPlayer(1,.25,-9,0xef4444); p2.group.rotation.y = Math.PI;
  scene.add(p1.group, p2.group);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.16,12,12),new THREE.MeshBasicMaterial({color:0xe6ff53}));
  ball.position.set(1,1.6,2); scene.add(ball);
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = kind === 'night' ? .8 : 1;
  target.append(renderer.domElement);
  const cameras = [1,-1].map(sign => {
    const camera = new THREE.PerspectiveCamera(51,1,.1,180);
    camera.position.set(0,12,sign * 22); camera.lookAt(0,0,sign * 1);
    return camera;
  });
  function render() {
    const {width,height} = target.getBoundingClientRect();
    if (!width || !height) return;
    p1.hitbox?.updateDebug(false, false, false);
    p2.hitbox?.updateDebug(false, false, false);
    renderer.setSize(width,height,false); renderer.setScissorTest(true);
    cameras.forEach((camera,i) => {
      camera.aspect = width / 2 / height; camera.updateProjectionMatrix();
      renderer.setViewport(i * width/2,0,width/2,height);
      renderer.setScissor(i * width/2,0,width/2,height); renderer.render(scene,camera);
    });
    renderer.setScissorTest(false);
  }
  new ResizeObserver(render).observe(target);
  // Render on model load without a permanent animation loop or physics simulation.
  const timer = setInterval(render,250); setTimeout(() => clearInterval(timer),12000);
  render(); views.push(render);
}
document.querySelectorAll('article').forEach(article => createView(article.querySelector('.court'), article.dataset.design));
document.querySelectorAll('[data-focus]').forEach(button => button.onclick = () => {document.body.dataset.focus = button.dataset.focus; window.scrollTo(0,0);});
document.querySelector('#focus-all').onclick = () => {delete document.body.dataset.focus;};
document.querySelector('#phone-sound').onclick = event => {
  const muted = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed',String(muted));
  event.currentTarget.setAttribute('aria-label',muted ? 'Unmute sound' : 'Mute sound');
  event.currentTarget.textContent = muted ? '×♫' : '♫';
};
document.querySelector('#phone-menu').onclick = event => {
  const panel = document.querySelector('#phone-options'); panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute('aria-expanded',String(!panel.hidden));
};
