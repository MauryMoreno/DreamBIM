// Downloads the three standard IFCx schemas to package them (offline use).
// Uso: node scripts/fetch-schemas.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCHEMAS = {
  'ifc@v5a.ifcx': 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx',
  'prop@v5a.ifcx': 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx',
  'usd@v1.ifcx': 'https://ifcx.dev/@openusd.org/usd@v1.ifcx',
};

const outDir = fileURLToPath(new URL('../src/model/schemas/', import.meta.url));
await mkdir(outDir, { recursive: true });

for (const [name, uri] of Object.entries(SCHEMAS)) {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`${uri}: HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text);
  if (!Array.isArray(json.data)) throw new Error(`${uri}: no es un archivo IFCx válido`);
  await writeFile(outDir + name, text);
  console.log(`${name}: ${text.length} bytes`);
}
