/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Tree Visualization (Cytoscape.js)
   Couple-centered layout: spouses side-by-side with shared
   descent line from the midpoint of the couple connector.
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
        // Multi-couple: each sub-couple occupies a "half" with its own children.
        // Layout: ...Spouse2 ─ [mid2] ─ Pivot ─ [mid1] ─ Spouse1
        // The total width is the sum of each half's max(couple-portion, children-width),
        // ensuring children beneath each midpoint don't overlap with the other half.
        const info = multiCoupleMap.get(unitId);
        const coupleSlotWidth = NODE_W + SPOUSE_GAP; // one spouse + gap to pivot
        let totalWidth = NODE_W; // pivot node in the center

        for (const ci of info.couples) {
          const subChildren = unitChildren.get(ci.coupleId) || [];
          const subChildWidth = childrenRowWidth(subChildren);
          // Children are centered under the sub-couple midpoint. The midpoint
          // is at offset NODE_W/2 + SPOUSE_GAP/2 from the pivot center.
          // Children extend subChildWidth/2 each way from the midpoint.
          // So the half-width from pivot center = NODE_W/2 + SPOUSE_GAP/2 + subChildWidth/2.
          // But also at minimum the couple slot (spouse + gap) must fit.
          const childHalf = subChildWidth / 2 + SPOUSE_GAP / 2 + NODE_W / 2;
          const halfWidth = Math.max(coupleSlotWidth, childHalf);
          totalWidth += halfWidth;
        }

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
   * @param {Object} positions - node ID → {x, y}
   * @param {Array} elements - layout elements
   * @param {Object} opts - options
   * @param {number} opts.yTolerance - Y distance within which nodes can overlap
   *   (default 0 = same-row only, used for generational layout;
   *    set to NODE_H for temporal layout where Y varies by birth year)
   *
   * Strategy for generational (yTolerance=0): group by exact Y row, push apart
   * on each row independently.
   *
   * Strategy for temporal (yTolerance>0): scan all person nodes sorted by X,
   * for each pair within Y tolerance, push apart if X-overlapping.
   */
  function resolveOverlaps(positions, elements, opts = {}) {
    const MIN_GAP = 20; // minimum gap between node edges
    const yTol = opts.yTolerance || 0;

    // Collect person nodes
    const persons = [];
    for (const [id, pos] of Object.entries(positions)) {
      if (id.startsWith('couple-')) continue;
      persons.push({ id, x: pos.x, y: pos.y });
    }

    // Collect couple midpoints for co-shifting
    const allCouples = [];
    for (const [id, pos] of Object.entries(positions)) {
      if (!id.startsWith('couple-')) continue;
      allCouples.push({ id, x: pos.x, y: pos.y });
    }

    if (yTol === 0) {
      // === GENERATIONAL MODE: group by exact Y row ===
      const personRows = new Map();
      for (const p of persons) {
        const rowKey = Math.round(p.y);
        if (!personRows.has(rowKey)) personRows.set(rowKey, []);
        personRows.get(rowKey).push(p);
      }
      const coupleRows = new Map();
      for (const c of allCouples) {
        const rowKey = Math.round(c.y);
        if (!coupleRows.has(rowKey)) coupleRows.set(rowKey, []);
        coupleRows.get(rowKey).push(c);
      }

      const sortedRowKeys = [...personRows.keys()].sort((a, b) => a - b);
      for (const rowKey of sortedRowKeys) {
        const nodes = personRows.get(rowKey);
        nodes.sort((a, b) => a.x - b.x);

        for (let i = 1; i < nodes.length; i++) {
          const prev = nodes[i - 1];
          const curr = nodes[i];
          const minDist = NODE_W + MIN_GAP;
          const actualDist = curr.x - prev.x;

          if (actualDist < minDist) {
            const shift = minDist - actualDist;
            for (let j = i; j < nodes.length; j++) {
              positions[nodes[j].id].x += shift;
              nodes[j].x += shift;
            }
            const couples = coupleRows.get(rowKey) || [];
            const thresholdX = curr.x - shift;
            for (const cp of couples) {
              if (cp.x >= thresholdX - 1) {
                positions[cp.id].x += shift;
                cp.x += shift;
              }
            }
          }
        }
      }
    } else {
      // === TEMPORAL MODE: 2D overlap check with Y tolerance ===
      // Sort all person nodes by X
      persons.sort((a, b) => a.x - b.x);

      // Multiple passes until stable (max 5)
      for (let pass = 0; pass < 5; pass++) {
        let shifted = false;
        for (let i = 1; i < persons.length; i++) {
          const curr = persons[i];
          // Check against all previous nodes that could overlap
          for (let j = i - 1; j >= 0; j--) {
            const prev = persons[j];
            // Stop scanning left if X gap is already large enough
            if (curr.x - prev.x >= NODE_W + MIN_GAP) break;
            // Check if Y-close enough to overlap
            if (Math.abs(curr.y - prev.y) < NODE_H + MIN_GAP) {
              const minDist = NODE_W + MIN_GAP;
              const actualDist = curr.x - prev.x;
              if (actualDist < minDist) {
                const shift = minDist - actualDist;
                // Shift curr and everything to its right
                for (let k = i; k < persons.length; k++) {
                  positions[persons[k].id].x += shift;
                  persons[k].x += shift;
                }
                // Also shift couple midpoints to the right of curr
                const thresholdX = curr.x - shift;
                for (const cp of allCouples) {
                  if (cp.x >= thresholdX - 1) {
                    positions[cp.id].x += shift;
                    cp.x += shift;
                  }
                }
                shifted = true;
                break; // re-check from this position
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
    const { coupleMap, genGroups, maxGen, generation, unitChildren, unitWidth, getUnitForPerson, inCouple, childrenRowWidth, unitBirthYear, multiCoupleMap, absorbedCouples } = base;
    const elements = buildElements(base);

    const allUnitsPlaced = new Set();

    // Helper: position a list of children centered at parentCenterX
    function positionChildren(children, parentCenterX, childY) {
      if (!children || children.length === 0) return;

      const childUnitIds = [];
      const seen = new Set();
      for (const childId of children) {
        const cu = getUnitForPerson(childId);
        if (!seen.has(cu)) { seen.add(cu); childUnitIds.push(cu); }
      }

      childUnitIds.sort((a, b) => unitBirthYear(a).localeCompare(unitBirthYear(b)));

      let totalChildWidth = 0;
      for (const cuId of childUnitIds) totalChildWidth += (unitWidth.get(cuId) || NODE_W);
      totalChildWidth += (childUnitIds.length - 1) * SIBLING_GAP;

      let childX = parentCenterX - totalChildWidth / 2;
      for (const cuId of childUnitIds) {
        const w = unitWidth.get(cuId) || NODE_W;
        const childCenterX = childX + w / 2;
        const multiInfo = multiCoupleMap.get(cuId);
        if (multiInfo) {
          positionUnit({ type: 'multi-couple', id: cuId, pivotId: multiInfo.pivotId, couples: multiInfo.couples, children: unitChildren.get(cuId) || [] }, childCenterX, childY);
        } else {
          const coupleInfo = coupleMap.get(cuId);
          if (coupleInfo) {
            positionUnit({ type: 'couple', id: cuId, a: coupleInfo.a, b: coupleInfo.b, children: unitChildren.get(cuId) || [] }, childCenterX, childY);
          } else {
            positionUnit({ type: 'single', id: cuId, children: unitChildren.get(cuId) || [] }, childCenterX, childY);
          }
        }
        childX += w + SIBLING_GAP;
      }
    }

    function positionUnit(unit, centerX, y) {
      if (allUnitsPlaced.has(unit.id)) return;
      allUnitsPlaced.add(unit.id);

      if (unit.type === 'multi-couple') {
        // Layout: ...Spouse2 ─ [mid2] ─ Pivot ─ [mid1] ─ Spouse1...
        // Each sub-couple's midpoint is positioned based on actual child widths
        const info = multiCoupleMap.get(unit.id);
        const pivotId = info.pivotId;
        positions[pivotId] = { x: centerX, y };

        const coupleSlotWidth = NODE_W + SPOUSE_GAP;
        let rightOffset = NODE_W / 2;  // start from edge of pivot node
        let leftOffset = NODE_W / 2;

        for (let i = 0; i < info.couples.length; i++) {
          const ci = info.couples[i];
          const subChildren = unitChildren.get(ci.coupleId) || [];
          const subChildWidth = childrenRowWidth(subChildren);
          const childHalf = subChildWidth / 2 + SPOUSE_GAP / 2 + NODE_W / 2;
          const halfWidth = Math.max(coupleSlotWidth, childHalf);

          if (i % 2 === 0) {
            // Right side
            const midX = centerX + rightOffset + SPOUSE_GAP / 2;
            const spouseX = centerX + rightOffset + SPOUSE_GAP + NODE_W / 2;
            positions[ci.coupleId] = { x: midX, y };
            positions[ci.spouse] = { x: spouseX, y };
            rightOffset += halfWidth;
          } else {
            // Left side
            const midX = centerX - leftOffset - SPOUSE_GAP / 2;
            const spouseX = centerX - leftOffset - SPOUSE_GAP - NODE_W / 2;
            positions[ci.coupleId] = { x: midX, y };
            positions[ci.spouse] = { x: spouseX, y };
            leftOffset += halfWidth;
          }
        }

        // Position children of each sub-couple beneath their midpoint
        const childY = y + GEN_GAP;
        for (const ci of info.couples) {
          const coupleChildren = unitChildren.get(ci.coupleId) || [];
          if (coupleChildren.length === 0) continue;
          const midPos = positions[ci.coupleId];
          if (midPos) positionChildren(coupleChildren, midPos.x, childY);
        }

      } else if (unit.type === 'couple') {
        const couple = coupleMap.get(unit.id);
        positions[couple.a] = { x: centerX - (SPOUSE_GAP / 2) - (NODE_W / 2), y };
        positions[couple.b] = { x: centerX + (SPOUSE_GAP / 2) + (NODE_W / 2), y };
        positions[unit.id] = { x: centerX, y };

        positionChildren(unit.children, centerX, y + GEN_GAP);

      } else {
        positions[unit.id] = { x: centerX, y };
        positionChildren(unit.children, centerX, y + GEN_GAP);
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

    // Post-layout collision resolution (generational: exact row matching)
    resolveOverlaps(positions, elements);

    return { elements, positions };
  }

  // ═══════════════════════════════════════════════════════════
  //  TEMPORAL LAYOUT
  // ═══════════════════════════════════════════════════════════

  function buildTemporalLayout(members, relationships) {
    const base = buildLayoutBase(members, relationships);
    const positions = {};
    const { coupleMap, genGroups, maxGen, generation, unitChildren, unitWidth, getUnitForPerson, inCouple, couples, childrenRowWidth, unitBirthYear, multiCoupleMap, absorbedCouples } = base;
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
    }

    // ─── Position units (X from width calc, Y from birth year) ───
    const allUnitsPlaced = new Set();

    // Helper: position a list of children centered at parentCenterX
    function positionChildren(children, parentCenterX) {
      if (!children || children.length === 0) return;

      const childUnitIds = [];
      const seen = new Set();
      for (const childId of children) {
        const cu = getUnitForPerson(childId);
        if (!seen.has(cu)) { seen.add(cu); childUnitIds.push(cu); }
      }

      childUnitIds.sort((a, b) => unitBirthYear(a).localeCompare(unitBirthYear(b)));

      let totalChildWidth = 0;
      for (const cuId of childUnitIds) totalChildWidth += (unitWidth.get(cuId) || NODE_W);
      totalChildWidth += (childUnitIds.length - 1) * SIBLING_GAP;

      let childX = parentCenterX - totalChildWidth / 2;
      for (const cuId of childUnitIds) {
        const w = unitWidth.get(cuId) || NODE_W;
        const childCenterX = childX + w / 2;
        const multiInfo = multiCoupleMap.get(cuId);
        if (multiInfo) {
          positionUnit({ type: 'multi-couple', id: cuId, pivotId: multiInfo.pivotId, couples: multiInfo.couples, children: unitChildren.get(cuId) || [] }, childCenterX);
        } else {
          const coupleInfo = coupleMap.get(cuId);
          if (coupleInfo) {
            positionUnit({ type: 'couple', id: cuId, a: coupleInfo.a, b: coupleInfo.b, children: unitChildren.get(cuId) || [] }, childCenterX);
          } else {
            positionUnit({ type: 'single', id: cuId, children: unitChildren.get(cuId) || [] }, childCenterX);
          }
        }
        childX += w + SIBLING_GAP;
      }
    }

    function positionUnit(unit, centerX) {
      if (allUnitsPlaced.has(unit.id)) return;
      allUnitsPlaced.add(unit.id);

      let y;
      if (unit.type === 'multi-couple') {
        const info = multiCoupleMap.get(unit.id);
        const pivotId = info.pivotId;
        const pivotY = memberY.get(pivotId) || 0;
        positions[pivotId] = { x: centerX, y: pivotY };

        const coupleSlotWidth = NODE_W + SPOUSE_GAP;
        let rightOffset = NODE_W / 2;
        let leftOffset = NODE_W / 2;

        for (let i = 0; i < info.couples.length; i++) {
          const ci = info.couples[i];
          const spouseY = memberY.get(ci.spouse) || 0;
          const midY = (pivotY + spouseY) / 2;
          const subChildren = unitChildren.get(ci.coupleId) || [];
          const subChildWidth = childrenRowWidth(subChildren);
          const childHalf = subChildWidth / 2 + SPOUSE_GAP / 2 + NODE_W / 2;
          const halfWidth = Math.max(coupleSlotWidth, childHalf);

          if (i % 2 === 0) {
            // Right side
            const midX = centerX + rightOffset + SPOUSE_GAP / 2;
            const spouseX = centerX + rightOffset + SPOUSE_GAP + NODE_W / 2;
            positions[ci.coupleId] = { x: midX, y: midY };
            positions[ci.spouse] = { x: spouseX, y: spouseY };
            rightOffset += halfWidth;
          } else {
            // Left side
            const midX = centerX - leftOffset - SPOUSE_GAP / 2;
            const spouseX = centerX - leftOffset - SPOUSE_GAP - NODE_W / 2;
            positions[ci.coupleId] = { x: midX, y: midY };
            positions[ci.spouse] = { x: spouseX, y: spouseY };
            leftOffset += halfWidth;
          }
        }
        y = pivotY;

        // Position children of each sub-couple
        for (const ci of info.couples) {
          const coupleChildren = unitChildren.get(ci.coupleId) || [];
          if (coupleChildren.length === 0) continue;
          const midPos = positions[ci.coupleId];
          if (midPos) positionChildren(coupleChildren, midPos.x);
        }

      } else if (unit.type === 'couple') {
        const couple = coupleMap.get(unit.id);
        const ya = memberY.get(couple.a) || 0;
        const yb = memberY.get(couple.b) || 0;
        const midY = coupleY.get(unit.id) || 0;
        positions[couple.a] = { x: centerX - (SPOUSE_GAP / 2) - (NODE_W / 2), y: ya };
        positions[couple.b] = { x: centerX + (SPOUSE_GAP / 2) + (NODE_W / 2), y: yb };
        positions[unit.id] = { x: centerX, y: midY };
        y = midY;

        positionChildren(unit.children, centerX);

      } else {
        y = memberY.get(unit.id) || 0;
        positions[unit.id] = { x: centerX, y };
        positionChildren(unit.children, centerX);
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

    // Post-layout collision resolution (temporal: Y tolerance for varying birth years)
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
