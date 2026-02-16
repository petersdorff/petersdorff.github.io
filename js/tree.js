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

    // Tap on background to deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearHighlight();
      }
    });

    // Re-render highlights on tab switch
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && cy) {
        cy.resize();
        if (highlightedFromId && highlightedToId) {
          const savedFrom = highlightedFromId;
          const savedTo = highlightedToId;
          highlightConnection(savedFrom, savedTo);
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

    return {
      memberMap, spouseEdges, parentChildEdges, siblingEdges,
      spouseOf, childrenOf, parentsOf,
      inCouple, couples, coupleMap,
      generation, genGroups, maxGen,
      unitChildren, unitWidth, getUnitForPerson, calcWidth,
    };
  }

  /**
   * Build Cytoscape elements (nodes + edges) from layout base.
   * Shared between both layout modes.
   */
  function buildElements(base) {
    const elements = [];
    const { spouseEdges, parentChildEdges, siblingEdges, inCouple, couples, coupleMap } = base;

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

    // Sibling edges
    for (const se of siblingEdges) {
      elements.push({ group: 'edges', data: { id: `e-${se.id}`, source: se.from, target: se.to, relType: 'sibling' }, classes: 'sibling-edge' });
    }

    return elements;
  }

  // ═══════════════════════════════════════════════════════════
  //  GENERATIONAL LAYOUT
  // ═══════════════════════════════════════════════════════════

  function buildGenerationalLayout(members, relationships) {
    const base = buildLayoutBase(members, relationships);
    const positions = {};
    const { coupleMap, genGroups, maxGen, generation, unitChildren, unitWidth, getUnitForPerson, inCouple } = base;
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
    const { coupleMap, genGroups, maxGen, generation, unitChildren, unitWidth, getUnitForPerson, inCouple, couples } = base;
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
  //  Bottom-up bucket stacking: assign people to 25-year
  //  temporal buckets, then build H/V-only boundary paths
  //  that enclose each bucket's people from youngest to oldest.
  // ═══════════════════════════════════════════════════════════

  function computeZigZagIsochrones(members, positions, generation, memberMap) {
    const PERIOD = 25;
    const PAD = 12;  // padding around node boxes
    const hH = NODE_H / 2 + PAD;  // half-height with padding
    const hW = NODE_W / 2 + PAD;  // half-width with padding

    // ─── 1. Collect people with known positions + birth years ───
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

    // ─── 2. Buckets sorted oldest-first (ascending by year) ───
    const bucketSet = new Set(people.map(p => p.bucket));
    const buckets = [...bucketSet].sort((a, b) => a - b);
    if (buckets.length < 2) return [];

    // ─── 3. Global X range ───
    const allX = Object.values(positions).map(p => p.x);
    const xMin = Math.min(...allX) - NODE_W - 80;
    const xMax = Math.max(...allX) + NODE_W + 80;

    // ─── 4. Generation rows sorted top→bottom ───
    const genYSet = new Set(people.map(p => p.y));
    const sortedGenYs = [...genYSet].sort((a, b) => a - b);

    // ─── 5. Build isochrone contour for each bucket boundary ───
    //
    // For each boundary (boundaryYear = start of bucket[i+1]):
    //   People born >= boundaryYear should be BELOW the isochrone.
    //   People born < boundaryYear should be ABOVE the isochrone.
    //
    // The isochrone is a left-to-right contour path that decides,
    // for each "column" of the tree, at which Y-level to travel.
    //
    // Between columns of people, it transitions vertically.
    // It only uses H/V segments.
    //
    // Algorithm:
    //   1. For each gen-row, find the rightmost "above" node X and
    //      the leftmost "below" node X. Between them, the isochrone
    //      must transition from one gap-level to another.
    //   2. Scan columns left-to-right. At each X-region, the isochrone
    //      sits at the gap between the lowest "above" row and the
    //      highest "below" row that are locally present.

    const isochroneData = [];

    for (let bi = 0; bi < buckets.length - 1; bi++) {
      const boundaryYear = buckets[bi + 1];

      // Tag each person as above or below the boundary
      const tagged = people.map(p => ({
        ...p,
        side: p.year < boundaryYear ? 'above' : 'below',
      }));

      const belowPeople = tagged.filter(p => p.side === 'below');
      if (belowPeople.length === 0) continue;

      // ─── Build "events" at each X position where a node sits ───
      // Sort all people by X, then figure out at each X what gap-level
      // the isochrone needs to be at.
      //
      // For any X-slice, we need the isochrone to be:
      //   - ABOVE all "below" people at that X
      //   - BELOW all "above" people at that X
      //
      // In practice, at each X we need the gap between the lowest
      // "above" person's row and the highest "below" person's row.
      //
      // But this is complex. Let me use a simpler column approach:
      //
      // Divide the X-axis into segments separated by person box edges.
      // For each segment, find where the isochrone should be.

      // Collect all X-boundaries (left and right edges of all people boxes)
      const xEvents = new Set();
      xEvents.add(xMin);
      xEvents.add(xMax);
      for (const p of tagged) {
        xEvents.add(p.x - hW - 5);  // left edge with gap
        xEvents.add(p.x + hW + 5);  // right edge with gap
      }
      const sortedXEvents = [...xEvents].sort((a, b) => a - b);

      // For each X-segment, determine the isochrone Y level
      const segments = []; // { xStart, xEnd, y }
      for (let si = 0; si < sortedXEvents.length - 1; si++) {
        const segXStart = sortedXEvents[si];
        const segXEnd = sortedXEvents[si + 1];
        const segXMid = (segXStart + segXEnd) / 2;

        // Find people whose box overlaps this X segment
        const localPeople = tagged.filter(p =>
          p.x - hW - 2 <= segXMid && p.x + hW + 2 >= segXMid
        );

        const localAbove = localPeople.filter(p => p.side === 'above');
        const localBelow = localPeople.filter(p => p.side === 'below');

        // Also consider all people globally to find the "natural" level
        // Gather all "below" people across the whole tree that are at or
        // above the current segment's X range
        const allBelow = belowPeople;

        let segY;
        if (localBelow.length > 0 && localAbove.length > 0) {
          // Mixed: isochrone must go between the lowest above and highest below
          const lowestAboveY = Math.max(...localAbove.map(p => p.y));
          const highestBelowY = Math.min(...localBelow.map(p => p.y));

          if (lowestAboveY < highestBelowY) {
            // There's a gap between above and below → go through it
            segY = (lowestAboveY + highestBelowY) / 2;
          } else {
            // They're at the same Y or above is below below (shouldn't happen
            // in well-structured data) → go just above the below people
            segY = highestBelowY - hH;
          }
        } else if (localBelow.length > 0) {
          // Only below people here → isochrone above them
          const highestBelowY = Math.min(...localBelow.map(p => p.y));
          // Find the generation row above this one
          const rowAboveIdx = sortedGenYs.indexOf(highestBelowY);
          if (rowAboveIdx > 0) {
            segY = (sortedGenYs[rowAboveIdx - 1] + highestBelowY) / 2;
          } else {
            segY = highestBelowY - GEN_GAP / 2;
          }
        } else if (localAbove.length > 0) {
          // Only above people here → isochrone below them
          const lowestAboveY = Math.max(...localAbove.map(p => p.y));
          const rowBelowIdx = sortedGenYs.indexOf(lowestAboveY);
          if (rowBelowIdx < sortedGenYs.length - 1) {
            segY = (lowestAboveY + sortedGenYs[rowBelowIdx + 1]) / 2;
          } else {
            segY = lowestAboveY + GEN_GAP / 2;
          }
        } else {
          // No people at this X → use the global default
          // Find the highest "below" person overall
          const globalHighestBelowY = Math.min(...allBelow.map(p => p.y));
          const rowIdx = sortedGenYs.indexOf(globalHighestBelowY);
          if (rowIdx > 0) {
            segY = (sortedGenYs[rowIdx - 1] + globalHighestBelowY) / 2;
          } else {
            segY = globalHighestBelowY - GEN_GAP / 2;
          }
        }

        segments.push({ xStart: segXStart, xEnd: segXEnd, y: segY });
      }

      // ─── Convert segments to waypoints (H/V only) ───
      // Merge adjacent segments with the same Y
      const merged = [segments[0]];
      for (let i = 1; i < segments.length; i++) {
        const last = merged[merged.length - 1];
        if (Math.abs(segments[i].y - last.y) < 1) {
          last.xEnd = segments[i].xEnd; // extend
        } else {
          merged.push({ ...segments[i] });
        }
      }

      // Build waypoints
      const waypoints = [];
      waypoints.push({ x: merged[0].xStart, y: merged[0].y });

      for (let i = 0; i < merged.length; i++) {
        const seg = merged[i];
        // Horizontal segment at this Y
        if (i > 0) {
          // Vertical transition from previous segment's Y to this one's Y
          waypoints.push({ x: seg.xStart, y: merged[i - 1].y });
          waypoints.push({ x: seg.xStart, y: seg.y });
        }
        waypoints.push({ x: seg.xEnd, y: seg.y });
      }

      // Convert to SVG path
      let pathData = `M ${waypoints[0].x} ${waypoints[0].y}`;
      for (let i = 1; i < waypoints.length; i++) {
        pathData += ` L ${waypoints[i].x} ${waypoints[i].y}`;
      }

      isochroneData.push({
        year: boundaryYear,
        pathData,
        waypoints,
        type: 'zigzag',
      });
    }

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

        // Label — place at left side of path
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'isochrone-label');
        const firstMove = iso.pathData.match(/^M\s+([-\d.]+)\s+([-\d.]+)/);
        if (firstMove) {
          label.setAttribute('x', String(parseFloat(firstMove[1]) + 5));
          label.setAttribute('y', String(parseFloat(firstMove[2]) - 5 / zoom));
        }
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
    const spouseEdges = cy.edges('.spouse-edge');
    if (viewMode === 'temporal') {
      spouseEdges.style({
        'curve-style': 'taxi',
        'taxi-direction': 'rightward',
        'taxi-turn': 20,
        'taxi-turn-min-distance': 5,
      });
    } else {
      spouseEdges.style({
        'curve-style': 'straight',
        'taxi-direction': 'rightward',  // reset even though unused
        'taxi-turn': 50,
        'taxi-turn-min-distance': 10,
      });
    }
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
        selector: 'node.deceased',
        style: {
          'border-style': 'dashed', 'border-color': COLORS.textMuted,
          'color': COLORS.textMuted, 'background-color': COLORS.bgSecondary,
        },
      },
      {
        selector: 'node.placeholder',
        style: { 'border-style': 'dotted' },
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
