/**
 * RoutingManager - 路由管理模块
 * 
 * 负责中继通信的核心功能：
 * - 维护直连节点列表及延迟（directNodes）
 * - 维护路由表（routingTable）：目标节点 -> 多个下一跳（含延迟）
 * - 广播路由更新到邻居节点
 * - 路由发现：当直连和路由表都失败时，广播询问谁能连通目标
 * - 处理路由查询和响应
 * 
 * 路由机制：
 * 1. 每次成功通信后，记录对方节点为直连节点并测量延迟
 * 2. 成功后广播路由更新，告知对方自己可达的节点
 * 3. 收到路由更新后，合并到本地路由表
 * 4. 直连失败且路由表为空时，执行路由发现广播
 */

import type { Peer } from 'peerjs';
import type { RouteEntry, NextHop, DirectNodeLatency, RelayConfig, RelayMessage } from './types';
import {
  initRoutingDB,
  loadRoutingTable,
  saveRouteEntry,
  saveRouteEntries,
  deleteRouteEntry,
  loadDirectNodes,
  saveDirectNode,
  saveDirectNodes,
  cleanupExpiredRoutes,
  cleanupExpiredNodes,
} from './RoutingDB';

/**
 * 路由管理器回调接口
 */
export interface RoutingCallbacks {
  /** 获取本地 Peer ID */
  getMyPeerId(): string;
  /** 获取 PeerJS 实例 */
  getPeerInstance(): Peer | null;
  /** 调试日志函数 */
  debugLog: (obj: string, event: string, data?: unknown) => void;
  /** 发送中继消息 */
  sendRelayMessage(targetId: string, message: RelayMessage): Promise<void>;
  /** 处理路由查询响应 */
  onRouteDiscoveryResponse?: (targetId: string, latency: number) => void;
}

/**
 * 路由管理器类
 * 负责维护路由表、节点发现和自动路由选择
 */
export class RoutingManager {
  /** 路由表：target -> RouteEntry */
  private routingTable = new Map<string, RouteEntry>();
  /** 直连节点及延迟列表 */
  private directNodes: DirectNodeLatency[] = [];
  /** 中继配置 */
  private relayConfig: RelayConfig;
  /** 回调函数集合 */
  private callbacks: RoutingCallbacks;
  /** 等待路由发现响应的 pending 队列 */
  private pendingRouteQueries = new Map<string, { resolve: (entry: RouteEntry) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  /** 定时清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** 周期广播定时器 */
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  /** 路由表容量限制 */
  private readonly maxRoutingEntries = 50;
  /** 过期时间（毫秒）*/
  private readonly expireAgeMs = 5 * 60 * 1000;

  /**
   * 创建路由管理器
   * @param callbacks 回调函数集合
   * @param relayConfig 中继配置（可选）
   */
  constructor(callbacks: RoutingCallbacks, relayConfig?: RelayConfig) {
    this.callbacks = callbacks;
    this.relayConfig = relayConfig ?? {};
  }

  /**
   * 初始化路由管理器（从 IndexedDB 加载数据并启动定时任务）
   */
  async init(): Promise<void> {
    await initRoutingDB();
    await this.loadFromDB();
    this.startMaintenanceTasks();
  }

  /**
   * 从 IndexedDB 加载路由数据
   */
  private async loadFromDB(): Promise<void> {
    try {
      const routes = await loadRoutingTable();
      for (const entry of routes) {
        this.routingTable.set(entry.target, entry);
      }
      this.callbacks.debugLog('Routing', 'loadedRoutes', routes.length);
    } catch (e) {
      this.callbacks.debugLog('Routing', 'loadError', e);
    }

    try {
      const nodes = await loadDirectNodes();
      this.directNodes = nodes;
      this.callbacks.debugLog('Routing', 'loadedNodes', nodes.length);
    } catch (e) {
      this.callbacks.debugLog('Routing', 'loadNodesError', e);
    }
  }

  /**
   * 启动定时维护任务
   */
  private startMaintenanceTasks(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000);

    this.broadcastTimer = setInterval(() => {
      this.broadcastRouteUpdate();
    }, 30000);
  }

  /**
   * 清理过期路由条目
   */
  private async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();

    for (const [target, entry] of this.routingTable) {
      if (now - entry.timestamp > this.expireAgeMs) {
        this.routingTable.delete(target);
        deleteRouteEntry(target).catch(() => {});
      }
    }

    this.directNodes = this.directNodes.filter((node) => {
      const isExpired = now - node.timestamp > this.expireAgeMs;
      if (isExpired) {
        return false;
      }
      return true;
    });

    this.callbacks.debugLog('Routing', 'cleanup', {
      routes: this.routingTable.size,
      nodes: this.directNodes.length,
    });
  }

  /**
   * 持久化路由表到 IndexedDB
   */
  async persist(): Promise<void> {
    try {
      const entries = Array.from(this.routingTable.values());
      await saveRouteEntries(entries);
    } catch (e) {
      this.callbacks.debugLog('Routing', 'persistError', e);
    }

    try {
      await saveDirectNodes(this.directNodes);
    } catch (e) {
      this.callbacks.debugLog('Routing', 'persistNodesError', e);
    }
  }

  /**
   * 销毁路由管理器（清理定时器）
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.pendingRouteQueries.forEach((pending) => {
      clearTimeout(pending.timer);
    });
    this.pendingRouteQueries.clear();
  }

  /**
   * 记录成功的直连通信
   * @param nodeId 节点 ID
   * @param latency 延迟（毫秒）
   */
  recordDirectNode(nodeId: string, latency: number): void {
    const myPeerId = this.callbacks.getMyPeerId();
    if (nodeId === myPeerId) return;

    const existing = this.directNodes.find(n => n.nodeId === nodeId);
    const timestamp = Date.now();

    if (existing) {
      existing.latency = latency;
      existing.timestamp = timestamp;
    } else {
      const maxRelayNodes = this.relayConfig.maxRelayNodes ?? 5;
      this.directNodes.push({ nodeId, latency, timestamp });
      if (this.directNodes.length > maxRelayNodes) {
        this.directNodes.sort((a, b) => a.latency - b.latency);
        this.directNodes.shift();
      }
    }

    this.callbacks.debugLog('Routing', 'directNode', { nodeId, latency });
  }

  /**
   * 获取直连节点列表（按延迟升序）
   * @returns 直连节点列表
   */
  getDirectNodes(): DirectNodeLatency[] {
    return [...this.directNodes].sort((a, b) => a.latency - b.latency);
  }

  /**
   * 检查是否可以直连目标节点
   * @param targetId 目标节点 ID
   * @returns 是否可以直连
   */
  canReachDirectly(targetId: string): boolean {
    return this.directNodes.some(n => n.nodeId === targetId);
  }

  /**
   * 获取到直连节点的延迟
   * @param nodeId 节点 ID
   * @returns 延迟（毫秒），如果不存在返回 null
   */
  getDirectLatency(nodeId: string): number | null {
    const node = this.directNodes.find(n => n.nodeId === nodeId);
    return node ? node.latency : null;
  }

  /**
   * 移除失效的路由（通信失败时调用）
   * @param nodeId 失效的节点 ID
   */
  removeRoute(nodeId: string): void {
    let removed = false;
    for (const [target, entry] of this.routingTable) {
      const originalLength = entry.nextHops.length;
      entry.nextHops = entry.nextHops.filter(h => h.nodeId !== nodeId);
      if (entry.nextHops.length === 0) {
        this.routingTable.delete(target);
        deleteRouteEntry(target).catch(() => {});
        removed = true;
      } else if (entry.nextHops.length < originalLength) {
        entry.timestamp = Date.now();
        saveRouteEntry(entry).catch(() => {});
        removed = true;
      }
    }

    const nodeIndex = this.directNodes.findIndex(n => n.nodeId === nodeId);
    if (nodeIndex !== -1) {
      this.directNodes.splice(nodeIndex, 1);
      removed = true;
    }

    if (removed) {
      this.callbacks.debugLog('Routing', 'routeRemoved', nodeId);
    }
  }

  /**
   * 检查路由表是否为空
   * @returns 是否为空
   */
  isRoutingTableEmpty(): boolean {
    return this.routingTable.size === 0;
  }

  /**
   * 记录成功通信的节点（兼容旧接口）
   * @param nodeId 节点 ID
   */
  recordSuccessfulNode(nodeId: string): void {
    const myPeerId = this.callbacks.getMyPeerId();
    if (nodeId === myPeerId) return;

    const existing = this.directNodes.find(n => n.nodeId === nodeId);
    if (!existing) {
      const maxRelayNodes = this.relayConfig.maxRelayNodes ?? 5;
      this.directNodes.push({ nodeId, latency: 100, timestamp: Date.now() });
      if (this.directNodes.length > maxRelayNodes) {
        this.directNodes.sort((a, b) => a.latency - b.latency);
        this.directNodes.shift();
      }
    }
  }

  /**
   * 广播路由更新
   * 向所有直连节点发送路由更新消息，告知它们本节点可达的节点列表
   */
  async broadcastRouteUpdate(): Promise<void> {
    const myPeerId = this.callbacks.getMyPeerId();
    const reachableNodes = this.getReachableNodes();

    for (const node of this.directNodes) {
      try {
        await this.sendRouteUpdate(node.nodeId, reachableNodes);
      } catch {
        // 忽略单个节点的广播失败
      }
    }
  }

  /**
   * 获取本节点可达的节点列表
   * @returns 可达节点数组（直连节点 + 自己）
   */
  private getReachableNodes(): string[] {
    const myPeerId = this.callbacks.getMyPeerId();
    const directNodeIds = this.directNodes.map(n => n.nodeId);
    return [...new Set([...directNodeIds, myPeerId])];
  }

  /**
   * 发送路由更新到指定节点
   * @param targetId 目标节点 ID
   * @param reachableNodes 可达的节点列表
   */
  private async sendRouteUpdate(targetId: string, reachableNodes: string[]): Promise<void> {
    const myPeerId = this.callbacks.getMyPeerId();

    const message: RelayMessage = {
      type: 'route-update',
      id: `${myPeerId}-route-${Date.now()}`,
      originalTarget: targetId,
      relayPath: [],
      forwardPath: [],
      routeUpdate: { reachableNodes },
    };

    await this.callbacks.sendRelayMessage(targetId, message);
  }

  /**
   * 处理收到的路由更新
   * 合并对端发来的可达节点信息到本地路由表
   * @param fromPeerId 发送路由更新的节点 ID
   * @param message 路由更新消息
   */
  handleRouteUpdate(fromPeerId: string, message: RelayMessage): void {
    if (!message.routeUpdate) return;

    const myPeerId = this.callbacks.getMyPeerId();
    const { reachableNodes } = message.routeUpdate;
    const timestamp = Date.now();

    const viaLatency = this.getDirectLatency(fromPeerId) ?? 100;

    for (const target of reachableNodes) {
      if (target === myPeerId) continue;

      let entry = this.routingTable.get(target);
      const totalLatency = viaLatency + 100;

      if (!entry) {
        entry = {
          target,
          nextHops: [],
          hops: 1,
          timestamp,
        };
        this.routingTable.set(target, entry);
      }

      const existingHop = entry.nextHops.find(h => h.nodeId === fromPeerId);
      if (existingHop) {
        existingHop.latency = totalLatency;
      } else {
        entry.nextHops.push({ nodeId: fromPeerId, latency: totalLatency });
      }

      entry.nextHops.sort((a, b) => a.latency - b.latency);
      entry.hops = Math.min(entry.hops, 1);
      entry.timestamp = timestamp;

      this.callbacks.debugLog('Routing', 'update', { target, nextHop: fromPeerId, latency: totalLatency });
    }
  }

  /**
   * 执行路由发现广播
   * 当直连和路由表都失败时，向所有直连节点广播询问谁能连通目标
   * @param targetId 目标节点 ID
   * @returns 路由条目（如果发现）
   */
  async discoverRoute(targetId: string): Promise<RouteEntry | null> {
    const myPeerId = this.callbacks.getMyPeerId();
    const directNodes = this.getDirectNodes();

    if (directNodes.length === 0) {
      this.callbacks.debugLog('Routing', 'discoverRoute', 'no direct nodes');
      return null;
    }

    this.callbacks.debugLog('Routing', 'discoverRoute', { targetId, directNodes: directNodes.length });

    const queryId = `${myPeerId}-query-${Date.now()}`;

    const routeEntry = await new Promise<RouteEntry | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRouteQueries.delete(queryId);
        resolve(null);
      }, 10000);

      this.pendingRouteQueries.set(queryId, { resolve, reject, timer });

      const message: RelayMessage = {
        type: 'route-query',
        id: queryId,
        originalTarget: targetId,
        relayPath: [myPeerId],
        forwardPath: [],
        routeQuery: {
          queryOrigin: myPeerId,
          targetNode: targetId,
          queryPath: [myPeerId],
        },
      };

      for (const node of directNodes) {
        this.callbacks.sendRelayMessage(node.nodeId, message).catch(() => {});
      }
    });

    return routeEntry;
  }

  /**
   * 处理路由查询消息
   * @param fromPeerId 发送查询的节点
   * @param message 路由查询消息
   */
  handleRouteQuery(fromPeerId: string, message: RelayMessage): void {
    if (!message.routeQuery) return;

    const myPeerId = this.callbacks.getMyPeerId();
    const { queryOrigin, targetNode, queryPath } = message.routeQuery;

    if (targetNode === myPeerId) {
      const latency = this.getDirectLatency(fromPeerId) ?? 100;
      const response: RelayMessage = {
        type: 'route-response',
        id: `${myPeerId}-resp-${Date.now()}`,
        originalTarget: queryOrigin,
        relayPath: [],
        forwardPath: [],
        routeResponse: {
          queryOrigin,
          responder: myPeerId,
          targetNode,
          latency,
        },
      };
      this.callbacks.sendRelayMessage(fromPeerId, response);
      return;
    }

    if (queryPath.includes(myPeerId)) {
      return;
    }

    const nextHop = this.findNextHopToTarget(targetNode);
    if (nextHop) {
      const latency = (this.getDirectLatency(fromPeerId) ?? 100) + nextHop.latency;
      const response: RelayMessage = {
        type: 'route-response',
        id: `${myPeerId}-resp-${Date.now()}`,
        originalTarget: queryOrigin,
        relayPath: [],
        forwardPath: [],
        routeResponse: {
          queryOrigin,
          responder: myPeerId,
          targetNode,
          latency,
        },
      };
      this.callbacks.sendRelayMessage(fromPeerId, response);
      return;
    }

    const newPath = [...queryPath, myPeerId];
    const forwardMessage: RelayMessage = {
      ...message,
      relayPath: newPath,
      routeQuery: {
        ...message.routeQuery,
        queryPath: newPath,
      },
    };

    for (const node of this.directNodes) {
      if (node.nodeId !== fromPeerId) {
        this.callbacks.sendRelayMessage(node.nodeId, forwardMessage).catch(() => {});
      }
    }
  }

  /**
   * 处理路由查询响应
   * @param fromPeerId 响应者节点
   * @param message 路由响应消息
   */
  handleRouteResponse(fromPeerId: string, message: RelayMessage): void {
    if (!message.routeResponse) return;

    const { queryOrigin, targetNode, latency } = message.routeResponse;
    const myPeerId = this.callbacks.getMyPeerId();

    if (queryOrigin !== myPeerId) return;

    const pending = Array.from(this.pendingRouteQueries.values())[0];
    if (!pending) return;

    let entry = this.routingTable.get(targetNode);
    const timestamp = Date.now();

    if (!entry) {
      entry = {
        target: targetNode,
        nextHops: [],
        hops: 1,
        timestamp,
      };
      this.routingTable.set(targetNode, entry);
    }

    const existingHop = entry.nextHops.find(h => h.nodeId === fromPeerId);
    if (existingHop) {
      existingHop.latency = latency;
    } else {
      entry.nextHops.push({ nodeId: fromPeerId, latency });
    }

    entry.nextHops.sort((a, b) => a.latency - b.latency);
    entry.timestamp = timestamp;

    this.callbacks.debugLog('Routing', 'discovered', { targetNode, nextHop: fromPeerId, latency });

    clearTimeout(pending.timer);
    pending.resolve(entry);
  }

  /**
   * 查找到目标节点的下一跳
   * @param targetId 目标节点 ID
   * @returns 下一跳信息，如果没有则返回 null
   */
  findNextHopToTarget(targetId: string): NextHop | null {
    const entry = this.routingTable.get(targetId);
    if (!entry || entry.nextHops.length === 0) return null;
    return entry.nextHops[0];
  }

  /**
   * 获取到目标节点的所有下一跳（按延迟升序）
   * @param targetId 目标节点 ID
   * @returns 下一跳列表
   */
  getNextHopsToTarget(targetId: string): NextHop[] {
    const entry = this.routingTable.get(targetId);
    return entry ? [...entry.nextHops] : [];
  }

  /**
   * 获取路由表
   * @returns 路由表对象
   */
  getRoutingTable(): Record<string, RouteEntry> {
    const result: Record<string, RouteEntry> = {};
    this.routingTable.forEach((entry, target) => {
      result[target] = { ...entry, nextHops: [...entry.nextHops] };
    });
    return result;
  }

  /**
   * 获取已知节点列表（兼容旧接口）
   * @returns 节点 ID 数组
   */
  getKnownNodes(): string[] {
    return this.directNodes.map(n => n.nodeId);
  }
}
