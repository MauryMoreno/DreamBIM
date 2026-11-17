import { type Vec2 } from '../footprint';

export interface ReviewLimits {
  maxTravel: number;
  maxTravelToStair: number;
  minPassage: number;
  minCorridor: number;
}

export interface ReviewOptions {
  lot?: { width: number; depth: number; setback?: number };
  /** Apartamentos pedidos por nombre de nivel. */
  apartments?: Record<string, number>;
  limits?: Partial<ReviewLimits>;
}

export type CheckId =
  | 'lot'
  | 'entrance'
  | 'front-entrance'
  | 'stairs'
  | 'rooms-access'
  | 'passage'
  | 'corridor'
  | 'common'
  | 'travel'
  | 'travel-stair'
  | 'program';

export interface ReviewCheck {
  id: CheckId;
  ok: boolean;
  detail: string;
  level?: string;
  at?: Vec2;
}

export interface Review {
  ok: boolean;
  checks: ReviewCheck[];
  exits: number;
  levels: { level: string; rooms: number; apartments: number; common: number; max_travel: number }[];
}

/** Quick query of rooms to choose the site of a stair before reviewing the plan. */
export interface RoomProbe {
  roomAt(levelId: string, p: Vec2): { area: number; doors: number } | null;
}
