'use strict';
// Sons du Lunaria Timer, générés à la volée (Web Audio) : fonctionnent hors ligne, sans fichier.
// « file:nom.mp3 » joue un fichier du dossier sounds/.
window.LunariaSound = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function out(volume) {
    const c = ac();
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume / 100));
    g.connect(c.destination);
    return g;
  }
  function tone(dest, freq, t, { type = 'sine', attack = 0.005, decay = 0.6, gain = 0.3 } = {}) {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }
  function click(dest, t, freq, gain = 0.5) {
    const c = ac();
    const len = Math.floor(c.sampleRate * 0.03);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 6;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
  }
  function bell(dest, t, f, gain = 0.35, length = 2.6) {
    [[1, 1], [2, 0.5], [2.76, 0.35], [5.4, 0.18], [8.93, 0.08]].forEach(([m, a], i) => {
      tone(dest, f * m, t, { attack: 0.003, decay: length / (1 + i * 0.6), gain: gain * a });
    });
  }
  const presets = {
    // --- temps ajouté ---
    clock(d, t) {
      [2600, 1800, 2600, 1800, 2600].forEach((f, i) => click(d, t + i * 0.14, f, 0.7));
    },
    chime(d, t) {
      [1318.5, 1568, 1975.5].forEach((f, i) => {
        tone(d, f, t + i * 0.09, { decay: 0.9, gain: 0.22 });
        tone(d, f * 2, t + i * 0.09, { type: 'triangle', decay: 0.4, gain: 0.05 });
      });
    },
    crystal(d, t) {
      [2093, 2637, 3136, 4186].forEach((f, i) => tone(d, f, t + i * 0.05, { decay: 1.1, gain: 0.1 }));
    },
    magic(d, t) {
      [784, 880, 1047, 1175, 1319, 1568, 1760, 2093].forEach((f, i) => tone(d, f, t + i * 0.045, { type: 'triangle', decay: 0.5, gain: 0.12 }));
    },
    // --- fin du timer ---
    bell(d, t) {
      bell(d, t, 523.25);
      bell(d, t + 0.7, 659.25, 0.3);
      bell(d, t + 1.4, 783.99, 0.3, 3.5);
    },
    harp(d, t) {
      [261.6, 329.6, 392, 523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        tone(d, f, t + i * 0.08, { type: 'triangle', decay: 1.8, gain: 0.16 });
      });
    },
    gong(d, t) {
      [1, 1.48, 2.1, 2.9, 3.7].forEach((m, i) => tone(d, 98 * m, t, { attack: 0.03, decay: 5 - i * 0.7, gain: 0.3 / (i + 1) }));
      click(d, t, 400, 0.6);
    },
    fanfare(d, t) {
      const chords = [[523.3, 659.3, 784], [587.3, 740, 880], [784, 987.8, 1175, 1568]];
      chords.forEach((ch, i) => ch.forEach((f) => tone(d, f, t + i * 0.32, { type: 'triangle', attack: 0.03, decay: i === 2 ? 2.2 : 0.35, gain: 0.12 })));
    },
    clockEnd(d, t) {
      for (let i = 0; i < 6; i++) click(d, t + i * 0.25, i % 2 ? 1800 : 2600, 0.7);
      bell(d, t + 1.6, 880, 0.35, 3);
    },
  };
  let lastPlay = 0;
  function play(name, volume) {
    if (!name || name === 'none' || volume <= 0) return;
    if (name.startsWith('file:')) {
      const a = new Audio('sounds/' + encodeURIComponent(name.slice(5)));
      a.volume = Math.max(0, Math.min(1, volume / 100));
      a.play().catch(() => {});
      return;
    }
    const fn = presets[name === 'clock' && arguments[2] === 'end' ? 'clockEnd' : name];
    if (!fn) return;
    // Évite la cacophonie quand plusieurs subs arrivent en même temps.
    const now = performance.now();
    if (arguments[2] !== 'end' && now - lastPlay < 250) return;
    lastPlay = now;
    try {
      const c = ac();
      fn(out(volume), c.currentTime + 0.02);
    } catch (_) { /* audio indisponible */ }
  }
  return { play };
})();
