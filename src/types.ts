/**
 * 请求数据结构
 */
export interface Request {
  /** 请求路径 */
  path: string;
  /** 请求数据 */
  data?: unknown;
}

/**
 * 响应数据结构
 */
export interface Response {
  /** 响应状态码 */
  status: number;
  /** 响应数据 */
  data: unknown;
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
 * 路由表条目
 */
export interface RouteEntry {
  /** 目标节点 */
  target: string;
  /** 下一跳节点 */
  nextHop: string;
  /** 跳数 */
  hops: number;
  /** 通过哪个节点学到的 */
  via: string;
  /** 学习时间戳 */
  timestamp: number;
}

/**
 * 中继配置
 */
export interface RelayConfig {
  /** 最大中继节点数量（默认 5） */
  maxRelayNodes?: number;
}

/**
 * 中继消息格式
 */
export interface RelayMessage {
  /** 消息类型 */
  type: 'relay-request' | 'relay-response' | 'route-update';
  /** 消息 ID */
  id: string;
  /** 原始目标节点 */
  originalTarget: string;
  /** 已走过的中继路径 */
  relayPath: string[];
  /** 剩余可用转发节点列表 */
  forwardPath: string[];
  /** 请求数据 */
  request?: Request;
  /** 响应数据 */
  response?: Response;
  /** 路由更新信息 */
  routeUpdate?: {
    /** 可达节点列表 */
    reachableNodes: string[];
  };
}

/**
 * 简化处理器函数类型（直接返回数据，自动装箱为 Response）
 * @param from 发送者的 Peer ID
 * @param data 请求数据
 */
export type SimpleHandler = (from: string, data?: unknown) => Promise<unknown> | unknown;

// ============== 语音/视频通话相关类型 ==============

/**
 * 通话选项
 */
export interface CallOptions {
  /** 是否启用视频（默认 false） */
  video?: boolean;
  /** 自定义元数据 */
  metadata?: unknown;
}

/**
 * 通话状态
 */
export type CallState = 'connecting' | 'connected' | 'ended';

/**
 * 通话状态监听器
 */
export type CallStateListener = (state: CallState, reason?: string) => void;

/**
 * 通话会话接口
 */
export interface CallSession {
  /** 对端的 Peer ID */
  readonly peerId: string;
  /** 是否包含视频 */
  readonly hasVideo: boolean;
  /** 是否已连接 */
  readonly isConnected: boolean;

  /**
   * 获取本地媒体流（麦克风/摄像头）
   */
  getLocalStream(): MediaStream | null;

  /**
   * 获取远程媒体流（对方的音频/视频）
   */
  getRemoteStream(): MediaStream | null;

  /**
   * 切换静音状态
   * @returns 切换后的静音状态（true = 已静音）
   */
  toggleMute(): boolean;

  /**
   * 切换视频开关（仅视频通话有效）
   * @returns 切换后的视频状态（true = 视频开启）
   */
  toggleVideo(): boolean;

  /**
   * 挂断通话
   */
  hangUp(): void;

  /**
   * 注册通话状态变化监听器
   */
  onStateChange(listener: CallStateListener): void;

  /**
   * 移除通话状态变化监听器
   */
  offStateChange(listener: CallStateListener): void;
}

/**
 * 来电事件
 */
export interface IncomingCallEvent {
  /** 呼叫者的 Peer ID */
  readonly from: string;
  /** 是否包含视频 */
  readonly hasVideo: boolean;
  /** 呼叫者传递的元数据 */
  readonly metadata?: unknown;

  /**
   * 接听来电
   */
  answer(): Promise<CallSession>;

  /**
   * 拒绝来电
   */
  reject(): void;
}

/**
 * 来电监听器类型
 */
export type IncomingCallListener = (event: IncomingCallEvent) => void;
