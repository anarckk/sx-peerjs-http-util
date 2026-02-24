/**
 * PeerJsWrapper 基础功能 E2E 测试
 * 
 * 测试场景：
 * 1. 请求响应（自动拆箱）
 * 2. 404 错误处理
 * 3. 500 错误处理
 * 4. 数据回显
 * 5. 并发请求
 * 6. 无数据请求
 * 7. 动态注册/注销处理器
 * 8. from 参数传递
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-server.html, e2e/test-client.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试请求响应（自动拆箱）
 * 
 * 验证点：
 * 1. 客户端发送请求后能收到服务端响应
 * 2. 响应数据自动拆箱，直接是 data 部分而非 { status, data }
 */
test('应该发送请求并接收响应（自动拆箱）', async ({ context }) => {
  // page1 作为服务端，page2 作为客户端
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  // 捕获控制台日志
  page1.on('console', msg => console.log('[SERVER]', msg.text()));
  page1.on('pageerror', err => console.log('[SERVER ERROR]', err.message));
  page2.on('console', msg => console.log('[CLIENT]', msg.text()));
  page2.on('pageerror', err => console.log('[CLIENT ERROR]', err.message));

  // 加载测试页面
  await page1.goto('http://localhost:8080/e2e/test-server.html');
  await page2.goto('http://localhost:8080/e2e/test-client.html');

  // 获取服务端 Peer ID
  const serverPeerId = await page1.evaluate(() => {
    return new Promise<string>((resolve) => {
      // 已经 ready 则直接获取
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      // 否则等待回调
      (window as any).getServerPeerId = resolve;
    });
  });

  console.log('Server Peer ID:', serverPeerId);

  // 客户端发送请求
  const data = await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
  }, { peerId: serverPeerId, path: '/api/hello', data: { message: 'Hello from client' } });

  console.log('Response data (auto-unboxed):', data);

  // 验证响应数据已自动拆箱
  expect(data).toHaveProperty('message', 'Hello from server');
  expect(data).toHaveProperty('received');
  expect(data.received).toEqual({ message: 'Hello from client' });
});

/**
 * 测试 404 错误处理
 * 
 * 验证点：
 * 1. 发送到不存在的路径时抛出 404 错误
 * 2. 错误信息包含 "404" 和 "Path not found"
 */
test('应该处理404路径未找到错误', async ({ context }) => {
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

  console.log('Server Peer ID (404 test):', serverPeerId);

  // 客户端发送到不存在的路径
  let errorMsg = '';
  try {
    await page2.evaluate(async (args: { peerId: string; path: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
    }, { peerId: serverPeerId, path: '/api/notfound' });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('404 Error message:', errorMsg);

  // 验证 404 错误
  expect(errorMsg).toContain('404');
  expect(errorMsg).toContain('Path not found');
});

/**
 * 测试处理器抛出错误
 * 
 * 验证点：
 * 1. 服务端处理器抛出异常时，客户端收到 500 错误
 * 2. 错误信息包含 "500" 和处理器抛出的错误信息
 */
test('应该处理处理器抛出的错误', async ({ context }) => {
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

  console.log('Server Peer ID (error test):', serverPeerId);

  // 客户端发送到会抛出错误的路径
  let errorMsg = '';
  try {
    await page2.evaluate(async (args: { peerId: string; path: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
    }, { peerId: serverPeerId, path: '/api/error' });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('Error message:', errorMsg);

  // 验证 500 错误
  expect(errorMsg).toContain('500');
  expect(errorMsg).toContain('Test error from server');
});

/**
 * 测试数据回显
 * 
 * 验证点：
 * 1. 服务端 /api/echo 路径返回客户端发送的数据
 * 2. 复杂数据结构（嵌套对象）能正确回显
 */
test('应该回显数据', async ({ context }) => {
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

  console.log('Server Peer ID (echo test):', serverPeerId);

  // 测试数据
  const testData = { foo: 'bar', num: 42, nested: { a: 1, b: 2 } };

  // 客户端发送 echo 请求
  const data = await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
  }, { peerId: serverPeerId, path: '/api/echo', data: testData });

  console.log('Echo Response data:', data);

  // 验证响应数据与请求数据相同
  expect(data).toEqual(testData);
});

/**
 * 测试并发请求
 * 
 * 验证点：
 * 1. 同时发送多个请求都能正确收到响应
 * 2. 每个响应对应正确的请求数据
 */
test('应该处理多个并发请求', async ({ context }) => {
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

  console.log('Server Peer ID (concurrent test):', serverPeerId);

  // 发送 3 个并发请求
  const dataList = await page2.evaluate(async (peerId: string) => {
    const send = (window as any).sxPeerHttpUtil.send;
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(send(peerId, '/api/echo', { index: i }));
    }
    return await Promise.all(promises);
  }, serverPeerId);

  console.log('Concurrent Response data:', dataList);

  // 验证所有响应
  expect(dataList).toHaveLength(3);
  for (let i = 0; i < dataList.length; i++) {
    expect(dataList[i]).toHaveProperty('index', i);
  }
});

/**
 * 测试不带数据参数的请求
 * 
 * 验证点：
 * 1. 发送不带 data 的请求能正常工作
 * 2. 服务端能正确处理 data 为 undefined 的情况
 */
test('应该支持不带数据参数的请求', async ({ context }) => {
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

  console.log('Server Peer ID (no data test):', serverPeerId);

  // 客户端发送不带 data 的请求
  const data = await page2.evaluate(async (args: { peerId: string; path: string }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
  }, { peerId: serverPeerId, path: '/api/hello' });

  console.log('No Data Response:', data);

  // 验证响应
  expect(data).toHaveProperty('message', 'Hello from server');
  expect(data).toHaveProperty('received');
});

/**
 * 测试动态注册和注销处理器
 * 
 * 验证点：
 * 1. 可以动态注册新的处理器
 * 2. 新处理器能正确响应请求
 * 3. 注销后请求返回 404
 */
test('应该支持注册和注销处理器', async ({ context }) => {
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

  console.log('Server Peer ID (register/unregister test):', serverPeerId);

  // 在服务端动态注册一个新处理器
  await page1.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    if (wrapper) {
      wrapper.registerHandler('/api/dynamic', (from: string, data: any) => {
        return { dynamic: true, ...data };
      });
    }
  });

  // 客户端发送请求到新注册的路径
  const data1 = await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
  }, { peerId: serverPeerId, path: '/api/dynamic', data: { test: 'value' } });

  console.log('Dynamic handler response:', data1);
  expect(data1).toEqual({ dynamic: true, test: 'value' });

  // 在服务端注销处理器
  await page1.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    if (wrapper) {
      wrapper.unregisterHandler('/api/dynamic');
    }
  });

  // 客户端再次发送请求，应该返回 404
  let errorMsg = '';
  try {
    await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
    }, { peerId: serverPeerId, path: '/api/dynamic', data: { test: 'value' } });
  } catch (err: any) {
    errorMsg = err.message;
  }

  console.log('After unregister error:', errorMsg);
  expect(errorMsg).toContain('404');
  expect(errorMsg).toContain('Path not found');
});

/**
 * 测试 from 参数传递
 * 
 * 验证点：
 * 1. 服务端处理器能正确获取发送者的 Peer ID
 * 2. 通过 /api/whoami 路径返回发送者 ID
 */
test('应该正确传递发送者的 Peer ID (from 参数)', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await page1.goto('http://localhost:8080/e2e/test-server.html');
  await page2.goto('http://localhost:8080/e2e/test-client.html');

  // 获取服务端 Peer ID
  const serverPeerId = await page1.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getServerPeerId = resolve;
    });
  });

  // 获取客户端 Peer ID
  const clientPeerId = await page2.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getClientPeerId = resolve;
    });
  });

  console.log('Server Peer ID:', serverPeerId);
  console.log('Client Peer ID:', clientPeerId);

  // 客户端发送请求到 /api/whoami
  const data = await page2.evaluate(async (args: { peerId: string; path: string }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
  }, { peerId: serverPeerId, path: '/api/whoami' });

  console.log('Whoami response:', data);

  // 验证服务端正确识别了发送者的 Peer ID
  expect(data).toHaveProperty('yourPeerId');
  expect((data as any).yourPeerId).toEqual(clientPeerId);
});
