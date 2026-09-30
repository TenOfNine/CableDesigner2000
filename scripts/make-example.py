#!/usr/bin/env python3
"""
Erzeugt examples/beispiel-zuendung-einspritzung.harness.json – ein Beispiel-Kabelbaum
(angelehnt an das Video: Einspritzung/Zündung mit Schottstecker, ECUs und Armaturenbrett).
Die Teiledaten entsprechen der vorbefüllten globalen Bibliothek (server/seed-parts.js).
"""
import json, itertools, os

_ids = itertools.count(1)
def uid(prefix):
    return f"{prefix}ex{next(_ids)}"

GRAY = {"name": "Grau", "hex": "#8a8f98"}

def dt_part(pn, cav, gender, rows, contact, lock, mating, desc):
    return {
        "id": None, "category": "connector", "partNumber": pn, "manufacturer": "TE Connectivity DEUTSCH",
        "description": desc, "hasImage": False, "imageVersion": "",
        "data": {"series": "DEUTSCH DT", "cavities": cav, "designation": "numeric", "rows": rows,
                 "numbering": "serpentine", "gender": gender, "color": GRAY, "contactPart": contact,
                 "contactRange": "16–20 AWG", "lockPart": lock, "matingPart": mating},
    }

def dt04(cav, suf, rows):
    return dt_part(f"DT04-{suf}", cav, "male", rows, "0460-202-16141", f"W{cav}P", f"DT06-{suf.replace('P','S')}",
                   f"DEUTSCH DT, {cav}-polig, Gehäuse mit Stiftkontakten (Receptacle), Kontaktgröße 16")

def dt06(cav, suf, rows):
    return dt_part(f"DT06-{suf}", cav, "female", rows, "0462-201-16141", f"W{cav}S", f"DT04-{suf.replace('S','P')}",
                   f"DEUTSCH DT, {cav}-polig, Gehäuse mit Buchsenkontakten (Plug), Kontaktgröße 16")

RING_M6 = {"id": None, "category": "terminal", "partNumber": "", "manufacturer": "", "hasImage": False, "imageVersion": "",
           "description": "Ringkabelschuh isoliert M6, 0,5–1,5 mm² (rot)", "data": {"subtype": "ring", "stud": "M6"}}
SPLICE = {"id": None, "category": "splice", "partNumber": "", "manufacturer": "", "hasImage": False, "imageVersion": "",
          "description": "Stoßverbinder isoliert, 0,5–1,5 mm² (rot)", "data": {}}
WELLROHR10 = {"id": None, "category": "covering", "partNumber": "", "manufacturer": "", "hasImage": False, "imageVersion": "",
              "description": "Wellrohr PA, geschlitzt, NW 10", "data": {"subtype": "corrugated", "innerDiameter": 10}}
BAND = {"id": None, "category": "covering", "partNumber": "", "manufacturer": "", "hasImage": False, "imageVersion": "",
        "description": "Gewebeklebeband PET, 19 mm breit", "data": {"subtype": "tape"}}

comps, wires, nodes, segs = [], [], [], []
byname = {}

def comp(ctype, label, pins, sch, lay, part=None, subtype=None, show=None):
    c = {"id": uid("c"), "type": ctype, "label": label, "part": part,
         "pins": [{"id": uid("p"), "name": n, "fn": f} for n, f in pins],
         "sch": {"x": sch[0], "y": sch[1]}, "lay": {"x": lay[0], "y": lay[1]},
         "show": show or {}, "callouts": {}, "excludeFromBom": False, "notes": ""}
    if ctype == "connector":
        c["mateId"] = None
    if subtype:
        c["subtype"] = subtype
    comps.append(c)
    byname[label] = c
    return c

def pin(label, name):
    c = byname[label]
    p = next(p for p in c["pins"] if p["name"] == name)
    return {"c": c["id"], "p": p["id"]}

wn = itertools.count(1)
def wire(a, b, color, cs, signal="", stripe=None):
    wires.append({"id": uid("w"), "label": f"W{next(wn)}", "from": a, "to": b, "signal": signal, "color": color,
                  "stripe": stripe, "cs": cs, "type": "FLRY-B", "part": None, "lengthExtra": 0,
                  "lengthOverride": None, "notes": ""})

def node(key, x, y, label=None):
    n = {"id": uid("n"), "x": x, "y": y, "label": label or f"A{len(nodes) + 1}"}
    nodes.append(n)
    byname[key] = n
    return n

def seg(a, b, length, coverings=()):
    segs.append({"id": uid("s"), "a": byname[a]["id"], "b": byname[b]["id"], "length": length, "points": [],
                 "coverings": [{"id": uid("v"), "part": cv, "label": ""} for cv in coverings], "label": ""})

T = {"table": True}
# ---------- Bauteile (Schaltplan-Position, Layout-Position) ----------
comp("connector", "Injector 1", [("1", "BAT +"), ("2", "INJ 1")], (0, 0), (-760, -330), dt04(2, "2P", 1), show=T)
comp("connector", "Coil 1", [("1", "IGN 1"), ("2", "GND"), ("3", "BAT +")], (0, 110), (-340, -330), dt04(3, "3P", 1), show=T)
comp("connector", "Injector 2", [("1", "BAT +"), ("2", "INJ 2")], (0, 240), (340, -330), dt04(2, "2P", 1), show=T)
comp("connector", "Coil 2", [("1", "IGN 2"), ("2", "GND"), ("3", "BAT +")], (0, 350), (760, -330), dt04(3, "3P", 1), show=T)
comp("terminal", "GND Motor", [("1", "GND")], (0, 500), (-900, 0), RING_M6, subtype="ring")
comp("splice", "S1", [("S", "BAT +")], (330, 380), (0, 80), SPLICE)
comp("connector", "Bulk Head E", [("1", "INJ 1"), ("2", "INJ 2"), ("3", "IGN 1"), ("4", "IGN 2"), ("5", "BAT +"), ("6", "")],
     (420, 60), (0, 170), dt04(6, "6P", 2), show={"face": True})
comp("connector", "Bulk Head C", [("1", "INJ 1"), ("2", "INJ 2"), ("3", "IGN 1"), ("4", "IGN 2"), ("5", "BAT +"), ("6", "")],
     (720, 60), (0, 290), dt06(6, "6S", 2), show={"face": True, "table": True})
comp("connector", "ECU 2", [("1", "BAT +"), ("2", "INJ 1"), ("3", "INJ 2"), ("4", "IGN 1"), ("5", "IGN 2"), ("6", "GND")],
     (1060, 0), (-460, 560), dt06(6, "6S", 2), show={"face": True})
comp("connector", "ECU 1", [("1", "CAN H"), ("2", "CAN L")], (1060, 220), (-460, 720), dt06(2, "2S", 1))
comp("connector", "Dashboard", [("1", "BAT +"), ("2", "CAN H"), ("3", "CAN L"), ("4", "GND")], (1060, 340), (-460, 900),
     dt06(4, "4S", 2), show={"face": True})
comp("splice", "S2", [("S", "BAT +")], (930, 520), (0, 1000), SPLICE)
comp("splice", "S3", [("S", "GND")], (930, 600), (0, 1060), SPLICE)
comp("terminal", "BAT +", [("1", "BAT +")], (1100, 500), (-130, 1240), RING_M6, subtype="ring")
comp("terminal", "BAT -", [("1", "GND")], (1100, 580), (130, 1240), RING_M6, subtype="ring")

byname["Bulk Head E"]["mateId"] = byname["Bulk Head C"]["id"]
byname["Bulk Head C"]["mateId"] = byname["Bulk Head E"]["id"]
byname["Bulk Head E"]["callouts"] = {"face": {"dx": -140, "dy": -36}}
byname["Bulk Head C"]["callouts"] = {"face": {"dx": -140, "dy": -20}, "table": {"dx": 150, "dy": 20}}
byname["ECU 2"]["callouts"] = {"face": {"dx": -150, "dy": -36}}
byname["Dashboard"]["callouts"] = {"face": {"dx": -150, "dy": -36}}
for lbl, dx in [("Injector 1", -169), ("Coil 1", -169), ("Injector 2", -169), ("Coil 2", -169)]:
    byname[lbl]["callouts"] = {"table": {"dx": dx, "dy": -150}}

# ---------- Leitungen ----------
wire(pin("Injector 1", "1"), pin("S1", "S"), "RD", 0.75, "BAT +")
wire(pin("Injector 1", "2"), pin("Bulk Head E", "1"), "OG", 0.75, "INJ 1")
wire(pin("Coil 1", "1"), pin("Bulk Head E", "3"), "GN", 0.75, "IGN 1")
wire(pin("Coil 1", "2"), pin("GND Motor", "1"), "BK", 1.0, "GND")
wire(pin("Coil 1", "3"), pin("S1", "S"), "RD", 0.75, "BAT +")
wire(pin("Injector 2", "1"), pin("S1", "S"), "RD", 0.75, "BAT +")
wire(pin("Injector 2", "2"), pin("Bulk Head E", "2"), "YE", 0.75, "INJ 2")
wire(pin("Coil 2", "1"), pin("Bulk Head E", "4"), "BU", 0.75, "IGN 2")
wire(pin("Coil 2", "2"), pin("GND Motor", "1"), "BK", 1.0, "GND")
wire(pin("Coil 2", "3"), pin("S1", "S"), "RD", 0.75, "BAT +")
wire(pin("S1", "S"), pin("Bulk Head E", "5"), "RD", 1.5, "BAT +")
wire(pin("Bulk Head C", "1"), pin("ECU 2", "2"), "OG", 0.75, "INJ 1")
wire(pin("Bulk Head C", "2"), pin("ECU 2", "3"), "YE", 0.75, "INJ 2")
wire(pin("Bulk Head C", "3"), pin("ECU 2", "4"), "GN", 0.75, "IGN 1")
wire(pin("Bulk Head C", "4"), pin("ECU 2", "5"), "BU", 0.75, "IGN 2")
wire(pin("Bulk Head C", "5"), pin("S2", "S"), "RD", 1.5, "BAT +")
wire(pin("ECU 2", "1"), pin("S2", "S"), "RD", 0.75, "BAT +")
wire(pin("ECU 2", "6"), pin("S3", "S"), "BK", 0.75, "GND")
wire(pin("ECU 1", "1"), pin("Dashboard", "2"), "VT", 0.5, "CAN H")
wire(pin("ECU 1", "2"), pin("Dashboard", "3"), "WH", 0.5, "CAN L", stripe="VT")
wire(pin("Dashboard", "1"), pin("S2", "S"), "RD", 0.75, "BAT +")
wire(pin("Dashboard", "4"), pin("S3", "S"), "BK", 0.75, "GND")
wire(pin("S2", "S"), pin("BAT +", "1"), "RD", 1.5, "BAT +")
wire(pin("S3", "S"), pin("BAT -", "1"), "BK", 1.5, "GND")

# ---------- Layout ----------
node("L", -550, -180); node("R", 550, -180)
node("LL", -550, 0); node("RR", 550, 0); node("C", 0, 0)
node("D2", 0, 560); node("E12", -240, 640); node("D3", 0, 900); node("D4", 0, 1140)
seg("Injector 1", "L", 200, [BAND]); seg("Coil 1", "L", 200, [BAND])
seg("Injector 2", "R", 200, [BAND]); seg("Coil 2", "R", 200, [BAND])
seg("L", "LL", 300, [WELLROHR10]); seg("R", "RR", 300, [WELLROHR10])
seg("GND Motor", "LL", 300); seg("LL", "C", 700, [WELLROHR10]); seg("RR", "C", 700, [WELLROHR10])
seg("C", "S1", 150, [WELLROHR10]); seg("S1", "Bulk Head E", 150, [WELLROHR10])
seg("Bulk Head C", "D2", 500, [WELLROHR10])
seg("D2", "E12", 600, [WELLROHR10]); seg("E12", "ECU 2", 100); seg("E12", "ECU 1", 100)
seg("D2", "D3", 400, [WELLROHR10]); seg("D3", "Dashboard", 800, [WELLROHR10])
seg("D3", "S2", 400, [WELLROHR10]); seg("S2", "S3", 50); seg("S3", "D4", 150)
seg("D4", "BAT +", 200); seg("D4", "BAT -", 200)

doc = {
    "schemaVersion": 1,
    "settings": {"drawingNumber": "KB-001", "revision": "A", "author": "", "extraPerEnd": 15, "extraPercent": 2,
                 "defaultCrossSection": 0.75, "defaultWireType": "FLRY-B", "defaultColor": "BK"},
    "components": comps, "wires": wires, "nodes": nodes, "segments": segs,
    "notes": [
        {"id": uid("n"), "view": "sch", "x": 0, "y": -110, "text": "Beispiel: Einspritzung & Zündung\nMotorseite links, Fahrzeugseite rechts (über Schottstecker E/C)"},
        {"id": uid("n"), "view": "lay", "x": 260, "y": 1120, "text": "Batterieanschluss\nRingkabelschuhe M6"},
    ],
}
out = {"format": "harness-designer", "formatVersion": 1, "name": "Beispiel – Einspritzung & Zündung",
       "description": "Beispiel-Kabelbaum mit Schottstecker, zwei ECUs, Armaturenbrett und Spleißen.", "data": doc}
here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, "..", "examples", "beispiel-zuendung-einspritzung.harness.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("geschrieben:", os.path.normpath(path), len(comps), "Bauteile,", len(wires), "Leitungen,", len(segs), "Segmente")
