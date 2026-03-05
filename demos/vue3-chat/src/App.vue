<template>
  <div class="app">
    <div class="header">
      <button v-if="currentPeer" @click="currentPeer = null" class="back-btn">←</button>
      <h2>P2P Chat</h2>
    </div>

    <div v-if="!currentPeer" class="connect-page">
      <div class="my-id">
        <p>我的 ID:</p>
        <div v-if="peerId" class="id-box">
          <canvas ref="qrCanvas"></canvas>
          <p class="id-text">{{ peerId }}</p>
        </div>
        <p v-else class="loading">连接中...</p>
      </div>

      <div class="actions">
        <button @click="showScanner = true" class="btn-primary">扫码连接</button>
        <input v-model="remotePeerInput" placeholder="或输入对方 ID" @keyup.enter="connectPeer" data-testid="remote-peer-input" />
        <button @click="connectPeer" :disabled="!remotePeerInput" data-testid="connect-btn">连接</button>
      </div>

      <div v-if="showScanner" class="scanner-modal">
        <div class="scanner-content">
          <h3>扫描二维码</h3>
          <div ref="scannerContainer" id="scanner"></div>
          <button @click="closeScanner">取消</button>
        </div>
      </div>
    </div>

    <div v-else class="chat-page">
      <div class="messages" ref="messagesContainer">
        <div v-for="(msg, i) in messages" :key="i" :class="['msg', msg.type]">
          <img v-if="msg.image" :src="msg.image" @click="previewImage(msg.image)" />
          <div v-else-if="msg.file" class="file-msg">
            <span>📄 {{ msg.file.name }}</span>
            <button @click="downloadFile(msg.file)">下载</button>
          </div>
          <p v-else>{{ msg.text }}</p>
          <span class="time">{{ msg.time }}</span>
        </div>
      </div>

      <div class="input-area">
        <input v-model="textInput" placeholder="输入消息" @keyup.enter="sendText" />
        <button @click="sendText">发送</button>
        <input type="file" ref="fileInput" @change="sendFile" accept="image/*,.pdf,.doc,.docx,.txt" style="display:none" />
        <button @click="$refs.fileInput.click()">📎</button>
        <button @click="startCall(false)">📞</button>
        <button @click="startCall(true)">📹</button>
      </div>
    </div>

    <div v-if="callSession" class="call-overlay">
      <div class="call-content">
        <p>{{ callSession.hasVideo ? '视频通话中' : '语音通话中' }}</p>
        <video v-if="callSession.hasVideo" ref="remoteVideo" autoplay playsinline class="remote-video"></video>
        <video ref="localVideo" autoplay playsinline muted class="local-video"></video>
        <div class="call-controls">
          <button @click="toggleMute">{{ muted ? '🔊' : '🔇' }}</button>
          <button v-if="callSession.hasVideo" @click="toggleVideo">{{ videoOff ? '📷' : '📹' }}</button>
          <button @click="hangUp" class="hangup">挂断</button>
        </div>
      </div>
    </div>

    <div v-if="incomingCall" class="incoming-modal">
      <h3>来电</h3>
      <p>{{ incomingCall.from.slice(0, 8) }}...</p>
      <p>{{ incomingCall.hasVideo ? '视频通话' : '语音通话' }}</p>
      <div>
        <button @click="answerCall" class="accept">接听</button>
        <button @click="rejectCall" class="reject">拒绝</button>
      </div>
    </div>

    <div v-if="previewImageUrl" class="preview-modal" @click="previewImageUrl = null">
      <img :src="previewImageUrl" />
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import QRCode from 'qrcode'
import { Html5Qrcode } from 'html5-qrcode'
import { PeerJsWrapper } from 'sx-peerjs-http-util'

export default {
  setup() {
    const peerId = ref('')
    const currentPeer = ref(null)
    const remotePeerInput = ref('')
    const messages = ref([])
    const textInput = ref('')
    const showScanner = ref(false)
    const qrCanvas = ref(null)
    const scannerContainer = ref(null)
    const messagesContainer = ref(null)
    const fileInput = ref(null)
    const localVideo = ref(null)
    const remoteVideo = ref(null)

    const callSession = ref(null)
    const incomingCall = ref(null)
    const muted = ref(false)
    const videoOff = ref(false)
    const previewImageUrl = ref(null)

    let wrapper = null
    let scanner = null

    onMounted(async () => {
      wrapper = new PeerJsWrapper(null, false, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true
      })
      await wrapper.whenReady()
      peerId.value = wrapper.getPeerId()
      
      // 暴露测试辅助函数到 window
      window.peerId = peerId.value
      window.connectToPeer = (id) => {
        remotePeerInput.value = id
        connectPeer()
      }
      
      if (qrCanvas.value) {
        QRCode.toCanvas(qrCanvas.value, peerId.value, { width: 200 })
      }

      wrapper.registerHandler('/message', (from, data) => {
        if (currentPeer.value === from) {
          messages.value.push({ ...data, type: 'received', time: formatTime() })
          scrollToBottom()
        }
        return { ok: true }
      })

      wrapper.onIncomingCall((event) => {
        incomingCall.value = event
      })
    })

    onUnmounted(() => {
      if (wrapper) wrapper.destroy()
      if (scanner) scanner.stop()
    })

    watch(peerId, (id) => {
      if (id && qrCanvas.value) {
        QRCode.toCanvas(qrCanvas.value, id, { width: 200 })
      }
    })

    function formatTime() {
      return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    function scrollToBottom() {
      nextTick(() => {
        if (messagesContainer.value) {
          messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
        }
      })
    }

    function connectPeer() {
      const id = remotePeerInput.value.trim()
      if (!id) return
      currentPeer.value = id
      messages.value = []
      showScanner.value = false
    }

    async function sendText() {
      const text = textInput.value.trim()
      if (!text || !currentPeer.value) return
      
      try {
        await wrapper.send(currentPeer.value, '/message', { text })
        messages.value.push({ text, type: 'sent', time: formatTime() })
        textInput.value = ''
        scrollToBottom()
      } catch (e) {
        alert('发送失败: ' + e.message)
      }
    }

    async function sendFile(e) {
      const file = e.target.files[0]
      if (!file || !currentPeer.value) return

      const isImage = file.type.startsWith('image/')
      const maxSize = 10 * 1024 * 1024
      if (file.size > maxSize) {
        return alert('文件过大（最大10MB）')
      }

      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]
        try {
          await wrapper.send(currentPeer.value, '/message', {
            file: { name: file.name, type: file.type, content: base64 },
            image: isImage ? reader.result : null
          })
          messages.value.push({
            image: isImage ? reader.result : null,
            file: isImage ? null : { name: file.name, type: file.type, content: base64 },
            type: 'sent',
            time: formatTime()
          })
          scrollToBottom()
        } catch (e) {
          alert('发送失败: ' + e.message)
        }
      }
      reader.readAsDataURL(file)
      e.target.value = ''
    }

    function downloadFile(file) {
      const byteChars = atob(file.content)
      const byteNums = new Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i)
      }
      const blob = new Blob([new Uint8Array(byteNums)], { type: file.type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
    }

    function previewImage(url) {
      previewImageUrl.value = url
    }

    async function startCall(video) {
      if (!currentPeer.value) return
      try {
        callSession.value = await wrapper.call(currentPeer.value, { video })
        setupCallSession()
      } catch (e) {
        alert('呼叫失败: ' + e.message)
      }
    }

    function setupCallSession() {
      const local = callSession.value.getLocalStream()
      if (local && localVideo.value) {
        localVideo.value.srcObject = local
      }

      const remote = callSession.value.getRemoteStream()
      if (remote && remoteVideo.value) {
        remoteVideo.value.srcObject = remote
      }

      callSession.value.onStateChange((state) => {
        if (state === 'connected') {
          const stream = callSession.value.getRemoteStream()
          if (stream && remoteVideo.value) {
            remoteVideo.value.srcObject = stream
          }
        } else if (state === 'ended') {
          endCall()
        }
      })
    }

    async function answerCall() {
      try {
        callSession.value = await incomingCall.value.answer()
        incomingCall.value = null
        setupCallSession()
      } catch (e) {
        alert('接听失败: ' + e.message)
      }
    }

    function rejectCall() {
      incomingCall.value.reject()
      incomingCall.value = null
    }

    function toggleMute() {
      if (callSession.value) {
        muted.value = callSession.value.toggleMute()
      }
    }

    function toggleVideo() {
      if (callSession.value) {
        videoOff.value = !callSession.value.toggleVideo()
      }
    }

    function hangUp() {
      if (callSession.value) {
        callSession.value.hangUp()
        endCall()
      }
    }

    function endCall() {
      callSession.value = null
      muted.value = false
      videoOff.value = false
      if (localVideo.value) localVideo.value.srcObject = null
      if (remoteVideo.value) remoteVideo.value.srcObject = null
    }

    async function closeScanner() {
      if (scanner) {
        await scanner.stop()
        scanner = null
      }
      showScanner.value = false
    }

    watch(showScanner, async (show) => {
      if (show) {
        await nextTick()
        scanner = new Html5Qrcode('scanner')
        scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (text) => {
            remotePeerInput.value = text
            closeScanner()
            connectPeer()
          },
          () => {}
        ).catch(e => {
          alert('无法访问摄像头: ' + e.message)
          showScanner.value = false
        })
      }
    })

    return {
      peerId, currentPeer, remotePeerInput, messages, textInput,
      showScanner, qrCanvas, scannerContainer, messagesContainer, fileInput,
      callSession, incomingCall, muted, videoOff, previewImageUrl,
      localVideo, remoteVideo,
      connectPeer, sendText, sendFile, downloadFile, previewImage,
      startCall, answerCall, rejectCall, toggleMute, toggleVideo, hangUp, closeScanner
    }
  }
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; }

.app { max-width: 500px; margin: 0 auto; background: #fff; min-height: 100vh; position: relative; }

.header { display: flex; align-items: center; padding: 12px; background: #07c160; color: #fff; }
.header h2 { font-size: 18px; flex: 1; text-align: center; }
.back-btn { background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; }

.connect-page { padding: 20px; text-align: center; }
.my-id { margin-bottom: 30px; }
.my-id p { margin-bottom: 10px; color: #666; }
.id-box { background: #f9f9f9; padding: 15px; border-radius: 8px; }
.id-text { font-size: 12px; word-break: break-all; margin-top: 10px; color: #999; }
.loading { color: #999; }

.actions { display: flex; flex-direction: column; gap: 10px; }
.actions input { padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
.actions button { padding: 12px; background: #07c160; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
.actions button:disabled { background: #ccc; }
.btn-primary { background: #07c160; }

.scanner-modal, .call-overlay, .incoming-modal, .preview-modal {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.scanner-content, .incoming-modal { background: #fff; padding: 20px; border-radius: 8px; text-align: center; }
#scanner { width: 250px; height: 250px; margin: 15px 0; }
.incoming-modal button { margin: 10px 5px; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
.accept { background: #07c160; color: #fff; }
.reject { background: #f56c6c; color: #fff; }

.chat-page { display: flex; flex-direction: column; height: calc(100vh - 48px); }
.messages { flex: 1; overflow-y: auto; padding: 10px; background: #f5f5f5; }
.msg { max-width: 70%; margin: 5px 0; padding: 8px 12px; border-radius: 8px; position: relative; }
.msg.sent { background: #95ec69; margin-left: auto; }
.msg.received { background: #fff; }
.msg img { max-width: 150px; border-radius: 4px; cursor: pointer; }
.msg p { font-size: 14px; word-break: break-all; }
.msg .time { font-size: 10px; color: #999; display: block; margin-top: 4px; }
.file-msg { display: flex; align-items: center; gap: 8px; }
.file-msg button { padding: 4px 8px; background: #07c160; color: #fff; border: none; border-radius: 4px; font-size: 12px; }

.input-area { display: flex; padding: 10px; gap: 5px; background: #f5f5f5; border-top: 1px solid #ddd; }
.input-area input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
.input-area button { padding: 8px 12px; background: #07c160; color: #fff; border: none; border-radius: 4px; cursor: pointer; }

.call-content { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; }
.call-content p { margin-bottom: 20px; font-size: 18px; }
.remote-video { width: 100%; height: 60%; object-fit: cover; background: #000; }
.local-video { position: absolute; width: 120px; height: 160px; bottom: 80px; right: 20px; border: 2px solid #fff; background: #000; }
.call-controls { display: flex; gap: 20px; margin-top: 20px; }
.call-controls button { width: 50px; height: 50px; border-radius: 50%; border: none; font-size: 20px; cursor: pointer; }
.hangup { background: #f56c6c; color: #fff; }

.preview-modal { background: rgba(0,0,0,0.9); }
.preview-modal img { max-width: 90%; max-height: 90%; object-fit: contain; }
</style>
