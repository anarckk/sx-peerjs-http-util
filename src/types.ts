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
 * 请求处理器函数类型（返回完整 Response）
 */
export type RequestHandler = (request: Request) => Promise<Response> | Response;

/**
 * 简化处理器函数类型（直接返回数据，自动装箱为 Response）
 */
export type SimpleHandler = (data?: unknown) => Promise<unknown> | unknown;

/**
 * 路由映射类型
 */
export type RouterMap = Record<string, RequestHandler>;
