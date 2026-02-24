/**
 * MessageHandler - 消息处理模块
 * 
 * 负责处理接收到的各类消息：
 * - 直连请求（request）
 * - 中继请求（relay-request）
 * - 路由更新（route-update）
 * 
 * 中继请求处理流程：
 * 1. 收到 relay-request 消息
 * 2. 如果是目标节点，处理请求并返回响应
 * 3. 如果不是目标节点，根据 forwardPath 转发到下一个节点
 * 4. 如果 forwardPath 为空，尝试直连到目标节点
 * 
 * @example
 * const handler = new MessageHandler(callbacks);
 * const response = await handler.handleRequest(from, request, relayMessage);
 */

import type { Peer } from 'peerjs';
import type { Request, Response, SimpleHandler, RelayMessage } from './types';

/**
 * 消息处理器回调接口
 */
export interface MessageHandlerCallbacks {
  /** 获取本地 Peer ID */
  getMyPeerId(): string;
  /** 获取 PeerJS 实例 */
  getPeerInstance(): Peer | null;
  /** 等待连接就绪 */
  waitForReady(): Promise<void>;
  /** 获取处理器映射表 */
  getSimpleHandlers(): Map<string, SimpleHandler>;
  /** 调试日志函数 */
  debugLog: (obj: string, event: string, data?: unknown) => void;
  /** 路由更新回调（可选） */
  onRouteUpdate?: (fromPeerId: string, message: RelayMessage) => void;
}

/**
 * 消息处理器类
 * 负责解析和处理接收到的各类消息
 */
export class MessageHandler {
  /** 回调函数集合 */
  private callbacks: MessageHandlerCallbacks;

  /**
   * 创建消息处理器
   * @param callbacks 回调函数集合
   */
  constructor(callbacks: MessageHandlerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * 处理收到的请求
   * 根据是否有中继消息上下文判断是直连请求还是中继请求
   * @param from 发送者 Peer ID
   * @param request 请求数据
   * @param relayMessage 中继消息上下文（可选，有则为中继请求）
   * @returns 响应数据
   */
  async handleRequest(from: string, request: Request, relayMessage?: RelayMessage): Promise<Response> {
    if (relayMessage) {
      return this.handleRelayRequest(from, request, relayMessage);
    }
    return this.handleDirectRequest(from, request);
  }

  /**
   * 处理直连请求
   * @param from 发送者 Peer ID
   * @param request 请求数据
   * @returns 响应数据
   */
  private async handleDirectRequest(from: string, request: Request): Promise<Response> {
    const result = await this.processHandler(request.path, from, request.data);
    if (this.isErrorResponse(result)) {
      return result as Response;
    }
    return { status: 200, data: result };
  }

  /**
   * 处理中继请求
   * @param from 发送者 Peer ID
   * @param request 请求数据
   * @param relayMessage 中继消息上下文
   * @returns 响应数据
   */
  private async handleRelayRequest(from: string, request: Request, relayMessage: RelayMessage): Promise<Response> {
    const myPeerId = this.callbacks.getMyPeerId();
    const { originalTarget, relayPath, forwardPath } = relayMessage;

    // 如果我是目标节点，处理请求
    if (myPeerId === originalTarget) {
      const result = await this.processHandler(request.path, from, request.data);
      if (this.isErrorResponse(result)) {
        return result as Response;
      }
      return { status: 200, data: result };
    }

    // 如果还有下一跳，转发到下一个节点
    if (forwardPath.length > 0) {
      const nextHop = forwardPath[0];
      const remainingPath = forwardPath.slice(1);
      
      try {
        const response = await this.forwardRelay(nextHop, {
          type: 'relay-request',
          id: relayMessage.id,
          originalTarget,
          relayPath: [...relayPath, myPeerId],
          forwardPath: remainingPath,
          request,
        });
        return response;
      } catch (err) {
        return {
          status: 500,
          data: { error: `Forward failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
        };
      }
    }

    // 如果没有更多跳数，尝试直连到目标节点
    try {
      const data = await this.forwardToTarget(originalTarget, request, relayMessage);
      return { status: 200, data };
    } catch (err) {
      return {
        status: 500,
        data: { error: `Forward to target failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      };
    }
  }

  /**
   * 调用注册的处理器
   * @param path 请求路径
   * @param from 发送者 Peer ID
   * @param data 请求数据
   * @returns 处理器返回的数据，或 404 错误
   */
  async processHandler(path: string, from: string, data?: unknown): Promise<unknown> {
    const handlers = this.callbacks.getSimpleHandlers();
    const simpleHandler = handlers.get(path);
    if (simpleHandler) {
      return await simpleHandler(from, data);
    }
    // 返回 404 错误响应格式
    return { status: 404, data: { error: `Path not found: ${path}` } };
  }

  /**
   * 判断结果是否为错误响应
   */
  private isErrorResponse(result: unknown): result is { status: number; data: unknown } {
    return typeof result === 'object' && result !== null && 'status' in result && 'data' in result;
  }

  /**
   * 转发中继请求到下一个节点
   * @param nextHop 下一跳节点 ID
   * @param message 要转发的消息
   * @returns 响应数据
   */
  private async forwardRelay(nextHop: string, message: RelayMessage): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.callbacks.debugLog('MessageHandler', 'forwardRelay', { nextHop });

      this.callbacks.waitForReady()
        .then(() => {
          const peerInstance = this.callbacks.getPeerInstance();
          if (!peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          const conn = peerInstance.connect(nextHop, { reliable: true });

          const timeout = setTimeout(() => {
            conn.close();
            reject(new Error(`Forward timeout: ${nextHop}`));
          }, 30000);

          conn.on('open', () => {
            this.callbacks.debugLog('Conn', 'open', nextHop);
            conn.send(message);
          });

          conn.on('data', (responseData: unknown) => {
            const response = responseData as RelayMessage;
            if (response.type === 'relay-response') {
              clearTimeout(timeout);
              conn.close();

              if (response.response) {
                resolve(response.response);
              } else {
                reject(new Error('Invalid relay response'));
              }
            }
          });

          conn.on('error', (err) => {
            this.callbacks.debugLog('Conn', 'error', { peer: nextHop, error: err });
            clearTimeout(timeout);
            reject(err);
          });

          conn.on('close', () => {
            this.callbacks.debugLog('Conn', 'close', nextHop);
            clearTimeout(timeout);
            reject(new Error('Forward connection closed'));
          });
        })
        .catch(reject);
    });
  }

  /**
   * 转发到最终目标节点（当没有更多中继节点时使用）
   * @param targetId 目标节点 ID
   * @param request 请求数据
   * @param originalMessage 原始中继消息
   * @returns 响应数据
   */
  private async forwardToTarget(targetId: string, request: Request, originalMessage: RelayMessage): Promise<unknown> {
    const myPeerId = this.callbacks.getMyPeerId();
    
    return new Promise((resolve, reject) => {
      this.callbacks.debugLog('MessageHandler', 'forwardToTarget', { targetId });

      this.callbacks.waitForReady()
        .then(() => {
          const peerInstance = this.callbacks.getPeerInstance();
          if (!peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          const conn = peerInstance.connect(targetId, { reliable: true });

          const timeout = setTimeout(() => {
            conn.close();
            reject(new Error(`Forward to target timeout: ${targetId}`));
          }, 30000);

          conn.on('open', () => {
            this.callbacks.debugLog('Conn', 'open', targetId);

            const message: RelayMessage = {
              type: 'relay-request',
              id: originalMessage.id,
              originalTarget: originalMessage.originalTarget,
              relayPath: [...originalMessage.relayPath, myPeerId],
              forwardPath: [],
              request,
            };
            conn.send(message);
          });

          conn.on('data', (responseData: unknown) => {
            const response = responseData as RelayMessage;
            if (response.type === 'relay-response') {
              clearTimeout(timeout);
              conn.close();

              if (response.response) {
                resolve(response.response.data);
              } else {
                reject(new Error('Invalid relay response'));
              }
            }
          });

          conn.on('error', (err) => {
            this.callbacks.debugLog('Conn', 'error', { peer: targetId, error: err });
            clearTimeout(timeout);
            reject(err);
          });

          conn.on('close', () => {
            this.callbacks.debugLog('Conn', 'close', targetId);
            clearTimeout(timeout);
            reject(new Error('Forward connection closed'));
          });
        })
        .catch(reject);
    });
  }
}
