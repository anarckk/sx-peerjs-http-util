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

// 通话状态
let currentCallSession = null;
let pendingIncomingCall = null;

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

  // 手机端：选中联系人后隐藏侧边栏
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.remove('active');
  }
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
    <div class="chat-header">
      <span>Chat with: <span>${currentPeerId}</span></span>
      <div class="call-actions">
        <button class="call-btn voice" id="voiceCallBtn" title="Voice Call">
          <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>
        </button>
        <button class="call-btn video" id="videoCallBtn" title="Video Call">
          <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        </button>
      </div>
    </div>
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

  // 绑定通话按钮事件
  const voiceCallBtn = document.getElementById('voiceCallBtn');
  const videoCallBtn = document.getElementById('videoCallBtn');

  voiceCallBtn.addEventListener('click', () => startCall(false));
  videoCallBtn.addEventListener('click', () => startCall(true));
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

  // 手机端返回按钮
  const backBtn = document.getElementById('backBtn');
  const sidebar = document.querySelector('.sidebar');

  backBtn.addEventListener('click', () => {
    sidebar.classList.toggle('active');
  });

  // 注册来电监听器
  peer.onIncomingCall(handleIncomingCall);

  // 绑定通话界面控制按钮
  setupCallControls();
}

// 启动应用
init();

// ============== 通话相关函数 ==============

/**
 * 设置通话控制按钮事件
 */
function setupCallControls() {
  const muteBtn = document.getElementById('muteBtn');
  const hangupBtn = document.getElementById('hangupBtn');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const rejectCallBtn = document.getElementById('rejectCallBtn');

  muteBtn.addEventListener('click', toggleMute);
  hangupBtn.addEventListener('click', hangupCall);
  acceptCallBtn.addEventListener('click', answerIncomingCall);
  rejectCallBtn.addEventListener('click', rejectIncomingCall);
}

/**
 * 发起通话
 */
async function startCall(hasVideo) {
  if (!currentPeerId) {
    alert('Please select a contact first');
    return;
  }

  if (currentCallSession) {
    alert('Already in a call');
    return;
  }

  showCallOverlay('Calling...', currentPeerId, hasVideo);

  try {
    const session = await peer.call(currentPeerId, { video: hasVideo });
    currentCallSession = session;

    // 显示本地预览
    const localStream = session.getLocalStream();
    if (localStream) {
      const localVideo = document.getElementById('localVideo');
      localVideo.srcObject = localStream;
    }

    // 监听状态变化
    session.onStateChange((state, reason) => {
      if (state === 'connected') {
        showCallOverlay('Connected', currentPeerId, hasVideo);
        const remoteStream = session.getRemoteStream();
        if (remoteStream) {
          const remoteVideo = document.getElementById('remoteVideo');
          remoteVideo.srcObject = remoteStream;
          if (!hasVideo) {
            remoteVideo.style.display = 'none';
            document.getElementById('audioOnlyIndicator').style.display = 'flex';
          }
        }
      } else if (state === 'ended') {
        hideCallOverlay();
        currentCallSession = null;
        if (reason) {
          console.log('Call ended:', reason);
        }
      }
    });
  } catch (err) {
    hideCallOverlay();
    alert('Failed to start call: ' + err.message);
  }
}

/**
 * 处理来电
 */
function handleIncomingCall(event) {
  pendingIncomingCall = event;

  // 显示来电提示
  const modal = document.getElementById('incomingCallModal');
  const overlayBg = document.getElementById('overlayBg');
  const callerIdEl = document.getElementById('callerId');
  const callTypeEl = document.getElementById('callType');

  callerIdEl.textContent = event.from;
  callTypeEl.textContent = event.hasVideo ? 'Video Call' : 'Voice Call';

  modal.classList.add('active');
  overlayBg.classList.add('active');
}

/**
 * 接听来电
 */
async function answerIncomingCall() {
  if (!pendingIncomingCall) return;

  const event = pendingIncomingCall;
  pendingIncomingCall = null;

  // 隐藏来电提示
  document.getElementById('incomingCallModal').classList.remove('active');
  document.getElementById('overlayBg').classList.remove('active');

  showCallOverlay('Connecting...', event.from, event.hasVideo);

  try {
    const session = await event.answer();
    currentCallSession = session;

    // 确保来电者在联系人列表中
    if (!contacts.find((c) => c.peerId === event.from)) {
      await db.saveContact(event.from);
      contacts.push({ peerId: event.from });
      renderContacts();
    }

    // 显示本地预览
    const localStream = session.getLocalStream();
    if (localStream) {
      const localVideo = document.getElementById('localVideo');
      localVideo.srcObject = localStream;
    }

    // 监听状态变化
    session.onStateChange((state, reason) => {
      if (state === 'connected') {
        showCallOverlay('Connected', event.from, event.hasVideo);
        const remoteStream = session.getRemoteStream();
        if (remoteStream) {
          const remoteVideo = document.getElementById('remoteVideo');
          remoteVideo.srcObject = remoteStream;
          if (!event.hasVideo) {
            remoteVideo.style.display = 'none';
            document.getElementById('audioOnlyIndicator').style.display = 'flex';
          }
        }
      } else if (state === 'ended') {
        hideCallOverlay();
        currentCallSession = null;
      }
    });
  } catch (err) {
    hideCallOverlay();
    alert('Failed to answer call: ' + err.message);
  }
}

/**
 * 拒绝来电
 */
function rejectIncomingCall() {
  if (pendingIncomingCall) {
    pendingIncomingCall.reject();
    pendingIncomingCall = null;
  }

  document.getElementById('incomingCallModal').classList.remove('active');
  document.getElementById('overlayBg').classList.remove('active');
}

/**
 * 挂断通话
 */
function hangupCall() {
  if (currentCallSession) {
    currentCallSession.hangUp();
    currentCallSession = null;
  }
  hideCallOverlay();
}

/**
 * 切换静音
 */
function toggleMute() {
  if (!currentCallSession) return;

  const isMuted = currentCallSession.toggleMute();
  const muteBtn = document.getElementById('muteBtn');

  if (isMuted) {
    muteBtn.classList.add('active');
  } else {
    muteBtn.classList.remove('active');
  }
}

/**
 * 显示通话界面
 */
function showCallOverlay(status, peerId, hasVideo) {
  const overlay = document.getElementById('callOverlay');
  const statusEl = document.getElementById('callStatus');
  const peerIdEl = document.getElementById('callPeerId');
  const remoteVideo = document.getElementById('remoteVideo');
  const audioIndicator = document.getElementById('audioOnlyIndicator');

  statusEl.textContent = status;
  peerIdEl.textContent = peerId;

  // 重置状态
  remoteVideo.style.display = hasVideo ? 'block' : 'none';
  audioIndicator.style.display = hasVideo ? 'none' : 'flex';
  remoteVideo.srcObject = null;
  document.getElementById('localVideo').srcObject = null;

  overlay.classList.add('active');
  overlay.classList.toggle('calling', status === 'Calling...' || status === 'Connecting...');
  overlay.classList.toggle('connected', status === 'Connected');
}

/**
 * 隐藏通话界面
 */
function hideCallOverlay() {
  const overlay = document.getElementById('callOverlay');
  overlay.classList.remove('active', 'calling', 'connected');

  // 清理视频流
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');

  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(t => t.stop());
    remoteVideo.srcObject = null;
  }
  if (localVideo.srcObject) {
    localVideo.srcObject.getTracks().forEach(t => t.stop());
    localVideo.srcObject = null;
  }

  // 重置静音按钮状态
  document.getElementById('muteBtn').classList.remove('active');
}
