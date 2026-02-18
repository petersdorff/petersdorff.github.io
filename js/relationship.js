/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Relationship Calculator
   BFS pathfinding, German relationship terms, DNA estimation
   ═══════════════════════════════════════════════════════════ */

const Relationship = (() => {

  /**
   * Build adjacency structures from members & relationships
   * Returns: { parentOf: Map, childOf: Map, spouseOf: Map }
   */
  function buildGraph(members, relationships) {
    const parentOf = new Map();  // parentId -> [childId, ...]
    const childOf = new Map();   // childId -> [parentId, ...]
    const spouseOf = new Map();  // personId -> [spouseId, ...]
    const siblingOf = new Map(); // personId -> [siblingId, ...]

    for (const m of members) {
      parentOf.set(m.id, []);
      childOf.set(m.id, []);
      spouseOf.set(m.id, []);
      siblingOf.set(m.id, []);
    }

    for (const r of relationships) {
      if (r.type === 'parent_child') {
        // fromId = parent, toId = child
        if (parentOf.has(r.fromId)) parentOf.get(r.fromId).push(r.toId);
        if (childOf.has(r.toId)) childOf.get(r.toId).push(r.fromId);
      } else if (r.type === 'spouse') {
        if (spouseOf.has(r.fromId)) spouseOf.get(r.fromId).push(r.toId);
        if (spouseOf.has(r.toId)) spouseOf.get(r.toId).push(r.fromId);
      } else if (r.type === 'sibling') {
        if (siblingOf.has(r.fromId)) siblingOf.get(r.fromId).push(r.toId);
        if (siblingOf.has(r.toId)) siblingOf.get(r.toId).push(r.fromId);
      }
    }

    return { parentOf, childOf, spouseOf, siblingOf };
  }

  /**
   * Find the path between two people using BFS over family connections.
   * Returns array of { id, edgeType } or null if no path found.
   * edgeType: 'parent', 'child', 'spouse'
   */
  function findPath(fromId, toId, graph) {
    if (fromId === toId) return [{ id: fromId, edgeType: null }];

    const { parentOf, childOf, spouseOf, siblingOf } = graph;
    const visited = new Set();
    // Queue entries: { id, path: [{id, edgeType}] }
    const queue = [{ id: fromId, path: [{ id: fromId, edgeType: null }] }];
    visited.add(fromId);

    while (queue.length > 0) {
      const { id, path } = queue.shift();

      // Get neighbors with edge types
      const neighbors = [];

      // Parents (going up)
      for (const parentId of (childOf.get(id) || [])) {
        neighbors.push({ id: parentId, edgeType: 'parent' });
      }
      // Children (going down)
      for (const childId of (parentOf.get(id) || [])) {
        neighbors.push({ id: childId, edgeType: 'child' });
      }
      // Spouses (lateral)
      for (const spouseId of (spouseOf.get(id) || [])) {
        neighbors.push({ id: spouseId, edgeType: 'spouse' });
      }
      // Siblings (lateral)
      for (const siblingId of (siblingOf.get(id) || [])) {
        neighbors.push({ id: siblingId, edgeType: 'sibling' });
      }

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        const newPath = [...path, { id: neighbor.id, edgeType: neighbor.edgeType }];

        if (neighbor.id === toId) {
          return newPath;
        }
        queue.push({ id: neighbor.id, path: newPath });
      }
    }

    return null; // No connection found
  }

  /**
   * Find the common ancestor between two people.
   * Returns { ancestor, stepsA, stepsB } or null.
   */
  function findCommonAncestor(fromId, toId, graph) {
    const { childOf } = graph;

    // Get all ancestors of person A with their distance
    function getAncestors(personId) {
      const ancestors = new Map(); // ancestorId -> distance
      const queue = [{ id: personId, dist: 0 }];
      const visited = new Set([personId]);

      while (queue.length > 0) {
        const { id, dist } = queue.shift();
        ancestors.set(id, dist);

        for (const parentId of (childOf.get(id) || [])) {
          if (!visited.has(parentId)) {
            visited.add(parentId);
            queue.push({ id: parentId, dist: dist + 1 });
          }
        }
      }
      return ancestors;
    }

    const ancestorsA = getAncestors(fromId);
    const ancestorsB = getAncestors(toId);

    // Find the common ancestor with minimum total distance
    let bestAncestor = null;
    let bestTotal = Infinity;

    for (const [ancestorId, distA] of ancestorsA) {
      if (ancestorsB.has(ancestorId)) {
        const distB = ancestorsB.get(ancestorId);
        if (distA + distB < bestTotal) {
          bestTotal = distA + distB;
          bestAncestor = { id: ancestorId, stepsA: distA, stepsB: distB };
        }
      }
    }

    return bestAncestor;
  }

  // ═══════════════════════════════════════════════════════════
  // German Relationship Terminology (based on Wikipedia:
  // Verwandtschaftsbeziehung)
  //
  // Given a common ancestor at stepsA (from person A) and
  // stepsB (from person B):
  //   min = Math.min(stepsA, stepsB)
  //   max = Math.max(stepsA, stepsB)
  //   genDiff = max - min  (generation difference)
  //
  // Cases:
  //   min=0: direct line (ancestor/descendant)
  //   min=1, genDiff=0: siblings
  //   min=1, genDiff≥1: Onkel/Tante or Neffe/Nichte with
  //          Groß-/Ur- prefixes for genDiff > 1
  //   min≥2, genDiff=0: Cousin/Cousine (min-1). Grades
  //   min≥2, genDiff≥1: The collateral degree = min-1,
  //          combined with Onkel/Tante or Neffe/Nichte of
  //          that degree, with Groß-/Ur- prefixes for
  //          generation shifts > 1
  //
  // Degree system for Onkel/Tante/Neffe/Nichte:
  //   "n. Grades" where n = min - 1 (the collateral degree)
  //   Onkel 2. Grades = Cousin of a parent
  //   Großonkel 2. Grades = Cousin of a grandparent
  // ═══════════════════════════════════════════════════════════

  /**
   * Determine the German relationship term between two people.
   * Uses the path and common ancestor analysis following proper
   * German genealogical terminology.
   */
  function getRelationshipTerm(fromId, toId, graph, membersMap) {
    if (fromId === toId) return { term: 'Ich selbst', degree: 0 };

    const path = findPath(fromId, toId, graph);
    if (!path) return { term: 'Keine Verbindung gefunden', degree: null };

    // Analyze path for edge types
    const edges = path.slice(1).map(p => p.edgeType);

    // Get gender of the target person for gendered terms
    const targetPerson = membersMap.get(toId);
    const gender = targetPerson?.gender || null;

    // Detect if path goes through a spouse edge (in-law / angeheiratet)
    const hasSpouse = edges.includes('spouse');

    // ─── Special case: direct spouse ───
    if (edges.length === 1 && edges[0] === 'spouse') {
      return { term: genderTerm(gender, 'Ehemann', 'Ehefrau', 'Ehepartner'), degree: 0, path };
    }

    // ─── Special case: Schwager/Schwägerin ───
    // spouse→sibling or sibling→spouse (2-step path)
    if (edges.length === 2) {
      if ((edges[0] === 'spouse' && edges[1] === 'sibling') ||
          (edges[0] === 'sibling' && edges[1] === 'spouse')) {
        return { term: genderTerm(gender, 'Schwager', 'Schwägerin', 'Schwager/Schwägerin'), degree: 0, path };
      }
    }
    // spouse→parent (Schwiegervater/-mutter) or parent→spouse
    if (edges.length === 2 && edges[0] === 'spouse' && edges[1] === 'parent') {
      return { term: genderTerm(gender, 'Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil'), degree: 0, path };
    }
    if (edges.length === 2 && edges[0] === 'parent' && edges[1] === 'spouse') {
      // My parent's spouse (if not my parent) = Stiefelternteil
      return { term: genderTerm(gender, 'Stiefvater', 'Stiefmutter', 'Stiefelternteil'), degree: 0, path };
    }
    // spouse→child (Schwiegersohn/-tochter) or child→spouse
    if (edges.length === 2 && edges[0] === 'child' && edges[1] === 'spouse') {
      return { term: genderTerm(gender, 'Schwiegersohn', 'Schwiegertochter', 'Schwiegerkind'), degree: 0, path };
    }
    if (edges.length === 2 && edges[0] === 'spouse' && edges[1] === 'child') {
      // My spouse's child = Stiefkind
      return { term: genderTerm(gender, 'Stiefsohn', 'Stieftochter', 'Stiefkind'), degree: 0, path };
    }

    // ─── Direct sibling edge ───
    if (edges.length === 1 && edges[0] === 'sibling') {
      return { term: genderTerm(gender, 'Bruder', 'Schwester', 'Geschwister'), degree: 1, path };
    }

    // ─── Blood relationship via common ancestor ───
    const common = findCommonAncestor(fromId, toId, graph);
    if (common) {
      const stepsA = common.stepsA;  // steps from person A to common ancestor
      const stepsB = common.stepsB;  // steps from person B to common ancestor

      const result = getTermFromAncestorSteps(stepsA, stepsB, gender);
      const suffix = hasSpouse ? ' (angeheiratet)' : '';
      return { term: result.term + suffix, degree: result.degree, path };
    }

    // ─── Path-based fallback (no common ancestor found) ───
    const bloodEdges = edges.filter(e => e !== 'spouse' && e !== 'sibling');
    const ups = bloodEdges.filter(e => e === 'parent').length;
    const downs = bloodEdges.filter(e => e === 'child').length;

    // Direct line up
    if (downs === 0 && ups > 0) {
      const term = getAncestorTerm(ups, gender);
      return { term: hasSpouse ? term + ' (angeheiratet)' : term, degree: ups, path };
    }
    // Direct line down
    if (ups === 0 && downs > 0) {
      const term = getDescendantTerm(downs, gender);
      return { term: hasSpouse ? term + ' (angeheiratet)' : term, degree: downs, path };
    }

    // ─── In-law fallback: strip spouse edge at start/end ───
    // If path starts or ends with a spouse edge, determine the blood
    // relationship to the partner and append "(angeheiratet)"
    if (hasSpouse && path.length >= 3) {
      const lastEdge = edges[edges.length - 1];
      const firstEdge = edges[0];

      if (lastEdge === 'spouse') {
        // Target is the spouse of someone we're blood-related to
        const partnerId = path[path.length - 2].id;
        const partnerGender = membersMap.get(partnerId)?.gender || null;
        const bloodResult = getRelationshipTerm(fromId, partnerId, graph, membersMap);
        if (bloodResult.term && !bloodResult.term.startsWith('Verwandt')) {
          const targetGender = gender;
          const base = bloodResult.term.replace(' (angeheiratet)', '');
          return { term: base + ' (angeheiratet)', degree: bloodResult.degree, path };
        }
      } else if (firstEdge === 'spouse') {
        // We start by going to our spouse, then follow blood from there
        const spouseId = path[1].id;
        const bloodResult = getRelationshipTerm(spouseId, toId, graph, membersMap);
        if (bloodResult.term && !bloodResult.term.startsWith('Verwandt')) {
          const base = bloodResult.term.replace(' (angeheiratet)', '');
          return { term: base + ' (angeheiratet)', degree: bloodResult.degree, path };
        }
      }
    }

    // Generic fallback
    const suffix = hasSpouse ? ' (angeheiratet)' : '';
    return { term: `Verwandt über ${edges.length} Verbindungen${suffix}`, degree: edges.length, path };
  }

  /**
   * Given the steps from person A and B to their common ancestor,
   * return the proper German relationship term.
   *
   * Based on: https://de.wikipedia.org/wiki/Verwandtschaftsbeziehung
   */
  function getTermFromAncestorSteps(stepsA, stepsB, gender) {
    // Direct ancestor (A is descendant, ancestor is at stepsA=0 or stepsB=0)
    if (stepsA === 0) {
      return { term: getDescendantTerm(stepsB, gender), degree: stepsB };
    }
    if (stepsB === 0) {
      return { term: getAncestorTerm(stepsA, gender), degree: stepsA };
    }

    const min = Math.min(stepsA, stepsB);
    const max = Math.max(stepsA, stepsB);
    const genDiff = max - min;

    // ─── Same generation (stepsA === stepsB) ───
    if (genDiff === 0) {
      if (min === 1) {
        // Siblings
        return { term: genderTerm(gender, 'Bruder', 'Schwester', 'Geschwister'), degree: 1 };
      }
      // Cousin/Cousine n. Grades
      // Degree = min - 1 (Cousin 1. Grades = just "Cousin", 2. Grades, etc.)
      const cousinDegree = min - 1;
      return { term: getCousinTerm(cousinDegree, gender), degree: cousinDegree };
    }

    // ─── Different generations ───
    // Person A is "closer" to ancestor if stepsA < stepsB → target is below (Neffe direction)
    // Person A is "farther" from ancestor if stepsA > stepsB → target is above (Onkel direction)
    const targetIsBelow = stepsA < stepsB;  // target (B) is in a lower generation

    if (min === 1) {
      // ─── Onkel/Tante or Neffe/Nichte with Groß-/Ur- prefixes ───
      // genDiff=1: Onkel/Neffe, genDiff=2: Großonkel/Großneffe, etc.
      if (targetIsBelow) {
        // Target is below us → Neffe/Nichte territory
        return { term: getNieceNephewTerm(genDiff, 0, gender), degree: genDiff };
      } else {
        // Target is above us → Onkel/Tante territory
        return { term: getAuntUncleTerm(genDiff, 0, gender), degree: genDiff };
      }
    }

    // ─── min ≥ 2: collateral relatives with degree ───
    // The "Grad" (degree) for Onkel/Tante/Neffe/Nichte = min
    // (distinct from cousin degree which = min - 1)
    // genDiff determines the Groß-/Ur- prefix level
    //
    // Wikipedia examples:
    //   min=2, genDiff=1: Onkel/Neffe 2. Grades
    //     (Onkel 2. Grades = Cousin eines Elternteils)
    //   min=2, genDiff=2: Großonkel/Großneffe 2. Grades
    //     (Großonkel 2. Grades = Cousin eines Großelternteils)
    //   min=3, genDiff=1: Onkel/Neffe 3. Grades
    //     (Onkel 3. Grades = Cousin 2. Grades eines Elternteils)
    const uncleNephewDegree = min;

    if (targetIsBelow) {
      return { term: getNieceNephewTerm(genDiff, uncleNephewDegree, gender), degree: uncleNephewDegree };
    } else {
      return { term: getAuntUncleTerm(genDiff, uncleNephewDegree, gender), degree: uncleNephewDegree };
    }
  }

  // ─── Helper: gender-dependent term selection ───
  function genderTerm(gender, m, f, neutral) {
    return gender === 'm' ? m : gender === 'f' ? f : neutral;
  }

  // ─── Direct line: Ancestors ───
  function getAncestorTerm(generations, gender) {
    switch (generations) {
      case 1: return genderTerm(gender, 'Vater', 'Mutter', 'Elternteil');
      case 2: return genderTerm(gender, 'Großvater', 'Großmutter', 'Großelternteil');
      case 3: return genderTerm(gender, 'Urgroßvater', 'Urgroßmutter', 'Urgroßelternteil');
      default: {
        const prefix = 'Ur' + 'ur'.repeat(generations - 3) + 'groß';
        return genderTerm(gender, prefix + 'vater', prefix + 'mutter', prefix + 'elternteil');
      }
    }
  }

  // ─── Direct line: Descendants ───
  function getDescendantTerm(generations, gender) {
    switch (generations) {
      case 1: return genderTerm(gender, 'Sohn', 'Tochter', 'Kind');
      case 2: return genderTerm(gender, 'Enkelsohn', 'Enkeltochter', 'Enkelkind');
      case 3: return genderTerm(gender, 'Urenkelsohn', 'Urenkeltochter', 'Urenkelkind');
      default: {
        const prefix = 'Ur' + 'ur'.repeat(generations - 3) + 'enkel';
        return genderTerm(gender, prefix + 'sohn', prefix + 'tochter', prefix + 'kind');
      }
    }
  }

  // ─── Cousin/Cousine with degree ───
  function getCousinTerm(degree, gender) {
    const base = genderTerm(gender, 'Cousin', 'Cousine', 'Cousin/Cousine');
    if (degree <= 1) return base;
    return base + ' ' + degree + '. Grades';
  }

  // ─── Onkel/Tante with Groß-/Ur- prefix and optional degree ───
  // genLevel: 1=Onkel, 2=Großonkel, 3=Urgroßonkel, 4=Ururgroßonkel...
  // collateralDegree: 0=no suffix, 1=no suffix (1st degree is default),
  //                   2+=". Grades" suffix
  function getAuntUncleTerm(genLevel, collateralDegree, gender) {
    let base;
    switch (genLevel) {
      case 1: base = genderTerm(gender, 'Onkel', 'Tante', 'Onkel/Tante'); break;
      case 2: base = genderTerm(gender, 'Großonkel', 'Großtante', 'Großonkel/Großtante'); break;
      case 3: base = genderTerm(gender, 'Urgroßonkel', 'Urgroßtante', 'Urgroßonkel/Urgroßtante'); break;
      default: {
        const prefix = 'Ur' + 'ur'.repeat(genLevel - 3) + 'groß';
        base = genderTerm(gender, prefix + 'onkel', prefix + 'tante', prefix + 'onkel/' + prefix + 'tante');
      }
    }
    if (collateralDegree >= 2) {
      base += ' ' + collateralDegree + '. Grades';
    }
    return base;
  }

  // ─── Neffe/Nichte with Groß-/Ur- prefix and optional degree ───
  // genLevel: 1=Neffe, 2=Großneffe, 3=Urgroßneffe, 4=Ururgroßneffe...
  // collateralDegree: 0=no suffix, 1=no suffix, 2+=". Grades" suffix
  function getNieceNephewTerm(genLevel, collateralDegree, gender) {
    let base;
    switch (genLevel) {
      case 1: base = genderTerm(gender, 'Neffe', 'Nichte', 'Neffe/Nichte'); break;
      case 2: base = genderTerm(gender, 'Großneffe', 'Großnichte', 'Großneffe/Großnichte'); break;
      case 3: base = genderTerm(gender, 'Urgroßneffe', 'Urgroßnichte', 'Urgroßneffe/Urgroßnichte'); break;
      default: {
        const prefix = 'Ur' + 'ur'.repeat(genLevel - 3) + 'groß';
        base = genderTerm(gender, prefix + 'neffe', prefix + 'nichte', prefix + 'neffe/' + prefix + 'nichte');
      }
    }
    if (collateralDegree >= 2) {
      base += ' ' + collateralDegree + '. Grades';
    }
    return base;
  }

  /**
   * Estimate shared DNA percentage based on relationship.
   * Uses common ancestor when available, falls back to path-based estimation.
   *
   * Key rule: If the path between two people includes a spouse edge,
   * they share 0% DNA (they are connected by marriage, not blood).
   * DNA is only shared between blood relatives (parent-child, siblings, cousins).
   */
  function estimateSharedDNA(fromId, toId, graph) {
    if (fromId === toId) return 100;

    // First, check the BFS path to see if it includes any spouse edges.
    // If so, these two people are NOT blood-related → 0% shared DNA.
    const path = findPath(fromId, toId, graph);
    if (!path || path.length < 2) return null;

    const hasSpouseEdge = path.slice(1).some(p => p.edgeType === 'spouse');
    if (hasSpouseEdge) return 0;

    const common = findCommonAncestor(fromId, toId, graph);

    if (common) {
      const stepsA = common.stepsA;
      const stepsB = common.stepsB;

      // Special cases
      if (stepsA === 0 || stepsB === 0) {
        // Direct ancestor/descendant
        const generations = Math.max(stepsA, stepsB);
        return Math.max(0.01, (100 / Math.pow(2, generations))).toFixed(2);
      }

      // For relatives through common ancestor:
      // Shared DNA ≈ (1/2)^(stepsA + stepsB) * 100 * 2
      // The *2 accounts for two paths through both common ancestors (couple)
      const totalSteps = stepsA + stepsB;
      const shared = (1 / Math.pow(2, totalSteps - 1)) * 100;
      return Math.max(0.01, shared).toFixed(2);
    }

    // Fallback: estimate via BFS path length
    // Count only blood-relation edges (parent, child, sibling)
    const bloodSteps = path.slice(1).filter(p =>
      p.edgeType === 'parent' || p.edgeType === 'child' || p.edgeType === 'sibling'
    ).length;

    if (bloodSteps === 0) return null; // only spouse connections

    // Approximate: shared DNA ≈ (1/2)^(bloodSteps-1) * 100
    const shared = (1 / Math.pow(2, bloodSteps - 1)) * 100;
    return Math.max(0.01, shared).toFixed(2);
  }

  /**
   * Get full connection info between two people.
   */
  function getConnection(fromId, toId, members, relationships) {
    const graph = buildGraph(members, relationships);
    const membersMap = new Map(members.map(m => [m.id, m]));

    const relationship = getRelationshipTerm(fromId, toId, graph, membersMap);
    const dna = estimateSharedDNA(fromId, toId, graph);
    const path = relationship.path || findPath(fromId, toId, graph);

    // Find common ancestor for display
    const commonAncestor = findCommonAncestor(fromId, toId, graph);
    let commonAncestorName = null;
    if (commonAncestor && commonAncestor.id) {
      const ancestor = membersMap.get(commonAncestor.id);
      if (ancestor) {
        commonAncestorName = `${ancestor.firstName} ${ancestor.lastName}`;
      }
    }

    return {
      term: relationship.term,
      degree: relationship.degree,
      sharedDNA: dna,
      path: path,
      pathLength: path ? path.length - 1 : null,
      commonAncestor: commonAncestorName,
    };
  }

  /**
   * Get all node IDs on the path between two people (for highlighting).
   * Builds graph once, shared with getPathEdgePairs via getPathData.
   */
  function getPathData(fromId, toId, members, relationships) {
    const graph = buildGraph(members, relationships);
    const path = findPath(fromId, toId, graph);
    if (!path) return { nodeIds: [], edgePairs: [] };

    const nodeIds = path.map(p => p.id);
    const edgePairs = [];
    for (let i = 0; i < path.length - 1; i++) {
      edgePairs.push([path[i].id, path[i + 1].id]);
    }
    return { nodeIds, edgePairs };
  }

  return {
    findPath,
    findCommonAncestor,
    getRelationshipTerm,
    estimateSharedDNA,
    getConnection,
    getPathData,
  };
})();
