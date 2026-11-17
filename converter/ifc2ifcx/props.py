"""IFC properties and quantities -> bsi::ifc::prop::* attributes with their schema."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.util.element

from .ids import sanitize

PREFIX = "bsi::ifc::prop::"

QUANTITY_KIND = {
    "IfcQuantityLength": "Length",
    "IfcQuantityArea": "Area",
    "IfcQuantityVolume": "Volume",
    "IfcQuantityWeight": "Mass",
    "IfcQuantityTime": "Time",
}

MEASURE_KIND = {
    "IfcLengthMeasure": "Length",
    "IfcPositiveLengthMeasure": "Length",
    "IfcNonNegativeLengthMeasure": "Length",
    "IfcAreaMeasure": "Area",
    "IfcVolumeMeasure": "Volume",
}


def _plain(value):
    """Turns an IfcOpenShell value into plain JSON (or None if it cannot be represented)."""
    if value is None:
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        items = [_plain(v) for v in value]
        items = [v for v in items if v is not None]
        if not items:
            return None
        return items[0] if len(items) == 1 else items
    if isinstance(value, ifcopenshell.entity_instance):
        # typed values (IfcLabel('x')) arrive wrapped
        if value.is_a() and len(value) == 1 and not isinstance(value[0], ifcopenshell.entity_instance):
            return _plain(value[0])
        return None
    return None


def data_type(value) -> dict:
    if isinstance(value, bool):
        return {"dataType": "Boolean"}
    if isinstance(value, int):
        return {"dataType": "Integer"}
    if isinstance(value, float):
        return {"dataType": "Real"}
    if isinstance(value, list):
        inner = data_type(value[0]) if value else {"dataType": "String"}
        return {"dataType": "Array", "arrayRestrictions": {"value": inner}}
    return {"dataType": "String"}


class PropertyCollector:
    def __init__(self, f: ifcopenshell.file, scale: float):
        self.f = f
        self.scale = scale
        self.schemas: dict[str, dict] = {}
        self.conflicts = 0

    def _put(self, attrs: dict, name: str, value, kind: str | None = None):
        value = _plain(value)
        if value is None:
            return
        key = PREFIX + sanitize(name)
        if kind in ("Length",) and isinstance(value, (int, float)) and not isinstance(value, bool):
            value = float(value) * self.scale
        elif kind == "Area" and isinstance(value, (int, float)):
            value = float(value) * self.scale ** 2
        elif kind == "Volume" and isinstance(value, (int, float)):
            value = float(value) * self.scale ** 3
        if key in attrs and attrs[key] != value:
            self.conflicts += 1
        attrs[key] = value
        desc = data_type(value)
        if kind and desc["dataType"] in ("Real", "Integer"):
            desc = {"dataType": "Real", "quantityKind": kind}
            if isinstance(value, int):
                attrs[key] = float(value)
        prev = self.schemas.get(key)
        # if the same name appears with different types, it is declared as a String
        if prev and prev.get("dataType") != desc.get("dataType"):
            desc = {"dataType": "String"}
            attrs[key] = str(attrs[key])
        self.schemas[key] = desc

    def collect(self, el: ifcopenshell.entity_instance) -> dict:
        """The property attributes of the element itself (without those inherited from its type)."""
        attrs: dict = {}
        if getattr(el, "Name", None):
            self._put(attrs, "Name", el.Name)
        if getattr(el, "Description", None):
            self._put(attrs, "Description", el.Description)

        for pdef in self._definitions(el):
            if pdef.is_a("IfcPropertySet"):
                for p in pdef.HasProperties or ():
                    self._property(attrs, p)
            elif pdef.is_a("IfcElementQuantity"):
                for q in pdef.Quantities or ():
                    if q.is_a() in QUANTITY_KIND or q.is_a("IfcQuantityCount"):
                        self._put(attrs, q.Name, q[3], QUANTITY_KIND.get(q.is_a()))
        return attrs

    def _definitions(self, el):
        if el.is_a("IfcTypeObject"):
            return list(el.HasPropertySets or ())
        out = []
        for rel in getattr(el, "IsDefinedBy", ()) or ():
            if rel.is_a("IfcRelDefinesByProperties"):
                d = rel.RelatingPropertyDefinition
                out.extend(d if isinstance(d, tuple) else [d])
        return out

    def _property(self, attrs: dict, p):
        if p.is_a("IfcPropertySingleValue"):
            v = p.NominalValue
            kind = MEASURE_KIND.get(v.is_a()) if isinstance(v, ifcopenshell.entity_instance) else None
            self._put(attrs, p.Name, v, kind)
        elif p.is_a("IfcPropertyEnumeratedValue"):
            self._put(attrs, p.Name, p.EnumerationValues)
        elif p.is_a("IfcPropertyListValue"):
            self._put(attrs, p.Name, p.ListValues)
        elif p.is_a("IfcPropertyBoundedValue"):
            v = p.SetPointValue or p.UpperBoundValue or p.LowerBoundValue
            self._put(attrs, p.Name, v)
