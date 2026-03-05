/**
 * PeerJsWrapper - 封装 PeerJS 为类似 HTTP 的 API
 * 
 * 核心功能：
 * 1. 类似 HTTP 的请求/响应机制（send/relaySend）
 * 2. 语音/视频通话（call/onIncomingCall）
 * 3. 中继路由（relaySend/getRoutingTable/getKnownNodes）
 * 
 * @example
 * // 基本请求
 * const wrapper = new PeerJsWrapper();
 * const data = await wrapper.send(peerId, '/api/hello', { name: 'world' });
 * 
 * // 中继请求
 * await wrapper.relaySend(targetId, '/api/data', 'test', ['relayNode1', 'relayNode2']);
 * 
 * // 语音通话
 * const call = await wrapper.call(peerId, { video: true });
 */

import { Peer, DataConnection, MediaConnection } from 'peerjs';
import { CallSessionImpl } from './CallSession';
import { Router } from './Router';
import { MessageHandler } from './MessageHandler';
import {
  CONNECTION_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
  RECONNECT_DELAY_MS,
  DEFAULT_TTL,
} from './constants';
import type {
  Request,
  Response,
  SimpleHandler,
  CallOptions,
  CallSession,
  CallState,
  CallStateListener,
  IncomingCallEvent,
  IncomingCallListener,
  RouteEntry,
  RelayConfig,
  RelayMessage,
  ServerConfig
} from './types';

/** 版本号（构建时注入） */
declare const __VERSION__: string;
export const VERSION = __VERSION__;
console.log(`[sx-peerjs-http-util] v${VERSION}`);

/**
 * 生成 UUID v4
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * 待处理的请求
 */
interface PendingRequest {
  /** 成功回调 */
  resolve: (data: unknown) => void;
  /** 失败回调 */
  reject: (error: Error) => void;
  /** 超时定时器 */
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * 内部消息格式（用于直连请求）
 */
interface InternalMessage {
  /** 消息类型 */
  type: 'request' | 'response';
  /** 消息 ID，用于匹配请求和响应 */
  id: string;
  /** 请求数据 */
  request?: Request;
  /** 响应数据 */
  response?: Response;
}

/**
 * PeerJsWrapper 主类
 * 封装 PeerJS，提供类似 HTTP 的 API
 */
export class PeerJsWrapper {
  /** 本地 Peer ID */
  private myPeerId: string;
  /** PeerJS 实例 */
  private peerInstance: Peer | null = null;
  /** 当前活跃的传入连接集合 */
  private connections = new Set<DataConnection>();
  /** 待处理的请求映射表（用于请求-响应匹配） */
  private pendingRequests = new Map<string, PendingRequest>();
  /** 路径处理器映射表 */
  private simpleHandlers = new Map<string, SimpleHandler>();
  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否已销毁 */
  private isDestroyed = false;
  /** 是否开启调试模式 */
  private isDebug: boolean;
  /** 服务器配置 */
  private serverConfig?: ServerConfig;
  /** 当前活跃的通话 */
  private activeCall: CallSessionImpl | null = null;
  /** 来电监听器集合 */
  private incomingCallListeners = new Set<IncomingCallListener>();

  /** 路由管理器 */
  private router: Router;
  /** 消息处理器 */
  private messageHandler: MessageHandler;

  /**
   * 创建 PeerJsWrapper 实例
   * @param peerId 可选的 Peer ID，如果不提供则自动生成 UUID
   * @param isDebug 是否开启调试模式，开启后会打印事件日志
   * @param server 可选的信令服务器配置，不提供则使用 PeerJS 公共服务器
   * @param relayConfig 可选的中继配置
   */
  constructor(peerId?: string, isDebug?: boolean, server?: ServerConfig, relayConfig?: RelayConfig) {
    this.myPeerId = peerId || generateUUID();
    this.isDebug = isDebug ?? false;
    this.serverConfig = server;

    const callbacks = {
      getMyPeerId: () => this.myPeerId,
      getPeerInstance: () => this.peerInstance,
      debugLog: this.debugLog.bind(this),
      sendRelayMessage: (targetId: string, message: RelayMessage) => this.sendRelayMessage(targetId, message),
    };

    this.router = new Router(callbacks, relayConfig);
    this.router.init();
    this.messageHandler = new MessageHandler({
      ...callbacks,
      waitForReady: () => this.waitForReady(),
      getSimpleHandlers: () => this.simpleHandlers,
      onRouteUpdate: (fromPeerId, message) => this.router.handleRouteUpdate(fromPeerId, message),
    });

    this.connect();
  }

  /**
   * 创建实例并等待就绪（语法糖）
   * @param peerId 可选的 Peer ID
   * @param isDebug 是否开启调试模式
   * @param server 可选的信令服务器配置
   * @param relayConfig 可选的中继配置
   * @returns Promise<PeerJsWrapper>
   */
  static async create(
    peerId?: string,
    isDebug?: boolean,
    server?: ServerConfig,
    relayConfig?: RelayConfig
  ): Promise<PeerJsWrapper> {
    const wrapper = new PeerJsWrapper(peerId, isDebug, server, relayConfig);
    await wrapper.whenReady();
    return wrapper;
  }

  private debugLog(obj: string, event: string, data?: unknown): void {
    if (this.isDebug) {
      console.log(obj, event, data);
    }
  }

  private connect(): void {
    if (this.isDestroyed) return;

    this.peerInstance = this.serverConfig
      ? new Peer(this.myPeerId, { ...this.serverConfig })
      : new Peer(this.myPeerId);

    this.setupPeerEventHandlers();
  }

  private setupPeerEventHandlers(): void {
    if (!this.peerInstance) return;

    this.peerInstance.on('open', (id) => {
      this.debugLog('Peer', 'open', id);
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.peerInstance.on('disconnected', () => {
      this.debugLog('Peer', 'disconnected');
      this.scheduleReconnect();
    });

    this.peerInstance.on('error', (err) => {
      this.debugLog('Peer', 'error', { type: err.type, message: err.message });
      if (
        err.type === 'network' ||
        err.type === 'server-error' ||
        err.type === 'socket-error' ||
        err.type === 'socket-closed'
      ) {
        this.scheduleReconnect();
      }
    });

    this.peerInstance.on('close', () => {
      this.debugLog('Peer', 'close');
    });

    this.peerInstance.on('call', (mediaConnection: MediaConnection) => {
      this.handleIncomingCall(mediaConnection);
    });

    this.setupIncomingConnectionHandler();
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, RECONNECT_DELAY_MS);
  }

  private reconnect(): void {
    if (this.isDestroyed) return;
    this.debugLog('PeerJsWrapper', 'reconnect');

    if (this.peerInstance) {
      try {
        this.peerInstance.destroy();
      } catch {
        // ignore
      }
      this.peerInstance = null;
    }

    this.connect();
  }

  getPeerId(): string {
    return this.myPeerId;
  }

  private whenReady(): Promise<void> {
    return this.waitForReady();
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peerInstance) {
        reject(new Error('Peer instance not initialized'));
        return;
      }

      if (this.peerInstance.open) {
        resolve();
        return;
      }

      const onOpen = () => {
        this.peerInstance?.off('open', onOpen);
        this.peerInstance?.off('error', onError);
        resolve();
      };

      const onError = (err: Error) => {
        this.peerInstance?.off('open', onOpen);
        this.peerInstance?.off('error', onError);
        reject(err);
      };

      this.peerInstance.on('open', onOpen);
      this.peerInstance.on('error', onError);
    });
  }

  getRoutingTable(): Record<string, RouteEntry> {
    return this.router.getRoutingTable();
  }

  getKnownNodes(): string[] {
    return this.router.getKnownNodes();
  }

  /**
   * 发送中继消息的辅助方法
   * @param targetId 目标节点 ID
   * @param message 中继消息
   */
  private sendRelayMessage(targetId: string, message: RelayMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peerInstance) {
        reject(new Error('Peer instance not available'));
        return;
      }

      const conn = this.peerInstance.connect(targetId, { reliable: true });
      const timeout = setTimeout(() => {
        conn.close();
        reject(new Error(`Send to ${targetId} timeout`));
      }, SEND_TIMEOUT_MS);

      conn.on('open', () => {
        conn.send(message);
        clearTimeout(timeout);
        conn.close();
        resolve();
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        reject(new Error(`Send to ${targetId} failed`));
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * 尝试直连目标节点
   * @param targetId 目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @param requestId 请求 ID
   * @returns Promise<unknown> - 响应数据
   */
  private tryDirectConnect(targetId: string, path: string, data: unknown, requestId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.peerInstance) {
        reject(new Error('Peer instance not available'));
        return;
      }

      const startTime = Date.now();
      const conn = this.peerInstance.connect(targetId, { reliable: true });
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.close();
          reject(new Error(`Request timeout: ${targetId}${path}`));
        }
      }, CONNECTION_TIMEOUT_MS);

      conn.on('open', () => {
        const latency = Date.now() - startTime;
        this.debugLog('Conn', 'open', { peer: targetId, latency });

        const request: Request = { path, data };
        const message: InternalMessage = {
          type: 'request',
          id: requestId,
          request,
        };
        conn.send(message);
      });

      conn.on('data', (responseData: unknown) => {
        this.debugLog('Conn', 'data', { peer: targetId, data: responseData });
        const message = responseData as InternalMessage;
        if (message.type === 'response' && message.id === requestId) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);

            const response = message.response!;
            if (response.status < 200 || response.status >= 300) {
              conn.close();
              reject(new Error(`Request failed: ${response.status} ${JSON.stringify(response.data)}`));
            } else {
              const latency = Date.now() - startTime;
              this.router.recordDirectNode(targetId, latency);
              this.router.broadcastRouteUpdate();
              resolve(response.data);
            }
          }
        }
      });

      conn.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.debugLog('Conn', 'error', { peer: targetId, error: err });
          reject(err);
        }
      });

      conn.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.debugLog('Conn', 'close', targetId);
          reject(new Error('Connection closed'));
        }
      });
    });
  }

  /**
   * 通过中继节点转发请求
   * @param nextHopId 下一跳节点 ID
   * @param targetId 原始目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @returns Promise<unknown> - 响应数据
   */
  private relayVia(nextHopId: string, targetId: string, path: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.debugLog('PeerJsWrapper', 'relayVia', { targetId, nextHop: nextHopId });

      this.waitForReady()
        .then(() => {
          if (!this.peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          const conn = this.peerInstance.connect(nextHopId, { reliable: true });
          const startTime = Date.now();

          const timeout = setTimeout(() => {
            conn.close();
            reject(new Error(`Relay timeout: ${nextHopId}${path}`));
          }, CONNECTION_TIMEOUT_MS);

          conn.on('open', () => {
            this.debugLog('Conn', 'open', nextHopId);

            const request: Request = { path, data };
            const message: RelayMessage = {
              type: 'relay-request',
              id: `${this.myPeerId}-${Date.now()}-${Math.random()}`,
              originalTarget: targetId,
              relayPath: [this.myPeerId],
              forwardPath: [],
              ttl: DEFAULT_TTL,
              request,
            };
            conn.send(message);
          });

          conn.on('data', (responseData: unknown) => {
            const message = responseData as RelayMessage;

            if (message.type === 'relay-response') {
              clearTimeout(timeout);
              conn.close();

              const response = message.response;
              if (response) {
                if (response.status < 200 || response.status >= 300) {
                  reject(new Error(`Relay failed: ${response.status} ${JSON.stringify(response.data)}`));
                } else {
                  const latency = Date.now() - startTime;
                  this.router.recordDirectNode(nextHopId, latency);
                  this.router.broadcastRouteUpdate();
                  resolve(response.data);
                }
              }
            } else if (message.type === 'route-update') {
              this.router.handleRouteUpdate(nextHopId, message);
            } else if (message.type === 'route-query') {
              this.router.handleRouteQuery(nextHopId, message);
            } else if (message.type === 'route-response') {
              this.router.handleRouteResponse(nextHopId, message);
            }
          });

          conn.on('error', (err) => {
            this.debugLog('Conn', 'error', { peer: nextHopId, error: err });
            clearTimeout(timeout);
            reject(err);
          });

          conn.on('close', () => {
            this.debugLog('Conn', 'close', nextHopId);
            clearTimeout(timeout);
            reject(new Error('Relay connection closed'));
          });
        })
        .catch(reject);
    });
  }

  /**
   * 自动路由发送
   * 
   * 1. 查路由表 → 有路由 → 尝试中继 → 全部失败 → 降级直连 → 失败 → 结束
   * 2. 路由表无目标 → 直连 → 失败 → 结束
   * @param peerId 目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @returns Promise<unknown> - 响应数据
   */
  send(peerId: string, path: string, data?: unknown): Promise<unknown> {
    const requestId = `${this.myPeerId}-${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      this.debugLog('PeerJsWrapper', 'send', { peerId, path, data });

      const nextHops = this.router.getNextHopsToTarget(peerId);

      if (nextHops.length > 0) {
        this.tryRelayChain(peerId, path, data, nextHops, 0)
          .then(resolve)
          .catch((relayErr) => {
            this.debugLog('PeerJsWrapper', 'relayFailed', { peerId, error: relayErr.message });
            this.fallbackToDirect(peerId, path, data, requestId)
              .then(resolve)
              .catch(reject);
          });
      } else {
        this.tryDirectConnect(peerId, path, data, requestId)
          .then(resolve)
          .catch((directErr) => {
            this.debugLog('PeerJsWrapper', 'directFailed', { peerId, error: directErr.message });
            this.handleSendError(peerId, directErr)
              .then(resolve)
              .catch(reject);
          });
      }
    });
  }

  /**
   * 处理发送错误
   * @param peerId 目标节点 ID
   * @param error 错误对象
   * @returns Promise
   */
  private async handleSendError(peerId: string, error: Error): Promise<unknown> {
    const errorMsg = error.message;
    const isHttpError = errorMsg.includes('Request failed:') || errorMsg.includes('404') || errorMsg.includes('500');
    const isConnectionError = errorMsg.includes('timeout') || errorMsg.includes('Connection closed') || errorMsg.includes('Peer instance not available');

    if (isHttpError) {
      throw error;
    }

    if (!isConnectionError) {
      throw error;
    }

    this.router.removeRoute(peerId);
    this.debugLog('PeerJsWrapper', 'routeRemoved', peerId);

    if (!this.router.isRoutingTableEmpty()) {
      return this.performRouteDiscovery(peerId, '', undefined, '');
    }

    throw new Error(`Cannot reach ${peerId}: no route found and routing table is empty`);
  }

  /**
   * 降级到直连尝试
   * @param peerId 目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @param requestId 请求 ID
   * @returns Promise
   */
  private async fallbackToDirect(peerId: string, path: string, data: unknown, requestId: string): Promise<unknown> {
    this.debugLog('PeerJsWrapper', 'fallbackToDirect', peerId);

    return this.tryDirectConnect(peerId, path, data, requestId)
      .catch((directErr) => {
        this.debugLog('PeerJsWrapper', 'directFailed', { peerId, error: directErr.message });
        this.handleSendError(peerId, directErr);
      });
  }

  /**
   * 尝试通过中继链转发
   * @param targetId 目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @param nextHops 下一跳列表
   * @param index 当前尝试的下一跳索引
   * @returns Promise<unknown>
   */
  private tryRelayChain(targetId: string, path: string, data: unknown, nextHops: { nodeId: string; latency: number }[], index: number): Promise<unknown> {
    if (index >= nextHops.length) {
      return Promise.reject(new Error('All relay nodes failed'));
    }

    const nextHop = nextHops[index];
    this.debugLog('PeerJsWrapper', 'tryRelay', { targetId, nextHop: nextHop.nodeId, latency: nextHop.latency });

    return this.relayVia(nextHop.nodeId, targetId, path, data).catch(() => {
      return this.tryRelayChain(targetId, path, data, nextHops, index + 1);
    });
  }

  /**
   * 执行路由发现
   * @param targetId 目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @param requestId 请求 ID
   * @returns Promise<unknown>
   */
  private async performRouteDiscovery(targetId: string, path: string, data: unknown, requestId: string): Promise<unknown> {
    this.debugLog('PeerJsWrapper', 'routeDiscovery', { targetId });

    const routeEntry = await this.router.discoverRoute(targetId);

    if (!routeEntry || routeEntry.nextHops.length === 0) {
      throw new Error(`Cannot reach ${targetId}: no route found`);
    }

    this.debugLog('PeerJsWrapper', 'routeFound', { targetId, nextHops: routeEntry.nextHops });

    return this.tryRelayChain(targetId, path, data, routeEntry.nextHops, 0);
  }

  /**
   * 中继发送（内部方法，不对外暴露）
   * @param targetId 目标节点 ID
   * @param path 请求路径
   * @param data 请求数据
   * @param relayNodes 手动指定的中继节点（可选，不指定则自动路由）
   * @returns Promise<unknown>
   */
  private relaySend(targetId: string, path: string, data: unknown, relayNodes?: string[]): Promise<unknown> {
    if (!relayNodes || relayNodes.length === 0) {
      return this.send(targetId, path, data);
    }

    const [firstRelay, ...remainingRelays] = relayNodes;

    return new Promise((resolve, reject) => {
      this.debugLog('PeerJsWrapper', 'relaySend', { targetId, firstRelay, remainingRelays });

      this.waitForReady()
        .then(() => {
          if (!this.peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          const conn = this.peerInstance.connect(firstRelay, { reliable: true });

          const timeout = setTimeout(() => {
            conn.close();
            reject(new Error(`Relay timeout: ${firstRelay}${path}`));
          }, CONNECTION_TIMEOUT_MS);

          conn.on('open', () => {
            this.debugLog('Conn', 'open', firstRelay);

            const request: Request = { path, data };
            const message: RelayMessage = {
              type: 'relay-request',
              id: `${this.myPeerId}-${Date.now()}-${Math.random()}`,
              originalTarget: targetId,
              relayPath: [],
              forwardPath: remainingRelays,
              ttl: DEFAULT_TTL,
              request,
            };
            conn.send(message);
          });

          conn.on('data', (responseData: unknown) => {
            const message = responseData as RelayMessage;

            if (message.type === 'relay-response') {
              clearTimeout(timeout);
              conn.close();

              const response = message.response;
              if (response) {
                if (response.status < 200 || response.status >= 300) {
                  reject(new Error(`Relay failed: ${response.status} ${JSON.stringify(response.data)}`));
                } else {
                  this.router.recordSuccessfulNode(firstRelay);
                  this.router.broadcastRouteUpdate();
                  resolve(response.data);
                }
              }
            } else if (message.type === 'route-update') {
              this.router.handleRouteUpdate(firstRelay, message);
            }
          });

          conn.on('error', (err) => {
            this.debugLog('Conn', 'error', { peer: firstRelay, error: err });
            clearTimeout(timeout);
            reject(err);
          });

          conn.on('close', () => {
            this.debugLog('Conn', 'close', firstRelay);
            clearTimeout(timeout);
            reject(new Error('Relay connection closed'));
          });
        })
        .catch(reject);
    });
  }

  private setupIncomingConnectionHandler(): void {
    if (!this.peerInstance) return;

    this.peerInstance.on('connection', (conn: DataConnection) => {
      this.debugLog('Peer', 'connection', conn.peer);
      this.connections.add(conn);

      conn.on('open', () => {
        this.debugLog('Conn', 'open', conn.peer);
      });

      conn.on('data', async (data: unknown) => {
        this.debugLog('Conn', 'data', { peer: conn.peer, data });

        const message = data as RelayMessage | InternalMessage;

        if (message.type === 'request') {
          const internalMsg = message as InternalMessage;
          if (internalMsg.request) {
            try {
              const response = await this.messageHandler.handleRequest(conn.peer, internalMsg.request);

              const responseMessage: InternalMessage = {
                type: 'response',
                id: internalMsg.id,
                response,
              };

              conn.send(responseMessage);
            } catch (error) {
              const errorResponse: InternalMessage = {
                type: 'response',
                id: internalMsg.id,
                response: {
                  status: 500,
                  data: { error: error instanceof Error ? error.message : 'Unknown error' },
                },
              };

              conn.send(errorResponse);
            }
          }
        } else if (message.type === 'relay-request') {
          const relayMsg = message as RelayMessage;
          if (relayMsg.request) {
            try {
              const response = await this.messageHandler.handleRequest(conn.peer, relayMsg.request, relayMsg);

              const responseMessage: RelayMessage = {
                type: 'relay-response',
                id: relayMsg.id,
                originalTarget: relayMsg.originalTarget,
                relayPath: relayMsg.relayPath,
                forwardPath: [],
                response,
              };

              conn.send(responseMessage);
            } catch (error) {
              const errorResponse: RelayMessage = {
                type: 'relay-response',
                id: relayMsg.id,
                originalTarget: relayMsg.originalTarget,
                relayPath: relayMsg.relayPath,
                forwardPath: [],
                response: {
                  status: 500,
                  data: { error: error instanceof Error ? error.message : 'Unknown error' },
                },
              };

              conn.send(errorResponse);
            }
          }
        } else if (message.type === 'route-update') {
          this.router.handleRouteUpdate(conn.peer, message as RelayMessage);
        }
      });

      conn.on('close', () => {
        this.debugLog('Conn', 'close', conn.peer);
        this.connections.delete(conn);
      });

      conn.on('error', (err) => {
        this.debugLog('Conn', 'error', { peer: conn.peer, error: err });
        this.connections.delete(conn);
      });
    });
  }

  call(peerId: string, options?: CallOptions): Promise<CallSession> {
    return new Promise((resolve, reject) => {
      this.debugLog('PeerJsWrapper', 'call', { peerId, options });

      if (this.activeCall) {
        reject(new Error('Already in a call'));
        return;
      }

      this.waitForReady()
        .then(async () => {
          if (!this.peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          const hasVideo = options?.video ?? false;

          let localStream: MediaStream;
          try {
            localStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: hasVideo
            });
          } catch (err) {
            reject(new Error(`Failed to get media: ${err instanceof Error ? err.message : err}`));
            return;
          }

          const mediaConnection = this.peerInstance.call(peerId, localStream, {
            metadata: {
              video: hasVideo,
              custom: options?.metadata
            }
          });

          const session = new CallSessionImpl(
            peerId,
            mediaConnection,
            hasVideo,
            this.debugLog.bind(this),
            this.cleanupCall.bind(this)
          );
          session.setLocalStream(localStream);

          this.setupMediaConnectionHandlers(session, mediaConnection);

          this.activeCall = session;

          const timeout = setTimeout(() => {
            if (!session.isConnected) {
              session.hangUp();
              reject(new Error('Call timeout - no answer'));
            }
          }, 30000);

          const onConnected = () => {
            clearTimeout(timeout);
            session.offStateChange(onConnected);
            session.offStateChange(onEnded);
            resolve(session);
          };

          const onEnded = (state: CallState, reason?: string) => {
            clearTimeout(timeout);
            session.offStateChange(onConnected);
            session.offStateChange(onEnded);
            if (state === 'ended') {
              reject(new Error(reason || 'Call ended before connected'));
            }
          };

          session.onStateChange(onConnected);
          session.onStateChange(onEnded);
        })
        .catch(reject);
    });
  }

  onIncomingCall(listener: IncomingCallListener): void {
    this.incomingCallListeners.add(listener);
  }

  offIncomingCall(listener: IncomingCallListener): void {
    this.incomingCallListeners.delete(listener);
  }

  getActiveCall(): CallSession | null {
    return this.activeCall;
  }

  private setupMediaConnectionHandlers(session: CallSessionImpl, mediaConnection: MediaConnection): void {
    mediaConnection.on('stream', (remoteStream: MediaStream) => {
      this.debugLog('MediaConnection', 'stream', { peer: mediaConnection.peer });
      session.setRemoteStream(remoteStream);
      session.setState('connected');
    });

    mediaConnection.on('close', () => {
      this.debugLog('MediaConnection', 'close', mediaConnection.peer);
      session.close();
      session.setState('ended', 'Connection closed');
    });

    mediaConnection.on('error', (err) => {
      this.debugLog('MediaConnection', 'error', { peer: mediaConnection.peer, error: err });
      session.close();
      session.setState('ended', err.message || 'Media error');
    });
  }

  private cleanupCall(session: CallSessionImpl): void {
    if (this.activeCall === session) {
      this.activeCall = null;
    }
  }

  private handleIncomingCall(mediaConnection: MediaConnection): void {
    this.debugLog('Peer', 'call', { from: mediaConnection.peer, metadata: mediaConnection.metadata });

    const metadata = mediaConnection.metadata as { video?: boolean; custom?: unknown } | undefined;
    const hasVideo = metadata?.video ?? false;

    const event: IncomingCallEvent = {
      from: mediaConnection.peer,
      hasVideo,
      metadata: metadata?.custom,

      answer: async () => {
        if (this.activeCall) {
          mediaConnection.close();
          throw new Error('Already in a call');
        }

        let localStream: MediaStream;
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: hasVideo
          });
        } catch (err) {
          mediaConnection.close();
          throw new Error(`Failed to get media: ${err instanceof Error ? err.message : err}`);
        }

        const session = new CallSessionImpl(
          mediaConnection.peer,
          mediaConnection,
          hasVideo,
          this.debugLog.bind(this),
          this.cleanupCall.bind(this)
        );
        session.setLocalStream(localStream);

        this.setupMediaConnectionHandlers(session, mediaConnection);

        this.activeCall = session;

        mediaConnection.answer(localStream);

        return session;
      },

      reject: () => {
        mediaConnection.close();
        this.debugLog('Call', 'rejected', mediaConnection.peer);
      }
    };

    this.incomingCallListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        this.debugLog('IncomingCallListener', 'error', err);
      }
    });
  }

  registerHandler(path: string, handler: SimpleHandler): void {
    this.simpleHandlers.set(path, handler);
  }

  unregisterHandler(path: string): void {
    this.simpleHandlers.delete(path);
  }

  destroy(): void {
    this.isDestroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.activeCall) {
      this.activeCall.hangUp();
      this.activeCall = null;
    }

    this.incomingCallListeners.clear();

    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Peer destroyed'));
    }
    this.pendingRequests.clear();
    this.simpleHandlers.clear();

    if (this.peerInstance) {
      this.peerInstance.destroy();
      this.peerInstance = null;
    }

    if (this.router) {
      this.router.persist();
      this.router.destroy();
    }
  }
}

export type {
  Request,
  Response,
  SimpleHandler,
  CallOptions,
  CallSession,
  CallState,
  CallStateListener,
  IncomingCallEvent,
  IncomingCallListener,
  RouteEntry,
  RelayConfig,
  RelayMessage
};
