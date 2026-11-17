// The renderer uses a logarithmic depth buffer, whose fragment shader writes gl_FragDepth and
// ignores polygonOffset. Edge lines are pulled towards the camera in their own vertex shader instead.
import * as THREE from 'three';

export const EDGE_PULL = 5e-4;

/** Makes `m` draw its fragments a little closer than the faces behind it. */
export function pullForward<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <logdepthbuf_vertex>',
      `#include <logdepthbuf_vertex>\n#ifdef USE_LOGDEPTHBUF\n\tvFragDepth -= vFragDepth * ${EDGE_PULL};\n#endif`,
    );
  };
  m.customProgramCacheKey = () => 'edge-pull';
  return m;
}
