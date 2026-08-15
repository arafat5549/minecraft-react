// 前后端共享的世界生成与方块定义。
// 客户端用它生成地形，服务端用它校验方块 ID。

export const WORLD_HEIGHT = 48;
export const WATER_LEVEL = 16;
export const DEFAULT_SEED = 528;

export const BLOCK_LIST = [
  'grass',
  'dirt',
  'stone',
  'sand',
  'log',
  'leaves',
  'planks',
  'glass',
  'water',
];

export const BLOCKS = {
  air: {
    name: '空气',
    solid: false,
    transparent: true,
    colors: { top: '#000000', side: '#000000', bottom: '#000000' },
  },
  grass: {
    name: '草方块',
    solid: true,
    transparent: false,
    colors: { top: '#67b93b', side: '#7c5431', bottom: '#8b5a3c' },
  },
  dirt: {
    name: '泥土',
    solid: true,
    transparent: false,
    colors: { top: '#8b5a3c', side: '#7f4f30', bottom: '#6e4428' },
  },
  stone: {
    name: '石头',
    solid: true,
    transparent: false,
    colors: { top: '#8d9299', side: '#797f86', bottom: '#6d737a' },
  },
  sand: {
    name: '沙子',
    solid: true,
    transparent: false,
    colors: { top: '#e3d68c', side: '#d5c678', bottom: '#c3b369' },
  },
  log: {
    name: '原木',
    solid: true,
    transparent: false,
    colors: { top: '#b99058', side: '#6e4d29', bottom: '#b99058' },
  },
  leaves: {
    name: '树叶',
    solid: true,
    transparent: false,
    colors: { top: '#42862c', side: '#357024', bottom: '#2e6320' },
  },
  planks: {
    name: '木板',
    solid: true,
    transparent: false,
    colors: { top: '#b58a50', side: '#a87d46', bottom: '#9c713d' },
  },
  glass: {
    name: '玻璃',
    solid: true,
    transparent: true,
    colors: { top: '#d8edf5', side: '#bfe0ec', bottom: '#d8edf5' },
  },
  water: {
    name: '水',
    solid: false,
    transparent: true,
    colors: { top: '#3f6fdd', side: '#2f5fc9', bottom: '#2a55b2' },
  },
  snow: {
    name: '雪',
    solid: true,
    transparent: false,
    colors: { top: '#f2f7f8', side: '#dce8ec', bottom: '#c9d8dd' },
  },
};

export const HOTBAR = [
  'grass',
  'dirt',
  'stone',
  'sand',
  'log',
  'leaves',
  'planks',
  'glass',
  'water',
];

export const SPAWN = { x: 8.5, y: 32, z: 8.5 };

// ---------- 确定性噪声 ----------

export function hash2(x, z, seed) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 974634721);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function hash3(x, y, z, seed) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 2246822519) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 974634721);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise2(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);

  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);

  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

export function fbm2(x, z, seed) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    value += valueNoise2(x * frequency, z * frequency, seed + i * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

export function createHeightCache() {
  return new Map();
}

function heightKey(x, z) {
  return `${x},${z}`;
}

export function getSurfaceHeight(x, z, seed, cache = null) {
  const key = heightKey(x, z);
  if (cache && cache.has(key)) return cache.get(key);

  const continent = fbm2(x * 0.012, z * 0.012, seed);
  const hills = fbm2(x * 0.05 + 131.7, z * 0.05 - 77.3, seed + 997);
  const detail = fbm2(x * 0.16 + 55.2, z * 0.16 + 19.8, seed + 451);

  let h = 9 + continent * 25 + hills * 9 + detail * 2.5;
  h = Math.floor(h);
  h = Math.max(4, Math.min(WORLD_HEIGHT - 8, h));

  if (cache) cache.set(key, h);
  return h;
}

export function isTreeAt(tx, tz, seed) {
  return hash2(tx, tz, seed + 777) % 17 === 0;
}

// ---------- 方块查询 ----------

function groundBlock(y, h, seed, cache) {
  if (y === h) {
    if (h <= WATER_LEVEL + 1) return 'sand';
    if (h >= 36) return 'snow';
    return 'grass';
  }

  // 海边/湖底的沙层
  if (h <= WATER_LEVEL + 2) {
    return y >= h - 3 ? 'sand' : 'stone';
  }

  return y >= h - 3 ? 'dirt' : 'stone';
}

function treeBlock(x, y, z, seed, h, cache = null) {
  const trunkTop = h + 4;

  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const tx = x + dx;
      const tz = z + dz;
      if (!isTreeAt(tx, tz, seed)) continue;

      const th = getSurfaceHeight(tx, tz, seed, cache);
      // 树只长在草地/泥土上
      if (th <= WATER_LEVEL + 1 || th >= 36) continue;

      const lx = x - tx;
      const lz = z - tz;
      const dy = y - th;
      const r = Math.max(Math.abs(lx), Math.abs(lz));

      if (lx === 0 && lz === 0 && dy > 0 && dy <= 4) return 'log';

      if (dy >= 2 && dy <= 3 && r <= 1) return 'leaves';
      if (dy === 4 && r <= 2) {
        // 树冠四角挖空，更像 Minecraft
        if (!(r === 2 && Math.abs(lx) === Math.abs(lz))) return 'leaves';
      }
      if (dy === 5 && r <= 1) {
        if (lx === 0 || lz === 0) return 'leaves';
      }
    }
  }

  return 'air';
}

export function terrainBlock(x, y, z, seed, cache = null) {
  if (y < 0 || y >= WORLD_HEIGHT) return 'air';

  const h = getSurfaceHeight(x, z, seed, cache);

  if (y <= h) {
    return groundBlock(y, h, seed, cache);
  }

  if (y <= WATER_LEVEL) return 'water';

  if (y > h + 6) return 'air';
  return treeBlock(x, y, z, seed, h, cache);
}
