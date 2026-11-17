import { describe, expect, it } from 'vitest';
import { fitSize } from '../src/platform/image-size';

describe('fitSize (capturas para el agente)', () => {
  it('shrinks keeping the proportion until the longest side is max', () => {
    expect(fitSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 });
    expect(fitSize(1000, 3000, 1024)).toEqual({ width: 341, height: 1024 });
  });

  it('no agranda lo que ya cabe', () => {
    expect(fitSize(640, 480, 1024)).toEqual({ width: 640, height: 480 });
  });

  it('never gives a dimension of 0 pixels', () => {
    expect(fitSize(10000, 2, 100)).toEqual({ width: 100, height: 1 });
  });
});
