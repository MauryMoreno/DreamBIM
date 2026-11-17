// The same rules as the buildingSMART viewer (ifcx-core/schema/schema-validation.ts), which
// rejects the whole file at the first failure. Here nothing is rejected: all of them are gathered as load warnings.
import type { IfcxFile, IfcxSchema, IfcxValueDescription } from '../ifcx/types';

const MISSING = 'Missing schema ';
const INVALID = 'Invalid ';

/** Aviso de un atributo sin esquema o con un valor que no lo cumple. */
export const isSchemaWarning = (w: string): boolean => w.startsWith(MISSING) || w.startsWith(INVALID);

type Schemas = Record<string, IfcxSchema>;

/** Reason why `value` does not satisfy `desc`, or null if it does. */
function check(desc: IfcxValueDescription, value: unknown, schemas: Schemas): string | null {
  if (desc.optional && value === undefined) return null;
  for (const id of desc.inherits ?? []) {
    const parent = schemas[id];
    if (!parent) return `unknown inherited schema "${id}"`;
    const e = check(parent.value, value, schemas);
    if (e) return e;
  }
  switch (desc.dataType) {
    case 'Boolean':
      return typeof value === 'boolean' ? null : 'expected Boolean';
    case 'String':
    case 'DateTime':
    case 'Reference':
      return typeof value === 'string' ? null : `expected ${desc.dataType}`;
    case 'Enum': {
      const options = desc.enumRestrictions?.options ?? [];
      return typeof value === 'string' && options.includes(value) ? null : `expected one of ${options.join(', ')}`;
    }
    case 'Integer':
    case 'Real':
      return typeof value === 'number' ? null : `expected ${desc.dataType}`;
    case 'Object': {
      if (typeof value !== 'object' || value === null) return 'expected Object';
      for (const [key, sub] of Object.entries(desc.objectRestrictions?.values ?? {})) {
        if (!Object.hasOwn(value, key)) {
          if (sub.optional) continue;
          return `missing key "${key}"`;
        }
        const e = check(sub, (value as Record<string, unknown>)[key], schemas);
        if (e) return `${key}: ${e}`;
      }
      return null;
    }
    case 'Array': {
      if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        return numericLeaf(desc) ? null : 'expected Array';
      }
      if (!Array.isArray(value)) return 'expected Array';
      if (!desc.arrayRestrictions) return 'Array schema without arrayRestrictions';
      for (let i = 0; i < value.length; i++) {
        const e = check(desc.arrayRestrictions.value, value[i], schemas);
        if (e) return `[${i}]: ${e}`;
      }
      return null;
    }
    default:
      return `unexpected dataType ${desc.dataType}`;
  }
}

/** Whether the leaf of an array description is numeric (typed arrays stand for those). */
function numericLeaf(desc: IfcxValueDescription): boolean {
  let d = desc;
  while (d.dataType === 'Array' && d.arrayRestrictions) d = d.arrayRestrictions.value;
  return d.dataType === 'Real' || d.dataType === 'Integer';
}

const nodes = (n: number) => `${n} ${n === 1 ? 'node' : 'nodes'}`;

/**
 * Schema warnings of the files of an already resolved stack (layers and imports): the schemas of
 * all count for all, as in the buildingSMART viewer. One per attribute and reason.
 */
export function schemaWarnings(files: readonly IfcxFile[]): string[] {
  const schemas: Schemas = {};
  for (const f of files) Object.assign(schemas, f.schemas ?? {});

  const found = new Map<string, string[]>(); // aviso sin ejemplo -> paths
  const add = (key: string, path: string) => {
    const list = found.get(key);
    if (list) list.push(path);
    else found.set(key, [path]);
  };
  for (const f of files) {
    for (const n of f.data) {
      for (const [id, value] of Object.entries(n.attributes ?? {})) {
        if (id.startsWith('__internal')) continue;
        const schema = schemas[id];
        if (!schema) {
          add(`${MISSING}"${id}"\0`, n.path);
          continue;
        }
        const e = check(schema.value, value, schemas);
        if (e) add(`${INVALID}"${id}"\0${e}`, n.path);
      }
    }
  }
  return [...found].map(([key, paths]) => {
    const [head, reason] = key.split('\0');
    const where = `(${nodes(paths.length)}, e.g. "${paths[0]}")`;
    return reason ? `${head} ${where}: ${reason}` : `${head} ${where}`;
  });
}
