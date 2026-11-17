// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { uploadPlan } from '../scripts/web/upload-plan';

const find = (groups: ReturnType<typeof uploadPlan>['groups'], contentType: string, cacheControl: string) =>
  groups.find((g) => g.contentType === contentType && g.cacheControl === cacheControl);

describe('uploadPlan', () => {
  it('the .ifcx models are uploaded as application/json (CloudFront only compresses text types)', () => {
    const { groups, unknown } = uploadPlan(['proyecto/01_WIP/EST/m.ifcx']);
    expect(unknown).toEqual([]);
    expect(find(groups, 'application/json', 'public,max-age=300')?.args).toEqual([
      '--exclude', '*', '--include', '*.ifcx', '--exclude', 'assets/*', '--exclude', 'index.html',
      '--exclude', 'builtbot/_next/static/*', '--exclude', 'builtbot/*.html',
    ]);
  });

  it('assets/ carries a one-year immutable cache and its explicit type', () => {
    const { groups } = uploadPlan(['assets/index-abc.js', 'assets/index-abc.css']);
    expect(find(groups, 'text/javascript', 'public,max-age=31536000,immutable')?.args).toEqual(['--exclude', '*', '--include', 'assets/*.js']);
    expect(find(groups, 'text/css', 'public,max-age=31536000,immutable')).toBeDefined();
  });

  it('el worker de PDF (.mjs) se sirve como JavaScript, o el navegador no lo ejecuta', () => {
    const { groups, unknown } = uploadPlan(['assets/pdf.worker.min-abc.mjs']);
    expect(unknown).toEqual([]);
    expect(find(groups, 'text/javascript', 'public,max-age=31536000,immutable')?.args).toEqual(['--exclude', '*', '--include', 'assets/*.mjs']);
  });

  it('a text file of more than 9 MB is precompressed and excluded from the normal sync (CloudFront does not compress beyond 10 MB)', () => {
    const sizes = { 'proyecto/grande.ifcx': 64_000_000, 'proyecto/a.ifcx': 100 };
    const { groups, precompress } = uploadPlan(['proyecto/a.ifcx', 'proyecto/grande.ifcx'], sizes);
    expect(precompress).toEqual([{ file: 'proyecto/grande.ifcx', contentType: 'application/json', cacheControl: 'public,max-age=300' }]);
    expect(find(groups, 'application/json', 'public,max-age=300')?.args.slice(-2)).toEqual(['--exclude', 'proyecto/grande.ifcx']);
  });

  it('un archivo grande ya comprimido (.gz, .png) no se precomprime', () => {
    const { precompress, groups } = uploadPlan(['ocr/x.traineddata.gz'], { 'ocr/x.traineddata.gz': 20_000_000 });
    expect(precompress).toEqual([]);
    expect(find(groups, 'application/gzip', 'public,max-age=300')?.args).not.toContain('ocr/x.traineddata.gz');
  });

  it('without sizes, nothing is precompressed', () => {
    expect(uploadPlan(['proyecto/a.ifcx']).precompress).toEqual([]);
  });

  it('index.html no se cachea', () => {
    const { groups } = uploadPlan(['index.html']);
    expect(find(groups, 'text/html', 'no-cache')?.args).toEqual(['--exclude', '*', '--include', 'index.html']);
  });

  it('an extension without a known type is reported instead of being uploaded with a guessed type', () => {
    expect(uploadPlan(['assets/a.js', 'ocr/raro.xyz']).unknown).toEqual(['ocr/raro.xyz']);
  });

  it('el HTML de BuiltBot no se cachea, como index.html', () => {
    const { groups, unknown } = uploadPlan(['builtbot/index.html', 'builtbot/404.html']);
    expect(unknown).toEqual([]);
    expect(find(groups, 'text/html', 'no-cache')?.args).toEqual(['--exclude', '*', '--include', 'builtbot/*.html']);
  });

  it('the hashed static files of BuiltBot (_next/static) carry a one-year immutable cache', () => {
    const { groups } = uploadPlan(['builtbot/_next/static/chunks/a.js', 'builtbot/_next/static/css/b.css', 'builtbot/_next/static/media/f.woff2']);
    expect(find(groups, 'text/javascript', 'public,max-age=31536000,immutable')?.args).toEqual([
      '--exclude', '*', '--include', 'builtbot/_next/static/*.js',
    ]);
    expect(find(groups, 'text/css', 'public,max-age=31536000,immutable')).toBeDefined();
    expect(find(groups, 'font/woff2', 'public,max-age=31536000,immutable')).toBeDefined();
  });

  it('the rest of BuiltBot (icons, svg, txt) carries the short cache of static files and no type is left unknown', () => {
    const { groups, unknown } = uploadPlan(['builtbot/favicon.ico', 'builtbot/logo.svg', 'builtbot/robots.txt', 'builtbot/a.png']);
    expect(unknown).toEqual([]);
    expect(find(groups, 'image/x-icon', 'public,max-age=300')).toBeDefined();
    expect(find(groups, 'image/svg+xml', 'public,max-age=300')).toBeDefined();
  });

  it('un js de BuiltBot fuera de _next/static no cae en el grupo inmutable', () => {
    const { groups } = uploadPlan(['builtbot/sw.js']);
    expect(find(groups, 'text/javascript', 'public,max-age=31536000,immutable')).toBeUndefined();
    expect(find(groups, 'text/javascript', 'public,max-age=300')).toBeDefined();
  });

  it('the add-in zip is uploaded as application/zip, with a short cache and without precompression', () => {
    const f = 'descargas/IFCx-Revit-2026-a.zip';
    const { groups, precompress, unknown } = uploadPlan([f], { [f]: 80_000_000 });
    expect(unknown).toEqual([]);
    expect(precompress).toEqual([]);
    expect(find(groups, 'application/zip', 'public,max-age=300')).toBeDefined();
  });

  it('one group per type and cache, without repeats', () => {
    const { groups } = uploadPlan(['proyecto/a.ifcx', 'proyecto/b.ifcx', 'proyecto/index.json']);
    expect(groups).toHaveLength(2);
  });
});
