# API 文档

## PeerJsWrapper 类

主类，提供 P2P 通信能力。

### 构造函数

```typescript
new PeerJsWrapper(peerId?: string, isDebug?: boolean, server?: ServerConfig, relayConfig?: RelayConfig)
```

**参数：**
- `peerId` (可选): 指定 Peer ID，不提供则自动生成 UUID
- `isDebug` (可选): 是否开启调试模式，默认 `false`
- `server` (可选): 自定义信令服务器配置
- `relayConfig` (可选): 中继配置

**ServerConfig 接口：**
```typescript
interface ServerConfig {
  host?: string;      // 服务器地址
  port?: number;      // 端口号
  path?: string;     // 路径（如 `/peerjs`）
  secure?: boolean;  // 是否使用 HTTPS/WSS
}
```

**RelayConfig 接口：**
```typescript
interface RelayConfig {
  maxRelayNodes?: number;  // 最大中继节点数量，默认 5
}
```

---

## 方法

### getPeerId()

```typescript
getPeerId(): string
```

获取当前 Peer ID（同步方法，立即返回）。

---

### whenReady()

```typescript
whenReady(): Promise<void>
```

等待 Peer 连接到信令服务器。返回 Promise，连接成功时 resolve。

---

### send()

```typescript
send(peerId: string, path: string, data?: unknown): Promise<unknown>
```

发送请求到指定 Peer。

**发送流程：**
1. 查路由表 → 有路由 → 尝试中继 → 全部失败 → 降级直连 → 失败 → 结束
2. 路由表无目标 → 直连 → 失败 → 结束

**参数：**
- `peerId`: 目标节点 ID
- `path`: 请求路径
- `data`: 请求数据 (可选)

**返回：** 响应数据（自动拆箱，只返回 data 部分）

**抛出：**
- 连接失败超时
- HTTP 错误（如 404 路径未找到）

---

### registerHandler()

```typescript
registerHandler(path: string, handler: SimpleHandler): void
```

注册路径处理器。

**参数：**
- `path`: 请求路径
- `handler`: 处理器函数

**SimpleHandler 类型：**
```typescript
type SimpleHandler = (from: string, data?: unknown) => Promise<unknown> | unknown
```

**示例：**
```typescript
wrapper.registerHandler('/api/hello', (from, data) => {
  return { message: 'hello', received: data };
});
```

---

### unregisterHandler()

```typescript
unregisterHandler(path: string): void
```

注销路径处理器。

**参数：**
- `path`: 请求路径

---

### call()

```typescript
call(peerId: string, options?: CallOptions): Promise<CallSession>
```

发起语音/视频通话。

**参数：**
- `peerId`: 对端设备 ID
- `options` (可选): 通话选项

**CallOptions 接口：**
```typescript
interface CallOptions {
  video?: boolean;      // 是否启用视频，默认 false
  metadata?: unknown;   // 自定义元数据
}
```

**返回：** `CallSession` 通话会话对象

---

### onIncomingCall()

```typescript
onIncomingCall(listener: IncomingCallListener): void
```

注册来电监听器。

**参数：**
- `listener`: 监听器函数

**IncomingCallListener 类型：**
```typescript
type IncomingCallListener = (event: IncomingCallEvent) => void
```

---

### offIncomingCall()

```typescript
offIncomingCall(listener: IncomingCallListener): void
```

移除来电监听器。

---

### getActiveCall()

```typescript
getActiveCall(): CallSession | null
```

获取当前活跃的通话会话。

**返回：** `CallSession` 或 `null`

---

### getRoutingTable()

```typescript
getRoutingTable(): Record<string, RouteEntry>
```

获取路由表。

**返回格式：**
```typescript
interface RouteEntry {
  target: string;           // 目标节点
  nextHops: NextHop[];     // 下一跳列表（按延迟升序）
  hops: number;            // 跳数
  timestamp: number;       // 更新时间戳
}

interface NextHop {
  nodeId: string;   // 下一跳节点 ID
  latency: number;  // 到目标的延迟（毫秒）
}
```

---

### getKnownNodes()

```typescript
getKnownNodes(): string[]
```

获取已知直连节点列表。

**返回：** 节点 ID 数组

---

### destroy()

```typescript
destroy(): void

关闭所有连接并销毁实例。会自动：
- 挂断活跃通话
- 关闭所有数据连接
- 清理待处理请求
- 保存路由表到 IndexedDB
- 停止路由维护定时器

---

## CallSession 接口

通话会话对象，用于控制通话。

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `peerId` | `string` | 对端的 Peer ID |
| `hasVideo` | `boolean` | 是否包含视频 |
| `isConnected` | `boolean` | 是否已连接 |

### 方法

#### getLocalStream()

```typescript
getLocalStream(): MediaStream | null
```

获取本地媒体流。

#### getRemoteStream()

```typescript
getRemoteStream(): MediaStream | null
```

获取远程媒体流。需要在 `connected` 状态后调用。

#### toggleMute()

```typescript
toggleMute(): boolean
```

切换静音状态。返回新的静音状态（true = 已静音）。

#### toggleVideo()

```typescript
toggleVideo(): boolean
```

切换视频开关（仅视频通话有效）。返回新的视频状态（true = 视频开启）。

#### hangUp()

```typescript
hangUp(): void
```

挂断通话。

#### onStateChange()

```typescript
onStateChange(listener: CallStateListener): void
```

注册状态变化监听器。

**CallStateListener 类型：**
```typescript
type CallStateListener = (state: CallState, reason?: string) => void
```

**CallState 类型：**
```typescript
type CallState = 'connecting' | 'connected' | 'ended'
```

#### offStateChange()

```typescript
offStateChange(listener: CallStateListener): void
```

移除状态变化监听器。

---

## IncomingCallEvent 接口

来电事件对象。

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `from` | `string` | 呼叫者的 Peer ID |
| `hasVideo` | `boolean` | 是否包含视频 |
| `metadata` | `unknown` | 呼叫者传递的元数据 |

### 方法

#### answer()

```typescript
answer(): Promise<CallSession>
```

接听来电。返回 Promise，成功时返回 `CallSession`。

#### reject()

```typescript
reject(): void
```

拒绝来电。

---

## 自动路由机制

### 工作流程

1. **直连尝试**
   - `send()` 首先尝试直接连接到目标节点
   - 成功时记录节点及延迟到直连列表

2. **路由表转发**
   - 直连失败时，检查路由表
   - 按延迟排序选择最优下一跳
   - 一个下一跳失败则尝试下一个

3. **路由发现**（仅当路由表非空但无直达路由时）
   - 向所有直连节点广播查询
   - 能响应询问的节点返回其到目标的延迟
   - 将发现的路由加入路由表后转发
   - 路由表为空时直接报错，不执行路由发现

### 路由表更新

- 每次成功通信后记录直连节点及延迟
- 成功后广播路由更新，告知邻居自己可达的节点
- 收到邻居的路由更新后，合并到本地路由表
- 路由表按延迟排序选择最优路径
- 每 30 秒自动广播路由更新到邻居节点
- 每 60 秒清理超过 5 分钟未更新的过期路由
- 通信失败时自动移除失效的路由

### 路由表持久化

路由表和直连节点列表存储在 IndexedDB 中，刷新页面后自动恢复。

### 容量限制

- 直连节点：最多 5 个（按延迟保留最优）
- 路由表条目：最多 50 个目标

### 多跳支持

路由表支持多跳路径：
- 路由条目记录到目标的下一跳
- 下一跳可能是直连节点或中继节点
- 消息逐跳转发，直到到达目标

---

## 错误处理

### 请求失败

- **404**: 路径未找到
- **500**: 服务器内部错误
- **timeout**: 连接超时（30秒）
- **no route found**: 无法到达目标（直连失败且路由表为空或无可用路由）

### 示例

```typescript
try {
  const data = await wrapper.send('peer-id', '/api/test', { key: 'value' });
  console.log('Success:', data);
} catch (err) {
  if (err.message.includes('404')) {
    console.log('路径未找到');
  } else if (err.message.includes('timeout')) {
    console.log('连接超时');
  } else {
    console.log('其他错误:', err.message);
  }
}
```

---

## 类型导出

库导出的所有类型：

```typescript
export type {
  Request,
  Response,
  SimpleHandler,
  CallOptions,
  CallSession,
  CallState,
  CallStateListener,
  IncomingCallEvent,
  IncomingCallListener,
  RouteEntry,
  NextHop,
  DirectNodeLatency,
  RelayConfig,
  RelayMessage,
  ServerConfig
};
```
