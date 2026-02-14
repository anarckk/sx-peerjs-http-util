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
├── test/
│   ├── chat.html - P2P 即时聊天工具主页面
│   ├── chat.js - 主逻辑（初始化、UI渲染、事件绑定）
│   ├── chat-db.js - IndexedDB 操作（消息、联系人、文件）
│   ├── chat-file.js - 文件传输核心逻辑（小文件直接传输、大文件分片传输）
│   └── chat-file-ui.js - 文件传输 UI 组件（图片、视频、文件消息气泡）
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
- `new PeerJsWrapper(peerId?, isDebug?, server?)` - 创建实例，可选传入 peerId（不传则自动生成 UUID），可选开启调试模式，可选自定义信令服务器
- `getPeerId()` - 同步方法，返回 `string`（不再是 Promise）
- `whenReady()` - 等待连接就绪，返回 `Promise<void>`
- `send(peerId, path, data)` - 发送请求到对端设备，返回 `Promise<unknown>`（非 2xx 状态码会抛出异常）
- `registerHandler(path, handler)` - 注册路径处理器，handler 签名为 `(from: string, data?: unknown) => Promise<unknown> | unknown`
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

### P2P Chat 文件传输功能
- **小文件传输**（<100MB）：直接传输，一次性发送完整文件
- **大文件传输**（≥100MB）：分片传输，每片 1MB，串行发送
- **边接收边存储**：大文件分片立即写入 IndexedDB，避免内存溢出
- **视频流式播放**：使用 MediaSource API 实现边下载边播放
- **支持的文件类型**：图片、视频、任意类型文件，无文件大小上限
- **传输协议**：
  - `/file` - 小文件直接传输
  - `/file/start` - 大文件开始（发送元信息）
  - `/file/chunk` - 大文件分片
  - `/file/complete` - 大文件完成
- **消息持久化**：文本消息和文件都存储在 IndexedDB

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
- **测试自动化**：测试时如果发现服务未启动，AI 应该自己启动服务，职责是确保测试用例通过
- 底层字段不应该入侵业务数据对象（如 `from` 应由底层传入，而非放在 data 里）

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

### 5. E2E 测试应使用 UMD 版本
- **问题**：ESM 版本在浏览器中直接加载需要 importmap 或打包工具，否则无法解析 `peerjs` 裸模块说明符
- **解决**：E2E 测试使用 UMD 版本（已内置 peerjs），通过 `<script>` 标签引入

### 6. 测试页面与测试脚本的时序问题
- **问题**：页面 `whenReady()` 可能在测试脚本设置回调之前完成，导致回调丢失
- **解决**：页面存储 `peerReady` 和 `peerId` 状态，测试脚本检查状态或等待回调

### 7. E2E 测试需要 HTTP 服务器
- **问题**：`file://` 协议不支持 ES 模块加载（CORS 限制）
- **解决**：使用 `npx serve` 启动 HTTP 服务器，测试通过 HTTP 访问页面

### 8. CSS 隐藏元素导致布局抖动
- **问题**：`display: none/block` 切换会让元素脱离/进入文档流，导致容器高度变化、布局抖动
- **解决**：需要"隐藏但占位"时，使用 `opacity: 0/1` + `pointer-events: none/auto` 组合
- **原则**：`display: none` 只在确实不需要占位时使用；需要保持布局稳定时用 `opacity` 或 `visibility`

### 9. max-width 百分比与 display: inline-flex/table 的循环依赖
- **问题**：子元素 `max-width: 70%` + 父元素 `display: inline-flex/table` 会导致文字逐字符换行
- **原因**：`inline-flex`/`table` 的宽度由子内容决定，而子元素的 `max-width: %` 又依赖父元素宽度，形成循环依赖，浏览器计算出极小宽度
- **解决**：在包裹容器（有明确父级宽度参考的元素）上直接设置 `max-width: %`，让子元素自然撑开
- **原则**：`max-width` 百分比应设置在有**确定父级宽度**的元素上，不要设置在宽度由子内容决定的元素上

### 10. DOM 元素创建后必须添加到文档
- **问题**：`createFileButton` 创建了按钮元素并返回，但忘记添加到容器中，导致按钮不显示
- **原因**：只关注创建逻辑，忽略了 DOM 操作的完整性
- **原则**：创建 DOM 元素的函数，要么在内部添加到文档，要么明确说明由调用方添加

### 11. 文件分片阈值要考虑网络超时
- **问题**：63MB 文件走直接传输，30 秒超时不够用
- **原因**：阈值（100MB）只考虑了内存，没考虑网络传输时间
- **解决**：阈值从 100MB 降到 10MB，让中等文件也走分片传输
- **原则**：直接传输的阈值不能只看内存，还要考虑**单次请求超时内能传完的大小**
- **延伸**：分片传输的优势不仅是节省内存，还能解决网络不稳定和超时问题

## 上次用户提示词分析时间

2026-02-14 11:43

---

# e2e文档规范

在项目目录 CLAUDE.md 中维护一个篇章 `# e2e测试用例`，格式如下：

- [x] {测试项A}
- [ ] {测试项A}

记录所有的e2e测试项，以及其是否通过e2e测试。

---

# e2e测试用例

- [x] 应该发送请求并接收响应（自动拆箱）
- [x] 应该处理404路径未找到错误
- [x] 应该处理处理器抛出的错误
- [x] 应该回显数据
- [x] 应该处理多个并发请求
- [x] 应该支持不带数据参数的请求
- [x] 应该支持注册和注销处理器
- [x] 应该正确传递发送者的 Peer ID (from 参数)

**运行方式**：
1. 启动私有信令服务器：`cd peerjs-server && node server.js`
2. 启动 HTTP 服务器：`npx serve -l 8080`
3. 运行测试：`npm run test:e2e`

---

