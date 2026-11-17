import { ReviewLimits, ReviewOptions, CheckId, ReviewCheck } from './types';
import { Room, StairPort, Grid } from './grid-types';
import { type LevelParams, type StudioDoc } from '../document';
import { type Vec2 } from '../footprint';

/** What the parts of reviewDoc share: its parameters and every local that more than one part uses. */
export interface ReviewContext {
  doc: StudioDoc;
  opts: ReviewOptions;
  limits: ReviewLimits;
  levels: LevelParams[];
  grids: Grid[];
  byLevel: Map<string, Grid>;
  offsets: number[];
  total: number;
  node: (g: Grid, i: number) => number;
  freePass: (g: Grid, i: number) => boolean;
  freeCorr: (g: Grid, i: number) => boolean;
  nearestFree: (g: Grid, p: Vec2, max?: number) => number;
  lowest: LevelParams;
  stairsPorts: StairPort[];
  exits: number;
  roomsByGid: Map<number, Room>;
  checks: ReviewCheck[];
  add: (id: CheckId, entries: Omit<ReviewCheck, "id">[]) => void;
  maxTravel: Map<number, number>;
  outLevels: { level: string; rooms: number; apartments: number; common: number; max_travel: number; }[];
}
