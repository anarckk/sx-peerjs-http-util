/**
 * chat-file.js - 文件传输核心逻辑
 *
 * 功能：
 * - 小文件（<10MB）直接传输
 * - 大文件（>=10MB）分片传输
 * - 支持图片、视频、任意类型文件
 * - 边接收边存储，避免内存溢出
 * - 视频支持流式播放（MediaSource API）
 */

import * as db from './chat-db.js';

// 常量配置
const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB（超过此值走分片传输，避免超时）
const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB per chunk

// 传输状态管理
const transferState = {
  // 接收中的文件 { fileId -> { info, chunks, mediaSource, sourceBuffer } }
  receiving: new Map(),
  // 发送中的文件 { fileId -> { info, file, currentIndex } }
  sending: new Map(),
};

/**
 * 生成 UUID
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * 判断文件类型
 */
function getFileType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * 发送文件（自动判断大小选择传输方式）
 * @param {PeerJsWrapper} peer - PeerJS 实例
 * @param {string} peerId - 目标 Peer ID
 * @param {File} file - 文件对象
 * @param {Function} onProgress - 进度回调 (percent) => void
 * @returns {Promise<object>} - 文件记录
 */
export async function sendFile(peer, peerId, file, onProgress) {
  const fileId = generateId();
  const type = getFileType(file.type);
  const isSmall = file.size < SMALL_FILE_THRESHOLD;

  if (isSmall) {
    return sendSmallFile(peer, peerId, file, fileId, type, onProgress);
  } else {
    return sendLargeFile(peer, peerId, file, fileId, type, onProgress);
  }
}

/**
 * 发送小文件（直接传输）
 */
async function sendSmallFile(peer, peerId, file, fileId, type, onProgress) {
  const arrayBuffer = await file.arrayBuffer();

  onProgress?.(50);

  // 发送文件
  await peer.send(peerId, '/file', {
    fileId,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    type,
    data: arrayBuffer,
  });

  onProgress?.(100);

  // 保存到本地数据库
  const record = await db.saveFile(
    peerId,
    {
      fileId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      type,
      data: arrayBuffer,
    },
    true
  );

  return record;
}

/**
 * 发送大文件（分片传输）
 */
async function sendLargeFile(peer, peerId, file, fileId, type, onProgress) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 1. 发送开始请求
  await peer.send(peerId, '/file/start', {
    fileId,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    type,
    totalChunks,
    chunkSize: CHUNK_SIZE,
  });

  // 2. 逐片发送
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const arrayBuffer = await chunk.arrayBuffer();

    await peer.send(peerId, '/file/chunk', {
      fileId,
      index: i,
      data: arrayBuffer,
    });

    // 更新进度
    const percent = Math.round(((i + 1) / totalChunks) * 100);
    onProgress?.(percent);
  }

  // 3. 发送完成通知
  await peer.send(peerId, '/file/complete', { fileId });

  // 4. 保存到本地数据库（分片方式）
  // 读取整个文件用于本地存储
  const fullBuffer = await file.arrayBuffer();
  const record = await db.saveFile(
    peerId,
    {
      fileId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      type,
      data: fullBuffer,
    },
    true
  );

  return record;
}

/**
 * 注册文件接收处理器
 * @param {PeerJsWrapper} peer - PeerJS 实例
 * @param {Function} onFileReceived - 文件接收完成回调 (peerId, fileRecord) => void
 * @param {Function} onProgress - 进度回调 (fileId, peerId, percent) => void
 * @param {Function} onChunkReceived - 分片接收回调（用于流式播放）(fileId, peerId, chunkData, index, total) => void
 */
export function registerFileHandlers(
  peer,
  onFileReceived,
  onProgress,
  onChunkReceived
) {
  // 小文件处理器
  peer.registerHandler('/file', async (from, data) => {
    const { fileId, name, mimeType, size, type, data: arrayBuffer } = data;

    // 保存到数据库
    const record = await db.saveFile(
      from,
      { fileId, name, mimeType, size, type, data: arrayBuffer },
      false
    );

    // 回调通知
    onFileReceived?.(from, record);

    return { received: true, fileId };
  });

  // 大文件开始处理器
  peer.registerHandler('/file/start', async (from, data) => {
    const { fileId, name, mimeType, size, type, totalChunks, chunkSize } = data;

    // 创建文件记录（仅元信息）
    await db.createFileRecord(
      from,
      { fileId, name, mimeType, size, type, totalChunks },
      false
    );

    // 初始化接收状态
    transferState.receiving.set(fileId, {
      info: { fileId, name, mimeType, size, type, totalChunks },
      receivedCount: 0,
      mediaSource: null,
      sourceBuffer: null,
    });

    // 如果是视频，初始化 MediaSource
    if (type === 'video') {
      initMediaSource(fileId, mimeType);
    }

    return { started: true, fileId };
  });

  // 大文件分片处理器
  peer.registerHandler('/file/chunk', async (from, data) => {
    const { fileId, index, data: arrayBuffer } = data;

    // 获取接收状态
    const state = transferState.receiving.get(fileId);
    if (!state) {
      console.error('Unknown file chunk:', fileId, index);
      return { error: 'Unknown file' };
    }

    // 保存分片到数据库
    await db.saveFileChunk(fileId, index, arrayBuffer);

    // 更新状态
    state.receivedCount++;
    await db.updateFileReceivedChunks(fileId, state.receivedCount);

    // 计算进度
    const percent = Math.round((state.receivedCount / state.info.totalChunks) * 100);
    onProgress?.(fileId, from, percent);

    // 如果是视频，追加到 MediaSource
    if (state.info.type === 'video' && state.sourceBuffer) {
      appendToSourceBuffer(fileId, arrayBuffer);
    }

    // 分片接收回调
    onChunkReceived?.(fileId, from, arrayBuffer, index, state.info.totalChunks);

    return { received: true, fileId, index };
  });

  // 大文件完成处理器
  peer.registerHandler('/file/complete', async (from, data) => {
    const { fileId } = data;

    // 获取接收状态
    const state = transferState.receiving.get(fileId);
    if (!state) {
      console.error('Unknown file complete:', fileId);
      return { error: 'Unknown file' };
    }

    // 合并分片
    await db.completeFile(fileId);

    // 加载完整文件记录
    const files = await db.loadFiles(from);
    const record = files.find((f) => f.fileId === fileId);

    // 清理状态
    transferState.receiving.delete(fileId);

    // 如果是视频，结束 MediaSource
    if (state.info.type === 'video' && state.mediaSource) {
      endMediaSource(fileId);
    }

    // 回调通知
    if (record) {
      onFileReceived?.(from, record);
    }

    return { completed: true, fileId };
  });
}

/**
 * 初始化 MediaSource（用于视频流式播放）
 */
function initMediaSource(fileId, mimeType) {
  const state = transferState.receiving.get(fileId);
  if (!state) return;

  const mediaSource = new MediaSource();
  state.mediaSource = mediaSource;

  // 触发事件，让 UI 绑定 video 元素
  window.dispatchEvent(
    new CustomEvent('video-stream-ready', {
      detail: { fileId, mediaSource, mimeType },
    })
  );
}

/**
 * 追加数据到 SourceBuffer
 */
function appendToSourceBuffer(fileId, arrayBuffer) {
  const state = transferState.receiving.get(fileId);
  if (!state || !state.sourceBuffer) return;

  const sb = state.sourceBuffer;

  // 如果正在更新，等待更新完成
  if (sb.updating) {
    sb.addEventListener(
      'updateend',
      () => {
        try {
          sb.appendBuffer(arrayBuffer);
        } catch (e) {
          console.warn('appendBuffer error:', e);
        }
      },
      { once: true }
    );
  } else {
    try {
      sb.appendBuffer(arrayBuffer);
    } catch (e) {
      console.warn('appendBuffer error:', e);
    }
  }
}

/**
 * 结束 MediaSource
 */
function endMediaSource(fileId) {
  const state = transferState.receiving.get(fileId);
  if (!state || !state.mediaSource) return;

  const ms = state.mediaSource;
  if (ms.readyState === 'open') {
    try {
      ms.endOfStream();
    } catch (e) {
      console.warn('endOfStream error:', e);
    }
  }
}

/**
 * 为视频元素绑定 MediaSource
 * @param {HTMLVideoElement} videoElement - 视频元素
 * @param {string} fileId - 文件 ID
 * @param {MediaSource} mediaSource - MediaSource 实例
 * @param {string} mimeType - MIME 类型
 */
export function bindVideoStream(videoElement, fileId, mediaSource, mimeType) {
  const state = transferState.receiving.get(fileId);
  if (!state) return;

  videoElement.src = URL.createObjectURL(mediaSource);

  mediaSource.addEventListener('sourceopen', () => {
    try {
      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      state.sourceBuffer = sourceBuffer;
    } catch (e) {
      console.error('addSourceBuffer error:', e);
    }
  });
}

/**
 * 从 ArrayBuffer 创建可下载的 Blob URL
 */
export function createBlobUrl(data, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * 触发文件下载
 */
export function downloadFile(record) {
  const url = createBlobUrl(record.data, record.mimeType);
  const a = document.createElement('a');
  a.href = url;
  a.download = record.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 获取传输状态
 */
export function getTransferState() {
  return transferState;
}

// 导出常量
export const constants = {
  SMALL_FILE_THRESHOLD,
  CHUNK_SIZE,
};
