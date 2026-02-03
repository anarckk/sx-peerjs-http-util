/**
 * 请求数据结构
 */
export interface Request {
  /** 请求方法 */
  method?: string;
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
 * PeerJS HTTP 请求选项
 */
export interface RequestOptions {
  /** 对端设备的 Peer ID */
  peerId: string;
  /** 请求数据 */
  request: Request;
}

/**
 * PeerJS HTTP 服务端选项
 */
export interface ServerOptions {
  /** PeerJS 实例 */
  peer: any; // Peer 实际上是 peerjs 导出的类型
}

/**
 * 请求处理器函数类型
 */
export type RequestHandler = (request: Request) => Promise<Response> | Response;

/**
 * 连接事件数据
 */
export interface ConnectionData {
  /** 发送请求 */
  send: (request: Request) => Promise<Response>;
  /** 关闭连接 */
  close: () => void;
}
