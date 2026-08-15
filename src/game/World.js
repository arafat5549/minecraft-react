import * as THREE from 'three';
import {
  BLOCKS,
  WORLD_HEIGHT,
  createHeightCache,
  getSurfaceHeight,
  hash3,
  terrainBlock,
  WATER_LEVEL,
} from '../../shared/worldgen.js';

export const CHUNK_SIZE = 16;
const RENDER_RADIUS = 3;

const FACE_DEFS = [
  { name: 'top', dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { name: 'bottom', dir: [0, -1, 0], shade: 0.52, corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
  { name: 'side', dir: [1, 0, 0], shade: 0.78, corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { name: 'side', dir: [-1, 0, 0], shade: 0.78, corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]] },
  { name: 'side', dir: [0, 0, 1], shade: 0.9, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { name: 'side', dir: [0, 0, -1], shade: 0.9, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const FACE_COUNT = FACE_DEFS.length;

function isOpaque(block) {
  const def = BLOCKS[block] || BLOCKS.air;
  return !def.transparent;
}

function shouldDrawFace(block, neighbor) {
  if (block === neighbor) return false;
  // 朝向空气的面必须绘制（包括水面、玻璃表面）
  if (neighbor === 'air') return true;

  const blockTransparent = BLOCKS[block]?.transparent !== false;
  const neighborTransparent = BLOCKS[neighbor]?.transparent !== false;

  // 两个不透明方块相邻时互相遮挡
  if (!blockTransparent && !neighborTransparent) return false;
  // 水/玻璃相邻时不绘制它们之间的面
  if (blockTransparent && neighborTransparent) return false;
  return true;
}

function baseColor(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

const colorCache = new Map();
function faceColor(block, faceIndex, x, y, z, seed) {
  const face = FACE_DEFS[faceIndex].name;
  const cacheKey = `${block}:${faceIndex}:${x % 16},${y},${z % 16},${seed}`;
  if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);

  const def = BLOCKS[block] || BLOCKS.air;
  const rgb = baseColor(def.colors[face] || def.colors.side);
  const defs = FACE_DEFS[faceIndex];
  const shade = defs.shade;
  let jitter = 0.92 + hash3(x, y, z, seed + 31) * 0.16;
  if (block === 'leaves') jitter = 0.78 + hash3(x, y, z, seed + 77) * 0.42;

  const out = [rgb[0] * shade * jitter, rgb[1] * shade * jitter, rgb[2] * shade * jitter];
  colorCache.set(cacheKey, out);
  return out;
}

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.chunks = new Map();
    this.edits = new Map();
    this.buildQueue = [];
    this.builtFrames = 0;

    this.root = new THREE.Group();
    this.root.name = 'World';
    this.scene.add(this.root);

    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });
  }

  editKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  getBlock(x, y, z, cache = null) {
    const edit = this.edits.get(this.editKey(x, y, z));
    if (edit !== undefined) return edit;
    return terrainBlock(x, y, z, this.seed, cache);
  }

  isSolid(x, y, z) {
    const block = this.getBlock(x, y, z);
    return BLOCKS[block]?.solid === true;
  }

  applyEdits(edits) {
    for (const edit of edits) {
      if (Number.isFinite(edit.x) && Number.isFinite(edit.y) && Number.isFinite(edit.z)) {
        this.edits.set(this.editKey(Math.floor(edit.x), Math.floor(edit.y), Math.floor(edit.z)), edit.block);
      }
    }
    for (const [key] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      this.rebuildChunk(cx, cz);
    }
  }

  setBlock(x, y, z, block, remesh = true) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (iy < 0 || iy >= WORLD_HEIGHT) return false;

    const key = this.editKey(ix, iy, iz);
    const existing = this.edits.get(key);
    if (existing === block) return false;

    const terrainType = terrainBlock(ix, iy, iz, this.seed);
    if (block === terrainType) {
      if (existing === undefined) return false;
      // 和自然地形一致时删除无意义的差分记录
      this.edits.delete(key);
    } else {
      this.edits.set(key, block);
    }

    if (!remesh) return true;

    const affected = new Set();
    const cx = Math.floor(ix / CHUNK_SIZE);
    const cz = Math.floor(iz / CHUNK_SIZE);
    affected.add(this.chunkKey(cx, cz));
    if ((ix & 15) === 0) affected.add(this.chunkKey(cx - 1, cz));
    if ((ix & 15) === 15) affected.add(this.chunkKey(cx + 1, cz));
    if ((iz & 15) === 0) affected.add(this.chunkKey(cx, cz - 1));
    if ((iz & 15) === 15) affected.add(this.chunkKey(cx, cz + 1));

    for (const key of affected) {
      if (this.chunks.has(key)) {
        const [acx, acz] = key.split(',').map(Number);
        this.rebuildChunk(acx, acz);
      }
    }
    return true;
  }

  findSpawn(seed = this.seed) {
    for (let r = 0; r <= 16; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dz = -r; dz <= r; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = 8 + dx;
          const z = 8 + dz;
          const h = getSurfaceHeight(x, z, seed);
          if (h > WATER_LEVEL + 1 && !this.isSolid(x, h + 1, z) && !this.isSolid(x, h + 2, z)) {
            return { x: x + 0.5, y: h + 2.2, z: z + 0.5 };
          }
        }
      }
    }
    return { x: 8.5, y: 34, z: 8.5 };
  }

  updateChunks(px, pz) {
    const ccx = Math.floor(px / CHUNK_SIZE);
    const ccz = Math.floor(pz / CHUNK_SIZE);
    const wanted = new Set();

    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx += 1) {
      for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz += 1) {
        wanted.add(this.chunkKey(ccx + dx, ccz + dz));
      }
    }

    // 卸载过远的区块
    for (const [key, chunk] of this.chunks) {
      if (wanted.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > RENDER_RADIUS + 2) {
        this._disposeChunk(key, chunk);
      }
    }

    // 按距离排队生成
    const missing = [];
    for (const key of wanted) {
      if (this.chunks.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      missing.push({ key, cx, cz, dist: Math.hypot(cx - ccx, cz - ccz) });
    }
    missing.sort((a, b) => a.dist - b.dist);
    this.buildQueue = missing;

    let built = 0;
    while (this.buildQueue.length > 0 && built < 2) {
      const next = this.buildQueue.shift();
      this._buildChunk(next.cx, next.cz);
      built += 1;
      this.builtFrames += 1;
    }
  }

  _buildChunk(cx, cz) {
    const key = this.chunkKey(cx, cz);
    if (this.chunks.has(key)) return;

    const { opaqueGeometry, transparentGeometry } = this._buildChunkGeometry(cx, cz);

    const entry = { key, opaqueMesh: null, transparentMesh: null };
    if (opaqueGeometry.attributes.position?.count) {
      entry.opaqueMesh = new THREE.Mesh(opaqueGeometry, this.opaqueMaterial);
      entry.opaqueMesh.matrixAutoUpdate = false;
      this.root.add(entry.opaqueMesh);
    } else {
      opaqueGeometry.dispose();
    }

    if (transparentGeometry.attributes.position?.count) {
      entry.transparentMesh = new THREE.Mesh(transparentGeometry, this.transparentMaterial);
      entry.transparentMesh.matrixAutoUpdate = false;
      entry.transparentMesh.renderOrder = 2;
      this.root.add(entry.transparentMesh);
    } else {
      transparentGeometry.dispose();
    }

    this.chunks.set(key, entry);
  }

  rebuildChunk(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) this._disposeChunk(key, existing);
    this._buildChunk(cx, cz);
  }

  _disposeChunk(key, chunk) {
    this.root.remove(chunk.opaqueMesh);
    this.root.remove(chunk.transparentMesh);
    chunk.opaqueMesh?.geometry?.dispose();
    chunk.transparentMesh?.geometry?.dispose();
    this.chunks.delete(key);
  }

  _buildChunkGeometry(cx, cz) {
    const opaquePositions = [];
    const opaqueColors = [];
    const opaqueIndices = [];
    const transparentPositions = [];
    const transparentColors = [];
    const transparentIndices = [];

    const heightCache = createHeightCache();
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          const wx = baseX + lx;
          const wz = baseZ + lz;
          const block = this.getBlock(wx, y, wz, heightCache);
          if (block === 'air') continue;

          const blockDef = BLOCKS[block];
          const transparent = blockDef.transparent;
          const positions = transparent ? transparentPositions : opaquePositions;
          const colors = transparent ? transparentColors : opaqueColors;
          const indices = transparent ? transparentIndices : opaqueIndices;

          for (let f = 0; f < FACE_COUNT; f += 1) {
            const face = FACE_DEFS[f];
            const nx = wx + face.dir[0];
            const ny = y + face.dir[1];
            const nz = wz + face.dir[2];
            if (ny < 0 || ny >= WORLD_HEIGHT) continue;

            const neighbor = this.getBlock(nx, ny, nz, heightCache);
            if (!shouldDrawFace(block, neighbor)) continue;

            const start = positions.length / 3;
            const color = faceColor(block, f, wx, y, wz, this.seed);

            for (const corner of face.corners) {
              positions.push(
                wx + corner[0],
                y + corner[1],
                wz + corner[2],
              );
              colors.push(color[0], color[1], color[2]);
            }

            indices.push(
              start, start + 1, start + 2,
              start, start + 2, start + 3,
            );
          }
        }
      }
    }

    const opaqueGeometry = this._geometryFromArrays(opaquePositions, opaqueColors, opaqueIndices);
    const transparentGeometry = this._geometryFromArrays(transparentPositions, transparentColors, transparentIndices);
    return { opaqueGeometry, transparentGeometry };
  }

  _geometryFromArrays(positions, colors, indices) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  dispose() {
    for (const [key, chunk] of this.chunks) {
      this._disposeChunk(key, chunk);
    }
    this.scene.remove(this.root);
    this.opaqueMaterial.dispose();
    this.transparentMaterial.dispose();
    colorCache.clear();
  }
}
