/**
 * E2E 测试 - 使用 Playwright 在浏览器环境中测试
 *
 * 此测试需要两个浏览器窗口：
 * 1. 服务器端 - 接收请求并返回响应
 * 2. 客户端 - 发送请求并验证响应
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';

describe('PeerJS HTTP Util E2E Tests', () => {
  let browser: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page; // 服务器端页面
  let page2: Page; // 客户端页面

  beforeAll(async () => {
    browser = await chromium.launch();
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    page1 = await context1.newPage();
    page2 = await context2.newPage();
  });

  afterAll(async () => {
    await context1.close();
    await context2.close();
    await browser.close();
  });

  test('should send request and receive response', async () => {
    // 加载测试页面
    await page1.goto('file://' + __dirname + '/test-server.html');
    await page2.goto('file://' + __dirname + '/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    // 设置客户端目标 Peer ID 并发送请求
    const response = await page2.evaluate(async (peerId: string) => {
      const { request } = (window as any).sxPeerHttpUtil;
      return await request({
        peerId,
        request: {
          method: 'GET',
          data: { message: 'Hello from client' },
        },
      });
    }, serverPeerId);

    // 验证响应
    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      message: 'Hello from server',
      received: { message: 'Hello from client' },
    });
  });

  test('should handle error response', async () => {
    // 加载测试页面
    await page1.goto('file://' + __dirname + '/test-server-error.html');
    await page2.goto('file://' + __dirname + '/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    // 发送会触发错误的请求
    const response = await page2.evaluate(async (peerId: string) => {
      const { request } = (window as any).sxPeerHttpUtil;
      try {
        return await request({
          peerId,
          request: {
            method: 'ERROR',
            data: {},
          },
        });
      } catch (error) {
        return { status: 0, data: { error: (error as Error).message } };
      }
    }, serverPeerId);

    // 验证错误处理
    expect(response.status).toBe(500);
    expect(response.data).toHaveProperty('error');
  });

  test('should handle multiple concurrent requests', async () => {
    // 加载测试页面
    await page1.goto('file://' + __dirname + '/test-server.html');
    await page2.goto('file://' + __dirname + '/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    // 发送多个并发请求
    const responses = await page2.evaluate(async (peerId: string) => {
      const { request } = (window as any).sxPeerHttpUtil;
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          request({
            peerId,
            request: {
              method: 'GET',
              data: { index: i },
            },
          })
        );
      }

      return await Promise.all(promises);
    }, serverPeerId);

    // 验证所有响应
    expect(responses).toHaveLength(5);
    responses.forEach((res: any, i: number) => {
      expect(res.status).toBe(200);
      expect(res.data.received.index).toBe(i);
    });
  });
});
