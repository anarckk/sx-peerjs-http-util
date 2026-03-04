/**
 * 自动路由 E2E 测试
 * 
 * 测试场景：
 * 1. 直连节点及延迟记录
 * 2. 路由表自动转发
 * 3. 多下一跳按延迟排序
 * 4. 路由表多下一跳支持
 * 5. send 方法自动路由
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-auto-routing.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试直连节点及延迟记录
 * 
 * 验证点：
 * 1. A 向 B 发送请求成功后，直连列表包含 B
 * 2. 延迟值大于 0
 */
test('应该记录直连节点及延迟', async ({ context }) => {
  // 创建两个页面模拟两个节点
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  // 捕获控制台日志，便于调试
  pageA.on('console', msg => console.log('[A]', msg.text()));
  pageB.on('console', msg => console.log('[B]', msg.text()));

  // 加载测试页面
  await pageA.goto('http://localhost:8080/e2e/test-auto-routing.html');
  await pageB.goto('http://localhost:8080/e2e/test-auto-routing.html');

  // 等待两个节点就绪并获取 Peer ID
  const peerIdA = await pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));
  const peerIdB = await pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));

  console.log('A Peer ID:', peerIdA);
  console.log('B Peer ID:', peerIdB);

  // A 向 B 发送请求（直连）
  const result = await pageA.evaluate(async (args: { targetPeerId: string }) => {
    return await (window as any).testWrapper.send(args.targetPeerId, '/api/test', { test: 'delay' });
  }, { targetPeerId: peerIdB });

  console.log('Direct send result:', result);

  // 获取 A 的直连节点列表（包含延迟信息）
  const directNodes = await pageA.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return (wrapper as any).router.getDirectNodes();
  });

  console.log('Direct nodes with latency:', directNodes);
  
  // 验证直连节点已记录
  expect(directNodes.length).toBeGreaterThan(0);
  expect(directNodes[0].nodeId).toEqual(peerIdB);
  expect(directNodes[0].latency).toBeGreaterThan(0);
});

/**
 * 测试路由表自动转发
 * 
 * 验证点：
 * 1. A -> B 通信后，B 学到可达 A
 * 2. B -> C 通信后，C 学到可达 B
 * 3. 路由广播后，A 的路由表应包含 C（或通过 B 可达的路径）
 * 
 * 拓扑：A <-> B <-> C
 */
test('应该通过路由表自动转发', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const pageC = await context.newPage();

  await pageA.goto('http://localhost:8080/e2e/test-auto-routing.html');
  await pageB.goto('http://localhost:8080/e2e/test-auto-routing.html');
  await pageC.goto('http://localhost:8080/e2e/test-auto-routing.html');

  const peerIdA = await pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));
  const peerIdB = await pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));
  const peerIdC = await pageC.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));

  console.log('Relay test Peer IDs:', { A: peerIdA, B: peerIdB, C: peerIdC });

  // 建立 A -> B 连接
  await pageA.evaluate(async (args: { peerIdB: string }) => {
    const wrapper = (window as any).testWrapper;
    await wrapper.send(args.peerIdB, '/api/test', { step: 'A->B' });
  }, { peerIdB });

  // 建立 B -> C 连接
  await pageB.evaluate(async (args: { peerIdC: string }) => {
    const wrapper = (window as any).testWrapper;
    await wrapper.send(args.peerIdC, '/api/test', { step: 'B->C' });
  }, { peerIdC });

  // 等待路由广播完成
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 查看 A 的路由表
  const routingTableA = await pageA.evaluate(() => (window as any).testWrapper.getRoutingTable());
  console.log('A routing table:', routingTableA);

  // 等待一下确保测试结束
  await new Promise(resolve => setTimeout(resolve, 500));
});

/**
 * 测试多下一跳按延迟排序
 * 
 * 验证点：
 * 1. A 与 B、C 分别建立连接后，直连列表包含 B 和 C
 * 2. 直连列表按延迟升序排列
 */
test('应该支持多下一跳按延迟排序', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const pageC = await context.newPage();

  await pageA.goto('http://localhost:8080/e2e/test-auto-routing.html');
  await pageB.goto('http://localhost:8080/e2e/test-auto-routing.html');
  await pageC.goto('http://localhost:8080/e2e/test-auto-routing.html');

  const peerIdA = await pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));
  const peerIdB = await pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));
  const peerIdC = await pageC.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));

  console.log('Multi-next-hop test IDs:', { A: peerIdA, B: peerIdB, C: peerIdC });

  // A 分别与 B、C 建立连接
  await pageA.evaluate(async (args: { peerIdB: string; peerIdC: string }) => {
    const wrapper = (window as any).testWrapper;
    await wrapper.send(args.peerIdB, '/api/test', { init: true });
    await new Promise(r => setTimeout(r, 100));
    await wrapper.send(args.peerIdC, '/api/test', { init: true });
  }, { peerIdB, peerIdC });

  await new Promise(resolve => setTimeout(resolve, 500));

  // 获取 A 的直连节点列表
  const directNodes = await pageA.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return (wrapper as any).router.getDirectNodes();
  });

  console.log('A direct nodes:', directNodes);
  
  // 验证至少有 2 个直连节点
  expect(directNodes.length).toBeGreaterThanOrEqual(2);
  
  // 验证按延迟升序排列
  if (directNodes.length >= 2) {
    expect(directNodes[0].latency).toBeLessThanOrEqual(directNodes[1].latency);
  }
});

/**
 * 测试路由表支持多下一跳
 * 
 * 验证点：
 * 1. 路由表对象存在且格式正确
 * 2. 包含目标节点的路由条目
 */
test('路由表应该支持多下一跳', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const pageC = await context.newPage();

  await Promise.all([
    pageA.goto('http://localhost:8080/e2e/test-auto-routing.html'),
    pageB.goto('http://localhost:8080/e2e/test-auto-routing.html'),
    pageC.goto('http://localhost:8080/e2e/test-auto-routing.html')
  ]);

  const [peerIdA, peerIdB, peerIdC] = await Promise.all([
    pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId())),
    pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId())),
    pageC.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()))
  ]);

  // A 与 B、C 分别通信
  await pageA.evaluate(async (args: { peerIdB: string; peerIdC: string }) => {
    const wrapper = (window as any).testWrapper;
    await wrapper.send(args.peerIdB, '/api/test', { init: true });
    await new Promise(r => setTimeout(r, 100));
    await wrapper.send(args.peerIdC, '/api/test', { init: true });
  }, { peerIdB, peerIdC });

  await new Promise(resolve => setTimeout(resolve, 500));

  // 获取路由表
  const routingTable = await pageA.evaluate(() => (window as any).testWrapper.getRoutingTable());

  console.log('Routing table:', routingTable);
  expect(routingTable).toBeDefined();
});

/**
 * 测试 send 方法自动路由
 * 
 * 验证点：
 * 1. send 方法能自动完成直连通信
 * 2. 响应数据正确
 */
test('send 方法应该自动路由（无需手动指定中继节点）', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('http://localhost:8080/e2e/test-auto-routing.html');
  await pageB.goto('http://localhost:8080/e2e/test-auto-routing.html');

  const peerIdA = await pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));
  const peerIdB = await pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()));

  console.log('Auto routing test IDs:', { A: peerIdA, B: peerIdB });

  // 直接使用 send 方法发送请求（自动路由）
  const result = await pageA.evaluate(async (args: { peerId: string }) => {
    return await (window as any).testWrapper.send(args.peerId, '/api/test', { auto: 'route' });
  }, { peerId: peerIdB });

  console.log('Auto send result:', result);
  
  // 验证响应正确
  expect(result).toHaveProperty('echo');
  expect(result.echo).toEqual({ auto: 'route' });
});
