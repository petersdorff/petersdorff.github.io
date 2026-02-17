/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Search
   ═══════════════════════════════════════════════════════════ */

const Search = (() => {
  let allMembers = [];
  let debouncedSearch = null;

  function init() {
    const input = document.getElementById('search-input');

    debouncedSearch = Utils.debounce((query) => {
      performSearch(query);
    }, 200);

    input.addEventListener('input', () => {
      debouncedSearch(input.value.trim());
    });

    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 1) {
        performSearch(input.value.trim());
      }
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-bar') && !e.target.closest('#search-results')) {
        hideResults();
      }
    });

    // ESC to close
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideResults();
        input.blur();
      }
    });
  }

  function setMembers(members) {
    allMembers = members;
  }

  function performSearch(query) {
    const resultsEl = document.getElementById('search-results');

    if (!query || query.length < 1) {
      hideResults();
      return;
    }

    const q = query.toLowerCase();
    const matches = allMembers.filter(m => {
      const full = `${m.firstName} ${m.lastName} ${m.birthName || ''} ${m.location || ''}`.toLowerCase();
      return full.includes(q);
    }).slice(0, 8);

    resultsEl.innerHTML = '';

    if (matches.length === 0) {
      const noResult = Utils.createEl('div', {
        className: 'search-result-item',
        style: { justifyContent: 'center', color: 'var(--text-muted)', cursor: 'default' },
      });
      noResult.appendChild(document.createTextNode('Keine Ergebnisse f\u00fcr "'));
      noResult.appendChild(document.createTextNode(query));
      noResult.appendChild(document.createTextNode('"'));
      resultsEl.appendChild(noResult);
      showResults();
      return;
    }

    for (const m of matches) {
      const initials = `${m.firstName[0]}${m.lastName[0]}`.toUpperCase();
      const yearInfo = m.birthDate ? `* ${m.birthDate.substring(0, 4)}` : '';
      const locationInfo = m.location || '';
      const info = [yearInfo, locationInfo].filter(Boolean).join(' \u00b7 ');

      const avatar = Utils.createEl('div', { className: 'result-avatar', textContent: initials });
      const name = Utils.createEl('div', { className: 'result-name', textContent: `${m.firstName} ${m.lastName}` });
      const infoWrap = Utils.createEl('div', {}, [name]);
      if (info) {
        infoWrap.appendChild(Utils.createEl('div', { className: 'result-info', textContent: info }));
      }

      const item = Utils.createEl('div', { className: 'search-result-item' }, [avatar, infoWrap]);
      item.dataset.id = m.id;
      item.addEventListener('click', () => {
        hideResults();
        document.getElementById('search-input').value = '';
        Profile.show(m.id);
      });
      resultsEl.appendChild(item);
    }

    showResults();
  }

  function showResults() {
    document.getElementById('search-results').classList.remove('hidden');
  }

  function hideResults() {
    document.getElementById('search-results').classList.add('hidden');
  }

  return {
    init,
    setMembers,
    hideResults,
  };
})();
