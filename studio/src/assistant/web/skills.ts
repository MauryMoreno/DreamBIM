// Built-in skills of the web Assistant: name, description and the text that is added to the prompt.
export interface WebSkill {
  name: string;
  description: string;
  scope: 'builtin';
  prompt: string;
}

const DESIGN_BUILDING = [
  '--- SKILL: DESIGN A BUILDING STEP BY STEP ---',
  'You are guiding the user through the design of an apartment building. Follow these steps in order. Ask ONE question per message and wait for the answer. Never skip a step; if the user already gave an answer, confirm it in one line and move on. Keep a short running summary of the answers so far at the top of each message.',
  '',
  'Step 1 - Lot. Ask for the lot width (along the street) and depth, in meters, and the setback from the lot line if any. The street is the y = 0 side; the lot is [0, width] x [0, depth].',
  'Step 2 - Levels. Ask how many storeys and the storey height (propose 3 m). With two or more levels the building needs a stair between every pair of levels: say so.',
  'Step 3 - Apartments. Ask how many apartments on each level (the same on every level, or which levels differ).',
  'Step 4 - Partition layout. Ask whether the user has a reference for where the dividing walls go, and to describe it in words (for example "a central corridor with two apartments on each side"). If there is none, say you will propose one.',
  'Step 5 - Plan. Design the whole plan before touching the model: the footprint inside the lot and its setback, a common corridor at least 1.5 m wide that connects the street entrance, the stair and every apartment door, one door per apartment onto the corridor, the entrance door on the street side, and the stair (prefer shape \'u\') in the corridor or in a core open to it. Search the library for the door first. Present the plan in 4 to 8 lines.',
  'Step 6 - First review. Run `review_plan` with the complete plan: lot, apartments per level, the exact `build` you intend to pass to `build_model`, the doors and the stairs. If any check fails, tell the user what failed in one line, change the plan and run `review_plan` again. Do not ask the user to accept a failing plan. When it passes, show the result as a short checklist.',
  'Step 7 - Build. Call `build_model` with exactly the `build` that passed (it is refused otherwise), then `place_stairs` with the `stairs` that `review_plan` returned, then `place_in_wall` with the same doors. Windows and furniture come after, if the user wants them, and never in the corridor, on a stair or on its clear floor.',
  'Step 8 - Second review. Run `review_model` with the same lot and apartments. If any check fails, fix the model and run it again. Only when it passes: take a `screenshot`, show the checklist of both reviews, and say the building is done. Every later change to the model needs `review_model` again.',
  '',
  'The two reviews are mandatory and are done by the app, not by you: never say a plan or a model is reviewed, safe or compliant without a passing `review_plan` or `review_model` result in this conversation. The limits are sensible defaults, not a building code: say so once, and use other limits if the user gives them.',
].join('\n');

export const SKILLS: readonly WebSkill[] = [
  {
    name: 'design-building',
    description:
      'Design an apartment building step by step: lot, levels, apartments, layout, then a plan that is reviewed twice ' +
      '(access, evacuation, stairs) before and after it is built.',
    scope: 'builtin',
    prompt: DESIGN_BUILDING,
  },
];

export const skillByName = (name: string): WebSkill | undefined =>
  SKILLS.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());

/** `/skills <nombre>` o `/skills off` al principio del mensaje; null si no es eso. `name: null` es «off». */
export function parseSkillCommand(text: string): { name: string | null } | null {
  const m = /^\/skills\s+(\S+)(?:\s+[\s\S]*)?$/.exec(text.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase() === 'off' ? null : m[1] };
}
