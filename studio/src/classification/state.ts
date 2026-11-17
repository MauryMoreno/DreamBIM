// Classification of the elements (OmniClass table 21) of previous versions: it was stored in
// `<model>.classification.ifcx` and, in the cards, as `studio::classification::omniclass-21`. Now the code is
// an item of the table that the element inherits (see nodes.ts); this is only read, to migrate it.
import type { IfcxFile } from '../ifcx/types';

export interface ClassAssign {
  code: string;
  title: string;
}

/** Previous key of the code on an element or on a card: `{ code, title }`. */
export const K_ASSIGN_21 = 'studio::classification::omniclass-21';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Edit path → code, from a previous `*.classification.ifcx`. What it does not understand is skipped. */
export function readLegacyClassification(file: IfcxFile): Record<string, ClassAssign> {
  const assign: Record<string, ClassAssign> = {};
  for (const n of file.data ?? []) {
    const v = n.attributes?.[K_ASSIGN_21];
    if (isObject(v) && typeof v.code === 'string' && typeof n.path === 'string') {
      assign[n.path] = { code: v.code, title: typeof v.title === 'string' ? v.title : '' };
    }
  }
  return assign;
}
