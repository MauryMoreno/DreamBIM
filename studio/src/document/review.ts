import { NOT_EDITABLE } from '../ribbon/filemenu';
import type { AssetRef } from '../modeling/place';
import { reviewDoc, type Review, type ReviewOptions } from '../modeling/egress';
import { reviewPlan as reviewPlanDoc, type Plan, type PlanReview } from '../modeling/planreview';
import { levelByName } from '../modeling/stairplace';
import { findStairSpots, type SpotResult } from '../modeling/stairspots';
import type { StairShape } from '../modeling/stairlayout';
import type { DocumentContext } from './context';

export class ReviewService {
  constructor(private readonly ctx: DocumentContext) {}

  /**
   * Reviews a whole plan on a working document: it needs no open document and does not touch the
   * document, the history or the layers. It reads the door files like `placeAssets`.
   */
  async reviewPlan(plan: Plan): Promise<PlanReview> {
    const assets = plan.doors
      ? (await this.ctx.placement.assetRefs(plan.doors.items.map((i) => i.asset), 'review_plan')).assets
      : new Map<string, AssetRef>();
    return reviewPlanDoc(plan, assets);
  }

  /** Runs the same review on the open Studio model (after building it and placing everything). */
  reviewModel(opts: ReviewOptions): Review {
    const s = this.ctx.mutations.studioSession();
    if (!s) throw new Error(this.ctx.state.open ? NOT_EDITABLE : 'No model is open');
    return reviewDoc(s.doc, opts);
  }

  /** Valid spots between two levels, resolving the level names (read-only, synchronous). */
  stairSpots(q: { from: string; to: string; shape: StairShape; width: number; limit: number }): SpotResult {
    const s = this.ctx.mutations.studioSession();
    if (!s) throw new Error(this.ctx.state.open ? NOT_EDITABLE : 'No model is open');
    const base = levelByName(s.doc, q.from, 'stair_spots', '');
    const top = levelByName(s.doc, q.to, 'stair_spots', '');
    return findStairSpots(s.doc, { baseLevelId: base.id, topLevelId: top.id, shape: q.shape, width: q.width }, q.limit);
  }
}
