/**
 * 文件传输 E2E 测试
 * 
 * 测试场景：
 * 1. 小文件直接传输
 * 2. 大文件分片传输
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-file.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试小文件直接传输
 * 
 * 验证点：
 * 1. 小文件可以通过 /file 路径直接传输
 */
test('小文件应该直接传输', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await page1.goto('http://localhost:8080/e2e/test-file.html');
  await page2.goto('http://localhost:8080/e2e/test-file.html');

  const [serverPeerId, clientPeerId] = await Promise.all([
    page1.evaluate(() => {
      return new Promise<string>((resolve) => {
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        (window as any).getServerPeerId = resolve;
      });
    }),
    page2.evaluate(() => {
      return new Promise<string>((resolve) => {
        if ((window as any).peerReady && (window as any).peerId) {
          resolve((window as any).peerId);
          return;
        }
        (window as any).getClientPeerId = resolve;
      });
    })
  ]);

  console.log('Server Peer ID:', serverPeerId);
  console.log('Client Peer ID:', clientPeerId);

  const testContent = 'Hello, this is a test file content!';
  const encoder = new TextEncoder();
  const testData = encoder.encode(testContent);

  const result = await page2.evaluate(async (args: { peerId: string; data: Uint8Array }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, '/file', {
      fileId: 'test-file-1',
      name: 'test.txt',
      mimeType: 'text/plain',
      size: args.data.length,
      type: 'file',
      data: args.data
    });
  }, { peerId: serverPeerId, data: testData });

  console.log('File send result:', result);
  expect(result).toHaveProperty('success', true);

  const receivedFiles = await page1.evaluate(() => (window as any).receivedFiles);
  console.log('Received files:', receivedFiles.size);
  expect(receivedFiles.size).toBeGreaterThan(0);
});

/**
 * 测试大文件分片传输开始
 * 
 * 验证点：
 * 1. 大文件可以通过 /file/start、/file/chunk、/file/complete 分片传输
 */
test('大文件应该分片传输', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await page1.goto('http://localhost:8080/e2e/test-file.html');
  await page2.goto('http://localhost:8080/e2e/test-file.html');

  const serverPeerId = await page1.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getServerPeerId = resolve;
    });
  });

  const fileId = 'large-file-test';

  await page2.evaluate(async (args: { peerId: string; fileId: string }) => {
    const wrapper = (window as any).sxPeerHttpUtil;
    await wrapper.send(args.peerId, '/file/start', {
      fileId: args.fileId,
      name: 'large-test.bin',
      mimeType: 'application/octet-stream',
      size: 2000000,
      type: 'file'
    });
  }, { peerId: serverPeerId, fileId });

  const chunkResult = await page2.evaluate(async (args: { peerId: string; fileId: string }) => {
    const wrapper = (window as any).sxPeerHttpUtil;
    const chunkData = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      chunkData[i] = i % 256;
    }
    return await wrapper.send(args.peerId, '/file/chunk', {
      fileId: args.fileId,
      index: 0,
      data: chunkData
    });
  }, { peerId: serverPeerId, fileId });

  console.log('Chunk send result:', chunkResult);
  expect(chunkResult).toHaveProperty('success', true);

  const completeResult = await page2.evaluate(async (args: { peerId: string; fileId: string }) => {
    const wrapper = (window as any).sxPeerHttpUtil;
    return await wrapper.send(args.peerId, '/file/complete', {
      fileId: args.fileId
    });
  }, { peerId: serverPeerId, fileId });

  console.log('Complete result:', completeResult);
  expect(completeResult).toHaveProperty('success', true);
});

/**
 * 测试文件元信息正确传递
 * 
 * 验证点：
 * 1. 文件名、MIME 类型、大小应该正确传递
 */
test('文件元信息应该正确传递', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await page1.goto('http://localhost:8080/e2e/test-file.html');
  await page2.goto('http://localhost:8080/e2e/test-file.html');

  const serverPeerId = await page1.evaluate(() => {
    return new Promise<string>((resolve) => {
      if ((window as any).peerReady && (window as any).peerId) {
        resolve((window as any).peerId);
        return;
      }
      (window as any).getServerPeerId = resolve;
    });
  });

  const testContent = 'Test file content';
  const encoder = new TextEncoder();
  const testData = encoder.encode(testContent);

  await page2.evaluate(async (args: { peerId: string; data: Uint8Array }) => {
    return await (window as any).sxPeerHttpUtil.send(args.peerId, '/file', {
      fileId: 'meta-test-file',
      name: 'my-test-file.txt',
      mimeType: 'text/plain; charset=utf-8',
      size: args.data.length,
      type: 'file',
      data: args.data
    });
  }, { peerId: serverPeerId, data: testData });

  const receivedFile = await page1.evaluate(() => {
    const files = (window as any).receivedFiles;
    return files.get('meta-test-file');
  });

  console.log('Received file metadata:', receivedFile);
  expect(receivedFile).toBeDefined();
  expect(receivedFile.name).toBe('my-test-file.txt');
  expect(receivedFile.mimeType).toBe('text/plain; charset=utf-8');
});
