"""Tessellation with IfcOpenShell and conversion to USD meshes / curves."""

from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass, field

import ifcopenshell
import ifcopenshell.geom
import numpy as np

DECIMALS = 6  # 1 µm: enough for BIM, and it makes the JSON much smaller


@dataclass
class Part:
    """A piece of geometry with a single material."""

    material: str | None
    color: tuple[float, float, float] | None
    opacity: float
    points: list | None = None  # mesh
    indices: list | None = None
    polylines: list | None = None  # curves


@dataclass
class Shape:
    context: str
    geometry_id: str
    matrix: np.ndarray  # world, column-vector convention, in metres
    parts: list[Part] = field(default_factory=list)

    @property
    def is_mesh(self) -> bool:
        return any(p.points for p in self.parts)


# (linear deflection in m, angular deflection in rad, segments per circle; 0 = automatic)
DETAIL = {
    "low": (0.02, 1.0, 8),
    "medium": (0.005, 0.5, 16),
    "high": (0.001, 0.5, 0),
}


def make_settings(detail: str = "medium") -> ifcopenshell.geom.settings:
    s = ifcopenshell.geom.settings()
    s.set("dimensionality", ifcopenshell.ifcopenshell_wrapper.CURVES_SURFACES_AND_SOLIDS)
    s.set("weld-vertices", False)
    s.set("use-world-coords", False)
    s.set("apply-default-materials", True)
    linear, angular, circle = DETAIL[detail]
    s.set("mesher-linear-deflection", linear)
    s.set("mesher-angular-deflection", angular)
    if circle:
        s.set("circle-segments", circle)
    return s


def digest(shape: "Shape") -> str:
    """Fingerprint of the content: geometries identical in local coordinates share a node."""
    h = hashlib.sha1(shape.context.encode())
    for p in shape.parts:
        h.update(repr((p.material, p.color, p.opacity)).encode())
        if p.points:
            h.update(np.asarray(p.points, dtype=np.float64).tobytes())
            h.update(np.asarray(p.indices, dtype=np.int64).tobytes())
        for line in p.polylines or ():
            h.update(np.asarray(line, dtype=np.float64).tobytes())
    return h.hexdigest()


def _round(values: np.ndarray) -> list:
    out = np.round(values, DECIMALS)
    out[out == 0] = 0.0  # avoids "-0.0"
    return out.tolist()


def _color(m) -> tuple[tuple[float, float, float] | None, float]:
    try:
        d = m.diffuse
        rgb = (round(d.r(), 4), round(d.g(), 4), round(d.b(), 4))
    except Exception:  # noqa: BLE001 - material without a diffuse colour
        rgb = None
    t = getattr(m, "transparency", 0.0)
    if t is None or (isinstance(t, float) and math.isnan(t)):
        t = 0.0
    return rgb, round(1.0 - float(t), 4)


def _chain_edges(verts: np.ndarray, edges: np.ndarray) -> list[list]:
    """Chains loose edges into polylines (welding coincident vertices)."""
    if not len(edges):
        return []
    rounded = np.round(verts, DECIMALS)
    uniq, inv = np.unique(rounded, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    segs = [(int(inv[a]), int(inv[b])) for a, b in edges if inv[a] != inv[b]]
    adj: dict[int, list[int]] = {}
    for i, (a, b) in enumerate(segs):
        adj.setdefault(a, []).append(i)
        adj.setdefault(b, []).append(i)
    used = [False] * len(segs)
    lines = []

    def walk(start: int) -> list[int]:
        path = [start]
        cur = start
        while True:
            nxt = next((i for i in adj.get(cur, []) if not used[i]), None)
            if nxt is None:
                return path
            used[nxt] = True
            a, b = segs[nxt]
            cur = b if a == cur else a
            path.append(cur)

    # start from the ends (odd degree) to get long polylines
    starts = [v for v, es in adj.items() if len(es) % 2 == 1] + list(adj.keys())
    for v in starts:
        if any(not used[i] for i in adj[v]):
            path = walk(v)
            if len(path) > 1:
                lines.append(_round(uniq[path]))
    return lines


def swept_disk_axes(product, scale: float, settings=None) -> list[list] | None:
    """Axes (directrices) of a product whose Body is made only of IfcSweptDiskSolid.

    Returns polylines in the local coordinates of the product, or None if the Body contains
    anything else (the normal mesh is used then).
    """
    import ifcopenshell.util.placement as up

    rep = next((r for r in getattr(product.Representation, "Representations", ()) or ()
                if r.RepresentationIdentifier == "Body"), None)
    if rep is None:
        return None
    settings = settings or ifcopenshell.geom.settings()
    lines: list[list] = []

    def visit(items, m: np.ndarray) -> bool:
        for it in items:
            if it.is_a("IfcMappedItem"):
                t = np.array(up.get_mappeditem_transformation(it), dtype=float)
                t[:3, 3] *= scale
                if not visit(it.MappingSource.MappedRepresentation.Items, m @ t):
                    return False
            elif it.is_a("IfcSweptDiskSolid"):
                g = ifcopenshell.geom.create_shape(settings, it.Directrix)
                v = np.array(g.verts, dtype=float).reshape(-1, 3)
                e = np.array(g.edges, dtype=np.int64).reshape(-1, 2)
                if not len(v):
                    return False
                v = (np.c_[v, np.ones(len(v))] @ m.T)[:, :3]
                lines.extend(_chain_edges(v, e))
            else:
                return False
        return True

    try:
        return lines if visit(rep.Items, np.eye(4)) and lines else None
    except Exception:  # noqa: BLE001 - curve cannot be evaluated: the mesh is used
        return None


def fix_angle_unit(f: ifcopenshell.file) -> bool:
    """Completes the Revit angle unit so that IfcOpenShell reads it as degrees. Returns whether it changed it.

    Revit writes the degree as an IfcConversionBasedUnit with the factor 0.01745… in an IfcMeasureWithUnit
    without a UnitComponent. Without it, IfcOpenShell 0.9 takes the angles as radians: an elbow trimmed
    from 270 to 360 (degrees) comes out spinning, as a whole torus or three quarters of one. It is
    completed with the SI radian.
    """
    touched = False
    for u in f.by_type("IfcConversionBasedUnit"):
        m = u.ConversionFactor
        if u.UnitType == "PLANEANGLEUNIT" and m is not None and m.UnitComponent is None:
            m.UnitComponent = f.createIfcSIUnit(None, "PLANEANGLEUNIT", None, "RADIAN")
            touched = True
    return touched


def tessellate(f: ifcopenshell.file, settings=None, threads: int | None = None) -> tuple[dict[int, list[Shape]], list[str]]:
    """Returns {product_step_id: [Shape...]} and the list of warnings."""
    settings = settings or make_settings()
    shapes: dict[int, list[Shape]] = {}
    warnings: list[str] = []
    fix_angle_unit(f)
    it = ifcopenshell.geom.iterator(settings, f, threads or max(1, (os.cpu_count() or 2) - 1))
    if not it.initialize():
        return shapes, ["No geometry to tessellate was found"]
    while True:
        sh = it.get()
        try:
            shapes.setdefault(sh.id, []).append(_convert(sh))
        except Exception as e:  # noqa: BLE001
            warnings.append(f"#{sh.id}: geometry not converted ({e})")
        if not it.next():
            break
    return shapes, warnings


def _convert(sh) -> Shape:
    g = sh.geometry
    m = np.array(sh.transformation.matrix, dtype=float).reshape(4, 4).T  # to column vectors
    verts = np.array(g.verts, dtype=float).reshape(-1, 3)
    faces = np.array(g.faces, dtype=np.int64).reshape(-1, 3)
    edges = np.array(g.edges, dtype=np.int64).reshape(-1, 2)
    mats = list(g.materials)
    shape = Shape(context=sh.context or "Body", geometry_id=str(g.id), matrix=m)

    if len(faces):
        mat_ids = np.array(g.material_ids, dtype=np.int64) if len(g.material_ids) == len(faces) else np.full(len(faces), -1)
        for mid in sorted(set(mat_ids.tolist())):
            sel = faces[mat_ids == mid]
            used, remap = np.unique(sel.reshape(-1), return_inverse=True)
            mat = mats[mid] if 0 <= mid < len(mats) else None
            rgb, opacity = _color(mat) if mat is not None else (None, 1.0)
            shape.parts.append(Part(
                material=getattr(mat, "name", None) if mat is not None else None,
                color=rgb,
                opacity=opacity,
                points=_round(verts[used]),
                indices=remap.reshape(-1).tolist(),
            ))
    elif len(edges):
        mat = mats[0] if mats else None
        rgb, opacity = _color(mat) if mat is not None else (None, 1.0)
        shape.parts.append(Part(material=None, color=rgb, opacity=opacity, polylines=_chain_edges(verts, edges)))
    return shape
