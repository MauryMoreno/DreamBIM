"""Usage: python -m ifc2ifcx input.ifc [output.ifcx] [--indent] [--no-step-data] [--id ID]"""

import argparse
import json
import os
import sys
import time

from .convert import Options, convert_file


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="ifc2ifcx", description="Converts IFC (STEP) to IFCX (IFC5 alpha).")
    ap.add_argument("input", help=".ifc file")
    ap.add_argument("output", nargs="?", help=".ifcx file (default: next to the input)")
    ap.add_argument("--id", help="header.id of the IFCX file (default: the output name)")
    ap.add_argument("--indent", action="store_true", help="indented JSON (easier to read, larger)")
    ap.add_argument("--no-step-data", action="store_true", help="do not keep the original STEP line in customdata")
    ap.add_argument("--threads", type=int, help="threads for the tessellation")
    ap.add_argument("--detail", choices=["low", "medium", "high"], default="medium",
                    help="tessellation detail of curved surfaces (default: medium)")
    ap.add_argument("--rebar", choices=["axis", "mesh", "skip"], default="axis",
                    help="reinforcement as an axis (default), as a tessellated tube or skipped")
    args = ap.parse_args(argv)

    out = args.output or os.path.splitext(args.input)[0] + ".ifcx"
    t0 = time.perf_counter()
    doc, report = convert_file(args.input, Options(
        file_id=args.id or os.path.basename(out), step_data=not args.no_step_data, threads=args.threads, detail=args.detail, rebar=args.rebar))
    with open(out, "w", encoding="utf-8") as fh:
        if args.indent:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        else:
            json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)

    size = os.path.getsize(out) / 1048576
    print(f"{out}: {report.entities} entities, {report.geometries} geometries, "
          f"{len(doc['data'])} nodes, {size:.1f} MB in {time.perf_counter() - t0:.1f} s")
    for w in report.warnings[:20]:
        print(f"  warning: {w}", file=sys.stderr)
    if len(report.warnings) > 20:
        print(f"  … and {len(report.warnings) - 20} more warnings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
