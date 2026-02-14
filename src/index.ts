import { Peer, DataConnection, MediaConnection } from 'peerjs';
import type {
  Request,
  Response,
  SimpleHandler,
  CallOptions,
  CallSession,
  CallState,
  CallStateListener,
  IncomingCallEvent,
  IncomingCallListener
} from './types';

// 版本号（构建时注入）
declare const __VERSION__: string;
export const VERSION = __VERSION__;

// 打印版本号到控制台
console.log(`[sx-peerjs-http-util] v${VERSION}`);

// 内部消息格式
interface InternalMessage {
  type: 'request' | 'response';
  id: string;
  request?: Request;
  response?: Response;
}

/**
 * 服务器配置（PeerJS 信令服务器）
 */
export interface ServerConfig {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
}

/**
 * 生成 UUID v4
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * CallSessionImpl - 通话会话的内部实现
 */
class CallSessionImpl implements CallSession {
  readonly peerId: string;
  readonly hasVideo: boolean;

  private mediaConnection: MediaConnection;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private stateListeners = new Set<CallStateListener>();
  private debugLogFn: (obj: string, event: string, data?: unknown) => void;
  private onCleanup: (session: CallSessionImpl) => void;

  private _state: CallState = 'connecting';
  private isMuted = false;
  private isVideoEnabled = true;

  constructor(
    peerId: string,
    mediaConnection: MediaConnection,
    hasVideo: boolean,
    debugLog: (obj: string, event: string, data?: unknown) => void,
    onCleanup: (session: CallSessionImpl) => void
  ) {
    this.peerId = peerId;
    this.mediaConnection = mediaConnection;
    this.hasVideo = hasVideo;
    this.debugLogFn = debugLog;
    this.onCleanup = onCleanup;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  get state(): CallState {
    return this._state;
  }

  setState(state: CallState, reason?: string): void {
    this._state = state;
    this.notifyStateChange(state, reason);
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
  }

  setRemoteStream(stream: MediaStream): void {
    this.remoteStream = stream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  toggleMute(): boolean {
    if (!this.localStream) return this.isMuted;

    const audioTracks = this.localStream.getAudioTracks();
    for (const track of audioTracks) {
      track.enabled = this.isMuted; // 切换状态
    }
    this.isMuted = !this.isMuted;
    this.debugLogFn('CallSession', 'toggleMute', this.isMuted);
    return this.isMuted;
  }

  toggleVideo(): boolean {
    if (!this.hasVideo || !this.localStream) return this.isVideoEnabled;

    const videoTracks = this.localStream.getVideoTracks();
    for (const track of videoTracks) {
      track.enabled = !this.isVideoEnabled; // 切换状态
    }
    this.isVideoEnabled = !this.isVideoEnabled;
    this.debugLogFn('CallSession', 'toggleVideo', this.isVideoEnabled);
    return this.isVideoEnabled;
  }

  hangUp(): void {
    this.debugLogFn('CallSession', 'hangUp', this.peerId);
    this.mediaConnection.close();
  }

  close(): void {
    // 停止本地流
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
    this._state = 'ended';
  }

  onStateChange(listener: CallStateListener): void {
    this.stateListeners.add(listener);
  }

  offStateChange(listener: CallStateListener): void {
    this.stateListeners.delete(listener);
  }

  private notifyStateChange(state: CallState, reason?: string): void {
    this.debugLogFn('CallSession', 'stateChange', { peer: this.peerId, state, reason });
    this.stateListeners.forEach(listener => {
      try {
        listener(state, reason);
      } catch (err) {
        this.debugLogFn('CallSession', 'listenerError', err);
      }
    });

    // 通话结束时清理
    if (state === 'ended') {
      this.onCleanup(this);
    }
  }
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
  /**
   * 本地 Peer ID，构造时确定（传入或自动生成）
   */
  private myPeerId: string;

  /**
   * PeerJS 实例
   */
  private peerInstance: Peer | null = null;

  /**
   * 当前活跃的传入连接集合
   */
  private connections = new Set<DataConnection>();

  /**
   * 待处理的请求映射表（用于请求-响应匹配）
   */
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * 路径处理器映射表
   */
  private simpleHandlers = new Map<string, SimpleHandler>();

  /**
   * 重连定时器
   */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 是否已销毁
   */
  private isDestroyed = false;

  /**
   * 是否开启调试模式
   */
  private isDebug: boolean;

  /**
   * 服务器配置
   */
  private serverConfig?: ServerConfig;

  /**
   * 当前活跃的通话
   */
  private activeCall: CallSessionImpl | null = null;

  /**
   * 来电监听器集合
   */
  private incomingCallListeners = new Set<IncomingCallListener>();

  /**
   * 创建 PeerJsWrapper 实例
   * @param peerId 可选的 Peer ID，如果不提供则自动生成 UUID
   * @param isDebug 是否开启调试模式，开启后会打印事件日志
   * @param server 可选的信令服务器配置，不提供则使用 PeerJS 公共服务器
   */
  constructor(peerId?: string, isDebug?: boolean, server?: ServerConfig) {
    this.myPeerId = peerId || generateUUID();
    this.isDebug = isDebug ?? false;
    this.serverConfig = server;
    this.connect();
  }

  /**
   * 调试日志输出
   * @param obj 对象名
   * @param event 事件名
   * @param data 事件数据
   */
  private debugLog(obj: string, event: string, data?: unknown): void {
    if (this.isDebug) {
      const dataStr = data !== undefined ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : '';
      console.log(`${obj} ${event} ${dataStr}`);
    }
  }

  /**
   * 连接到 PeerJS 服务器
   */
  private connect(): void {
    if (this.isDestroyed) return;

    this.peerInstance = this.serverConfig
      ? new Peer(this.myPeerId, { ...this.serverConfig })
      : new Peer(this.myPeerId);

    this.setupPeerEventHandlers();
  }

  /**
   * 设置 Peer 实例的事件处理器
   */
  private setupPeerEventHandlers(): void {
    if (!this.peerInstance) return;

    this.peerInstance.on('open', (id) => {
      this.debugLog('Peer', 'open', id);
      // 清除重连定时器
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
      // 网络相关错误时尝试重连
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

    // 处理来电
    this.peerInstance.on('call', (mediaConnection: MediaConnection) => {
      this.handleIncomingCall(mediaConnection);
    });

    // 设置传入连接处理器
    this.setupIncomingConnectionHandler();
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) return; // 已有重连任务在等待

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, 1000);
  }

  /**
   * 执行重连
   */
  private reconnect(): void {
    if (this.isDestroyed) return;

    this.debugLog('PeerJsWrapper', 'reconnect');

    // 销毁旧实例
    if (this.peerInstance) {
      try {
        this.peerInstance.destroy();
      } catch {
        // 忽略销毁时的错误
      }
      this.peerInstance = null;
    }

    // 重新连接
    this.connect();
  }

  /**
   * 获取当前 Peer ID
   * @returns string 当前 Peer ID
   */
  getPeerId(): string {
    return this.myPeerId;
  }

  /**
   * 等待 Peer 连接就绪（连接到信令服务器）
   * @returns Promise<void> 当连接成功时 resolve
   */
  whenReady(): Promise<void> {
    return this.waitForReady();
  }

  /**
   * 等待 Peer 连接就绪
   */
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

  /**
   * 发送请求到指定 Peer
   * @param peerId 对端设备 ID
   * @param path 请求路径
   * @param data 请求数据
   * @returns Promise<unknown> 返回响应数据（自动拆箱，只返回 data 部分）
   */
  send(peerId: string, path: string, data?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.debugLog('PeerJsWrapper', 'send', { peerId, path, data });

      // 等待 peer 实例准备好
      this.waitForReady()
        .then(() => {
          if (!this.peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          // 每次发送消息时，都连接一个新的 conn
          const conn = this.peerInstance.connect(peerId, {
            reliable: true,
          });

          const timeout = setTimeout(() => {
            conn.close();
            this.pendingRequests.delete(requestId);
            reject(new Error(`Request timeout: ${peerId}${path}`));
          }, 30000);

          const requestId = `${this.myPeerId}-${Date.now()}-${Math.random()}`;
          this.pendingRequests.set(requestId, { resolve, reject, timeout });

          conn.on('open', () => {
            this.debugLog('Conn', 'open', peerId);
            const request: Request = { path, data };
            const message: InternalMessage = {
              type: 'request',
              id: requestId,
              request,
            };
            conn.send(message);
          });

          conn.on('data', (responseData: unknown) => {
            this.debugLog('Conn', 'data', { peer: peerId, data: responseData });
            const message = responseData as InternalMessage;
            if (message.type === 'response' && message.id === requestId) {
              const pending = this.pendingRequests.get(requestId);
              if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(requestId);

                const response = message.response!;
                // 校验状态码，非 2xx 则 reject
                if (response.status < 200 || response.status >= 300) {
                  pending.reject(
                    new Error(`Request failed: ${response.status} ${JSON.stringify(response.data)}`)
                  );
                } else {
                  // 自动拆箱：只返回 data 部分
                  pending.resolve(response.data);
                }
              }
              conn.close();
            }
          });

          conn.on('error', (err) => {
            this.debugLog('Conn', 'error', { peer: peerId, error: err });
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(requestId);
              pending.reject(err as Error);
            }
          });

          conn.on('close', () => {
            this.debugLog('Conn', 'close', peerId);
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(requestId);
              pending.reject(new Error('Connection closed'));
            }
          });
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * 设置传入连接处理器
   */
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
        const message = data as InternalMessage;

        if (message.type === 'request' && message.request) {
          try {
            const response = await this.handleRequest(conn.peer, message.request);

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
        this.debugLog('Conn', 'close', conn.peer);
        this.connections.delete(conn);
      });

      conn.on('error', (err) => {
        this.debugLog('Conn', 'error', { peer: conn.peer, error: err });
        this.connections.delete(conn);
      });
    });
  }

  // ============== 语音/视频通话相关方法 ==============

  /**
   * 发起语音/视频通话
   * @param peerId 对端设备 ID
   * @param options 通话选项
   * @returns Promise<CallSession> 通话会话对象
   */
  call(peerId: string, options?: CallOptions): Promise<CallSession> {
    return new Promise((resolve, reject) => {
      this.debugLog('PeerJsWrapper', 'call', { peerId, options });

      // 检查是否已有活跃通话
      if (this.activeCall) {
        reject(new Error('Already in a call'));
        return;
      }

      // 等待 peer 实例准备好
      this.waitForReady()
        .then(async () => {
          if (!this.peerInstance) {
            reject(new Error('Peer instance not available'));
            return;
          }

          const hasVideo = options?.video ?? false;

          // 获取本地媒体流
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

          // 创建 MediaConnection
          const mediaConnection = this.peerInstance.call(peerId, localStream, {
            metadata: {
              video: hasVideo,
              custom: options?.metadata
            }
          });

          // 创建通话会话
          const session = new CallSessionImpl(
            peerId,
            mediaConnection,
            hasVideo,
            this.debugLog.bind(this),
            this.cleanupCall.bind(this)
          );
          session.setLocalStream(localStream);

          // 设置 MediaConnection 事件处理
          this.setupMediaConnectionHandlers(session, mediaConnection);

          // 保存为活跃通话
          this.activeCall = session;

          // 设置超时（30秒无应答）
          const timeout = setTimeout(() => {
            if (!session.isConnected) {
              session.hangUp();
              reject(new Error('Call timeout - no answer'));
            }
          }, 30000);

          // 监听连接状态
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

  /**
   * 注册来电监听器
   * @param listener 来电回调函数
   */
  onIncomingCall(listener: IncomingCallListener): void {
    this.incomingCallListeners.add(listener);
  }

  /**
   * 移除来电监听器
   * @param listener 来电回调函数
   */
  offIncomingCall(listener: IncomingCallListener): void {
    this.incomingCallListeners.delete(listener);
  }

  /**
   * 获取当前活跃的通话
   * @returns CallSession | null 当前通话会话，无通话时返回 null
   */
  getActiveCall(): CallSession | null {
    return this.activeCall;
  }

  /**
   * 设置 MediaConnection 事件处理器
   */
  private setupMediaConnectionHandlers(
    session: CallSessionImpl,
    mediaConnection: MediaConnection
  ): void {
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

  /**
   * 清理通话资源
   */
  private cleanupCall(session: CallSessionImpl): void {
    if (this.activeCall === session) {
      this.activeCall = null;
    }
  }

  /**
   * 处理来电
   */
  private handleIncomingCall(mediaConnection: MediaConnection): void {
    this.debugLog('Peer', 'call', { from: mediaConnection.peer, metadata: mediaConnection.metadata });

    const metadata = mediaConnection.metadata as { video?: boolean; custom?: unknown } | undefined;
    const hasVideo = metadata?.video ?? false;

    // 创建来电事件对象
    const event: IncomingCallEvent = {
      from: mediaConnection.peer,
      hasVideo,
      metadata: metadata?.custom,

      answer: async () => {
        // 检查是否已有活跃通话
        if (this.activeCall) {
          mediaConnection.close();
          throw new Error('Already in a call');
        }

        // 获取本地媒体流
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

        // 接听
        mediaConnection.answer(localStream);

        // 创建通话会话
        const session = new CallSessionImpl(
          mediaConnection.peer,
          mediaConnection,
          hasVideo,
          this.debugLog.bind(this),
          this.cleanupCall.bind(this)
        );
        session.setLocalStream(localStream);

        // 设置事件处理
        this.setupMediaConnectionHandlers(session, mediaConnection);

        // 保存为活跃通话
        this.activeCall = session;

        return session;
      },

      reject: () => {
        mediaConnection.close();
        this.debugLog('Call', 'rejected', mediaConnection.peer);
      }
    };

    // 通知所有监听器
    this.incomingCallListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        this.debugLog('IncomingCallListener', 'error', err);
      }
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
   * @param from 发送者的 Peer ID
   * @param request 请求数据
   */
  private async handleRequest(from: string, request: Request): Promise<Response> {
    const simpleHandler = this.simpleHandlers.get(request.path);
    if (simpleHandler) {
      const data = await simpleHandler(from, request.data);
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
    this.isDestroyed = true;

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 挂断活跃通话
    if (this.activeCall) {
      this.activeCall.hangUp();
      this.activeCall = null;
    }

    // 清除来电监听器
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
  }
}

// 导出类型
export type {
  Request,
  Response,
  SimpleHandler,
  CallOptions,
  CallSession,
  CallState,
  CallStateListener,
  IncomingCallEvent,
  IncomingCallListener
};
