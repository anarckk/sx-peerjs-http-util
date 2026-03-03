/**
 * 显式中继 E2E 测试
 * 
 * 测试场景：
 * 1. relaySend 不指定中继节点时等同于 send
 * 2. relaySend 指定中继节点时通过中继转发
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-auto-routing.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试 relaySend 不指定中继节点
 * 
 * 验证点：
 * 1. relaySend 不传中继节点时，应该直接发送
 */
test('relaySend 不指定中继节点应该直接发送', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await Promise.all([
    pageA.goto('http://localhost:8080/e2e/test-auto-routing.html'),
    pageB.goto('http://localhost:8080/e2e/test-auto-routing.html')
  ]);

  const [peerIdA, peerIdB] = await Promise.all([
    pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId())),
    pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()))
  ]);

  console.log('Peer IDs:', { A: peerIdA, B: peerIdB });

  const result = await pageA.evaluate(async (args: { peerId: string }) => {
    return await (window as any).testWrapper.relaySend(args.peerId, '/api/test', { direct: true });
  }, { peerId: peerIdB });

  console.log('relaySend result:', result);
  expect(result).toHaveProperty('echo');
  expect(result.echo).toEqual({ direct: true });
});

/**
 * 测试 relaySend 指定无效中继节点
 * 
 * 验证点：
 * 1. 指定不存在的节点时应该报错
 */
test('relaySend 指定无效中继节点应该报错', async ({ context }) => {
  const pageA = await context.newPage();

  await pageA.goto('http://localhost:8080/e2e/test-auto-routing.html');

  await pageA.evaluate(() => (window as any).testWrapper.whenReady());

  let errorMsg = '';
  try {
    await pageA.evaluate(async () => {
      return await (window as any).testWrapper.relaySend(
        'invalid-peer-id',
        '/api/test',
        { test: true },
        ['non-existent-relay']
      );
    });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('Error message:', errorMsg);
  expect(errorMsg).toBeTruthy();
});

/**
 * 测试中继路径返回错误响应
 * 
 * 验证点：
 * 1. 中继路径上的错误应该正确传播
 */
test('中继路径错误应该正确传播', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await Promise.all([
    pageA.goto('http://localhost:8080/e2e/test-auto-routing.html'),
    pageB.goto('http://localhost:8080/e2e/test-auto-routing.html')
  ]);

  const [peerIdA, peerIdB] = await Promise.all([
    pageA.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId())),
    pageB.evaluate(() => (window as any).testWrapper.whenReady().then(() => (window as any).testWrapper.getPeerId()))
  ]);

  let errorMsg = '';
  try {
    await pageA.evaluate(async (args: { peerId: string }) => {
      return await (window as any).testWrapper.relaySend(args.peerId, '/api/notfound', {}, []);
    }, { peerId: peerIdB });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('404 error on relay:', errorMsg);
  expect(errorMsg).toContain('404');
});
