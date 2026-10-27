// 标准 OneBot v11 适配器：HTTP 调动作 + WebSocket 收事件。
//
// 面向 NapCat / LLOneBot / Lagrange / go-cqhttp 这类"只实现 OneBot v11"的网关。
// 与 SnowLuma 的差异：
//   · 没有 fetchFaceEntity → 抛错，桥接会自动降级成"用表情 id 查本地名字表"
//   · 事件靠 post_type / message_type / notice_type 分类
//   · 动作统一走 POST /{action}，响应用 echo 关联（WS 也可以，这里用 HTTP 更简单）
import { EventEmitter } from 'node:events';

const DEFAULT_TIMEOUT_MS = 15000;

export class OneBotGateway extends EventEmitter {
  constructor({ httpUrl, wsUrl, accessToken, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    super();
    this.kind = 'onebot';
    this.httpUrl = String(httpUrl ?? '').replace(/\/+$/, '');
    this.wsUrl = String(wsUrl ?? '');
    this.accessToken = accessToken ? String(accessToken) : '';
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.echoSeq = 0;
    this.pending = new Map();
    this.closed = false;
    this.reconnectTimer = null;
  }

  // ── 连接 ────────────────────────────────────────────────────────────────
  async connect() {
    this.closed = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = this.accessToken
        ? `${this.wsUrl}${this.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(this.accessToken)}`
        : this.wsUrl;

      let ws;
      try {
        ws = new WebSocket(url);
      } catch (error) {
        reject(error);
        return;
      }
      this.ws = ws;

      ws.addEventListener('open', () => {
        settled = true;
        this.emit('status', { connected: true });
        resolve();
      });
      ws.addEventListener('message', (ev) => this._onFrame(ev.data));
      ws.addEventListener('close', () => {
        this.emit('status', { connected: false });
        if (!settled) { settled = true; reject(new Error('WebSocket closed before open')); }
        this._scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        if (!settled) { settled = true; reject(new Error('WebSocket error')); }
      });

      setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('连接超时')); }
      }, this.timeoutMs);
    });
  }

  _scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      this.connect().catch(() => {});
    }, 3000);
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }

  async close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  // ── 事件 ────────────────────────────────────────────────────────────────
  _onFrame(raw) {
    let event;
    try { event = JSON.parse(String(raw)); } catch { return; }

    // 动作响应（HTTP 之外的 WS 回包）
    if (event?.echo != null && this.pending.has(String(event.echo))) {
      const { resolve, reject, timer } = this.pending.get(String(event.echo));
      clearTimeout(timer);
      this.pending.delete(String(event.echo));
      if (event.status === 'failed' || event.retcode) reject(new Error(event.wording ?? event.message ?? 'OneBot 动作失败'));
      else resolve(event.data);
      return;
    }

    this.emit('event', event);

    const postType = event?.post_type;
    if (postType === 'message') {
      if (event.message_type === 'group') this.emit('groupMessage', event);
      else if (event.message_type === 'private') this.emit('privateMessage', event);
      return;
    }
    if (postType === 'notice') {
      this.emit('notice', event);
      this.emit(`notice:${event.notice_type}`, event);
      return;
    }
    if (postType === 'meta_event') {
      if (event.meta_event_type === 'heartbeat') {
        const good = event.status?.good !== false && event.status?.online !== false;
        this.emit('status', { connected: good, heartbeat: true, raw: event });
      } else if (event.meta_event_type === 'lifecycle') {
        this.emit('status', { connected: event.sub_type === 'connect', lifecycle: event });
      }
    }
  }

  onEvent(cb) { return this.on('event', cb); }
  onGroupMessage(cb) { return this.on('groupMessage', cb); }
  onPrivateMessage(cb) { return this.on('privateMessage', cb); }
  onNotice(type, cb) { return this.on(`notice:${type}`, cb); }
  onBotStatus(cb) { return this.on('status', cb); }

  // ── 动作 ────────────────────────────────────────────────────────────────
  async request(action, params = {}) {
    if (!this.httpUrl) throw new Error('没有配置 OneBot httpUrl');
    const res = await fetch(`${this.httpUrl}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {})
      },
      body: JSON.stringify(params ?? {}),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const json = await res.json().catch(() => ({}));
    if (json?.status === 'failed' || (json?.retcode != null && json.retcode !== 0)) {
      throw new Error(json?.wording ?? json?.message ?? `OneBot 动作失败：${action}`);
    }
    return json?.data;
  }

  async raw(action, params) { return this.request(action, params); }

  sendGroupMessage(groupId, message) {
    return this.request('send_group_msg', { group_id: Number(groupId), message });
  }
  sendPrivateMessage(userId, message) {
    return this.request('send_private_msg', { user_id: Number(userId), message });
  }

  getLoginInfo() { return this.request('get_login_info'); }
  getGroupMemberInfo(groupId, userId) {
    return this.request('get_group_member_info', { group_id: Number(groupId), user_id: Number(userId), no_cache: false });
  }
  getGroupMemberList(groupId) { return this.request('get_group_member_list', { group_id: Number(groupId) }); }
  getImage({ file }) { return this.request('get_image', { file }); }
  getMessage(messageId) { return this.request('get_msg', { message_id: messageId }); }

  /** 标准 OneBot 没有这个能力：明确抛错，让调用方降级。 */
  fetchFaceEntity() {
    const error = new Error('该网关不支持 fetchFaceEntity（标准 OneBot v11）');
    error.code = 'UNSUPPORTED';
    return Promise.reject(error);
  }
}
