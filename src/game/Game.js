import * as THREE from 'three';
import { DEFAULT_SEED, HOTBAR } from '../../shared/worldgen.js';
import { World, CHUNK_SIZE } from './World.js';
import { Player } from './Player.js';

const MAX_REACH = 7;

function websocketUrl() {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  if (import.meta.env.DEV) {
    return `ws://${window.location.hostname}:3001/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function makeNameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.y = 2.25;
  return sprite;
}

export class Game {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.active = false;
    this.disposed = false;
    this.serverConnected = false;
    this.playerId = null;
    this.selectedIndex = 0;
    this.playerName = '玩家';
    this.playerColor = '#4fc3f7';
    this.seed = DEFAULT_SEED;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#87ceeb');
    this.scene.fog = new THREE.Fog('#a8d8ef', 35, 130);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 600);
    this.camera.rotation.order = 'YXZ';

    const hemi = new THREE.HemisphereLight('#dff3ff', '#7d6a50', 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff6d8', 1.35);
    sun.position.set(80, 130, 45);
    this.scene.add(sun);

    this.world = new World(this.scene, this.seed);
    const spawn = this.world.findSpawn(this.seed);
    this.player = new Player(spawn.x, spawn.y, spawn.z);
    this._syncCamera();

    this.clock = new THREE.Clock();
    this.input = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      down: false,
      sprint: false,
    };
    this.remotePlayers = new Map();
    this.ws = null;
    this.reconnectTimer = null;
    this.sendTimer = 0;
    this.stateTimer = 0;
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.rafId = null;

    this._resizeHandler = () => this._resize();
    this._keyDownHandler = (e) => this._onKeyDown(e);
    this._keyUpHandler = (e) => this._onKeyUp(e);
    this._mouseMoveHandler = (e) => this._onMouseMove(e);
    this._mouseDownHandler = (e) => this._onMouseDown(e);
    this._wheelHandler = (e) => this._onWheel(e);
    this._pointerLockHandler = () => this._onPointerLockChange();
    this._contextMenuHandler = (e) => e.preventDefault();

    window.addEventListener('resize', this._resizeHandler);
    document.addEventListener('keydown', this._keyDownHandler);
    document.addEventListener('keyup', this._keyUpHandler);
    document.addEventListener('mousemove', this._mouseMoveHandler);
    document.addEventListener('mousedown', this._mouseDownHandler);
    document.addEventListener('wheel', this._wheelHandler, { passive: false });
    document.addEventListener('pointerlockchange', this._pointerLockHandler);
    document.addEventListener('contextmenu', this._contextMenuHandler);

    this._loop = this._loop.bind(this);
    this.rafId = requestAnimationFrame(this._loop);
  }

  start(name, color) {
    this.playerName = (name || '玩家').slice(0, 16);
    this.playerColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4fc3f7';
    this.active = true;
    this.connect();
    this._requestLock();
  }

  resume() {
    if (this.active) this._requestLock();
  }

  setSelected(index) {
    const next = Math.max(0, Math.min(HOTBAR.length - 1, index));
    if (next !== this.selectedIndex) {
      this.selectedIndex = next;
      this.callbacks.onHotbar?.(next);
    }
  }

  get selectedBlock() {
    return HOTBAR[this.selectedIndex];
  }

  connect() {
    if (this.disposed || this.ws) return;

    let ws;
    try {
      ws = new WebSocket(websocketUrl());
    } catch {
      this.serverConnected = false;
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.disposed) return;
      this.serverConnected = true;
      const edits = [...this.world.edits.entries()].map(([key, block]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, block };
      });
      this._send({
        type: 'join',
        name: this.playerName,
        color: this.playerColor,
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        edits,
      });
      this._emitState();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handleMessage(msg);
    };

    ws.onclose = () => {
      if (this.disposed) return;
      this.ws = null;
      this.serverConnected = false;
      this._emitState();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.active && !this.disposed) this.connect();
      }, 3500);
    };

    ws.onerror = () => {
      if (ws) ws.close();
    };
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'init': {
        this.playerId = msg.id;
        if (Number.isFinite(msg.seed) && msg.seed !== this.seed) {
          this._resetWorld(msg.seed);
        }
        this.world.applyEdits(msg.edits || []);
        if (msg.players) {
          for (const remote of msg.players) {
            if (remote.id !== this.playerId) this._upsertRemote(remote);
          }
        }
        this._emitState();
        break;
      }

      case 'players': {
        const seen = new Set();
        for (const remote of msg.players || []) {
          if (remote.id === this.playerId) continue;
          seen.add(remote.id);
          this._upsertRemote(remote);
        }
        for (const [id, remote] of this.remotePlayers) {
          if (!seen.has(id)) this._removeRemote(id);
        }
        break;
      }

      case 'player-join': {
        if (msg.player && msg.player.id !== this.playerId) {
          this._upsertRemote(msg.player);
        }
        break;
      }

      case 'player-leave': {
        this._removeRemote(msg.id);
        break;
      }

      case 'block': {
        this.world.setBlock(msg.x, msg.y, msg.z, msg.block, true);
        break;
      }
    }
  }

  _resetWorld(seed) {
    this.world.dispose();
    this.seed = seed;
    this.world = new World(this.scene, this.seed);
    const spawn = this.world.findSpawn(this.seed);
    this.player.position.set(spawn.x, spawn.y, spawn.z);
    this.player.velocity.set(0, 0, 0);
    this._syncCamera();
  }

  _upsertRemote(player) {
    let remote = this.remotePlayers.get(player.id);
    if (!remote) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.75, 0.32),
        new THREE.MeshLambertMaterial({ color: player.color || '#ffffff' }),
      );
      body.position.y = 0.375;
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshLambertMaterial({ color: '#e8b58a' }),
      );
      head.position.y = 1.28;
      group.add(body, head, makeNameSprite(player.name || '玩家', player.color || '#ffffff'));
      this.scene.add(group);
      remote = {
        id: player.id,
        group,
        target: new THREE.Vector3(),
        name: player.name,
      };
      this.remotePlayers.set(player.id, remote);
    }

    remote.group.visible = true;
    remote.target.set(
      Number.isFinite(player.x) ? player.x : remote.target.x,
      Number.isFinite(player.y) ? player.y : remote.target.y,
      Number.isFinite(player.z) ? player.z : remote.target.z,
    );
    remote.yaw = Number.isFinite(player.yaw) ? player.yaw : remote.yaw || 0;
    if (player.color) {
      remote.group.children[0].material.color.set(player.color);
    }
  }

  _removeRemote(id) {
    const remote = this.remotePlayers.get(id);
    if (!remote) return;
    this.scene.remove(remote.group);
    remote.group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.map?.dispose?.();
      obj.material?.dispose?.();
    });
    this.remotePlayers.delete(id);
  }

  _send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  _requestLock() {
    try {
      const result = this.canvas.requestPointerLock?.();
      if (result?.catch) result.catch(() => {});
    } catch {
      // 某些浏览器需要用户手势，点击画布时会再次尝试
    }
  }

  _syncCamera() {
    this.camera.position.copy(this.player.eyePosition);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _onPointerLockChange() {
    const locked = document.pointerLockElement === this.canvas;
    this.callbacks.onLockChange?.(locked);
  }

  _onKeyDown(e) {
    if (!this.active) return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.back = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = true;
        break;
      case 'Space':
        this.input.jump = true;
        e.preventDefault();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.input.down = true;
        this.input.sprint = true;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.input.sprint = true;
        break;
      case 'KeyF':
        if (document.pointerLockElement === this.canvas) {
          this.player.toggleFly();
          this._emitState();
        }
        break;
      case 'Digit1': this.setSelected(0); break;
      case 'Digit2': this.setSelected(1); break;
      case 'Digit3': this.setSelected(2); break;
      case 'Digit4': this.setSelected(3); break;
      case 'Digit5': this.setSelected(4); break;
      case 'Digit6': this.setSelected(5); break;
      case 'Digit7': this.setSelected(6); break;
      case 'Digit8': this.setSelected(7); break;
      case 'Digit9': this.setSelected(8); break;
    }
  }

  _onKeyUp(e) {
    if (!this.active) return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.back = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = false;
        break;
      case 'Space':
        this.input.jump = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.input.down = false;
        this.input.sprint = false;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.input.sprint = false;
        break;
    }
  }

  _onMouseMove(e) {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    const sensitivity = 0.0023;
    this.player.yaw -= e.movementX * sensitivity;
    this.player.pitch -= e.movementY * sensitivity;
    const limit = Math.PI / 2 - 0.01;
    this.player.pitch = Math.max(-limit, Math.min(limit, this.player.pitch));
  }

  _onMouseDown(e) {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    if (e.button === 0) this._breakBlock();
    if (e.button === 2) this._placeBlock();
  }

  _onWheel(e) {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    this.setSelected((this.selectedIndex + delta + HOTBAR.length) % HOTBAR.length);
  }

  _raycast() {
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    let px = x;
    let py = y;
    let pz = z;

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? (stepX > 0 ? (x + 1 - origin.x) / dir.x : (origin.x - x) / -dir.x) : Infinity;
    let tMaxY = dir.y !== 0 ? (stepY > 0 ? (y + 1 - origin.y) / dir.y : (origin.y - y) / -dir.y) : Infinity;
    let tMaxZ = dir.z !== 0 ? (stepZ > 0 ? (z + 1 - origin.z) / dir.z : (origin.z - z) / -dir.z) : Infinity;

    let t = 0;
    while (t <= MAX_REACH) {
      const block = this.world.getBlock(x, y, z);
      if (block !== 'air') {
        return { x, y, z, px, py, pz };
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        px = x; py = y; pz = z;
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        px = x; py = y; pz = z;
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
      } else {
        px = x; py = y; pz = z;
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    return null;
  }

  _intersectsPlayer(x, y, z) {
    const p = this.player.position;
    const minX = p.x - this.player.halfWidth;
    const maxX = p.x + this.player.halfWidth;
    const minY = p.y;
    const maxY = p.y + this.player.height;
    const minZ = p.z - this.player.halfWidth;
    const maxZ = p.z + this.player.halfWidth;

    return x < maxX && x + 1 > minX && y < maxY && y + 1 > minY && z < maxZ && z + 1 > minZ;
  }

  _editBlock(x, y, z, block) {
    if (!this.world.setBlock(x, y, z, block, true)) return;
    this._send({ type: 'block', x, y, z, block });
  }

  _breakBlock() {
    const hit = this._raycast();
    if (!hit) return;
    const current = this.world.getBlock(hit.x, hit.y, hit.z);
    if (current === 'air') return;
    this._editBlock(hit.x, hit.y, hit.z, 'air');
  }

  _placeBlock() {
    const hit = this._raycast();
    if (!hit) return;
    const target = this.world.getBlock(hit.px, hit.py, hit.pz);
    if (target !== 'air' && target !== 'water') return;
    if (this._intersectsPlayer(hit.px, hit.py, hit.pz)) return;
    this._editBlock(hit.px, hit.py, hit.pz, this.selectedBlock);
  }

  _updateRemotePlayers(dt) {
    const blend = 1 - Math.exp(-10 * dt);
    for (const remote of this.remotePlayers.values()) {
      remote.group.position.lerp(remote.target, blend);
      if (remote.group.position.distanceToSquared(remote.target) > 36) {
        remote.group.position.copy(remote.target);
      }
      remote.group.rotation.y = remote.yaw || 0;
    }
  }

  _emitState(force = false) {
    const now = performance.now();
    if (!force && now - this.stateTimer < 200) return;
    this.stateTimer = now;
    this.callbacks.onState?.({
      online: this.serverConnected,
      players: this.remotePlayers.size + (this.serverConnected ? 1 : 0),
      pos: {
        x: Math.round(this.player.position.x * 10) / 10,
        y: Math.round(this.player.position.y * 10) / 10,
        z: Math.round(this.player.position.z * 10) / 10,
      },
      fps: this.fps,
      flying: this.player.flying,
      seed: this.seed,
      chunks: this.world.chunks.size,
      name: this.playerName,
    });
  }

  _loop() {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this._loop);

    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.active && document.pointerLockElement === this.canvas) {
      this.player.update(dt, this.input, this.world);
    }

    this._syncCamera();
    this.world.updateChunks(this.player.position.x, this.player.position.z);
    this._updateRemotePlayers(dt);
    this.renderer.render(this.scene, this.camera);

    this.sendTimer += dt;
    if (this.sendTimer >= 0.05 && this.serverConnected) {
      this.sendTimer = 0;
      this._send({
        type: 'move',
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
      });
    }

    this.frameCount += 1;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
    this._emitState();
  }

  dispose() {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    window.removeEventListener('resize', this._resizeHandler);
    document.removeEventListener('keydown', this._keyDownHandler);
    document.removeEventListener('keyup', this._keyUpHandler);
    document.removeEventListener('mousemove', this._mouseMoveHandler);
    document.removeEventListener('mousedown', this._mouseDownHandler);
    document.removeEventListener('wheel', this._wheelHandler);
    document.removeEventListener('pointerlockchange', this._pointerLockHandler);
    document.removeEventListener('contextmenu', this._contextMenuHandler);

    for (const id of [...this.remotePlayers.keys()]) this._removeRemote(id);
    this.world.dispose();
    this.renderer.dispose();
  }
}
