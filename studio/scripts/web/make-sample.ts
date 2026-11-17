// Copies the project sample to dist/<SAMPLE_DIR>/ (after `npm run build:web`, which empties dist/).
// Uso: npm run sample:web
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SAMPLE_DIR } from '../../src/platform/sample-root';
import { buildSample, type SampleConfig } from './sample';

const cfg = JSON.parse(readFileSync(resolve('deploy/sample.json'), 'utf8')) as SampleConfig;
const result = buildSample(cfg, resolve(cfg.source), resolve('dist', SAMPLE_DIR));

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
let total = 0;
for (const f of result.files) total += readFileSync(resolve(cfg.source, f)).length;
console.log(`Sample: ${result.files.length} files, ${mb(total)} MB (uncompressed) -> dist/${SAMPLE_DIR}`);
for (const t of result.tooBig) console.warn(`Warning: ${t} is larger than ${cfg.maxModelMB} MB`);
if (result.missing.length) {
  console.error(`Missing files (the demo would not load them):\n  ${result.missing.join('\n  ')}`);
  process.exit(1);
}
