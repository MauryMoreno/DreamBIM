// How dist/ is uploaded to S3: explicit content type and cache by extension. S3 does not know `.ifcx` and would
// serve it as binary, and CloudFront only compresses text types: without this the models would download uncompressed.

export const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ifcx': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.gz': 'application/gzip',
  '.txt': 'text/plain',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
};

/** Those CloudFront would compress on the fly (text); the others already come compressed or do not benefit. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.ifcx', '.wasm', '.svg', '.txt', '.md']);

/** CloudFront only compresses on the fly up to 10 000 000 bytes: anything bigger is uploaded already compressed (gzip). */
export const PRECOMPRESS_ABOVE = 9_000_000;

/** La interfaz de BuiltBot (el Asistente) dentro de dist/: su HTML no se cachea y lo de `_next/static` lleva hash. */
const BUILTBOT = 'builtbot/';
const BUILTBOT_STATIC = 'builtbot/_next/static/';

const CACHE = {
  index: 'no-cache',
  assets: 'public,max-age=31536000,immutable', // nombres con hash de Vite
  static: 'public,max-age=300',
} as const;

type Kind = 'index' | 'assets' | 'bbhtml' | 'bbstatic' | 'static';
const CACHE_OF: Record<Kind, string> = {
  index: CACHE.index,
  bbhtml: CACHE.index,
  assets: CACHE.assets,
  bbstatic: CACHE.assets, // Next les pone hash al nombre, como Vite a assets/
  static: CACHE.static,
};

export interface UploadGroup {
  contentType: string;
  cacheControl: string;
  /** Filters of `aws s3 sync` (order matters: the last ones win). */
  args: string[];
}

/** Un archivo grande que se sube aparte, comprimido con gzip y con `Content-Encoding: gzip`. */
export interface Precompressed {
  file: string;
  contentType: string;
  cacheControl: string;
}

const extOf = (f: string): string => f.slice(f.lastIndexOf('.')).toLowerCase();

export function uploadPlan(
  files: string[],
  sizes: Record<string, number> = {},
): { groups: UploadGroup[]; precompress: Precompressed[]; unknown: string[] } {
  const groups = new Map<string, UploadGroup>();
  const precompress: Precompressed[] = [];
  const unknown: string[] = [];
  for (const f of files) {
    const ext = extOf(f);
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) {
      unknown.push(f);
      continue;
    }
    const kind: Kind =
      f === 'index.html'
        ? 'index'
        : f.startsWith('assets/')
          ? 'assets'
          : f.startsWith(BUILTBOT_STATIC)
            ? 'bbstatic'
            : f.startsWith(BUILTBOT) && ext === '.html'
              ? 'bbhtml'
              : 'static';
    const key = `${kind}|${ext}`;
    if (!groups.has(key)) {
      const args =
        kind === 'index'
          ? ['--exclude', '*', '--include', 'index.html']
          : kind === 'assets'
            ? ['--exclude', '*', '--include', `assets/*${ext}`]
            : kind === 'bbstatic'
              ? ['--exclude', '*', '--include', `${BUILTBOT_STATIC}*${ext}`]
              : kind === 'bbhtml'
                ? ['--exclude', '*', '--include', `${BUILTBOT}*.html`]
                : ['--exclude', '*', '--include', `*${ext}`, '--exclude', 'assets/*', '--exclude', 'index.html', '--exclude', `${BUILTBOT_STATIC}*`, '--exclude', `${BUILTBOT}*.html`];
      groups.set(key, { contentType, cacheControl: CACHE_OF[kind], args });
    }
    if (COMPRESSIBLE.has(ext) && (sizes[f] ?? 0) > PRECOMPRESS_ABOVE) {
      precompress.push({ file: f, contentType, cacheControl: CACHE_OF[kind] });
      groups.get(key)!.args.push('--exclude', f); // at the end: the last filters win
    }
  }
  return { groups: [...groups.values()], precompress, unknown };
}
