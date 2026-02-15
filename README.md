# sx-peerjs-http-util

一个浏览器端库，将 PeerJS 封装成简单易用的类似 HTTP 的 API，并支持语音/视频通话。

## 在线 Demo

| Demo | 说明 |
|------|------|
| [文字传输](https://anarckk.github.io/sx-peerjs-http-util/demos/text-chat/index.html) | P2P 即时聊天 |
| [文件传输](https://anarckk.github.io/sx-peerjs-http-util/demos/file-transfer/index.html) | 点对点文件传输 |
| [语音通话](https://anarckk.github.io/sx-peerjs-http-util/demos/voice-call/index.html) | 一对一语音通话 |
| [视频通话](https://anarckk.github.io/sx-peerjs-http-util/demos/video-call/index.html) | 一对一视频通话 |

> **提示**：打开两个浏览器窗口，分别选择"身份1"和"身份2"即可开始通信，无需手动复制 Peer ID。

## 特性

- 简单的请求-响应 API，类似 HTTP
- 基于 PeerJS (WebRTC) 实现 P2P 通信
- **语音/视频通话**：支持一对一语音和视频通话
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
wrapper.registerHandler('/api/hello', (from, data) => {
  return { message: 'hello', received: data }; // 直接返回数据，自动装箱
});

// 注销处理器
wrapper.unregisterHandler('/api/hello');
```

### 语音/视频通话

```typescript
// 发起语音通话
const callSession = await wrapper.call('remote-peer-id', { video: false });

// 发起视频通话
// const callSession = await wrapper.call('remote-peer-id', { video: true });

// 监听来电
wrapper.onIncomingCall((event) => {
  console.log('来电:', event.from, event.hasVideo ? '视频' : '语音');

  // 接听
  const session = await event.answer();

  // 或拒绝
  // event.reject();
});

// 获取本地媒体流（立即可用）
const localStream = callSession.getLocalStream();

// 远程媒体流需要等待 connected 状态
callSession.onStateChange((state) => {
  if (state === 'connected') {
    const remoteStream = callSession.getRemoteStream();
    // 将 remoteStream 设置到 <audio> 或 <video> 元素
  }
});

// 控制通话
callSession.toggleMute();   // 切换静音
callSession.toggleVideo();  // 切换视频开关
callSession.hangUp();       // 挂断
```

### 销毁实例 (destroy)

```typescript
wrapper.destroy();
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
- `handler`: 处理器函数，签名 `(from: string, data?: unknown) => Promise<unknown> | unknown`

### `unregisterHandler(path: string): void`

注销路径处理器。

### `call(peerId: string, options?: CallOptions): Promise<CallSession>`

发起语音/视频通话。

- `peerId`: 对端设备 ID
- `options`: 通话选项
  - `video`: 是否启用视频（默认 false）
  - `metadata`: 自定义元数据
- 返回: `CallSession` 通话会话对象

### `onIncomingCall(listener: IncomingCallListener): void`

注册来电监听器。

- `listener`: 监听器函数，接收 `IncomingCallEvent` 对象

### `offIncomingCall(listener: IncomingCallListener): void`

移除来电监听器。

### `getActiveCall(): CallSession | null`

获取当前活跃的通话会话。

### `destroy(): void`

关闭所有连接并销毁实例（会自动挂断活跃通话）。

## CallSession 接口

通话会话对象，用于控制通话。

| 属性/方法 | 说明 |
|-----------|------|
| `peerId` | 对端的 Peer ID |
| `hasVideo` | 是否包含视频 |
| `isConnected` | 是否已连接 |
| `getLocalStream()` | 获取本地媒体流 |
| `getRemoteStream()` | 获取远程媒体流 |
| `toggleMute()` | 切换静音状态，返回新的静音状态 |
| `toggleVideo()` | 切换视频开关，返回新的视频状态 |
| `hangUp()` | 挂断通话 |
| `onStateChange(listener)` | 注册状态变化监听器 |
| `offStateChange(listener)` | 移除状态变化监听器 |

## IncomingCallEvent 接口

来电事件对象。

| 属性/方法 | 说明 |
|-----------|------|
| `from` | 呼叫者的 Peer ID |
| `hasVideo` | 是否包含视频 |
| `metadata` | 呼叫者传递的元数据 |
| `answer()` | 接听来电，返回 `Promise<CallSession>` |
| `reject()` | 拒绝来电 |

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
- **语音/视频通话**：同一时间只能有一个活跃通话，通话超时 30 秒无应答自动挂断

## 发布

- NPM: https://www.npmjs.com/package/sx-peerjs-http-util
- CDN: https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js
