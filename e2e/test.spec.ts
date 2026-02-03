import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 PeerJS 脚本
async function loadPeerJS(page: any) {
  await page.addScriptTag({
    url: 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
  });
}

test.describe('PeerJS HTTP Util E2E Tests', () => {
  test('should send request and receive response', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面（服务器端已包含 PeerJS）
    await page1.goto('file://' + join(__dirname, 'test-server.html'));

    // 客户端加载 PeerJS
    await loadPeerJS(page2);

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID:', serverPeerId);

    // 客户端发送请求
    const response = await page2.evaluate(async (peerId: string) => {
      return new Promise((resolve, reject) => {
        const Peer = (window as any).Peer;
        const tempPeer = new Peer();

        tempPeer.on('open', () => {
          const conn = tempPeer.connect(peerId, { reliable: true });

          conn.on('open', () => {
            conn.send({
              type: 'request',
              id: 'test-' + Date.now(),
              request: { method: 'GET', data: { message: 'Hello from client' } },
            });
          });

          conn.on('data', (data: any) => {
            if (data.type === 'response') {
              conn.close();
              tempPeer.destroy();
              resolve(data.response);
            }
          });

          conn.on('error', reject);

          setTimeout(() => {
            conn.close();
            tempPeer.destroy();
            reject(new Error('Timeout'));
          }, 15000);
        });

        tempPeer.on('error', reject);
      });
    }, serverPeerId);

    console.log('Response:', response);

    // 验证响应
    expect(response).toHaveProperty('status', 200);
    expect(response).toHaveProperty('data');
  });

  test('should handle error response', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载错误处理测试页面
    await page1.goto('file://' + join(__dirname, 'test-server-error.html'));

    // 客户端加载 PeerJS
    await loadPeerJS(page2);

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (error test):', serverPeerId);

    // 客户端发送会触发错误的请求
    const response = await page2.evaluate(async (peerId: string) => {
      return new Promise((resolve, reject) => {
        const Peer = (window as any).Peer;
        const tempPeer = new Peer();

        tempPeer.on('open', () => {
          const conn = tempPeer.connect(peerId, { reliable: true });

          conn.on('open', () => {
            conn.send({
              type: 'request',
              id: 'test-error-' + Date.now(),
              request: { method: 'ERROR', data: {} },
            });
          });

          conn.on('data', (data: any) => {
            if (data.type === 'response') {
              conn.close();
              tempPeer.destroy();
              resolve(data.response);
            }
          });

          setTimeout(() => {
            conn.close();
            tempPeer.destroy();
            reject(new Error('Timeout'));
          }, 15000);
        });

        tempPeer.on('error', reject);
      });
    }, serverPeerId);

    console.log('Error Response:', response);

    // 验证错误处理
    expect(response).toHaveProperty('status', 500);
    expect(response.data).toHaveProperty('error');
  });

  test('should handle multiple concurrent requests', async ({ context }) => {
    const page1 = await context.newPage(); // 服务器端
    const page2 = await context.newPage(); // 客户端

    // 加载测试页面
    await page1.goto('file://' + join(__dirname, 'test-server.html'));

    // 客户端加载 PeerJS
    await loadPeerJS(page2);

    // 等待服务器端 Peer 准备就绪
    const serverPeerId = await page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        (window as any).getServerPeerId = resolve;
      });
    });

    console.log('Server Peer ID (concurrent test):', serverPeerId);

    // 发送多个并发请求
    const responses = await page2.evaluate(async (peerId: string) => {
      const Peer = (window as any).Peer;

      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          new Promise((resolve, reject) => {
            const tempPeer = new Peer();

            tempPeer.on('open', () => {
              const conn = tempPeer.connect(peerId, { reliable: true });

              conn.on('open', () => {
                conn.send({
                  type: 'request',
                  id: 'test-concurrent-' + i + '-' + Date.now(),
                  request: { method: 'GET', data: { index: i } },
                });
              });

              conn.on('data', (data: any) => {
                if (data.type === 'response') {
                  conn.close();
                  tempPeer.destroy();
                  resolve(data.response);
                }
              });

              setTimeout(() => {
                conn.close();
                tempPeer.destroy();
                reject(new Error('Timeout'));
              }, 15000);
            });

            tempPeer.on('error', reject);
          })
        );
      }

      return await Promise.all(promises);
    }, serverPeerId);

    console.log('Concurrent Responses:', responses);

    // 验证所有响应
    expect(responses).toHaveLength(3);
    for (const res of responses as any[]) {
      expect(res).toHaveProperty('status', 200);
    }
  });
});
