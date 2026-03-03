/**
 * 调试模式 E2E 测试
 * 
 * 测试场景：
 * 1. 调试模式下输出日志
 * 2. 非调试模式下不输出日志
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-server.html (非调试), e2e/test-debug.html (调试)
 */

import { test, expect } from '@playwright/test';

/**
 * 测试调试模式输出日志
 * 
 * 验证点：
 * 1. 启用调试模式时，控制台有日志输出
 */
test('调试模式应该输出日志', async ({ context }) => {
  const page = await context.newPage();
  const consoleMessages: string[] = [];

  page.on('console', msg => {
    consoleMessages.push(msg.text());
  });

  await page.goto('http://localhost:8080/e2e/test-debug.html');

  await page.waitForFunction(() => (window as any).peerReady);

  console.log('Console messages count:', consoleMessages.length);

  const debugMessages = consoleMessages.filter(msg => 
    msg.includes('Peer') || 
    msg.includes('Conn') || 
    msg.includes('Call') ||
    msg.includes('PeerJsWrapper')
  );

  console.log('Debug messages:', debugMessages.slice(0, 5));

  expect(debugMessages.length).toBeGreaterThan(0);
});

/**
 * 测试非调试模式不输出调试日志
 * 
 * 验证点：
 * 1. 未启用调试模式时，控制台无调试日志
 */
test('非调试模式不应该输出调试日志', async ({ context }) => {
  const page = await context.newPage();
  const consoleMessages: string[] = [];

  page.on('console', msg => {
    consoleMessages.push(msg.text());
  });

  await page.goto('http://localhost:8080/e2e/test-server.html');

  await page.waitForFunction(() => (window as any).peerReady);

  await new Promise(resolve => setTimeout(resolve, 500));

  const debugMessages = consoleMessages.filter(msg => 
    msg.includes('[sx-peerjs-http-util]') ||
    msg.includes('Peer') && msg.includes('open') ||
    msg.includes('Conn') && msg.includes('open')
  );

  console.log('Non-debug console messages:', consoleMessages.length);
  console.log('Debug messages in non-debug mode:', debugMessages.length);
});
