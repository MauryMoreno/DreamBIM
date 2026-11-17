import type { ViewRef } from '../browser/views';
import type { CameraState } from '../render/levels';
import type { VisualStyle } from '../render/styles';
import type { StudioIcon } from '../shell/icons';

/** Visual Style options, in Revit order (without Realistic). */
export const VISUAL_STYLES: { value: VisualStyle; label: string; icon: StudioIcon }[] = [
  { value: 'wireframe', label: 'Wireframe', icon: 'styleWireframe' },
  { value: 'hidden', label: 'Hidden Line', icon: 'styleHidden' },
  { value: 'shaded', label: 'Shaded', icon: 'styleShaded' },
  { value: 'consistent', label: 'Consistent Colors', icon: 'styleConsistent' },
  { value: 'textures', label: 'Textures', icon: 'styleTextures' },
];

/** Projections of a 3D view (ViewCube context menu, as in Revit). */
export const PROJECTIONS: { value: CameraState['projection']; label: string }[] = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'orthographic', label: 'Parallel' },
];

/** Clearance of a plan's cut above its top (the next level or, on the last one, the highest point): keeps the top face of walls (m). */
export const PLAN_TOP_CLEARANCE = 0.01;
/** Side of the grid drawn without a model (new document), in meters. */
export const EMPTY_GRID_SIZE = 40;
export const LEFT_WIDTH = 280;
export const RIGHT_WIDTH = 260;
/** Minimum height of the Transform box when dragging its splitter: header and the four field rows. */
export const MOVE_MIN_HEIGHT = 132;
export const ASSISTANT_WIDTH = 460;
/** Height the BOQ enters with the first time Costs opens. */
export const BOQ_HEIGHT = 360;
/** Height the Gantt enters with the first time Schedule opens. */
export const GANTT_HEIGHT = 320;

/** Initial height of the Library panel, under the view. */
export const LIBRARY_HEIGHT = 230;
export const UNTITLED = 'Untitled';
/** Maximum movement (px) between pointerdown and pointerup to count as a click (same as the viewer). */
export const CLICK_SLOP = 4;
/** Why drawing is disabled in an IFCx that is not from Studio (you edit what it has, without Studio tools). */
export const NOT_STUDIO = 'Walls, floors and levels can only be drawn in Dream BIM documents';

export type Toggle = 'xray' | 'section' | 'shadows' | 'grid';

/** Icon of each view kind, for its tab. */
export const VIEW_ICON: Record<ViewRef['kind'], StudioIcon> = { '3d': 'cube3d', plan: 'plan', elevation: 'elevation' };
