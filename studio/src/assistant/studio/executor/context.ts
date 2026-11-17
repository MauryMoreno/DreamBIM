import type { ModelSnapshot } from '../host';
import { Args, Command } from './types';
import type { ComposedNode } from '../../../ifcx/types';
import type { StudioHost } from '../host';

/** What the parts of createExecutor share: its parameters and every local that more than one part uses. */
export interface ExecutorContext {
  host: StudioHost;
  model: () => ModelSnapshot;
  byPath: (path: string) => ComposedNode;
  lookup: (paths: string[]) => Map<string, ComposedNode>;
  nodesAt: (paths: string[]) => ComposedNode[];
  piecePaths: (ids: string[]) => string[];
  stairPaths: (ids: string[]) => string[];
  targets: (cmd: string, a: Args) => ComposedNode[];
  writable: () => void;
  matching: (cmd: string, a: Args) => ComposedNode[];
  levelName: (name: string) => string;
  queryCommands: Command[];
  viewCommands: Command[];
  materialsCommands: Command[];
  buildingCommands: Command[];
  stairsCommands: Command[];
  reviewCommands: Command[];
  editCommands: Command[];
  commands: Command[];
  registry: Map<string, Command>;
}
