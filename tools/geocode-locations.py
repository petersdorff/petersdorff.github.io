#!/usr/bin/env python3
"""
Einmalige Geokodierung der Wohnort-Freitexte (members.location) für die
Kartenansicht — schreibt place_name / place_lat / place_lng (Migration 012)
und normalisiert den Anzeigetext auf die Picker-Form („Hamburg",
„Milwaukee, USA"). Ortssuche über Photon (komoot, OpenStreetMap-Daten),
nur Stadt-Ebene (city/town/village/hamlet), Land als Rückfall.

Aufruf (Service-Key nur lokal, nie im Repo):
  SB_URL=https://<ref>.supabase.co SB_KEY=<service-role> python3 tools/geocode-locations.py [--dry-run] [--all]

  --dry-run  nur auflösen und Tabelle ausgeben, nichts schreiben
  --all      auch Personen neu auflösen, die schon Koordinaten haben
  --json F   Zuordnung Freitext → Ort zusätzlich als JSON nach F schreiben

Normalisierung (Gotha-Stil):
  „Quaal über Bad Segeberg" / „Schülp bei Rendsburg" → Ort + Kontext (nächster Treffer zum Kontext)
  „Berlin-Charlottenburg", „München-Solln"           → erst ganzer Name, sonst Teil vor dem Bindestrich
  „Wien XV."                                          → römische Bezirksziffer weg
  „Frankfurt a.M."                                    → „Frankfurt am Main"
  „Richards Bay, Südafrika"                           → Ort, Land (Treffer im passenden Land bevorzugt)
  „Jacobsdorf (Pommern)"                              → Klammer als Kontext (historische Orte bleiben ggf. ungelöst)
Unaufgelöste Werte werden gelistet und nicht verändert.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

SB_URL = os.environ.get('SB_URL', '').rstrip('/')
SB_KEY = os.environ.get('SB_KEY', '')
DRY = '--dry-run' in sys.argv
ALL = '--all' in sys.argv
JSON_OUT = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
PHOTON = 'https://photon.komoot.io/api/'
CITY_TAGS = '&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village&osm_tag=place:hamlet&osm_tag=place:suburb'
KIND_RANK = {'city': 0, 'town': 1, 'village': 2, 'hamlet': 3, 'suburb': 4}
COUNTRY_SHORT = {'Vereinigte Staaten von Amerika': 'USA'}
MANUAL = {   # Freitext → (Suchbegriff, 'COUNTRY') oder None = bewusst nicht auflösen
    'Frankfurt a.M.': ('Frankfurt am Main', ''),
    'Erbach am Rhein': ('Erbach', 'CTX:Eltville am Rhein'),   # Rheingau, nicht Odenwald/Donau
    'Neu Seeland': ('Neuseeland', 'COUNTRY'),
    'Neuseeland': ('Neuseeland', 'COUNTRY'),
    'USA': ('Vereinigte Staaten', 'COUNTRY'),
    'Jacobsdorf (Pommern)': None,      # historische Stammsitze (heute Polen) — nicht der Brandenburger Ort
    'Großenhagen (Pommern)': None,
}


def sb(method, path, body=None):
    req = urllib.request.Request(SB_URL + '/rest/v1/' + path, method=method,
                                 data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    req.add_header('apikey', SB_KEY); req.add_header('Authorization', 'Bearer ' + SB_KEY)
    req.add_header('Content-Type', 'application/json'); req.add_header('Prefer', 'return=minimal')
    req.add_header('Range', '0-4999')
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def photon(q, tags=CITY_TAGS, limit=10):
    url = PHOTON + '?' + urllib.parse.urlencode({'q': q, 'limit': limit, 'lang': 'de', 'lat': 51, 'lon': 10}) + tags
    req = urllib.request.Request(url, headers={'User-Agent': 'stammbaum-geocode/1 (family tree, one-off)'})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    out = []
    for f in data.get('features', []):
        p = f.get('properties', {})
        if not p.get('name'):
            continue
        out.append({'name': p['name'], 'state': p.get('state') or '', 'country': p.get('country') or '',
                    'kind': p.get('osm_value', ''), 'lat': f['geometry']['coordinates'][1], 'lng': f['geometry']['coordinates'][0]})
    time.sleep(0.6)   # fair use
    return out


def km(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a['lat'], a['lng'], b['lat'], b['lng']))
    s = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(s))


def norm(s):
    return re.sub(r'\s+', ' ', s.strip().lower())


def exact(hits, q):
    """Nur Treffer, deren Name dem Suchbegriff entspricht — Photon ist unscharf
    („Quaal" → „Quaalerteich", „Marburg an der Lahn" → „Marburg, Slowenien")."""
    variants = {norm(q), norm(re.sub(r'\s+(an der|an dem|am|a\.\s?d\.|a\.\s?M\.)\s+\S+$', '', q))}
    return [h for h in hits if norm(h['name']) in variants]


def rank(hits):
    """Städte (city/town) vor Dörfern/Stadtteilen, innerhalb dessen Deutschland zuerst."""
    return sorted(hits, key=lambda h: (KIND_RANK.get(h['kind'], 9) > 1, h['country'] != 'Deutschland', KIND_RANK.get(h['kind'], 9)))


def choose(hits, country_hint, context):
    """→ Treffer, oder ('ambiguous', hits), oder None"""
    if not hits:
        return None
    if country_hint:
        ch = norm(country_hint)
        same = [h for h in hits if norm(h['country']) == ch or (ch in ('nederland',) and h['country'] == 'Niederlande')]
        if same:
            return rank(same)[0]
    if context:
        ctx = photon(context, CITY_TAGS + '&osm_tag=place:state&osm_tag=place:region&osm_tag=place:county', 3)
        if ctx:
            return min(hits, key=lambda h: km(h, ctx[0]))
    hits = rank(hits)
    top = hits[0]
    # Konkurrenten: bei einer Stadt nur andere Städte, bei einem Dorf auch
    # Weiler/Stadtteile gleichen Namens (dann lieber nachfragen als raten)
    top_rank = KIND_RANK.get(top['kind'], 9)
    limit = 1 if top['kind'] == 'city' else (2 if top['kind'] == 'town' else top_rank + 2)
    rivals = [h for h in hits[1:] if (h['state'], h['country']) != (top['state'], top['country'])
              and KIND_RANK.get(h['kind'], 9) <= limit
              and (h['country'] == 'Deutschland' or top['country'] != 'Deutschland')]
    if rivals and km(top, rivals[0]) > 15:
        return ('ambiguous', [top] + rivals)
    return top


def resolve(text):
    """→ Treffer-dict, ('ambiguous', [hits]) oder None"""
    t = text.strip()
    if t in MANUAL:
        if MANUAL[t] is None:
            return None
        q, hint = MANUAL[t]
        if hint == 'COUNTRY':
            hits = photon(q, '&osm_tag=place:country', 3)
            return hits[0] if hits else None
        t = q
        if hint.startswith('CTX:'):
            return choose(exact(photon(t), t), '', hint[4:])
    country_hint = ''
    context = ''
    if ',' in t:                                   # „Ort, Land"
        t, country_hint = [s.strip() for s in t.split(',', 1)]
    m = re.match(r'^(.*?)\s*\((.*?)\)\s*$', t)      # „Ort (Region)"
    if m:
        t, context = m.group(1).strip(), m.group(2).strip()
    m = re.match(r'^(.*?)\s+(?:über|bei|b\.)\s+(.*)$', t)   # „Ort über/bei Kontext"
    if m:
        t, context = m.group(1).strip(), m.group(2).strip()
    t = re.sub(r'\s+[IVXL]+\.?$', '', t)               # „Wien XV."

    hits = exact(photon(t), t)
    stripped = re.sub(r'\s+(an der|an dem|am|a\.\s?d\.|a\.\s?M\.)\s+\S+$', '', t)
    if stripped != t:                                 # „Marburg an der Lahn": Photon findet den Ort nur als „Marburg"
        seen = {(h['lat'], h['lng']) for h in hits}
        hits += [h for h in exact(photon(stripped), stripped) if (h['lat'], h['lng']) not in seen]
    hit = choose(hits, country_hint, context)
    if not hit and re.search(r'\s*-\s*', t):           # „Stadt-Stadtteil" → Stadt, Stadtteil als Kontext
        a, b = [x.strip() for x in re.split(r'\s*-\s*', t, 1)]
        hit = choose(exact(photon(a), a), country_hint, b) or choose(exact(photon(b), b), country_hint, a)
    return hit


def display(hit):
    if hit['kind'] == 'country':
        return COUNTRY_SHORT.get(hit['name'], hit['name'])
    if hit['country'] in ('Deutschland', ''):
        return hit['name']
    return f"{hit['name']}, {COUNTRY_SHORT.get(hit['country'], hit['country'])}"


def place_name(hit):
    return hit['name'] if hit['kind'] == 'country' else f"{hit['name']}, {hit['country']}".rstrip(', ')


def main():
    if not SB_URL or not SB_KEY:
        sys.exit('SB_URL und SB_KEY setzen')
    try:
        members = sb('GET', 'members?select=id,first_name,last_name,location,place_name,place_lat&order=location')
    except urllib.error.HTTPError as e:
        if e.code != 400 or not DRY:
            raise SystemExit('Spalten place_* fehlen — erst migrations/012_places.sql ausführen')
        members = sb('GET', 'members?select=id,first_name,last_name,location&order=location')   # dry-run vor der Migration
    todo = [m for m in members if (m.get('location') or '').strip() and (ALL or m.get('place_lat') is None)]
    cache = {}
    resolved, unresolved, ambiguous = [], [], {}
    for m in todo:
        loc = m['location'].strip()
        if loc not in cache:
            try:
                cache[loc] = resolve(loc)
            except Exception as e:                # Netz/Photon: weiter mit den anderen
                print(f'  ! {loc}: {e}', file=sys.stderr)
                cache[loc] = None
        hit = cache[loc]
        if isinstance(hit, tuple):
            ambiguous[loc] = hit[1]
            unresolved.append((m, loc, None))
        else:
            (resolved if hit else unresolved).append((m, loc, hit))
    print(f'{len(todo)} Personen mit Wohnort, {len(cache)} verschiedene Texte, {len(resolved)} aufgelöst, {len(unresolved)} offen\n')
    print(f"{'Freitext':38} → {'Anzeige':28} {'place_name':40} {'Typ':8} Koordinaten")
    seen = set()
    for m, loc, hit in resolved:
        if loc in seen:
            continue
        seen.add(loc)
        print(f"{loc[:38]:38} → {display(hit)[:28]:28} {place_name(hit)[:40]:40} {hit['kind']:8} {hit['lat']:.4f}, {hit['lng']:.4f}")
    if ambiguous:
        print('\nMEHRDEUTIG (unverändert — Ort im Editor aus der Liste wählen oder MANUAL ergänzen):')
        for loc, hits in ambiguous.items():
            print(f'   {loc}: ' + ' | '.join(f"{h['name']} ({h['kind']}, {h['state']}, {h['country']})" for h in hits[:4]))
    rest = sorted(set(loc for _, loc, _ in unresolved) - set(ambiguous))
    if rest:
        print('\nNICHT aufgelöst (unverändert):')
        for loc in rest:
            print('  ', loc)
    if JSON_OUT:
        with open(JSON_OUT, 'w', encoding='utf-8') as f:
            json.dump({loc: {'location': display(hit), 'place_name': place_name(hit), 'lat': hit['lat'], 'lng': hit['lng']}
                       for loc, hit in cache.items() if hit and not isinstance(hit, tuple)}, f, ensure_ascii=False, indent=1)
    if DRY:
        print('\n--dry-run: nichts geschrieben')
        return
    n = 0
    for m, loc, hit in resolved:
        body = {'location': display(hit), 'place_name': place_name(hit),
                'place_lat': hit['lat'], 'place_lng': hit['lng']}
        sb('PATCH', f"members?id=eq.{m['id']}", body)
        n += 1
    print(f'\n{n} Personen aktualisiert')


if __name__ == '__main__':
    main()
