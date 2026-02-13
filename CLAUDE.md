# 记忆

```
sx-peerjs-http-util/
├── src/
│   ├── index.ts - PeerJsWrapper 类实现，封装 PeerJS 为类似 HTTP 的 API
│   └── types.ts - 类型定义 (Request, Response, RequestHandler, SimpleHandler, RouterMap)
├── e2e/
│   ├── test.spec.ts - Playwright E2E 测试用例
│   ├── test-server.html - 服务端测试页面
│   └── test-client.html - 客户端测试页面
├── scripts/
│   └── build.js - esbuild 构建脚本，生成 ESM 和 UMD 两种格式
├── dist/ - 编译输出目录
│   ├── index.esm.js - ES Module 格式 (NPM 引入)
│   ├── index.umd.js - IIFE 格式 (CDN 引入，已内置 PeerJS)
│   └── index.d.ts - TypeScript 类型声明
└── package.json - 项目配置
```

----

# 长期记忆

## 产品需求设计

### 核心定位
- 将浏览器端 PeerJS 封装成简单易用的类似 HTTP 的 API
- **底层需求**：简化 WebRTC P2P 通信的开发复杂度，让开发者可以像使用 HTTP API 一样使用 P2P 通信
- 此库专为浏览器设计，不是给 Node.js 后端环境使用

### API 设计
- `new PeerJsWrapper(peerId?, isDebug?)` - 创建实例，可选传入 peerId（不传则自动生成 UUID），可选开启调试模式
- `getPeerId()` - 同步方法，返回 `string`（不再是 Promise）
- `whenReady()` - 等待连接就绪，返回 `Promise<void>`
- `send(peerId, path, data)` - 发送请求到对端设备，返回 `Promise<unknown>`
- `registerHandler(path, handler)` - 注册路径处理器
- `unregisterHandler(path)` - 销毁路径处理器
- `destroy()` - 销毁实例

### 技术要点
- 每次请求都重新连接 conn（不复用连接）
- request/response 不需要 header，保持简化
- 处理器返回数据时自动装箱，send 函数返回时自动拆箱
- 在 `conn.on('data')` 获得响应后，拆包之前要校验返回状态是否正确
- **断线重连**：网络断开或连接失败时，每秒自动重连
- Peer ID 由本地生成（使用 `crypto.randomUUID()`），不依赖服务器分配
- **调试模式**：`isDebug=true` 时打印事件日志，格式为 `{对象} {事件名} {事件变量}`

### 发布信息
- NPM 包名：`sx-peerjs-http-util`
- 已发布到 https://www.npmjs.com/package/sx-peerjs-http-util
- **支持两种引入方式**：
  - NPM: `npm install sx-peerjs-http-util peerjs` (peerjs 作为外部依赖)
  - CDN: `<script src="https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js"></script>` (内置 PeerJS)
- CDN 版本全局变量名：`PeerJsHttpUtil`

## 用户喜好

- 使用 TypeScript 开发
- E2E 测试只需要测试 Chrome 浏览器
- 简洁的 API 设计，不需要复杂的 header 机制

## 技术方法

- 使用 Playwright 进行 E2E 测试
- GitHub Actions 自动发布到 npmjs
- 使用 esbuild 构建，生成两种格式：
  - ESM (`index.esm.js`) - peerjs 作为外部依赖，由用户自行安装
  - UMD/IIFE (`index.umd.js`) - 打包 peerjs，用户只需引入一个文件
- TypeScript 只生成类型声明文件 (`--emitDeclarationOnly`)
- **断线重连机制**：
  - 监听 `disconnected` 和 `error` 事件
  - 网络错误时 1 秒后自动重连
  - 重连时保持原有的 Peer ID（使用 myPeerId 存储）

## 踩坑记录

### 1. esbuild IIFE 格式不能有 external 依赖
- **问题**：`external: ['peerjs']` 在 IIFE 格式下会生成 `require('peerjs')`，浏览器无法运行
- **原因**：esbuild 对 IIFE 格式的 external 依赖使用 CommonJS require，而不是全局变量
- **解决**：UMD/CDN 版本必须打包所有依赖，不能有 external

### 2. ESM 项目中 .js 文件默认是 ES 模块
- **问题**：`"type": "module"` 的项目里，build.js 使用 `require()` 语法报错
- **解决**：改用 `import` 语法

### 3. package.json exports 字段 types 必须放第一位
- **问题**：esbuild 报警告，因为 types 在 import/require 后面会被忽略
- **解决**：exports 中 types 放在最前面

### 4. PeerJS 断线重连必须本地保存 ID
- **问题**：PeerJS 默认由服务器分配 ID，断线重连后 ID 会变化
- **解决**：构造时本地生成并保存 ID（myPeerId），重连时使用保存的 ID

## 分析时间

2026-02-13 21:30

---


