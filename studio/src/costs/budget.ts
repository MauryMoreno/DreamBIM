// The budget: each element with a code falls into the item of that code, the item adds the measure of its
// elements times its price, and each heading line adds what hangs from it. An element carries a single code, so it
// counts in a single item and the total is the sum of what each element costs. Pure.
import type { CostCode, CostSystem } from './system';
import { NO_DENSITY, valueOf, type ElementMeasures } from './takeoff';

export const NO_MATCH = 'No elements have this code';

export type Unassigned = 'No code' | 'Code not in the cost system' | 'Code is a heading, not an item';

export interface BudgetNode {
  code: CostCode;
  /** 1 for the roots. */
  level: number;
  /** Composed paths this item measures ([] on a heading line). */
  elements: string[];
  /** Sum of the measure of its elements (0 on a heading line). */
  quantity: number;
  /** Its amount plus that of its children. */
  total: number;
  warning: string | null;
  children: BudgetNode[];
}

export interface Budget {
  currency: string;
  roots: BudgetNode[];
  total: number;
  /** Which item pays each element and how much of its amount falls to it. */
  elementCost: Map<string, { code: string; amount: number }>;
  unassigned: { path: string; reason: Unassigned }[];
}

/**
 * Computes the budget. `elements` are the elements of the model (one per element; if repeated, it counts once),
 * `codeOf` their cost code and `measures` their measures. An element without an item (without a code, with a code the
 * system does not have or that is a heading line) goes to `unassigned`; the `IfcSpace` are not listed.
 */
export function computeBudget(
  system: CostSystem,
  elements: { path: string; cls: string }[],
  codeOf: (path: string) => string | null,
  measures: Map<string, ElementMeasures>,
): Budget {
  const byCode = new Map<string, string[]>();
  const unassigned: Budget['unassigned'] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const code = codeOf(e.path);
    const entry = code === null ? undefined : system.byCode.get(code);
    const reason: Unassigned | null = code === null ? 'No code' : !entry ? 'Code not in the cost system' : !entry.medicion ? 'Code is a heading, not an item' : null;
    if (reason) {
      if (e.cls !== 'IfcSpace') unassigned.push({ path: e.path, reason });
    } else {
      byCode.set(code!, [...(byCode.get(code!) ?? []), e.path]);
    }
  }

  const elementCost = new Map<string, { code: string; amount: number }>();
  const build = (c: CostCode, level: number): BudgetNode => {
    const children = system.children(c.code).map((k) => build(k, level + 1));
    let quantity = 0;
    let own = 0;
    let warning: string | null = null;
    const list = byCode.get(c.code) ?? [];
    if (c.medicion) {
      const { measure } = c.medicion;
      for (const p of list) {
        const m = measures.get(p);
        const v = m ? valueOf(m, measure) : 0;
        quantity += v;
        elementCost.set(p, { code: c.code, amount: v * c.unitPrice });
      }
      own = quantity * c.unitPrice;
      warning = c.warning ?? (!list.length ? NO_MATCH : measure === 'weight' && list.some((p) => measures.get(p)?.weight === null) ? NO_DENSITY : null);
    }
    return { code: c, level, elements: list, quantity, total: own + children.reduce((n, k) => n + k.total, 0), warning, children };
  };
  const roots = system.children(null).map((c) => build(c, 1));
  return { currency: system.currency, roots, total: roots.reduce((n, r) => n + r.total, 0), elementCost, unassigned };
}
