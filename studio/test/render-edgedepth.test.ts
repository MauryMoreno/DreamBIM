import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EDGE_PULL, pullForward } from '../src/render/edgedepth';

describe('pullForward', () => {
  it('moves the fragment depth of the material towards the camera after the log depth chunk', () => {
    const m = pullForward(new THREE.LineBasicMaterial());
    const shader = { vertexShader: 'void main() {\n#include <logdepthbuf_vertex>\n}' };
    m.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain(
      `#include <logdepthbuf_vertex>\n#ifdef USE_LOGDEPTHBUF\n\tvFragDepth -= vFragDepth * ${EDGE_PULL};\n#endif`,
    );
    expect(m.customProgramCacheKey()).toBe('edge-pull');
  });
});
