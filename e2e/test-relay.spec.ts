/**
 * 中继功能 E2E 测试
 * 
 * 测试场景：
 * 1. 初始状态路由表为空
 * 2. 初始状态无已知节点
 * 
 * 前置条件：
 * - 信令服务器运行在 localhost:9000
 * - HTTP 服务器运行在 localhost:8080
 * - 测试页面: e2e/test-server.html
 */

import { test, expect } from '@playwright/test';

/**
 * 测试初始状态路由表为空
 * 
 * 验证点：
 * 1. 新创建的实例路由表为空对象
 */
test('getRoutingTable 返回空路由表', async ({ context }) => {
  const pageA = await context.newPage();

  await pageA.goto('http://localhost:8080/e2e/test-server.html');

  const routingTable = await pageA.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return wrapper.getRoutingTable();
  });

  console.log('Routing table:', routingTable);
  expect(routingTable).toEqual({});
});

/**
 * 测试初始状态无已知节点
 * 
 * 验证点：
 * 1. 新创建的实例没有直连节点
 */
test('getKnownNodes 返回空列表', async ({ context }) => {
  const pageA = await context.newPage();

  await pageA.goto('http://localhost:8080/e2e/test-server.html');

  const knownNodes = await pageA.evaluate(() => {
    const wrapper = (window as any).testWrapper;
    return wrapper.getKnownNodes();
  });

  console.log('Known nodes:', knownNodes);
  expect(knownNodes).toEqual([]);
});
