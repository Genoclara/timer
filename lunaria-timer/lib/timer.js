'use strict';
// Moteur du timer : modes, règles de temps par événement, pause, plafond, statistiques.

const KINDS = ['lunariathon', 'subathon', 'donathon'];

const DEFAULT_CONFIG = {
  port: 3000,
  adminKey: '',
  streamelements: { enabled: false, jwt: '' },
  countdown: {
    minutes: 5,
    top: 'le stream commence dans',
    bottom: '',
    endText: 'Lunaria s’éveille…',
  },
  athon: {
    kind: 'lunariathon',
    titles: { lunariathon: 'Lunariathon', subathon: 'Subathon', donathon: 'Donathon' },
    subtitle: 'le royaume de Lunaria veille',
    startMinutes: 120,
    // Événements qui ajoutent du temps, pour chaque mode.
    counts: {
      lunariathon: { subs: true, gifts: true, bits: true, tips: true },
      subathon: { subs: true, gifts: true, bits: false, tips: false },
      donathon: { subs: false, gifts: false, bits: true, tips: true },
    },
    // Temps ajouté, en secondes.
    values: {
      t1: 300,
      t2: 600,
      t3: 1500,
      prime: 300,
      bitsPer: 100,
      bitsSeconds: 60,
      tipPer: 1,
      tipSeconds: 60,
      tipMin: 1,
    },
    currency: '€',
    multiplier: 1, // « Pleine lune » : ×2, ×3…
    maxHours: 0, // durée totale maximale (0 = illimitée)
    endText: 'Lunaria s’endort… merci ✦',
  },
  display: {
    accent: '#b36bff',
    scale: 1,
    showTitle: true,
    showRules: true,
    showPopups: true,
    showStats: false,
  },
};

const DEFAULT_STATE = {
  mode: 'countdown', // countdown | athon
  status: 'idle', // idle | running | paused | ended
  endAt: 0,
  remainingMs: 5 * 60 * 1000,
  startedAt: 0,
  pausedAt: 0,
  pausedTotalMs: 0,
  stats: { t1: 0, t2: 0, t3: 0, prime: 0, gifts: 0, bits: 0, tips: 0, addedMs: 0, events: 0 },
  log: [],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function num(v, fallback, min = -Infinity, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v, fallback, maxLen = 200) {
  if (typeof v !== 'string') return fallback;
  return v.slice(0, maxLen);
}

/** Fusionne une modification de configuration en validant chaque champ. */
function mergeConfig(base, patch) {
  const c = clone(base);
  if (!patch || typeof patch !== 'object') return c;
  const p = patch;

  if (p.streamelements) {
    if ('enabled' in p.streamelements) c.streamelements.enabled = !!p.streamelements.enabled;
    if (typeof p.streamelements.jwt === 'string' && p.streamelements.jwt.trim()) c.streamelements.jwt = p.streamelements.jwt.trim().slice(0, 4000);
    if (p.streamelements.clearJwt) c.streamelements.jwt = '';
  }
  if (p.countdown) {
    const s = p.countdown;
    c.countdown.minutes = num(s.minutes, c.countdown.minutes, 0, 24 * 60);
    c.countdown.top = str(s.top, c.countdown.top);
    c.countdown.bottom = str(s.bottom, c.countdown.bottom);
    c.countdown.endText = str(s.endText, c.countdown.endText);
  }
  if (p.athon) {
    const a = p.athon;
    if (KINDS.includes(a.kind)) c.athon.kind = a.kind;
    if (a.titles) for (const k of KINDS) c.athon.titles[k] = str(a.titles[k], c.athon.titles[k], 60);
    c.athon.subtitle = str(a.subtitle, c.athon.subtitle);
    c.athon.startMinutes = num(a.startMinutes, c.athon.startMinutes, 0, 60 * 24 * 30);
    if (a.counts) {
      for (const k of KINDS) {
        if (!a.counts[k]) continue;
        for (const e of ['subs', 'gifts', 'bits', 'tips']) {
          if (e in a.counts[k]) c.athon.counts[k][e] = !!a.counts[k][e];
        }
      }
    }
    if (a.values) {
      const v = a.values;
      const cv = c.athon.values;
      for (const k of ['t1', 't2', 't3', 'prime', 'bitsSeconds', 'tipSeconds']) cv[k] = num(v[k], cv[k], 0, 7 * 24 * 3600);
      cv.bitsPer = num(v.bitsPer, cv.bitsPer, 1, 1e6);
      cv.tipPer = num(v.tipPer, cv.tipPer, 0.01, 1e6);
      cv.tipMin = num(v.tipMin, cv.tipMin, 0, 1e6);
    }
    c.athon.currency = str(a.currency, c.athon.currency, 5);
    c.athon.multiplier = num(a.multiplier, c.athon.multiplier, 0, 10);
    c.athon.maxHours = num(a.maxHours, c.athon.maxHours, 0, 24 * 365);
    c.athon.endText = str(a.endText, c.athon.endText);
  }
  if (p.display) {
    const d = p.display;
    if (typeof d.accent === 'string' && /^#[0-9a-f]{6}$/i.test(d.accent)) c.display.accent = d.accent;
    c.display.scale = num(d.scale, c.display.scale, 0.3, 3);
    for (const k of ['showTitle', 'showRules', 'showPopups', 'showStats']) if (k in d) c.display[k] = !!d[k];
  }
  return c;
}

/** Complète une configuration chargée depuis le disque avec les valeurs par défaut. */
function loadConfig(raw) {
  const c = mergeConfig(DEFAULT_CONFIG, raw || {});
  if (raw && typeof raw.adminKey === 'string') c.adminKey = raw.adminKey;
  if (raw && raw.port != null) c.port = num(raw.port, DEFAULT_CONFIG.port, 1, 65535);
  if (raw && raw.streamelements && typeof raw.streamelements.jwt === 'string') c.streamelements.jwt = raw.streamelements.jwt;
  return c;
}

function loadState(raw) {
  const s = clone(DEFAULT_STATE);
  if (!raw || typeof raw !== 'object') return s;
  if (['countdown', 'athon'].includes(raw.mode)) s.mode = raw.mode;
  if (['idle', 'running', 'paused', 'ended'].includes(raw.status)) s.status = raw.status;
  for (const k of ['endAt', 'remainingMs', 'startedAt', 'pausedAt', 'pausedTotalMs']) s[k] = num(raw[k], s[k], 0);
  if (raw.stats) for (const k of Object.keys(s.stats)) s.stats[k] = num(raw.stats[k], 0, 0);
  if (Array.isArray(raw.log)) s.log = raw.log.slice(0, 100);
  return s;
}

const TIER_LABEL = { 1: 'Sub T1', 2: 'Sub T2', 3: 'Sub T3', prime: 'Sub Prime' };

function fmtAmount(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}

class Timer {
  constructor({ config, state, onChange, now = () => Date.now() }) {
    this.config = config;
    this.state = state;
    this.onChange = onChange || (() => {});
    this.now = now;
  }

  remainingMs() {
    const s = this.state;
    if (s.status === 'running') return Math.max(0, s.endAt - this.now());
    if (s.status === 'ended') return 0;
    return Math.max(0, s.remainingMs);
  }

  /** Vérifie si le timer est arrivé à zéro. Renvoie true si l'état a changé. */
  tick() {
    const s = this.state;
    if (s.status === 'running' && this.now() >= s.endAt) {
      s.status = 'ended';
      s.remainingMs = 0;
      this.pushLog({ kind: 'system', text: s.mode === 'athon' ? 'Fin du timer' : 'Compte à rebours terminé' });
      this.onChange('ended');
      return true;
    }
    return false;
  }

  capEndAt(endAt) {
    const s = this.state;
    const cap = this.config.athon.maxHours;
    if (s.mode !== 'athon' || !cap || !s.startedAt) return endAt;
    const pausedNow = s.status === 'paused' && s.pausedAt ? this.now() - s.pausedAt : 0;
    const limit = s.startedAt + cap * 3600 * 1000 + s.pausedTotalMs + pausedNow;
    return Math.min(endAt, limit);
  }

  /** Ajoute (ou retire si négatif) du temps. Renvoie les ms réellement ajoutées. */
  addMs(ms) {
    const s = this.state;
    if (s.status === 'ended') return 0;
    const before = this.remainingMs();
    if (s.status === 'running') {
      s.endAt = this.capEndAt(Math.max(this.now(), s.endAt + ms));
      s.remainingMs = Math.max(0, s.endAt - this.now());
    } else {
      let rem = Math.max(0, s.remainingMs + ms);
      if (s.startedAt) rem = Math.max(0, this.capEndAt(this.now() + rem) - this.now());
      s.remainingMs = rem;
    }
    return this.remainingMs() - before;
  }

  pushLog(entry) {
    this.state.log.unshift({ at: this.now(), ...entry });
    if (this.state.log.length > 100) this.state.log.length = 100;
  }

  // ---- Actions ----

  setMode(mode) {
    if (!['countdown', 'athon'].includes(mode)) throw new Error('Mode inconnu');
    const s = this.state;
    s.mode = mode;
    s.status = 'idle';
    s.startedAt = 0;
    s.pausedAt = 0;
    s.pausedTotalMs = 0;
    s.endAt = 0;
    s.remainingMs = this.defaultDurationMs();
    this.pushLog({ kind: 'system', text: mode === 'athon' ? `Mode ${this.title()} prêt` : 'Mode Starting Soon prêt' });
    this.onChange('mode');
  }

  defaultDurationMs() {
    return this.state.mode === 'athon'
      ? this.config.athon.startMinutes * 60000
      : this.config.countdown.minutes * 60000;
  }

  start() {
    const s = this.state;
    if (s.status === 'running') return;
    if (s.status === 'ended') s.remainingMs = this.defaultDurationMs();
    if (!s.startedAt || s.status === 'ended') {
      s.startedAt = this.now();
      s.pausedTotalMs = 0;
    }
    if (s.status === 'paused' && s.pausedAt) s.pausedTotalMs += this.now() - s.pausedAt;
    s.pausedAt = 0;
    s.status = 'running';
    s.endAt = this.now() + s.remainingMs;
    this.pushLog({ kind: 'system', text: 'Timer lancé' });
    this.onChange('start');
  }

  pause() {
    const s = this.state;
    if (s.status !== 'running') return;
    s.remainingMs = Math.max(0, s.endAt - this.now());
    s.status = 'paused';
    s.pausedAt = this.now();
    this.pushLog({ kind: 'system', text: 'Timer en pause' });
    this.onChange('pause');
  }

  reset(minutes) {
    const s = this.state;
    s.status = 'idle';
    s.startedAt = 0;
    s.pausedAt = 0;
    s.pausedTotalMs = 0;
    s.endAt = 0;
    s.remainingMs = minutes != null ? num(minutes, 0, 0) * 60000 : this.defaultDurationMs();
    this.pushLog({ kind: 'system', text: 'Timer réinitialisé' });
    this.onChange('reset');
  }

  resetStats() {
    this.state.stats = clone(DEFAULT_STATE.stats);
    this.state.log = [];
    this.onChange('stats');
  }

  /** Fixe le temps restant (en secondes). */
  setRemaining(seconds) {
    const s = this.state;
    const ms = Math.max(0, num(seconds, 0, 0) * 1000);
    if (s.status === 'ended') s.status = 'idle';
    if (s.status === 'running') s.endAt = this.now() + ms;
    s.remainingMs = ms;
    this.pushLog({ kind: 'system', text: `Temps réglé sur ${fmtDuration(ms)}` });
    this.onChange('set');
  }

  manual(seconds, note) {
    const ms = Math.round(num(seconds, 0) * 1000);
    if (!ms) return null;
    const added = this.addMs(ms);
    const text = `${note || 'Ajustement manuel'} ${added >= 0 ? '+' : '−'}${fmtDuration(Math.abs(added))}`;
    this.pushLog({ kind: 'manual', text, ms: added });
    this.onChange('manual', { user: note || 'Ajustement', label: added >= 0 ? 'Temps ajouté' : 'Temps retiré', ms: added });
    return added;
  }

  title() {
    return this.config.athon.titles[this.config.athon.kind] || 'Lunariathon';
  }

  /** Calcule le temps (secondes) qu'un événement ajoute selon le mode actuel. */
  secondsFor(ev) {
    const a = this.config.athon;
    const counts = a.counts[a.kind] || {};
    const v = a.values;
    const tierValue = (t) => (t === 'prime' ? v.prime : v['t' + t] || v.t1);
    let sec = 0;
    switch (ev.type) {
      case 'sub':
        if (counts.subs) sec = tierValue(ev.tier);
        break;
      case 'gift':
        if (counts.gifts) sec = tierValue(ev.tier) * Math.max(1, ev.count || 1);
        break;
      case 'bits':
        if (counts.bits && ev.amount > 0) sec = (ev.amount / v.bitsPer) * v.bitsSeconds;
        break;
      case 'tip':
        if (counts.tips && ev.amount >= v.tipMin && ev.amount > 0) sec = (ev.amount / v.tipPer) * v.tipSeconds;
        break;
      default:
    }
    return Math.round(sec * a.multiplier);
  }

  describe(ev) {
    switch (ev.type) {
      case 'sub': return TIER_LABEL[ev.tier] || 'Sub';
      case 'gift': return `${ev.count > 1 ? ev.count + ' subs offerts' : 'Sub offert'} T${ev.tier === 'prime' ? '1' : ev.tier}`;
      case 'bits': return `${ev.amount} bits`;
      case 'tip': return `Don de ${fmtAmount(ev.amount)} ${ev.currency || this.config.athon.currency}`.trim();
      default: return 'Événement';
    }
  }

  /** Applique un événement (sub, don, bits…) venant de StreamElements, d'un test ou du bot. */
  handleEvent(ev) {
    const s = this.state;
    const label = this.describe(ev);
    const user = String(ev.user || 'Anonyme').slice(0, 40);
    if (!ev.test) {
      const st = s.stats;
      st.events++;
      if (ev.type === 'sub') st[ev.tier === 'prime' ? 'prime' : 't' + ev.tier]++;
      if (ev.type === 'gift') st.gifts += Math.max(1, ev.count || 1);
      if (ev.type === 'bits') st.bits += ev.amount;
      if (ev.type === 'tip') st.tips = Math.round((st.tips + ev.amount) * 100) / 100;
    }
    let added = 0;
    let note = '';
    if (s.mode !== 'athon') note = 'pas de temps ajouté (mode Starting Soon)';
    else if (s.status === 'ended') note = 'pas de temps ajouté (timer terminé)';
    else {
      const sec = this.secondsFor(ev);
      if (sec > 0) added = this.addMs(sec * 1000);
      if (!sec) note = 'ne compte pas dans ce mode';
      else if (added < sec * 1000) note = 'plafond atteint';
    }
    if (added > 0 && !ev.test) s.stats.addedMs += added;
    const text = `${user} — ${label}${added > 0 ? ` +${fmtDuration(added)}` : ''}${note ? ` (${note})` : ''}${ev.test ? ' [test]' : ''}`;
    this.pushLog({ kind: 'event', type: ev.type, text, ms: added, test: !!ev.test });
    this.onChange('event', added > 0 ? { user, label, ms: added } : null);
    return added;
  }

  publicState() {
    const s = this.state;
    const c = this.config;
    return {
      mode: s.mode,
      status: s.status,
      endAt: s.endAt,
      remainingMs: this.remainingMs(),
      serverNow: this.now(),
      countdown: { top: c.countdown.top, bottom: c.countdown.bottom, endText: c.countdown.endText },
      athon: {
        kind: c.athon.kind,
        title: this.title(),
        subtitle: c.athon.subtitle,
        endText: c.athon.endText,
        multiplier: c.athon.multiplier,
        rules: this.rulesSummary(),
      },
      display: c.display,
      stats: s.stats,
    };
  }

  rulesSummary() {
    const a = this.config.athon;
    const counts = a.counts[a.kind] || {};
    const v = a.values;
    const m = (sec) => fmtShort(sec * a.multiplier);
    const out = [];
    if (counts.subs || counts.gifts) {
      out.push(`Sub T1 +${m(v.t1)}`, `T2 +${m(v.t2)}`, `T3 +${m(v.t3)}`);
    }
    if (counts.tips) out.push(`${fmtAmount(v.tipPer)} ${a.currency} +${m(v.tipSeconds)}`);
    if (counts.bits) out.push(`${v.bitsPer} bits +${m(v.bitsSeconds)}`);
    return out;
  }
}

function fmtDuration(ms) {
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtShort(sec) {
  sec = Math.round(sec);
  if (sec % 3600 === 0 && sec >= 3600) return `${sec / 3600} h`;
  if (sec % 60 === 0 && sec >= 60) return `${sec / 60} min`;
  if (sec > 60) return `${Math.floor(sec / 60)} min ${sec % 60} s`;
  return `${sec} s`;
}

module.exports = { Timer, DEFAULT_CONFIG, DEFAULT_STATE, mergeConfig, loadConfig, loadState, fmtDuration, KINDS };
