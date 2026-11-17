import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { SAMPLE_DIR } from './src/platform/sample-root';

const require = createRequire(import.meta.url);

/**
 * The OCR files (Tesseract): the worker, the engine and the languages, in the fixed `ocr/` folder of the app, so that
 * nothing is downloaded from the internet. In development they are served from node_modules; when building they are copied.
 */
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'spa.traineddata.gz': '@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

function ocrFiles(): Plugin {
  const source = (name: string) => require.resolve(OCR_FILES[name]);
  return {
    name: 'ifcx-ocr-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([^/?]+)/.exec(req.url ?? '');
        if (!m || !OCR_FILES[m[1]]) return next();
        res.setHeader('Content-Type', m[1].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(source(m[1])));
      });
    },
    generateBundle() {
      for (const name of Object.keys(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(source(name)) });
    },
  };
}

/**
 * In development (`vite --mode web`), the example project is served from the sample that
 * `npm run sample:web` generates in dist/. A link in public/ is not used: `vite build` empties dist/ and would break it.
 */
function sampleFiles(): Plugin {
  const root = resolve('dist', SAMPLE_DIR);
  const prefix = `/${SAMPLE_DIR}/`;
  return {
    name: 'ifcx-sample-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let path: string;
        try {
          path = decodeURIComponent((req.url ?? '').split('?')[0]);
        } catch {
          return next();
        }
        if (!path.startsWith(prefix)) return next();
        const file = resolve(root, path.slice(prefix.length));
        if (!file.startsWith(root + sep)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          res.statusCode = 404;
          return res.end(`Not in the sample (run npm run sample:web): ${path}`);
        }
        if (/\.(ifcx|json)$/i.test(file)) res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  resolve: { dedupe: ['three'] },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // the 3D engine libraries change rarely: their own chunks are cached across app releases
        manualChunks: (id) => (/node_modules[\/](three|three-mesh-bvh)[\/]/.test(id) ? 'three' : undefined),
      },
    },
  },
  plugins: [ocrFiles(), sampleFiles()],
});
