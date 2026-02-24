import { test, expect } from '@playwright/test';

test.describe('PeerJsWrapper Relay E2E Tests', () => {
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
});
