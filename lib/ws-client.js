'use strict';
// Client WebSocket minimal (RFC 6455), sans dépendance, pour Node 16+.
// API volontairement proche de celle du navigateur : onopen, onmessage, onclose, onerror, send(), close().

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsClient {
  constructor(url, { handshakeTimeoutMs = 15000 } = {}) {
    this.url = new URL(url);
    this.readyState = 0; // 0 connexion, 1 ouvert, 2 fermeture, 3 fermé
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._buf = Buffer.alloc(0);
    this._fragments = null;
    this._fragOpcode = 0;
    this._closeEmitted = false;
    this.lastActivity = Date.now();
    this._connect(handshakeTimeoutMs);
  }

  _connect(timeoutMs) {
    const secure = this.url.protocol === 'wss:';
    const port = Number(this.url.port) || (secure ? 443 : 80);
    const host = this.url.hostname;
    const key = crypto.randomBytes(16).toString('base64');
    this._expectedAccept = crypto.createHash('sha1').update(key + GUID).digest('base64');

    const sock = secure
      ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host })
      : net.connect({ host, port });
    this._sock = sock;
    sock.setNoDelay(true);

    this._timer = setTimeout(() => this._fail(new Error('Délai de connexion dépassé')), timeoutMs);

    sock.once(secure ? 'secureConnect' : 'connect', () => {
      const path = (this.url.pathname || '/') + (this.url.search || '');
      const hostHeader = this.url.port ? `${host}:${this.url.port}` : host;
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${hostHeader}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        'User-Agent: lunaria-timer\r\n\r\n'
      );
    });
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', (err) => this._fail(err));
    sock.on('close', () => this._emitClose(1006, 'Connexion perdue'));
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    if (this.readyState === 0) {
      const end = this._buf.indexOf('\r\n\r\n');
      if (end === -1) {
        if (this._buf.length > 16384) this._fail(new Error('Réponse de handshake invalide'));
        return;
      }
      const head = this._buf.slice(0, end).toString('latin1');
      this._buf = this._buf.slice(end + 4);
      const lines = head.split('\r\n');
      const status = /^HTTP\/1\.1 (\d{3})/.exec(lines[0]);
      const headers = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      if (!status || status[1] !== '101') return this._fail(new Error(`Handshake refusé (${lines[0]})`));
      if (headers['sec-websocket-accept'] !== this._expectedAccept) return this._fail(new Error('Clé de handshake invalide'));
      clearTimeout(this._timer);
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    this._parseFrames();
  }

  _parseFrames() {
    while (this.readyState === 1 || this.readyState === 2) {
      const b = this._buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(64 * 1024 * 1024)) return this._fail(new Error('Trame trop grande'));
        len = Number(big);
        off = 10;
      }
      let mask = null;
      if (masked) {
        if (b.length < off + 4) return;
        mask = b.slice(off, off + 4);
        off += 4;
      }
      if (b.length < off + len) return;
      let payload = b.slice(off, off + len);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this._buf = b.slice(off + len);
      this.lastActivity = Date.now();
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) { // close
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.length > 2 ? payload.slice(2).toString('utf8') : '';
      if (this.readyState === 1) this._sendFrame(0x8, payload.length >= 2 ? payload.slice(0, 2) : Buffer.alloc(0));
      this.readyState = 2;
      this._sock.end();
      this._emitClose(code, reason);
      return;
    }
    if (opcode === 0x9) return this._sendFrame(0xA, payload); // ping -> pong
    if (opcode === 0xA) return; // pong
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) return this._emitMessage(opcode, payload);
      this._fragments = [payload];
      this._fragOpcode = opcode;
      return;
    }
    if (opcode === 0x0 && this._fragments) {
      this._fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this._fragments);
        this._fragments = null;
        this._emitMessage(this._fragOpcode, full);
      }
    }
  }

  _emitMessage(opcode, payload) {
    if (!this.onmessage) return;
    const data = opcode === 0x1 ? payload.toString('utf8') : payload;
    try {
      this.onmessage({ data });
    } catch (err) {
      if (this.onerror) this.onerror(err);
    }
  }

  _sendFrame(opcode, payload) {
    if (!this._sock || this._sock.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this._sock.write(Buffer.concat([header, mask, masked]));
  }

  send(data) {
    if (this.readyState !== 1) throw new Error('WebSocket non connecté');
    const isText = typeof data === 'string';
    this._sendFrame(isText ? 0x1 : 0x2, isText ? Buffer.from(data, 'utf8') : Buffer.from(data));
  }

  ping() {
    if (this.readyState === 1) this._sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    if (this.readyState === 1) {
      const r = Buffer.from(reason, 'utf8');
      const p = Buffer.alloc(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      this._sendFrame(0x8, p);
    }
    this.readyState = 2;
    const sock = this._sock;
    setTimeout(() => sock && sock.destroy(), 1000).unref();
    this._emitClose(code, reason);
  }

  _fail(err) {
    clearTimeout(this._timer);
    if (this._closeEmitted) return;
    if (this.onerror) this.onerror(err);
    if (this._sock) this._sock.destroy();
    this._emitClose(1006, err.message);
  }

  _emitClose(code, reason) {
    clearTimeout(this._timer);
    if (this._closeEmitted) return;
    this._closeEmitted = true;
    this.readyState = 3;
    if (this.onclose) this.onclose({ code, reason });
  }
}

module.exports = { WsClient };
