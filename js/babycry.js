/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Babygeschrei (Web Audio)

   Für die Abspiel-Funktion des Zeitstrahls: je Geburt genau einmal die
   Aufnahme `assets/sounds/baby-cry.mp3` (~1 s, mono, 96 kbit/s), mit
   leicht anderer Tonhöhe je Person. Jeder Ruf ist eine eigene Stimme,
   Überlagerungen werden nicht abgebrochen — es wird einfach lauter und
   wilder. Die Datei wird beim Laden der Seite vorgeholt; Rufe, die vor
   dem Dekodieren fällig werden, warten kurz, statt anders zu klingen.
   ═══════════════════════════════════════════════════════════ */

const BabyCry = (() => {
  const SRC = 'assets/sounds/baby-cry.mp3';
  let ctx = null, master = null;
  let bytes = null;          // rohe MP3-Daten (ohne AudioContext ladbar)
  let sample = null;         // dekodierter AudioBuffer
  let loading = null;        // Promise des laufenden Ladens/Dekodierens
  let voices = 0;

  /** MP3 sofort vorholen (braucht keinen AudioContext). */
  function prefetch() {
    if (bytes || loading) return loading;
    loading = fetch(SRC)
      .then(res => { if (!res.ok) throw new Error(res.status); return res.arrayBuffer(); })
      .then(buf => { bytes = buf; })
      .catch(() => {})
      .finally(() => { loading = null; });
    return loading;
  }

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
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** Aufnahme bereitstellen: ggf. laden, dann dekodieren (einmalig). */
  async function ensureSample() {
    if (sample) return sample;
    if (!bytes) await prefetch();
    if (!bytes || !ctx) return null;
    if (!loading) {
      loading = ctx.decodeAudioData(bytes.slice(0))
        .then(buf => { sample = buf; })
        .catch(() => { bytes = null; })   // beim nächsten Ruf neu laden
        .finally(() => { loading = null; });
    }
    await loading;
    return sample;
  }

  /** Deterministischer Zufall je Baby (gleiches Kind → gleiche Stimme). */
  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** Ein Schreien starten (Start optional verzögert, Sekunden). */
  async function play(seed = Math.random(), delay = 0) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + Math.max(0, delay);
    const buf = await ensureSample();
    if (!buf) return;   // keine Aufnahme verfügbar → lieber still als anders
    const rand = rng(seed);
    voices++;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.92 + rand() * 0.16;   // jedes Baby klingt etwas anders
    const start = Math.max(t0, c.currentTime);
    const dur = buf.duration / src.playbackRate.value;
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, start);
    g.gain.setValueAtTime(0.9, start + dur - 0.08);
    g.gain.linearRampToValueAtTime(0.0001, start + dur);
    src.connect(g); g.connect(master);
    src.start(start); src.stop(start + dur);
    src.onended = () => { voices = Math.max(0, voices - 1); };
  }

  prefetch();

  return { play, ensureContext, prefetch, activeVoices: () => voices, hasSample: () => !!sample };
})();
