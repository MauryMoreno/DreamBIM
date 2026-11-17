import type { StudioIcon } from '../shell/icons';

export const SOON = 'Coming soon';

export type ViewAction =
  | 'view3d'
  | 'plan'
  | 'front'
  | 'side'
  | 'fit'
  | 'xray'
  | 'section'
  | 'shadows'
  | 'grid'
  | 'walk'
  | 'screenshot'
  | 'wall'
  | 'floor'
  | 'level'
  | 'levels'
  | 'lod'
  // modo Materials (modes/definition.ts)
  | 'matNew'
  | 'matAssign'
  | 'matRule'
  | 'matColors'
  // modo Costs
  | 'costEdit'
  | 'costEditSystem'
  | 'costAssign'
  | 'costClearAssign'
  | 'costColor'
  // modo Schedule
  | 'schNew'
  | 'schEdit'
  | 'schDelete'
  | 'schLink'
  | 'schByLevel'
  | 'schFuture'
  | 'schCalendar'
  | 'schCritical'
  | 'schBaseline'
  | 'schImport'
  | 'schExport'
  // contextual tab of the floor sketch (FLOOR_SKETCH_TAB)
  | 'sketchFinish'
  | 'sketchCancel'
  | 'sketchPick'
  | 'sketchLine'
  | 'sketchRect';

export interface RibbonButton {
  id: string;
  label: string;
  icon: StudioIcon;
  /** Only the buttons with an action are active; the rest are shown disabled. */
  action?: ViewAction;
  /** Two-state button (aria-pressed). */
  toggle?: boolean;
  /** Radio button: among the buttons with the same `radio` only one is pressed (and pressing it again does not release it). */
  radio?: string;
  /** Button with a dropdown menu of options (radio): the action arrives with the chosen value. */
  menu?: { value: string; label: string }[];
}

export interface RibbonGroup {
  label: string;
  buttons: RibbonButton[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

/** Contextual tab of a floor sketch (Modify | Create Floor Boundary): it is not in RIBBON, it appears when entering it. */
export const FLOOR_SKETCH_TAB: RibbonTab = {
  id: 'floor-sketch',
  label: 'Modify | Create Floor Boundary',
  groups: [
    {
      label: 'Mode',
      buttons: [
        { id: 'sk-finish', label: 'Finish Edit Mode', icon: 'check', action: 'sketchFinish' },
        { id: 'sk-cancel', label: 'Cancel Edit Mode', icon: 'close', action: 'sketchCancel' },
      ],
    },
    {
      label: 'Draw',
      buttons: [
        { id: 'sk-pick', label: 'Pick Walls', icon: 'pickWalls', action: 'sketchPick', radio: 'draw' },
        { id: 'sk-line', label: 'Line', icon: 'line', action: 'sketchLine', radio: 'draw' },
        { id: 'sk-rect', label: 'Rectangle', icon: 'rectangle', action: 'sketchRect', radio: 'draw' },
      ],
    },
  ],
};

/** Ribbon tabs. "File" is not here: it is a separate button (see filemenu.ts). */
export const RIBBON: RibbonTab[] = [
  {
    id: 'arquitectura',
    label: 'Architecture',
    groups: [
      {
        label: 'Build',
        buttons: [
          { id: 'arq-muro', label: 'Wall', icon: 'wall', action: 'wall', toggle: true },
          { id: 'arq-puerta', label: 'Door', icon: 'door' },
          { id: 'arq-ventana', label: 'Window', icon: 'window' },
          { id: 'arq-suelo', label: 'Floor', icon: 'floor', action: 'floor', toggle: true },
          { id: 'arq-cubierta', label: 'Roof', icon: 'roof' },
          { id: 'arq-pilar', label: 'Column', icon: 'column' },
        ],
      },
      {
        label: 'Circulation',
        buttons: [
          { id: 'arq-escalera', label: 'Stair', icon: 'stairs' },
          { id: 'arq-rampa', label: 'Ramp', icon: 'ramp' },
        ],
      },
      {
        label: 'Datum',
        buttons: [
          { id: 'arq-nivel', label: 'Level', icon: 'level', action: 'level' },
          { id: 'arq-rejilla', label: 'Grid', icon: 'grid' },
        ],
      },
      {
        label: 'Modify',
        buttons: [
          { id: 'arq-mover', label: 'Move', icon: 'move' },
          { id: 'arq-copiar', label: 'Copy', icon: 'copy' },
          { id: 'arq-rotar', label: 'Rotate', icon: 'rotate' },
        ],
      },
    ],
  },
  {
    id: 'estructura',
    label: 'Structure',
    groups: [
      {
        label: 'Structure',
        buttons: [
          { id: 'est-pilar', label: 'Column', icon: 'column' },
          { id: 'est-viga', label: 'Beam', icon: 'beam' },
          { id: 'est-arriostramiento', label: 'Brace', icon: 'brace' },
        ],
      },
      {
        label: 'Foundation',
        buttons: [
          { id: 'est-zapata', label: 'Footing', icon: 'foundation' },
          { id: 'est-losa', label: 'Slab', icon: 'floor' },
        ],
      },
      {
        label: 'Datum',
        buttons: [
          { id: 'est-nivel', label: 'Level', icon: 'level', action: 'level' },
          { id: 'est-rejilla', label: 'Grid', icon: 'grid' },
        ],
      },
    ],
  },
  {
    id: 'insertar',
    label: 'Insert',
    groups: [
      {
        label: 'Link',
        buttons: [
          { id: 'ins-vincular-ifc', label: 'Link IFC', icon: 'link' },
          { id: 'ins-importar', label: 'Import', icon: 'open' },
        ],
      },
      {
        label: 'Image',
        buttons: [{ id: 'ins-imagen', label: 'Image', icon: 'image' }],
      },
      {
        label: 'Load from Library',
        buttons: [
          { id: 'ins-familia', label: 'Load Family', icon: 'folder' },
          { id: 'ins-detalle', label: 'Detail', icon: 'detail' },
        ],
      },
    ],
  },
  {
    id: 'anotar',
    label: 'Annotate',
    groups: [
      {
        label: 'Dimension',
        buttons: [
          { id: 'ano-cota', label: 'Aligned Dimension', icon: 'dimension' },
          { id: 'ano-nivel', label: 'Spot Elevation', icon: 'level' },
        ],
      },
      {
        label: 'Text',
        buttons: [
          { id: 'ano-texto', label: 'Text', icon: 'text' },
          { id: 'ano-etiqueta', label: 'Tag', icon: 'tag' },
        ],
      },
      {
        label: 'Detail',
        buttons: [{ id: 'ano-detalle', label: 'Detail Line', icon: 'detail' }],
      },
    ],
  },
  {
    id: 'vista',
    label: 'View',
    groups: [
      {
        label: 'Create',
        buttons: [
          { id: 'vis-3d', label: '3D View', icon: 'cube3d', action: 'view3d' },
          { id: 'vis-planta', label: 'Floor Plan', icon: 'plan', action: 'plan' },
          { id: 'vis-frontal', label: 'Front Elevation', icon: 'elevation', action: 'front' },
          { id: 'vis-lateral', label: 'Side Elevation', icon: 'elevation', action: 'side' },
        ],
      },
      {
        label: 'Graphics',
        buttons: [
          { id: 'vis-rayosx', label: 'X-Ray', icon: 'xray', action: 'xray', toggle: true },
          { id: 'vis-seccion', label: 'Section', icon: 'section', action: 'section', toggle: true },
          { id: 'vis-sombras', label: 'Shadows', icon: 'sun', action: 'shadows', toggle: true },
          { id: 'vis-rejilla', label: 'Grid', icon: 'grid', action: 'grid', toggle: true },
          {
            id: 'vis-niveles', label: 'Levels', icon: 'level', action: 'levels',
            menu: [{ value: 'off', label: 'Off' }, { value: 'outline', label: 'Outline' }, { value: 'plane', label: 'Plane' },
              { value: 'selected', label: 'Selected' }],
          },
          {
            id: 'vis-detalle', label: 'Detail', icon: 'detail', action: 'lod',
            menu: [{ value: '-1', label: 'Refined' }, { value: '0', label: 'Original' }, { value: '1', label: 'LOD 1' },
              { value: '2', label: 'LOD 2' }],
          },
        ],
      },
      {
        label: 'Navigate',
        buttons: [
          { id: 'vis-encuadrar', label: 'Fit to View', icon: 'fit', action: 'fit' },
          { id: 'vis-recorrido', label: 'Walk', icon: 'walk', action: 'walk', toggle: true },
          { id: 'vis-captura', label: 'Screenshot', icon: 'camera', action: 'screenshot' },
        ],
      },
    ],
  },
  {
    id: 'gestionar',
    label: 'Manage',
    groups: [
      {
        label: 'Settings',
        buttons: [
          { id: 'ges-ajustes', label: 'Settings', icon: 'settings' },
          { id: 'ges-parametros', label: 'Parameters', icon: 'params' },
        ],
      },
      {
        label: 'Phases',
        buttons: [{ id: 'ges-fases', label: 'Phases', icon: 'phases' }],
      },
      {
        label: 'Inquiry',
        buttons: [{ id: 'ges-buscar', label: 'Search', icon: 'search' }],
      },
    ],
  },
];
