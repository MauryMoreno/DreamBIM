import { StageData, StageCallbacks } from './types';
import type { ComposedNode } from '../../ifcx/types';

/** What the parts of mountStagePanel share: its parameters and every local that more than one part uses. */
export interface StageContext {
  host: HTMLElement;
  cb: StageCallbacks;
  search: HTMLInputElement;
  tree: HTMLDivElement;
  empty: HTMLDivElement;
  data: StageData;
  byPath: Map<string, ComposedNode>;
  expanded: Set<string>;
  seeded: boolean;
  selected: string | null;
  query: string;
  rows: Map<string, HTMLElement>;
  multi: Set<string>;
  nodes: Map<string, ComposedNode>;
  hidden: Set<string>;
  underHidden: (n: ComposedNode) => boolean;
  paintEye: (b: HTMLButtonElement, off: boolean) => void;
  toggleHidden: (path: string) => void;
  sourceFor: (n: ComposedNode) => string;
  row: (n: ComposedNode, depth: number, open: boolean, kids: boolean) => HTMLElement;
  dragging: ComposedNode | null;
  clearDrop: () => void;
  render: () => void;
  groupOf: (r: HTMLElement) => HTMLElement | null;
  openRow: (path: string) => boolean;
  toggleOpen: (path: string) => void;
  setSelected: (path: string | null) => void;
}
