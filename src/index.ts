import { Peer, DataConnection } from 'peerjs';
import type { Request, Response, SimpleHandler } from './types';

// 内部消息格式
interface InternalMessage {
  type: 'request' | 'response';
  id: string;
  request?: Request;
  response?: Response;
}

/**
 * PeerJsWrapper - 封装 PeerJS 为类似 HTTP 的 API
 *
 * @example
 * ```js
 * const wrapper = new PeerJsWrapper();
 * const data = await wrapper.send(peerId, '/api/hello', { name: 'world' });
 * console.log(data); // 直接输出响应数据
 *
 * // 服务端注册处理器
 * wrapper.registerHandler('/api/hello', (data) => {
 *   return { message: 'hello' }; // 直接返回数据
 * });
 * ```
 */
export class PeerJsWrapper {
  private peerInstance: Peer;
  private connections = new Set<DataConnection>();
  private pendingRequests = new Map<string, {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  /**
   * 处理传入请求
   */
  private simpleHandlers = new Map<string, SimpleHandler>();

  /**
   * 创建 PeerJsWrapper 实例
   * @param peerId 可选的 Peer ID，如果不提供则由 PeerJS 服务器自动生成
   */
  constructor(peerId?: string) {
    this.peerInstance = peerId ? new Peer(peerId) : new Peer();
    this.setupIncomingConnectionHandler();
  }

  /**
   * 获取当前 Peer ID
   * @returns Promise<string> 当 Peer 准备好时返回 Peer ID
   */
  getPeerId(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.peerInstance.id) {
        resolve(this.peerInstance.id);
      } else {
        this.peerInstance.on('open', (id) => resolve(id));
        this.peerInstance.on('error', (err) => reject(err));
      }
    });
  }

  /**
   * 发送请求到指定 Peer
   * @param peerId 对端设备 ID
   * @param path 请求路径
   * @param data 请求数据
   * @returns Promise<unknown> 返回响应数据（自动拆箱，只返回 data 部分）
   */
  send(peerId: string, path: string, data?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // 等待 peer 实例准备好
      this.getPeerId().then(() => {
        // 每次发送消息时，都连接一个新的 conn
        const conn = this.peerInstance.connect(peerId, {
          reliable: true,
        });

        const timeout = setTimeout(() => {
          conn.close();
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${peerId}${path}`));
        }, 30000);

        const requestId = `${this.peerInstance.id}-${Date.now()}-${Math.random()}`;
        this.pendingRequests.set(requestId, { resolve, reject, timeout });

        conn.on('open', () => {
          const request: Request = { path, data };
          const message: InternalMessage = {
            type: 'request',
            id: requestId,
            request,
          };
          conn.send(message);
        });

        conn.on('data', (data: unknown) => {
          const message = data as InternalMessage;
          if (message.type === 'response' && message.id === requestId) {
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(requestId);

              const response = message.response!;
              // 校验状态码，非 2xx 则 reject
              if (response.status < 200 || response.status >= 300) {
                pending.reject(new Error(`Request failed: ${response.status} ${JSON.stringify(response.data)}`));
              } else {
                // 自动拆箱：只返回 data 部分
                pending.resolve(response.data);
              }
            }
            conn.close();
          }
        });

        conn.on('error', (err) => {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.reject(err as Error);
          }
        });

        conn.on('close', () => {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(requestId);
            pending.reject(new Error('Connection closed'));
          }
        });
      }).catch((err) => {
        reject(err);
      });
    });
  }

  /**
   * 设置传入连接处理器
   */
  private setupIncomingConnectionHandler(): void {
    this.peerInstance.on('connection', (conn: DataConnection) => {
      this.connections.add(conn);

      conn.on('data', async (data: unknown) => {
        const message = data as InternalMessage;

        if (message.type === 'request' && message.request) {
          try {
            const response = await this.handleRequest(message.request);

            const responseMessage: InternalMessage = {
              type: 'response',
              id: message.id,
              response,
            };

            conn.send(responseMessage);
          } catch (error) {
            const errorResponse: InternalMessage = {
              type: 'response',
              id: message.id,
              response: {
                status: 500,
                data: { error: error instanceof Error ? error.message : 'Unknown error' },
              },
            };

            conn.send(errorResponse);
          }
        }
      });

      conn.on('close', () => {
        this.connections.delete(conn);
      });

      conn.on('error', () => {
        this.connections.delete(conn);
      });
    });
  }

  /**
   * 注册简化处理器（直接返回数据，自动装箱）
   * @param path 请求路径
   * @param handler 处理器函数，接收请求数据，直接返回响应数据
   */
  registerHandler(path: string, handler: SimpleHandler): void {
    this.simpleHandlers.set(path, handler);
  }

  /**
   * 注销简化处理器
   * @param path 请求路径
   */
  unregisterHandler(path: string): void {
    this.simpleHandlers.delete(path);
  }

  /**
   * 内部请求处理方法
   */
  private async handleRequest(request: Request): Promise<Response> {
    const simpleHandler = this.simpleHandlers.get(request.path);
    if (simpleHandler) {
      const data = await simpleHandler(request.data);
      // 自动装箱：将返回的数据包装成 Response
      return { status: 200, data };
    }

    // 没有找到匹配的处理器
    return {
      status: 404,
      data: { error: `Path not found: ${request.path}` },
    };
  }

  /**
   * 关闭所有连接并销毁 Peer 实例
   */
  destroy(): void {
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

    this.peerInstance.destroy();
  }
}

// 导出类型
export type { Request, Response, SimpleHandler };
