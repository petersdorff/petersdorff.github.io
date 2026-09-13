/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Babygeschrei (Web Audio)

   Für die Abspiel-Funktion des Zeitstrahls: je Geburt ein kurzes
   Schreien (1–2 s). Jeder Ruf ist eine eigene Stimme, Überlagerungen
   werden nicht abgebrochen — es wird einfach lauter und wilder.
   Liegt `assets/sounds/baby-cry.mp3` im Repo, wird die Aufnahme
   benutzt (mit leicht zufälliger Tonhöhe), sonst ein synthetisches
   „wäh-wäh" aus Oszillatoren + Formantfilter. Alles offline-fähig.
   ═══════════════════════════════════════════════════════════ */

const BabyCry = (() => {
  let ctx = null, master = null;
  let sample = null, sampleTried = false;
  let voices = 0;

  /** AudioContext erst bei einer Nutzergeste anlegen (Autoplay-Regeln). */
  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // Leichter Kompressor gegen hartes Übersteuern — die Summe darf
      // trotzdem deutlich lauter werden, wenn viele gleichzeitig schreien.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(comp); comp.connect(ctx.destination);
      loadSample();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  async function loadSample() {
    if (sampleTried) return;
    sampleTried = true;
    try {
      const res = await fetch('assets/sounds/baby-cry.mp3', { cache: 'force-cache' });
      if (!res.ok) return;
      sample = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch { sample = null; }
  }

  /** Deterministischer Zufall je Baby (gleiches Kind → gleiche Stimme). */
  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** Ein Schreien starten (Start optional verzögert, Sekunden). */
  function play(seed = Math.random(), delay = 0) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + Math.max(0, delay);
    const rand = rng(seed);
    voices++;
    const done = () => { voices = Math.max(0, voices - 1); };
    if (sample) playSample(c, t0, rand, done); else playSynth(c, t0, rand, done);
  }

  function playSample(c, t0, rand, done) {
    const src = c.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = 0.9 + rand() * 0.25;   // jedes Baby klingt etwas anders
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(g); g.connect(master);
    const dur = Math.min(sample.duration / src.playbackRate.value, 2.0);
    g.gain.setValueAtTime(0.9, t0 + dur - 0.15);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.start(t0); src.stop(t0 + dur);
    src.onended = done;
  }

  /** Synthetisches Babygeschrei: 2–3 Silben „wäh", Tonhöhe steigt und
      fällt, Vibrato, Formantfilter, etwas Atemrauschen. */
  function playSynth(c, t0, rand, done) {
    const base = 380 + rand() * 170;             // Grundton je Baby
    const syllables = 2 + (rand() < 0.4 ? 1 : 0);
    let t = t0;
    const voice = c.createGain();
    voice.gain.value = 0.55;
    // Formanten (Kehle/Mund) + weiche Höhen
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 850 + rand() * 250; f1.Q.value = 0.9;
    const f2 = c.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 2400; f2.gain.value = 6; f2.Q.value = 1.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
    voice.connect(f1); f1.connect(f2); f2.connect(lp); lp.connect(master);

    const vib = c.createOscillator(); vib.frequency.value = 5.5 + rand() * 2;
    const vibGain = c.createGain(); vibGain.gain.value = base * 0.035;
    vib.connect(vibGain);

    let end = t0;
    for (let i = 0; i < syllables; i++) {
      const dur = 0.45 + rand() * 0.3;
      const peak = base * (1.15 + rand() * 0.2);
      const osc1 = c.createOscillator(); osc1.type = 'sawtooth';
      const osc2 = c.createOscillator(); osc2.type = 'square'; osc2.detune.value = 8 + rand() * 10;
      for (const o of [osc1, osc2]) {
        o.frequency.setValueAtTime(base * 0.8, t);
        o.frequency.exponentialRampToValueAtTime(peak, t + dur * 0.3);
        o.frequency.exponentialRampToValueAtTime(base * 0.65, t + dur);
        vibGain.connect(o.frequency);
      }
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.05);
      env.gain.setValueAtTime(1, t + dur * 0.75);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc1.connect(env); osc2.connect(env); env.connect(voice);
      // Atemrauschen
      const noise = c.createBufferSource();
      noise.buffer = noiseBuffer(c);
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.7;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.06, t); ng.gain.linearRampToValueAtTime(0.0001, t + dur);
      noise.connect(nf); nf.connect(ng); ng.connect(voice);
      osc1.start(t); osc2.start(t); noise.start(t);
      osc1.stop(t + dur + 0.02); osc2.stop(t + dur + 0.02); noise.stop(t + dur + 0.02);
      end = t + dur;
      t = end + 0.1 + rand() * 0.1;
      if (i === syllables - 1) osc1.onended = done;
    }
    vib.start(t0); vib.stop(end + 0.1);
  }

  let noiseBuf = null;
  function noiseBuffer(c) {
    if (noiseBuf) return noiseBuf;
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  return { play, ensureContext, activeVoices: () => voices, hasSample: () => !!sample };
})();
