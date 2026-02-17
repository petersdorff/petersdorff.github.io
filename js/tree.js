/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Tree Visualization (Cytoscape.js)
   Couple-centered layout: spouses side-by-side with shared
   descent line from the midpoint of the couple connector.
   PCB / Circuit Board aesthetic

   Supports two view modes:
   - "generational" : members at generation-based Y with zig-zag isochrones
   - "temporal"      : members at birth-year-proportional Y (timeline)
   ═══════════════════════════════════════════════════════════ */

const Tree = (() => {
  let cy = null;
  let members = [];
  let relationships = [];
  let highlightedPath = [];
  let highlightedFromId = null;
  let highlightedToId = null;
  let onNodeTapCallback = null;
  let onBackgroundTapCallback = null;
  let currentUserId = null;

  // View mode state
  let viewMode = localStorage.getItem('stammbaum_viewMode') || 'generational';
  let isochroneSvg = null; // SVG overlay element

  const COLORS = {
    trace: '#1a1a1a',
    traceFaint: '#d0d0d0',
    red: '#e63946',
    redGlow: 'rgba(230, 57, 70, 0.3)',
    blue: '#457b9d',
    bg: '#ffffff',
    bgSecondary: '#f8f9fa',
    textSecondary: '#6b7280',
    textMuted: '#9ca3af',
    spouseLine: '#1a1a1a',
  };

  // Layout constants
  const NODE_W = 170;
  const NODE_H = 62;
  const SPOUSE_GAP = 30;     // gap between spouse nodes
  const SIBLING_GAP = 50;    // gap between sibling nodes
  const GEN_GAP = 140;       // vertical gap between generations
  const COUPLE_NODE_SIZE = 1; // invisible midpoint node
  const YEAR_PX = 5;          // pixels per year in temporal mode

  // ═══════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════

  function init(containerId) {
    cy = cytoscape({
      container: document.getElementById(containerId),
      style: getCytoscapeStyle(),
      layout: { name: 'preset' },
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      selectionType: 'single',
      autoungrabify: true,
    });

    // Tap on node
    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      if (nodeId.startsWith('couple-')) return;
      if (onNodeTapCallback) onNodeTapCallback(nodeId);
    });

    // Tap on background to deselect and close overlays
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearHighlight();
        if (onBackgroundTapCallback) onBackgroundTapCallback();
      }
    });

    // Re-render highlights on tab switch (without zoom animation)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && cy) {
        cy.resize();
        if (highlightedFromId && highlightedToId) {
          // Just restore the highlight styling — don't re-zoom/animate
          restoreHighlight();
        } else {
          cy.style().update();
        }
      }
    });

    // Init isochrone overlay
    initIsochroneOverlay(containerId);

    // Sync isochrone overlay on viewport changes
    cy.on('viewport', updateIsochroneTransform);
  }

  function onNodeTap(callback) {
    onNodeTapCallback = callback;
  }

  function onBackgroundTap(callback) {
    onBackgroundTapCallback = callback;
  }

  function setCurrentUser(memberId) {
    currentUserId = memberId;
  }

  // ═══════════════════════════════════════════════════════════
  //  VIEW MODE
  // ═══════════════════════════════════════════════════════════

  function setViewMode(mode) {
    if (mode !== 'generational' && mode !== 'temporal') return;
    if (mode === viewMode) return;
    viewMode = mode;
    localStorage.setItem('stammbaum_viewMode', mode);
    if (members.length > 0) {
      renderWithAnimation();
    }
  }

  function getViewMode() {
    return viewMode;
  }

  // ═══════════════════════════════════════════════════════════
  //  SHARED LAYOUT HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Build adjacency structures, identify couples, assign generations,
   * compute family units, and calculate subtree widths.
   * Shared between generational and temporal layouts.
   */
  function buildLayoutBase(members, relationships) {
    const memberMap = new Map(members.map(m => [m.id, m]));

    // ─── Build adjacency structures ───
    const spouseEdges = [];
    const parentChildEdges = [];
    const siblingEdges = [];
    const spouseOf = new Map();
    const childrenOf = new Map();
    const parentsOf = new Map();

    for (const m of members) {
      spouseOf.set(m.id, []);
      childrenOf.set(m.id, []);
      parentsOf.set(m.id, []);
    }

    for (const r of relationships) {
      if (r.type === 'spouse') {
        spouseEdges.push({ from: r.fromId, to: r.toId, id: r.id });
        if (spouseOf.has(r.fromId)) spouseOf.get(r.fromId).push(r.toId);
        if (spouseOf.has(r.toId)) spouseOf.get(r.toId).push(r.fromId);
      } else if (r.type === 'parent_child') {
        parentChildEdges.push({ parent: r.fromId, child: r.toId, id: r.id });
        if (childrenOf.has(r.fromId)) childrenOf.get(r.fromId).push(r.toId);
        if (parentsOf.has(r.toId)) parentsOf.get(r.toId).push(r.fromId);
      } else if (r.type === 'sibling') {
        siblingEdges.push({ from: r.fromId, to: r.toId, id: r.id });
      }
    }

    // ─── Identify couples ───
    const inCouple = new Map();
    const couples = [];

    for (const se of spouseEdges) {
      if (!inCouple.has(se.from) && !inCouple.has(se.to)) {
        const coupleId = `couple-${se.from}-${se.to}`;
        couples.push({ id: coupleId, a: se.from, b: se.to });
        inCouple.set(se.from, coupleId);
        inCouple.set(se.to, coupleId);
      }
    }

    const coupleMap = new Map(couples.map(c => [c.id, c]));

    function getCoupleChildren(couple) {
      const childrenA = new Set(childrenOf.get(couple.a) || []);
      const childrenB = new Set(childrenOf.get(couple.b) || []);
      return [...new Set([...childrenA, ...childrenB])];
    }

    // ─── Assign generations ───
    const generation = new Map();
    const roots = members.filter(m => (parentsOf.get(m.id) || []).length === 0);
    const queue = [];

    for (const root of roots) {
      if (!generation.has(root.id)) {
        generation.set(root.id, 0);
        queue.push(root.id);
      }
    }
    if (queue.length === 0 && members.length > 0) {
      generation.set(members[0].id, 0);
      queue.push(members[0].id);
    }

    while (queue.length > 0) {
      const personId = queue.shift();
      const gen = generation.get(personId);
      for (const childId of (childrenOf.get(personId) || [])) {
        if (!generation.has(childId)) {
          generation.set(childId, gen + 1);
          queue.push(childId);
        }
      }
      for (const parentId of (parentsOf.get(personId) || [])) {
        if (!generation.has(parentId)) {
          generation.set(parentId, gen - 1);
          queue.push(parentId);
        }
      }
    }

    // Align spouses
    for (const se of spouseEdges) {
      const genA = generation.get(se.from);
      const genB = generation.get(se.to);
      if (genA !== undefined && genB === undefined) {
        generation.set(se.to, genA);
      } else if (genB !== undefined && genA === undefined) {
        generation.set(se.from, genB);
      } else if (genA !== undefined && genB !== undefined && genA !== genB) {
        const aHasParents = (parentsOf.get(se.from) || []).length > 0;
        const bHasParents = (parentsOf.get(se.to) || []).length > 0;
        if (aHasParents && !bHasParents) generation.set(se.to, genA);
        else if (bHasParents && !aHasParents) generation.set(se.from, genB);
        else {
          const maxGen = Math.max(genA, genB);
          generation.set(se.from, maxGen);
          generation.set(se.to, maxGen);
        }
      }
    }

    for (const m of members) {
      if (!generation.has(m.id)) generation.set(m.id, 0);
    }

    const minGen = Math.min(...generation.values());
    if (minGen < 0) {
      for (const [id, gen] of generation) generation.set(id, gen - minGen);
    }

    const maxGen = Math.max(...generation.values(), 0);

    // ─── Build generation groups ───
    const genGroups = [];
    for (let g = 0; g <= maxGen; g++) genGroups.push([]);
    const placed = new Set();

    for (const couple of couples) {
      const gen = generation.get(couple.a) || 0;
      genGroups[gen].push({
        type: 'couple', id: couple.id, a: couple.a, b: couple.b,
        children: getCoupleChildren(couple),
      });
      placed.add(couple.a);
      placed.add(couple.b);
    }

    for (const m of members) {
      if (!placed.has(m.id)) {
        const gen = generation.get(m.id) || 0;
        genGroups[gen].push({
          type: 'single', id: m.id, children: childrenOf.get(m.id) || [],
        });
        placed.add(m.id);
      }
    }

    // ─── Unit children + width calculation ───
    function getUnitForPerson(personId) {
      return inCouple.has(personId) ? inCouple.get(personId) : personId;
    }

    const unitChildren = new Map();
    const childPlaced = new Set();

    for (const couple of couples) {
      const children = getCoupleChildren(couple);
      unitChildren.set(couple.id, children);
      for (const c of children) childPlaced.add(c);
    }
    for (const m of members) {
      if (!inCouple.has(m.id)) {
        const children = (childrenOf.get(m.id) || []).filter(c => !childPlaced.has(c));
        if (children.length > 0) {
          unitChildren.set(m.id, children);
          for (const c of children) childPlaced.add(c);
        }
      }
    }

    const unitWidth = new Map();
    function calcWidth(unitId) {
      if (unitWidth.has(unitId)) return unitWidth.get(unitId);
      const children = unitChildren.get(unitId) || [];
      const selfWidth = coupleMap.has(unitId) ? NODE_W * 2 + SPOUSE_GAP : NODE_W;
      if (children.length === 0) { unitWidth.set(unitId, selfWidth); return selfWidth; }

      const uniqueChildUnits = [...new Set(children.map(c => getUnitForPerson(c)))];
      let childrenTotalWidth = 0;
      for (const cu of uniqueChildUnits) childrenTotalWidth += calcWidth(cu);
      childrenTotalWidth += (uniqueChildUnits.length - 1) * SIBLING_GAP;

      const totalWidth = Math.max(selfWidth, childrenTotalWidth);
      unitWidth.set(unitId, totalWidth);
      return totalWidth;
    }

    for (const couple of couples) calcWidth(couple.id);
    for (const m of members) { if (!inCouple.has(m.id)) calcWidth(m.id); }

    // Helper: get the earliest birth year for a unit (for sibling sorting)
    function unitBirthYear(unitId) {
      const couple = coupleMap.get(unitId);
      let people;
      if (couple) {
        people = [memberMap.get(couple.a), memberMap.get(couple.b)].filter(Boolean);
      } else {
        const m = memberMap.get(unitId);
        people = m ? [m] : [];
      }
      let earliest = Infinity;
      for (const p of people) {
        if (p.birthDate) {
          const y = parseInt(p.birthDate.substring(0, 4));
          if (!isNaN(y) && y < earliest) earliest = y;
        }
      }
      return earliest === Infinity ? 9999 : earliest;
    }

    return {
      memberMap, spouseEdges, parentChildEdges, siblingEdges,
      spouseOf, childrenOf, parentsOf,
      inCouple, couples, coupleMap,
      generation, genGroups, maxGen,
      unitChildren, unitWidth, getUnitForPerson, calcWidth,
      unitBirthYear,
    };
  }

  /**
   * Build Cytoscape elements (nodes + edges) from layout base.
   * Shared between both layout modes.
   */
  function buildElements(base) {
    const elements = [];
    const { spouseEdges, parentChildEdges, siblingEdges, inCouple, couples, coupleMap, parentsOf } = base;

    // Person nodes
    for (const m of members) {
      const displayName = `${m.firstName} ${m.lastName}`;
      elements.push({
        group: 'nodes',
        data: {
          id: m.id, label: displayName,
          initials: getInitials(m.firstName, m.lastName),
          subLabel: m.birthName || '',
          yearLabel: getYearLabel(m.birthDate, m.deathDate),
          isDeceased: m.isDeceased || false,
          isPlaceholder: m.isPlaceholder || false,
        },
        classes: [
          m.isDeceased ? 'deceased' : 'alive',
          m.isPlaceholder ? 'placeholder' : 'claimed',
          m.id === currentUserId ? 'current-user' : '',
        ].filter(Boolean).join(' '),
      });
    }

    // Couple midpoint nodes
    for (const couple of couples) {
      elements.push({
        group: 'nodes',
        data: { id: couple.id, label: '', coupleNode: true },
        classes: 'couple-midpoint',
      });
    }

    // Spouse edges (split halves)
    for (const se of spouseEdges) {
      const coupleId = inCouple.get(se.from);
      if (coupleId) {
        elements.push({ group: 'edges', data: { id: `e-spouse-${se.from}-mid`, source: se.from, target: coupleId, relType: 'spouse', spouseHalf: 'a' }, classes: 'spouse-edge' });
        elements.push({ group: 'edges', data: { id: `e-spouse-mid-${se.to}`, source: coupleId, target: se.to, relType: 'spouse', spouseHalf: 'b' }, classes: 'spouse-edge' });
      } else {
        elements.push({ group: 'edges', data: { id: `e-${se.id}`, source: se.from, target: se.to, relType: 'spouse' }, classes: 'spouse-edge' });
      }
    }

    // Parent-child edges
    for (const pc of parentChildEdges) {
      const parentCoupleId = inCouple.get(pc.parent);
      if (parentCoupleId) {
        const edgeId = `e-family-${parentCoupleId}-${pc.child}`;
        if (!elements.find(e => e.data?.id === edgeId)) {
          elements.push({ group: 'edges', data: { id: edgeId, source: parentCoupleId, target: pc.child, relType: 'parent_child' }, classes: 'parent-child-edge' });
        }
      } else {
        elements.push({ group: 'edges', data: { id: `e-${pc.id}`, source: pc.parent, target: pc.child, relType: 'parent_child' }, classes: 'parent-child-edge' });
      }
    }

    // Sibling edges — only show if siblings don't already share a parent
    // (shared parents make the relationship obvious from the tree structure)
    for (const se of siblingEdges) {
      const parentsA = parentsOf.get(se.from) || [];
      const parentsB = parentsOf.get(se.to) || [];
      const sharedParent = parentsA.some(p => parentsB.includes(p));
      if (!sharedParent) {
        elements.push({ group: 'edges', data: { id: `e-${se.id}`, source: se.from, target: se.to, relType: 'sibling' }, classes: 'sibling-edge' });
      }
    }

    return elements;
  }

  // ═══════════════════════════════════════════════════════════
  //  GENERATIONAL LAYOUT
  // ═══════════════════════════════════════════════════════════

  function buildGenerationalLayout(members, relationships) {
    const base = buildLayoutBase(members, relationships);
    const positions = {};
    const { coupleMap, genGroups, maxGen, generation, unitChildren, unitWidth, getUnitForPerson, inCouple, unitBirthYear } = base;
    const elements = buildElements(base);

    const allUnitsPlaced = new Set();

    function positionUnit(unit, centerX, y) {
      if (allUnitsPlaced.has(unit.id)) return;
      allUnitsPlaced.add(unit.id);

      if (unit.type === 'couple') {
        const couple = coupleMap.get(unit.id);
        positions[couple.a] = { x: centerX - (SPOUSE_GAP / 2) - (NODE_W / 2), y };
        positions[couple.b] = { x: centerX + (SPOUSE_GAP / 2) + (NODE_W / 2), y };
        positions[unit.id] = { x: centerX, y };
      } else {
        positions[unit.id] = { x: centerX, y };
      }

      const children = unit.children || [];
      if (children.length === 0) return;
      const childY = y + GEN_GAP;

      const childUnitIds = [];
      const seen = new Set();
      for (const childId of children) {
        const cu = getUnitForPerson(childId);
        if (!seen.has(cu)) { seen.add(cu); childUnitIds.push(cu); }
      }

      // Sort siblings: oldest (smallest birth year) on left
      childUnitIds.sort((a, b) => unitBirthYear(a) - unitBirthYear(b));

      let totalChildWidth = 0;
      for (const cuId of childUnitIds) totalChildWidth += (unitWidth.get(cuId) || NODE_W);
      totalChildWidth += (childUnitIds.length - 1) * SIBLING_GAP;

      let childX = centerX - totalChildWidth / 2;
      for (const cuId of childUnitIds) {
        const w = unitWidth.get(cuId) || NODE_W;
        const childCenterX = childX + w / 2;
        const coupleInfo = coupleMap.get(cuId);
        if (coupleInfo) {
          positionUnit({ type: 'couple', id: cuId, a: coupleInfo.a, b: coupleInfo.b, children: unitChildren.get(cuId) || [] }, childCenterX, childY);
        } else {
          positionUnit({ type: 'single', id: cuId, children: unitChildren.get(cuId) || [] }, childCenterX, childY);
        }
        childX += w + SIBLING_GAP;
      }
    }

    // Position root units
    const rootUnits = genGroups[0] || [];
    let totalRootWidth = 0;
    for (const ru of rootUnits) totalRootWidth += (unitWidth.get(ru.id) || NODE_W);
    totalRootWidth += (rootUnits.length - 1) * SIBLING_GAP * 2;

    let rootX = -totalRootWidth / 2;
    for (const ru of rootUnits) {
      const w = unitWidth.get(ru.id) || NODE_W;
      positionUnit(ru, rootX + w / 2, 0);
      rootX += w + SIBLING_GAP * 2;
    }

    // Disconnected subtrees
    for (let g = 0; g <= maxGen; g++) {
      for (const unit of genGroups[g]) {
        if (!allUnitsPlaced.has(unit.id)) {
          rootX += SIBLING_GAP * 2;
          const w = unitWidth.get(unit.id) || NODE_W;
          positionUnit(unit, rootX + w / 2, g * GEN_GAP);
          rootX += w;
        }
      }
    }

    // Compute zig-zag isochrones
    const isochroneData = computeZigZagIsochrones(members, positions, generation, base.memberMap);

    return { elements, positions, isochroneData };
  }

  // ═══════════════════════════════════════════════════════════
  //  TEMPORAL LAYOUT
  // ═══════════════════════════════════════════════════════════

  function buildTemporalLayout(members, relationships) {
    const base = buildLayoutBase(members, relationships);
    const positions = {};
    const { coupleMap, genGroups, maxGen, generation, unitChildren, unitWidth, getUnitForPerson, inCouple, couples, unitBirthYear } = base;
    const elements = buildElements(base);

    // ─── Compute birth years ───
    const birthYears = new Map();
    let minYear = Infinity, maxYear = -Infinity;

    for (const m of members) {
      if (m.birthDate) {
        const y = parseInt(m.birthDate.substring(0, 4));
        if (!isNaN(y)) {
          birthYears.set(m.id, y);
          minYear = Math.min(minYear, y);
          maxYear = Math.max(maxYear, y);
        }
      }
    }

    // Average birth year per generation (for fallback)
    const genYears = new Map();
    for (const [id, year] of birthYears) {
      const gen = generation.get(id) || 0;
      if (!genYears.has(gen)) genYears.set(gen, []);
      genYears.get(gen).push(year);
    }
    const genAvgYear = new Map();
    for (const [gen, years] of genYears) {
      genAvgYear.set(gen, years.reduce((a, b) => a + b, 0) / years.length);
    }

    // Assign missing birth years from generation average
    for (const m of members) {
      if (!birthYears.has(m.id)) {
        const gen = generation.get(m.id) || 0;
        const avg = genAvgYear.get(gen);
        birthYears.set(m.id, avg ? Math.round(avg) : (minYear !== Infinity ? minYear + gen * 25 : 1950 + gen * 25));
      }
    }

    if (minYear === Infinity) minYear = 1920;
    if (maxYear === -Infinity) maxYear = 2030;
    const baseYear = Math.floor(minYear / 10) * 10;

    function yearToY(year) {
      return (year - baseYear) * YEAR_PX;
    }

    // ─── Compute Y for each member ───
    const memberY = new Map();
    for (const m of members) {
      memberY.set(m.id, yearToY(birthYears.get(m.id)));
    }

    // Couples: each spouse keeps their birth-year Y, midpoint at average
    const coupleY = new Map();
    for (const couple of couples) {
      const ya = memberY.get(couple.a) || 0;
      const yb = memberY.get(couple.b) || 0;
      const avg = (ya + yb) / 2;
      coupleY.set(couple.id, avg);
      // DO NOT override memberY — each spouse keeps their own birth-year Y
    }

    // ─── Position units (X from width calc, Y from birth year) ───
    const allUnitsPlaced = new Set();

    function positionUnit(unit, centerX) {
      if (allUnitsPlaced.has(unit.id)) return;
      allUnitsPlaced.add(unit.id);

      let y;
      if (unit.type === 'couple') {
        const couple = coupleMap.get(unit.id);
        const ya = memberY.get(couple.a) || 0;
        const yb = memberY.get(couple.b) || 0;
        const midY = coupleY.get(unit.id) || 0;
        positions[couple.a] = { x: centerX - (SPOUSE_GAP / 2) - (NODE_W / 2), y: ya };
        positions[couple.b] = { x: centerX + (SPOUSE_GAP / 2) + (NODE_W / 2), y: yb };
        positions[unit.id] = { x: centerX, y: midY };
        y = midY; // for child positioning reference
      } else {
        y = memberY.get(unit.id) || 0;
        positions[unit.id] = { x: centerX, y };
      }

      const children = unit.children || [];
      if (children.length === 0) return;

      const childUnitIds = [];
      const seen = new Set();
      for (const childId of children) {
        const cu = getUnitForPerson(childId);
        if (!seen.has(cu)) { seen.add(cu); childUnitIds.push(cu); }
      }

      // Sort siblings: oldest (smallest birth year) on left
      childUnitIds.sort((a, b) => unitBirthYear(a) - unitBirthYear(b));

      let totalChildWidth = 0;
      for (const cuId of childUnitIds) totalChildWidth += (unitWidth.get(cuId) || NODE_W);
      totalChildWidth += (childUnitIds.length - 1) * SIBLING_GAP;

      let childX = centerX - totalChildWidth / 2;
      for (const cuId of childUnitIds) {
        const w = unitWidth.get(cuId) || NODE_W;
        const childCenterX = childX + w / 2;
        const coupleInfo = coupleMap.get(cuId);
        if (coupleInfo) {
          positionUnit({ type: 'couple', id: cuId, a: coupleInfo.a, b: coupleInfo.b, children: unitChildren.get(cuId) || [] }, childCenterX);
        } else {
          positionUnit({ type: 'single', id: cuId, children: unitChildren.get(cuId) || [] }, childCenterX);
        }
        childX += w + SIBLING_GAP;
      }
    }

    // Position root units
    const rootUnits = genGroups[0] || [];
    let totalRootWidth = 0;
    for (const ru of rootUnits) totalRootWidth += (unitWidth.get(ru.id) || NODE_W);
    totalRootWidth += (rootUnits.length - 1) * SIBLING_GAP * 2;

    let rootX = -totalRootWidth / 2;
    for (const ru of rootUnits) {
      const w = unitWidth.get(ru.id) || NODE_W;
      positionUnit(ru, rootX + w / 2);
      rootX += w + SIBLING_GAP * 2;
    }

    // Disconnected subtrees
    for (let g = 0; g <= maxGen; g++) {
      for (const unit of genGroups[g]) {
        if (!allUnitsPlaced.has(unit.id)) {
          rootX += SIBLING_GAP * 2;
          const w = unitWidth.get(unit.id) || NODE_W;
          positionUnit(unit, rootX + w / 2);
          rootX += w;
        }
      }
    }

    // Compute straight horizontal lines at 25-year intervals
    const PERIOD = 25;
    const isochroneData = [];
    const startPeriod = Math.floor(baseYear / PERIOD) * PERIOD;
    const endPeriod = Math.ceil(maxYear / PERIOD) * PERIOD + PERIOD;
    for (let year = startPeriod; year <= endPeriod; year += PERIOD) {
      isochroneData.push({ year: year, y: yearToY(year), type: 'straight' });
    }

    return { elements, positions, isochroneData };
  }

  // ═══════════════════════════════════════════════════════════
  //  ISOCHRONES (for generational view)
  //
  //  "Anchor-to-leftmost + box avoidance" algorithm:
  //
  //  1. For each boundary, the left-edge Y is anchored to the
  //     actual positions of the leftmost people: placed at the
  //     top edge of the leftmost "below" person's box (the
  //     youngest person who should be below the line).
  //  2. This ensures boundary labels align with people's actual
  //     positions, not arbitrary even spacing.
  //  3. Each line stays at its anchor Y, only detouring around
  //     boxes that physically conflict.
  //  4. When a gen row has many conflicting people, they merge
  //     into one continuous detour (no bouncing back between
  //     people at the same row).
  //
  //  Fully data-driven: works for any tree shape.
  // ═══════════════════════════════════════════════════════════

  function computeZigZagIsochrones(members, positions, generation, memberMap) {
    const PERIOD = 25;
    const PAD = 12;               // padding around boxes
    const hH = NODE_H / 2 + PAD;
    const hW = NODE_W / 2 + PAD;
    const MIN_BAND_H = 30;

    // ─── 1. Collect people with birth years + positions ───
    const people = [];
    for (const m of members) {
      if (!positions[m.id]) continue;
      let year = null;
      if (m.birthDate) {
        year = parseInt(m.birthDate.substring(0, 4));
        if (isNaN(year)) year = null;
      }
      if (year === null) continue;
      people.push({
        id: m.id,
        x: positions[m.id].x,
        y: positions[m.id].y,
        year,
        bucket: Math.floor(year / PERIOD) * PERIOD,
      });
    }
    if (people.length < 2) return [];

    // ─── 2. Unique buckets sorted oldest-first ───
    const bucketSet = new Set(people.map(p => p.bucket));
    const bucketsAsc = [...bucketSet].sort((a, b) => a - b);
    if (bucketsAsc.length < 2) return [];

    // Boundaries between adjacent buckets
    const boundaries = [];
    for (let i = 0; i < bucketsAsc.length - 1; i++) {
      boundaries.push(bucketsAsc[i + 1]);
    }
    const numBounds = boundaries.length;

    // ─── 3. Global layout info ───
    const allX = Object.values(positions).map(p => p.x);
    const xMin = Math.min(...allX) - NODE_W - 80;
    const xMax = Math.max(...allX) + NODE_W + 80;

    // ─── 4. Compute anchor Y for each boundary ───
    //
    // Strategy: evenly-spaced left-edge labels.
    //
    // 1. Find the leftmost person per generation row (minimum X).
    //    These define the left "spine" of the tree.
    // 2. yTop = top edge of topmost spine person
    //    yBottom = bottom edge of bottommost spine person
    // 3. Divide [yTop, yBottom] into numBuckets equal bands.
    //    Each band represents one 25-year period.
    //    The last boundary (youngest) sits at yBottom so the
    //    deepest person's box bottom aligns with the final label.

    // Find leftmost person per generation row (by Y coordinate)
    const leftmostPerRow = new Map(); // y → person
    for (const p of people) {
      const rowKey = Math.round(p.y); // round to avoid float issues
      const existing = leftmostPerRow.get(rowKey);
      if (!existing || p.x < existing.x) {
        leftmostPerRow.set(rowKey, p);
      }
    }

    // The spine people define the vertical range
    const spinePeople = [...leftmostPerRow.values()];
    spinePeople.sort((a, b) => a.y - b.y); // top to bottom

    // Vertical extent: top edge of topmost → bottom edge of bottommost
    const yTop = spinePeople[0].y - hH;
    const yBottom = spinePeople[spinePeople.length - 1].y + hH;

    // Equal band height: divide vertical extent by number of boundaries.
    // The first boundary sits at yTop + bandH, the last at yBottom.
    // This places the youngest boundary (e.g. 2025) at the bottom edge
    // of the lowest person, so people at the bottom row are ABOVE it.
    const bandH = (yBottom - yTop) / numBounds;

    const homeY = [];
    for (let bi = 0; bi < numBounds; bi++) {
      homeY.push(yTop + (bi + 1) * bandH);
    }

    // Enforce monotonic ordering and minimum gap
    for (let i = 1; i < homeY.length; i++) {
      if (homeY[i] <= homeY[i - 1] + MIN_BAND_H) {
        homeY[i] = homeY[i - 1] + MIN_BAND_H;
      }
    }

    // ─── 5. Build each isochrone (youngest-to-oldest) ───

    let prevWaypoints = null;
    const allYs = people.map(p => p.y);
    const defaultCeiling = Math.max(...allYs) + hH + GEN_GAP;

    function ceilingAtX(x) {
      if (!prevWaypoints || prevWaypoints.length === 0) return defaultCeiling;
      for (let i = 0; i < prevWaypoints.length - 1; i++) {
        const a = prevWaypoints[i];
        const b = prevWaypoints[i + 1];
        if (a.x === b.x) continue;
        if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) {
          const t = (x - a.x) / (b.x - a.x);
          return a.y + t * (b.y - a.y);
        }
      }
      if (x <= prevWaypoints[0].x) return prevWaypoints[0].y;
      return prevWaypoints[prevWaypoints.length - 1].y;
    }

    const isochroneData = [];

    for (let bi = numBounds - 1; bi >= 0; bi--) {
      const boundaryYear = boundaries[bi];
      const myHomeY = homeY[bi];

      const belowPeople = people.filter(p => p.year >= boundaryYear);
      const abovePeople = people.filter(p => p.year < boundaryYear);
      if (belowPeople.length === 0 || abovePeople.length === 0) continue;

      // ─── Find ALL boxes that conflict with homeY ───
      // Use generous padding: treat any box within PAD of the line as conflict
      const TOUCH_PAD = 5; // extra clearance
      const conflicts = [];
      const conflictIds = new Set();

      // Collect the Y positions of all belowPeople that are goAbove conflicts
      const goAboveYs = new Set();

      for (const p of belowPeople) {
        const boxTop = p.y - hH;
        // Person should be below the line → line must be above box top
        if (boxTop < myHomeY + TOUCH_PAD) {
          conflicts.push({ ...p, type: 'goAbove' });
          conflictIds.add(p.id);
          goAboveYs.add(Math.round(p.y));
        }
      }
      for (const p of abovePeople) {
        const boxBottom = p.y + hH;
        // Person should be above the line → line must be below box bottom
        if (boxBottom > myHomeY - TOUCH_PAD) {
          conflicts.push({ ...p, type: 'goBelow' });
          conflictIds.add(p.id);
        }
      }

      // ─── Second pass: abovePeople sharing a generation row with goAbove people ───
      // In generational view, people from different decades can sit at the same Y.
      // If the line detours above goAbove people at row Y, any abovePeople at the
      // same Y would end up on the wrong side. Add them as goBelow conflicts so
      // the mixed-cluster logic can weave between them.
      for (const p of abovePeople) {
        if (conflictIds.has(p.id)) continue;
        if (goAboveYs.has(Math.round(p.y))) {
          conflicts.push({ ...p, type: 'goBelow' });
          conflictIds.add(p.id);
        }
      }

      // Sort conflicts left→right
      conflicts.sort((a, b) => a.x - b.x);

      // Group into clusters — use wider merge distance to prevent
      // the line from bouncing back to homeY between people at same row
      const MERGE_GAP = SIBLING_GAP + NODE_W; // merge if gap < sibling gap + node width
      const clusters = [];
      for (const c of conflicts) {
        const boxLeft = c.x - hW;
        const boxRight = c.x + hW;
        if (clusters.length > 0) {
          const last = clusters[clusters.length - 1];
          if (boxLeft <= last.xRight + MERGE_GAP) {
            last.xRight = Math.max(last.xRight, boxRight);
            last.members.push(c);
            continue;
          }
        }
        clusters.push({ xLeft: boxLeft, xRight: boxRight, members: [c] });
      }

      // ─── Build waypoints ───
      const waypoints = [];
      let curX = xMin;
      const SLOPE_RUN = 50;

      for (const cluster of clusters) {
        // Horizontal at homeY up to the slope start
        const slopeStart = cluster.xLeft - SLOPE_RUN;
        if (curX < slopeStart) {
          waypoints.push({ x: curX, y: myHomeY });
          waypoints.push({ x: slopeStart, y: myHomeY });
          curX = slopeStart;
        } else if (curX < cluster.xLeft - 5) {
          waypoints.push({ x: curX, y: myHomeY });
          curX = cluster.xLeft - 5;
        }

        // Determine detour Y
        const hasGoAbove = cluster.members.some(m => m.type === 'goAbove');
        const hasGoBelow = cluster.members.some(m => m.type === 'goBelow');

        if (hasGoAbove && hasGoBelow) {
          // ─── Mixed cluster: weave between goBelow and goAbove ───

          // First: reclassify goBelow members that share a Y row with goAbove members.
          // If both types sit at the same Y, the line must go above the row to clear
          // the goAbove boxes — the goBelow people at the same Y will naturally be on
          // the correct side. This prevents zigzag spikes at same-Y rows.
          const goAboveRowYs = new Set(
            cluster.members.filter(m => m.type === 'goAbove').map(m => Math.round(m.y))
          );
          for (const m of cluster.members) {
            if (m.type === 'goBelow' && goAboveRowYs.has(Math.round(m.y))) {
              m.type = 'goAbove';
            }
          }

          // Re-check if still mixed after reclassification
          const stillHasGoAbove = cluster.members.some(m => m.type === 'goAbove');
          const stillHasGoBelow = cluster.members.some(m => m.type === 'goBelow');

          if (stillHasGoAbove && stillHasGoBelow) {
            // Still mixed — weave between segments at different Y rows
            const sorted = [...cluster.members].sort((a, b) => a.x - b.x);
            const segments = [];
            let segStart = 0;
            for (let si = 1; si <= sorted.length; si++) {
              const prevType = sorted[si - 1].type;
              const curType = si < sorted.length ? sorted[si].type : null;
              if (curType !== prevType) {
                const segMembers = sorted.slice(segStart, si);
                const segXLeft = Math.min(...segMembers.map(m => m.x - hW));
                const segXRight = Math.max(...segMembers.map(m => m.x + hW));
                const lc = ceilingAtX((segXLeft + segXRight) / 2);
                let dy;
                if (prevType === 'goAbove') {
                  dy = Math.min(...segMembers.map(m => m.y - hH)) - TOUCH_PAD;
                  dy = Math.min(dy, lc - MIN_BAND_H);
                } else {
                  dy = Math.max(...segMembers.map(m => m.y + hH)) + TOUCH_PAD;
                }
                segments.push({ xLeft: segXLeft, xRight: segXRight, type: prevType, detourY: dy });
                segStart = si;
              }
            }

            waypoints.push({ x: curX, y: myHomeY });
            for (let si = 0; si < segments.length; si++) {
              const seg = segments[si];
              waypoints.push({ x: seg.xLeft - 5, y: seg.detourY });
              waypoints.push({ x: seg.xRight + 5, y: seg.detourY });
              if (si < segments.length - 1) {
                const nextSeg = segments[si + 1];
                const midX = (seg.xRight + nextSeg.xLeft) / 2;
                waypoints.push({ x: midX, y: myHomeY });
                waypoints.push({ x: midX, y: myHomeY });
              }
            }
            const returnX = Math.min(cluster.xRight + SLOPE_RUN, xMax);
            waypoints.push({ x: returnX, y: myHomeY });
            curX = returnX;
          } else {
            // After reclassification, cluster is now uniform goAbove
            const minBoxTop = Math.min(...cluster.members.map(m => m.y - hH));
            let detourY = minBoxTop - TOUCH_PAD;
            const localCeiling = ceilingAtX((cluster.xLeft + cluster.xRight) / 2);
            detourY = Math.min(detourY, localCeiling - MIN_BAND_H);

            waypoints.push({ x: curX, y: myHomeY });
            waypoints.push({ x: cluster.xLeft - 5, y: detourY });
            waypoints.push({ x: cluster.xRight + 5, y: detourY });
            const returnX = Math.min(cluster.xRight + SLOPE_RUN, xMax);
            waypoints.push({ x: returnX, y: myHomeY });
            curX = returnX;
          }

        } else {
          // ─── Uniform cluster: all goAbove or all goBelow ───
          let detourY;
          const localCeiling = ceilingAtX((cluster.xLeft + cluster.xRight) / 2);
          if (hasGoAbove) {
            const minBoxTop = Math.min(...cluster.members
              .filter(m => m.type === 'goAbove')
              .map(m => m.y - hH));
            detourY = minBoxTop - TOUCH_PAD;
            // Ensure minimum distance from previous (younger) isochrone
            detourY = Math.min(detourY, localCeiling - MIN_BAND_H);
          } else if (hasGoBelow) {
            const maxBoxBottom = Math.max(...cluster.members
              .filter(m => m.type === 'goBelow')
              .map(m => m.y + hH));
            detourY = maxBoxBottom + TOUCH_PAD;
            // Don't apply ceiling constraint for goBelow: the line goes DOWN
            // (away from the ceiling), so clamping upward would defeat the purpose.
          } else {
            detourY = myHomeY;
          }

          // Slope into detour → horizontal across → slope back
          waypoints.push({ x: curX, y: myHomeY });
          waypoints.push({ x: cluster.xLeft - 5, y: detourY });
          waypoints.push({ x: cluster.xRight + 5, y: detourY });
          const returnX = Math.min(cluster.xRight + SLOPE_RUN, xMax);
          waypoints.push({ x: returnX, y: myHomeY });
          curX = returnX;
        }
      }

      // Final segment
      if (curX < xMax) {
        waypoints.push({ x: curX, y: myHomeY });
        waypoints.push({ x: xMax, y: myHomeY });
      }

      if (waypoints.length === 0) {
        waypoints.push({ x: xMin, y: myHomeY });
        waypoints.push({ x: xMax, y: myHomeY });
      }

      // ─── Merge consecutive goAbove detours ───
      // When two clusters both detour above (y < myHomeY) and the line
      // briefly returns to homeY between them, remove the dip to eliminate
      // V-shaped spikes in the gap. Keep the line at the detour level.
      if (waypoints.length >= 6) {
        const merged = [waypoints[0]];
        let i = 1;
        while (i < waypoints.length) {
          // Pattern: ...detourEnd(y<homeY), returnToHome, returnToHome, slopeStart, detourStart(y<homeY)...
          // We look for: wp[i] at detourY, wp[i+1] at homeY, wp[i+2] at homeY, wp[i+3] at detourY
          if (i + 3 < waypoints.length &&
              waypoints[i].y < myHomeY - 1 &&
              Math.abs(waypoints[i + 1].y - myHomeY) < 1 &&
              Math.abs(waypoints[i + 2].y - myHomeY) < 1 &&
              waypoints[i + 3].y < myHomeY - 1) {
            // Connect the two detours directly: keep the detour Y levels
            // Use the higher (more negative) of the two detour Y values
            const bridgeY = Math.min(waypoints[i].y, waypoints[i + 3].y);
            merged.push({ x: waypoints[i].x, y: bridgeY });
            merged.push({ x: waypoints[i + 3].x, y: bridgeY });
            i += 4; // skip the homeY dip and the next detour start
          } else {
            merged.push(waypoints[i]);
            i++;
          }
        }
        waypoints.length = 0;
        waypoints.push(...merged);
      }

      // ─── Enforce minimum band thickness ───
      // Only apply ceiling constraint to goAbove detours (y < myHomeY).
      // GoBelow detours (y > myHomeY) intentionally go downward — clamping
      // them upward creates spike artifacts.
      // First pass: check each waypoint
      for (const wp of waypoints) {
        if (wp.y > myHomeY) continue; // goBelow detour, skip ceiling
        const ceil = ceilingAtX(wp.x);
        if (wp.y > ceil - MIN_BAND_H) {
          wp.y = ceil - MIN_BAND_H;
        }
      }
      // Second pass: add intermediate points along long segments
      // to prevent the line from dipping too close mid-segment
      const refined = [waypoints[0]];
      for (let wi = 1; wi < waypoints.length; wi++) {
        const a = waypoints[wi - 1];
        const b = waypoints[wi];
        const dx = b.x - a.x;
        if (Math.abs(dx) > 30) {
          const steps = Math.ceil(Math.abs(dx) / 30);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const mx = a.x + t * dx;
            const my = a.y + t * (b.y - a.y);
            if (my > myHomeY) {
              refined.push({ x: mx, y: my }); // goBelow, skip ceiling
            } else {
              const ceil = ceilingAtX(mx);
              refined.push({ x: mx, y: Math.min(my, ceil - MIN_BAND_H) });
            }
          }
        }
        if (b.y > myHomeY) {
          refined.push({ x: b.x, y: b.y }); // goBelow, skip ceiling
        } else {
          const ceil = ceilingAtX(b.x);
          refined.push({ x: b.x, y: Math.min(b.y, ceil - MIN_BAND_H) });
        }
      }
      waypoints.length = 0;
      waypoints.push(...refined);

      // Clean up duplicates
      const clean = [waypoints[0]];
      for (let i = 1; i < waypoints.length; i++) {
        const prev = clean[clean.length - 1];
        if (Math.abs(waypoints[i].x - prev.x) > 0.5 || Math.abs(waypoints[i].y - prev.y) > 0.5) {
          clean.push(waypoints[i]);
        }
      }

      let pathData = `M ${clean[0].x} ${clean[0].y}`;
      for (let i = 1; i < clean.length; i++) {
        pathData += ` L ${clean[i].x} ${clean[i].y}`;
      }

      isochroneData.push({
        year: boundaryYear,
        pathData,
        waypoints: clean,
        primaryY: myHomeY,
        type: 'zigzag',
      });

      prevWaypoints = clean;
    }

    isochroneData.reverse();
    return isochroneData;
  }

  /**
   * Convert waypoints to a smooth SVG path using cubic bezier curves.
   */
  function waypointsToSmoothPath(waypoints) {
    if (waypoints.length < 2) return '';

    let d = `M ${waypoints[0].x} ${waypoints[0].y}`;

    for (let i = 1; i < waypoints.length; i++) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const dx = curr.x - prev.x;

      // Use cubic bezier with horizontal control points for smooth curves
      const cx1 = prev.x + dx * 0.4;
      const cy1 = prev.y;
      const cx2 = curr.x - dx * 0.4;
      const cy2 = curr.y;

      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
    }

    return d;
  }

  // ═══════════════════════════════════════════════════════════
  //  ISOCHRONE OVERLAY (SVG)
  // ═══════════════════════════════════════════════════════════

  function initIsochroneOverlay(containerId) {
    const container = document.getElementById(containerId);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'isochrone-overlay';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0;';
    container.insertBefore(svg, container.firstChild);
    isochroneSvg = svg;
  }

  let currentIsochroneData = [];

  function renderIsochrones(data) {
    currentIsochroneData = data || [];
    updateIsochroneTransform();
  }

  function updateIsochroneTransform() {
    if (!isochroneSvg || !cy) return;

    // Clear existing
    while (isochroneSvg.firstChild) isochroneSvg.removeChild(isochroneSvg.firstChild);

    if (currentIsochroneData.length === 0) return;

    const pan = cy.pan();
    const zoom = cy.zoom();

    // Create a group with the viewport transform
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${pan.x}, ${pan.y}) scale(${zoom})`);

    // ─── Compute model-space X range (shared by zebra bands + lines) ───
    let modelXMin = Infinity, modelXMax = -Infinity;
    for (const m of members) {
      const node = cy.getElementById(m.id);
      if (node.length) {
        const pos = node.position();
        modelXMin = Math.min(modelXMin, pos.x);
        modelXMax = Math.max(modelXMax, pos.x);
      }
    }
    modelXMin -= NODE_W;
    modelXMax += NODE_W;

    // ─── Sort isochrones by year for consistent band ordering ───
    const sorted = [...currentIsochroneData].sort((a, b) => a.year - b.year);

    // ─── PASS 1: Zebra bands (fill every other gap) ───
    for (let i = 0; i < sorted.length - 1; i++) {
      if (i % 2 !== 0) continue; // shade even-indexed gaps only
      const iso = sorted[i];
      const nextIso = sorted[i + 1];

      if (iso.type === 'straight' && nextIso.type === 'straight') {
        // Simple rectangle between two horizontal lines
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(modelXMin - 200));
        rect.setAttribute('y', String(iso.y));
        rect.setAttribute('width', String(modelXMax - modelXMin + 400));
        rect.setAttribute('height', String(nextIso.y - iso.y));
        rect.setAttribute('fill', 'rgba(0,0,0,0.035)');
        rect.setAttribute('stroke', 'none');
        g.appendChild(rect);

      } else if (iso.type === 'zigzag' && nextIso.type === 'zigzag'
                 && iso.waypoints && nextIso.waypoints) {
        // Closed region between two zigzag paths (line segments for fill)
        const upper = iso.waypoints;
        const lower = [...nextIso.waypoints].reverse();

        let d = `M ${upper[0].x} ${upper[0].y}`;
        for (let j = 1; j < upper.length; j++) {
          d += ` L ${upper[j].x} ${upper[j].y}`;
        }
        for (let j = 0; j < lower.length; j++) {
          d += ` L ${lower[j].x} ${lower[j].y}`;
        }
        d += ' Z';

        const band = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        band.setAttribute('d', d);
        band.setAttribute('fill', 'rgba(0,0,0,0.035)');
        band.setAttribute('stroke', 'none');
        g.appendChild(band);
      }
    }

    // ─── PASS 2: Isochrone lines + labels ───
    for (const iso of currentIsochroneData) {
      if (iso.type === 'zigzag' && iso.pathData) {
        // SVG path for zig-zag isochrone
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', iso.pathData);
        path.setAttribute('class', 'isochrone-path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#d0d0d0');
        path.setAttribute('stroke-width', String(1.5 / zoom));
        path.setAttribute('stroke-dasharray', `${4 / zoom} ${4 / zoom}`);
        path.setAttribute('opacity', '0.7');
        g.appendChild(path);

        // Label — place at primaryY on the left side
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'isochrone-label');
        const labelX = modelXMin + 5;
        const labelY = (iso.primaryY != null ? iso.primaryY : parseFloat((iso.pathData.match(/^M\s+[-\d.]+\s+([-\d.]+)/) || [])[1] || 0)) - 5 / zoom;
        label.setAttribute('x', String(labelX));
        label.setAttribute('y', String(labelY));
        label.setAttribute('font-size', String(11 / zoom));
        label.setAttribute('font-family', "'IBM Plex Mono', monospace");
        label.setAttribute('fill', '#9ca3af');
        label.setAttribute('font-weight', '500');
        label.textContent = String(iso.year);
        g.appendChild(label);

      } else if (iso.type === 'straight') {
        // Straight horizontal line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(modelXMin));
        line.setAttribute('y1', String(iso.y));
        line.setAttribute('x2', String(modelXMax));
        line.setAttribute('y2', String(iso.y));
        line.setAttribute('stroke', '#d0d0d0');
        line.setAttribute('stroke-width', String(1 / zoom));
        line.setAttribute('stroke-dasharray', `${4 / zoom} ${4 / zoom}`);
        line.setAttribute('opacity', '0.6');
        g.appendChild(line);

        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(modelXMin + 5));
        label.setAttribute('y', String(iso.y - 5 / zoom));
        label.setAttribute('font-size', String(11 / zoom));
        label.setAttribute('font-family', "'IBM Plex Mono', monospace");
        label.setAttribute('fill', '#9ca3af');
        label.setAttribute('font-weight', '500');
        label.textContent = String(iso.year);
        g.appendChild(label);
      }
    }

    isochroneSvg.appendChild(g);
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  function render(memberData, relationshipData) {
    members = memberData;
    relationships = relationshipData;

    let elements, positions, isochroneData;

    if (viewMode === 'temporal') {
      const result = buildTemporalLayout(members, relationships);
      elements = result.elements;
      positions = result.positions;
      isochroneData = result.isochroneData;
    } else {
      const result = buildGenerationalLayout(members, relationships);
      elements = result.elements;
      positions = result.positions;
      isochroneData = result.isochroneData;
    }

    cy.elements().remove();
    cy.add(elements);

    for (const [id, pos] of Object.entries(positions)) {
      const node = cy.getElementById(id);
      if (node.length) node.position(pos);
    }

    if (currentUserId) {
      const node = cy.getElementById(currentUserId);
      if (node.length) node.addClass('current-user');
    }

    cy.fit(undefined, 60);
    applySpouseEdgeStyle();
    cy.style().update();
    renderIsochrones(isochroneData);
  }

  /**
   * Animated re-render for view mode switching.
   */
  function renderWithAnimation() {
    let positions, isochroneData;

    if (viewMode === 'temporal') {
      const result = buildTemporalLayout(members, relationships);
      positions = result.positions;
      isochroneData = result.isochroneData;
    } else {
      const result = buildGenerationalLayout(members, relationships);
      positions = result.positions;
      isochroneData = result.isochroneData;
    }

    // Hide isochrones during animation
    renderIsochrones([]);

    // Apply spouse edge style for new view mode
    applySpouseEdgeStyle();

    // Animate nodes to new positions
    const duration = 700;
    for (const [id, pos] of Object.entries(positions)) {
      const node = cy.getElementById(id);
      if (node.length) {
        node.animate({ position: pos }, { duration, easing: 'ease-in-out-cubic' });
      }
    }

    // After animation, fit and show isochrones
    setTimeout(() => {
      cy.animate({ fit: { padding: 60 }, duration: 400, easing: 'ease-out' });
      setTimeout(() => renderIsochrones(isochroneData), 400);
    }, duration);
  }

  /**
   * Apply view-mode-specific style to spouse edges.
   * - generational: straight (same Y, horizontal line)
   * - temporal: taxi with rightward direction (H/V segments when Y differs)
   */
  function applySpouseEdgeStyle() {
    if (!cy) return;
    // Straight lines in both views: horizontal in generational (same Y),
    // diagonal in temporal (different birth-year Y). Avoids broken taxi
    // rendering and transition glitches.
    cy.edges('.spouse-edge').style({ 'curve-style': 'straight' });
  }

  // ═══════════════════════════════════════════════════════════
  //  CYTOSCAPE STYLE
  // ═══════════════════════════════════════════════════════════

  function getCytoscapeStyle() {
    return [
      {
        selector: 'node',
        style: {
          'shape': 'round-rectangle',
          'width': NODE_W,
          'height': NODE_H,
          'background-color': COLORS.bg,
          'border-width': 2,
          'border-color': COLORS.trace,
          'border-style': 'solid',
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-family': '"IBM Plex Mono", monospace',
          'font-size': 11,
          'font-weight': 500,
          'color': COLORS.trace,
          'text-wrap': 'ellipsis',
          'text-max-width': NODE_W - 20,
          'text-margin-y': -4,
          'transition-property': 'background-color, border-color, opacity, border-width',
          'transition-duration': '300ms',
          'transition-timing-function': 'ease-out',
          'z-index': 10,
        },
      },
      {
        selector: 'node[yearLabel]',
        style: {
          'text-wrap': 'wrap',
          'label': (ele) => {
            if (ele.data('coupleNode')) return '';
            const name = ele.data('label');
            const year = ele.data('yearLabel');
            const sub = ele.data('subLabel');
            let text = name;
            if (sub) text += `\n${sub}`;
            if (year) text += `\n${year}`;
            return text;
          },
          'font-size': 10,
          'line-height': 1.4,
          'text-max-width': NODE_W - 20,
          'height': (ele) => {
            if (ele.data('coupleNode')) return COUPLE_NODE_SIZE;
            const sub = ele.data('subLabel');
            const year = ele.data('yearLabel');
            let h = 48;
            if (sub) h += 14;
            if (year) h += 14;
            return h;
          },
        },
      },
      {
        selector: 'node.couple-midpoint',
        style: {
          'width': COUPLE_NODE_SIZE, 'height': COUPLE_NODE_SIZE,
          'background-opacity': 0, 'border-width': 0, 'label': '',
          'events': 'no', 'z-index': 1,
        },
      },
      {
        selector: 'node.placeholder',
        style: { 'border-style': 'dotted' },
      },
      {
        selector: 'node.deceased',
        style: {
          'border-style': 'dashed', 'border-color': COLORS.textMuted,
          'color': COLORS.textMuted, 'background-color': COLORS.bgSecondary,
        },
      },
      {
        selector: 'node.current-user',
        style: {
          'border-color': COLORS.red, 'border-width': 3, 'background-color': '#fff5f5',
        },
      },
      {
        selector: 'node.highlighted',
        style: {
          'border-color': COLORS.red, 'border-width': 3,
          'background-color': '#fff5f5', 'z-index': 100,
        },
      },
      {
        selector: 'node.dimmed',
        style: { 'opacity': 0.15 },
      },
      {
        selector: 'node:selected',
        style: { 'border-color': COLORS.red, 'border-width': 3 },
      },
      {
        selector: 'edge.parent-child-edge',
        style: {
          'width': 2, 'line-color': COLORS.trace, 'target-arrow-shape': 'none',
          'curve-style': 'taxi', 'taxi-direction': 'downward',
          'taxi-turn': 40, 'taxi-turn-min-distance': 20,
          'transition-property': 'line-color, width, opacity',
          'transition-duration': '300ms', 'z-index': 5,
        },
      },
      {
        selector: 'edge.spouse-edge',
        style: {
          'width': 2, 'line-color': COLORS.spouseLine, 'line-style': 'solid',
          'target-arrow-shape': 'none',
          'curve-style': 'straight',
          'transition-property': 'line-color, width, opacity',
          'transition-duration': '300ms', 'z-index': 5,
        },
      },
      {
        selector: 'edge.sibling-edge',
        style: {
          'width': 2, 'line-color': '#6b9e78', 'line-style': 'dotted',
          'line-dash-pattern': [4, 4], 'target-arrow-shape': 'none',
          'curve-style': 'straight', 'transition-property': 'line-color, width, opacity',
          'transition-duration': '300ms', 'z-index': 5,
        },
      },
      {
        selector: 'edge.highlighted',
        style: {
          'line-color': COLORS.red, 'width': 4, 'z-index': 100, 'line-style': 'solid',
        },
      },
      {
        selector: 'edge.dimmed',
        style: { 'opacity': 0.1 },
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════
  //  HIGHLIGHT CONNECTION
  // ═══════════════════════════════════════════════════════════

  function highlightConnection(fromId, toId) {
    clearHighlight();

    const pathNodeIds = Relationship.getPathNodeIds(fromId, toId, members, relationships);
    const pathEdgePairs = Relationship.getPathEdgePairs(fromId, toId, members, relationships);

    if (pathNodeIds.length === 0) return;

    highlightedPath = pathNodeIds;
    highlightedFromId = fromId;
    highlightedToId = toId;

    const personToCouple = new Map();
    cy.nodes('.couple-midpoint').forEach(cpNode => {
      const cpId = cpNode.id();
      const inner = cpId.substring('couple-'.length);
      if (inner.length >= 73) {
        personToCouple.set(inner.substring(0, 36), cpId);
        personToCouple.set(inner.substring(37), cpId);
      }
    });

    cy.elements().addClass('dimmed');

    for (const nodeId of pathNodeIds) {
      const node = cy.getElementById(nodeId);
      if (node.length) node.removeClass('dimmed').addClass('highlighted');
    }

    function highlightEdge(edge) {
      edge.removeClass('dimmed').addClass('highlighted');
      const s = edge.data('source'), t = edge.data('target');
      if (s.startsWith('couple-')) cy.getElementById(s).removeClass('dimmed');
      if (t.startsWith('couple-')) cy.getElementById(t).removeClass('dimmed');
    }

    function findEdges(idA, idB) {
      return cy.edges().filter(e => {
        const s = e.data('source'), t = e.data('target');
        return (s === idA && t === idB) || (s === idB && t === idA);
      });
    }

    for (const [from, to] of pathEdgePairs) {
      const coupleOfFrom = personToCouple.get(from);
      const coupleOfTo = personToCouple.get(to);

      const directEdges = findEdges(from, to);
      if (directEdges.length > 0) { directEdges.forEach(e => highlightEdge(e)); continue; }

      if (coupleOfFrom && coupleOfFrom === coupleOfTo) {
        findEdges(from, coupleOfFrom).forEach(e => highlightEdge(e));
        findEdges(coupleOfFrom, to).forEach(e => highlightEdge(e));
        continue;
      }

      let found = false;
      if (coupleOfFrom) {
        const midToChild = findEdges(coupleOfFrom, to);
        if (midToChild.length > 0) {
          findEdges(from, coupleOfFrom).forEach(e => highlightEdge(e));
          midToChild.forEach(e => highlightEdge(e));
          found = true;
        }
      }
      if (!found && coupleOfTo) {
        const midToParent = findEdges(coupleOfTo, from);
        if (midToParent.length > 0) {
          midToParent.forEach(e => highlightEdge(e));
          findEdges(to, coupleOfTo).forEach(e => highlightEdge(e));
        }
      }
    }

    const pathNodes = cy.nodes().filter(n => pathNodeIds.includes(n.id()));
    if (pathNodes.length > 0) {
      cy.animate({ fit: { eles: pathNodes, padding: 100 }, duration: 600, easing: 'ease-out' });
    }
  }

  function clearHighlight() {
    highlightedPath = [];
    highlightedFromId = null;
    highlightedToId = null;
    cy.elements().removeClass('dimmed highlighted');
  }

  /**
   * Restore highlight styling after tab switch without re-zooming.
   * Re-applies dimmed/highlighted classes to the current path.
   */
  function restoreHighlight() {
    if (!cy || !highlightedFromId || !highlightedToId) return;

    const fromId = highlightedFromId;
    const toId = highlightedToId;
    const pathNodeIds = Relationship.getPathNodeIds(fromId, toId, members, relationships);
    const pathEdgePairs = Relationship.getPathEdgePairs(fromId, toId, members, relationships);
    if (pathNodeIds.length === 0) return;

    const personToCouple = new Map();
    cy.nodes('.couple-midpoint').forEach(cpNode => {
      const cpId = cpNode.id();
      const inner = cpId.substring('couple-'.length);
      if (inner.length >= 73) {
        personToCouple.set(inner.substring(0, 36), cpId);
        personToCouple.set(inner.substring(37), cpId);
      }
    });

    // Re-apply classes
    cy.elements().addClass('dimmed');

    for (const nodeId of pathNodeIds) {
      const node = cy.getElementById(nodeId);
      if (node.length) node.removeClass('dimmed').addClass('highlighted');
    }

    function highlightEdge(edge) {
      edge.removeClass('dimmed').addClass('highlighted');
      const s = edge.data('source'), t = edge.data('target');
      if (s.startsWith('couple-')) cy.getElementById(s).removeClass('dimmed');
      if (t.startsWith('couple-')) cy.getElementById(t).removeClass('dimmed');
    }

    function findEdges(idA, idB) {
      return cy.edges().filter(e => {
        const s = e.data('source'), t = e.data('target');
        return (s === idA && t === idB) || (s === idB && t === idA);
      });
    }

    for (const [from, to] of pathEdgePairs) {
      const coupleOfFrom = personToCouple.get(from);
      const coupleOfTo = personToCouple.get(to);

      const directEdges = findEdges(from, to);
      if (directEdges.length > 0) { directEdges.forEach(e => highlightEdge(e)); continue; }

      if (coupleOfFrom && coupleOfFrom === coupleOfTo) {
        findEdges(from, coupleOfFrom).forEach(e => highlightEdge(e));
        findEdges(coupleOfFrom, to).forEach(e => highlightEdge(e));
        continue;
      }

      let found = false;
      if (coupleOfFrom) {
        const midToChild = findEdges(coupleOfFrom, to);
        if (midToChild.length > 0) {
          findEdges(from, coupleOfFrom).forEach(e => highlightEdge(e));
          midToChild.forEach(e => highlightEdge(e));
          found = true;
        }
      }
      if (!found && coupleOfTo) {
        const midToParent = findEdges(coupleOfTo, from);
        if (midToParent.length > 0) {
          midToParent.forEach(e => highlightEdge(e));
          findEdges(to, coupleOfTo).forEach(e => highlightEdge(e));
        }
      }
    }

    // NO zoom animation — just update styles in place
    cy.style().update();
  }

  // ═══════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════

  function centerOn(memberId, zoom = 1.5) {
    const node = cy.getElementById(memberId);
    if (node.length) {
      cy.animate({ center: { eles: node }, zoom, duration: 500, easing: 'ease-out' });
    }
  }

  function fitAll() {
    cy.animate({ fit: { padding: 60 }, duration: 500, easing: 'ease-out' });
  }

  function getNodePosition(memberId) {
    const node = cy.getElementById(memberId);
    return node.length ? node.position() : null;
  }

  function getCy() { return cy; }

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  function getInitials(firstName, lastName) {
    return `${(firstName || '?')[0]}${(lastName || '?')[0]}`.toUpperCase();
  }

  function getYearLabel(birthDate, deathDate) {
    const birth = birthDate ? birthDate.substring(0, 4) : '?';
    if (deathDate) return `* ${birth}  \u2020 ${deathDate.substring(0, 4)}`;
    if (birthDate) return `* ${birth}`;
    return '';
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  return {
    init,
    onNodeTap,
    onBackgroundTap,
    setCurrentUser,
    render,
    highlightConnection,
    clearHighlight,
    centerOn,
    fitAll,
    getNodePosition,
    getCy,
    setViewMode,
    getViewMode,
  };
})();
