import { describe, expect, it } from 'vitest';
import { handleParse } from '../src/model/parse.worker';
import { createLinkedParser, type WorkerLike } from '../src/model/parse-client';

const MESH = 'usd::usdgeom::mesh';
const pts = (f: { data: { attributes?: Record<string, any> }[] }, i = 0): any => f.data[i].attributes![MESH].points;
const texto = (extra = 0) =>
  JSON.stringify({
    data: [{ path: 'm', attributes: { [MESH]: { points: [[0, 0, 0], [1, 0, extra], [0, 1, 0]], faceVertexIndices: [0, 1, 2], faceVertexCounts: [3] } } }],
  });

/** Worker falso: ejecuta el mismo manejador que parse.worker.ts, en este hilo. `retardo` permite responder desordenado. */
function falso(retardo: (id: number) => number = () => 0) {
  const oyentes: ((e: MessageEvent) => void)[] = [];
  const mensajes: unknown[] = [];
  const w: WorkerLike = {
    postMessage(m) {
      mensajes.push(m);
      const { reply } = handleParse(m as { id: number; text: string });
      setTimeout(() => oyentes.forEach((f) => f({ data: reply } as MessageEvent)), retardo((m as { id: number }).id));
    },
    addEventListener(t, f) {
      if (t === 'message') oyentes.push(f);
    },
  };
  return { w, mensajes };
}

describe('handleParse', () => {
  it('it packs the meshes and returns their buffers to transfer', () => {
    const { reply, transfer } = handleParse({ id: 3, text: texto() });
    expect(reply.id).toBe(3);
    const p = (reply as any).file.data[0].attributes[MESH].points;
    expect(p).toBeInstanceOf(Float32Array);
    expect(transfer).toContain(p.buffer);
    expect(transfer).toHaveLength(3);
  });
  it('an invalid text answers with the error of parseLayer', () => {
    const { reply, transfer } = handleParse({ id: 1, text: '{"data": 3}' });
    expect(reply).toEqual({ id: 1, error: 'Not a valid IFCX file: Not a valid IFCX file: missing "data" array' });
    expect(transfer).toEqual([]);
  });
});

describe('createLinkedParser', () => {
  it('devuelve el archivo con las mallas empaquetadas', async () => {
    const { w } = falso();
    const parse = createLinkedParser(() => w);
    const f = await parse(texto());
    expect(pts(f)).toBeInstanceOf(Float32Array);
    expect(f.imports).toEqual([]);
  });
  it('empareja respuestas fuera de orden por id', async () => {
    const { w } = falso((id) => (id === 1 ? 30 : 1)); // the first one takes longer
    const parse = createLinkedParser(() => w);
    const [a, b] = await Promise.all([parse(texto(5)), parse(texto(9))]);
    expect(pts(a)[5]).toBe(5);
    expect(pts(b)[5]).toBe(9);
  });
  it('crea el worker una sola vez', async () => {
    let n = 0;
    const { w } = falso();
    const parse = createLinkedParser(() => (n++, w));
    await parse(texto());
    await parse(texto());
    expect(n).toBe(1);
  });
  it('an invalid text rejects with "Not a valid IFCX file: …"', async () => {
    const parse = createLinkedParser(() => falso().w);
    await expect(parse('hola')).rejects.toThrow(/^Not a valid IFCX file: /);
  });
  it('sin Worker parsea en el hilo principal con la misma forma', async () => {
    const parse = createLinkedParser(null);
    const f = await parse(texto());
    expect(pts(f)).toBeInstanceOf(Float32Array);
    await expect(parse('{"data": 3}')).rejects.toThrow(/^Not a valid IFCX file: /);
  });
  it('a worker failure rejects the pending tasks', async () => {
    const oyentes: Record<string, (e: any) => void> = {};
    const w = { postMessage() {}, addEventListener: (t: string, f: any) => { oyentes[t] = f; } } as unknown as WorkerLike;
    const parse = createLinkedParser(() => w);
    const p = parse(texto());
    oyentes.error?.({ message: 'boom' });
    await expect(p).rejects.toThrow(/boom/);
  });
});
