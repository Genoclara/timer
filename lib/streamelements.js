'use strict';
// Connexion à StreamElements (passerelle WebSocket « Astro ») pour recevoir
// les subs (T1/T2/T3/Prime), les subs offerts, les bits et les dons (tips).

const crypto = require('crypto');
const { WsClient } = require('./ws-client');

const ASTRO_URL = 'wss://astro.streamelements.com';
const GIFT_WAIT_MS = 12000; // délai pour regrouper un « don de subs » avec les subs individuels

function normalizeTier(t) {
  const s = String(t == null ? '' : t).toLowerCase();
  if (s === 'prime') return 'prime';
  if (s === '2000' || s === '2') return '2';
  if (s === '3000' || s === '3') return '3';
  return '1';
}

class StreamElements {
  /**
   * @param {object} opts
   * @param {() => {enabled:boolean, jwt:string}} opts.getConfig
   * @param {(ev:object) => void} opts.onEvent  événement normalisé
   * @param {(status:object) => void} opts.onStatus
   * @param {(msg:string) => void} [opts.log]
   */
  constructor({ getConfig, onEvent, onStatus, log, url = ASTRO_URL }) {
    this.getConfig = getConfig;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.log = log || (() => {});
    this.url = url;
    this.ws = null;
    this.status = { state: 'off', message: 'Désactivé' };
    this.seen = new Set();
    this.seenOrder = [];
    this.pendingGifts = [];
    this.recentGifts = [];
    this.retry = 0;
    this.reconnectTimer = null;
    this.watchdog = null;
    this.generation = 0;
  }

  setStatus(state, message) {
    this.status = { state, message, at: Date.now() };
    this.onStatus(this.status);
  }

  /** (Re)démarre la connexion avec la configuration actuelle. */
  restart() {
    this.stop(true);
    const cfg = this.getConfig();
    if (!cfg.enabled) return this.setStatus('off', 'Désactivé');
    if (!cfg.jwt) return this.setStatus('error', 'Jeton JWT manquant');
    this.connect();
  }

  stop(silent) {
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try { ws.close(1000, 'stop'); } catch (_) { /* déjà fermé */ }
    }
    if (!silent) this.setStatus('off', 'Désactivé');
  }

  connect() {
    const gen = ++this.generation;
    const cfg = this.getConfig();
    this.setStatus('connecting', 'Connexion à StreamElements…');
    let ws;
    try {
      ws = new WsClient(this.url);
    } catch (err) {
      return this.scheduleReconnect(gen, err.message);
    }
    this.ws = ws;
    let authFailed = false;

    ws.onopen = () => {
      if (gen !== this.generation) return;
      ws.send(JSON.stringify({
        type: 'subscribe',
        nonce: crypto.randomUUID(),
        data: { topic: 'channel.activities', token: cfg.jwt.trim(), token_type: 'jwt' },
      }));
      this.setStatus('connecting', 'Connecté, abonnement en cours…');
      clearInterval(this.watchdog);
      this.watchdog = setInterval(() => {
        if (gen !== this.generation) return;
        if (Date.now() - ws.lastActivity > 80000) {
          this.log('StreamElements : plus de nouvelles du serveur, reconnexion.');
          ws.close(4000, 'timeout');
          this.scheduleReconnect(gen, 'Connexion inactive');
        } else {
          ws.ping();
        }
      }, 25000);
    };

    ws.onmessage = ({ data }) => {
      if (gen !== this.generation) return;
      let msg;
      try { msg = JSON.parse(data); } catch (_) { return; }
      if (msg.type === 'response') {
        if (msg.error) {
          authFailed = /auth|token|unauthori|forbidden|invalid/i.test(`${msg.error} ${msg.data && msg.data.message}`);
          this.setStatus('error', `StreamElements a refusé l'abonnement : ${(msg.data && msg.data.message) || msg.error}`);
          if (authFailed) this.stop(true);
          return;
        }
        this.retry = 0;
        this.setStatus('connected', 'Connecté — en écoute des subs, bits et dons');
        return;
      }
      if (msg.type === 'reconnect') {
        this.log('StreamElements demande une reconnexion.');
        ws.close(1000, 'reconnect');
        this.scheduleReconnect(gen, 'Reconnexion demandée', 500);
        return;
      }
      if (msg.type === 'message' && msg.topic === 'channel.activities' && msg.data) {
        this.handleActivity(msg.data);
      }
    };

    ws.onerror = (err) => {
      if (gen !== this.generation) return;
      this.log(`StreamElements : erreur (${err.message})`);
    };

    ws.onclose = ({ code, reason }) => {
      if (gen !== this.generation || authFailed) return;
      this.scheduleReconnect(gen, `Déconnecté (${code}${reason ? ' ' + reason : ''})`);
    };
  }

  scheduleReconnect(gen, why, delayOverride) {
    if (gen !== this.generation) return;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    const delay = delayOverride != null ? delayOverride : Math.min(60000, 2000 * 2 ** Math.min(this.retry, 5));
    this.retry++;
    this.setStatus('connecting', `${why} — nouvelle tentative dans ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = setTimeout(() => {
      if (gen === this.generation) this.connect();
    }, delay);
  }

  remember(id) {
    if (!id) return false;
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 1000) this.seen.delete(this.seenOrder.shift());
    return false;
  }

  /** Convertit une activité StreamElements en événement du timer. */
  handleActivity(act) {
    if (!act || typeof act !== 'object') return;
    if (this.remember(act._id || act.id)) return;
    const d = act.data || {};
    const user = d.displayName || d.username || d.name || 'Anonyme';
    const base = { source: 'streamelements', id: act._id || act.id || null };

    switch (act.type) {
      case 'subscriber': {
        const tier = normalizeTier(d.tier);
        const gifter = d.sender || d.gifter;
        if (d.gifted || (gifter && gifter.toLowerCase() !== String(d.username || '').toLowerCase())) {
          // Sub offert à une personne : compte pour celui qui offre.
          const from = String(gifter || '').toLowerCase();
          const pending = this.pendingGifts.find((g) => g.tier === tier && g.sender.toLowerCase() === from && g.left > 0);
          if (pending) pending.left--;
          else {
            const now = Date.now();
            this.recentGifts = this.recentGifts.filter((g) => now - g.at < GIFT_WAIT_MS);
            this.recentGifts.push({ sender: from, tier, at: now });
          }
          this.onEvent({ ...base, type: 'gift', tier, count: 1, user: gifter || 'Anonyme', recipient: user });
        } else {
          this.onEvent({ ...base, type: 'sub', tier, months: Number(d.amount) || 1, user });
        }
        return;
      }
      case 'communityGiftPurchase': {
        // Achat groupé (« X offre 10 subs »). Selon les cas, StreamElements envoie aussi
        // chaque sub individuellement : on attend un peu et on ne compte que ce qui manque.
        const count = Math.max(1, Math.floor(Number(d.amount) || 1));
        const gift = { sender: d.sender || d.username || user, tier: normalizeTier(d.tier), left: count };
        // Les subs individuels arrivés juste avant l'achat groupé sont déjà comptés.
        const now = Date.now();
        this.recentGifts = this.recentGifts.filter((g) => now - g.at < GIFT_WAIT_MS);
        for (const g of this.recentGifts.slice()) {
          if (gift.left > 0 && g.tier === gift.tier && g.sender === gift.sender.toLowerCase()) {
            gift.left--;
            this.recentGifts.splice(this.recentGifts.indexOf(g), 1);
          }
        }
        this.pendingGifts.push(gift);
        setTimeout(() => {
          this.pendingGifts = this.pendingGifts.filter((g) => g !== gift);
          if (gift.left > 0) {
            this.onEvent({ ...base, type: 'gift', tier: gift.tier, count: gift.left, user: d.displayName || gift.sender });
          }
        }, GIFT_WAIT_MS).unref();
        return;
      }
      case 'cheer':
        this.onEvent({ ...base, type: 'bits', amount: Math.floor(Number(d.amount) || 0), user });
        return;
      case 'tip':
        this.onEvent({ ...base, type: 'tip', amount: Number(d.amount) || 0, currency: d.currency || '', user });
        return;
      default:
        // follow, raid, etc. : ignorés par le timer
    }
  }
}

module.exports = { StreamElements, normalizeTier };
