# e2e文档规范

在项目目录 AGENTS.md 中维护一个篇章 `# e2e测试用例`，格式如下：

- [x] {测试项A}
- [ ] {测试项A}

记录所有的e2e测试项，以及其是否通过e2e测试。

---

# e2e测试用例

## 基础功能测试 (test.spec.ts)
- [x] 应该发送请求并接收响应（自动拆箱）
- [x] 应该处理404路径未找到错误
- [x] 应该处理处理器抛出的错误
- [x] 应该回显数据
- [x] 应该处理多个并发请求
- [x] 应该支持不带数据参数的请求
- [x] 应该支持注册和注销处理器
- [x] 应该正确传递发送者的 Peer ID (from 参数)

## 自动路由测试 (test-auto-routing.spec.ts)
- [x] 应该记录直连节点及延迟
- [x] 应该通过路由表自动转发
- [x] 应该支持多下一跳按延迟排序
- [x] 路由表应该支持多下一跳
- [x] send 方法应该自动路由（无需手动指定中继节点）

## 中继功能测试 (test-relay.spec.ts)
- [x] getRoutingTable 返回空路由表
- [x] getKnownNodes 返回空列表

## 通话功能测试 (test-call.spec.ts)
- [x] getActiveCall 初始返回 null
- [x] 应该监听通话状态变化
- [x] 应该支持注册和注销来电监听器
- [x] 来电监听器应该去重
- [x] getPeerId 应该同步返回 Peer ID
- [x] whenReady 应该等待连接就绪
- [x] destroy 应该销毁实例

## 调试模式测试 (test-debug.spec.ts)
- [x] 调试模式应该输出日志
- [x] 非调试模式不应该输出调试日志

## 显式中继测试 (test-explicit-relay.spec.ts)
- [x] relaySend 不指定中继节点应该直接发送
- [x] relaySend 指定无效中继节点应该报错
- [x] 中继路径错误应该正确传播

## 响应状态码测试 (test-status-codes.spec.ts)
- [x] 200 状态码应该正常返回数据
- [x] 处理器返回错误响应对象应该抛出错误
- [x] 连接到不存在的节点应该报错

## 断线重连测试 (test-reconnect.spec.ts)
- [x] destroy 应该销毁实例并取消重连
- [x] 多次 destroy 不应该抛出错误
- [x] 应该能监听断开连接事件

**运行方式**：
1. 启动私有信令服务器：`cd peerjs-server && node server.js`
2. 启动 HTTP 服务器：`npx serve -l 8080`
3. 运行测试：`npm run test:e2e`
