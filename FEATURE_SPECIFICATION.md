# Stammbaum PWA - Feature Specification

**Version:** v43
**Last Updated:** 2026-02-17
**Purpose:** Comprehensive feature specification for code audit & review

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication & Access Control](#2-authentication--access-control)
3. [Approval System](#3-approval-system)
4. [Profile Claiming (Claim Flow)](#4-profile-claiming-claim-flow)
5. [Placeholder Profiles](#5-placeholder-profiles)
6. [Member Data Model](#6-member-data-model)
7. [Relationship Data Model](#7-relationship-data-model)
8. [Adding New Persons](#8-adding-new-persons)
9. [Adding & Managing Connections](#9-adding--managing-connections)
10. [Conflict Prevention (Auto-Blocking)](#10-conflict-prevention-auto-blocking)
11. [Auto-Adding Logical Connections](#11-auto-adding-logical-connections)
12. [Tree Visualization - Generational View](#12-tree-visualization---generational-view)
13. [Tree Visualization - Temporal View](#13-tree-visualization---temporal-view)
14. [View Toggle & Animation](#14-view-toggle--animation)
15. [Sibling Sorting](#15-sibling-sorting)
16. [Couple-Centered Layout](#16-couple-centered-layout)
17. [Generation Assignment Algorithm](#17-generation-assignment-algorithm)
18. [Relationship Calculator](#18-relationship-calculator)
19. [DNA Estimation](#19-dna-estimation)
20. [Connection Overlay & Path Highlighting](#20-connection-overlay--path-highlighting)
21. [Search](#21-search)
22. [QR Code System](#22-qr-code-system)
23. [Deep Links](#23-deep-links)
24. [Admin Panel](#24-admin-panel)
25. [Email Notifications](#25-email-notifications)
26. [Side Menu / Navigation](#26-side-menu--navigation)
27. [Profile View](#27-profile-view)
28. [Profile Editing](#28-profile-editing)
29. [Deletion of Placeholder Members](#29-deletion-of-placeholder-members)
30. [Toast Notification System](#30-toast-notification-system)
31. [PWA & Offline Support](#31-pwa--offline-support)
32. [Visual Design (PCB Aesthetic)](#32-visual-design-pcb-aesthetic)
33. [Responsive Design](#33-responsive-design)
34. [Node Styling & Visual States](#34-node-styling--visual-states)
35. [Edge Styling](#35-edge-styling)
36. [Cytoscape.js Configuration](#36-cytoscapejs-configuration)
37. [Demo Data Seeding](#37-demo-data-seeding)
38. [Data Caching Strategy](#38-data-caching-strategy)
39. [Error Handling](#39-error-handling)
40. [Security Considerations](#40-security-considerations)

---

## 1. Architecture Overview

### Technology Stack
- **Frontend:** Vanilla JavaScript (ES6+), no framework
- **Pattern:** IIFE Revealing Module Pattern (8 modules)
- **Visualization:** Cytoscape.js with preset (manual) layout
- **Backend:** Supabase (PostgreSQL + Auth + Row-Level Security)
- **Email:** EmailJS (free tier, client-side)
- **QR:** QRCode.js for generation, html5-qrcode for scanning
- **PWA:** Service Worker + Web App Manifest
- **Hosting:** GitHub Pages (https://kaiman22.github.io/stammbaum/)

### Module Structure
| Module | File | Responsibility |
|--------|------|----------------|
| App | `js/app.js` (~940 lines) | Main controller, routing, event binding, admin |
| Auth | `js/auth.js` (~217 lines) | Supabase authentication, session management |
| DB | `js/db.js` (~393 lines) | Supabase CRUD, data mapping, approval queries |
| Tree | `js/tree.js` (~1100 lines) | Cytoscape.js visualization, both layout algorithms |
| Profile | `js/profile.js` (~751 lines) | Profile display, editing, relationship management |
| Relationship | `js/relationship.js` (~407 lines) | BFS pathfinding, kinship terms, DNA estimation |
| Search | `js/search.js` (~115 lines) | Client-side live search |
| QR | `js/qr.js` (~124 lines) | QR generation and camera scanning |

### Initialization Order
1. `DOMContentLoaded` triggers `App.init()`
2. Supabase client created and passed to `DB.init()`
3. `Search.init()` and `Tree.init()` called
4. EmailJS initialized (if available)
5. Auth state listener registered on `Auth.onAuthChange()`
6. Password recovery listener registered
7. `Auth.init()` called (triggers `onAuthStateChange` immediately)
8. UI event bindings established
9. Deep link handler checks URL hash

---

## 2. Authentication & Access Control

### How It Should Work

**Registration requires:**
- First name (mandatory)
- Last name (mandatory)
- Birth name (optional)
- Email address (mandatory, valid format)
- Password (mandatory, minimum 6 characters)

**Registration flow:**
1. User fills in all required fields on the registration form
2. Supabase creates an auth user with `display_name` in `user_metadata`
3. Registration data (`firstName`, `lastName`, `birthName`) stored in `sessionStorage` for the claim flow
4. App attempts auto-login immediately after `signUp`
5. If auto-login succeeds: auth state change triggers the approval check
6. If auto-login fails (e.g. email confirmation required): user sees a success toast and must log in manually

**Login flow:**
1. User enters email and password
2. Supabase `signInWithPassword` authenticates
3. `onAuthStateChange` fires with `SIGNED_IN` event
4. App waits 500ms (to avoid Supabase `AbortError` during auth transitions) then resolves member lookup
5. Approval status checked (see Section 3)
6. If approved + has member profile: navigate to tree view
7. If approved + no member profile: navigate to claim view
8. If pending/rejected: show appropriate status view

**Password recovery flow:**
1. User clicks "Passwort vergessen?" on login form
2. Enters email address, clicks send
3. Supabase sends a recovery email with a tokenized link back to the app
4. App detects `type=recovery` in URL hash before Supabase processes it, sets `isRecoveryMode = true`
5. When `onAuthStateChange` fires with `SIGNED_IN` during recovery mode, the password form is shown instead of normal navigation
6. User enters new password (minimum 6 chars) and confirmation
7. Both fields must match; validation runs client-side
8. After successful update: recovery mode cleared, URL cleaned up, user navigated to tree or claim view

**Token refresh handling:**
- `TOKEN_REFRESHED` events (triggered when tab regains focus) are ignored to prevent re-running the auth flow
- Auth deduplication flag (`authHandled`) prevents double-processing of `SIGNED_IN` on page load

**Auth error messages (translated to German):**
| English error | German message |
|---------------|----------------|
| Invalid login | E-Mail oder Passwort falsch. |
| Already registered | Diese E-Mail ist bereits registriert. |
| Password (too weak) | Passwort zu schwach (mind. 6 Zeichen). |
| Invalid email | Ungultige E-Mail-Adresse. |
| Rate limit | Zu viele Versuche. Bitte warte einen Moment. |
| Network error | Netzwerkfehler. Bitte prufe deine Verbindung. |
| Email not confirmed | Bitte bestatige zuerst deine E-Mail-Adresse. |

### Admin Privileges
- **Admin email:** Hardcoded as `kaivonpetersdorff@me.com` in `app.js`
- Admin bypasses the approval system entirely (no pending view)
- Admin can see and access the "Nutzer-Verwaltung" menu item
- Admin can approve or reject pending user registrations

---

## 3. Approval System

### How It Should Work

Every non-admin user must be approved by an admin before accessing the family tree.

**Flow:**
1. After successful registration + login, app checks `DB.getApprovalStatus(userId)`
2. If no approval request exists: creates one via `DB.createApprovalRequest()` with `status: 'pending'`, sends email notification to admin
3. If `status === 'pending'`: shows the pending view with a message "Dein Zugang wird noch gepruft"
4. If `status === 'rejected'`: shows error toast "Dein Zugang wurde abgelehnt" and the pending view
5. If `status === 'approved'`: proceeds to claim flow or main tree view

**Pending view features:**
- "Aktualisieren" button: re-checks approval status. If now approved, reloads the page
- "Abmelden" button: logs out the user
- On approval detection: toast "Zugang freigeschaltet!" + page reload

**Admin approval actions:**
- Admin navigates to Admin Panel (via menu or `#admin` deep link)
- Sees list of all pending requests, ordered by `created_at` ascending (oldest first)
- Each card shows: display name, email, registration date
- "Freigeben" button: sets `status = 'approved'`, records `reviewed_at` and `reviewed_by`, shows toast
- "Ablehnen" button: shows confirmation dialog first, then sets `status = 'rejected'`
- List auto-refreshes after each action

**Database record:**
```
user_approvals {
  id: UUID (PK)
  user_uid: TEXT (unique, references auth user)
  email: TEXT
  display_name: TEXT
  status: 'pending' | 'approved' | 'rejected'
  created_at: TIMESTAMP
  reviewed_at: TIMESTAMP (null until reviewed)
  reviewed_by: TEXT (admin user ID, null until reviewed)
}
```

**Idempotency:** `createApprovalRequest()` checks if a request already exists before inserting. If one exists, returns the existing record.

---

## 4. Profile Claiming (Claim Flow)

### How It Should Work

After approval, if the user has no linked member profile (`DB.findMemberByUid()` returns null), they enter the claim flow.

**Purpose:** Link the user's auth account to an existing placeholder member in the tree, or create a new member if they're not yet in the tree.

**Searching for existing members:**
1. User types in the search field (minimum 2 characters)
2. 250ms debounce before executing search
3. `DB.searchMembers()` runs (case-insensitive `ILIKE` across `first_name`, `last_name`, `birth_name`)
4. Results filtered to show only unclaimed members (`!claimedByUid || isPlaceholder`)
5. Maximum 5 results displayed
6. Each result shows: name, birth year (if available), location (if available)
7. If no results found: shows "Niemand mit diesem Namen gefunden."

**Claiming an existing member:**
1. User clicks on a search result
2. `DB.claimMember(memberId, userId)` sets `claimed_by_uid = userId` and `is_placeholder = false`
3. Member fetched and stored in `Auth.setMember()`
4. `Tree.setCurrentUser(memberId)` marks user's node
5. Tree loaded, view switches to main tree
6. Toast: "Profil erfolgreich verknupft!"

**Creating a new member (no match found):**
1. User clicks "Neues Profil erstellen" button
2. New member created with:
   - `firstName` and `lastName` from session storage (from registration) or from `user_metadata.display_name`
   - `birthName` from session storage (if provided at registration)
   - `isPlaceholder: false` (immediately claimed)
   - `claimedByUid: userId`
   - `createdBy: userId`
   - `contact: user.email`
   - `photo: user_metadata.avatar_url` (if available)
   - All other fields empty
3. Session storage cleared
4. Tree loaded, view switches to main
5. Toast: "Willkommen im Stammbaum!"

---

## 5. Placeholder Profiles

### How It Should Work

Placeholder profiles represent family members who don't yet have their own account.

**Creation scenarios:**
- Any logged-in user can create a new person via the "+" FAB button
- New persons created this way are always placeholders (`isPlaceholder: true`, `claimedByUid: null`)
- Inline creation during relationship search also creates placeholders

**Properties of placeholders:**
- `isPlaceholder: true`
- `claimedByUid: null`
- `createdBy: <creating user's ID>`
- Displayed with **dotted border** in the tree
- Badge in profile view: "◌ Platzhalter" (blue badge)
- Can be edited by any logged-in user
- Can be deleted by any logged-in user (see Section 29)
- Can be claimed by a new user during the claim flow

**Claiming a placeholder:**
- When a user claims a placeholder during registration, `claimedByUid` is set to their user ID and `isPlaceholder` is set to `false`
- The member then shows a solid border (claimed) and badge "✓ Registriert"
- Claimed members cannot be deleted

**Visual distinction:**
| State | Border Style | Badge |
|-------|-------------|-------|
| Placeholder (unclaimed) | Dotted | ◌ Platzhalter |
| Claimed (registered user) | Solid | ✓ Registriert |
| Deceased | Dashed | ✝ Verstorben |
| Current user | Solid, 3px red | (highlighted with red border) |

---

## 6. Member Data Model

### Database Schema (members table)

| Field | DB Column | Type | Required (New) | Required (Edit) | Notes |
|-------|-----------|------|:-:|:-:|-------|
| ID | `id` | UUID (PK) | auto | readonly | Generated by DB |
| First Name | `first_name` | TEXT | **Yes** | **Yes** | Non-empty after trim |
| Last Name | `last_name` | TEXT | **Yes** | **Yes** | Non-empty after trim |
| Birth Name | `birth_name` | TEXT | No | No | Maiden name, e.g. "geb. Schmidt" |
| Birth Date | `birth_date` | DATE | **Yes** | No | ISO YYYY-MM-DD. Required for new persons for tree positioning |
| Death Date | `death_date` | DATE | No | No | Sets `is_deceased = true` automatically when provided |
| Is Deceased | `is_deceased` | BOOLEAN | No | No | Auto-set when `death_date` is provided |
| Is Placeholder | `is_placeholder` | BOOLEAN | auto | N/A | `true` when created by another user, `false` when claimed |
| Claimed By UID | `claimed_by_uid` | TEXT | auto | N/A | Firebase/Supabase user ID of claiming user |
| Created By | `created_by` | TEXT | auto | readonly | User ID who created this member |
| Photo | `photo` | TEXT (URL) | No | No | Any valid URL |
| Contact | `contact` | TEXT | No | No | Free-text contact preference |
| Phone | `phone` | TEXT | No | No | Phone number |
| Email | `email` | TEXT | No | No | Email address |
| Location | `location` | TEXT | No | No | Current city/location |
| Notes | `notes` | TEXT | No | No | Free-text biography/notes |
| Created At | `created_at` | TIMESTAMP | auto | readonly | DB default `now()` |
| Updated At | `updated_at` | TIMESTAMP | auto | auto | DB default `now()` |

### Data Mapping
- Database uses `snake_case`, JavaScript uses `camelCase`
- `mapMember(row)` converts DB row to JS object (defaults empty strings for missing optional fields)
- `unmapMember(m)` converts JS object to DB format (only includes defined fields, converts `''` to `null` for dates)

---

## 7. Relationship Data Model

### Database Schema (relationships table)

| Field | DB Column | Type | Notes |
|-------|-----------|------|-------|
| ID | `id` | UUID (PK) | Generated by DB |
| From ID | `from_id` | UUID (FK -> members) | For `parent_child`: this is the parent |
| To ID | `to_id` | UUID (FK -> members) | For `parent_child`: this is the child |
| Type | `rel_type` | TEXT | `'parent_child'`, `'spouse'`, or `'sibling'` |
| Marriage Date | `marriage_date` | DATE | Optional metadata |
| Divorce Date | `divorce_date` | DATE | Optional metadata |
| Created At | `created_at` | TIMESTAMP | DB default |

### Relationship Types

| Type | Directionality | DB Storage | In Tree |
|------|---------------|------------|---------|
| `parent_child` | Directed | `from_id` = parent, `to_id` = child | Taxi curve downward |
| `spouse` | Bidirectional | Either direction, checked both ways | Straight horizontal line |
| `sibling` | Bidirectional | Either direction, checked both ways | Dotted green line (only if no shared parent visible) |

### Uniqueness Constraint
- `UNIQUE(from_id, to_id, rel_type)` prevents duplicate edges
- `addRelationship()` also checks the reverse direction for `spouse` and `sibling` types before inserting
- If an identical relationship already exists (either direction for bidirectional types), returns the existing ID without inserting

### Cascade Delete
- `ON DELETE CASCADE` on `from_id` and `to_id` foreign keys
- When a member is deleted, all their relationships are automatically removed

---

## 8. Adding New Persons

### How It Should Work

**Entry point:** "+" FAB button (bottom-right corner) opens the edit form in "Neue Person anlegen" mode.

**Required fields for new persons:**
1. **Vorname** (First name) - mandatory
2. **Nachname** (Last name) - mandatory
3. **Geburtsdatum** (Birth date) - mandatory (label shows asterisk), needed for tree positioning
4. **Relationship to existing person** - mandatory (at least one connection)

**Optional fields:**
- Geburtsname (Birth name)
- Sterbedatum (Death date) - auto-sets `isDeceased` when filled
- Wohnort (Location)
- E-Mail
- Telefon (Phone)
- Foto-URL (Photo URL)
- Vita/Notizen (Notes/biography)

**Relationship selection for new person:**
1. User selects relationship type from dropdown: "Ist Elternteil von..." / "Ist Kind von..." / "Ist Geschwister von..." / "Ist verheiratet mit..."
2. User searches for existing person by name (debounced, 250ms)
3. Matching results shown (max 5), user clicks to select
4. A "pending relation" chip appears showing the selected type and target person
5. The chip has an "x" button to remove the selection
6. If no search results found: an inline mini-form appears to create a new person on the spot (see below)

**Inline person creation (during relationship search with no results):**
1. Shows form with: Vorname*, Nachname*, Geburtsdatum* (pre-filled from search query)
2. "Anlegen & verbinden" button creates the person and links them
3. This also works from the edit view of an existing person

**Saving a new person:**
1. Validates: first name, last name, birth date, and pending relation all present
2. Creates member record with `isPlaceholder: true`, `createdBy: currentUserId`
3. Runs `cleanConflictingRelations()` before creating the edge (see Section 10)
4. Creates the relationship edge
5. If sibling: runs `inheritParentsForSibling()` (see Section 11)
6. Refreshes tree
7. Navigates to the new person's profile view
8. Toast: "Person angelegt & verbunden"

---

## 9. Adding & Managing Connections

### How It Should Work

**From the edit view of an existing person:**

**Adding a relationship:**
1. Select relationship type from dropdown
2. Search for target person by name
3. Click target from results, or create inline if not found
4. Click "Verbindung hinzufugen" button
5. System runs conflict prevention first
6. Creates appropriate edge (direction depends on type)
7. If sibling: copies parents bidirectionally
8. Toast shows removed conflicts count (if any) and success
9. Relationship list refreshes in the edit view

**Relationship type options in the dropdown:**
- "Ist Elternteil von..." (is parent of) -> creates `parent_child` with editing person as `from_id`
- "Ist Kind von..." (is child of) -> creates `parent_child` with target as `from_id`
- "Ist Geschwister von..." (is sibling of) -> creates `sibling` edge
- "Ist verheiratet mit..." (is married to) -> creates `spouse` edge

**Removing a relationship:**
1. In edit view, each existing relationship shows an "x" delete button
2. Click triggers confirmation dialog: "Verbindung '{type}: {name}' wirklich loschen?"
3. On confirm: `DB.removeRelationship(id)` deletes the edge
4. Tree refreshes
5. Relationship list refreshes in edit view
6. Toast: "Verbindung geloscht"

**Viewing relationships (profile view, read-only):**
- Each relationship shows a color-coded type badge and the connected person's name
- Badge colors: parent (blue), child (green), spouse (red), sibling (purple)
- Clicking the person's name navigates to their profile

**Multiple spouses:** The system allows multiple spouse edges for the same person (for serial marriages or historical tracking). The tree layout places only one spouse side-by-side; additional spouses are shown as edges but may not have ideal visual positioning.

**Multiple parents:** Supported (e.g. adoption scenarios). A child can have more than 2 parent edges.

---

## 10. Conflict Prevention (Auto-Blocking)

### How It Should Work

Before adding any new relationship, `cleanConflictingRelations(memberId, targetId, newRelType)` runs. It identifies and automatically removes any existing relationships between the same two people that would create a logical impossibility.

**Conflict rules (between the same two people):**

| New Relationship | Conflicts With (auto-removed) |
|-----------------|------------------------------|
| Parent of | Child of, Sibling of, Spouse of |
| Child of | Parent of, Sibling of, Spouse of |
| Sibling of | Parent of, Child of, Spouse of |
| Spouse of | Parent of, Child of, Sibling of |
| Any type | Duplicate of same type |

**In other words:** Between any two people, only ONE relationship type can exist at a time. Adding a new relationship type between the same pair removes any existing relationship between them.

**Implementation detail:**
1. Fetches all relationships for `memberId`
2. Filters to those involving `targetId`
3. For each, determines the existing type from `memberId`'s perspective (`parent_of`, `child_of`, `spouse`, `sibling`)
4. Checks against conflict pairs
5. Removes all conflicting edges via `DB.removeRelationship()`
6. Returns count of removed edges
7. If edges were removed, a toast informs: "{count} widerspuchliche Verbindung(en) entfernt"

**Note:** The system does NOT prevent logically impossible relationships at a multi-hop level (e.g. person A being both grandparent and grandchild of person B through different paths). It only prevents direct conflicts between the same two people.

---

## 11. Auto-Adding Logical Connections

### How It Should Work

**Sibling parent inheritance:**

When a sibling relationship is added between person A and person B:

1. `inheritParentsForSibling(existingSiblingId, newSiblingId)` runs
2. Looks up all `parent_child` relationships where `existingSibling` is the child (`r.toId === existingSiblingId`)
3. For each parent found: checks if that parent-child link already exists for the new sibling
4. If not already linked: creates `parent_child` edge from parent to new sibling

**When called from `addRelation()` (existing person):** Runs bidirectionally:
```
inheritParentsForSibling(A, B)  // B gets A's parents
inheritParentsForSibling(B, A)  // A gets B's parents
```

**When called from `save()` (new person):** Runs unidirectionally:
```
inheritParentsForSibling(existingSibling, newPerson)  // new person gets sibling's parents
```

**Why this matters:** The tree layout algorithm positions people based on parent-child edges. Without parent inheritance, a sibling-only connection would leave the new person floating as a disconnected root instead of appearing alongside their sibling under shared parents.

**Other auto-relationships:**
- No other automatic relationship creation exists currently
- Parent-child edges don't auto-create sibling edges between children (siblings must be added explicitly or already exist)
- Spouse edges don't auto-create any relationships
- Multi-generational relationships are not auto-inferred

---

## 12. Tree Visualization - Generational View

### How It Should Work

This is the default view mode. All members of the same generation are aligned on the same horizontal row (same Y coordinate).

**Y-axis positioning:**
- `Y = generation * GEN_GAP` where `GEN_GAP = 140px`
- Generation 0 (roots with no parents) at Y=0
- Generation 1 at Y=140
- Generation 2 at Y=280
- And so on...

**X-axis positioning:**
- Determined by the couple-centered layout algorithm (see Section 16)
- Siblings are sorted left-to-right by birth year (see Section 15)
- Each "unit" (single person or couple) has a calculated width based on descendant subtree

**Generation assignment:**
- BFS traversal from roots (members with no parent edges)
- Each member's generation = parent's generation + 1
- Spouses inherit their partner's generation (same row)
- Multiple roots form separate subtrees placed side-by-side

**What the user sees:**
- Horizontal rows of family members
- Parents on top, children below
- Spouses side-by-side
- Clear generational structure
- All people born in the same generation on the same visual row regardless of birth year

---

## 13. Tree Visualization - Temporal View

### How It Should Work

Members are positioned vertically based on their actual birth year, creating a timeline proportional to calendar time.

**Y-axis positioning:**
- `Y = (birthYear - baseYear) * YEAR_PX` where `YEAR_PX = 5 pixels/year`
- `baseYear` = earliest birth year in the dataset
- A person born in 1920 and one born in 1950 would be 150px apart vertically (30 years * 5px)

**X-axis positioning:**
- Same horizontal positioning logic as generational view
- Couples: each spouse keeps their birth-year Y; the couple midpoint node is placed at the average of both Y values

**Birth year extraction:**
- If `birthDate` exists: extracts year from first 4 characters of ISO date string
- If `birthDate` is missing: falls back to `birthYear` property or defaults to `0`
- Missing birth years are imputed from generation average when possible

**Couple handling in temporal mode:**
- Spouses may appear at different Y positions (reflecting actual birth year difference)
- Couple midpoint node placed at `(spouseA_Y + spouseB_Y) / 2`
- Spouse edge uses curved style (`curve-style: 'unbundled-bezier'`) instead of straight, with control points offset proportional to the Y difference between spouses

**What the user sees:**
- A timeline-like vertical axis where earlier births are higher
- Proportional spacing shows actual time gaps between generations
- Spouses may be at slightly different heights (reflecting age differences)
- Useful for understanding the chronological spread of the family

---

## 14. View Toggle & Animation

### How It Should Work

**Toggle button:** Located in the top bar (between menu and scan buttons). A calendar/clock icon that visually reflects the current mode.

**Toggle behavior:**
1. Click toggles between `'generational'` and `'temporal'` mode
2. `Tree.setViewMode(nextMode)` called
3. Mode persisted to `localStorage.stammbaum_viewMode`
4. If tree data is loaded: `renderWithAnimation()` triggers animated transition

**Animation:**
1. New positions calculated based on the target view mode
2. All nodes animate simultaneously to their new positions
3. **Duration:** 700ms for node position animation
4. **Easing:** `ease-in-out-cubic`
5. After position animation completes: camera fits all content
6. **Fit duration:** 400ms
7. **Fit easing:** `ease-out`
8. **Fit padding:** 60px
9. Spouse edge styles reapplied during animation

**Button visual state:**
- Generational mode: default icon appearance, title "Generationen-Ansicht aktiv - klicken fur zeitliche Ansicht"
- Temporal mode: `.mode-temporal` CSS class added, title "Zeitliche Ansicht aktiv - klicken fur Generationen-Ansicht"

**Persistence:** View mode survives page reload (stored in `localStorage`). On app startup, `updateToggleButton()` restores the correct visual state.

---

## 15. Sibling Sorting

### How It Should Work

Siblings are always sorted from **oldest (leftmost) to youngest (rightmost)**.

**Algorithm:**
1. Within `buildLayoutBase()`, when identifying children of a couple/person, siblings are collected
2. Siblings sorted by birth year ascending: `children.sort((a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999))`
3. `yearOf()` extracts the 4-digit year from `birthDate` string
4. Members without a birth date get sort value `9999` (placed at the rightmost/youngest end)
5. Members with the same birth year maintain their data-order (stable sort)

**Recursive application:**
- Sorting happens at every level of the tree
- Starting from the top (oldest generation), each set of siblings under common parents is sorted oldest-left to youngest-right
- Within each branch, the same rule applies recursively
- The overall effect: reading the tree left-to-right within any generation shows oldest to youngest

**Example:**
```
Parents: Friedrich (1920) & Elisabeth (1924)
Children sorted: Heinrich (1948) | Wilhelm (1952) | Charlotte (1955)
                 [leftmost]                              [rightmost]
```

---

## 16. Couple-Centered Layout

### How It Should Work

Spouses are placed side-by-side with children positioned below the couple's center point.

**Couple detection:**
1. During `buildLayoutBase()`, spouse edges identify couples
2. Each couple gets an invisible "midpoint" node: `couple-{idA}-{idB}` (1x1px, no visual)
3. The midpoint is centered between the two spouses

**Spouse positioning:**
- Spouse A center: `midpointX - (NODE_W + SPOUSE_GAP) / 2`
- Spouse B center: `midpointX + (NODE_W + SPOUSE_GAP) / 2`
- Gap between spouse boxes: `SPOUSE_GAP = 30px`
- Note: NODE_W = 170px, so spouse centers are 200px apart

**Children positioning:**
- Children are positioned below the couple midpoint
- Each child (or child's subtree unit) has a calculated width
- Children spread symmetrically around the parent couple's X center
- Spacing between sibling units: `SIBLING_GAP = 50px`

**Width calculation:**
- Each "unit" (single person or couple) has a width calculated recursively
- Single person with no children: `NODE_W = 170px`
- Couple with no children: `2 * NODE_W + SPOUSE_GAP = 370px`
- Unit with children: `max(own width, sum of children widths + gaps)`
- Width calculation is memoized to avoid redundant computation

**Edge routing:**
- Parent-to-couple-midpoint: taxi curve (Manhattan style, right-angle turns)
- Couple-midpoint-to-child: taxi curve downward
- Turn radius: 40px
- Minimum turn distance: 20px

---

## 17. Generation Assignment Algorithm

### How It Should Work

Generations are assigned via BFS (breadth-first search) traversal from root members.

**Step 1: Identify roots**
- Roots are members with no incoming `parent_child` edges (no parents in the data)
- Each root starts at generation 0

**Step 2: BFS traversal**
1. Queue initialized with all roots at generation 0
2. For each member dequeued:
   - Set their generation to current level
   - Find all children (via `parent_child` edges where member is `from_id`)
   - Add unvisited children to queue at generation + 1
3. Continue until queue is empty

**Step 3: Spouse alignment**
- After BFS, iterate all `spouse` edges
- Set spouse's generation to match their partner's generation
- This ensures spouses are always on the same horizontal row

**Step 4: Handle disconnected subtrees**
- After initial BFS, check for any unvisited members
- These form disconnected subtrees (no parent path to any root)
- Position them using their own local BFS starting from local roots
- Place disconnected subtrees side-by-side to the right of the main tree

**Edge cases:**
- Multiple roots: each forms a separate top-level family line
- Circular relationships: BFS visited-set prevents infinite loops
- Missing birth dates: don't affect generation assignment (only affect temporal Y positioning)

---

## 18. Relationship Calculator

### How It Should Work

The relationship calculator determines how two people in the tree are connected, using BFS pathfinding and common ancestor analysis.

**BFS Path Finding (`findPath`):**
- Breadth-first search guarantees shortest path
- Traverses all edge types: parent (up), child (down), spouse (lateral), sibling (lateral)
- Returns ordered array of `{ id, edgeType }` objects from person A to person B
- Returns `null` if no path exists
- Same person: returns `[{ id, edgeType: null }]`

**Common Ancestor Finding (`findCommonAncestor`):**
- Gets all ancestors of person A with distances (BFS upward only, following `child -> parent` edges)
- Gets all ancestors of person B similarly
- Finds ancestor present in both sets with minimum total distance (`stepsA + stepsB`)
- Returns `{ id, stepsA, stepsB }` or `null`

**Relationship Term Generation (German kinship terms):**

The decision tree:

| Condition | Term |
|-----------|------|
| Same person | "Ich selbst" |
| No connection | "Keine Verbindung gefunden" |
| 1 spouse edge | "Ehepartner" |
| 1 sibling edge | "Geschwister" |
| Only upward edges (ancestor) | "Elternteil" / "Grosselternteil" / "Urgrosselternteil" / "Urur...grosselternteil" |
| Only downward edges (descendant) | "Kind" / "Enkelkind" / "Urenkelkind" / "Urur...enkelkind" |
| Same generation via common ancestor | "Geschwister" (1 step each) or "Cousin/Cousine N. Grades" |
| Different generation, minSteps=1 | "Onkel/Tante" or "Neffe/Nichte" (with Gross-/Urgross- prefixes) |
| Different generation, minSteps>1 | "Cousin/Cousine N. Grades X Mal entfernt" |
| Path contains spouse edge | Adds " (angeheiratet)" suffix to any term |
| Distant/unclear connection | "Verwandt uber N Verbindungen" |

**Term scaling examples:**

| Generations Up | Term |
|---------------|------|
| 1 | Elternteil |
| 2 | Grosselternteil |
| 3 | Urgrosselternteil |
| 4 | Ururgroßelternteil |
| N (>3) | "Ur" repeated (N-2) times + "grosselternteil" |

| Cousin Degree | Term |
|--------------|------|
| 1st cousin | Cousin/Cousine |
| 2nd cousin | Cousin/Cousine 2. Grades |
| 3rd cousin | Cousin/Cousine 3. Grades |

| Uncle/Aunt Distance | Term |
|--------------------|------|
| 1 generation | Onkel/Tante |
| 2 generations | Grossonkel/Grosstante |
| 3+ generations | Urgrosskonkel/Urgrosstante |

---

## 19. DNA Estimation

### How It Should Work

`estimateSharedDNA(fromId, toId, graph)` estimates the percentage of DNA shared between two people.

**Rules:**
1. Same person: **100%**
2. Path contains any `spouse` edge: **0%** (married-in, no blood relation)
3. Common ancestor found: `(1/2)^(stepsA + stepsB - 1) * 100`
4. Direct ancestor/descendant (no common ancestor needed): `100 / 2^generations`
5. Fallback (no common ancestor): count blood-relation edges (parent, child, sibling) and use `(1/2)^(bloodSteps - 1) * 100`
6. Minimum value: **0.01%** (floor)
7. No path found: returns `null`

**Examples:**

| Relationship | Calculation | Shared DNA |
|--------------|-------------|-----------|
| Parent-Child | 100 / 2^1 | 50% |
| Grandparent-Grandchild | 100 / 2^2 | 25% |
| Siblings | (1/2)^(1+1-1) * 100 | 50% |
| First Cousins | (1/2)^(2+2-1) * 100 | 12.5% |
| Second Cousins | (1/2)^(3+3-1) * 100 | 3.125% |
| Uncle/Aunt-Niece/Nephew | (1/2)^(1+2-1) * 100 | 25% |
| Spouse | spouse edge in path | 0% |
| Cousin by marriage | spouse edge in path | 0% |

**Display format:** Shown as "~X.XX%" in the connection overlay, or "—" if null.

---

## 20. Connection Overlay & Path Highlighting

### How It Should Work

**Triggering the connection overlay:**
- Click "Wie sind wir verwandt?" button on someone's profile
- Scan a QR code
- Open a deep link (`#connect/MEMBER_ID`)

**Connection overlay content:**
1. **Person A & Person B cards:** Avatar (initials) + first name
2. **Verwandtschaft:** German relationship term (e.g. "Cousin 1. Grades")
3. **Gemeinsame DNA:** Estimated shared DNA percentage (e.g. "~12.50%") or "—"
4. **Pfadlange:** Number of edges in path (e.g. "3 Verbindungen") or "Kein Pfad"
5. **Gemeinsamer Vorfahre:** Full name of closest common ancestor or "—"

**Overlay positioning:**
- Desktop (>=600px): Side panel on right (320px wide, max 85vw)
- Mobile (<600px): Bottom sheet (45vh height, rounded top corners)
- Animation: slide-in from right (desktop) or bottom (mobile), 300ms cubic-bezier

**Path highlighting in tree:**
1. `Tree.highlightConnection(fromId, toId)` called
2. All tree elements dimmed (opacity 0.15)
3. Path nodes: dimmed class removed, highlighted class added (3px red border, light red background)
4. Path edges: same treatment, including couple-midpoint edges
5. Camera animated to fit highlighted path nodes (600ms ease-out, 100px padding)
6. Highlighting persists across tab switches (restored without zoom animation via `restoreHighlight()`)

**Closing:**
- Click "x" button on overlay
- Click tree background
- Both close overlay + clear highlighting

---

## 21. Search

### How It Should Work

**Input:** Real-time search bar in the top bar of the main tree view.

**Behavior:**
1. User types in search field
2. 200ms debounce before executing search
3. Searches across: `firstName`, `lastName`, `birthName`, `location` (case-insensitive, substring match)
4. Maximum 8 results displayed in dropdown
5. Each result shows: initials avatar (36x36px circle), full name (bold), info line (birth year + location, 12px secondary text)
6. Dropdown: absolute positioned below search bar, max 300px height, scrollable
7. Click result: navigates to that person's profile via `Profile.show(memberId)`
8. ESC key: closes dropdown and blurs input
9. Click outside: closes dropdown

**Data source:** Operates on cached member data (`Search.setMembers()` called after tree loads). No database queries during search.

**Search algorithm:** Simple substring match using `includes()` across the four searchable fields. Not fuzzy - requires exact substring.

---

## 22. QR Code System

### How It Should Work

**QR Code Generation:**
- Available from: Profile view ("QR-Code zeigen" button), Side menu ("Mein QR-Code"), FAB ("Mein QR Code")
- Encodes URL: `${window.location.origin}${pathname}#connect/${memberId}`
- Size: 220x220 pixels
- Colors: dark (#1a1a1a) on white (#ffffff)
- Error correction: Level M (~15% damage resistance)
- Library: QRCode.js

**QR Code Scanning:**
- Available from: Top bar scan button, Side menu ("QR scannen")
- Opens camera view with scan area (250x250px)
- Camera: rear-facing (`facingMode: 'environment'`) at 10 FPS
- Aspect ratio: 1:1

**Scan result handling:**
1. Detects URL format: extracts member ID from `#connect/MEMBER_ID` fragment
2. Fallback: accepts plain UUID format
3. Invalid format: toast "Ungultiger QR-Code"
4. On success: stops scanner, verifies member exists (cache then DB), shows connection overlay between scanner and scanned person
5. If member not found: toast "Person nicht im Stammbaum gefunden", returns to main view
6. If scanner has no linked profile: just opens the scanned person's profile

**Camera permission denied:** Shows German-language error message suggesting to enable camera in browser settings.

---

## 23. Deep Links

### How It Should Work

**Supported deep links:**

| URL Hash | Action |
|----------|--------|
| `#connect/{MEMBER_ID}` | Show connection between current user and specified member |
| `#admin` | Open admin panel (admin only) |

**`#connect` handling:**
1. Detected on page load in `handleDeepLink()`
2. Polls every 500ms for auth to complete (waits for `Auth.getMember()` to return non-null)
3. Once authenticated: calls `showConnectionOverlay(myId, memberId)`
4. Timeout: stops polling after 10 seconds if auth never completes

**`#admin` handling:**
1. Detected on page load
2. Polls for auth, verifies user email === ADMIN_EMAIL
3. If admin: shows admin panel, clears hash
4. If not admin: does nothing, clears hash
5. Timeout: 10 seconds

---

## 24. Admin Panel

### How It Should Work

**Access:** Only visible to the admin user (email matching `ADMIN_EMAIL`).

**Entry points:**
- Side menu: "Nutzer-Verwaltung" item (hidden for non-admins)
- Deep link: `#admin`

**Content:**
- Header with back button ("Nutzer freigeben" title)
- List of pending approval requests, oldest first
- Each card shows: display name, email, registration date (formatted as German locale)
- "Freigeben" (approve) button: immediately approves, refreshes list
- "Ablehnen" (reject) button: shows confirmation dialog, then rejects

**Empty state:** Shows "Keine ausstehenden Anfragen." when no pending requests exist.

**Error state:** Shows "Fehler beim Laden." in red text if database query fails.

---

## 25. Email Notifications

### How It Should Work

**Provider:** EmailJS (free tier, client-side sending)

**Configuration (in app.js):**
- Service ID: `service_ml2fcxt`
- Template ID: `template_6fcntlg`
- Public Key: `DUarAtNJocWYAECRq`
- Notification recipient: `kaivonpetersdorff@gmail.com`

**When emails are sent:**
- **New user registration:** Admin receives notification with user's name, email, timestamp, and link to admin panel
- Template variables: `name`, `time`, `message`

**Error handling:**
- If EmailJS is not configured (missing keys): logs to console instead
- If `emailjs` library not loaded: no email sent, no error
- Send failures logged to console only (no user-facing error)

---

## 26. Side Menu / Navigation

### How It Should Work

**Opening:** Click hamburger menu button in top-left corner of top bar.

**Layout:**
- Fixed overlay, slides in from left (250ms cubic-bezier)
- Width: 280px (100% on very small screens)
- Semi-transparent backdrop (rgba 0,0,0,0.5), click-to-close
- Header: user photo (56x56px) or initials, display name, email

**Menu items:**

| Item | Icon | Action | Visibility |
|------|------|--------|-----------|
| Stammbaum | - | Navigate to tree view | All users |
| Mein Profil | - | Show user's own profile | All users |
| Mein QR-Code | - | Generate and show user's QR | All users |
| QR scannen | - | Open camera scanner | All users |
| Nutzer-Verwaltung | - | Open admin panel | Admin only |
| Abmelden | - | Log out | All users |

**Closing:** Click backdrop, or click any menu item (auto-closes after navigation).

---

## 27. Profile View

### How It Should Work

**Desktop (>=600px):** Opens as side panel (400px wide, max 50vw) overlaying the tree without hiding it. Both tree and profile are visible simultaneously.

**Mobile (<600px):** Opens as fullscreen view replacing the tree.

**Profile content (top to bottom):**
1. **Photo:** 120x120px (96px on small mobile) rounded box. Falls back to initials (36px, gray) if no photo URL
2. **Name:** Full name (24px, weight 600)
3. **Birth name:** Shown below name if present (13px, secondary text, format "geb. {birthName}")
4. **Badges:** Inline badges for applicable states (deceased, registered, placeholder)
5. **"Wie sind wir verwandt?" button:** Primary button, shown only when viewing another person's profile (not own)
6. **Details section:**
   - Geburtsdatum (birth date, formatted as DD.MM.YYYY German locale, or "—")
   - Sterbedatum (death date, shown only if deceased)
   - Wohnort (location, or "—")
   - Kontakt (contact/email, or "—")
7. **Vita section:** Notes/biography text (pre-formatted whitespace, line-height 1.7)
8. **Verbindungen section:** List of relationships (type badge + name, clickable to navigate)
9. **Action buttons:**
   - "QR-Code zeigen" - generates and shows QR for this person
   - "Im Stammbaum zeigen" - switches to tree and centers/zooms on this person (1.5x zoom, 500ms)
   - "Platzhalter loschen" - red danger button, only visible for true placeholders (see Section 29)

**Header buttons:**
- Back arrow: closes panel (desktop side panel mode) or navigates to tree (mobile)
- Edit (pencil) icon: opens edit form for this person

---

## 28. Profile Editing

### How It Should Work

**Header:** Back button (returns to profile or tree), title "Profil bearbeiten" or "Neue Person anlegen", Save button.

**Form fields:**
| Field | Type | Label | Required |
|-------|------|-------|:--------:|
| Vorname | text | Vorname * | Yes |
| Nachname | text | Nachname * | Yes |
| Geburtsname | text | Geburtsname | No |
| Geburtsdatum | date | Geburtsdatum / Geburtsdatum * | New only |
| Sterbedatum | date | Sterbedatum | No |
| Wohnort | text | Wohnort | No |
| E-Mail | email | E-Mail | No |
| Telefon | tel | Telefon | No |
| Foto-URL | url | Foto-URL | No |
| Vita/Notizen | textarea (4 rows) | Vita / Notizen | No |

**Relationships section (edit mode):**
- Shows existing relationships with type badges and delete buttons
- Add new relationship: type dropdown + person search + "Verbindung hinzufugen" button

**Validation on save:**
- First name and last name must be non-empty (after trim)
- Birth date mandatory for new persons only
- New persons must have at least one pending relationship
- Death date presence auto-sets `isDeceased = true`

**Save flow (existing person):**
- `DB.updateMember(id, data)` updates the record
- Tree refreshes
- Navigates back to profile view
- Toast: "Profil gespeichert"

**Save flow (new person):**
- See Section 8

---

## 29. Deletion of Placeholder Members

### How It Should Work

**Who can be deleted:** Only "true" placeholders: `isPlaceholder === true` AND `claimedByUid === null`

**Who can delete:** Any logged-in user (except cannot delete their own profile)

**Delete button:** Red danger button "Platzhalter loschen" at the bottom of the profile view. Only visible when viewing a deletable placeholder.

**Delete flow:**
1. User clicks "Platzhalter loschen"
2. Confirmation dialog: '"{name}" wirklich loschen? Alle Verbindungen dieser Person werden ebenfalls entfernt.'
3. On confirm: `DB.deleteMember(memberId)` removes the member
4. Cascade delete removes all relationships automatically
5. Tree reloads
6. View switches to main tree
7. Toast: "{name} geloscht"

**Protection:** Claimed members (with `claimedByUid` set) cannot be deleted even if `isPlaceholder` is somehow still true. The check requires both conditions.

---

## 30. Toast Notification System

### How It Should Work

**Container:** Fixed at top-center of viewport, flex column with gap.

**Toast lifecycle:**
1. Created: element appended to container with slide-up animation (300ms ease-out)
2. Visible: stays for 3 seconds
3. Exit: fade-out animation added (200ms ease-in, opacity 1->0, translateY 0->-20px)
4. Removed: DOM element removed after exit animation

**Variants:**

| Type | Background Color | Usage |
|------|-----------------|-------|
| `info` (default) | --trace (#1a1a1a) dark gray | General information |
| `success` | #2d7a4f green | Successful actions |
| `error` | --red (#e63946) | Errors, validation failures |

**Usage:** `App.toast('Message text', 'type')`

---

## 31. PWA & Offline Support

### How It Should Work

**Service Worker (`sw.js`):**
- Cache name: `stammbaum-v1`
- On install: pre-caches all static assets (HTML, CSS, JS files)
- `skipWaiting()`: activates immediately without waiting for old SW to stop
- `clients.claim()`: takes control of all clients immediately

**Fetch strategy:**
1. **Supabase/Firebase requests:** Network only (never cached - always need fresh data)
2. **CDN resources** (unpkg, Google Fonts): Cache-first with background update
3. **Static assets:** Cache-first with network fallback
4. If network fails and not in cache: request fails silently

**Web App Manifest:**
- Name: "Stammbaum"
- Description: "Familien-Stammbaum Netzwerk"
- Display: standalone (full-screen app, no browser chrome)
- Orientation: portrait
- Theme color: #ffffff
- Icons: 192x192 and 512x512 PNG
- Start URL: `/`

**iOS support:**
- `apple-mobile-web-app-capable: yes`
- `apple-mobile-web-app-status-bar-style: black-translucent`
- Apple touch icon configured

**Offline behavior:**
- Core UI always loads from cache
- Database operations fail gracefully (errors shown as toasts)
- QR scanning still works (camera is local), but verifying the member requires network

---

## 32. Visual Design (PCB Aesthetic)

### How It Should Work

The app uses a "circuit board" aesthetic with monospace typography and geometric design elements.

**Color palette:**
| Variable | Value | Usage |
|----------|-------|-------|
| --bg | #ffffff | Main background |
| --bg-secondary | #f8f9fa | Secondary/hover backgrounds |
| --trace | #1a1a1a | Primary text, borders, lines |
| --trace-light | #d0d0d0 | Lighter borders |
| --trace-faint | #e8e8e8 | Very light borders, grid dots |
| --red | #e63946 | Accent, errors, current user |
| --red-light | #fce4e6 | Light red backgrounds |
| --blue | #457b9d | Alternative accent |
| --text | #1a1a1a | Main text |
| --text-secondary | #6b7280 | Secondary text |
| --text-muted | #9ca3af | Disabled/muted text |

**Typography:**
- Font: IBM Plex Mono (monospace)
- Loaded from Google Fonts CDN
- Weights: 300, 400, 500, 600
- Font smoothing: antialiased

**Tree background:** Radial gradient dot pattern (`--trace-faint` color, 1px dots, 24px grid spacing) creating a subtle PCB grid effect.

---

## 33. Responsive Design

### How It Should Work

**Breakpoints:**

| Width | Behavior |
|-------|----------|
| >= 600px (Desktop) | Profile: side panel (400px, max 50vw). Connection: right panel (320px, max 85vw) |
| < 600px (Mobile) | Profile: fullscreen. Connection: bottom sheet (45vh). Menu: 280px or 100% |
| <= 480px (Small) | Auth title: 24px (vs 28px). Profile name: 20px (vs 24px). Photo: 96px (vs 120px) |

**Safe area support (notch devices):**
- Top bar: `padding-top` includes `env(safe-area-inset-top)`
- FABs: `bottom` includes `env(safe-area-inset-bottom)`
- Menu header: padding includes safe area
- Connection panel: `padding-bottom` includes safe area

---

## 34. Node Styling & Visual States

### How It Should Work

**Base node:** Round-rectangle shape, 170x62px, IBM Plex Mono 11px weight 500.

**Node content (multi-line label):**
- Line 1: `{firstName} {lastName}`
- Line 2 (if birthName exists): `geb. {birthName}`
- Line 3 (if birthDate exists): `* {birthYear}` or `* {birthYear} † {deathYear}` for deceased

**Visual states:**

| State | Border | Background | Text Color | Opacity |
|-------|--------|------------|-----------|---------|
| Alive + Claimed | 2px solid #1a1a1a | #ffffff | #1a1a1a | 1.0 |
| Alive + Placeholder | 2px dotted #1a1a1a | #ffffff | #1a1a1a | 1.0 |
| Deceased | 2px dashed #9ca3af | #f8f9fa | #9ca3af | 1.0 |
| Current User | 3px solid #e63946 | #fff5f5 | #1a1a1a | 1.0 |
| Highlighted (path) | 3px solid #e63946 | #fff5f5 | #1a1a1a | 1.0 |
| Dimmed | (unchanged) | (unchanged) | (unchanged) | 0.15 |
| Selected (tapped) | 3px solid #e63946 | (unchanged) | (unchanged) | 1.0 |

**Couple midpoint node:** 1x1px, invisible (no border, no background, no labels, no pointer events, z-index 1).

---

## 35. Edge Styling

### How It Should Work

| Edge Type | Color | Width | Style | Curve | Notes |
|-----------|-------|-------|-------|-------|-------|
| Parent-Child | #1a1a1a | 2px | Solid | Taxi (Manhattan) downward, 40px turn radius | Arrow: none |
| Spouse | #1a1a1a | 2px | Solid | Straight (generational) or Unbundled-bezier (temporal) | Arrow: none |
| Sibling | #6b9e78 (green) | 2px | Dotted (4px dash) | Straight | Only shown if siblings don't share visible parent edge |
| Highlighted | (original) | (original) | (original) | (original) | Class `.highlighted` adds visual emphasis |
| Dimmed | (original) | (original) | (original) | (original) | Opacity: 0.15 |

**applySpouseEdgeStyle():** After each render, iterates spouse edges. In temporal mode, if spouses have different Y positions, applies bezier curve with control points proportional to the Y offset. In generational mode, uses straight lines.

---

## 36. Cytoscape.js Configuration

### How It Should Work

| Setting | Value | Notes |
|---------|-------|-------|
| Layout | preset | Manual positioning via layout algorithms |
| Min Zoom | 0.1 | Can zoom out to see very large trees |
| Max Zoom | 3.0 | Prevents over-zooming |
| Wheel Sensitivity | 0.3 | Reduced for smoother scroll zoom |
| Box Selection | Disabled | No multi-select drag |
| Selection Type | single | Only one node at a time |
| Auto-ungrabify | true | Nodes cannot be dragged by user |

**Event handling:**
- Node tap: calls `onNodeTapCallback(nodeId)`, ignores couple-midpoint taps
- Background tap: calls `clearHighlight()` + `onBackgroundTapCallback()`
- Visibility change: on tab switch back, calls `cy.resize()` + restores highlights

**Navigation functions:**
- `centerOn(memberId, zoom=1.5)`: 500ms ease-out animation to center + zoom on member
- `fitAll()`: 500ms ease-out animation to fit all elements with 60px padding
- `getNodePosition(memberId)`: returns `{x, y}` or null

---

## 37. Demo Data Seeding

### How It Should Work

**Trigger:** On first tree load, if `getAllMembers()` returns empty array.

**Process:**
1. Check if any members exist
2. If yes: return false (idempotent, no changes)
3. If no: insert 16 placeholder members (von Stammberg family) and their relationships

**Demo family structure:**
- Generation 0: Friedrich (1920-1995) & Elisabeth (1924-2001)
- Generation 1: Heinrich (b.1948), Wilhelm (b.1952), Charlotte (b.1955) with spouses
- Generation 2: Alexander (b.1975), Maximilian (b.1977), Katharina (b.1980), etc.
- Generation 3: Luisa (b.2005), Moritz (b.2008), Anna (b.2003), etc.

**Relationships created:**
- Parent-child edges connecting each generation
- Spouse edges for married couples
- All members created as `isPlaceholder: true`
- Members include: locations, notes, birth names for married-in women

---

## 38. Data Caching Strategy

### How It Should Work

**Global cache (in App module):**
- `cachedMembers`: All members loaded via `DB.getAllMembers()`
- `cachedRelationships`: All relationships loaded via `DB.getAllRelationships()`
- Both loaded together via `DB.getFullGraph()` (parallel `Promise.all`)
- Used by: Tree rendering, Search, Connection overlay

**Refresh trigger:** `App.refreshTree()` / `App.loadTree()` reloads full graph from database and re-renders tree.

**When cache is refreshed:**
- After login/claim (initial load)
- After creating a new member
- After deleting a member
- After adding or removing a relationship
- After saving profile edits
- After QR scan finds a member not in cache

**Search cache:** `Search.setMembers(cachedMembers)` passes reference after each tree load. Search operates entirely on this in-memory data (no DB queries during search).

**Debouncing:**
- Relationship search: 250ms (in profile edit)
- Claim search: 250ms
- Main search: 200ms

---

## 39. Error Handling

### How It Should Work

**Database errors:**
- All DB operations wrapped in try-catch
- Errors thrown to caller (not swallowed)
- Caller shows toast with German error message
- RLS policy violations silently return empty results (Supabase behavior)

**Auth errors:**
- English Supabase errors mapped to German messages via `mapAuthError()`
- Shown as error toasts

**Tree visualization:**
- Missing nodes: gracefully omitted (no crash)
- Couple midpoint not found: silently skipped
- Highlight with no path: clears highlight, returns
- Tab switch: re-renders safely with `cy.resize()`

**Relationship calculations:**
- No path found: returns `null` for DNA, "Keine Verbindung gefunden" for term
- Invalid input: returns `null`
- Missing data: shows "—" in UI

**Network failures:**
- Database operations fail with error toast
- User can retry most operations
- Service worker serves cached static assets

---

## 40. Security Considerations

### Current State

**Authentication:**
- Supabase JWT tokens (client-side)
- Password minimum 6 characters
- Password reset via email link with tokenized URL

**Authorization model:**
- All authenticated + approved users can read all members and relationships (public tree)
- All authenticated users can create new placeholder members
- All authenticated users can edit any member (no ownership check)
- Only true placeholders can be deleted (by any authenticated user)
- Admin functions restricted to `ADMIN_EMAIL` check

**Data exposure:**
- Supabase anon key is in the frontend source (standard for Supabase public clients)
- Admin email is hardcoded in source
- EmailJS keys are in the frontend source
- QR deep links contain member UUIDs (discoverable)
- No PII in URLs except `#connect/ID`

**Input handling:**
- Dates: validated by HTML date input element
- Names: trimmed, non-empty check
- Emails: Supabase validates for auth
- UUIDs: validated by database constraints
- No explicit XSS sanitization on member names/notes (displayed as `textContent`, not `innerHTML` in most places)

**Row-Level Security:**
- Supabase RLS policies enforced at database level
- Client cannot bypass RLS regardless of frontend code
- Specific policies defined in Supabase dashboard (not in frontend code)
