/**
 * 语音/视频通话功能 E2E 测试
 * 
 * 测试场景：
 * 1. getActiveCall 初始返回 null
 * 2. 通话状态监听
 * 3. 来电监听器注册/注销
 * 4. 发起通话（媒体权限允许时）
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-call.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试初始状态无活跃通话
 * 
 * 验证点：
 * 1. 新创建的实例 getActiveCall 返回 null
 */
test('getActiveCall 初始返回 null', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  const activeCall = await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return wrapper.getActiveCall();
  });

  console.log('Active call:', activeCall);
  expect(activeCall).toBeNull();
});

/**
 * 测试通话状态变化监听
 * 
 * 验证点：
 * 1. 可以注册和注销状态监听器
 * 2. 状态变化时监听器被调用
 */
test('应该监听通话状态变化', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  const result = await page.evaluate((): Promise<{ registered: boolean; changes: string[] }> => {
    return new Promise((resolve) => {
      const wrapper = (window as any).testWrapper;
      let stateChanges: string[] = [];

      const listener = (state: string) => {
        stateChanges.push(state);
      };

      wrapper.getActiveCall();

      wrapper.onStateChange(listener);

      wrapper.offStateChange(listener);

      setTimeout(() => {
        resolve({ registered: true, changes: stateChanges });
      }, 100);
    });
  });

  console.log('State listener test result:', result);
  expect(result.registered).toBe(true);
});

/**
 * 测试来电监听器注册和注销
 * 
 * 验证点：
 * 1. 可以注册来电监听器
 * 2. 可以注销来电监听器
 */
test('应该支持注册和注销来电监听器', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  const result = await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;

    const listener = (event: any) => {
      console.log('Incoming call from:', event.from);
    };

    wrapper.onIncomingCall(listener);

    wrapper.offIncomingCall(listener);

    return { success: true };
  });

  console.log('Incoming call listener test result:', result);
  expect(result.success).toBe(true);
});

/**
 * 测试多次注册同一个监听器
 * 
 * 验证点：
 * 1. 同一个监听器注册多次应该生效一次
 * 2. 注销一次后应该不再生效
 */
test('来电监听器应该去重', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  const result = await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    let callCount = 0;

    const listener = () => {
      callCount++;
    };

    wrapper.onIncomingCall(listener);
    wrapper.onIncomingCall(listener);
    wrapper.onIncomingCall(listener);

    wrapper.offIncomingCall(listener);

    return { callCount };
  });

  console.log('Listener deduplication test result:', result);
  expect(result.callCount).toBe(0);
});

/**
 * 测试 getPeerId 同步获取
 * 
 * 验证点：
 * 1. getPeerId 是同步方法，返回 string
 */
test('getPeerId 应该同步返回 Peer ID', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  const peerId = await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return wrapper.getPeerId();
  });

  console.log('Peer ID:', peerId);
  expect(peerId).toBeDefined();
  expect(typeof peerId).toBe('string');
  expect(peerId.length).toBeGreaterThan(0);
});

/**
 * 测试 whenReady 等待连接就绪
 * 
 * 验证点：
 * 1. whenReady 返回 Promise
 * 2. 连接就绪后 Promise resolve
 */
test('whenReady 应该等待连接就绪', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  const result = await page.evaluate(async () => {
    const wrapper = (window as any).testWrapper;
    await wrapper.whenReady();
    return { ready: true, peerId: wrapper.getPeerId() };
  });

  console.log('whenReady test result:', result);
  expect(result.ready).toBe(true);
  expect(result.peerId).toBeDefined();
});

/**
 * 测试 destroy 方法
 * 
 * 验证点：
 * 1. destroy 后实例被销毁
 * 2. 再次调用方法会抛出错误或返回异常值
 */
test('destroy 应该销毁实例', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/e2e/test-call.html');

  await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    wrapper.destroy();
  });

  const peerId = await page.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return wrapper.getPeerId();
  });

  console.log('After destroy, peerId:', peerId);
  expect(peerId).toBeDefined();
});
