import os

import ifcopenshell
import ifcopenshell.api
import numpy as np
import pytest

from ifc2ifcx import Converter, Options, convert_file
from ifc2ifcx.ids import NameScope, guid_to_uuid, sanitize
from ifc2ifcx.props import data_type

EXAMPLES = os.path.join(os.path.dirname(__file__), "..", "..", "References", "IFC5-development-main",
                        "IFC5-development-main", "examples")
HELLO_WALL = os.path.join(EXAMPLES, "Hello Wall", "hello-wall.ifc")


def merged(doc):
    """path -> node (converters may repeat paths; here they are merged)."""
    out = {}
    for n in doc["data"]:
        m = out.setdefault(n["path"], {"children": {}, "inherits": {}, "attributes": {}})
        for k in ("children", "inherits", "attributes"):
            m[k].update(n.get(k, {}))
    return out


# --- units ----------------------------------------------------------------------

def test_guid_to_uuid_matches_official_example():
    assert guid_to_uuid("0KhR8hr7H8eewFRKm6V1bJ") == "14adb22b-d474-48a2-8e8f-6d4c067c1953"


def test_sanitize_and_unique_names():
    assert sanitize("My Site") == "My_Site"
    assert sanitize("  ") == "Unnamed"
    scope = NameScope()
    assert [scope.take("Window") for _ in range(3)] == ["Window", "Window_001", "Window_002"]


@pytest.mark.parametrize("value,expected", [
    (True, "Boolean"), (3, "Integer"), (2.5, "Real"), ("x", "String"), ([1.0, 2.0], "Array"),
])
def test_data_type(value, expected):
    assert data_type(value)["dataType"] == expected


# --- synthetic model --------------------------------------------------------------

@pytest.fixture
def small_model():
    f = ifcopenshell.api.run("project.create_file", version="IFC4")
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="P")
    ifcopenshell.api.run("unit.assign_unit", f)  # millimetres by default
    ctx = ifcopenshell.api.run("context.add_context", f, context_type="Model")
    body = ifcopenshell.api.run("context.add_context", f, context_type="Model", context_identifier="Body",
                                target_view="MODEL_VIEW", parent=ctx)
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="My Site")
    storey = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="L0")
    ifcopenshell.api.run("aggregate.assign_object", f, products=[site], relating_object=project)
    ifcopenshell.api.run("aggregate.assign_object", f, products=[storey], relating_object=site)

    wtype = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcWallType", name="WT")
    walls = []
    for i in range(2):
        w = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcWall", name="Wall")
        ifcopenshell.api.run("spatial.assign_container", f, products=[w], relating_structure=storey)
        ifcopenshell.api.run("type.assign_type", f, related_objects=[w], relating_type=wtype)
        rep = ifcopenshell.api.run("geometry.add_wall_representation", f, context=body, length=5.0, height=3.0, thickness=0.2)  # the API uses SI units
        ifcopenshell.api.run("geometry.assign_representation", f, product=w, representation=rep)
        ifcopenshell.api.run("geometry.edit_object_placement", f, product=w)
        walls.append(w)
    mat = np.eye(4)
    mat[0, 3] = 10.0  # metres (the API converts to the project units, mm)
    ifcopenshell.api.run("geometry.edit_object_placement", f, product=walls[1], matrix=mat)

    pset = ifcopenshell.api.run("pset.add_pset", f, product=walls[0], name="Pset_WallCommon")
    ifcopenshell.api.run("pset.edit_pset", f, pset=pset, properties={"IsExternal": True, "FireRating": "REI60"})
    concrete = ifcopenshell.api.run("material.add_material", f, name="CONCRETE")
    ifcopenshell.api.run("material.assign_material", f, products=walls, material=concrete)
    return f, walls, wtype


def test_structure_types_materials_and_props(small_model):
    f, walls, wtype = small_model
    doc = Converter(f, Options(file_id="t.ifcx")).run()
    nodes = merged(doc)

    w0, w1 = (guid_to_uuid(w.GlobalId) for w in walls)
    storey = nodes[guid_to_uuid(f.by_type("IfcBuildingStorey")[0].GlobalId)]
    assert set(storey["children"].values()) == {w0, w1}
    assert sorted(storey["children"]) == ["Wall", "Wall_001"]

    a0 = nodes[w0]["attributes"]
    assert a0["bsi::ifc::class"]["code"] == "IfcWall"
    assert a0["bsi::ifc::prop::IsExternal"] is True
    assert a0["bsi::ifc::prop::FireRating"] == "REI60"
    assert doc["schemas"]["bsi::ifc::prop::FireRating"]["value"]["dataType"] == "String"
    assert "bsi::ifc::prop::IsExternal" not in doc["schemas"]  # prop@v5a already defines it

    # type and material as inheritance
    tid = nodes[w0]["inherits"]["type"]
    assert tid == guid_to_uuid(wtype.GlobalId)
    assert nodes[tid]["attributes"]["bsi::ifc::class"]["code"] == "IfcWall"
    mid = nodes[w0]["inherits"]["material"]
    assert nodes[mid]["attributes"]["bsi::ifc::material"]["code"] == "CONCRETE"

    # identical geometry in local coordinates: a single shared node
    assert nodes[w0]["children"]["Body"] == nodes[w1]["children"]["Body"]
    mesh = nodes[nodes[w0]["children"]["Body"]]["attributes"]["usd::usdgeom::mesh"]
    xs = [p[0] for p in mesh["points"]]
    assert max(xs) - min(xs) == pytest.approx(5.0)  # in metres although the file is in mm

    # translation relative to the parent, in metres, bottom row (USD convention)
    t = nodes[w1]["attributes"]["usd::xformop"]["transform"]
    assert t[3][:3] == pytest.approx([10.0, 0.0, 0.0])


def test_reconversion_is_deterministic(small_model):
    f, _, _ = small_model
    a = Converter(f, Options(file_id="t")).run()
    b = Converter(f, Options(file_id="t")).run()
    assert a == b


def test_no_step_data_option(small_model):
    f, _, _ = small_model
    doc = Converter(f, Options(step_data=False)).run()
    assert not any("customdata" in n.get("attributes", {}) for n in doc["data"])
    assert "customdata" not in doc["schemas"]


# --- official example -----------------------------------------------------------

@pytest.mark.skipif(not os.path.exists(HELLO_WALL), reason="References folder not available")
def test_hello_wall_matches_official_tree():
    doc, report = convert_file(HELLO_WALL)
    nodes = merged(doc)
    # same paths and names as the official hello-wall.ifcx
    assert nodes["14adb22b-d474-48a2-8e8f-6d4c067c1953"]["children"] == {"My_Site": "e0834921-e095-40f0-8874-3c6bd1ec699e"}
    storey = nodes["44af358b-3160-4063-8a89-a868335ff3b5"]
    assert storey["children"] == {"My_Space": "e3035b71-bd9f-4cdc-86fd-b56e2f4605b6",
                                  "Wall": "93791d5d-5beb-437b-b8ec-2f1f0ba4bf3b"}
    wall = nodes["93791d5d-5beb-437b-b8ec-2f1f0ba4bf3b"]
    assert {"Window", "Window_001", "Body", "Axis"} <= set(wall["children"])
    window = nodes[wall["children"]["Window"]]
    assert window["attributes"]["usd::xformop"]["transform"][3][:3] == pytest.approx([1.76767492294312, 0, 1])
    # both windows share type and geometry
    w2 = nodes[wall["children"]["Window_001"]]
    assert window["inherits"]["type"] == w2["inherits"]["type"] == "25503984-6605-43a1-8597-eae657ff5bea"
    assert window["children"]["Body"] == w2["children"]["Body"]
    assert report.warnings == []


# --- elbows swept along an arc (IfcSurfaceCurveSweptAreaSolid) ------------------------

def elbow_file(offset: float, sense: bool = True):
    """IFC with angles in degrees and an elbow like the Revit one: a circular profile (r = 0.1, shifted
    `offset` along its X) swept along a quarter circle of radius 0.5, trimmed from 270 to 360. As in Revit,
    the degree factor does not say which unit it is in (IfcMeasureWithUnit without UnitComponent)."""
    f = ifcopenshell.file(schema="IFC4X3_ADD2")  # like the Revit IFC
    pt = lambda *c: f.createIfcCartesianPoint([float(v) for v in c])
    d3 = lambda *c: f.createIfcDirection([float(v) for v in c])
    origin = f.createIfcAxis2Placement3D(pt(0, 0, 0), None, None)
    metre = f.createIfcSIUnit(None, "LENGTHUNIT", None, "METRE")
    degree = f.createIfcConversionBasedUnit(
        f.createIfcDimensionalExponents(0, 0, 0, 0, 0, 0, 0), "PLANEANGLEUNIT", "DEGREE",
        f.createIfcMeasureWithUnit(f.createIfcPlaneAngleMeasure(0.017453292519943295), None))
    ctx = f.createIfcGeometricRepresentationContext(None, "Model", 3, 1e-5, origin, None)
    body = f.createIfcGeometricRepresentationSubContext("Body", "Model", None, None, None, None, ctx, None, "MODEL_VIEW", None)
    f.createIfcProject(ifcopenshell.guid.new(), None, "P", None, None, None, None, [ctx],
                       f.createIfcUnitAssignment([metre, degree]))
    circle = f.createIfcCircle(f.createIfcAxis2Placement2D(f.createIfcCartesianPoint([0.0, 0.0]), None), 0.5)
    # the same quarter turn, from 270 to 360 forwards or from 360 to 270 backwards
    t1, t2 = (270.0, 360.0) if sense else (360.0, 270.0)
    arc = f.createIfcTrimmedCurve(circle, [f.createIfcParameterValue(t1)], [f.createIfcParameterValue(t2)],
                                  sense, "PARAMETER")
    surface = f.createIfcSurfaceOfLinearExtrusion(
        f.createIfcArbitraryOpenProfileDef("CURVE", None, arc),
        f.createIfcAxis2Placement3D(pt(0, 0, -1), None, None), d3(0, 0, 1), 2.0)
    profile = f.createIfcCircleProfileDef("AREA", None, f.createIfcAxis2Placement2D(
        f.createIfcCartesianPoint([offset, 0.0]), None), 0.1)
    solid = f.createIfcSurfaceCurveSweptAreaSolid(profile, origin, arc, f.createIfcParameterValue(0.0),
                                                  f.createIfcParameterValue(90.0), surface)
    shape = f.createIfcProductDefinitionShape(None, None, [f.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])])
    elbow = f.createIfcBuildingElementProxy(ifcopenshell.guid.new(), None, "Elbow", None, None,
                                            f.createIfcLocalPlacement(None, origin), shape, None, None)
    return f, elbow


@pytest.mark.parametrize("offset, sense", [(0.0, True), (0.05, True), (0.0, False)])
def test_curved_sweep_is_a_quarter_turn(offset, sense):
    """The arc goes from 270° to 360°: the axis of the tube (radius 0.5 + offset) makes a quarter turn
    between (0, −R) and (R, 0). Without completing the degree unit, IfcOpenShell draws it spinning."""
    from ifc2ifcx.geometry import fix_angle_unit, tessellate
    f, elbow = elbow_file(offset, sense)
    shapes, warnings = tessellate(f, threads=1)
    assert fix_angle_unit(f) is False  # already completed
    assert warnings == []
    pts = np.array([p for s in shapes[elbow.id()] for part in s.parts for p in part.points])
    R, r = 0.5 + offset, 0.1
    # the caps are perpendicular to the arc: the elbow starts at x = 0 and ends at y = 0
    assert pts.min(axis=0) == pytest.approx([0, -R - r, -r], abs=0.01)
    assert pts.max(axis=0) == pytest.approx([R + r, 0, r], abs=0.01)
