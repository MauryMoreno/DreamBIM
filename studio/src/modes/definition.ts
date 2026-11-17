import type { StudioIcon } from '../shell/icons';
import { RIBBON, type RibbonTab } from '../ribbon/definition';

export type ModeId = 'model' | 'materials' | 'costs' | 'schedule';

export interface ModeDef {
  id: ModeId;
  label: string;
  icon: StudioIcon;
  /** Its ribbon tabs. */
  ribbon: RibbonTab[];
  /** Ribbon tab used the first time the mode is entered. */
  initialTab: string;
  /** Only the markers of future phases: text of the empty panel. */
  blurb?: string;
}

export const MODES: ModeDef[] = [
  { id: 'model', label: 'Model', icon: 'cube3d', ribbon: RIBBON, initialTab: 'arquitectura' },
  {
    id: 'materials',
    label: 'Materials',
    icon: 'image',
    ribbon: [
      {
        id: 'materiales',
        label: 'Materials',
        groups: [
          { label: 'Material', buttons: [{ id: 'mat-new', label: 'New Material', icon: 'image', action: 'matNew' }] },
          {
            label: 'Assign',
            buttons: [
              { id: 'mat-assign', label: 'Assign to Selection', icon: 'link', action: 'matAssign' },
              { id: 'mat-rule', label: 'Assign by Rule', icon: 'search', action: 'matRule' },
            ],
          },
          { label: 'Display', buttons: [{ id: 'mat-colors', label: 'Material Colors', icon: 'eye', action: 'matColors', toggle: true }] },
        ],
      },
    ],
    initialTab: 'materiales',
    blurb: 'Assign what each element is made of and how it looks.',
  },
  {
    id: 'costs',
    label: 'Costs',
    icon: 'tag',
    ribbon: [
      {
        id: 'costos',
        label: 'Costs',
        groups: [
          {
            label: 'Item',
            buttons: [
              { id: 'cost-edit', label: 'Edit Item', icon: 'detail', action: 'costEdit' },
              { id: 'cost-editsystem', label: 'Edit System', icon: 'tree', action: 'costEditSystem' },
            ],
          },
          {
            label: 'Assign',
            buttons: [
              { id: 'cost-assign', label: 'Assign to Selection', icon: 'check', action: 'costAssign' },
              { id: 'cost-clearassign', label: 'Clear Assignment', icon: 'close', action: 'costClearAssign' },
            ],
          },
          {
            label: 'Display',
            buttons: [
              {
                id: 'cost-color', label: 'Color By', icon: 'eye', action: 'costColor',
                menu: [{ value: 'off', label: 'Off' }, { value: 'item', label: 'Item' }, { value: 'cost', label: 'Cost' }],
              },
            ],
          },
        ],
      },
    ],
    initialTab: 'costos',
    blurb: 'See what the cost system says each element costs.',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: 'phases',
    ribbon: [
      {
        id: 'cronograma',
        label: 'Schedule',
        groups: [
          {
            label: 'Task',
            buttons: [
              { id: 'sch-new', label: 'New Task', icon: 'phases', action: 'schNew' },
              { id: 'sch-edit', label: 'Edit Task', icon: 'detail', action: 'schEdit' },
              { id: 'sch-delete', label: 'Delete Task', icon: 'close', action: 'schDelete' },
            ],
          },
          {
            label: 'Elements',
            buttons: [
              { id: 'sch-link', label: 'Link Selection', icon: 'link', action: 'schLink' },
              { id: 'sch-bylevel', label: 'Tasks by Level', icon: 'level', action: 'schByLevel' },
            ],
          },
          {
            label: 'Display',
            buttons: [
              {
                id: 'sch-future', label: 'Future', icon: 'eye', action: 'schFuture',
                menu: [{ value: 'hidden', label: 'Hidden' }, { value: 'ghost', label: 'Ghost' }],
              },
            ],
          },
          {
            label: 'Plan',
            buttons: [
              { id: 'sch-critical', label: 'Critical Path', icon: 'line', action: 'schCritical', toggle: true },
              { id: 'sch-baseline', label: 'Set Baseline', icon: 'check', action: 'schBaseline' },
            ],
          },
          {
            label: 'Exchange',
            buttons: [
              { id: 'sch-import', label: 'Import', icon: 'open', action: 'schImport' },
              { id: 'sch-export', label: 'Export', icon: 'file', action: 'schExport' },
            ],
          },
          { label: 'Settings', buttons: [{ id: 'sch-calendar', label: 'Calendar', icon: 'settings', action: 'schCalendar' }] },
        ],
      },
    ],
    initialTab: 'cronograma',
    blurb: 'Plan the construction over time, find the critical path and play it in 3D.',
  },
];

export const MODE_IDS: ModeId[] = MODES.map((m) => m.id);

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && (MODE_IDS as string[]).includes(v);
}
