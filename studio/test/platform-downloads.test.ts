import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadQueue, SAVE_SETTLE_MS } from '../src/platform/downloads';
import { webFiles } from '../src/platform/web-files';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

function setup() {
  const saved: { name: string; blob: Blob }[] = [];
  const queue = downloadQueue((name, blob) => saved.push({ name, blob }));
  return { saved, queue };
}

describe('platform/downloads', () => {
  it('a write is downloaded as a file when it settles', async () => {
    const { saved, queue } = setup();
    queue.add('/local/a.ifcx', '{"a":1}');
    expect(saved).toHaveLength(0);
    vi.advanceTimersByTime(SAVE_SETTLE_MS);
    expect(saved.map((s) => s.name)).toEqual(['a.ifcx']);
    expect(await saved[0].blob.text()).toBe('{"a":1}');
  });

  it('varias escrituras seguidas forman un solo zip con sus rutas relativas', async () => {
    const { saved, queue } = setup();
    queue.add('/local/A.ifcx', 'modelo');
    queue.add('/local/A.cronograma.ifcx', 'crono');
    queue.add('/Snowdon Towers Example/biblioteca/m.ifcx', 'lib');
    vi.advanceTimersByTime(SAVE_SETTLE_MS);
    expect(saved.map((s) => s.name)).toEqual(['A.zip']);
    const zip = unzipSync(new Uint8Array(await saved[0].blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['Snowdon Towers Example/biblioteca/m.ifcx', 'local/A.cronograma.ifcx', 'local/A.ifcx']);
    expect(strFromU8(zip['local/A.ifcx'])).toBe('modelo');
  });

  it('dos guardados separados son dos descargas, no un zip mezclado', () => {
    const { saved, queue } = setup();
    queue.add('/local/a.ifcx', '1');
    vi.advanceTimersByTime(SAVE_SETTLE_MS);
    vi.advanceTimersByTime(1000);
    queue.add('/local/a.ifcx', '2');
    vi.advanceTimersByTime(SAVE_SETTLE_MS);
    expect(saved.map((s) => s.name)).toEqual(['a.ifcx', 'a.ifcx']);
  });

  it('the same path written twice in one save leaves the last text, in a single file', async () => {
    const { saved, queue } = setup();
    queue.add('/local/a.ifcx', 'viejo');
    vi.advanceTimersByTime(100);
    queue.add('/local/a.ifcx', 'nuevo');
    vi.advanceTimersByTime(SAVE_SETTLE_MS);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('a.ifcx');
    expect(await saved[0].blob.text()).toBe('nuevo');
  });

  it('writeText de la web encola la descarga', async () => {
    const saved: string[] = [];
    const files = webFiles({ base: 'https://demo.test/', save: (name) => saved.push(name) });
    await files.writeText('/local/Modelo.ifcx', 'x');
    vi.advanceTimersByTime(SAVE_SETTLE_MS);
    expect(saved).toEqual(['Modelo.ifcx']);
  });
});
