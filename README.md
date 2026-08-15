# ReactCraft · 我的世界（Node.js + React + Vite）

一个可直接运行的浏览器体素沙盒游戏，风格类似 Minecraft。前端使用 **React + Vite + Three.js** 构建体素世界与第一人称操作，后端使用 **Node.js + Express + WebSocket** 提供多人联机、区块改动同步与生产环境静态托管。

## ✨ 功能特性

- 🧊 程序化生成的无限（可扩展）体素地形：草地、沙滩、石头、雪山、湖泊、树木
- 🖱 第一人称视角：WASD 移动、空格跳跃、Shift 疾跑/下降、F 切换飞行
- ⛏ 破坏与放置方块：左键破坏、右键放置、1-9/滚轮选择方块
- 🌐 多人联机：玩家位置实时同步、方块改动同步、离线编辑自动合并
- 🧩 确定性世界种子：客户端与服务器共享同一套世界生成算法
- 🏭 生产模式：一条命令启动，Node.js 直接托管 Vite 构建产物

## 🚀 快速开始

要求：Node.js 18+（推荐 20/22）

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（同时启动 Vite 5173 和 WebSocket 服务器 3001）
npm run dev
```

打开浏览器访问：<http://localhost:5173>

生产模式：

```bash
npm run build   # 构建到 dist/
npm start       # Node 服务器托管 dist，访问 http://localhost:3001
```

## 🎮 操作说明

| 操作 | 效果 |
| --- | --- |
| 鼠标移动 | 转动视角 |
| W / A / S / D | 移动 |
| 空格 | 跳跃（飞行模式：上升） |
| Shift | 疾跑（飞行模式：下降） |
| F | 切换创造飞行模式 |
| 鼠标左键 | 破坏方块 |
| 鼠标右键 | 放置方块 |
| 1 - 9 / 鼠标滚轮 | 选择快捷栏方块 |
| Esc | 暂停并释放鼠标 |

## 🧱 方块列表

草方块、泥土、石头、沙子、原木、树叶、木板、玻璃、水，以及地形自然生成的雪块。

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | Node 服务器端口 |
| `WORLD_SEED` | `528` | 世界种子（决定地形） |
| `VITE_WS_URL` | 自动推导 | 前端 WebSocket 地址，开发模式默认 `ws://localhost:3001/ws` |

示例：

```bash
PORT=8080 WORLD_SEED=8888 npm start
```

## 📁 项目结构

```
minecraft-react/
├── server/
│   └── index.js           # Express + WebSocket 多人服务器
├── shared/
│   └── worldgen.js        # 前后端共享：噪声、地形生成、方块定义
├── src/
│   ├── game/
│   │   ├── Game.js        # 游戏主循环、输入、射线拾取、网络客户端
│   │   ├── World.js       # 区块网格构建、方块编辑、世界渲染
│   │   └── Player.js      # 玩家物理与碰撞
│   ├── App.jsx            # React 界面（菜单、HUD、快捷栏）
│   ├── main.jsx
│   └── styles.css
├── index.html
└── vite.config.js
```

## 🔌 WebSocket 协议

客户端连接 `/ws` 后发送：

- `join`：加入游戏
- `move`：上报位置/朝向
- `block`：方块编辑

服务器广播：

- `init`：分配玩家 ID、下发种子、玩家列表与方块差分
- `players`：所有玩家状态
- `player-join` / `player-leave`：玩家进出
- `block`：方块变更

## 📝 说明

- 世界高度为 48 格，渲染半径为 3 个区块（48 格）。
- 服务端只保存“玩家编辑过的方块差分”，自然地形由客户端按种子确定性生成。
- 飞行模式为创造模式体验，可以自由穿行并快速建造。
