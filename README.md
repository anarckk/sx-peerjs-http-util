# sx-peerjs-http-util

一个浏览器端库，将 PeerJS 封装成简单易用的类似 HTTP 的 API。

## 特性

- 简单的请求-响应 API，类似 HTTP
- 基于 PeerJS (WebRTC) 实现 P2P 通信
- TypeScript 支持
- 完整的 E2E 测试

## 安装

```bash
npm install sx-peerjs-http-util peerjs
```

## API

### Request

```typescript
interface Request {
  method?: string;
  data?: unknown;
}
```

### Response

```typescript
interface Response {
  status: number;
  data: unknown;
}
```

### request(options: RequestOptions): Promise<Response>

发送请求到指定 Peer。

```typescript
import { request } from 'sx-peerjs-http-util';

const response = await request({
  peerId: 'remote-peer-id',
  request: {
    method: 'GET',
    data: { message: 'Hello' },
  },
});

console.log(response.status); // 200
console.log(response.data); // { message: 'Response from server' }
```

### createServer(peer: Peer, handler: RequestHandler): () => void

创建一个 PeerJS HTTP 服务器。

```typescript
import { createServer } from 'sx-peerjs-http-util';
import { Peer } from 'peerjs';

const peer = new Peer();

const handler = async (request) => {
  return {
    status: 200,
    data: {
      message: 'Hello from server',
      received: request.data,
    },
  };
};

const cleanup = createServer(peer, handler);

// 清理时调用
cleanup();
```

## 完整示例

### 服务器端

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>
  <script type="module">
    import { createServer } from './dist/index.js';

    const peer = new Peer();

    peer.on('open', (id) => {
      console.log('My Peer ID:', id);
    });

    const handler = async (request) => {
      // 处理请求
      if (request.method === 'ECHO') {
        return {
          status: 200,
          data: request.data,
        };
      }

      return {
        status: 200,
        data: { message: 'OK' },
      };
    };

    createServer(peer, handler);
  </script>
</head>
<body>
  <h1>Server</h1>
  <div id="peer-id"></div>
</body>
</html>
```

### 客户端

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>
  <script type="module">
    import { request } from './dist/index.js';

    async function sendRequest() {
      const response = await request({
        peerId: 'server-peer-id',
        request: {
          method: 'ECHO',
          data: { test: 'data' },
        },
      });

      console.log('Response:', response);
    }

    // 调用
    sendRequest();
  </script>
</head>
<body>
  <h1>Client</h1>
  <button onclick="sendRequest()">Send Request</button>
</body>
</html>
```

## E2E 测试

运行端到端测试：

```bash
npm run test:e2e
```

## 注意事项

- 每次请求都会创建新的 Peer 连接，请求完成后会自动清理
- 请求超时时间为 30 秒
- 此库仅用于浏览器环境
- 需要使用 PeerJS 信令服务器（默认使用公共服务器）
