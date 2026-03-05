/**
 * 常量定义
 * 集中管理所有魔法数字和配置值
 */

/** 连接超时（毫秒） */
export const CONNECTION_TIMEOUT_MS = 30000;

/** 发送超时（毫秒） */
export const SEND_TIMEOUT_MS = 10000;

/** 重连延迟（毫秒） */
export const RECONNECT_DELAY_MS = 1000;

/** 路由过期时间（毫秒） */
export const ROUTE_EXPIRE_AGE_MS = 5 * 60 * 1000;

/** 路由表容量限制 */
export const MAX_ROUTING_ENTRIES = 50;

/** 直连节点容量限制 */
export const MAX_DIRECT_NODES = 5;

/** 路由清理周期（毫秒） */
export const ROUTE_CLEANUP_INTERVAL_MS = 60 * 1000;

/** 路由广播周期（毫秒） */
export const ROUTE_BROADCAST_INTERVAL_MS = 30 * 1000;

/** 默认 TTL（Time To Live）- 消息最大跳数 */
export const DEFAULT_TTL = 128;
