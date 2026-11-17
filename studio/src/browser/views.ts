// Árbol de vistas del Navegador de proyectos. Puro (sin DOM): se prueba en node.
import type { LevelInfo } from '../render/levels';

export type ViewRef =
  | { kind: '3d' }
  | { kind: 'plan'; level: LevelInfo }
  | { kind: 'elevation'; side: 'front' | 'side' };

export interface BrowserNode {
  label: string;
  /** Only openable leaves carry a view; branches and markers do not. */
  view?: ViewRef;
  children?: BrowserNode[];
}

const SIDE_LABEL = { front: 'Front', side: 'Side' } as const;

/** Full name of the view (the one that goes in the tab and the window title). */
export function viewLabel(v: ViewRef): string {
  switch (v.kind) {
    case '3d':
      return '{3D}';
    case 'plan':
      return `Floor Plan: ${v.level.name}`;
    case 'elevation':
      return `Elevation: ${SIDE_LABEL[v.side]}`;
  }
}

/** `levels` debe llegar ya ordenado de abajo arriba (sortLevels). */
export function buildViewsTree(levels: LevelInfo[]): BrowserNode {
  const plans: BrowserNode[] = levels.length
    ? levels.map((level) => ({ label: level.name, view: { kind: 'plan', level } as ViewRef }))
    : [{ label: '(no levels)' }];
  return {
    label: 'Views (all)',
    children: [
      { label: '3D', children: [{ label: '{3D}', view: { kind: '3d' } }] },
      { label: 'Floor Plans', children: plans },
      {
        label: 'Elevations',
        children: [
          { label: 'Front', view: { kind: 'elevation', side: 'front' } },
          { label: 'Side', view: { kind: 'elevation', side: 'side' } },
        ],
      },
    ],
  };
}
