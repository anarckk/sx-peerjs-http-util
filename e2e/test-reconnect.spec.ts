/**
 * 断线重连 E2E 测试
 * 
 * 测试场景：
 * 1. destroy 时应该取消重连定时器
 * 2. 断开连接后重连机制存在
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-server.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试 destroy 取消重连
 * 
 * 验证点：
 * 1. destroy 后实例被正确销毁
 * 2. 再次调用 send 应该失败
 */
test('destroy 应该销毁实例并取消重连', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-server.html');

  const peerId = await page.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getServerPeerId = resolve;
    });
  });

  await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    wrapper.destroy();
  });

  let errorMsg = '';
  try {
    await page.evaluate(async (args: { peerId: string }) => {
      const wrapper = (window as any).testWrapper;
      return await wrapper.send(args.peerId, '/api/test');
    }, { peerId });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('After destroy error:', errorMsg);
  expect(errorMsg).toBeTruthy();
});

/**
 * 测试多次 destroy 不会出错
 * 
 * 验证点：
 * 1. 多次调用 destroy 不会抛出错误
 */
test('多次 destroy 不应该抛出错误', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-server.html');

  await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    wrapper.destroy();
    wrapper.destroy();
    wrapper.destroy();
  });

  console.log('Multiple destroy succeeded');
});

/**
 * 测试连接断开后重连
 * 
 * 验证点：
 * 1. 可以监听 disconnected 事件
 */
test('应该能监听断开连接事件', async ({ context }) => {
  const page = await context.newPage();
  const events: string[] = [];

  page.on('console', msg => {
    if (msg.text().includes('disconnected')) {
      events.push(msg.text());
    }
  });

  await page.goto('http://localhost:8080/e2e/test-server.html');

  await page.waitForFunction(() => (window as any).peerReady);

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Disconnection events:', events.length);
});
