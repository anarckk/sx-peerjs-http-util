/**
 * chat.js - P2P Chat 主逻辑
 *
 * 功能：
 * - 初始化 Peer 连接
 * - 联系人管理
 * - 消息收发
 * - 文件传输集成
 */

import * as db from './chat-db.js';
import { sendFile, registerFileHandlers, downloadFile } from './chat-file.js';
import {
  createFileButton,
  renderFileBubble,
  renderProgressBar,
  updateProgress,
  removeProgress,
  initFileUI,
} from './chat-file-ui.js';

// 应用状态
let peer = null;
let currentPeerId = null;
let contacts = [];
let fileRecords = new Map(); // fileId -> record

// DOM 元素引用
let myPeerIdEl = null;
let statusEl = null;
let contactListEl = null;
let chatAreaEl = null;
let newPeerIdInput = null;

// localStorage key
const PEER_ID_KEY = 'p2p-chat-peer-id';

/**
 * 获取或创建持久化的 Peer ID
 */
function getOrCreatePeerId() {
  let peerId = localStorage.getItem(PEER_ID_KEY);
  if (!peerId) {
    peerId = crypto.randomUUID();
    localStorage.setItem(PEER_ID_KEY, peerId);
  }
  return peerId;
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
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
 * 渲染联系人列表
 */
function renderContacts() {
  contactListEl.innerHTML = contacts
    .map(
      (c) => `
    <div class="contact-item${c.peerId === currentPeerId ? ' active' : ''}" data-peer="${c.peerId}">
      <span class="peer-id">${c.peerId.substring(0, 8)}...</span>
      <span class="delete-btn" data-delete="${c.peerId}">×</span>
    </div>
  `
    )
    .join('');

  // 绑定点击事件
  contactListEl.querySelectorAll('.contact-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return;
      selectContact(el.dataset.peer);
    });
  });

  // 绑定删除事件
  contactListEl.querySelectorAll('.delete-btn').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const peerId = el.dataset.delete;
      if (confirm(`Delete chat with ${peerId.substring(0, 8)}...?`)) {
        await db.deleteContact(peerId);
        await db.deleteMessages(peerId);
        await db.deleteFiles(peerId);
        contacts = contacts.filter((c) => c.peerId !== peerId);
        fileRecords.forEach((record, fileId) => {
          if (record.peerId === peerId) fileRecords.delete(fileId);
        });
        if (currentPeerId === peerId) currentPeerId = null;
        renderContacts();
        renderChatArea();
      }
    });
  });
}

/**
 * 选择联系人
 */
async function selectContact(peerId) {
  currentPeerId = peerId;
  renderContacts();
  await renderChatArea();
}

/**
 * 渲染消息气泡
 */
function renderMessageBubble(msg) {
  const isSent = msg.isSent;
  const isFile = msg.type !== 'text' && msg.type !== undefined;

  let bubbleContent;
  if (isFile) {
    bubbleContent = renderFileBubble(msg);
  } else {
    bubbleContent = `<div class="bubble">${escapeHtml(msg.text)}</div>`;
  }

  return `
    <div class="message ${isSent ? 'sent' : 'received'}" data-msg-id="${msg.id || msg.fileId}">
      <div>
        ${bubbleContent}
        <div class="time">${formatTime(msg.timestamp)}</div>
      </div>
    </div>
  `;
}

/**
 * 渲染聊天区域
 */
async function renderChatArea() {
  if (!currentPeerId) {
    chatAreaEl.innerHTML =
      '<div class="empty-state">Select a contact to start chatting</div>';
    return;
  }

  // 加载所有消息（文本 + 文件）
  const messages = await db.loadAllMessages(currentPeerId);

  // 缓存文件记录
  messages.forEach((msg) => {
    if (msg.fileId) {
      fileRecords.set(msg.fileId, msg);
    }
  });

  chatAreaEl.innerHTML = `
    <div class="chat-header">Chat with: <span>${currentPeerId}</span></div>
    <div class="messages" id="messagesContainer">
      ${messages.map((m) => renderMessageBubble(m)).join('')}
    </div>
    <div class="input-area" id="inputArea">
      <input type="text" id="messageInput" placeholder="Type a message...">
      <button id="sendBtn">Send</button>
    </div>
  `;

  // 滚动到底部
  const container = document.getElementById('messagesContainer');
  container.scrollTop = container.scrollHeight;

  // 添加文件选择按钮
  const inputArea = document.getElementById('inputArea');
  createFileButton(inputArea, handleFileSelected);

  // 绑定发送事件
  const input = document.getElementById('messageInput');
  const btn = document.getElementById('sendBtn');

  btn.addEventListener('click', () => sendMessage(input, btn));
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage(input, btn);
  });
}

/**
 * 发送文本消息
 */
async function sendMessage(input, btn) {
  const text = input.value.trim();
  if (!text || !currentPeerId) return;

  btn.disabled = true;
  input.value = '';

  try {
    // 保存到本地
    const msg = await db.saveMessage(currentPeerId, text, true);

    // 发送到对端
    await peer.send(currentPeerId, '/chat', { text });

    // 更新UI
    appendMessage(msg);
  } catch (err) {
    alert('Failed to send: ' + err.message);
    input.value = text; // 恢复输入
  }

  btn.disabled = false;
  input.focus();
}

/**
 * 处理文件选择
 */
async function handleFileSelected(files) {
  if (!currentPeerId) {
    alert('Please select a contact first');
    return;
  }

  for (const file of files) {
    await sendFileToPeer(file);
  }
}

/**
 * 发送文件到当前联系人
 */
async function sendFileToPeer(file) {
  const container = document.getElementById('messagesContainer');

  // 先显示进度条
  const progressHtml = renderProgressBar(crypto.randomUUID(), file.name, true);
  const progressDiv = document.createElement('div');
  progressDiv.innerHTML = progressHtml;
  progressDiv.className = 'message sent';
  container.appendChild(progressDiv);
  container.scrollTop = container.scrollHeight;

  // 获取进度条 ID
  const progressId = progressDiv.querySelector('[data-progress-id]').dataset.progressId;

  try {
    // 发送文件
    const record = await sendFile(peer, currentPeerId, file, (percent) => {
      updateProgress(progressId, percent);
    });

    // 移除进度条
    removeProgress(progressId);
    progressDiv.remove();

    // 缓存文件记录
    fileRecords.set(record.fileId, record);

    // 显示文件消息
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message sent';
    msgDiv.innerHTML = `
      <div>
        ${renderFileBubble(record)}
        <div class="time">${formatTime(record.timestamp)}</div>
      </div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    removeProgress(progressId);
    progressDiv.remove();
    alert('Failed to send file: ' + err.message);
  }
}

/**
 * 追加消息到 UI
 */
function appendMessage(msg) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  // 检查是否是当前聊天的消息
  if (msg.peerId !== currentPeerId) return;

  const div = document.createElement('div');
  div.className = `message ${msg.isSent ? 'sent' : 'received'}`;
  div.innerHTML = `
    <div>
      <div class="bubble">${escapeHtml(msg.text)}</div>
      <div class="time">${formatTime(msg.timestamp)}</div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/**
 * 追加文件消息到 UI
 */
function appendFileMessage(record) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  // 检查是否是当前聊天的消息
  if (record.peerId !== currentPeerId) return;

  const div = document.createElement('div');
  div.className = `message ${record.isSent ? 'sent' : 'received'}`;
  div.innerHTML = `
    <div>
      ${renderFileBubble(record)}
      <div class="time">${formatTime(record.timestamp)}</div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/**
 * 添加新联系人
 */
async function addContact(peerId) {
  peerId = peerId.trim();
  if (!peerId || peerId === peer.getPeerId()) return;

  // 检查是否已存在
  if (contacts.find((c) => c.peerId === peerId)) {
    selectContact(peerId);
    return;
  }

  await db.saveContact(peerId);
  contacts.push({ peerId });
  renderContacts();
  selectContact(peerId);
}

/**
 * 初始化应用
 */
async function init() {
  // 获取 DOM 元素
  myPeerIdEl = document.getElementById('myPeerId');
  statusEl = document.getElementById('status');
  contactListEl = document.getElementById('contactList');
  chatAreaEl = document.getElementById('chatArea');
  newPeerIdInput = document.getElementById('newPeerId');

  // 初始化文件 UI
  initFileUI();

  // 初始化数据库
  await db.initDB();

  // 加载联系人
  contacts = await db.loadContacts();
  renderContacts();

  // 创建 Peer 实例
  const myPeerId = getOrCreatePeerId();
  peer = new PeerJsHttpUtil.PeerJsWrapper(myPeerId, true);

  // 立即显示 Peer ID
  myPeerIdEl.textContent = peer.getPeerId();

  // 等待就绪
  try {
    await peer.whenReady();
    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';
  } catch (err) {
    statusEl.textContent = 'Connection failed: ' + err.message;
    statusEl.className = 'status error';
    return;
  }

  // 复制 ID 功能
  myPeerIdEl.addEventListener('click', () => {
    navigator.clipboard.writeText(peer.getPeerId());
    const original = myPeerIdEl.textContent;
    myPeerIdEl.textContent = 'Copied!';
    setTimeout(() => (myPeerIdEl.textContent = original), 1000);
  });

  // 注册文本消息处理器
  peer.registerHandler('/chat', async (from, data) => {
    const { text } = data;

    // 保存消息
    const msg = await db.saveMessage(from, text, false);

    // 确保发送者在联系人列表中
    if (!contacts.find((c) => c.peerId === from)) {
      await db.saveContact(from);
      contacts.push({ peerId: from });
      renderContacts();
    }

    // 更新 UI
    if (currentPeerId === from) {
      appendMessage(msg);
    }

    return { received: true };
  });

  // 注册文件处理器
  registerFileHandlers(
    peer,
    // onFileReceived
    (from, record) => {
      fileRecords.set(record.fileId, record);

      // 确保发送者在联系人列表中
      if (!contacts.find((c) => c.peerId === from)) {
        db.saveContact(from);
        contacts.push({ peerId: from });
        renderContacts();
      }

      // 更新 UI
      if (currentPeerId === from) {
        appendFileMessage(record);
      }
    },
    // onProgress
    (fileId, from, percent) => {
      updateProgress(fileId, percent);
    },
    // onChunkReceived (流式播放)
    (fileId, from, chunkData, index, total) => {
      // 由 video-stream-ready 事件处理
    }
  );

  // 全局下载函数
  window.downloadFileById = (fileId) => {
    const record = fileRecords.get(fileId);
    if (record) {
      downloadFile(record);
    }
  };

  // 添加联系人输入框事件
  newPeerIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addContact(newPeerIdInput.value);
      newPeerIdInput.value = '';
    }
  });
}

// 启动应用
init();
