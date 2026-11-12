// ============ NET: WebSocket connection to the co-op relay ============
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function relayURL() {
  const raw = window.__WS_BASE__ || '';
  const unresolved = !raw || raw.startsWith('__PORT_');
  if (unresolved) {
    if (!localHosts.has(location.hostname)) return null;
    return `ws://${location.hostname}:8000/ws`;
  }
  if (/^wss?:\/\//.test(raw)) return raw.replace(/\/$/, '') + '/ws';
  if (/^https?:\/\//.test(raw)) return raw.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  const base = location.pathname.replace(/\/[^/]*$/, '');
  const path = raw.startsWith('/') ? raw : `${base}/${raw}`;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path.replace(/\/$/, '')}/ws`;
}

export const Net = {
  ws: null, role: null, id: -1, code: '', connected: false,
  handlers: {},
  on(t, fn) { this.handlers[t] = fn; },
  emit(t, m) { const h = this.handlers[t]; if (h) h(m); },
  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === 1) return resolve();
      const url = relayURL();
      if (!url) return reject(new Error('The co-op server is not available on this page.'));
      let settled = false;
      const ws = new WebSocket(url); this.ws = ws;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('Could not reach the co-op server. Try again in a moment.')); } }, 9000);
      ws.onopen = () => { this.connected = true; if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
      ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not reach the co-op server. Try again in a moment.')); } };
      ws.onclose = () => {
        const was = this.connected; this.connected = false; this.ws = null;
        if (was && this.role) { const r = this.role; this.role = null; this.emit('disconnect', { role: r }); }
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        this.emit(m.t, m);
      };
    });
  },
  raw(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); },
  async host(name) { await this.connect(); this.raw({ t: 'create', name }); },
  async join(code, name) { await this.connect(); this.raw({ t: 'join', code, name }); },
  // host -> peer (id) or 'all'; peer -> host
  send(d, to = 'all') { this.raw({ t: 'to', to: this.role === 'host' ? to : 0, d }); },
  sendStr(str, to) { if (this.ws && this.ws.readyState === 1) this.ws.send(`{"t":"to","to":${typeof to === 'number' ? to : '"all"'},"d":${str}}`); },
  leave() { this.role = null; this.raw({ t: 'leave' }); try { this.ws && this.ws.close(); } catch {} this.ws = null; this.connected = false; },
  get active() { return !!this.role; },
};
