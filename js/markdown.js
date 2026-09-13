/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Minimaler Markdown-Renderer (Vita-Artikel)
   Unterstützt: # ## ### Überschriften, Absätze, - / * Aufzählung,
   1. Nummerierung, > Zitat, --- Trennlinie, **fett**, *kursiv*,
   [Text](https://…). HTML im Quelltext wird immer escaped (XSS).
   ═══════════════════════════════════════════════════════════ */

const Markdown = (() => {
  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Inline-Formatierung auf bereits escaptem Text. */
  function inline(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function render(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [], list = null;   // list: { type: 'ul'|'ol', items: [] }
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; } };

    for (const raw of lines) {
      const line = esc(raw.trimEnd());
      const trimmed = line.trim();
      if (!trimmed) { flushPara(); flushList(); continue; }
      let m;
      if ((m = trimmed.match(/^(#{1,3})\s+(.+)$/))) {
        flushPara(); flushList();
        out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`);   // # → h2 (h1 ist der Name)
      } else if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        flushPara(); flushList(); out.push('<hr>');
      } else if ((m = trimmed.match(/^&gt;\s?(.*)$/))) {
        flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      } else if ((m = trimmed.match(/^[-*]\s+(.+)$/))) {
        flushPara();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = trimmed.match(/^\d+[.)]\s+(.+)$/))) {
        flushPara();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(m[1]);
      } else {
        flushList();
        para.push(trimmed);
      }
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  /** Reiner Text ohne Markdown-Zeichen, z.B. für Vorschau/Suche. */
  function toPlain(md) {
    return String(md || '')
      .replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/^\d+[.)]\s+/gm, '')
      .replace(/^>\s?/gm, '').replace(/^(-{3,}|\*{3,})$/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }

  /** Erste Sätze (max. `maxChars`), an Satzgrenze gekürzt; gibt {text, truncated}. */
  function excerpt(md, maxChars = 220) {
    // Überschriften gehören nicht in den Auszug — nur Fließtext
    const plain = toPlain(String(md || '').replace(/^#{1,6}\s+.*$/gm, ''));
    if (plain.length <= maxChars) return { text: plain, truncated: false };
    const cut = plain.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    const text = end > maxChars * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
    return { text, truncated: true };
  }

  return { render, toPlain, excerpt, escape: esc };
})();
