import type { TaskDates, TaskFloat } from '../plan';
import type { Calendar, Task } from '../state';

export interface GanttRow {
  task: Task;
  dates: TaskDates;
  elements: number;
  missing: number;
  /** Slack and critical path; absent if not computed. */
  cpm?: TaskFloat;
}

export interface GanttCallbacks {
  onSelect(id: string): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onMove(id: string, newStart: string): void;
  onResize(id: string, newDuration: number): void;
  /** If given, the toolbar brings a button to open the enlarged timeline. */
  onExpand?(): void;
  /** If given, the red day line brings an indicator on the scale that is dragged; it notifies with every new day. */
  onDay?(day: string): void;
}

export interface Gantt {
  setRows(rows: GanttRow[], span: TaskDates | null, cal: Calendar): void;
  setSelected(id: string | null): void;
  markTasks(ids: string[]): void;
  /** Vertical line of the date of the slider (null removes it). */
  setDay(day: string | null): void;
  setEditable(on: boolean): void;
  /** Paints the critical path in red. */
  setCritical(on: boolean): void;
  /** Adjusts the zoom to see the whole schedule (in width and, if there is vertical zoom, in height) and keeps adjusting it on resize. */
  fit(): void;
}

export interface GanttOptions {
  /** false = only the timeline, without the task list. */
  list?: boolean;
  /** Buttons and wheel to change the height of the rows (the list needs its fixed height). */
  zoomY?: boolean;
  /** El zoom no baja del ajuste «ver todo» (Fit): ni a lo ancho ni, con zoomY, a lo alto. */
  minFit?: boolean;
  /** Sliders for the zoom of each axis, between the fit (or the minimum) and the maximum. */
  sliders?: boolean;
  /** false = sin la barra de botones (zoom, Fit, Today): el zoom queda en Ctrl + rueda. */
  toolbar?: boolean;
}
