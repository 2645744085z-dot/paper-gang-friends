/* 原生 WebSocket 兼容层：保持 app.js 的 on/emit 用法，不再依赖 Socket.IO。 */
(() => {
  class Events {
    constructor() { this.listeners = new Map(); }
    on(event, listener) { const list = this.listeners.get(event) || []; list.push(listener); this.listeners.set(event, list); return this; }
    once(event, listener) { const wrapper = (...args) => { this.off(event, wrapper); listener(...args); }; return this.on(event, wrapper); }
    off(event, listener) { this.listeners.set(event, (this.listeners.get(event) || []).filter((item) => item !== listener)); return this; }
    trigger(event, ...args) { for (const listener of this.listeners.get(event) || []) listener(...args); }
  }

  class RoomSocket extends Events {
    constructor() {
      super(); this.data = {}; this.io = new Events(); this.ws = null; this.roomCode = null; this.pending = new Map(); this.queue = []; this.reconnectTimer = null;
      queueMicrotask(() => this.trigger('connect'));
    }
    emit(event, payload, ack) {
      if (event === 'room:create') { this.createRoom(payload || {}, ack); return this; }
      if (event === 'room:join') { this.joinRoom(payload || {}, ack); return this; }
      const requestId = typeof ack === 'function' ? crypto.randomUUID() : undefined;
      if (requestId) this.pending.set(requestId, ack);
      this.send({ event, payload: payload || {}, requestId });
      return this;
    }
    async createRoom(payload, ack) {
      try {
        const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        const body = await response.json();
        if (!response.ok || !body.ok) { ack?.({ ok: false }); this.trigger('room:error', { message: body.message || '创建房间失败' }); return; }
        this.joinRoom({ ...payload, code: body.code }, (joined) => ack?.(joined?.ok ? { ...joined, code: body.code } : joined));
      } catch { ack?.({ ok: false }); this.trigger('room:error', { message: '无法连接行动服务器，请检查网络后重试' }); }
    }
    joinRoom(payload, ack) {
      const code = String(payload.code || '').toUpperCase();
      if (!code) { ack?.({ ok: false }); this.trigger('room:error', { message: '请输入房间码' }); return; }
      this.roomCode = code; this.open(payload, ack);
    }
    open(joinPayload, joinAck) {
      if (this.ws) { try { this.ws.close(); } catch {} }
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/ws/${encodeURIComponent(this.roomCode)}`);
      this.ws = ws;
      ws.onopen = () => { this.trigger('connect'); this.send({ event: 'room:join', payload: joinPayload || {}, requestId: joinAck ? crypto.randomUUID() : undefined }, joinAck); this.flush(); };
      ws.onmessage = (message) => {
        let data; try { data = JSON.parse(message.data); } catch { return; }
        if (data.event === 'ack' && data.requestId) { const callback = this.pending.get(data.requestId); if (callback) { this.pending.delete(data.requestId); callback(data.payload); } return; }
        this.trigger(data.event, data.payload);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.trigger('disconnect');
        if (this.roomCode) { this.io.trigger('reconnect_attempt'); clearTimeout(this.reconnectTimer); this.reconnectTimer = setTimeout(() => this.open({ name: localStorage.getItem('pgz_name') || '', code: this.roomCode, sessionId: localStorage.getItem('pgz_session') || '' }), 900); }
      };
      ws.onerror = () => {};
    }
    send(message, callback) {
      if (callback) this.pending.set(message.requestId, callback);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); else this.queue.push(message);
    }
    flush() { const messages = this.queue.splice(0); for (const message of messages) this.send(message); }
  }
  window.io = () => new RoomSocket();
})();
