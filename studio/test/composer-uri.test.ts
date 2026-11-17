import { describe, expect, it, vi } from 'vitest';
import { linkUri, loadLinked, rebaseUri, resolveUri, sameFile } from '../src/composer/uri';

const valido = JSON.stringify({ data: [{ path: 'x' }] });

describe('linkUri', () => {
  it('relativa cuando comparten unidad', () => {
    expect(linkUri('C:\\p\\casa.ifcx', 'C:\\p\\sub\\a.ifcx')).toBe('./sub/a.ifcx');
    expect(linkUri('C:\\p\\casa.ifcx', 'C:\\q\\a.ifcx')).toBe('../q/a.ifcx');
    expect(linkUri('C:\\p\\casa.ifcx', 'C:\\p\\a.ifcx')).toBe('./a.ifcx');
  });
  it('absoluta si cambia la unidad o no hay documento', () => {
    expect(linkUri('C:\\p\\casa.ifcx', 'D:\\a.ifcx')).toBe('D:/a.ifcx');
    expect(linkUri(null, 'C:\\p\\a.ifcx')).toBe('C:/p/a.ifcx');
  });
  it('it normalizes separators, Windows case, ./ and ../', () => {
    expect(linkUri('C:/p/casa.ifcx', 'C:/p/./sub/../sub//a.ifcx')).toBe('./sub/a.ifcx');
    expect(linkUri('c:/P/casa.ifcx', 'C:\\p\\sub\\a.ifcx')).toBe('./sub/a.ifcx');
    expect(linkUri(null, 'C:/p/x/../a.ifcx')).toBe('C:/p/a.ifcx');
  });
  it('rutas POSIX', () => {
    expect(linkUri('/home/u/casa.ifcx', '/home/u/a.ifcx')).toBe('./a.ifcx');
    expect(linkUri('/home/u/casa.ifcx', '/etc/a.ifcx')).toBe('../../etc/a.ifcx');
  });
});

describe('resolveUri', () => {
  it('es la inversa de linkUri', () => {
    const doc = 'C:\\p\\casa.ifcx';
    expect(resolveUri(doc, './sub/a.ifcx')).toBe('C:/p/sub/a.ifcx');
    expect(resolveUri(doc, '../q/a.ifcx')).toBe('C:/q/a.ifcx');
    expect(resolveUri(doc, 'D:/a.ifcx')).toBe('D:/a.ifcx');
    expect(resolveUri(null, 'C:/p/a.ifcx')).toBe('C:/p/a.ifcx');
    for (const f of ['C:\\p\\sub\\a.ifcx', 'C:\\q\\a.ifcx', 'D:\\a.ifcx']) {
      expect(resolveUri(doc, linkUri(doc, f))).toBe(f.replace(/\\/g, '/'));
    }
  });
  it('on POSIX it is case-sensitive', () => {
    expect(resolveUri('C:/casa.ifcx', '../../a.ifcx')).toBe('C:/a.ifcx');
  });
});

describe('sameFile', () => {
  it('a synchronous read that throws (non-async function) also gives null', () => {
    expect(sameFile('C:\\P\\a.ifcx', 'c:/p/./a.ifcx')).toBe(true);
    expect(sameFile('C:/p/x/../a.ifcx', 'C:/p/a.ifcx')).toBe(true);
    expect(sameFile('C:/p/a.ifcx', 'C:/p/b.ifcx')).toBe(false);
    expect(sameFile('C:/p/a.ifcx', 'D:/p/a.ifcx')).toBe(false);
  });
  it('valid JSON but without data gives null', () => {
    expect(sameFile('/a/B.ifcx', '/a/b.ifcx')).toBe(false);
  });
});

describe('rebaseUri', () => {
  it('Guardar como: recalcula la relativa respecto al nuevo documento', () => {
    expect(rebaseUri('./a.ifcx', 'C:/p/x.ifcx', 'C:/q/x.ifcx')).toBe('../p/a.ifcx');
    expect(rebaseUri('D:/a.ifcx', 'C:/p/x.ifcx', 'C:/q/x.ifcx')).toBe('D:/a.ifcx');
  });
  it('sin documento de origen la relativa no se puede resolver y se conserva', () => {
    expect(rebaseUri('./a.ifcx', null, 'C:/q/x.ifcx')).toBe('./a.ifcx');
  });
});

describe('loadLinked', () => {
  it('un fallo de lectura o de parseo da null y nunca lanza', async () => {
    const leidos: string[] = [];
    const read = async (p: string): Promise<string> => {
      leidos.push(p);
      if (p.endsWith('falla.ifcx')) throw new Error('ENOENT');
      if (p.endsWith('roto.ifcx')) return '{no es json';
      if (p.endsWith('sincrono.ifcx')) throw new Error('sync');
      return valido;
    };
    const r = await loadLinked('C:/p/casa.ifcx', ['./ok.ifcx', './falla.ifcx', './roto.ifcx', './sincrono.ifcx'], read);
    expect(r.get('./falla.ifcx')).toBeNull();
    expect(r.get('./roto.ifcx')).toBeNull();
    expect(r.get('./sincrono.ifcx')).toBeNull();
    expect(r.get('./ok.ifcx')?.data).toEqual([{ path: 'x' }]);
    expect(leidos).toContain('C:/p/ok.ifcx');
  });
  it('if the asynchronous parse rejects, that URI gives null', async () => {
    const read = ((): Promise<string> => {
      throw new Error('boom');
    }) as (p: string) => Promise<string>;
    const r = await loadLinked(null, ['C:/a.ifcx'], read);
    expect(r.get('C:/a.ifcx')).toBeNull();
  });
  it('Minimal request: 2 levels and a floor plan with 4 walls and 1 floor.', async () => {
    const r = await loadLinked(null, ['C:/a.ifcx'], async () => '{"header":{}}');
    expect(r.get('C:/a.ifcx')).toBeNull();
  });
  it('loadLinked usa el parse que se le pasa', async () => {
    const parse = vi.fn(async (t: string) => ({ ...JSON.parse(t), marca: 'asincrono' }) as any);
    const r = await loadLinked(null, ['C:/a.ifcx', 'C:/b.ifcx'], async () => valido, parse);
    expect(parse).toHaveBeenCalledTimes(2);
    expect((r.get('C:/a.ifcx') as any).marca).toBe('asincrono');
  });
  it('without fresh it adds to the open document in one step', async () => {
    const r = await loadLinked(null, ['C:/a.ifcx'], async () => valido, async () => {
      throw new Error('x');
    });
    expect(r.get('C:/a.ifcx')).toBeNull();
  });
});
