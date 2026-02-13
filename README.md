# sx-peerjs-http-util

一个浏览器端库，将 PeerJS 封装成简单易用的类似 HTTP 的 API。

## 特性

- 简单的请求-响应 API，类似 HTTP
- 基于 PeerJS (WebRTC) 实现 P2P 通信
- TypeScript 支持
- 完整的 E2E 测试
- **支持 NPM 和 CDN 两种引入方式**
- **自动断线重连**
- **可指定或自动生成 Peer ID**

## 安装

### NPM 方式

```bash
npm install sx-peerjs-http-util peerjs
```

### CDN 方式

```html
<!-- UMD 版本已内置 PeerJS，只需引入一个文件 -->
<script src="https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js"></script>
```

## 使用方式

### PeerJsWrapper 类

```typescript
import { PeerJsWrapper } from 'sx-peerjs-http-util';

// 创建实例（不指定 ID 则自动生成 UUID）
const wrapper = new PeerJsWrapper();

// 或指定 Peer ID
// const wrapper = new PeerJsWrapper('my-custom-id');

// 等待连接就绪
await wrapper.whenReady();

// 获取 Peer ID（同步方法）
const peerId = wrapper.getPeerId();
console.log('My Peer ID:', peerId);
```

### 发送请求 (send)

```typescript
// 发送请求到对端设备
const data = await wrapper.send('remote-peer-id', '/api/hello', { name: 'world' });
console.log(data); // 直接输出响应数据（自动拆箱）
```

### 注册处理器 (registerHandler)

```typescript
// 服务端注册处理器
wrapper.registerHandler('/api/hello', (data) => {
  return { message: 'hello', received: data }; // 直接返回数据，自动装箱
});

// 注销处理器
wrapper.unregisterHandler('/api/hello');
```

### 销毁实例 (destroy)

```typescript
wrapper.destroy();
```

## 完整示例

### NPM 方式 - 服务器端

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>
</head>
<body>
  <h1>Server</h1>
  <div id="peer-id"></div>

  <script type="module">
    import { PeerJsWrapper } from 'https://unpkg.com/sx-peerjs-http-util/dist/index.esm.js';

    const wrapper = new PeerJsWrapper();

    wrapper.registerHandler('/api/hello', (data) => {
      return { message: 'Hello from server', received: data };
    });

    wrapper.whenReady().then(() => {
      document.getElementById('peer-id').textContent = `Peer ID: ${wrapper.getPeerId()}`;
    });
  </script>
</body>
</html>
```

### CDN 方式 - 服务器端

```html
<!DOCTYPE html>
<html>
<head>
  <!-- CDN 版本已内置 PeerJS -->
  <script src="https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js"></script>
</head>
<body>
  <h1>Server</h1>
  <div id="peer-id"></div>

  <script>
    const wrapper = new PeerJsHttpUtil.PeerJsWrapper();

    wrapper.registerHandler('/api/hello', (data) => {
      return { message: 'Hello from server', received: data };
    });

    wrapper.whenReady().then(() => {
      document.getElementById('peer-id').textContent = `Peer ID: ${wrapper.getPeerId()}`;
    });
  </script>
</body>
</html>
```

### 客户端

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js"></script>
</head>
<body>
  <h1>Client</h1>
  <button onclick="sendRequest()">Send Request</button>

  <script>
    const wrapper = new PeerJsHttpUtil.PeerJsWrapper();

    async function sendRequest() {
      try {
        const data = await wrapper.send('server-peer-id', '/api/hello', { test: 'data' });
        console.log('Response:', data);
      } catch (err) {
        console.error('Error:', err.message);
      }
    }
  </script>
</body>
</html>
```

## API 参考

### `new PeerJsWrapper(peerId?: string, isDebug?: boolean, server?: ServerConfig)`

创建 PeerJsWrapper 实例。

- `peerId` (可选): 指定 Peer ID，不提供则自动生成 UUID
- `isDebug` (可选): 是否开启调试模式，开启后会打印事件日志，格式为 `{对象} {事件名} {事件变量}`
- `server` (可选): 自定义信令服务器配置，不提供则使用 PeerJS 公共服务器
  - `host`: 服务器地址
  - `port`: 端口号
  - `path`: 路径（如 `/peerjs`）
  - `secure`: 是否使用 HTTPS/WSS

### `getPeerId(): string`

获取当前 Peer ID（同步方法，立即返回）。

### `whenReady(): Promise<void>`

等待 Peer 连接到信令服务器。

### `send(peerId: string, path: string, data?: unknown): Promise<unknown>`

发送请求到指定 Peer。

- `peerId`: 对端设备 ID
- `path`: 请求路径
- `data`: 请求数据 (可选)
- 返回: 响应数据（自动拆箱，只返回 data 部分）

### `registerHandler(path: string, handler: SimpleHandler): void`

注册路径处理器。

- `path`: 请求路径
- `handler`: 处理器函数，接收请求数据，返回响应数据

### `unregisterHandler(path: string): void`

注销路径处理器。

### `destroy(): void`

关闭所有连接并销毁实例。

## E2E 测试

```bash
npm run test:e2e
```

## 注意事项

- 每次请求都会创建新的 Peer 连接，请求完成后会自动清理
- 请求超时时间为 30 秒
- 此库仅用于浏览器环境
- 需要使用 PeerJS 信令服务器（默认使用公共服务器）
- CDN 版本 (UMD) 已内置 PeerJS，无需额外引入
- NPM 版本需要单独安装 peerjs 依赖
- **自动断线重连**：网络断开时会自动尝试重连（每秒重试一次）

## 发布

- NPM: https://www.npmjs.com/package/sx-peerjs-http-util
- CDN: https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js
