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
 */
export type SimpleHandler = (data?: unknown) => Promise<unknown> | unknown;
