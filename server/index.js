import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BLOCK_LIST, DEFAULT_SEED, WORLD_HEIGHT, WATER_LEVEL } from '../shared/worldgen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const SEED = Number(process.env.WORLD_SEED || DEFAULT_SEED);

const app = express();
app.use(express.json());

// REST API
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    seed: SEED,
    online: players.size,
    edits: edits.size,
    time: Date.now(),
  });
});

// 生产环境：由 Node 服务托管 Vite 构建产物
const dist = path.resolve(__dirname, '../dist');
app.use(express.static(dist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const players = new Map();
const edits = new Map();
let nextPlayerId = 1;

const validBlocks = new Set(BLOCK_LIST);
validBlocks.add('air');

function key(x, y, z) {
  return `${x},${y},${z}`;
}

function broadcast(type, payload, except = null) {
  const message = JSON.stringify({ type, ...payload });
  for (const client of wss.clients) {
    if (client !== except && client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function broadcastPlayers() {
  broadcast('players', { players: [...players.values()] });
}

function send(client, type, payload = {}) {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify({ type, ...payload }));
  }
}

function sanitizePosition(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

wss.on('connection', (ws) => {
  const id = nextPlayerId;
  nextPlayerId += 1;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const player = {
          id,
          name: String(msg.name || `玩家${id}`).slice(0, 16),
          color: /^#[0-9a-fA-F]{6}$/.test(msg.color || '') ? msg.color : '#4fc3f7',
          x: sanitizePosition(msg.x, 8.5, -1000, 1000),
          y: sanitizePosition(msg.y, WATER_LEVEL + 18, -20, 500),
          z: sanitizePosition(msg.z, 8.5, -1000, 1000),
          yaw: sanitizePosition(msg.yaw, 0, -Math.PI * 4, Math.PI * 4),
          pitch: sanitizePosition(msg.pitch, 0, -Math.PI / 2, Math.PI / 2),
        };
        players.set(id, player);

        // 离线编辑的玩家重新上线时，把本地改动合并到服务器
        if (Array.isArray(msg.edits)) {
          for (const edit of msg.edits) {
            const x = Math.floor(Number(edit.x));
            const y = Math.floor(Number(edit.y));
            const z = Math.floor(Number(edit.z));
            const block = edit.block;
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            if (y < 0 || y >= WORLD_HEIGHT || Math.abs(x) > 2000 || Math.abs(z) > 2000) continue;
            if (!validBlocks.has(block)) continue;
            edits.set(key(x, y, z), block);
            broadcast('block', { x, y, z, block, by: id }, ws);
          }
        }

        send(ws, 'init', {
          id,
          seed: SEED,
          players: [...players.values()],
          edits: [...edits.entries()].map(([k, block]) => {
            const [x, y, z] = k.split(',').map(Number);
            return { x, y, z, block };
          }),
        });
        broadcast('player-join', { player }, ws);
        broadcastPlayers();
        console.log(`[ReactCraft] ${player.name} 加入了游戏 (${wss.clients.size} 人在线)`);
        break;
      }

      case 'move': {
        const player = players.get(id);
        if (!player) return;
        player.x = sanitizePosition(msg.x, player.x, -1000, 1000);
        player.y = sanitizePosition(msg.y, player.y, -20, 500);
        player.z = sanitizePosition(msg.z, player.z, -1000, 1000);
        player.yaw = sanitizePosition(msg.yaw, player.yaw, -Math.PI * 4, Math.PI * 4);
        player.pitch = sanitizePosition(msg.pitch, player.pitch, -Math.PI / 2, Math.PI / 2);
        break;
      }

      case 'block': {
        const x = Math.floor(Number(msg.x));
        const y = Math.floor(Number(msg.y));
        const z = Math.floor(Number(msg.z));
        const block = msg.block;

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        if (y < 0 || y >= WORLD_HEIGHT || Math.abs(x) > 2000 || Math.abs(z) > 2000) return;
        if (!validBlocks.has(block)) return;

        edits.set(key(x, y, z), block);
        broadcast('block', { x, y, z, block, by: id });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (players.delete(id)) {
      broadcast('player-leave', { id });
      broadcastPlayers();
      console.log(`[ReactCraft] 玩家 ${id} 离开 (${wss.clients.size} 人在线)`);
    }
  });

  ws.on('error', () => {
    ws.close();
  });
});

// 每 50ms 广播一次所有玩家位置（20Hz）
const broadcastTimer = setInterval(() => {
  if (players.size > 0) broadcastPlayers();
}, 50);
broadcastTimer.unref?.();

server.listen(PORT, () => {
  console.log(`[ReactCraft] 服务器已启动: http://localhost:${PORT}`);
  console.log(`[ReactCraft] WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`[ReactCraft] 世界种子: ${SEED}`);
});
