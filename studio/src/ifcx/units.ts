import type { IfcxSchema } from './types';

const UNIT: Record<string, string> = {
  Length: 'm',
  Area: 'm²',
  Volume: 'm³',
  Mass: 'kg',
  Time: 's',
  'Plane angle': 'rad',
  'Thermodynamic temperature': 'K',
  Pressure: 'Pa',
  Force: 'N',
  Energy: 'J',
  Power: 'W',
};

/** Unidad SI para un atributo, si su esquema declara quantityKind. */
export function unitFor(attr: string, schemas: Record<string, IfcxSchema>): string | null {
  const kind = schemas[attr]?.value?.quantityKind;
  if (!kind) return null;
  return UNIT[kind] ?? kind;
}
