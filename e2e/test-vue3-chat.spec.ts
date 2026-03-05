/**
 * Vue3 Chat Demo E2E 测试
 * 
 * 测试场景：
 * 1. 页面加载和 Peer ID 显示
 * 2. 二维码生成
 * 3. 连接建立
 * 4. 文字聊天
 * 5. 图片/文件传输
 * 6. 语音/视频通话（基础功能）
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - Vite 开发服务器运行在 localhost:3000
 */

import { test, expect } from '@playwright/test';

test.describe('Vue3 Chat Demo', () => {
  
  test('应该显示 Peer ID 和二维码', async ({ page }) => {
    await page.goto('http://localhost:3000');
    
    // 等待 Peer ID 加载
    await page.waitForSelector('.id-text', { timeout: 30000 });
    
    // 验证 Peer ID 显示
    const peerIdText = await page.textContent('.id-text');
    expect(peerIdText).toBeTruthy();
    expect(peerIdText!.length).toBeGreaterThan(0);
    
    // 验证二维码 canvas 存在
    const qrCanvas = await page.$('canvas');
    expect(qrCanvas).toBeTruthy();
    
    console.log('Peer ID:', peerIdText);
  });

  test('应该能够输入并连接到对方 Peer ID', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    // 加载两个页面
    await page1.goto('http://localhost:3000');
    await page2.goto('http://localhost:3000');
    
    // 等待 Peer ID 加载
    await page1.waitForSelector('.id-text', { timeout: 30000 });
    await page2.waitForSelector('.id-text', { timeout: 30000 });
    
    // 获取 page1 的 Peer ID
    const peerId1 = await page1.textContent('.id-text');
    console.log('Page1 Peer ID:', peerId1);
    expect(peerId1).toBeTruthy();
    
    // 使用测试辅助函数直接连接
    await page2.evaluate((id) => {
      return (window as any).connectToPeer(id);
    }, peerId1!);
    
    // 等待聊天页面加载
    await page2.waitForSelector('.chat-page', { timeout: 10000 });
    
    // 验证进入了聊天页面
    const chatPageVisible = await page2.isVisible('.chat-page');
    expect(chatPageVisible).toBe(true);
  });

  test('应该能够发送和接收文字消息', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    await page1.goto('http://localhost:3000');
    await page2.goto('http://localhost:3000');
    
    await page1.waitForSelector('.id-text', { timeout: 30000 });
    await page2.waitForSelector('.id-text', { timeout: 30000 });
    
    const peerId1 = await page1.textContent('.id-text');
    expect(peerId1).toBeTruthy();
    
    // page2 连接到 page1
    await page2.evaluate((id) => (window as any).connectToPeer(id), peerId1!);
    await page2.waitForSelector('.chat-page', { timeout: 10000 });
    
    // page1 也需要连接到 page2（双向通信）
    const peerId2 = await page2.evaluate(() => (window as any).peerId);
    await page1.evaluate((id) => (window as any).connectToPeer(id), peerId2);
    await page1.waitForSelector('.chat-page', { timeout: 10000 });
    
    // page2 发送消息
    await page2.type('.input-area input[placeholder="输入消息"]', 'Hello from page2');
    await page2.click('.input-area button:has-text("发送")');
    
    // 等待 page1 收到消息
    await page1.waitForSelector('.msg.received', { timeout: 10000 });
    
    const receivedMsg = await page1.textContent('.msg.received p');
    expect(receivedMsg).toBe('Hello from page2');
    
    console.log('Message sent and received successfully');
  });

  test('应该能够发送图片', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    await page1.goto('http://localhost:3000');
    await page2.goto('http://localhost:3000');
    
    await page1.waitForSelector('.id-text', { timeout: 30000 });
    await page2.waitForSelector('.id-text', { timeout: 30000 });
    
    const peerId1 = await page1.textContent('.id-text');
    expect(peerId1).toBeTruthy();
    
    // 建立双向连接
    await page2.evaluate((id) => (window as any).connectToPeer(id), peerId1!);
    await page2.waitForSelector('.chat-page', { timeout: 10000 });
    
    const peerId2 = await page2.evaluate(() => (window as any).peerId);
    await page1.evaluate((id) => (window as any).connectToPeer(id), peerId2);
    await page1.waitForSelector('.chat-page', { timeout: 10000 });
    
    // 准备测试图片
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    
    // 设置文件选择处理器
    await page2.setInputFiles('input[type="file"]', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: testImageBuffer
    });
    
    // 等待 page1 收到图片消息
    await page1.waitForSelector('.msg.received img', { timeout: 15000 });
    
    const imgVisible = await page1.isVisible('.msg.received img');
    expect(imgVisible).toBe(true);
    
    console.log('Image sent and received successfully');
  });

  test('应该显示通话按钮', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    await page1.goto('http://localhost:3000');
    await page2.goto('http://localhost:3000');
    
    await page1.waitForSelector('.id-text', { timeout: 30000 });
    await page2.waitForSelector('.id-text', { timeout: 30000 });
    
    const peerId1 = await page1.textContent('.id-text');
    expect(peerId1).toBeTruthy();
    
    // 建立双向连接
    await page2.evaluate((id) => (window as any).connectToPeer(id), peerId1!);
    await page2.waitForSelector('.chat-page', { timeout: 10000 });
    
    // 验证通话按钮存在
    const voiceCallBtn = await page2.isVisible('button:has-text("📞")');
    const videoCallBtn = await page2.isVisible('button:has-text("📹")');
    expect(voiceCallBtn).toBe(true);
    expect(videoCallBtn).toBe(true);
    
    console.log('Call buttons displayed successfully');
  });
});
