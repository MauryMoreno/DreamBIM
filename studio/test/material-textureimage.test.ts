import { describe, expect, it } from 'vitest';
import { fitSize } from '../src/platform/image-size';
import { TEXTURE_MAX_SIDE } from '../src/materials/textureimage';

describe('fitSize', () => {
  it('a small image is not enlarged', () => {
    expect(fitSize(300, 200, TEXTURE_MAX_SIDE)).toEqual({ width: 300, height: 200 });
  });

  it('a big one is reduced to the maximum side keeping the proportion', () => {
    expect(TEXTURE_MAX_SIDE).toBe(1024);
    expect(fitSize(4096, 2048, TEXTURE_MAX_SIDE)).toEqual({ width: 1024, height: 512 });
    expect(fitSize(1000, 4000, TEXTURE_MAX_SIDE)).toEqual({ width: 256, height: 1024 });
  });

  it('it never gives a dimension of zero', () => {
    expect(fitSize(10000, 1, TEXTURE_MAX_SIDE)).toEqual({ width: 1024, height: 1 });
  });
});
