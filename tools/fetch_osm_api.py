#!/usr/bin/env python3
"""Build game/data/midlothian.json from the main OpenStreetMap API (works when Overpass is down).

Downloads small bbox tiles (cached in tools/.cache), merges them, and converts to local metres
(x = east, z = south) centred on Midlothian High School. Base radius 1 mile; the radius grows to
fit named landmarks the circle would cut off (capped at --max-expand x base).

Usage: python3 -I tools/fetch_osm_api.py [--radius-m 1609] [--refresh]
Data (c) OpenStreetMap contributors, ODbL.
"""
import argparse, json, math, os, subprocess, sys, time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
CENTER = (37.496594, -77.6603231)          # Midlothian High School (OSM way 45110294)
UA = "midlothian-game-private/0.2"
API = "https://api.openstreetmap.org/api/0.6/map?bbox={},{},{},{}"

ROAD_TYPES = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
              "living_street", "service", "motorway_link", "trunk_link", "primary_link",
              "secondary_link", "tertiary_link"}
DEFAULT_LANES = {"motorway": 2, "trunk": 2, "primary": 2, "secondary": 2, "tertiary": 2,
                 "unclassified": 2, "residential": 2, "living_street": 2, "service": 1,
                 "motorway_link": 1, "trunk_link": 1, "primary_link": 1, "secondary_link": 1, "tertiary_link": 1}
AREA_KEYS = ("landuse", "leisure", "natural", "amenity", "shop", "waterway", "golf")
AREA_KINDS = {"grass", "meadow", "forest", "wood", "scrub", "grassland", "wetland", "water", "riverbank",
              "residential", "retail", "commercial", "industrial", "farmland", "cemetery", "religious",
              "recreation_ground", "park", "pitch", "golf_course", "playground", "sports_centre", "track",
              "parking", "school", "place_of_worship", "mall", "fairway", "green", "bunker", "rough",
              "garden", "village_green", "construction", "brownfield", "fuel", "hospital", "college",
              "library", "fire_station", "police", "dog_park", "swimming_pool", "nature_reserve", "basin",
              "pond", "stadium"}
LOCATION_KINDS = {"school", "retail", "commercial", "park", "mall", "place_of_worship", "golf_course",
                  "recreation_ground", "sports_centre", "cemetery", "religious", "hospital", "college",
                  "library", "fire_station", "police", "residential", "nature_reserve", "pitch", "industrial",
                  "stadium", "playground", "dog_park"}
LANDMARK_KINDS = LOCATION_KINDS - {"residential", "industrial"}
POI_KEYS = ("shop", "amenity", "leisure", "tourism", "office", "healthcare", "craft", "club")


def curl(url):
    r = subprocess.run(["curl", "-sS", "--fail", "-m", "120", "-A", UA, url], capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr.decode()[:200])
    return r.stdout


def fetch_tiles(lat0, lon0, rad, refresh):
    cache = os.path.join(HERE, ".cache"); os.makedirs(cache, exist_ok=True)
    ky = 110574; kx = 111320 * math.cos(math.radians(lat0))
    dlat, dlon = rad / ky, rad / kx
    n = max(1, math.ceil(2 * rad / 1100))
    files = []
    for i in range(n):
        for j in range(n):
            s = lat0 - dlat + 2 * dlat * i / n; nn = lat0 - dlat + 2 * dlat * (i + 1) / n
            w = lon0 - dlon + 2 * dlon * j / n; e = lon0 - dlon + 2 * dlon * (j + 1) / n
            # skip tiles entirely outside the circle
            cy = max(s, min(lat0, nn)); cx = max(w, min(lon0, e))
            if math.hypot((cx - lon0) * kx, (cy - lat0) * ky) > rad: continue
            fn = os.path.join(cache, f"t_{rad:.0f}_{n}_{i}_{j}.osm")
            if refresh or not os.path.exists(fn):
                for attempt in range(7):
                    try:
                        data = curl(API.format(f"{w:.6f}", f"{s:.6f}", f"{e:.6f}", f"{nn:.6f}")); break
                    except Exception as ex:
                        print("  retry tile", i, j, ex, file=sys.stderr); time.sleep(min(120, 10 * 2 ** attempt))
                else:
                    sys.exit(f"tile {i},{j} failed")
                open(fn, "wb").write(data); time.sleep(4)
                print(f"  tile {i},{j}: {len(data)//1024} KB")
            files.append(fn)
    return files


def parse(files):
    nodes, ways, rels = {}, {}, {}
    for fn in files:
        root = ET.parse(fn).getroot()
        for el in root:
            if el.get("id") is None: continue
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            i = int(el.get("id"))
            if el.tag == "node": nodes[i] = (float(el.get("lat")), float(el.get("lon")), tags)
            elif el.tag == "way": ways[i] = ([int(n.get("ref")) for n in el.findall("nd")], tags)
            elif el.tag == "relation":
                rels[i] = ([(m.get("type"), int(m.get("ref")), m.get("role")) for m in el.findall("member")], tags)
    return nodes, ways, rels


def join_rings(segs):
    """Join lists of node ids into closed rings (multipolygon outer assembly)."""
    segs = [list(s) for s in segs if len(s) > 1]; rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for k, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(k); changed = True; break
        if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur)
    return rings


def area_kind(t):
    for k in AREA_KEYS:
        v = t.get(k)
        if v and v in AREA_KINDS: return "water" if v in ("riverbank", "basin", "pond") else ("forest" if v == "wood" else v)
    if t.get("natural") == "water" or t.get("water"): return "water"
    return None


def clip_poly(pts, R, n=96):
    """Sutherland-Hodgman clip of a polygon against a regular n-gon approximating the circle."""
    Rr = R / math.cos(math.pi / n)
    out = pts
    for k in range(n):
        a0 = 2 * math.pi * k / n; a1 = 2 * math.pi * (k + 1) / n
        ax, az = Rr * math.cos(a0), Rr * math.sin(a0); bx, bz = Rr * math.cos(a1), Rr * math.sin(a1)
        side = lambda p: (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax)
        inp, out = out, []
        if not inp: break
        for i in range(len(inp)):
            p, q = inp[i - 1], inp[i]; sp, sq = side(p), side(q)
            if sq >= 0:
                if sp < 0: t = sp / (sp - sq); out.append([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
                out.append(q)
            elif sp >= 0:
                t = sp / (sp - sq); out.append([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    return [[round(x, 2), round(z, 2)] for x, z in out]


def poly_area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


def num(v, default=None):
    try: return float(str(v).split(";")[0].split()[0].replace("'", ""))
    except Exception: return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--radius-m", type=float, default=1609.344)
    ap.add_argument("--max-expand", type=float, default=1.5)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "game", "data", "midlothian.json"))
    a = ap.parse_args()
    lat0, lon0 = CENTER; base = a.radius_m; fetch_r = base * a.max_expand
    print(f"centre {lat0}, {lon0}; base radius {base:.0f} m; fetching {fetch_r:.0f} m")
    nodes, ways, rels = parse(fetch_tiles(lat0, lon0, fetch_r, a.refresh))
    print(f"parsed {len(nodes)} nodes, {len(ways)} ways, {len(rels)} relations")

    ky = 110574; kx = 111320 * math.cos(math.radians(lat0))
    P = lambda nid: [round((nodes[nid][1] - lon0) * kx, 2), round(-(nodes[nid][0] - lat0) * ky, 2)]
    has = lambda nids: all(n in nodes for n in nids)

    roads, buildings, areas, lines, pois, places, trees, signals, stops, crossings = [], [], [], [], [], [], [], [], [], []
    for wid, (nids, t) in ways.items():
        if not has(nids) or len(nids) < 2: continue
        pts = [P(n) for n in nids]
        hw = t.get("highway")
        if hw in ROAD_TYPES:
            if t.get("area") == "yes" or t.get("access") == "private" and hw == "service" and t.get("service") == "driveway": continue
            ow = t.get("oneway")
            if ow == "-1": nids, pts, ow = nids[::-1], pts[::-1], "yes"
            oneway = ow == "yes" or hw in ("motorway", "motorway_link") or t.get("junction") == "roundabout"
            if t.get("lanes"): lanes = max(1, int(num(t["lanes"], 2) or 2))
            elif hw == "service" or hw.endswith("_link"): lanes = 1
            elif oneway: lanes = 2 if hw in ("motorway", "trunk", "primary", "secondary") else 1
            else: lanes = 2
            svc = t.get("service")
            lw = 3.4 if hw in ("residential", "unclassified", "living_street", "service") else 3.6
            w = lanes * lw + (0.8 if hw != "service" else 0)
            if hw == "service" and not oneway: w = 5.2
            if svc == "parking_aisle": w = 6.2
            if svc == "driveway": w = 3.6
            roads.append({"id": wid, "type": hw, "svc": svc, "name": t.get("name"), "ref": t.get("ref"),
                          "lanes": lanes, "oneway": oneway, "w": round(w, 1),
                          "bridge": t.get("bridge") == "yes", "layer": int(num(t.get("layer"), 0) or 0),
                          "speed": num(t.get("maxspeed"), None), "pts": pts, "nids": nids})
            continue
        closed = nids[0] == nids[-1] and len(nids) >= 4
        if "building" in t and t["building"] != "no" and closed:
            buildings.append((wid, t, pts[:-1])); continue
        if closed and (k := area_kind(t)):
            areas.append({"kind": k, "name": t.get("name"), "pts": pts[:-1]}); continue
        if t.get("waterway") in ("stream", "river", "ditch", "drain", "canal"):
            lines.append({"kind": t["waterway"], "name": t.get("name"), "pts": pts}); continue
        if t.get("natural") == "tree_row":
            for i in range(len(pts) - 1):
                L = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
                for s in range(0, int(L), 8): trees.append([round(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * s / L, 1), round(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * s / L, 1)])

    for rid, (members, t) in rels.items():
        if t.get("type") != "multipolygon": continue
        outer = [ways[r][0] for (ty, r, role) in members if ty == "way" and role in ("outer", "") and r in ways]
        for ring in join_rings(outer):
            if not has(ring): continue
            pts = [P(n) for n in ring][:-1]
            if "building" in t and t["building"] != "no": buildings.append((-rid, t, pts))
            elif (k := area_kind(t)): areas.append({"kind": k, "name": t.get("name"), "pts": pts})

    for nid, (la, lo, t) in nodes.items():
        if not t: continue
        p = [round((lo - lon0) * kx, 2), round(-(la - lat0) * ky, 2)]
        hw = t.get("highway")
        if hw == "traffic_signals": signals.append(p)
        elif hw == "stop": stops.append(p)
        elif hw == "crossing": crossings.append(p)
        if t.get("natural") == "tree": trees.append(p)
        if t.get("place") in ("neighbourhood", "suburb", "hamlet", "village", "locality", "quarter", "town") and t.get("name"):
            places.append({"name": t["name"], "kind": t["place"], "p": p})
        elif t.get("name") and any(k in t for k in POI_KEYS):
            kind = next(t[k] for k in POI_KEYS if k in t)
            pois.append({"name": t["name"], "kind": kind, "brand": t.get("brand"), "p": p})

    B = []
    for wid, t, pts in buildings:
        lv = num(t.get("building:levels"))
        h = num(t.get("height")) or (lv * 3.2 + 1 if lv else None)
        btype = t.get("building", "yes")
        name = t.get("name") or t.get("brand") or None
        B.append({"id": wid, "type": btype, "name": name, "shop": t.get("shop") or t.get("amenity"),
                  "levels": lv, "h": round(h, 1) if h else None, "roof": t.get("roof:shape"),
                  "addr": " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x) or None,
                  "pts": pts})

    # Name buildings that contain a named POI node (e.g. a store whose name sits on a node inside it).
    def pip(x, z, poly):
        c = False
        for i in range(len(poly)):
            x1, z1 = poly[i]; x2, z2 = poly[i - 1]
            if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1: c = not c
        return c
    for b in B:
        if b["name"] or poly_area(b["pts"]) < 150: continue
        xs = [p[0] for p in b["pts"]]; zs = [p[1] for p in b["pts"]]
        for q in pois:
            x, z = q["p"]
            if min(xs) <= x <= max(xs) and min(zs) <= z <= max(zs) and pip(x, z, b["pts"]):
                b["name"] = q["name"]; b["shop"] = b["shop"] or q["kind"]; break
    # Tag school buildings.
    school_areas = [ar for ar in areas if ar["kind"] == "school" and ar.get("name")]
    for b in B:
        cx = sum(p[0] for p in b["pts"]) / len(b["pts"]); cz = sum(p[1] for p in b["pts"]) / len(b["pts"])
        for s in school_areas:
            if pip(cx, cz, s["pts"]): b["school"] = s["name"]; break

    # ---- grow radius for named landmarks cut by the circle ----
    final = base; grown = []
    def check(name, pts):
        nonlocal final
        d = [math.hypot(*p) for p in pts]
        if min(d) <= base < max(d):
            if max(d) <= base * a.max_expand:
                final = max(final, max(d)); grown.append((name, round(max(d))))
    for b in B:
        if b["name"] and poly_area(b["pts"]) > 400: check(b["name"], b["pts"])
    for ar in areas:
        if ar.get("name") and ar["kind"] in LANDMARK_KINDS: check(ar["name"], ar["pts"])
    final = math.ceil(final)
    print(f"final radius {final} m ({final/1609.344:.2f} mi); grown for {grown}")

    inside = lambda pts, r=final: min(math.hypot(*p) for p in pts) <= r
    B = [b for b in B if inside(b["pts"])]
    A = []
    for ar in areas:
        if not inside(ar["pts"]): continue
        full = ar["pts"]
        ar["pts"] = clip_poly(full, final + 40) if max(math.hypot(*p) for p in full) > final + 40 else full
        if len(ar["pts"]) >= 3: A.append(ar)
    R = []
    for r in roads:   # split roads into runs that stay inside the circle
        run_p, run_n = [], []
        def flush():
            if len(run_p) >= 2: R.append({**r, "pts": run_p[:], "nids": run_n[:]})
        for p, n in zip(r["pts"], r["nids"]):
            if math.hypot(*p) <= final + 60: run_p.append(p); run_n.append(n)
            else:
                if run_p: run_p.append(p); run_n.append(n)
                flush(); run_p.clear(); run_n.clear()
        flush()
    Ln = [l for l in lines if inside(l["pts"], final + 60)]
    within = lambda p, r=final: math.hypot(*p) <= r
    pois = [q for q in pois if within(q["p"])]
    places_all = places
    places = [q for q in places if within(q["p"], final * 2.5)]

    # ---- named locations for pop-ups ----
    locs = []
    for ar in A:
        if ar.get("name") and ar["kind"] in LOCATION_KINDS:
            locs.append({"name": ar["name"], "kind": ar["kind"], "pts": ar["pts"], "area": round(poly_area(ar["pts"]))})
    for b in B:
        ba = poly_area(b["pts"])
        if b["name"] and ba > 250:
            cx = sum(p[0] for p in b["pts"]) / len(b["pts"]); cz = sum(p[1] for p in b["pts"]) / len(b["pts"])
            r = max(math.hypot(p[0] - cx, p[1] - cz) for p in b["pts"]) + 30
            locs.append({"name": b["name"], "kind": "building", "c": [round(cx, 1), round(cz, 1)], "r": round(r, 1), "area": round(math.pi * r * r)})
    seen = set(); L2 = []
    for l in sorted(locs, key=lambda l: l["area"]):
        if l["name"] in seen: continue
        seen.add(l["name"]); L2.append(l)

    out = {"version": 2, "center": [lat0, lon0], "radius": final, "base_radius": round(base),
           "attribution": "(c) OpenStreetMap contributors",
           "roads": R, "buildings": B, "areas": A, "lines": Ln, "pois": pois, "places": places,
           "locations": L2, "trees": [t for t in trees if within(t)], "signals": [p for p in signals if within(p)],
           "stops": [p for p in stops if within(p)], "crossings": [p for p in crossings if within(p)]}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f: json.dump(out, f, separators=(",", ":"))
    print({k: len(v) for k, v in out.items() if isinstance(v, list)}, "->", os.path.abspath(a.out),
          f"{os.path.getsize(a.out)//1024} KB")


if __name__ == "__main__":
    main()
