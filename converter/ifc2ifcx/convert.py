"""Conversion IFC (STEP: IFC2X3 / IFC4 / IFC4X3) -> IFCX (IFC5 alpha).

Rules, taken from the official buildingSMART examples:
  - one node per entity with a GlobalId, path = UUID of the GlobalId
  - spatial tree (aggregation, containment, nesting, filled openings) as `children` by name
  - tessellated geometry in children per representation context (Body, Axis, ...)
  - transformation relative to the parent in `usd::xformop`
  - types and materials as `inherits`
  - class in `bsi::ifc::class`, Psets/Qtos in `bsi::ifc::prop::*`
  - relationships (space boundaries, systems, ports) as references { "ref": uuid }
"""

from __future__ import annotations

import datetime as _dt
import os
from dataclasses import dataclass, field

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.unit
import numpy as np

from .geometry import Part, Shape, digest, make_settings, swept_disk_axes, tessellate
from .ids import IdFactory, NameScope, guid_to_uuid, sanitize
from .props import PropertyCollector

CLASS_URI = "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/{}"

IMPORTS = [
    "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx",
    "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx",
    "https://ifcx.dev/@openusd.org/usd@v1.ifcx",
]

# Attributes already defined by the standard imports: they are not declared again.
KNOWN_SCHEMAS = {
    "bsi::ifc::presentation::diffuseColor", "bsi::ifc::presentation::opacity", "bsi::ifc::class",
    "bsi::ifc::spaceBoundary", "bsi::ifc::material", "bsi::ifc::alignment",
    "bsi::ifc::alignmenthorizontalsegment", "bsi::ifc::alignmentverticalsegment", "bsi::ifc::alignmentcantsegment",
    "bsi::ifc::system::connectsto", "bsi::ifc::system::flowdirection", "bsi::ifc::system::partofsystem",
    "bsi::ifc::system::servicesfacility",
    "bsi::ifc::prop::Name", "bsi::ifc::prop::Description", "bsi::ifc::prop::UsageType",
    "bsi::ifc::prop::RefElevation", "bsi::ifc::prop::ElevationOfRefHeight", "bsi::ifc::prop::ElevationOfTerrain",
    "bsi::ifc::prop::NumberOfStoreys", "bsi::ifc::prop::IsExternal", "bsi::ifc::prop::Volume",
    "bsi::ifc::prop::NetVolume", "bsi::ifc::prop::Height", "bsi::ifc::prop::Width", "bsi::ifc::prop::Length",
    "bsi::ifc::prop::Depth", "bsi::ifc::prop::NetArea", "bsi::ifc::prop::NetSideArea",
    "bsi::ifc::prop::CrossSectionArea", "bsi::ifc::prop::Station", "bsi::ifc::prop::TypeName",
    "usd::usdgeom::mesh", "usd::usdgeom::visibility", "usd::xformop", "usd::usdgeom::basiscurves",
}

REF_ARRAY = {"dataType": "Array", "arrayRestrictions": {"value": {
    "dataType": "Object", "objectRestrictions": {"values": {"ref": {"dataType": "String"}}}}}}

EXTRA_SCHEMAS = {
    "customdata": {"dataType": "Object", "objectRestrictions": {"values": {"originalStepInstance": {"dataType": "String"}}}},
    "bsi::ifc::linearreference": {"dataType": "Object", "objectRestrictions": {"values": {
        "Station": {"dataType": "Real", "optional": True},
        "OffsetLateral": {"dataType": "Real", "optional": True},
        "OffsetVertical": {"dataType": "Real", "optional": True},
        "CartesianPoint": {"dataType": "Array", "optional": True, "arrayRestrictions": {"value": {"dataType": "Real"}}},
    }}},
    "bsi::ifc::mapconversion": {"dataType": "Object", "objectRestrictions": {"values": {
        "Eastings": {"dataType": "Real"}, "Northings": {"dataType": "Real"}, "OrthogonalHeight": {"dataType": "Real"},
        "XAxisAbscissa": {"dataType": "Real", "optional": True}, "XAxisOrdinate": {"dataType": "Real", "optional": True},
        "Scale": {"dataType": "Real", "optional": True}, "TargetCRS": {"dataType": "String", "optional": True},
    }}},
}

# DesignParameters fields that the standard schema accepts for each segment type.
SEGMENT_FIELDS = {
    "IfcAlignmentHorizontalSegment": ["StartPoint", "StartDirection", "StartRadiusOfCurvature",
                                      "EndRadiusOfCurvature", "SegmentLength", "GravityCenterLineHeight", "GeometryType"],
    "IfcAlignmentVerticalSegment": ["StartDistAlong", "HorizontalLength", "StartHeight", "StartGradient",
                                    "EndGradient", "RadiusOfCurvature", "GeometryType"],
    "IfcAlignmentCantSegment": ["StartDistAlong", "HorizontalLength", "StartCantLeft", "EndCantLeft",
                                "StartCantRight", "EndCantRight", "GeometryType"],
}
OPTIONAL_SEGMENT_FIELDS = {"GravityCenterLineHeight"}

EXTENDED_NS = "ifc2ifcx"

# GeometryType values that the IFCX alpha schema accepts, and those that IFC4X3 defines.
IFCX_SEGMENT_TYPES = ["CLOTHOID", "LINE", "CONSTANTGRADIENT", "CIRCULARARC", "CONSTANTCANT", "LINEARTRANSITION"]
IFC4X3_SEGMENT_TYPES = {
    "IfcAlignmentHorizontalSegment": ["BLOSSCURVE", "CIRCULARARC", "CLOTHOID", "COSINECURVE", "CUBIC",
                                      "HELMERTCURVE", "LINE", "SINECURVE", "VIENNESEBEND"],
    "IfcAlignmentVerticalSegment": ["CIRCULARARC", "CLOTHOID", "CONSTANTGRADIENT", "PARABOLICARC"],
    "IfcAlignmentCantSegment": ["BLOSSCURVE", "CONSTANTCANT", "COSINECURVE", "HELMERTCURVE",
                                "LINEARTRANSITION", "SINECURVE", "VIENNESEBEND"],
}


def segment_schema(ifc_class: str) -> dict:
    """A segment schema like the standard one, but with the full IFC4X3 enum."""
    values = {}
    for k in SEGMENT_FIELDS[ifc_class]:
        if k == "GeometryType":
            options = sorted(set(IFCX_SEGMENT_TYPES) | set(IFC4X3_SEGMENT_TYPES[ifc_class]))
            values[k] = {"dataType": "Enum", "enumRestrictions": {"options": options}}
        elif k == "StartPoint":
            values[k] = {"dataType": "Array", "arrayRestrictions": {"value": {"dataType": "Real"}}}
        else:
            values[k] = {"dataType": "Real"}
        if k in OPTIONAL_SEGMENT_FIELDS:
            values[k]["optional"] = True
    return {"dataType": "Object", "objectRestrictions": {"values": values}}


@dataclass
class Options:
    file_id: str | None = None
    step_data: bool = True  # keeps the original STEP line in customdata
    threads: int | None = None
    detail: str = "medium"  # low | medium | high
    rebar: str = "axis"  # axis | mesh | skip (reinforcement: axis, tessellated tube or skipped)


@dataclass
class Report:
    entities: int = 0
    geometries: int = 0
    warnings: list[str] = field(default_factory=list)


class _Node(dict):
    def __init__(self, path: str):
        super().__init__(path=path, children={}, inherits={}, attributes={})


class Converter:
    def __init__(self, f: ifcopenshell.file, options: Options | None = None):
        self.f = f
        self.opt = options or Options()
        self.scale = ifcopenshell.util.unit.calculate_unit_scale(f)
        projects = f.by_type("IfcProject")
        if not projects:
            raise ValueError("The file has no IfcProject")
        self.project = projects[0]
        self.ids = IdFactory(self.project.GlobalId)
        self.props = PropertyCollector(f, self.scale)
        self.nodes: dict[str, _Node] = {}
        self.world: dict[int, np.ndarray] = {}
        self.uid_of: dict[int, str] = {}  # STEP id -> uuid of the node
        self.report = Report()
        self.shapes: dict[int, list[Shape]] = {}
        self.extended_segments = 0

    # --- helpers -------------------------------------------------------------------

    def node(self, path: str) -> _Node:
        n = self.nodes.get(path)
        if n is None:
            n = self.nodes[path] = _Node(path)
        return n

    def world_matrix(self, el) -> np.ndarray:
        cached = self.world.get(el.id())
        if cached is not None:
            return cached
        m = np.eye(4)
        if el.id() in self.shapes:
            m = self.shapes[el.id()][0].matrix
        elif getattr(el, "ObjectPlacement", None) is not None:
            try:
                m = np.array(ifcopenshell.util.placement.get_local_placement(el.ObjectPlacement), dtype=float)
                m[:3, 3] *= self.scale
            except Exception as e:  # noqa: BLE001
                self.report.warnings.append(f"{el}: placement cannot be evaluated ({e})")
        self.world[el.id()] = m
        return m

    # --- main process -----------------------------------------------------------------

    def run(self) -> dict:
        self.shapes, warns = tessellate(self.f, make_settings(self.opt.detail), self.opt.threads)
        self.report.warnings += warns

        root = self.node(self.ids.synthetic("root"))
        scope = NameScope()
        root["children"][scope.take(self.project.Name or "Project")] = self.visit(self.project, np.eye(4))

        self.add_types()
        self.add_materials()
        self.add_space_boundaries()
        self.add_systems(root, scope)
        self.add_ports()
        self.add_georeference()
        self.report.warnings.extend(self._orphans())
        if self.extended_segments:
            self.report.warnings.append(
                f"{self.extended_segments} alignment segments with types outside the IFCX alpha schema "
                f"(e.g. PARABOLICARC) exported as {EXTENDED_NS}::alignment*segment")
        if self.props.conflicts:
            self.report.warnings.append(f"{self.props.conflicts} properties with the same name in different Psets (the last one won)")
        return self.document()

    def visit(self, el, parent_world: np.ndarray) -> str:
        uid = guid_to_uuid(el.GlobalId)
        if el.id() in self.uid_of:
            return uid
        self.uid_of[el.id()] = uid
        self.report.entities += 1
        node = self.node(uid)
        a = node["attributes"]
        a["bsi::ifc::class"] = {"code": el.is_a(), "uri": CLASS_URI.format(el.is_a())}
        if self.opt.step_data:
            a["customdata"] = {"originalStepInstance": str(el)}
        a.update(self.props.collect(el))

        world = self.world_matrix(el)
        rel = np.linalg.solve(parent_world, world)
        if not np.allclose(rel, np.eye(4), atol=1e-9):
            a["usd::xformop"] = {"transform": _transform(rel)}

        self.add_alignment_data(el, a)
        self.add_linear_reference(el, a)

        scope = NameScope()
        self.add_geometry(el, node, scope)
        for child in self.children_of(el):
            if not getattr(child, "GlobalId", None):
                continue
            name = scope.take(child.Name or f"Unnamed {child.is_a()[3:]}")
            node["children"][name] = self.visit(child, world)
        return uid

    def children_of(self, el) -> list:
        out = []
        for rel in getattr(el, "IsDecomposedBy", ()) or ():
            out += rel.RelatedObjects
        for rel in getattr(el, "ContainsElements", ()) or ():
            # the elements that fill an opening hang from their host (as in the official example)
            out += [e for e in rel.RelatedElements if not getattr(e, "FillsVoids", None)]
        for rel in getattr(el, "IsNestedBy", ()) or ():
            out += rel.RelatedObjects
        for rel in getattr(el, "HasPorts", ()) or ():  # IFC2X3
            out.append(rel.RelatingPort)
        for rel in getattr(el, "HasOpenings", ()) or ():
            for fill in getattr(rel.RelatedOpeningElement, "HasFillings", ()) or ():
                out.append(fill.RelatedBuildingElement)
        for rel in getattr(el, "Positions", ()) or ():  # IFC4X3 IfcRelPositions
            out += rel.RelatedProducts
        return [c for c in out if not c.is_a("IfcOpeningElement") and not c.is_a("IfcFeatureElementSubtraction")]

    # --- geometry -----------------------------------------------------------------

    REBAR_CLASSES = ("IfcReinforcingBar", "IfcTendon")

    def add_geometry(self, el, node: _Node, scope: NameScope):
        shapes = self.shapes.get(el.id(), [])
        if shapes and any(el.is_a(c) for c in self.REBAR_CLASSES) and self.opt.rebar != "mesh":
            if self.opt.rebar == "skip":
                return
            axes = swept_disk_axes(el, self.scale)
            if axes:
                body = next((s for s in shapes if s.is_mesh), shapes[0])
                p = body.parts[0] if body.parts else Part(None, None, 1.0)
                shapes = [Shape(context="Axis", geometry_id="", matrix=body.matrix,
                                parts=[Part(p.material, p.color, p.opacity, polylines=axes)])]
        mesh_contexts = {s.context for s in shapes if s.is_mesh}
        for s in shapes:
            if not s.parts:
                continue
            # plan views (lines only) labelled as Body add nothing in 3D
            if not s.is_mesh and s.context in mesh_contexts:
                continue
            key = digest(s)
            uid = self.ids.synthetic("geom", key)
            if uid not in self.nodes:
                self.report.geometries += 1
                self.write_shape(uid, s, key)
            node["children"][scope.take(s.context)] = uid

    def write_shape(self, uid: str, s: Shape, key: str):
        g = self.node(uid)
        parts = [p for p in s.parts if (p.points and p.indices) or p.polylines]
        if len(parts) == 1 and (parts[0].points or len(parts[0].polylines) == 1):
            _write_part(g["attributes"], parts[0])
            return
        scope = NameScope()
        for i, p in enumerate(parts):
            if p.polylines:
                for j, line in enumerate(p.polylines):
                    cid = self.ids.synthetic("geom", key, i, j)
                    _write_part(self.node(cid)["attributes"], Part(p.material, p.color, p.opacity, polylines=[line]))
                    g["children"][scope.take("Curve")] = cid
            else:
                cid = self.ids.synthetic("geom", key, i)
                _write_part(self.node(cid)["attributes"], p)
                g["children"][scope.take(p.material or "Part")] = cid

    # --- types and materials -------------------------------------------------------------

    def add_types(self):
        for rel in self.f.by_type("IfcRelDefinesByType"):
            t = rel.RelatingType
            occurrences = [o for o in rel.RelatedObjects if o.id() in self.uid_of]
            if not occurrences or not getattr(t, "GlobalId", None):
                continue
            tid = guid_to_uuid(t.GlobalId)
            if tid not in self.nodes:
                a = self.node(tid)["attributes"]
                code = t.is_a()
                for suffix in ("Type", "Style"):
                    if code.endswith(suffix):
                        code = code[: -len(suffix)]
                a["bsi::ifc::class"] = {"code": code, "uri": CLASS_URI.format(code)}
                if self.opt.step_data:
                    a["customdata"] = {"originalStepInstance": str(t)}
                a.update(self.props.collect(t))
                if t.Name:
                    a["bsi::ifc::prop::TypeName"] = t.Name
                self.report.entities += 1
            for o in occurrences:
                self.nodes[self.uid_of[o.id()]]["inherits"]["type"] = tid

    def add_materials(self):
        for el_id, uid in list(self.uid_of.items()):
            el = self.f.by_id(el_id)
            try:
                mat = ifcopenshell.util.element.get_material(el, should_skip_usage=True, should_inherit=False)
            except Exception:  # noqa: BLE001
                continue
            if mat is None:
                continue
            name = _material_name(mat)
            if not name:
                continue
            mid = self.ids.synthetic("material", mat.id())
            if mid not in self.nodes:
                self.node(mid)["attributes"]["bsi::ifc::material"] = {"code": name, "uri": ""}
            self.nodes[uid]["inherits"]["material"] = mid

    # --- relationships -----------------------------------------------------------

    def add_space_boundaries(self):
        settings = make_settings()
        for rel in self.f.by_type("IfcRelSpaceBoundary"):
            space, elem = rel.RelatingSpace, rel.RelatedBuildingElement
            if not space or not elem or space.id() not in self.uid_of or elem.id() not in self.uid_of:
                continue
            bid = guid_to_uuid(rel.GlobalId)
            b = self.node(bid)
            b["attributes"]["bsi::ifc::spaceBoundary"] = {
                "relatedelement": {"ref": self.uid_of[elem.id()]},
                "relatingspace": {"ref": self.uid_of[space.id()]},
            }
            surface = getattr(rel.ConnectionGeometry, "SurfaceOnRelatingElement", None) if rel.ConnectionGeometry else None
            if surface is not None:
                try:
                    shp = ifcopenshell.geom.create_shape(settings, surface)
                    v = np.array(shp.verts, dtype=float).reshape(-1, 3)
                    fcs = np.array(shp.faces, dtype=np.int64).reshape(-1)
                    if len(fcs):
                        gid = self.ids.synthetic("boundary", rel.id())
                        _write_part(self.node(gid)["attributes"], Part(None, None, 1.0,
                                    points=np.round(v, 6).tolist(), indices=fcs.tolist()))
                        b["children"]["Body"] = gid
                except Exception as e:  # noqa: BLE001
                    self.report.warnings.append(f"Space boundary #{rel.id()}: geometry cannot be evaluated ({e})")
            space_node = self.nodes[self.uid_of[space.id()]]
            name = f"Boundary_{sanitize(elem.Name or elem.is_a()[3:])}"
            key, n = name, 0
            while key in space_node["children"]:
                n += 1
                key = f"{name}_{n:03d}"
            space_node["children"][key] = bid

    def add_systems(self, root: _Node, scope: NameScope):
        for system in self.f.by_type("IfcSystem"):
            if system.is_a("IfcStructuralAnalysisModel") or system.is_a("IfcZone"):
                continue
            sid = guid_to_uuid(system.GlobalId)
            a = self.node(sid)["attributes"]
            a["bsi::ifc::class"] = {"code": system.is_a(), "uri": CLASS_URI.format(system.is_a())}
            a.update(self.props.collect(system))
            facilities = []
            for rel in list(getattr(system, "ServicesBuildings", ()) or ()) + list(getattr(system, "ServicesFacilities", ()) or ()):
                for fac in getattr(rel, "RelatedBuildings", ()) or ():
                    if fac.id() in self.uid_of:
                        facilities.append({"ref": self.uid_of[fac.id()]})
            if facilities:
                a["bsi::ifc::system::servicesfacility"] = facilities
            for rel in getattr(system, "IsGroupedBy", ()) or ():
                for member in rel.RelatedObjects:
                    if member.id() in self.uid_of:
                        attrs = self.nodes[self.uid_of[member.id()]]["attributes"]
                        attrs.setdefault("bsi::ifc::system::partofsystem", []).append({"ref": sid})
            root["children"][scope.take(system.Name or f"Unnamed {system.is_a()[3:]}")] = sid
            self.report.entities += 1

    def add_ports(self):
        for port in self.f.by_type("IfcDistributionPort"):
            if port.id() in self.uid_of and port.FlowDirection:
                self.nodes[self.uid_of[port.id()]]["attributes"]["bsi::ifc::system::flowdirection"] = port.FlowDirection
        for rel in self.f.by_type("IfcRelConnectsPorts"):
            pair = (rel.RelatingPort, rel.RelatedPort)
            for a, b in (pair, pair[::-1]):
                if a.id() in self.uid_of and b.id() in self.uid_of:
                    attrs = self.nodes[self.uid_of[a.id()]]["attributes"]
                    attrs.setdefault("bsi::ifc::system::connectsto", []).append({"ref": self.uid_of[b.id()]})

    # --- infrastructure and georeferencing -----------------------------------------------

    def add_alignment_data(self, el, attrs: dict):
        # IfcAlignmentHorizontal / Vertical / Cant: ordered list of their segments
        if el.is_a("IfcLinearElement") and not el.is_a("IfcAlignment"):
            segs = [o for rel in getattr(el, "IsNestedBy", ()) or () for o in rel.RelatedObjects
                    if o.is_a("IfcAlignmentSegment")]
            if segs:
                attrs["bsi::ifc::alignment"] = {"segments": [{"ref": guid_to_uuid(o.GlobalId)} for o in segs]}
        if not el.is_a("IfcAlignmentSegment") or el.DesignParameters is None:
            return
        dp = el.DesignParameters
        fields = SEGMENT_FIELDS.get(dp.is_a())
        if not fields:
            return
        info = {}
        for k in fields:
            # IFC4X3 calls PredefinedType what the IFCX schema calls GeometryType
            v = getattr(dp, "PredefinedType" if k == "GeometryType" else k, None)
            if v is None:
                # optional in IFC but required by the IFCX schema (e.g. right cant): 0
                if k in OPTIONAL_SEGMENT_FIELDS:
                    continue
                v = 0.0
            if isinstance(v, ifcopenshell.entity_instance) and v.is_a("IfcCartesianPoint"):
                c = list(v.Coordinates)
                v = (c + [0.0] * 3)[:3]
            info[k] = v
        ns = "bsi::ifc"
        if info.get("GeometryType") not in IFCX_SEGMENT_TYPES:
            # e.g. PARABOLICARC: valid in IFC4X3 but missing from the IFCX alpha enum. An attribute
            # of our own with the full enum is used so that the file still validates.
            ns = EXTENDED_NS
            self.extended_segments += 1
        attrs[f"{ns}::{dp.is_a()[3:].lower()}"] = info

    def add_linear_reference(self, el, attrs: dict):
        pl = getattr(el, "ObjectPlacement", None)
        if pl is None or not pl.is_a("IfcLinearPlacement"):
            return
        info = {}
        loc = getattr(pl.RelativePlacement, "Location", None)
        if loc is not None and loc.is_a("IfcPointByDistanceExpression"):
            dist = loc.DistanceAlong
            info["Station"] = float(dist.wrappedValue if hasattr(dist, "wrappedValue") else dist[0])
            if loc.OffsetLateral is not None:
                info["OffsetLateral"] = float(loc.OffsetLateral)
            if loc.OffsetVertical is not None:
                info["OffsetVertical"] = float(loc.OffsetVertical)
        cart = getattr(pl, "CartesianPosition", None)
        if cart is not None and cart.Location is not None:
            info["CartesianPoint"] = (list(cart.Location.Coordinates) + [0.0] * 3)[:3]
        if info:
            attrs["bsi::ifc::linearreference"] = info

    def add_georeference(self):
        convs = self.f.by_type("IfcMapConversion") if self.f.schema != "IFC2X3" else []
        if not convs:
            return
        c = convs[0]
        info = {"Eastings": float(c.Eastings), "Northings": float(c.Northings), "OrthogonalHeight": float(c.OrthogonalHeight)}
        for k in ("XAxisAbscissa", "XAxisOrdinate", "Scale"):
            if getattr(c, k, None) is not None:
                info[k] = float(getattr(c, k))
        if c.TargetCRS is not None and c.TargetCRS.Name:
            info["TargetCRS"] = c.TargetCRS.Name
        self.nodes[self.uid_of[self.project.id()]]["attributes"]["bsi::ifc::mapconversion"] = info

    # --- output ------------------------------------------------------------------

    def _orphans(self) -> list[str]:
        missing = [p for p in self.f.by_type("IfcProduct")
                   if p.id() not in self.uid_of and p.id() in self.shapes
                   and not p.is_a("IfcOpeningElement") and not p.is_a("IfcFeatureElementSubtraction")]
        if not missing:
            return []
        sample = ", ".join(f"#{p.id()} {p.is_a()}" for p in missing[:5])
        return [f"{len(missing)} products with geometry outside the spatial tree (not exported): {sample}…"]

    def document(self) -> dict:
        schemas = {k: {"value": v} for k, v in EXTRA_SCHEMAS.items()}
        for k, v in self.props.schemas.items():
            if k not in KNOWN_SCHEMAS:
                schemas[k] = {"value": v}
        used = {k for n in self.nodes.values() for k in n["attributes"]}
        # segments with types that the IFCX alpha schema does not cover (see add_alignment_data)
        for ifc_class in SEGMENT_FIELDS:
            key = f"{EXTENDED_NS}::{ifc_class[3:].lower()}"
            if key in used:
                schemas[key] = {"value": segment_schema(ifc_class)}
        schemas = {k: v for k, v in schemas.items() if k in used}
        for k in used - KNOWN_SCHEMAS - set(schemas):
            self.report.warnings.append(f"Attribute without a schema: {k}")

        fn = self.f.header.file_name
        author = next((a for a in (fn.author or ()) if a), None) or "ifc2ifcx"
        data = []
        for n in self.nodes.values():
            out = {"path": n["path"]}
            for k in ("children", "inherits", "attributes"):
                if n[k]:
                    out[k] = n[k]
            if len(out) > 1:
                data.append(out)
        return {
            "header": {
                "id": self.opt.file_id or "ifc2ifcx",
                "ifcxVersion": "ifcx_alpha",
                "dataVersion": "1.0.0",
                "author": author,
                "timestamp": fn.time_stamp or _dt.datetime.now().isoformat(timespec="seconds"),
            },
            "imports": [{"uri": u} for u in IMPORTS],
            "schemas": schemas,
            "data": data,
        }


def _transform(m: np.ndarray) -> list:
    t = np.round(m.T, 9)  # USD: row vector, translation in the last row
    t[t == 0] = 0.0
    return t.tolist()


def _write_part(attrs: dict, p: Part):
    if p.points:
        attrs["usd::usdgeom::mesh"] = {"faceVertexIndices": p.indices, "points": p.points}
    else:
        attrs["usd::usdgeom::basiscurves"] = {"points": p.polylines[0]}
    if p.color:
        attrs["bsi::ifc::presentation::diffuseColor"] = list(p.color)
        if p.opacity < 1:
            attrs["bsi::ifc::presentation::opacity"] = p.opacity


def _material_name(mat) -> str | None:
    for attr in ("Name", "LayerSetName", "MaterialSetName"):
        v = getattr(mat, attr, None)
        if v:
            return v
    if mat.is_a("IfcMaterialList"):
        return ", ".join(m.Name for m in mat.Materials if m.Name) or None
    return None


def convert_file(src: str, options: Options | None = None) -> tuple[dict, Report]:
    f = ifcopenshell.open(src)
    options = options or Options()
    if not options.file_id:
        options.file_id = os.path.splitext(os.path.basename(src))[0] + ".ifcx"
    c = Converter(f, options)
    return c.run(), c.report

