/**
 * 响应状态码处理 E2E 测试
 * 
 * 测试场景：
 * 1. 200 状态码正常返回
 * 2. 404 路径未找到
 * 3. 500 服务器内部错误
 * 4. 其他错误状态码处理
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-server.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试 200 状态码正常返回
 * 
 * 验证点：
 * 1. 正常响应 status 为 200
 */
test('200 状态码应该正常返回数据', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await page1.goto('http://localhost:8080/e2e/test-server.html');
  await page2.goto('http://localhost:8080/e2e/test-client.html');

  const serverPeerId = await page1.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getServerPeerId = resolve;
    });
  });

  const data = await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
  }, { peerId: serverPeerId, path: '/api/hello', data: { test: true } });

  console.log('200 response:', data);
  expect(data).toHaveProperty('message', 'Hello from server');
});

/**
 * 测试处理器返回错误响应对象
 * 
 * 验证点：
 * 1. 处理器返回 { status, data } 对象时应该抛出错误
 */
test('处理器返回错误响应对象应该抛出错误', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await page1.goto('http://localhost:8080/e2e/test-server.html');
  await page2.goto('http://localhost:8080/e2e/test-client.html');

  const serverPeerId = await page1.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getServerPeerId = resolve;
    });
  });

  await page1.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    wrapper.registerHandler('/api/custom-error', (from, data) => {
      return { status: 403, data: { message: 'Custom forbidden' } };
    });
  });

  let errorMsg = '';
  try {
    await page2.evaluate(async (args: { peerId: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, '/api/custom-error');
    }, { peerId: serverPeerId });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('Custom error message:', errorMsg);
  expect(errorMsg).toContain('403');
});

/**
 * 测试 send 方法超时
 * 
 * 验证点：
 * 1. 发送请求超时时应该抛出超时错误
 */
/**
 * 测试连接到不存在的节点
 * 
 * 验证点：
 * 1. 连接到不存在的节点应该报错
 */
test('连接到不存在的节点应该报错', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-server.html');

  await page.evaluate(() => (window as any).testWrapper.whenReady());

  let errorMsg = '';
  try {
    await page.evaluate(async () => {
      return await (window as any).testWrapper.send('non-existent-peer-id', '/api/test');
    });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('Non-existent peer error:', errorMsg);
  expect(errorMsg).toBeTruthy();
});
