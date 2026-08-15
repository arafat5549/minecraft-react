# 前端项目统一规则（所有前端必须遵守）

> 适用范围：本工作区内的所有前端项目。新建前端项目时必须逐条满足，否则视为未完成。

## 1. 固定技术栈

| 层级 | 必须使用 |
| --- | --- |
| 运行时 | Node.js 18+（推荐 20 LTS） |
| 包管理 | npm |
| 框架 | React 18 |
| 构建工具 | Vite 5 |
| 3D / 可视化 | Three.js（需要时） |
| 后端 | Node.js + Express（需要后端时） |
| 实时通信 | ws / WebSocket（需要联机时） |
| 语言 | JavaScript/JSX 或 TypeScript/TSX |

禁止引入 jQuery 等老旧前端方案；新项目默认 `React + Vite`。

## 2. 强制 PWA

所有前端默认必须可安装、可离线打开：

1. 提供 `public/manifest.webmanifest`
2. 提供 `public/sw.js`
3. 提供 `public/icons/icon-192.png` 和 `icon-512.png`（必须同时有 maskable 版本）
4. `index.html` 必须包含 manifest、theme-color、apple-touch-icon
5. Service Worker 只在生产构建注册：
   ```js
   if ('serviceWorker' in navigator && import.meta.env.PROD) {
     navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
   }
   ```
6. 离线必须至少能打开应用；依赖后端的功能允许降级为离线/单机模式

## 3. Vite 配置规则

1. `base` 必须支持子路径部署，默认使用 `base: './'`
2. 构建输出目录固定为 `dist`
3. 前端端口统一为 `5173`，后端端口统一为 `3001`
4. 如果项目含后端，后端必须支持生产环境托管 `dist`

## 4. 强制 GitHub Actions 流程

每个前端仓库根目录必须包含：

```
.github/workflows/pages.yml
```

标准内容如下：

```yaml
name: Deploy Frontend PWA to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## 5. package.json 脚本规则

必须包含以下脚本：

```json
{
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node server/index.js"
  }
}
```

有后端时再增加 `server` 和合并启动脚本。

## 6. 目录结构规则

```
项目根目录/
├── .github/workflows/pages.yml   # 必须
├── public/
│   ├── manifest.webmanifest      # 必须
│   ├── sw.js                     # 必须
│   └── icons/                    # 必须：192/512/maskable/apple-touch
├── src/
│   ├── main.jsx                  # 入口
│   ├── App.jsx                   # 根组件
│   ├── components/               # 通用组件
│   ├── game/ 或 features/        # 业务逻辑
│   └── styles.css
├── server/index.js               # 有后端时
├── shared/                       # 前后端共享代码
├── index.html
├── vite.config.js
└── package.json
```

## 7. 联机 / 后端规则

1. 后端地址必须通过环境变量配置：`VITE_WS_URL`
2. 后端不可用时，前端必须自动进入离线模式，不允许白屏或无法启动
3. 前后端共享逻辑放 `shared/`
4. 世界/数据种子、协议、枚举等必须前后端一致

## 8. 安全规则

1. GitHub Token、密钥、`.env` 绝不写入代码、文档、聊天记录或提交到 Git
2. Token 只允许放在 GitHub Secrets 或本机环境变量
3. 泄露过的 Token 必须立即撤销并重新生成

## 9. 完成标准（Definition of Done）

- [ ] 技术栈为 Node.js + React + Vite
- [ ] `npm install && npm run build` 成功
- [ ] 生产构建包含 manifest、sw.js、完整 PWA 图标
- [ ] Service Worker 仅生产环境注册
- [ ] 存在 `.github/workflows/pages.yml`
- [ ] GitHub Pages Source 为 GitHub Actions
- [ ] Workflow 构建和部署成功
- [ ] 线上地址可安装、可离线打开
- [ ] 后端（如有）不可用时前端仍可启动并降级运行
