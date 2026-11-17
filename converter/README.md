# ifc2ifcx

Translates IFC files (STEP: IFC2X3, IFC4, IFC4X3) to IFCX (IFC5 alpha) with IfcOpenShell.

## Installation

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt    # Windows
```

## Usage

```sh
.venv/Scripts/python -m ifc2ifcx model.ifc                  # writes model.ifcx next to it
.venv/Scripts/python -m ifc2ifcx model.ifc output.ifcx --indent
```

| Option | Effect |
|---|---|
| `--detail low\|medium\|high` | Tessellation accuracy of curved surfaces: 20 mm, 5 mm (default) or 1 mm. |
| `--rebar axis\|mesh\|skip` | Reinforcement as an axis (default), as a tessellated tube or skipped. With `mesh`, Tekla House grows from 33 MB to about 250 MB. |
| `--no-step-data` | Does not keep the original STEP line of each entity in `customdata`. |
| `--id` | `header.id` of the file (default: the output name). |
| `--threads N` | Tessellation threads (default: all cores but one). |

The result opens in Dream BIM (`../studio`) and in the official buildingSMART viewer.

## What is translated

The rules are the same as those of the official buildingSMART examples:

- **Identifiers.** Each entity with a GlobalId uses the UUID that encodes that GlobalId as its `path`. Everything else (geometry, materials) gets a stable UUID v5, so converting the same file again gives the same ids.
- **Tree.** Aggregation, spatial containment, nesting, ports and `IfcRelPositions` become `children`, named by `Name` (`My_Site`, `Window_001`…). An element that fills an opening hangs from its host: the window goes under the wall.
- **Geometry.** It is tessellated with IfcOpenShell and each representation context is a child (`Body`, `Axis`…), with `usd::usdgeom::mesh` or `basiscurves` in metres. Meshes that are identical in local coordinates share one node. If a piece has several styles, the mesh is split by material, each part with its colour (`bsi::ifc::presentation::*`).
- **Revit degrees.** Some Revit IFC files define the degree with a factor without a unit (`IfcMeasureWithUnit(IfcPlaneAngleMeasure(0.0174…), $)`). IfcOpenShell then takes the angles as radians, and an elbow trimmed from 270° to 360° comes out spinning, like a whole torus. Before tessellating, the converter completes that unit with the SI radian (`fix_angle_unit`).
- **Placement.** It goes in `usd::xformop`, as a transformation relative to the parent.
- **Types and materials.** They are expressed as `inherits`: `type` and `material` (`bsi::ifc::material`).
- **Data.** The class goes in `bsi::ifc::class`. Psets and Qtos go in `bsi::ifc::prop::<Name>`, with quantities in SI units. The attributes that the standard imports do not define are declared in `schemas`.
- **Relationships.** Space boundaries (`bsi::ifc::spaceBoundary`), systems (`partofsystem`, `servicesfacility`) and ports (`connectsto`, `flowdirection`).
- **Infrastructure (IFC4X3).** Alignment segments (`bsi::ifc::alignment*segment`), segment lists (`bsi::ifc::alignment`) and linear placement (`bsi::ifc::linearreference`). The segment types that the IFCX alpha enum does not accept, such as `PARABOLICARC`, are written as `ifc2ifcx::alignment*segment` with their own schema, so that the file still validates.
- **Georeferencing.** `IfcMapConversion` goes to the project as `bsi::ifc::mapconversion`.

## Known limitations

- If two Psets have a property with the same name, the last one wins, because IFCX flattens to `bsi::ifc::prop::<Name>`. The converter reports how many there were.
- Products with geometry that do not hang from the spatial tree are not exported. The converter reports them.
- Coordinates are not converted to WGS84 (lat/lon); that would need pyproj.
- `IfcZone` and `IfcStructuralAnalysisModel` are not exported as systems.

## Checks

```sh
.venv/Scripts/python -m pytest tests            # unit tests + Hello Wall
.venv/Scripts/python tools/check_examples.py    # converts the 8 examples and compares them with the official files
```

The Hello Wall test and `check_examples.py` need the official [buildingSMART IFC5-development](https://github.com/buildingSMART/IFC5-development) repository in `References/IFC5-development-main/IFC5-development-main/`, next to `converter/`. Without it, the Hello Wall test is skipped.

`check_examples.py` writes a table per example to `out/report.md` with:

- entities found;
- class, parent and properties that match;
- geometry bounding boxes that match within ±1 mm;
- whether the file opens in the pipeline of the official viewer.

It also lists the differences that come from manual edits in the official `.ifcx` files.
