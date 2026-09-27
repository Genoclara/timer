'use strict';
// Connexion à StreamElements (passerelle WebSocket « Astro ») pour recevoir
// les subs (T1/T2/T3/Prime), les subs offerts, les bits et les dons (tips).

const crypto = require('crypto');
const { WsClient } = require('./ws-client');

const ASTRO_URL = 'wss://astro.streamelements.com';
const GIFT_QUIET_MS = 3000; // sans nouveau sub offert pendant 3 s → on envoie le groupe
const GIFT_MAX_MS = 20000; // au plus 20 s d'attente pour un gros don de subs

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
    this.gifts = new Map(); // regroupement des subs offerts : « pseudo|tier » → groupe
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

  giftGroup(sender, tier, base) {
    const key = `${String(sender).toLowerCase()}|${tier}`;
    let g = this.gifts.get(key);
    if (!g) {
      g = { key, sender, tier, individual: 0, purchase: 0, id: base.id, started: Date.now(), timer: null };
      this.gifts.set(key, g);
    }
    if (g.sender === 'Anonyme' || /^[a-z0-9_]+$/.test(g.sender)) g.sender = sender; // garde le nom affiché si possible
    return g;
  }

  scheduleGiftFlush(sender, tier) {
    const g = this.gifts.get(`${String(sender).toLowerCase()}|${tier}`);
    if (!g) return;
    clearTimeout(g.timer);
    const complete = g.purchase > 0 && g.individual >= g.purchase;
    const wait = complete ? 0 : Math.max(0, Math.min(GIFT_QUIET_MS, g.started + GIFT_MAX_MS - Date.now()));
    g.timer = setTimeout(() => this.flushGift(g), wait);
    if (g.timer.unref) g.timer.unref();
  }

  flushGift(g) {
    if (this.gifts.get(g.key) !== g) return;
    this.gifts.delete(g.key);
    const count = Math.max(g.individual, g.purchase);
    if (count > 0) this.onEvent({ source: 'streamelements', id: g.id, type: 'gift', tier: g.tier, count, user: g.sender });
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
          // Sub offert à une personne : regroupé avec les autres subs offerts par la même personne.
          this.giftGroup(gifter || 'Anonyme', tier, base).individual++;
          this.scheduleGiftFlush(gifter || 'Anonyme', tier);
        } else {
          this.onEvent({ ...base, type: 'sub', tier, months: Number(d.amount) || 1, user });
        }
        return;
      }
      case 'communityGiftPurchase': {
        // « X offre 20 subs » : StreamElements envoie cet achat ET, souvent, chaque sub séparément.
        // Tout est fusionné en UNE seule notification de 20 subs.
        const sender = d.displayName || d.sender || d.username || user;
        const g = this.giftGroup(sender, normalizeTier(d.tier), base);
        g.purchase += Math.max(1, Math.floor(Number(d.amount) || 1));
        this.scheduleGiftFlush(sender, g.tier);
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
