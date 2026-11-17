import { describe, expect, it } from 'vitest';
import { importWarningToast } from '../src/app/load-warnings';

const miss = (f: string) => `Import unavailable: ../../${f} (Missing ${f}. Select it together with the model, both in the same folder.)`;

describe('importWarningToast', () => {
  it('it names the first import that is missing, with its reason', () => {
    const t = importWarningToast('S-0001.ifcx', [miss('Z-0001.ifcx'), 'otra advertencia']);
    expect(t?.message).toBe(`S-0001.ifcx: ${miss('Z-0001.ifcx')}`);
    expect(t?.log).toEqual([miss('Z-0001.ifcx')]);
  });

  it('with several, it warns how many more there are and leaves them all in the log', () => {
    const t = importWarningToast('m.ifcx', [miss('a.ifcx'), miss('b.ifcx'), miss('c.ifcx')]);
    expect(t?.message).toContain('(+2 more, see console)');
    expect(t?.log).toHaveLength(3);
  });

  it('sin importaciones faltantes no hay aviso', () => {
    expect(importWarningToast('m.ifcx', ['otra advertencia'])).toBeNull();
    expect(importWarningToast('m.ifcx', [])).toBeNull();
  });
});
