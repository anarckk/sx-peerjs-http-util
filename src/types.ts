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
