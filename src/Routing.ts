/**
 * RoutingManager - 路由管理模块
 * 
 * 负责中继通信的核心功能：
 * - 维护已知的成功通信节点列表（knownNodes）
 * - 维护路由表（routingTable）
 * - 广播路由更新到邻居节点
 * - 处理收到的路由更新消息
 * 
 * 路由机制：
 * 1. 每次成功通信后，记录对方节点为已知节点
 * 2. 成功后广播路由更新，告知对方自己可达的节点
 * 3. 收到路由更新后，合并到本地路由表
 * 
 * @example
 * const routing = new RoutingManager(callbacks, { maxRelayNodes: 5 });
 * routing.recordSuccessfulNode(peerId);  // 记录成功节点
 * routing.broadcastRouteUpdate();         // 广播路由
 * const table = routing.getRoutingTable(); // 获取路由表
 */

import type { Peer } from 'peerjs';
import type { RouteEntry, RelayConfig, RelayMessage } from './types';

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
}

/**
 * 路由管理器类
 * 负责维护路由表和节点发现
 */
export class RoutingManager {
  /** 路由表：target -> RouteEntry */
  private routingTable = new Map<string, RouteEntry>();
  /** 已知的成功通信节点列表 */
  private knownNodes: string[] = [];
  /** 中继配置 */
  private relayConfig: RelayConfig;
  /** 回调函数集合 */
  private callbacks: RoutingCallbacks;

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
   * 记录成功的通信节点
   * 将成功通信的节点添加到已知节点列表
   * @param nodeId 节点 ID
   */
  recordSuccessfulNode(nodeId: string): void {
    const myPeerId = this.callbacks.getMyPeerId();
    if (nodeId === myPeerId) return;
    
    if (!this.knownNodes.includes(nodeId)) {
      const maxRelayNodes = this.relayConfig.maxRelayNodes ?? 5;
      this.knownNodes.push(nodeId);
      // 保持列表在最大长度内
      if (this.knownNodes.length > maxRelayNodes) {
        this.knownNodes.shift();
      }
      this.callbacks.debugLog('Routing', 'newNode', nodeId);
    }
  }

  /**
   * 广播路由更新
   * 向所有已知节点发送路由更新消息，告知它们本节点可达的节点列表
   */
  async broadcastRouteUpdate(): Promise<void> {
    const myPeerId = this.callbacks.getMyPeerId();
    // 可达节点 = 已知节点 + 自己
    const reachableNodes = [...this.knownNodes, myPeerId];
    
    for (const nodeId of this.knownNodes) {
      try {
        await this.sendRouteUpdate(nodeId, reachableNodes);
      } catch {
        // 忽略单个节点的广播失败
      }
    }
  }

  /**
   * 发送路由更新到指定节点
   * @param targetId 目标节点 ID
   * @param reachableNodes 可达的节点列表
   */
  private async sendRouteUpdate(targetId: string, reachableNodes: string[]): Promise<void> {
    const peerInstance = this.callbacks.getPeerInstance();
    const myPeerId = this.callbacks.getMyPeerId();
    
    if (!peerInstance) {
      throw new Error('Peer instance not available');
    }

    return new Promise((resolve, reject) => {
      const conn = peerInstance.connect(targetId, { reliable: true });

      const timeout = setTimeout(() => {
        conn.close();
        reject(new Error('Route update timeout'));
      }, 5000);

      conn.on('open', () => {
        const message: RelayMessage = {
          type: 'route-update',
          id: `${myPeerId}-route-${Date.now()}`,
          originalTarget: targetId,
          relayPath: [],
          forwardPath: [],
          routeUpdate: { reachableNodes },
        };
        conn.send(message);
        clearTimeout(timeout);
        conn.close();
        resolve();
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        reject(new Error('Route update failed'));
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
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

    // 遍历可达节点列表，更新路由表
    for (const target of reachableNodes) {
      if (target === myPeerId) continue;

      const existing = this.routingTable.get(target);
      // 跳数 = 1 + (对方到目标的跳数，假设对方到自己是一跳)
      const hops = 1 + (fromPeerId === myPeerId ? 0 : 1);

      // 只有路由不存在、跳数更少、或更新时，才更新路由表
      if (!existing || hops < existing.hops || timestamp > existing.timestamp) {
        this.routingTable.set(target, {
          target,
          nextHop: fromPeerId,
          hops,
          via: fromPeerId,
          timestamp,
        });
        this.callbacks.debugLog('Routing', 'update', { target, nextHop: fromPeerId, hops });
      }
    }
  }

  /**
   * 获取路由表（用于调试和显示）
   * @returns 路由表对象
   */
  getRoutingTable(): Record<string, RouteEntry> {
    const result: Record<string, RouteEntry> = {};
    this.routingTable.forEach((entry, target) => {
      result[target] = entry;
    });
    return result;
  }

  /**
   * 获取已知节点列表
   * @returns 已知节点 ID 数组
   */
  getKnownNodes(): string[] {
    return [...this.knownNodes];
  }
}
