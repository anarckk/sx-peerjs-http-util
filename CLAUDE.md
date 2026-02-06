@.claude/产品说明.md

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
├── dist/ - 编译输出目录
└── package.json - 项目配置
```

## API 设计

### 客户端使用方式（自动拆箱）
```js
import { PeerJsWrapper } from 'sx-peerjs-http-util';

const wrapper = new PeerJsWrapper();
const data = await wrapper.send(peerId, '/api/hello', { name: 'world' });
// data 直接是响应数据，已自动拆箱（不需要 .data）
console.log(data); // { message: 'hello', ... }
```

### 服务端使用方式（自动装箱）
```js
import { PeerJsWrapper } from 'sx-peerjs-http-util';

const wrapper = new PeerJsWrapper();

// 注册简化处理器（直接返回数据，自动装箱为 { status: 200, data }）
wrapper.registerHandler('/api/hello', (data) => {
  return { message: 'hello' }; // 直接返回数据
});

// 注销处理器
wrapper.unregisterHandler('/api/hello');

// 或者使用完整路由处理器（返回完整 Response）
wrapper.setRouter({
  '/api/hello': async (request) => {
    return { status: 200, data: { message: 'Hello' } };
  },
});
```

### 特性
- **自动拆箱**：`send` 返回 Promise<unknown>，直接返回 data 部分
- **自动装箱**：`registerHandler` 的处理器可以直接返回数据，自动包装为 Response
- **动态注册/注销**：支持 `registerHandler` 和 `unregisterHandler` 方法
