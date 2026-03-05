/**
 * RoutingDB.ts - 路由表 IndexedDB 持久化模块
 *
 * 提供路由表的持久化存储功能，使用 IndexedDB 而非 localStorage
 * 以支持大规模路由表存储
 *
 * 数据库结构：
 * - peerjs-routing-db (版本 1)
 *   - routing-table: 路由表条目 (keyPath: target)
 *   - direct-nodes: 直连节点 (keyPath: nodeId)
 */

import type { RouteEntry, DirectNodeLatency } from './types';
import { ROUTE_EXPIRE_AGE_MS } from './constants';

const DB_NAME = 'peerjs-routing-db';
const DB_VERSION = 1;
const ROUTING_TABLE_STORE = 'routing-table';
const DIRECT_NODES_STORE = 'direct-nodes';

let db: IDBDatabase | null = null;

/**
 * 创建通用的 Object Store 操作
 * @param storeName Object Store 名称
 * @param mode 事务模式
 * @param operation 要执行的操作
 * @returns Promise<T>
 */
function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest | void
): Promise<T> {
  return openDB().then(database => {
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = operation(store) as IDBRequest;
      
      if (request) {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      } else {
        tx.oncomplete = () => resolve(undefined as T);
        tx.onerror = () => reject(tx.error);
      }
    });
  });
}

/**
 * 打开数据库连接
 * @returns Promise<IDBDatabase>
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const req = e.target as IDBOpenDBRequest;
      const database = req.result;

      if (!database.objectStoreNames.contains(ROUTING_TABLE_STORE)) {
        const routingStore = database.createObjectStore(ROUTING_TABLE_STORE, {
          keyPath: 'target',
        });
        routingStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!database.objectStoreNames.contains(DIRECT_NODES_STORE)) {
        const nodesStore = database.createObjectStore(DIRECT_NODES_STORE, {
          keyPath: 'nodeId',
        });
        nodesStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * 初始化数据库
 * @returns Promise<void>
 */
export async function initRoutingDB(): Promise<void> {
  await openDB();
}

/**
 * 保存路由表条目
 * @param entry 路由表条目
 */
export async function saveRouteEntry(entry: RouteEntry): Promise<void> {
  await withStore(ROUTING_TABLE_STORE, 'readwrite', store => store.put(entry));
}

/**
 * 批量保存路由表条目
 * @param entries 路由表条目数组
 */
export async function saveRouteEntries(entries: RouteEntry[]): Promise<void> {
  await openDB().then(database => {
    return new Promise<void>((resolve, reject) => {
      const tx = database.transaction(ROUTING_TABLE_STORE, 'readwrite');
      const store = tx.objectStore(ROUTING_TABLE_STORE);

      for (const entry of entries) {
        store.put(entry);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

/**
 * 删除路由表条目
 * @param target 目标节点 ID
 */
export async function deleteRouteEntry(target: string): Promise<void> {
  await withStore(ROUTING_TABLE_STORE, 'readwrite', store => store.delete(target));
}

/**
 * 加载全部路由表
 * @returns Promise<RouteEntry[]>
 */
export async function loadRoutingTable(): Promise<RouteEntry[]> {
  return withStore<RouteEntry[]>(ROUTING_TABLE_STORE, 'readonly', store => store.getAll());
}

/**
 * 清理过期路由表条目
 * @param maxAgeMs 最大保留时间（毫秒），默认 5 分钟
 * @returns Promise<number> 删除的条目数量
 */
export async function cleanupExpiredRoutes(maxAgeMs: number = ROUTE_EXPIRE_AGE_MS): Promise<number> {
  const database = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(ROUTING_TABLE_STORE, 'readwrite');
    const store = tx.objectStore(ROUTING_TABLE_STORE);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(now - maxAgeMs);
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve(deletedCount);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 保存直连节点
 * @param node 直连节点
 */
export async function saveDirectNode(node: DirectNodeLatency): Promise<void> {
  await withStore(DIRECT_NODES_STORE, 'readwrite', store => store.put(node));
}

/**
 * 批量保存直连节点
 * @param nodes 直连节点数组
 */
export async function saveDirectNodes(nodes: DirectNodeLatency[]): Promise<void> {
  await openDB().then(database => {
    return new Promise<void>((resolve, reject) => {
      const tx = database.transaction(DIRECT_NODES_STORE, 'readwrite');
      const store = tx.objectStore(DIRECT_NODES_STORE);

      for (const node of nodes) {
        store.put(node);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

/**
 * 加载全部直连节点
 * @returns Promise<DirectNodeLatency[]>
 */
export async function loadDirectNodes(): Promise<DirectNodeLatency[]> {
  return withStore<DirectNodeLatency[]>(DIRECT_NODES_STORE, 'readonly', store => store.getAll());
}

/**
 * 删除直连节点
 * @param nodeId 节点 ID
 */
export async function deleteDirectNode(nodeId: string): Promise<void> {
  await withStore(DIRECT_NODES_STORE, 'readwrite', store => store.delete(nodeId));
}

/**
 * 清理过期直连节点
 * @param maxAgeMs 最大保留时间（毫秒），默认 5 分钟
 * @returns Promise<number> 删除的节点数量
 */
export async function cleanupExpiredNodes(maxAgeMs: number = ROUTE_EXPIRE_AGE_MS): Promise<number> {
  const database = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(DIRECT_NODES_STORE, 'readwrite');
    const store = tx.objectStore(DIRECT_NODES_STORE);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(now - maxAgeMs);
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve(deletedCount);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 清除全部路由数据
 * @returns Promise<void>
 */
export async function clearAllRoutingData(): Promise<void> {
  const database = await openDB();

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ROUTING_TABLE_STORE, 'readwrite');
    const store = tx.objectStore(ROUTING_TABLE_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(DIRECT_NODES_STORE, 'readwrite');
    const store = tx.objectStore(DIRECT_NODES_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
