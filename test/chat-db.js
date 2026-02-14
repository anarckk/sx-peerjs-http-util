/**
 * chat-db.js - IndexedDB 数据库操作模块
 *
 * 存储结构：
 * - messages: 聊天消息（文本）
 * - contacts: 联系人列表
 * - files: 文件元信息
 * - file_chunks: 大文件分片数据
 */

const DB_NAME = 'p2p-chat-db';
const DB_VERSION = 2;
const MESSAGES_STORE = 'messages';
const CONTACTS_STORE = 'contacts';
const FILES_STORE = 'files';
const FILE_CHUNKS_STORE = 'file_chunks';

let db = null;

/**
 * 初始化数据库
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (e) => {
      const database = e.target.result;

      // 消息存储
      if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
        const msgStore = database.createObjectStore(MESSAGES_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        msgStore.createIndex('peerId', 'peerId', { unique: false });
        msgStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // 联系人存储
      if (!database.objectStoreNames.contains(CONTACTS_STORE)) {
        database.createObjectStore(CONTACTS_STORE, { keyPath: 'peerId' });
      }

      // 文件存储
      if (!database.objectStoreNames.contains(FILES_STORE)) {
        const fileStore = database.createObjectStore(FILES_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        fileStore.createIndex('peerId', 'peerId', { unique: false });
        fileStore.createIndex('fileId', 'fileId', { unique: false });
        fileStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // 文件分片存储
      if (!database.objectStoreNames.contains(FILE_CHUNKS_STORE)) {
        const chunkStore = database.createObjectStore(FILE_CHUNKS_STORE, {
          keyPath: ['fileId', 'index'],
        });
        chunkStore.createIndex('fileId', 'fileId', { unique: false });
      }
    };
  });
}

// ==================== 消息操作 ====================

/**
 * 保存文本消息
 */
export function saveMessage(peerId, text, isSent) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    const store = tx.objectStore(MESSAGES_STORE);
    const msg = { peerId, text, isSent, type: 'text', timestamp: Date.now() };
    store.add(msg);
    tx.oncomplete = () => resolve(msg);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 加载与某人的所有消息
 */
export function loadMessages(peerId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readonly');
    const store = tx.objectStore(MESSAGES_STORE);
    const index = store.index('peerId');
    const request = index.getAll(peerId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除与某人的所有消息
 */
export function deleteMessages(peerId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    const store = tx.objectStore(MESSAGES_STORE);
    const index = store.index('peerId');
    const request = index.openCursor(peerId);
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==================== 联系人操作 ====================

/**
 * 保存联系人
 */
export function saveContact(peerId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, 'readwrite');
    const store = tx.objectStore(CONTACTS_STORE);
    store.put({ peerId, addedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 加载所有联系人
 */
export function loadContacts() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, 'readonly');
    const store = tx.objectStore(CONTACTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除联系人
 */
export function deleteContact(peerId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTACTS_STORE, 'readwrite');
    const store = tx.objectStore(CONTACTS_STORE);
    store.delete(peerId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==================== 文件操作 ====================

/**
 * 保存文件（小文件直接存储）
 */
export function saveFile(peerId, fileData, isSent) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const record = {
      peerId,
      fileId: fileData.fileId,
      name: fileData.name,
      mimeType: fileData.mimeType,
      size: fileData.size,
      type: fileData.type, // 'image' | 'video' | 'file'
      data: fileData.data,
      isSent,
      timestamp: Date.now(),
    };
    store.add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 创建大文件记录（仅元信息，无数据）
 */
export function createFileRecord(peerId, fileData, isSent) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const record = {
      peerId,
      fileId: fileData.fileId,
      name: fileData.name,
      mimeType: fileData.mimeType,
      size: fileData.size,
      type: fileData.type,
      totalChunks: fileData.totalChunks,
      receivedChunks: 0,
      isSent,
      timestamp: Date.now(),
      data: null, // 完成后填充
    };
    store.add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 更新大文件的已接收分片数
 */
export function updateFileReceivedChunks(fileId, receivedChunks) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const index = store.index('fileId');
    const request = index.get(fileId);

    request.onsuccess = () => {
      const record = request.result;
      if (record) {
        record.receivedChunks = receivedChunks;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 完成大文件（合并分片并设置数据）
 */
export async function completeFile(fileId) {
  // 1. 获取所有分片
  const chunks = await getFileChunks(fileId);

  // 2. 按索引排序
  chunks.sort((a, b) => a.index - b.index);

  // 3. 合并分片
  const totalSize = chunks.reduce((sum, c) => sum + c.data.byteLength, 0);
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk.data), offset);
    offset += chunk.data.byteLength;
  }

  // 4. 更新文件记录
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const index = store.index('fileId');
    const request = index.get(fileId);

    request.onsuccess = () => {
      const record = request.result;
      if (record) {
        record.data = merged.buffer;
        record.receivedChunks = record.totalChunks;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 加载与某人的所有文件
 */
export function loadFiles(peerId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readonly');
    const store = tx.objectStore(FILES_STORE);
    const index = store.index('peerId');
    const request = index.getAll(peerId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除与某人的所有文件
 */
export async function deleteFiles(peerId) {
  // 1. 获取所有文件
  const files = await loadFiles(peerId);

  // 2. 删除所有相关分片
  for (const file of files) {
    await deleteFileChunks(file.fileId);
  }

  // 3. 删除文件记录
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const index = store.index('peerId');
    const request = index.openCursor(peerId);

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==================== 文件分片操作 ====================

/**
 * 保存文件分片
 */
export function saveFileChunk(fileId, index, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(FILE_CHUNKS_STORE);
    store.put({ fileId, index, data });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 获取文件的所有分片
 */
export function getFileChunks(fileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CHUNKS_STORE, 'readonly');
    const store = tx.objectStore(FILE_CHUNKS_STORE);
    const index = store.index('fileId');
    const request = index.getAll(fileId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除文件的所有分片
 */
export function deleteFileChunks(fileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(FILE_CHUNKS_STORE);
    const index = store.index('fileId');
    const request = index.openCursor(fileId);

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 加载所有消息和文件（按时间排序）
 */
export async function loadAllMessages(peerId) {
  const [messages, files] = await Promise.all([
    loadMessages(peerId),
    loadFiles(peerId),
  ]);

  const all = [...messages, ...files];
  all.sort((a, b) => a.timestamp - b.timestamp);
  return all;
}
