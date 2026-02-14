import { test, expect } from '@playwright/test';

test.describe('PeerJsWrapper E2E Tests', () => {
  test('应该发送请求并接收响应（自动拆箱）', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 捕获控制台日志
    page1.on('console', msg => console.log('[SERVER]', msg.text()));
    page1.on('pageerror', err => console.log('[SERVER ERROR]', err.message));
    page2.on('console', msg => console.log('[CLIENT]', msg.text()));
    page2.on('pageerror', err => console.log('[CLIENT ERROR]', err.message));

    // 加载测试页面（通过 HTTP 服务器）
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
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

    // 验证响应数据已自动拆箱（直接是 data，而不是 { status, data }）
    expect(data).toHaveProperty('message', 'Hello from server');
    expect(data).toHaveProperty('received');
    expect(data.received).toEqual({ message: 'Hello from client' });
  });

  test('应该处理404路径未找到错误', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        // 否则等待回调
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (404 test):', serverPeerId);

    // 客户端发送到不存在的路径（应该抛出异常）
    let errorMsg = '';
    try {
      await page2.evaluate(async (args: { peerId: string; path: string }) => {
        return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
      }, { peerId: serverPeerId, path: '/api/notfound' });
    } catch (err: any) {
      errorMsg = err.message;
    }

    console.log('404 Error message:', errorMsg);

    // 验证 404 错误被正确抛出
    expect(errorMsg).toContain('404');
    expect(errorMsg).toContain('Path not found');
  });

  test('应该处理处理器抛出的错误', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        // 否则等待回调
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (error test):', serverPeerId);

    // 客户端发送到会抛出错误的路径（应该抛出异常）
    let errorMsg = '';
    try {
      await page2.evaluate(async (args: { peerId: string; path: string }) => {
        return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
      }, { peerId: serverPeerId, path: '/api/error' });
    } catch (err: any) {
      errorMsg = err.message;
    }

    console.log('Error message:', errorMsg);

    // 验证错误被正确抛出
    expect(errorMsg).toContain('500');
    expect(errorMsg).toContain('Test error from server');
  });

  test('应该回显数据', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        // 否则等待回调
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (echo test):', serverPeerId);

    const testData = { foo: 'bar', num: 42, nested: { a: 1, b: 2 } };

    // 客户端发送 echo 请求
    const data = await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
    }, { peerId: serverPeerId, path: '/api/echo', data: testData });

    console.log('Echo Response data:', data);

    // 验证响应数据与请求数据相同（自动拆箱后）
    expect(data).toEqual(testData);
  });

  test('应该处理多个并发请求', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        // 否则等待回调
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (concurrent test):', serverPeerId);

    // 发送多个并发请求
    const dataList = await page2.evaluate(async (peerId: string) => {
      const send = (window as any).sxPeerHttpUtil.send;
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(send(peerId, '/api/echo', { index: i }));
      }
      return await Promise.all(promises);
    }, serverPeerId);

    console.log('Concurrent Response data:', dataList);

    // 验证所有响应（已自动拆箱）
    expect(dataList).toHaveLength(3);
    for (let i = 0; i < dataList.length; i++) {
      expect(dataList[i]).toHaveProperty('index', i);
    }
  });

  test('应该支持不带数据参数的请求', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        // 否则等待回调
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (no data test):', serverPeerId);

    // 客户端发送不带 data 的请求
    const data = await page2.evaluate(async (args: { peerId: string; path: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
    }, { peerId: serverPeerId, path: '/api/hello' });

    console.log('No Data Response:', data);

    // 验证响应数据（已自动拆箱）
    expect(data).toHaveProperty('message', 'Hello from server');
    expect(data).toHaveProperty('received');
  });

  test('应该支持注册和注销处理器', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        // 检查是否已经 ready
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        // 否则等待回调
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (register/unregister test):', serverPeerId);

    // 在服务器端动态注册一个新处理器
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

    // 在服务器端注销处理器
    await page1.evaluate(() => {
      const wrapper = (window as any).testWrapper;
      if (wrapper) {
        wrapper.unregisterHandler('/api/dynamic');
      }
    });

    // 客户端再次发送请求，应该抛出 404 异常
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

  test('应该正确传递发送者的 Peer ID (from 参数)', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('http://localhost:8080/e2e/test-server.html');
    await page2.goto('http://localhost:8080/e2e/test-client.html');

    // 等待服务器端 Peer 准备就绪
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

    // 客户端发送请求到 /api/whoami，服务端会返回发送者的 Peer ID
    const data = await page2.evaluate(async (args: { peerId: string; path: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
    }, { peerId: serverPeerId, path: '/api/whoami' });

    console.log('Whoami response:', data);

    // 验证服务端正确识别了发送者的 Peer ID
    expect(data).toHaveProperty('yourPeerId');
    expect((data as any).yourPeerId).toEqual(clientPeerId);
  });
});
