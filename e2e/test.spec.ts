import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('PeerJsWrapper E2E Tests', () => {
  test('should send request and receive response (auto-unbox)', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
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

  test('should handle 404 when path not found', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (404 test):', serverPeerId);

    // 客户端发送到不存在的路径
    const data = await page2.evaluate(async (args: { peerId: string; path: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
    }, { peerId: serverPeerId, path: '/api/notfound' });

    console.log('404 Response data:', data);

    // 验证 404 响应数据
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Path not found');
  });

  test('should handle error from handler', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (error test):', serverPeerId);

    // 客户端发送到会抛出错误的路径
    const data = await page2.evaluate(async (args: { peerId: string; path: string }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path);
    }, { peerId: serverPeerId, path: '/api/error' });

    console.log('Error Response data:', data);

    // 验证错误处理
    expect(data).toHaveProperty('error');
    expect(data.error).toBe('Test error from server');
  });

  test('should echo data back', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
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

  test('should handle multiple concurrent requests', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
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

  test('should work without data parameter', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
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

  test('should support registerHandler and unregisterHandler', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));
    await page2.goto('file://' + join(__dirname, 'test-client.html'));

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (register/unregister test):', serverPeerId);

    // 在服务器端动态注册一个新处理器
    await page1.evaluate(() => {
      const wrapper = (window as any).testWrapper;
      if (wrapper) {
        wrapper.registerHandler('/api/dynamic', (data: any) => {
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

    // 客户端再次发送请求，应该返回 404
    const data2 = await page2.evaluate(async (args: { peerId: string; path: string; data: any }) => {
      return await (window as any).sxPeerHttpUtil.send(args.peerId, args.path, args.data);
    }, { peerId: serverPeerId, path: '/api/dynamic', data: { test: 'value' } });

    console.log('After unregister response:', data2);
    expect(data2).toHaveProperty('error');
    expect(data2.error).toContain('Path not found');
  });
});
