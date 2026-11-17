// Deploys the web demo: builds, copies the project sample, uploads to S3 and clears the CloudFront cache.
// Uso: npm run deploy:web   (la pila de AWS se crea una sola vez; ver deploy/README.md)
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { SAMPLE_DIR } from '../../src/platform/sample-root';
import { checkBuiltBotSource } from './builtbot-guard';
import { uploadPlan } from './upload-plan';

const STACK = process.env.STACK_NAME ?? 'ifcx-studio-demo';
const REGION = 'us-east-1';

const aws = (...args: string[]): string => execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

const outputs = Object.fromEntries(
  (JSON.parse(aws('cloudformation', 'describe-stacks', '--stack-name', STACK, '--query', 'Stacks[0].Outputs', '--output', 'json')) as { OutputKey: string; OutputValue: string }[]).map((o) => [o.OutputKey, o.OutputValue]),
);
const { BucketName: bucket, DistributionId: distribution, DistributionDomain: domain } = outputs;
if (!bucket || !distribution || !domain) throw new Error(`Stack ${STACK} has no BucketName/DistributionId/DistributionDomain outputs`);

// La demo lleva BuiltBot (el Asistente): se compila solo desde un commit conocido de la rama web de chatbot-revit
const chatbot = process.env.IFCX_CHATBOT_DIR ? resolve(process.env.IFCX_CHATBOT_DIR) : resolve('..', '..', 'chatbot-revit');
const git = (...args: string[]): string => execFileSync('git', ['-C', chatbot, ...args], { encoding: 'utf8' }).trim();
const source = checkBuiltBotSource({
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  dirtyFrontend: git('status', '--porcelain', '--', 'frontend').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3)),
  commit: git('rev-parse', '--short', 'HEAD'),
});
if (!source.ok) throw new Error(source.reason);
console.log(`BuiltBot ${source.commit}`);
execSync('npm run sync-builtbot', { stdio: 'inherit' });
execSync('npm run build:web', { stdio: 'inherit' });
execSync('npm run sample:web', { stdio: 'inherit' });
execSync('npm run addin:web', { stdio: 'inherit' });

const files = walk('dist').map((f) => relative('dist', f).split(sep).join('/'));
const sizes = Object.fromEntries(files.map((f) => [f, statSync(join('dist', f)).size]));
const { groups, precompress, unknown } = uploadPlan(files, sizes);
if (unknown.length) throw new Error(`No content type for:\n  ${unknown.join('\n  ')}\nAdd them to CONTENT_TYPES in scripts/web/upload-plan.ts`);

for (const g of groups) {
  aws('s3', 'sync', 'dist', `s3://${bucket}/`, ...g.args, '--content-type', g.contentType, '--cache-control', g.cacheControl, '--delete', '--only-show-errors');
}
// Files over 9 MB are uploaded already compressed: CloudFront would not compress them on the fly (10 MB limit).
const tmp = mkdtempSync(join(tmpdir(), 'ifcx-gz-'));
try {
  for (const p of precompress) {
    const gz = join(tmp, 'file.gz');
    writeFileSync(gz, gzipSync(readFileSync(join('dist', p.file)), { level: 9 }));
    aws('s3', 'cp', gz, `s3://${bucket}/${p.file}`, '--content-type', p.contentType, '--cache-control', p.cacheControl, '--content-encoding', 'gzip', '--only-show-errors');
    console.log(`Uploaded ${p.file} gzip-compressed (${(sizes[p.file] / 1048576).toFixed(1)} MB -> ${(statSync(gz).size / 1048576).toFixed(1)} MB)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
aws('cloudfront', 'create-invalidation', '--distribution-id', distribution, '--paths', '/index.html', `/${encodeURI(SAMPLE_DIR)}/*`, '/descargas/*', '/ocr/*', '/builtbot/*');
console.log(`\nDeployed: ${outputs.SiteUrl ?? `https://${domain}/`}`);
