# sx-peerjs-http-util

将 PeerJS 封装成类似 HTTP 的 API，支持语音/视频通话和自动路由。

## 在线 Demo

| Demo | 说明 |
|------|------|
| [文字传输](https://anarckk.github.io/sx-peerjs-http-util/demos/text-chat/index.html) | P2P 即时聊天 |
| [文件传输](https://anarckk.github.io/sx-peerjs-http-util/demos/file-transfer/index.html) | 点对点文件传输 |
| [语音通话](https://anarckk.github.io/sx-peerjs-http-util/demos/voice-call/index.html) | 一对一语音通话 |
| [视频通话](https://anarckk.github.io/sx-peerjs-http-util/demos/video-call/index.html) | 一对一视频通话 |

## 安装

**NPM:**
```bash
npm install sx-peerjs-http-util peerjs
```

**CDN:**
```html
<script src="https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js"></script>
```

## 快速开始

```typescript
import { PeerJsWrapper } from 'sx-peerjs-http-util';

const wrapper = new PeerJsWrapper();
await wrapper.whenReady();

// 注册处理器
wrapper.registerHandler('/api/hello', (from, data) => {
  return { message: 'hello', received: data };
});

// 发送请求（自动路由）
const data = await wrapper.send('remote-peer-id', '/api/hello', { name: 'world' });
```

## 语音/视频通话

```typescript
// 发起通话
const call = await wrapper.call('remote-peer-id', { video: true });

// 监听来电
wrapper.onIncomingCall(async (event) => {
  const session = await event.answer();  // 接听
  // 或 event.reject();  // 拒绝
});
```

## API 文档

完整 API 文档见 [docs/api.md](docs/api.md)

## 注意

- 仅限浏览器环境
- 请求超时 30 秒
- 每次请求创建新连接
