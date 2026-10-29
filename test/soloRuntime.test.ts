import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPlayer } from '../src/World/components/player';
import { createBall } from '../src/World/components/ball';
import { GameLogic } from '../src/World/gameLogic';

afterEach(() => vi.restoreAllMocks());

test('solo phone serve and bot contact report actual hits without updating static scenery at physics frequency', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((url, onLoad) => {
        const data = readFileSync(`public${url}`);
        void new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '').then(onLoad);
    });
    const scene = new THREE.Scene();
    const phonePlayer = createPlayer(0, .25, 10, 0x3b82f6);
    const bot = createPlayer(0, .25, -10, 0xef4444, { minZ: -11.5, maxZ: -1 });
    bot.group.rotation.y = Math.PI;
    scene.add(phonePlayer.group, bot.group);
    await vi.waitFor(() => { expect(phonePlayer.hitbox).toBeTruthy(); expect(bot.hitbox).toBeTruthy(); });
    const courtDecoration = new THREE.Object3D();
    scene.add(courtDecoration);
    const updateScenery = vi.spyOn(courtDecoration, 'updateMatrixWorld');
    const ball = createBall(0, .3, 10);
    scene.add(ball);
    const hits: number[] = [];
    const feedback: string[] = [];
    const game = new GameLogic({ scene, player1: phonePlayer, player2: bot, ball,
        targetMarkers: [new THREE.Mesh(), new THREE.Mesh()], shotTargetMarker: new THREE.Mesh(),
        onSwingFeedback: () => message => feedback.push(message), onHit: player => hits.push(player) });
    // Only one phone sends input. The opponent is the normal solo bot.
    game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    expect(hits).toEqual([]); // Starting a swing is not contact.
    for (let frame = 0; frame < 480; frame++) game.update(1 / 60);
    expect(feedback.some(message => message.startsWith('Player 1: Hit!'))).toBe(true);
    expect(feedback.some(message => message.startsWith('Player 2: Hit!'))).toBe(true);
    expect(updateScenery.mock.calls.length).toBe(0);
    expect(hits.slice(0, 2)).toEqual([1, 2]);
    expect(hits.slice(2)).toContain(2);
    game.clearPendingInputs();
    for (let frame = 0; frame < 120; frame++) game.update(1 / 60);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    phonePlayer.hitbox?.dispose();
    bot.hitbox?.dispose();
});
