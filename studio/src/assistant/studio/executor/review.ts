import { Command } from './types';
import { parsePlan, parseReviewOptions } from '../../../modeling/planreview';
import type { ExecutorContext } from './context';

export function installReview(ctx: ExecutorContext): void {
  const reviewCommands: Command[] = [
    {
      name: 'review_plan',
      args:
        'lot {width, depth, setback?}, apartments? {level name: count}, ' +
        'build {the exact args you will pass to build_model}, ' +
        'doors? [{asset, level, at [x, y], sill?}], stairs? [{from, to, shape, width?}], ' +
        'limits? {maxTravel?, maxTravelToStair?, minPassage?, minCorridor?}',
      description:
        'Review a whole building plan before building it: the plan is applied to a hidden working copy and checked ' +
        'for access (every room reaches an entrance through doors), evacuation (travel distance, clear width), ' +
        'stairs between every pair of levels, the lot and the apartment count. Nothing is built. Returns the stair ' +
        'placements to use.',
      run: async (a) => {
        const plan = parsePlan(a);
        const out = await ctx.host.reviewPlan(plan);
        return { ...out.review, stairs: out.stairs, build_key: out.buildKey };
      },
    },
    {
      name: 'review_model',
      args: 'lot? {width, depth, setback?}, apartments? {level name: count}, limits?',
      description: 'Run the same review on the open model, after building.',
      run: async (a) => ctx.host.reviewModel(parseReviewOptions(a)),
    },
  ];
  ctx.reviewCommands = reviewCommands;
}
