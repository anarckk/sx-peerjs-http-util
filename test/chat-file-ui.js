/**
 * chat-file-ui.js - 文件传输 UI 组件
 *
 * 功能：
 * - 文件选择按钮
 * - 图片消息气泡（缩略图 + 预览）
 * - 视频消息气泡（支持流式播放）
 * - 文件消息气泡（图标 + 信息 + 下载）
 * - 传输进度条
 */

import { formatFileSize, downloadFile, createBlobUrl, getTransferState, bindVideoStream } from './chat-file.js';

// 图片缩略图最大尺寸
const THUMBNAIL_MAX_SIZE = 200;

// 传输进度管理
const progressManagers = new Map(); // fileId -> { element, percent }

/**
 * 创建文件选择按钮
 * @param {HTMLElement} container - 容器元素
 * @param {Function} onFileSelected - 文件选择回调 (files) => void
 * @returns {HTMLElement} - 按钮元素
 */
export function createFileButton(container, onFileSelected) {
  // 创建隐藏的 file input
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,video/*,*/*';
  input.style.display = 'none';
  container.appendChild(input);

  // 创建按钮
  const btn = document.createElement('button');
  btn.className = 'file-btn';
  btn.innerHTML = '📎';
  btn.title = 'Send file';
  btn.onclick = () => input.click();
  container.insertBefore(btn, container.firstChild); // 插入到输入框前面

  input.onchange = () => {
    if (input.files.length > 0) {
      onFileSelected(Array.from(input.files));
    }
    input.value = ''; // 重置以便重复选择同一文件
  };

  return btn;
}

/**
 * 渲染图片消息
 * @param {object} record - 文件记录
 * @returns {string} - HTML 字符串
 */
export function renderImageMessage(record) {
  const url = createBlobUrl(record.data, record.mimeType);
  const thumbnailUrl = url; // 暂时用原图作为缩略图

  return `
    <div class="file-message image-message" data-file-id="${record.fileId}">
      <img src="${thumbnailUrl}" alt="${escapeHtml(record.name)}"
           class="thumbnail" onclick="window.previewImage('${url}', '${escapeHtml(record.name)}')">
      <div class="file-info">
        <span class="file-name">${escapeHtml(record.name)}</span>
        <span class="file-size">${formatFileSize(record.size)}</span>
      </div>
    </div>
  `;
}

/**
 * 渲染视频消息（支持流式播放）
 * @param {object} record - 文件记录
 * @param {boolean} isReceiving - 是否正在接收中
 * @returns {string} - HTML 字符串
 */
export function renderVideoMessage(record, isReceiving = false) {
  const url = createBlobUrl(record.data, record.mimeType);

  return `
    <div class="file-message video-message" data-file-id="${record.fileId}">
      <video controls class="video-player" ${isReceiving ? 'data-streaming="true"' : ''}>
        <source src="${url}" type="${record.mimeType}">
        Your browser does not support the video tag.
      </video>
      <div class="file-info">
        <span class="file-name">${escapeHtml(record.name)}</span>
        <span class="file-size">${formatFileSize(record.size)}</span>
      </div>
    </div>
  `;
}

/**
 * 渲染普通文件消息
 * @param {object} record - 文件记录
 * @returns {string} - HTML 字符串
 */
export function renderFileMessage(record) {
  const icon = getFileIcon(record.mimeType);

  return `
    <div class="file-message" data-file-id="${record.fileId}">
      <div class="file-icon">${icon}</div>
      <div class="file-info">
        <span class="file-name">${escapeHtml(record.name)}</span>
        <span class="file-size">${formatFileSize(record.size)}</span>
      </div>
      <button class="download-btn" onclick="window.downloadFileById('${record.fileId}')">
        ⬇️
      </button>
    </div>
  `;
}

/**
 * 根据文件类型渲染消息
 * @param {object} record - 文件记录
 * @returns {string} - HTML 字符串
 */
export function renderFileBubble(record) {
  switch (record.type) {
    case 'image':
      return renderImageMessage(record);
    case 'video':
      return renderVideoMessage(record);
    default:
      return renderFileMessage(record);
  }
}

/**
 * 渲染传输进度条
 * @param {string} fileId - 文件 ID
 * @param {string} fileName - 文件名
 * @param {boolean} isSending - 是否是发送方
 * @returns {string} - HTML 字符串
 */
export function renderProgressBar(fileId, fileName, isSending) {
  return `
    <div class="progress-message" data-progress-id="${fileId}">
      <div class="progress-info">
        <span class="progress-label">${isSending ? '↑' : '↓'} ${escapeHtml(fileName)}</span>
        <span class="progress-percent">0%</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
    </div>
  `;
}

/**
 * 更新进度条
 * @param {string} fileId - 文件 ID
 * @param {number} percent - 进度百分比 (0-100)
 */
export function updateProgress(fileId, percent) {
  const container = document.querySelector(`[data-progress-id="${fileId}"]`);
  if (!container) return;

  const bar = container.querySelector('.progress-bar');
  const label = container.querySelector('.progress-percent');

  if (bar) bar.style.width = `${percent}%`;
  if (label) label.textContent = `${percent}%`;
}

/**
 * 移除进度条
 * @param {string} fileId - 文件 ID
 */
export function removeProgress(fileId) {
  const container = document.querySelector(`[data-progress-id="${fileId}"]`);
  if (container) container.remove();
}

/**
 * 获取文件图标
 */
function getFileIcon(mimeType) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '📦';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
  return '📁';
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 初始化图片预览功能
 */
export function initImagePreview() {
  // 创建预览遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'image-preview-overlay';
  overlay.className = 'preview-overlay';
  overlay.innerHTML = `
    <div class="preview-content">
      <img id="preview-image" src="" alt="Preview">
      <button class="preview-close" onclick="window.closeImagePreview()">×</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // 点击遮罩关闭
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeImagePreview();
    }
  };

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeImagePreview();
    }
  });

  // 全局函数
  window.previewImage = (url, name) => {
    const img = document.getElementById('preview-image');
    img.src = url;
    img.alt = name;
    overlay.style.display = 'flex';
  };

  window.closeImagePreview = () => {
    overlay.style.display = 'none';
  };
}

/**
 * 初始化视频流式播放
 */
export function initVideoStreaming() {
  // 监听视频流就绪事件
  window.addEventListener('video-stream-ready', (e) => {
    const { fileId, mediaSource, mimeType } = e.detail;

    // 找到对应的视频元素
    const videoElement = document.querySelector(
      `.video-message[data-file-id="${fileId}"] video`
    );

    if (videoElement) {
      bindVideoStream(videoElement, fileId, mediaSource, mimeType);
    }
  });
}

/**
 * 注入文件相关 CSS
 */
export function injectFileStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* 文件按钮 */
    .file-btn {
      padding: 12px;
      background: #f0f0f0;
      border: none;
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .file-btn:hover {
      background: #e0e0e0;
    }

    /* 文件消息容器 */
    .file-message {
      max-width: 280px;
      border-radius: 12px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.1);
    }

    /* 图片消息 */
    .image-message .thumbnail {
      max-width: 100%;
      max-height: ${THUMBNAIL_MAX_SIZE}px;
      cursor: pointer;
      display: block;
    }
    .image-message .file-info {
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.1);
    }

    /* 视频消息 */
    .video-message .video-player {
      max-width: 100%;
      max-height: 240px;
      display: block;
      background: #000;
    }
    .video-message .file-info {
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.1);
    }

    /* 普通文件消息 */
    .file-message:not(.image-message):not(.video-message) {
      display: flex;
      align-items: center;
      padding: 12px;
      gap: 10px;
      background: rgba(255, 255, 255, 0.15);
    }
    .file-icon {
      font-size: 32px;
    }
    .file-message .file-info {
      flex: 1;
      min-width: 0;
    }
    .file-name {
      display: block;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-size {
      display: block;
      font-size: 11px;
      opacity: 0.7;
    }
    .download-btn {
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      transition: background 0.2s;
    }
    .download-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* 进度条 */
    .progress-message {
      max-width: 280px;
      padding: 12px;
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.1);
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .progress-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      margin-right: 10px;
    }
    .progress-bar-container {
      height: 6px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: #4a90d9;
      transition: width 0.3s;
    }

    /* 图片预览遮罩 */
    .preview-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .preview-content {
      position: relative;
      max-width: 90%;
      max-height: 90%;
    }
    .preview-content img {
      max-width: 100%;
      max-height: 90vh;
    }
    .preview-close {
      position: absolute;
      top: -40px;
      right: 0;
      background: none;
      border: none;
      color: white;
      font-size: 36px;
      cursor: pointer;
      padding: 10px;
    }
    .preview-close:hover {
      opacity: 0.8;
    }

    /* 发送方文件消息样式 */
    .message.sent .file-message {
      background: rgba(255, 255, 255, 0.2);
    }
    .message.sent .download-btn {
      background: rgba(255, 255, 255, 0.3);
    }
    .message.sent .download-btn:hover {
      background: rgba(255, 255, 255, 0.4);
    }

    /* 接收方文件消息样式 */
    .message.received .file-message {
      background: rgba(0, 0, 0, 0.05);
    }
    .message.received .file-info {
      background: transparent;
    }
  `;
  document.head.appendChild(style);
}

/**
 * 初始化所有文件 UI 功能
 */
export function initFileUI() {
  injectFileStyles();
  initImagePreview();
  initVideoStreaming();
}
