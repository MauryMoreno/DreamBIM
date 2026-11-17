"""IFCX identifiers.

- Entities with a GlobalId use the UUID that encodes that GlobalId (as the official examples do).
- Whatever has no GlobalId (geometry, materials, ...) gets a deterministic UUID v5, derived from the
  GlobalId of the project and a stable key. Converting the same file again gives the same ids.
"""

import re
import uuid

import ifcopenshell.guid


def guid_to_uuid(global_id: str) -> str:
    return str(uuid.UUID(ifcopenshell.guid.expand(global_id)))


class IdFactory:
    def __init__(self, project_global_id: str | None):
        seed = guid_to_uuid(project_global_id) if project_global_id else str(uuid.NAMESPACE_URL)
        self.namespace = uuid.UUID(seed)

    def synthetic(self, *key: object) -> str:
        return str(uuid.uuid5(self.namespace, ":".join(map(str, key))))


_NOT_NAME = re.compile(r"[^A-Za-z0-9]")


def sanitize(name: str) -> str:
    """A name valid as a child key: only [A-Za-z0-9_], as in the official examples."""
    s = _NOT_NAME.sub("_", name.strip())
    return s or "Unnamed"


class NameScope:
    """Makes unique names within one parent: Window, Window_001, Window_002..."""

    def __init__(self):
        self.used: set[str] = set()

    def take(self, name: str) -> str:
        base = sanitize(name)
        candidate, n = base, 0
        while candidate in self.used:
            n += 1
            candidate = f"{base}_{n:03d}"
        self.used.add(candidate)
        return candidate
