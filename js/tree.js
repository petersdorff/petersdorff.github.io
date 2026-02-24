/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Tree Visualization (Cytoscape.js)  v65
   Bottom-up layout: children first, parents centered above.
   PCB / Circuit Board aesthetic

   Supports two view modes:
   - "generational" : members at generation-based Y (all same-gen on one row)
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

    // ─── Identify couples (supports multiple marriages) ───
    const inCouple = new Map();   // personId -> coupleId[]
    const couples = [];
    const existingPairs = new Set();

    for (const se of spouseEdges) {
      const pairKey = [se.from, se.to].sort().join('|');
      if (existingPairs.has(pairKey)) continue;
      existingPairs.add(pairKey);

      // Blood descendant (has parents in tree) goes left (a),
      // married-in spouse goes right (b).
      const fromHasParents = (parentsOf.get(se.from) || []).length > 0;
      const toHasParents = (parentsOf.get(se.to) || []).length > 0;
      let left = se.from, right = se.to;
      if (!fromHasParents && toHasParents) {
        left = se.to;
        right = se.from;
      }
      const coupleId = `couple-${left}-${right}`;
      couples.push({ id: coupleId, a: left, b: right });
      if (!inCouple.has(left)) inCouple.set(left, []);
      inCouple.get(left).push(coupleId);
      if (!inCouple.has(right)) inCouple.set(right, []);
      inCouple.get(right).push(coupleId);
    }

    const coupleMap = new Map(couples.map(c => [c.id, c]));

    // ─── Multi-couple detection ───
    // A person with 2+ spouses becomes a "multi-couple pivot".
    // Layout: Spouse2 ─── [mid2] ─── Pivot ─── [mid1] ─── Spouse1
    const multiCouplePersons = new Set();
    const multiCoupleMap = new Map();     // "multi-{pivotId}" -> { pivotId, couples: [{coupleId, spouse}] }
    const absorbedCouples = new Set();

    for (const [personId, coupleIds] of inCouple) {
      if (coupleIds.length > 1) {
        multiCouplePersons.add(personId);
        const multiId = `multi-${personId}`;
        const couplesInfo = coupleIds.map(cid => {
          const c = coupleMap.get(cid);
          const spouse = c.a === personId ? c.b : c.a;
          return { coupleId: cid, spouse };
        });
        // Sort: oldest spouse first (index 0 = right side in layout)
        couplesInfo.sort((a, b) => {
          const ya = memberMap.get(a.spouse)?.birthDate || '9999';
          const yb = memberMap.get(b.spouse)?.birthDate || '9999';
          return ya.localeCompare(yb);
        });
        multiCoupleMap.set(multiId, { pivotId: personId, couples: couplesInfo });
        for (const cid of coupleIds) absorbedCouples.add(cid);
      }
    }

    // ─── Couple children (partitioned by marriage) ───
    // For multi-couple persons, only children shared between BOTH parents
    // in a specific couple belong to that couple. Children with only one
    // parent (the pivot) get a fallback assignment later.
    function getCoupleChildren(couple) {
      const childrenA = new Set(childrenOf.get(couple.a) || []);
      const childrenB = new Set(childrenOf.get(couple.b) || []);
      const pivotId = multiCouplePersons.has(couple.a) ? couple.a
                    : multiCouplePersons.has(couple.b) ? couple.b : null;
      if (pivotId) {
        // Multi-couple: only shared children (intersection)
        return [...childrenA].filter(c => childrenB.has(c));
      }
      // Single couple: all children of both (union, original behavior)
      return [...new Set([...childrenA, ...childrenB])];
    }

    // ─── Assign generations ───
    // Strategy: find connected components via ALL edge types, then within
    // each component BFS from the topmost ancestor(s) only. This ensures
    // people who marry into the family get the correct generation level.
    const generation = new Map();

    // Step 1: Build undirected adjacency for finding connected components
    const adj = new Map();
    for (const m of members) adj.set(m.id, new Set());
    for (const r of [...parentChildEdges, ...siblingEdges]) {
      const a = r.parent || r.from;
      const b = r.child || r.to;
      if (adj.has(a) && adj.has(b)) { adj.get(a).add(b); adj.get(b).add(a); }
    }
    for (const se of spouseEdges) {
      if (adj.has(se.from) && adj.has(se.to)) { adj.get(se.from).add(se.to); adj.get(se.to).add(se.from); }
    }

    // Step 2: Find connected components
    const visited = new Set();
    const components = [];
    for (const m of members) {
      if (visited.has(m.id)) continue;
      const comp = [];
      const bfsQ = [m.id];
      visited.add(m.id);
      while (bfsQ.length > 0) {
        const pid = bfsQ.shift();
        comp.push(pid);
        for (const nbr of adj.get(pid) || []) {
          if (!visited.has(nbr)) { visited.add(nbr); bfsQ.push(nbr); }
        }
      }
      components.push(comp);
    }

    // Step 3: Within each component, find the single best root and BFS generations
    for (const comp of components) {
      // Find members with no parents (roots of this component)
      const compRoots = comp.filter(id => (parentsOf.get(id) || []).length === 0);

      // Pick the SINGLE best root: the one with the most descendants reachable
      // via parent→child edges. This filters out married-in spouses who are
      // parentless but not the true ancestor. Ties broken by earliest birth year.
      let bestRoot = comp[0];
      if (compRoots.length > 0) {
        let bestScore = -1;
        for (const rootId of compRoots) {
          // Count descendants reachable via parent→child only
          let count = 0;
          const dq = [rootId];
          const dVisited = new Set([rootId]);
          while (dq.length > 0) {
            const pid = dq.shift();
            for (const cid of (childrenOf.get(pid) || [])) {
              if (!dVisited.has(cid)) {
                dVisited.add(cid);
                dq.push(cid);
                count++;
              }
            }
          }
          const m = memberMap.get(rootId);
          const year = m?.birthDate ? parseInt(m.birthDate.substring(0, 4)) : 9999;
          // Score: descendants first (higher is better), then earlier birth year as tiebreaker
          if (count > bestScore || (count === bestScore && year < (memberMap.get(bestRoot)?.birthDate ? parseInt(memberMap.get(bestRoot).birthDate.substring(0, 4)) : 9999))) {
            bestScore = count;
            bestRoot = rootId;
          }
        }
      }

      // BFS from the single best root
      const queue = [];
      generation.set(bestRoot, 0);
      queue.push(bestRoot);

      while (queue.length > 0) {
        const personId = queue.shift();
        const gen = generation.get(personId);

        // Propagate to children
        for (const childId of (childrenOf.get(personId) || [])) {
          if (!generation.has(childId)) {
            generation.set(childId, gen + 1);
            queue.push(childId);
          }
        }
        // Propagate to parents (for upward traversal from non-root starts)
        for (const parentId of (parentsOf.get(personId) || [])) {
          if (!generation.has(parentId)) {
            generation.set(parentId, gen - 1);
            queue.push(parentId);
          }
        }
        // Propagate to spouses (same generation)
        for (const spouseId of (spouseOf.get(personId) || [])) {
          if (!generation.has(spouseId)) {
            generation.set(spouseId, gen);
            queue.push(spouseId);
          }
        }
      }
    }

    // Step 4: Align spouses that ended up at different generations
    // (can happen when a spouse was reached via parent_child before spouse edge)
    for (const se of spouseEdges) {
      const genA = generation.get(se.from);
      const genB = generation.get(se.to);
      if (genA !== undefined && genB !== undefined && genA !== genB) {
        // Prefer the generation of whichever has a blood-line parent connection
        const aHasParents = (parentsOf.get(se.from) || []).length > 0;
        const bHasParents = (parentsOf.get(se.to) || []).length > 0;
        if (aHasParents && !bHasParents) {
          generation.set(se.to, genA);
        } else if (bHasParents && !aHasParents) {
          generation.set(se.from, genB);
        } else {
          // Both have parents — use the deeper (larger) generation
          const maxG = Math.max(genA, genB);
          generation.set(se.from, maxG);
          generation.set(se.to, maxG);
        }
      }
    }

    // Step 5: Catch any unassigned members
    for (const m of members) {
      if (!generation.has(m.id)) generation.set(m.id, 0);
    }

    // Step 6: Normalize so minimum generation is 0
    const minGen = Math.min(...generation.values());
    if (minGen < 0) {
      for (const [id, gen] of generation) generation.set(id, gen - minGen);
    }

    const maxGen = Math.max(...generation.values(), 0);

    // ─── Build generation groups ───
    const genGroups = [];
    for (let g = 0; g <= maxGen; g++) genGroups.push([]);
    const placed = new Set();

    // Multi-couple units first (so their members are marked as placed)
    for (const [multiId, info] of multiCoupleMap) {
      const gen = generation.get(info.pivotId) || 0;
      genGroups[gen].push({
        type: 'multi-couple', id: multiId, pivotId: info.pivotId,
        couples: info.couples,
        children: [],  // filled after unitChildren assignment
      });
      placed.add(info.pivotId);
      for (const { spouse } of info.couples) placed.add(spouse);
    }

    // Regular couples (skip absorbed ones)
    for (const couple of couples) {
      if (absorbedCouples.has(couple.id)) continue;
      const gen = generation.get(couple.a) || 0;
      genGroups[gen].push({
        type: 'couple', id: couple.id, a: couple.a, b: couple.b,
        children: getCoupleChildren(couple),
      });
      placed.add(couple.a);
      placed.add(couple.b);
    }

    // Singles
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
      if (!inCouple.has(personId)) return personId;
      const coupleIds = inCouple.get(personId);
      // Multi-couple pivot?
      if (multiCouplePersons.has(personId)) return `multi-${personId}`;
      // Spouse of a multi-couple pivot?
      for (const cid of coupleIds) {
        if (absorbedCouples.has(cid)) {
          const couple = coupleMap.get(cid);
          const other = couple.a === personId ? couple.b : couple.a;
          if (multiCouplePersons.has(other)) return `multi-${other}`;
        }
      }
      return coupleIds[0]; // single couple
    }

    const unitChildren = new Map();
    const childPlaced = new Set();

    // Assign children to individual couples
    for (const couple of couples) {
      const children = getCoupleChildren(couple);
      unitChildren.set(couple.id, children);
      for (const c of children) childPlaced.add(c);
    }
    // Aggregate children for multi-couple units + pick up unplaced pivot children
    for (const [multiId, info] of multiCoupleMap) {
      const allChildren = [];
      for (const { coupleId } of info.couples) {
        allChildren.push(...(unitChildren.get(coupleId) || []));
      }
      // Any unplaced children of the pivot (no second parent in any couple)
      const pivotChildren = childrenOf.get(info.pivotId) || [];
      for (const c of pivotChildren) {
        if (!childPlaced.has(c)) {
          allChildren.push(c);
          childPlaced.add(c);
          // Also add to the first couple's children for edge routing
          const firstCoupleId = info.couples[0].coupleId;
          const fc = unitChildren.get(firstCoupleId) || [];
          fc.push(c);
          unitChildren.set(firstCoupleId, fc);
        }
      }
      unitChildren.set(multiId, allChildren);
    }
    // Back-fill children for genGroups multi-couple entries
    for (let g = 0; g <= maxGen; g++) {
      for (const unit of genGroups[g]) {
        if (unit.type === 'multi-couple') {
          unit.children = unitChildren.get(unit.id) || [];
        }
      }
    }
    // Single persons (not in any couple)
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

    // Helper: total width of a list of children laid out in a row
    function childrenRowWidth(childIds) {
      if (!childIds || childIds.length === 0) return 0;
      const unique = [...new Set(childIds.map(c => getUnitForPerson(c)))];
      let w = 0;
      for (const cu of unique) w += calcWidth(cu);
      w += (unique.length - 1) * SIBLING_GAP;
      return w;
    }

    function calcWidth(unitId) {
      if (unitWidth.has(unitId)) return unitWidth.get(unitId);

      if (multiCoupleMap.has(unitId)) {
        // Multi-couple: pivot has multiple spouses. ALL children from all
        // sub-couples are treated as one combined row (like a regular couple).
        // The self-width is the full span of the parent row (pivot + all spouses).
        // The total width = max(self-width, combined children row width).
        const info = multiCoupleMap.get(unitId);

        // Self-width: pivot + each sub-couple adds one spouse + gap
        let selfWidth = NODE_W; // pivot
        for (let i = 0; i < info.couples.length; i++) {
          selfWidth += NODE_W + SPOUSE_GAP; // each spouse + gap
        }

        // Combined children from all sub-couples
        const allChildren = [];
        for (const ci of info.couples) {
          for (const cid of (unitChildren.get(ci.coupleId) || [])) {
            allChildren.push(cid);
          }
        }
        const childWidth = childrenRowWidth(allChildren);
        const totalWidth = Math.max(selfWidth, childWidth);

        unitWidth.set(unitId, totalWidth);
        return totalWidth;
      }

      const children = unitChildren.get(unitId) || [];
      const selfWidth = coupleMap.has(unitId) ? NODE_W * 2 + SPOUSE_GAP : NODE_W;

      if (children.length === 0) { unitWidth.set(unitId, selfWidth); return selfWidth; }

      const childWidth = childrenRowWidth(children);
      const totalWidth = Math.max(selfWidth, childWidth);
      unitWidth.set(unitId, totalWidth);
      return totalWidth;
    }

    // Calculate widths: multi-couple units first, then regular couples, then singles
    for (const [multiId] of multiCoupleMap) calcWidth(multiId);
    for (const couple of couples) {
      if (!absorbedCouples.has(couple.id)) calcWidth(couple.id);
    }
    for (const m of members) { if (!inCouple.has(m.id)) calcWidth(m.id); }

    // Helper: get a sortable birth date string for the blood descendant in a unit.
    function unitBirthYear(unitId) {
      // Multi-couple: use pivot person
      if (multiCoupleMap.has(unitId)) {
        const person = memberMap.get(multiCoupleMap.get(unitId).pivotId);
        if (person?.birthDate) return person.birthDate;
        return '9999-12-31';
      }
      const couple = coupleMap.get(unitId);
      let person;
      if (couple) {
        // couple.a is the blood descendant (set during couple creation)
        person = memberMap.get(couple.a);
      } else {
        person = memberMap.get(unitId);
      }
      if (person?.birthDate) return person.birthDate;
      return '9999-12-31';
    }

    return {
      memberMap, spouseEdges, parentChildEdges, siblingEdges,
      spouseOf, childrenOf, parentsOf,
      inCouple, couples, coupleMap,
      multiCouplePersons, multiCoupleMap, absorbedCouples,
      generation, genGroups, maxGen,
      unitChildren, unitWidth, getUnitForPerson, calcWidth,
      childrenRowWidth, unitBirthYear,
    };
  }

  /**
   * Build Cytoscape elements (nodes + edges) from layout base.
   * Shared between both layout modes.
   */
  function buildElements(base) {
    const elements = [];
    const { spouseEdges, parentChildEdges, siblingEdges, inCouple, couples, coupleMap, parentsOf, unitChildren } = base;

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

    // Couple midpoint nodes (each couple gets its own, even in multi-couple)
    for (const couple of couples) {
      elements.push({
        group: 'nodes',
        data: { id: couple.id, label: '', coupleNode: true },
        classes: 'couple-midpoint',
      });
    }

    // Spouse edges (split halves through the couple midpoint)
    for (const se of spouseEdges) {
      // Find the specific couple containing both se.from and se.to
      const couplesFrom = inCouple.get(se.from) || [];
      const couplesTo = inCouple.get(se.to) || [];
      const coupleId = couplesFrom.find(c => couplesTo.includes(c));
      if (coupleId) {
        elements.push({ group: 'edges', data: { id: `e-spouse-${se.from}-${coupleId}`, source: se.from, target: coupleId, relType: 'spouse', spouseHalf: 'a' }, classes: 'spouse-edge' });
        elements.push({ group: 'edges', data: { id: `e-spouse-${coupleId}-${se.to}`, source: coupleId, target: se.to, relType: 'spouse', spouseHalf: 'b' }, classes: 'spouse-edge' });
      } else {
        elements.push({ group: 'edges', data: { id: `e-${se.id}`, source: se.from, target: se.to, relType: 'spouse' }, classes: 'spouse-edge' });
      }
    }

    // Parent-child edges — route through the correct couple midpoint
    for (const pc of parentChildEdges) {
      const parentCoupleIds = inCouple.get(pc.parent) || [];
      // Find the couple whose children include this child
      let parentCoupleId = null;
      for (const cid of parentCoupleIds) {
        const cc = unitChildren.get(cid) || [];
        if (cc.includes(pc.child)) { parentCoupleId = cid; break; }
      }
      // Fallback: first couple
      if (!parentCoupleId && parentCoupleIds.length > 0) {
        parentCoupleId = parentCoupleIds[0];
      }
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
  //  COLLISION AVOIDANCE — Post-layout overlap resolution
  // ═══════════════════════════════════════════════════════════

  /**
   * Post-layout pass: detect and resolve overlapping nodes.
   *
   * Works with "slots" — a slot is either a coupled pair (treated as one wide
   * block: personA + midpoint + personB) or a single uncoupled person.
   * Spouses are NEVER separated; the whole slot shifts as a unit.
   *
   * @param {Object} positions - node ID → {x, y}
   * @param {Array} elements - layout elements
   * @param {Object} opts - { yTolerance: number } (0 for generational, NODE_H for temporal)
   */
  function resolveOverlaps(positions, elements, opts = {}) {
    const MIN_GAP = 20;
    const yTol = opts.yTolerance || 0;

    // Build couple membership: person → [coupleIds]
    const personToCouples = new Map(); // person → [coupleId, ...]
    const couplePersons = new Map();   // coupleId → {a, b}
    for (const [id] of Object.entries(positions)) {
      if (!id.startsWith('couple-')) continue;
      const inner = id.substring('couple-'.length);
      if (inner.length < 73) continue;
      const a = inner.substring(0, 36);
      const b = inner.substring(37);
      couplePersons.set(id, { a, b });
      if (!personToCouples.has(a)) personToCouples.set(a, []);
      personToCouples.get(a).push(id);
      if (!personToCouples.has(b)) personToCouples.set(b, []);
      personToCouples.get(b).push(id);
    }

    // Detect multi-couple pivots (person in 2+ couples)
    const multiCouplePivots = new Set();
    for (const [person, couples] of personToCouples) {
      if (couples.length >= 2) multiCouplePivots.add(person);
    }

    // Build slots: each slot is { ids: [nodeIds to shift together], leftX, rightX, centerY }
    const processedPersons = new Set();
    const slots = [];

    for (const [id, pos] of Object.entries(positions)) {
      if (id.startsWith('couple-')) continue;
      if (processedPersons.has(id)) continue;

      // Check if this person is a multi-couple pivot
      if (multiCouplePivots.has(id)) {
        // Group pivot + ALL spouses + ALL couple midpoints into one slot
        const allIds = [id];
        let minPosX = pos.x, maxPosX = pos.x;
        let sumY = pos.y, countY = 1;

        for (const cid of personToCouples.get(id)) {
          const cp = couplePersons.get(cid);
          if (!cp) continue;
          const spouseId = cp.a === id ? cp.b : cp.a;
          const spousePos = positions[spouseId];
          const midPos = positions[cid];
          if (spousePos) {
            allIds.push(spouseId);
            minPosX = Math.min(minPosX, spousePos.x);
            maxPosX = Math.max(maxPosX, spousePos.x);
            sumY += spousePos.y;
            countY++;
            processedPersons.add(spouseId);
          }
          if (midPos) {
            allIds.push(cid);
          }
        }

        slots.push({
          ids: allIds,
          leftX: minPosX - NODE_W / 2,
          rightX: maxPosX + NODE_W / 2,
          centerY: sumY / countY,
          sortX: (minPosX + maxPosX) / 2
        });
        processedPersons.add(id);
        continue;
      }

      // Check if this person is in a regular couple
      const coupleIds = personToCouples.get(id);
      if (coupleIds && coupleIds.length > 0) {
        const coupleId = coupleIds[0];
        const cp = couplePersons.get(coupleId);
        if (cp) {
          const posA = positions[cp.a];
          const posB = positions[cp.b];
          const posMid = positions[coupleId];
          if (posA && posB && posMid) {
            const leftX = Math.min(posA.x, posB.x) - NODE_W / 2;
            const rightX = Math.max(posA.x, posB.x) + NODE_W / 2;
            const centerY = (posA.y + posB.y) / 2;
            slots.push({
              ids: [cp.a, cp.b, coupleId],
              leftX, rightX, centerY,
              sortX: (posA.x + posB.x) / 2
            });
            processedPersons.add(cp.a);
            processedPersons.add(cp.b);
            continue;
          }
        }
      }

      // Single person (no couple or couple not in positions)
      slots.push({
        ids: [id],
        leftX: pos.x - NODE_W / 2,
        rightX: pos.x + NODE_W / 2,
        centerY: pos.y,
        sortX: pos.x
      });
      processedPersons.add(id);
    }

    // Helper: shift a slot by dx
    function shiftSlot(slot, dx) {
      for (const nid of slot.ids) {
        if (positions[nid]) positions[nid].x += dx;
      }
      slot.leftX += dx;
      slot.rightX += dx;
      slot.sortX += dx;
    }

    if (yTol === 0) {
      // === GENERATIONAL MODE: group by exact Y row ===
      const rowMap = new Map();
      for (const s of slots) {
        const rowKey = Math.round(s.centerY);
        if (!rowMap.has(rowKey)) rowMap.set(rowKey, []);
        rowMap.get(rowKey).push(s);
      }

      const sortedRowKeys = [...rowMap.keys()].sort((a, b) => a - b);
      for (const rowKey of sortedRowKeys) {
        const rowSlots = rowMap.get(rowKey);
        rowSlots.sort((a, b) => a.leftX - b.leftX);

        for (let i = 1; i < rowSlots.length; i++) {
          const prev = rowSlots[i - 1];
          const curr = rowSlots[i];
          const gap = curr.leftX - prev.rightX;

          if (gap < MIN_GAP) {
            const shift = MIN_GAP - gap;
            for (let j = i; j < rowSlots.length; j++) {
              shiftSlot(rowSlots[j], shift);
            }
          }
        }
      }
    } else {
      // === TEMPORAL MODE: 2D overlap check with Y tolerance ===
      slots.sort((a, b) => a.leftX - b.leftX);

      for (let pass = 0; pass < 5; pass++) {
        let shifted = false;
        for (let i = 1; i < slots.length; i++) {
          const curr = slots[i];
          for (let j = i - 1; j >= 0; j--) {
            const prev = slots[j];
            if (curr.leftX - prev.rightX >= MIN_GAP) break;
            if (Math.abs(curr.centerY - prev.centerY) < NODE_H + MIN_GAP) {
              const gap = curr.leftX - prev.rightX;
              if (gap < MIN_GAP) {
                const shift = MIN_GAP - gap;
                for (let k = i; k < slots.length; k++) {
                  shiftSlot(slots[k], shift);
                }
                shifted = true;
                break;
              }
            }
          }
        }
        if (!shifted) break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  GENERATIONAL LAYOUT
  // ═══════════════════════════════════════════════════════════

  function buildGenerationalLayout(members, relationships) {
    const base = buildLayoutBase(members, relationships);
    const positions = {};
    const { memberMap, coupleMap, genGroups, maxGen, generation, unitChildren,
            unitWidth, getUnitForPerson, inCouple, childrenRowWidth,
            unitBirthYear, multiCoupleMap, absorbedCouples, childrenOf,
            parentsOf } = base;
    const elements = buildElements(base);

    // ─── BOTTOM-UP LAYOUT ───
    // Process from deepest generation upward to gen 0.
    // Children are positioned first; parents are centered above them.

    const unitPositioned = new Set();  // track which unit IDs are placed

    // Build a reverse map: child unit → parent unit
    // so we can group siblings together at the leaf level.
    const childUnitToParentUnit = new Map();
    for (const [parentUnitId, children] of unitChildren) {
      for (const childId of children) {
        const childUnit = getUnitForPerson(childId);
        if (!childUnitToParentUnit.has(childUnit)) {
          childUnitToParentUnit.set(childUnit, parentUnitId);
        }
      }
    }

    // Helper: get all person IDs in a unit
    function getUnitPersonIds(unitId) {
      const multi = multiCoupleMap.get(unitId);
      if (multi) {
        const ids = [multi.pivotId];
        for (const ci of multi.couples) ids.push(ci.spouse);
        return ids;
      }
      const couple = coupleMap.get(unitId);
      if (couple) return [couple.a, couple.b];
      return [unitId];
    }

    // Helper: get all couple midpoint IDs in a unit
    function getUnitMidpointIds(unitId) {
      const multi = multiCoupleMap.get(unitId);
      if (multi) return multi.couples.map(ci => ci.coupleId);
      if (coupleMap.has(unitId)) return [unitId];
      return [];
    }

    // Helper: position a single unit at a given centerX, y
    // Only places this unit's own nodes (persons + midpoints), NOT children.
    function placeUnitAt(unit, centerX, y) {
      if (unitPositioned.has(unit.id)) return;
      unitPositioned.add(unit.id);

      if (unit.type === 'multi-couple') {
        const info = multiCoupleMap.get(unit.id);
        const pivotId = info.pivotId;

        // For multi-couple, we need to center the pivot, then place spouses
        // on alternating sides, stacking outward.
        positions[pivotId] = { x: centerX, y };

        let rightX = centerX;  // rightmost occupied center
        let leftX = centerX;   // leftmost occupied center

        for (let ci = 0; ci < info.couples.length; ci++) {
          const coupleInfo = info.couples[ci];
          const coupleChildren = unitChildren.get(coupleInfo.coupleId) || [];

          // Determine which side to place this spouse on.
          // If this sub-couple has positioned children, place spouse
          // on the side of those children. Otherwise alternate sides.
          let side;
          if (coupleChildren.length > 0) {
            // Find children's center X (they're already positioned)
            let sumCX = 0, countCX = 0;
            for (const cid of coupleChildren) {
              const cUnit = getUnitForPerson(cid);
              // Get any positioned person in child unit
              for (const pid of getUnitPersonIds(cUnit)) {
                if (positions[pid]) { sumCX += positions[pid].x; countCX++; break; }
              }
            }
            if (countCX > 0) {
              side = (sumCX / countCX) >= centerX ? 1 : -1;
            } else {
              side = ci % 2 === 0 ? 1 : -1;
            }
          } else {
            side = ci % 2 === 0 ? 1 : -1;
          }

          // Place spouse stacking outward from the outermost occupied position
          let spouseX;
          if (side > 0) {
            spouseX = rightX + NODE_W + SPOUSE_GAP;
            rightX = spouseX;
          } else {
            spouseX = leftX - NODE_W - SPOUSE_GAP;
            leftX = spouseX;
          }

          const midX = (centerX + spouseX) / 2;
          positions[coupleInfo.coupleId] = { x: midX, y };
          positions[coupleInfo.spouse] = { x: spouseX, y };
        }

      } else if (unit.type === 'couple') {
        const couple = coupleMap.get(unit.id);
        positions[couple.a] = { x: centerX - SPOUSE_GAP / 2 - NODE_W / 2, y };
        positions[couple.b] = { x: centerX + SPOUSE_GAP / 2 + NODE_W / 2, y };
        positions[unit.id] = { x: centerX, y };

      } else {
        // Single person
        positions[unit.id] = { x: centerX, y };
      }
    }

    // Helper: get the self-width of a unit (just the parent row, not children)
    function unitSelfWidth(unitId) {
      const multi = multiCoupleMap.get(unitId);
      if (multi) {
        let w = NODE_W; // pivot
        for (let i = 0; i < multi.couples.length; i++) w += NODE_W + SPOUSE_GAP;
        return w;
      }
      if (coupleMap.has(unitId)) return NODE_W * 2 + SPOUSE_GAP;
      return NODE_W;
    }

    // Helper: compute the X extent of a unit's children (already positioned)
    function childrenExtent(unitId) {
      const children = unitChildren.get(unitId) || [];
      if (children.length === 0) return null;

      const seen = new Set();
      let minX = Infinity, maxX = -Infinity;

      for (const childId of children) {
        const cu = getUnitForPerson(childId);
        if (seen.has(cu)) continue;
        seen.add(cu);

        // Get extent of all persons in this child unit
        for (const pid of getUnitPersonIds(cu)) {
          if (positions[pid]) {
            minX = Math.min(minX, positions[pid].x - NODE_W / 2);
            maxX = Math.max(maxX, positions[pid].x + NODE_W / 2);
          }
        }
      }

      if (minX === Infinity) return null;
      return { minX, maxX, centerX: (minX + maxX) / 2 };
    }

    // Helper: build a unit descriptor from genGroups or unit ID
    function makeUnit(unitId) {
      const multi = multiCoupleMap.get(unitId);
      if (multi) {
        return { type: 'multi-couple', id: unitId, pivotId: multi.pivotId,
                 couples: multi.couples, children: unitChildren.get(unitId) || [] };
      }
      const couple = coupleMap.get(unitId);
      if (couple) {
        return { type: 'couple', id: unitId, a: couple.a, b: couple.b,
                 children: unitChildren.get(unitId) || [] };
      }
      return { type: 'single', id: unitId, children: unitChildren.get(unitId) || [] };
    }

    // ─── STEP 1: Collect all units per generation ───
    // genUnits[g] = array of unit IDs at generation g
    const genUnits = [];
    for (let g = 0; g <= maxGen; g++) {
      const unitIds = [];
      const seen = new Set();
      for (const unit of genGroups[g]) {
        if (!seen.has(unit.id)) { seen.add(unit.id); unitIds.push(unit.id); }
      }
      genUnits.push(unitIds);
    }

    // ─── STEP 2: Process generations bottom-up ───
    for (let g = maxGen; g >= 0; g--) {
      const y = g * GEN_GAP;
      const unitsAtGen = genUnits[g];

      // Separate units into: those with positioned children (Case A)
      // and those without (Case B - leaf units or childless units)
      const unitsWithChildren = [];
      const unitsWithoutChildren = [];

      for (const uid of unitsAtGen) {
        if (unitPositioned.has(uid)) continue; // already placed (e.g. by parent logic)

        const ext = childrenExtent(uid);
        if (ext) {
          unitsWithChildren.push({ id: uid, childExt: ext });
        } else {
          unitsWithoutChildren.push(uid);
        }
      }

      // ── Case A: units with children → center above their children ──
      for (const { id: uid, childExt } of unitsWithChildren) {
        placeUnitAt(makeUnit(uid), childExt.centerX, y);
      }

      // ── Case B: units without children (leaf / childless) ──
      // Group by parent unit so siblings stay together.
      // Then place groups left-to-right.
      if (unitsWithoutChildren.length > 0) {
        // Group by parent unit
        const parentGroups = new Map(); // parentUnitId → [childUnitId, ...]
        const orphans = []; // units with no parent
        for (const uid of unitsWithoutChildren) {
          const parentUnit = childUnitToParentUnit.get(uid);
          if (parentUnit) {
            if (!parentGroups.has(parentUnit)) parentGroups.set(parentUnit, []);
            parentGroups.get(parentUnit).push(uid);
          } else {
            orphans.push(uid);
          }
        }

        // Sort units within each group by birth year
        for (const [, group] of parentGroups) {
          group.sort((a, b) => unitBirthYear(a).localeCompare(unitBirthYear(b)));
        }
        orphans.sort((a, b) => unitBirthYear(a).localeCompare(unitBirthYear(b)));

        // Determine placement X: find the rightmost edge of already-placed
        // units in this row, then continue from there. Also check if any
        // sibling of these units is already positioned (Case A siblings).
        let placementX;

        // Find where siblings with children were placed, to put childless
        // siblings adjacent to them.
        const siblingAnchors = new Map(); // parentUnit → { rightEdge, leftEdge }
        for (const { id: uid } of unitsWithChildren) {
          const parentUnit = childUnitToParentUnit.get(uid);
          if (parentUnit && parentGroups.has(parentUnit)) {
            // This unit (already positioned) shares a parent with some childless units.
            // Find its extent.
            let unitMinX = Infinity, unitMaxX = -Infinity;
            for (const pid of getUnitPersonIds(uid)) {
              if (positions[pid]) {
                unitMinX = Math.min(unitMinX, positions[pid].x - NODE_W / 2);
                unitMaxX = Math.max(unitMaxX, positions[pid].x + NODE_W / 2);
              }
            }
            if (unitMinX !== Infinity) {
              if (!siblingAnchors.has(parentUnit)) {
                siblingAnchors.set(parentUnit, { minX: unitMinX, maxX: unitMaxX });
              } else {
                const a = siblingAnchors.get(parentUnit);
                a.minX = Math.min(a.minX, unitMinX);
                a.maxX = Math.max(a.maxX, unitMaxX);
              }
            }
          }
        }

        // Find the overall rightmost X of all positioned units at this gen
        let rowRightEdge = -Infinity;
        for (const uid of unitsAtGen) {
          if (unitPositioned.has(uid)) {
            for (const pid of getUnitPersonIds(uid)) {
              if (positions[pid]) {
                rowRightEdge = Math.max(rowRightEdge, positions[pid].x + NODE_W / 2);
              }
            }
          }
        }
        // Also check ALL positioned units at this Y (from other gens that happen to overlap)
        if (rowRightEdge === -Infinity) rowRightEdge = 0;

        // Place childless groups: prefer anchoring next to siblings
        for (const [parentUnit, group] of parentGroups) {
          const anchor = siblingAnchors.get(parentUnit);
          if (anchor) {
            // Place to the right of the rightmost sibling
            placementX = anchor.maxX + SIBLING_GAP + unitSelfWidth(group[0]) / 2;
          } else {
            // No sibling anchor; place after everything in the row
            placementX = rowRightEdge + SIBLING_GAP + unitSelfWidth(group[0]) / 2;
          }

          for (const uid of group) {
            const sw = unitSelfWidth(uid);
            placeUnitAt(makeUnit(uid), placementX, y);
            placementX += sw + SIBLING_GAP;
            // Update row right edge
            for (const pid of getUnitPersonIds(uid)) {
              if (positions[pid]) {
                rowRightEdge = Math.max(rowRightEdge, positions[pid].x + NODE_W / 2);
              }
            }
          }
        }

        // Orphans (no parent in tree): place at end
        if (orphans.length > 0) {
          placementX = rowRightEdge + SIBLING_GAP * 2 + unitSelfWidth(orphans[0]) / 2;
          for (const uid of orphans) {
            const sw = unitSelfWidth(uid);
            placeUnitAt(makeUnit(uid), placementX, y);
            placementX += sw + SIBLING_GAP;
            for (const pid of getUnitPersonIds(uid)) {
              if (positions[pid]) {
                rowRightEdge = Math.max(rowRightEdge, positions[pid].x + NODE_W / 2);
              }
            }
          }
        }
      }

      // ── Per-row overlap resolution (safety net) ──
      // After all units at this gen are placed, scan for overlaps
      // and push apart any that still collide.
      resolveRowOverlaps(positions, unitsAtGen, getUnitPersonIds, getUnitMidpointIds);
    }

    // ─── STEP 3: Center the entire tree around X=0 ───
    let globalMinX = Infinity, globalMaxX = -Infinity;
    for (const pos of Object.values(positions)) {
      globalMinX = Math.min(globalMinX, pos.x);
      globalMaxX = Math.max(globalMaxX, pos.x);
    }
    const offsetX = -(globalMinX + globalMaxX) / 2;
    if (isFinite(offsetX) && offsetX !== 0) {
      for (const pos of Object.values(positions)) pos.x += offsetX;
    }

    return { elements, positions };
  }

  /**
   * Per-row overlap resolution: scan units left-to-right at a single generation
   * row, push apart any that overlap.
   */
  function resolveRowOverlaps(positions, unitIds, getUnitPersonIds, getUnitMidpointIds) {
    const MIN_GAP = 20;

    // Build slot for each unit: { ids, leftX, rightX }
    const slots = [];
    for (const uid of unitIds) {
      const personIds = getUnitPersonIds(uid);
      const midIds = getUnitMidpointIds(uid);
      const allIds = [...personIds, ...midIds];

      let minX = Infinity, maxX = -Infinity;
      for (const pid of personIds) {
        if (positions[pid]) {
          minX = Math.min(minX, positions[pid].x - NODE_W / 2);
          maxX = Math.max(maxX, positions[pid].x + NODE_W / 2);
        }
      }
      if (minX === Infinity) continue;

      slots.push({ ids: allIds, leftX: minX, rightX: maxX, uid });
    }

    slots.sort((a, b) => a.leftX - b.leftX);

    for (let i = 1; i < slots.length; i++) {
      const prev = slots[i - 1];
      const curr = slots[i];
      const gap = curr.leftX - prev.rightX;
      if (gap < MIN_GAP) {
        const shift = MIN_GAP - gap;
        // Shift this slot and all subsequent slots to the right
        for (let j = i; j < slots.length; j++) {
          for (const nid of slots[j].ids) {
            if (positions[nid]) positions[nid].x += shift;
          }
          slots[j].leftX += shift;
          slots[j].rightX += shift;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  TEMPORAL LAYOUT
  // ═══════════════════════════════════════════════════════════

  function buildTemporalLayout(members, relationships) {
    // Derive temporal layout from generational layout:
    // Keep the same X positions, replace Y with birth-year-based Y.
    const genResult = buildGenerationalLayout(members, relationships);
    const positions = genResult.positions;
    const elements = genResult.elements;

    // Rebuild base just for generation + couple info (lightweight)
    const base = buildLayoutBase(members, relationships);
    const { generation, couples, memberMap } = base;

    // ─── Compute birth years ───
    const birthYears = new Map();
    let minYear = Infinity;

    for (const m of members) {
      if (m.birthDate) {
        const y = parseInt(m.birthDate.substring(0, 4));
        if (!isNaN(y)) {
          birthYears.set(m.id, y);
          minYear = Math.min(minYear, y);
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

    // Assign missing birth years
    for (const m of members) {
      if (!birthYears.has(m.id)) {
        const gen = generation.get(m.id) || 0;
        const avg = genAvgYear.get(gen);
        birthYears.set(m.id, avg ? Math.round(avg)
          : (minYear !== Infinity ? minYear + gen * 25 : 1950 + gen * 25));
      }
    }

    if (minYear === Infinity) minYear = 1920;
    const baseYear = Math.floor(minYear / 10) * 10;

    // ─── Replace Y coordinates with birth-year Y ───
    for (const m of members) {
      if (positions[m.id]) {
        positions[m.id].y = (birthYears.get(m.id) - baseYear) * YEAR_PX;
      }
    }

    // Couple midpoints: average of spouse Ys
    for (const couple of couples) {
      if (positions[couple.id]) {
        const ya = positions[couple.a]?.y || 0;
        const yb = positions[couple.b]?.y || 0;
        positions[couple.id].y = (ya + yb) / 2;
      }
    }

    // Light overlap resolution with Y tolerance
    resolveOverlaps(positions, elements, { yTolerance: NODE_H });

    return { elements, positions };
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  function render(memberData, relationshipData) {
    // Filter out orphan members (those with zero relationships)
    const connectedIds = new Set();
    for (const r of relationshipData) {
      connectedIds.add(r.fromId);
      connectedIds.add(r.toId);
    }
    members = memberData.filter(m => connectedIds.has(m.id));
    relationships = relationshipData;

    const result = viewMode === 'temporal'
      ? buildTemporalLayout(members, relationships)
      : buildGenerationalLayout(members, relationships);
    const { elements, positions } = result;

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
  }

  /**
   * Animated re-render for view mode switching.
   */
  function renderWithAnimation() {
    const result = viewMode === 'temporal'
      ? buildTemporalLayout(members, relationships)
      : buildGenerationalLayout(members, relationships);
    const { positions } = result;

    applySpouseEdgeStyle();

    const duration = 700;
    for (const [id, pos] of Object.entries(positions)) {
      const node = cy.getElementById(id);
      if (node.length) {
        node.animate({ position: pos }, { duration, easing: 'ease-in-out-cubic' });
      }
    }

    setTimeout(() => {
      cy.animate({ fit: { padding: 60 }, duration: 400, easing: 'ease-out' });
    }, duration);
  }

  /**
   * Apply view-mode-specific style to spouse edges.
   */
  function applySpouseEdgeStyle() {
    if (!cy) return;
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

  /**
   * Apply highlight styling to the given path nodes/edges.
   * Shared logic between highlightConnection and restoreHighlight.
   */
  function applyHighlightStyling(pathNodeIds, pathEdgePairs) {
    // Build person -> [coupleId, ...] map from Cytoscape nodes (supports multi-couple)
    const personToCouples = new Map();
    cy.nodes('.couple-midpoint').forEach(cpNode => {
      const cpId = cpNode.id();
      const inner = cpId.substring('couple-'.length);
      if (inner.length >= 73) {
        const p1 = inner.substring(0, 36);
        const p2 = inner.substring(37);
        if (!personToCouples.has(p1)) personToCouples.set(p1, []);
        personToCouples.get(p1).push(cpId);
        if (!personToCouples.has(p2)) personToCouples.set(p2, []);
        personToCouples.get(p2).push(cpId);
      }
    });

    cy.elements().addClass('dimmed');

    for (const nodeId of pathNodeIds) {
      const node = cy.getElementById(nodeId);
      if (node.length) node.removeClass('dimmed').addClass('highlighted');
    }

    function markEdge(edge) {
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
      const couplesOfFrom = personToCouples.get(from) || [];
      const couplesOfTo = personToCouples.get(to) || [];

      const directEdges = findEdges(from, to);
      if (directEdges.length > 0) { directEdges.forEach(e => markEdge(e)); continue; }

      // Check if both share a couple midpoint (spouses in same couple)
      const sharedCouple = couplesOfFrom.find(c => couplesOfTo.includes(c));
      if (sharedCouple) {
        findEdges(from, sharedCouple).forEach(e => markEdge(e));
        findEdges(sharedCouple, to).forEach(e => markEdge(e));
        continue;
      }

      // Try routing through a couple midpoint of 'from'
      let found = false;
      for (const cpId of couplesOfFrom) {
        const midToChild = findEdges(cpId, to);
        if (midToChild.length > 0) {
          findEdges(from, cpId).forEach(e => markEdge(e));
          midToChild.forEach(e => markEdge(e));
          found = true;
          break;
        }
      }
      // Try routing through a couple midpoint of 'to'
      if (!found) {
        for (const cpId of couplesOfTo) {
          const midToParent = findEdges(cpId, from);
          if (midToParent.length > 0) {
            midToParent.forEach(e => markEdge(e));
            findEdges(to, cpId).forEach(e => markEdge(e));
            break;
          }
        }
      }
    }
  }

  function highlightConnection(fromId, toId) {
    clearHighlight();

    const { nodeIds: pathNodeIds, edgePairs: pathEdgePairs } = Relationship.getPathData(fromId, toId, members, relationships);
    if (pathNodeIds.length === 0) return;

    highlightedPath = pathNodeIds;
    highlightedFromId = fromId;
    highlightedToId = toId;

    applyHighlightStyling(pathNodeIds, pathEdgePairs);

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

  function restoreHighlight() {
    if (!cy || !highlightedFromId || !highlightedToId) return;

    const { nodeIds: pathNodeIds, edgePairs: pathEdgePairs } = Relationship.getPathData(highlightedFromId, highlightedToId, members, relationships);
    if (pathNodeIds.length === 0) return;

    applyHighlightStyling(pathNodeIds, pathEdgePairs);
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
    setViewMode,
    getViewMode,
  };
})();
