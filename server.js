'use strict';
/*
 * Lunaria Timer — serveur (Node.js 16+, aucune dépendance à installer).
 *
 *   node server.js                      → lance le serveur seul
 *   require('./lunaria-timer/server')   → le lance depuis votre bot Discord
 *
 * Pages :  /overlay  (source navigateur OBS)   /panel  (panneau de contrôle)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Timer, loadConfig, loadState, mergeConfig } = require('./lib/timer');
const { StreamElements } = require('./lib/streamelements');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.LUNARIA_DATA_DIR || path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const log = (...a) => console.log('[Lunaria]', ...a);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log(`Lecture impossible de ${path.basename(file)} : ${err.message}`);
    return null;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const STATIC = {
  '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
  '/overlay.html': ['overlay.html', 'text/html; charset=utf-8'],
  '/panel': ['panel.html', 'text/html; charset=utf-8'],
  '/panel.html': ['panel.html', 'text/html; charset=utf-8'],
  '/fonts.css': ['fonts.css', 'text/css; charset=utf-8'],
};

function start(options = {}) {
  // ---------- Configuration et état ----------
  const config = loadConfig(readJson(CONFIG_FILE));
  let firstRun = false;
  if (!config.adminKey) {
    config.adminKey = crypto.randomBytes(9).toString('base64url');
    firstRun = true;
  }
  if (process.env.LUNARIA_ADMIN_KEY) config.adminKey = process.env.LUNARIA_ADMIN_KEY;
  if (process.env.STREAMELEMENTS_JWT) {
    config.streamelements.jwt = process.env.STREAMELEMENTS_JWT;
    config.streamelements.enabled = true;
  }
  const state = loadState(readJson(STATE_FILE));

  let saveTimer = null;
  const saveAll = () => {
    try {
      writeJsonAtomic(CONFIG_FILE, config);
      writeJsonAtomic(STATE_FILE, state);
    } catch (err) {
      log(`Sauvegarde impossible : ${err.message}`);
    }
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAll, 800);
  };
  if (firstRun) saveAll();

  // ---------- Diffusion en direct (Server-Sent Events) ----------
  const clients = new Set(); // { res, admin }
  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data, adminOnly = false) => {
    for (const c of clients) if (!adminOnly || c.admin) send(c.res, event, data);
  };

  const timer = new Timer({
    config,
    state,
    onChange: (reason, popup) => {
      broadcast('state', timer.publicState());
      broadcast('log', state.log.slice(0, 50), true);
      if (popup && config.display.showPopups) broadcast('added', popup);
      scheduleSave();
    },
  });

  const se = new StreamElements({
    url: process.env.LUNARIA_SE_URL || undefined,
    getConfig: () => config.streamelements,
    onEvent: (ev) => {
      log(`Événement ${ev.type} de ${ev.user}`);
      timer.handleEvent(ev);
    },
    onStatus: (st) => {
      log(`StreamElements : ${st.message}`);
      broadcast('se', st, true);
    },
    log,
  });

  const tick = setInterval(() => timer.tick(), 250);
  const heartbeat = setInterval(() => broadcast('state', timer.publicState()), 15000);

  // ---------- Sécurité ----------
  const failures = new Map(); // ip -> { n, until }
  const clientIp = (req) => req.socket.remoteAddress || '?';
  function isLocked(req) {
    const f = failures.get(clientIp(req));
    return f && f.until > Date.now();
  }
  function checkKey(req, key) {
    if (isLocked(req)) return false;
    const a = Buffer.from(String(key || ''));
    const b = Buffer.from(config.adminKey);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      const ip = clientIp(req);
      const f = failures.get(ip) || { n: 0, until: 0 };
      f.n++;
      if (f.n >= 8) {
        f.until = Date.now() + 5 * 60 * 1000;
        f.n = 0;
        log(`Trop d'essais de clé depuis ${ip} : bloqué 5 minutes.`);
      }
      failures.set(ip, f);
    } else {
      failures.delete(clientIp(req));
    }
    return ok;
  }

  function adminView() {
    return {
      config: {
        ...config,
        adminKey: undefined,
        streamelements: { enabled: config.streamelements.enabled, hasJwt: !!config.streamelements.jwt },
      },
      state: timer.publicState(),
      log: state.log.slice(0, 50),
      se: se.status,
    };
  }

  // ---------- Actions du panneau ----------
  function runAction(body) {
    const a = body.action;
    switch (a) {
      case 'start': timer.start(); break;
      case 'pause': timer.pause(); break;
      case 'reset': timer.reset(body.minutes); break;
      case 'set': timer.setRemaining(body.seconds); break;
      case 'add': timer.manual(body.seconds, typeof body.note === 'string' ? body.note.slice(0, 40) : ''); break;
      case 'mode': timer.setMode(body.mode); break;
      case 'resetStats': timer.resetStats(); break;
      case 'test': {
        const ev = normalizeIncoming(body.event);
        ev.test = true;
        timer.handleEvent(ev);
        break;
      }
      case 'reconnect': se.restart(); break;
      default: throw new Error('Action inconnue');
    }
  }

  function normalizeIncoming(e) {
    if (!e || typeof e !== 'object') throw new Error('Événement manquant');
    const type = String(e.type || '');
    const tierIn = String(e.tier || '1').toLowerCase();
    const tier = ['1', '2', '3', 'prime'].includes(tierIn) ? tierIn : '1';
    const user = typeof e.user === 'string' && e.user.trim() ? e.user.trim().slice(0, 40) : 'Anonyme';
    switch (type) {
      case 'sub': return { type, tier, user, source: 'api' };
      case 'gift': return { type, tier, user, count: Math.max(1, Math.min(1000, Math.floor(Number(e.count) || 1))), source: 'api' };
      case 'bits': return { type, user, amount: Math.max(0, Math.floor(Number(e.amount) || 0)), source: 'api' };
      case 'tip': return { type, user, amount: Math.max(0, Number(e.amount) || 0), currency: typeof e.currency === 'string' ? e.currency.slice(0, 5) : '', source: 'api' };
      default: throw new Error('Type d’événement inconnu (sub, gift, bits, tip)');
    }
  }

  // ---------- Serveur HTTP ----------
  function readBody(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body); // déjà lu par express.json()
    if (req.readableEnded) return Promise.resolve({});
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(new Error('Requête trop grande'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('JSON invalide')); }
      });
      req.on('error', reject);
    });
  }

  function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  // Traite une requête. `base` = préfixe d'URL quand le timer partage le serveur web d'un autre module (ex. « /timer »).
  async function handle(req, res, base = '') {
    const url = new URL(req.originalUrl || req.url, 'http://localhost');
    const p = url.pathname.slice(base.length) || '/';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method === 'GET' && (p === '/' || p === '')) {
        res.writeHead(302, { Location: `${base}/panel` });
        return res.end();
      }
      if (req.method === 'GET' && STATIC[p]) {
        const [file, type] = STATIC[p];
        const body = fs.readFileSync(path.join(PUBLIC_DIR, file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file === 'fonts.css' ? 'public, max-age=86400' : 'no-cache' });
        return res.end(body);
      }
      if (req.method === 'GET' && p === '/api/state') return json(res, 200, timer.publicState());

      if (req.method === 'GET' && p === '/api/stream') {
        const key = url.searchParams.get('key');
        const admin = key ? checkKey(req, key) : false;
        if (key && !admin) return json(res, 401, { error: 'Clé incorrecte' });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        const client = { res, admin };
        clients.add(client);
        send(res, 'state', timer.publicState());
        if (admin) {
          send(res, 'log', state.log.slice(0, 50));
          send(res, 'se', se.status);
        }
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(client);
        });
        return;
      }

      if (p.startsWith('/api/admin/') || p === '/api/event') {
        const key = req.headers['x-lunaria-key'] || url.searchParams.get('key');
        if (isLocked(req)) return json(res, 429, { error: 'Trop d’essais, réessayez dans quelques minutes' });
        if (!checkKey(req, key)) return json(res, 401, { error: 'Clé incorrecte' });

        if (req.method === 'GET' && p === '/api/admin/config') return json(res, 200, adminView());

        if (req.method === 'POST' && p === '/api/admin/config') {
          const body = await readBody(req);
          const before = JSON.stringify(config.streamelements);
          const next = mergeConfig(config, body);
          Object.assign(config, next, { adminKey: config.adminKey, port: config.port });
          // Si le mode n'a pas démarré, on applique la nouvelle durée de départ.
          if (state.status === 'idle' && !state.startedAt && (body.countdown || body.athon)) state.remainingMs = timer.defaultDurationMs();
          if (JSON.stringify(config.streamelements) !== before) se.restart();
          timer.onChange('config');
          saveAll();
          return json(res, 200, adminView());
        }

        if (req.method === 'POST' && p === '/api/admin/action') {
          const body = await readBody(req);
          runAction(body);
          return json(res, 200, adminView());
        }

        // Pour votre bot Discord ou un autre outil : POST /api/event
        //   { "type": "sub", "tier": "1", "user": "Pseudo" }   ou   { "seconds": 300, "note": "Bonus" }
        if (req.method === 'POST' && p === '/api/event') {
          const body = await readBody(req);
          let added;
          if (body.seconds != null) added = timer.manual(body.seconds, typeof body.note === 'string' ? body.note.slice(0, 40) : 'Bot');
          else added = timer.handleEvent(normalizeIncoming(body));
          return json(res, 200, { ok: true, addedSeconds: Math.round((added || 0) / 1000), remainingSeconds: Math.round(timer.remainingMs() / 1000) });
        }
      }

      json(res, 404, { error: 'Introuvable' });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  }

  let server = null;
  function listen() {
    if (server) return server;
    server = http.createServer((req, res) => handle(req, res));
    const port = Number(options.port || process.env.LUNARIA_PORT || process.env.SERVER_PORT || process.env.PORT || config.port || 3000);
    server.listen(port, '0.0.0.0', () => {
      log(`Serveur lancé sur le port ${port}`);
      log(`  Panneau : http://<ip-du-serveur>:${port}/panel`);
      log(`  OBS     : http://<ip-du-serveur>:${port}/overlay`);
    });
    server.on('error', (err) => {
      log(err.code === 'EADDRINUSE'
        ? `Le port ${port} est déjà utilisé (par exemple par un autre site du bot). Branchez le timer sur ce site avec .middleware (voir README.md) ou choisissez un autre port avec LUNARIA_PORT.`
        : `Erreur du serveur : ${err.message}`);
    });
    return server;
  }

  /** Middleware Express / connect : sert le timer sous `base` (par défaut /timer) sur un serveur existant. */
  function middleware(base = '/timer') {
    base = '/' + String(base).replace(/^\/+|\/+$/g, '');
    return (req, res, next) => {
      const pathname = (req.originalUrl || req.url).split('?')[0];
      if (pathname === base || pathname.startsWith(base + '/')) {
        if (pathname === base) {
          res.writeHead(302, { Location: `${base}/panel` });
          return res.end();
        }
        return handle(req, res, base);
      }
      if (typeof next === 'function') next();
      else {
        res.writeHead(404);
        res.end();
      }
    };
  }

  if (firstRun) log(`Clé du panneau (à garder secrète) : ${config.adminKey}`);
  else log('Clé du panneau : voir data/config.json (champ "adminKey")');

  se.restart();

  const stop = () => {
    clearInterval(tick);
    clearInterval(heartbeat);
    clearTimeout(saveTimer);
    se.stop(true);
    for (const c of clients) c.res.end();
    saveAll();
    return new Promise((r) => (server ? server.close(r) : r()));
  };

  // API utilisable depuis votre bot Discord.
  return {
    get server() { return server; },
    listen,
    middleware,
    handle,
    timer,
    stop,
    /** Ajoute (ou retire) du temps en secondes. */
    addTime: (seconds, note) => timer.manual(seconds, note),
    /** Envoie un événement : { type: 'sub'|'gift'|'bits'|'tip', tier, count, amount, user } */
    event: (e) => timer.handleEvent(normalizeIncoming(e)),
    remainingSeconds: () => Math.round(timer.remainingMs() / 1000),
  };
}

let instance = null;
let mounted = false;
function getInstance(options) {
  if (!instance) instance = start(options);
  return instance;
}

if (require.main === module) {
  const inst = getInstance();
  inst.listen();
  const shutdown = () => inst.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else if (!process.env.LUNARIA_NO_AUTOSTART) {
  // Chargé avec require() depuis un bot : le timer démarre, et ouvre son propre port
  // sauf s'il a été branché sur un serveur existant via .middleware().
  getInstance();
  setImmediate(() => { if (!mounted) instance.listen(); });
}

module.exports = {
  start: getInstance,
  get lunaria() { return instance; },
  /** app.use(require('./timer/server.js').middleware()) : partage le port d'un serveur Express existant. */
  middleware(base) {
    mounted = true;
    return getInstance().middleware(base);
  },
};
