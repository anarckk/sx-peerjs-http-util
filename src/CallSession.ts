/**
 * CallSessionImpl - 通话会话的内部实现
 * 
 * 负责管理单个语音/视频通话的完整生命周期：
 * - 音视频流管理
 * - 静音/视频开关状态
 * - 通话状态变化通知
 * 
 * @example
 * const session = new CallSessionImpl(peerId, mediaConnection, hasVideo, debugLog, onCleanup);
 * session.toggleMute(); // 切换静音
 * session.toggleVideo(); // 切换视频
 * session.hangUp(); // 挂断通话
 */

import type { MediaConnection } from 'peerjs';
import type { CallSession, CallState, CallStateListener } from './types';

/**
 * 通话会话实现类
 * 实现 CallSession 接口，提供通话控制功能
 */
export class CallSessionImpl implements CallSession {
  /** 对端的 Peer ID */
  readonly peerId: string;
  /** 是否包含视频 */
  readonly hasVideo: boolean;

  /** PeerJS MediaConnection 实例 */
  private mediaConnection: MediaConnection;
  /** 本地媒体流（麦克风/摄像头） */
  private localStream: MediaStream | null = null;
  /** 远程媒体流（对方的音频/视频） */
  private remoteStream: MediaStream | null = null;
  /** 通话状态监听器集合 */
  private stateListeners = new Set<CallStateListener>();
  /** 调试日志函数 */
  private debugLogFn: (obj: string, event: string, data?: unknown) => void;
  /** 清理回调（通话结束时调用） */
  private onCleanup: (session: CallSessionImpl) => void;

  /** 当前通话状态 */
  private _state: CallState = 'connecting';
  /** 是否已静音 */
  private isMuted = false;
  /** 视频是否开启 */
  private isVideoEnabled = true;

  /**
   * 创建通话会话实例
   * @param peerId 对端 Peer ID
   * @param mediaConnection PeerJS MediaConnection 实例
   * @param hasVideo 是否包含视频
   * @param debugLog 调试日志函数
   * @param onCleanup 通话结束时的清理回调
   */
  constructor(
    peerId: string,
    mediaConnection: MediaConnection,
    hasVideo: boolean,
    debugLog: (obj: string, event: string, data?: unknown) => void,
    onCleanup: (session: CallSessionImpl) => void
  ) {
    this.peerId = peerId;
    this.mediaConnection = mediaConnection;
    this.hasVideo = hasVideo;
    this.debugLogFn = debugLog;
    this.onCleanup = onCleanup;
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this._state === 'connected';
  }

  /** 当前通话状态 */
  get state(): CallState {
    return this._state;
  }

  /**
   * 设置通话状态
   * @param state 新的通话状态
   * @param reason 状态变化原因（可选）
   */
  setState(state: CallState, reason?: string): void {
    this._state = state;
    this.notifyStateChange(state, reason);
  }

  /** 设置本地媒体流 */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
  }

  /** 设置远程媒体流 */
  setRemoteStream(stream: MediaStream): void {
    this.remoteStream = stream;
  }

  /** 获取本地媒体流 */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /** 获取远程媒体流 */
  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /**
   * 切换静音状态
   * @returns 切换后的静音状态（true = 已静音）
   */
  toggleMute(): boolean {
    if (!this.localStream) return this.isMuted;

    const audioTracks = this.localStream.getAudioTracks();
    for (const track of audioTracks) {
      track.enabled = this.isMuted;
    }
    this.isMuted = !this.isMuted;
    this.debugLogFn('CallSession', 'toggleMute', this.isMuted);
    return this.isMuted;
  }

  /**
   * 切换视频开关（仅视频通话有效）
   * @returns 切换后的视频状态（true = 视频开启）
   */
  toggleVideo(): boolean {
    if (!this.hasVideo || !this.localStream) return this.isVideoEnabled;

    const videoTracks = this.localStream.getVideoTracks();
    for (const track of videoTracks) {
      track.enabled = !this.isVideoEnabled;
    }
    this.isVideoEnabled = !this.isVideoEnabled;
    this.debugLogFn('CallSession', 'toggleVideo', this.isVideoEnabled);
    return this.isVideoEnabled;
  }

  /** 挂断通话 */
  hangUp(): void {
    this.debugLogFn('CallSession', 'hangUp', this.peerId);
    this.mediaConnection.close();
  }

  /**
   * 关闭通话会话
   * 停止本地流，清理资源
   */
  close(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
    this._state = 'ended';
  }

  /** 注册通话状态变化监听器 */
  onStateChange(listener: CallStateListener): void {
    this.stateListeners.add(listener);
  }

  /** 移除通话状态变化监听器 */
  offStateChange(listener: CallStateListener): void {
    this.stateListeners.delete(listener);
  }

  /**
   * 通知状态变化
   * @param state 新状态
   * @param reason 变化原因（可选）
   */
  private notifyStateChange(state: CallState, reason?: string): void {
    this.debugLogFn('CallSession', 'stateChange', { peer: this.peerId, state, reason });
    this.stateListeners.forEach(listener => {
      try {
        listener(state, reason);
      } catch (err) {
        this.debugLogFn('CallSession', 'listenerError', err);
      }
    });

    // 通话结束时执行清理
    if (state === 'ended') {
      this.onCleanup(this);
    }
  }
}
