import { useEffect, useRef, useState } from 'react';
import { BLOCKS, HOTBAR } from '../shared/worldgen.js';
import { Game } from './game/Game.js';

const DEFAULT_HUD = {
  online: false,
  players: 1,
  pos: { x: 0, y: 0, z: 0 },
  fps: 0,
  flying: false,
  seed: 0,
  chunks: 0,
  name: '玩家',
};

function BlockIcon({ block, size = 40 }) {
  const def = BLOCKS[block] || BLOCKS.air;
  return (
    <span
      className="block-icon"
      style={{
        width: size,
        height: size,
        background: def.colors.side,
        boxShadow: `inset 0 ${Math.max(3, size * 0.18)}px 0 rgba(0,0,0,0.18), inset 0 0 0 2px rgba(255,255,255,0.08)`,
      }}
      title={def.name}
    />
  );
}

export default function App() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState('menu');
  const [locked, setLocked] = useState(false);
  const [selected, setSelected] = useState(0);
  const [hud, setHud] = useState(DEFAULT_HUD);
  const [name, setName] = useState(() => localStorage.getItem('reactcraft-name') || '建筑师');
  const [color, setColor] = useState(() => localStorage.getItem('reactcraft-color') || '#4fc3f7');

  useEffect(() => {
    const game = new Game(canvasRef.current, {
      onState: setHud,
      onLockChange: setLocked,
      onHotbar: setSelected,
    });
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('reactcraft-name', name);
    localStorage.setItem('reactcraft-color', color);
  }, [name, color]);

  const handleStart = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    gameRef.current?.start(name.trim(), color);
    setPhase('playing');
  };

  const handleResume = () => {
    gameRef.current?.resume();
  };

  const selectedBlock = HOTBAR[selected];

  return (
    <div className={`app ${phase === 'menu' ? 'app--menu' : ''}`}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        onClick={() => {
          if (phase === 'playing' && !locked) handleResume();
        }}
      />

      {phase === 'playing' && (
        <div className={`hud ${locked ? 'hud--locked' : ''}`}>
          <div className="crosshair">
            <span className="crosshair__v" />
            <span className="crosshair__h" />
          </div>

          <div className="panel panel--top-left">
            <div className="status-line">
              <span className={`status-dot ${hud.online ? 'status-dot--online' : ''}`} />
              <strong>{hud.online ? '多人已连接' : '离线单机'}</strong>
              <span className="muted">· 在线 {hud.players} 人</span>
            </div>
            <div className="muted mono">
              XYZ {hud.pos.x} / {hud.pos.y} / {hud.pos.z}
            </div>
            <div className="muted mono">种子 {hud.seed} · 区块 {hud.chunks}</div>
          </div>

          <div className="panel panel--top-right mono">
            <div>{hud.fps} FPS</div>
            <div>{hud.flying ? '飞行模式' : '行走模式'}</div>
            <div className="muted">{hud.name}</div>
          </div>

          <div className="hotbar">
            <span className="hotbar__name">{BLOCKS[selectedBlock]?.name || selectedBlock}</span>
            <div className="hotbar__slots">
              {HOTBAR.map((block, index) => (
                <button
                  key={block}
                  type="button"
                  className={`hotbar__slot ${index === selected ? 'hotbar__slot--selected' : ''}`}
                  onClick={() => gameRef.current?.setSelected(index)}
                  tabIndex={-1}
                >
                  <BlockIcon block={block} />
                  <span className="hotbar__key">{index + 1}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="help mono">
            <div>WASD 移动 · 空格 跳跃 · Shift 疾跑/下降 · F 飞行</div>
            <div>左键 破坏 · 右键 放置 · 1-9/滚轮 选方块 · Esc 暂停</div>
          </div>

          {!locked && (
            <div className="overlay">
              <div className="overlay__card">
                <h2>游戏已暂停</h2>
                <p>点击下方按钮或直接点击画面继续探索。</p>
                <button type="button" className="btn" onClick={handleResume}>
                  ▶ 继续游戏
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'menu' && (
        <div className="overlay overlay--menu">
          <div className="menu-card">
            <div className="menu-card__logo">
              <span className="logo-block logo-block--1" />
              <span className="logo-block logo-block--2" />
              <span className="logo-block logo-block--3" />
            </div>
            <h1>ReactCraft</h1>
            <p className="tagline">浏览器里的体素世界 · Node.js + React + Vite + Three.js</p>

            <form className="join-form" onSubmit={handleStart}>
              <label>
                <span>玩家名称</span>
                <input
                  value={name}
                  maxLength={16}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入你的名字"
                />
              </label>
              <label>
                <span>玩家颜色</span>
                <div className="color-row">
                  {['#4fc3f7', '#81c784', '#ffb74d', '#f06292', '#ba68c8', '#fff176'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch ${color === c ? 'color-swatch--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      aria-label={c}
                    />
                  ))}
                </div>
              </label>
              <button type="submit" className="btn btn--big" disabled={!name.trim()}>
                ⛏ 进入世界
              </button>
            </form>

            <div className="menu-card__tip mono">
              启动方式：终端运行 <code>npm run dev</code>，然后打开 http://localhost:5173
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
