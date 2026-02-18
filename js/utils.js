/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Shared Utilities
   Sanitization, constants, DOM helpers, debounce
   ═══════════════════════════════════════════════════════════ */

const Utils = (() => {

  // ─── HTML Escaping (XSS prevention) ───

  const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
  }

  // ─── Input Sanitization (for DB writes) ───

  function sanitizeInput(str) {
    if (!str) return '';
    // Trim and remove control characters (except newlines/tabs in notes)
    return String(str).trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  function validateLength(str, maxLen) {
    return !str || str.length <= maxLen;
  }

  function isValidEmail(email) {
    if (!email) return true; // optional field
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidUrl(url) {
    if (!url) return true; // optional field
    return /^https:\/\/.+/.test(url);
  }

  function sanitizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/[^\d+\-() /]/g, '').trim();
  }

  // ─── Safe DOM Builder ───

  function createEl(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') {
          el.className = value;
        } else if (key === 'textContent') {
          el.textContent = value;
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(el.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          el.setAttribute(key, value);
        }
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      for (const child of children) {
        if (typeof child === 'string') {
          el.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
          el.appendChild(child);
        }
      }
    }
    return el;
  }

  // ─── Debounce ───

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ─── Loading State ───

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.classList.add('loading');
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
      btn.classList.remove('loading');
    }
  }

  // ─── Date Validation ───

  /**
   * Get the maximum valid day for a given year and month.
   * Returns 28-31 depending on month and leap year.
   */
  function maxDayForMonth(year, month) {
    // new Date(year, month, 0).getDate() returns last day of previous month,
    // so month here is 1-based (e.g., 2 = February)
    return new Date(year, month, 0).getDate();
  }

  /**
   * Validate a date string (YYYY-MM-DD format).
   * Returns { valid: true } or { valid: false, message: string }.
   */
  function validateDate(dateStr) {
    if (!dateStr) return { valid: true }; // empty = optional
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return { valid: false, message: 'Datumsformat muss JJJJ-MM-TT sein' };

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    if (month < 1 || month > 12) return { valid: false, message: 'Ungültiger Monat' };
    const maxDay = maxDayForMonth(year, month);
    if (day < 1 || day > maxDay) {
      return { valid: false, message: `Tag ${day} existiert nicht für diesen Monat (max. ${maxDay})` };
    }

    // Verify the date actually parses to what we expect (catch edge cases)
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return { valid: false, message: 'Ungültiges Datum' };
    }

    return { valid: true };
  }

  /**
   * Clamp the day of a date string to the maximum valid day for its month.
   * Returns the corrected YYYY-MM-DD string, or the original if no correction needed.
   */
  function clampDateDay(dateStr) {
    if (!dateStr) return dateStr;
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return dateStr;

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    if (month < 1 || month > 12) return dateStr;
    const maxDay = maxDayForMonth(year, month);
    if (day > maxDay) {
      return `${match[1]}-${match[2]}-${String(maxDay).padStart(2, '0')}`;
    }
    return dateStr;
  }

  /**
   * Attach live date auto-correction to a date input element.
   * When the user changes the date, if the day overflows (e.g. Feb 31),
   * it auto-corrects to the max valid day for that month.
   */
  function attachDateAutoCorrect(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('change', () => {
      const val = inputEl.value;
      if (!val) return;
      const corrected = clampDateDay(val);
      if (corrected !== val) {
        inputEl.value = corrected;
      }
    });
  }

  // ─── Constants ───

  const REL_TYPES = Object.freeze({
    PARENT_CHILD: 'parent_child',
    SPOUSE: 'spouse',
    SIBLING: 'sibling',
  });

  // Relationship directions from UI perspective
  const REL_DIRECTIONS = Object.freeze({
    PARENT: 'parent',
    CHILD: 'child',
    SPOUSE: 'spouse',
    SIBLING: 'sibling',
  });

  const REL_LABELS = Object.freeze({
    parent: 'Elternteil',
    child: 'Kind',
    spouse: 'Partner',
    sibling: 'Geschwister',
  });

  const VIEW_IDS = Object.freeze({
    LOADING: 'loading-screen',
    AUTH: 'view-auth',
    PENDING: 'view-pending',
    ADMIN: 'view-admin-approve',
    CLAIM: 'view-claim',
    MAIN: 'view-main',
    PROFILE: 'view-profile',
    EDIT: 'view-edit',
    QR: 'view-qr',
    SCANNER: 'view-scanner',
  });

  // ─── Public API ───

  return {
    escapeHtml,
    sanitizeInput,
    validateLength,
    isValidEmail,
    isValidUrl,
    sanitizePhone,
    createEl,
    debounce,
    setButtonLoading,
    validateDate,
    clampDateDay,
    maxDayForMonth,
    attachDateAutoCorrect,
    REL_TYPES,
    REL_DIRECTIONS,
    REL_LABELS,
    VIEW_IDS,
  };
})();
