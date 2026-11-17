// Copies the Revit add-in zip and its sources to dist/descargas/, and writes the manifest that Home reads.
// Usage: npm run addin:web   (after npm run build:web, which empties dist/)
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pickAddin, type ZipFile } from './addin';

const fromZip = process.env.IFCX_ADDIN_ZIP;
const dir = fromZip ? dirname(resolve(fromZip)) : resolve('..', '..', 'revit-ifc', 'Install', 'out');

const files: ZipFile[] = existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const path = join(dir, e.name);
        const stat = statSync(path);
        return { name: e.name, mtimeMs: stat.mtimeMs, size: stat.size };
      })
  : [];

const addin = pickAddin(files);
if (!addin) {
  console.warn(`Add-in: no zip with sources found in ${dir}; the demo will not offer the download`);
} else {
  const out = resolve('dist', 'descargas');
  mkdirSync(out, { recursive: true });
  copyFileSync(join(dir, addin.file), join(out, addin.file));
  copyFileSync(join(dir, addin.source), join(out, addin.source));
  writeFileSync(join(out, 'addin.json'), JSON.stringify(addin));
  console.log(`Add-in ${addin.version}, ${addin.sizeMB} MB`);
}
