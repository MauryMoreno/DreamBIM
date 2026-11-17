"""Converts the .ifc files of the official examples and compares them with their official .ifcx.

    .venv/Scripts/python tools/check_examples.py [--skip-convert] [--only NAME]

Writes out/<name>.ifcx, out/<name>.json (detailed comparison) and out/report.md.
The comparison is made by studio/scripts/compare-ifcx.ts (it reuses the composition of Dream BIM and
opens the result with the pipeline of the official viewer to validate the schema).

It needs the official buildingSMART IFC5-development repository in
References/IFC5-development-main/IFC5-development-main/ (next to converter/).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "out")
STUDIO = os.path.join(ROOT, "..", "studio")
EX = os.path.join(ROOT, "..", "References", "IFC5-development-main", "IFC5-development-main", "examples")

# (name, input .ifc, official .ifcx, known differences of the official file that do not come from the .ifc)
PAIRS = [
    ("hello-wall", "Hello Wall/hello-wall.ifc", "Hello Wall/hello-wall.ifcx",
     "The official file added Volume/Height (calc_properties.py) and IsExternal on the windows by hand, "
     "and reduced the space to 4 m deep (the .ifc says 5 m)."),
    ("domestic-hot-water", "Domestic Hot Water/domestic-hot-water.ifc", "Domestic Hot Water/domestic-hot-water.ifcx",
     "The official script removes the walls and hangs the system from the Hello Wall building: "
     "project, site, building, storey and 2 walls show up as extra."),
    ("georeferenced-bridge-deck", "Georeferencing/georeferenced-bridge-deck.ifc", "Georeferencing/georeferenced-bridge-deck.ifcx",
     "The official file adds reference points computed with pyproj (they are not in the .ifc)."),
    ("linear-placement-of-signal", "Linear placement of signals/linear-placement-of-signal.ifc",
     "Linear placement of signals/linear-placement-of-signal.ifcx",
     "The official script subtracts the UTM origin from the large coordinates by hand: the geometry shows "
     "up shifted by a constant translation."),
    ("Railway_project_simple_IFC4X3", "Railway/Railway_project_simple_IFC4X3.ifc", "Railway/Railway_project_simple_IFC5.ifcx",
     "The official file is a separate SierraSoft export (other GlobalIds, no bsi::ifc::class): "
     "it cannot be compared by identifier. The alignment parameters do match."),
    ("IFC Hero Model", "IFC Hero Model/IFC Hero Model.ifc", "IFC Hero Model/IFC Hero Model.ifcx",
     "Marble Bench: the .ifc says IfcFurniture; the official file uses IfcFurnishingElement."),
    ("Roadway_project_IFC4X3", "Road/Roadway_project_IFC4X3.ifc", "Road/Roadway_project_IFC5.ifcx",
     "Like Railway: a separate SierraSoft export, with other GlobalIds."),
    ("TeklaHouse", "Tekla House/TeklaHouse.ifc", "Tekla House/TeklaHouse.ifcx",
     "The official file leaves out the geometry of the reinforcement; here it is exported as an axis "
     "(--rebar axis). The boxes that do not match within ±1 mm (piles and other curved pieces) are off by "
     "2.2 mm at most: that is the tessellation of --detail medium."),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          shell=(os.name == "nt"))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-convert", action="store_true", help="reuse the .ifcx files already generated")
    ap.add_argument("--only", help="process only the example with this name")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    rows = []
    for name, src, official, note in PAIRS:
        if args.only and args.only != name:
            continue
        gen = os.path.join(OUT, name + ".ifcx")
        seconds = None
        if not args.skip_convert:
            t0 = time.perf_counter()
            r = run([sys.executable, "-m", "ifc2ifcx", os.path.join(EX, src), gen], ROOT)
            seconds = time.perf_counter() - t0
            if r.returncode != 0:
                print(f"[{name}] conversion error:\n{r.stderr[-2000:]}")
                rows.append((name, None, note, seconds))
                continue
        report = os.path.join(OUT, name + ".json")
        r = run(["npx", "vite-node", "scripts/compare-ifcx.ts", "--", os.path.join(EX, official), gen, "--json", report], STUDIO)
        if r.returncode != 0 or not os.path.exists(report):
            print(f"[{name}] comparison error:\n{r.stderr[-2000:]}")
            rows.append((name, None, note, seconds))
            continue
        print(f"=== {name}\n{r.stdout.strip()}\n")
        with open(report, encoding="utf-8") as fh:
            rows.append((name, json.load(fh), note, seconds))

    write_report(rows)
    print(f"Report: {os.path.join(OUT, 'report.md')}")
    return 0 if all(r[1] for r in rows) else 1


def pct(ok, total):
    return f"{ok}/{total}" if total else "—"


def write_report(rows):
    lines = [
        "# ifc2ifcx: comparison with the official examples",
        "",
        "| Example | Entities | Class | Parent | Properties | Geometry ±1 mm | Schema | MB | s |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, r, _, seconds in rows:
        if not r:
            lines.append(f"| {name} | error | | | | | | | |")
            continue
        e, p, g = r["entities"], r["props"], r["geometry"]
        geo = pct(g["checked"] - len(g["missing"]) - len(g["different"]), g["checked"])
        if g.get("constantOffset"):
            geo += " (constant translation)"
        size = os.path.getsize(r["generated"]) / 1048576
        secs = f"{seconds:.0f}" if seconds is not None else "—"
        lines.append(
            f"| {name} | {pct(e['matched'], e['official'])} (+{len(e['extra'])}) | {len(r['classDiff'])} diff. "
            f"| {len(r['parentDiff'])} diff. | {pct(p['checked'] - len(p['missing']) - len(p['different']), p['checked'])} "
            f"| {geo} | {'ok' if r['schema'].startswith('ok') else 'error'} | {size:.1f} | {secs} |")
    lines += ["", "## Known differences of the official files", ""]
    lines += [f"- **{name}**: {note}" for name, _, note, _ in rows]
    with open(os.path.join(OUT, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
