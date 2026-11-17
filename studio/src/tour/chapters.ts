// The tour itself: short chapters, each a list of steps over the real interface. The steps only know
// the app through its DOM (selectors and a few attributes), so the tour depends on no other feature.
import type { TourStep } from './engine';

export interface TourChapter {
  id: string;
  title: string;
  /** One line for the chapter list. */
  summary: string;
  steps: TourStep[];
}

const inWorkspace = (): boolean => document.body.dataset.screen === 'workspace';
const modeIs = (label: string) => (): boolean => document.querySelector('.tb-mode.active')?.textContent?.trim() === label;
const selected = (selector: string) => (): boolean => document.querySelector(selector)?.getAttribute('aria-selected') === 'true';
const assistantOpen = (): boolean => {
  const pane = document.querySelector('.ws-assistant');
  return !!pane && !pane.classList.contains('is-collapsed') && inWorkspace();
};

/** Chapters about the workspace start here when no model is open yet. */
const OPEN_MODEL: TourStep = {
  id: 'open-model',
  title: 'Open a model',
  text: ['The rest of the tour happens inside a model. Pick an example or a recent model, or use Open… to choose an .ifcx file.'],
  target: ['.home-examples .recent-card', '.home-recents .recent-card:not(.missing)', '.home-side .home-action'],
  prefer: 'right',
  task: { hint: 'Open a model from Home.', until: inWorkspace },
  when: () => !inWorkspace(),
};

const GETTING_STARTED: TourChapter = {
  id: 'start',
  title: 'Getting started',
  summary: 'What Dream BIM is, the Home screen and the title bar.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Dream BIM',
      text: [
        'Dream BIM opens, composes, models, classifies, prices and schedules IFCx models.',
        'It never rewrites the original model file. Everything you add goes into separate IFCx layers that sit on top of it.',
        'This tour runs over the real app: when a step says "Try it", do it and the tour moves on by itself.',
      ],
    },
    {
      id: 'home',
      title: 'Home',
      text: [
        'Open… loads an .ifcx model and New… starts an empty one. Your recent models show on the right with a thumbnail.',
        'Collection shows your library as cards, and Documents browses the folders of the project.',
      ],
      target: '.home-side',
      prefer: 'right',
      when: () => !inWorkspace(),
    },
    OPEN_MODEL,
    {
      id: 'quick-access',
      title: 'Quick access',
      text: ['These buttons are always at hand: Open, Home, Undo and Redo, Theme, 3D View, the Assistant and Help.'],
      target: '.tb-qat',
    },
    {
      id: 'modes',
      title: 'Four modes',
      text: [
        'A model is worked in four modes: Model, Materials, Costs and Schedule. Each one changes the ribbon and the panels.',
        'Switch with these tabs, with Ctrl+1 to Ctrl+4, or with Ctrl+Tab.',
      ],
      target: '.tb-mode-list',
    },
  ],
};

const WORKSPACE: TourChapter = {
  id: 'workspace',
  title: 'The workspace',
  summary: 'Ribbon, Properties, Project Browser, views and the Library.',
  steps: [
    OPEN_MODEL,
    {
      id: 'ribbon',
      title: 'Ribbon',
      text: [
        'The tools of the current mode, grouped in tabs. In Model mode: Architecture, Structure, Insert, Annotate, View and Manage.',
        'A greyed-out button is a tool that is coming soon.',
      ],
      target: '.ws-ribbon',
    },
    {
      id: 'view',
      title: 'Views',
      text: ['The model is shown here. Each open view (3D, floor plan or elevation) is a tab above it.'],
      target: '.ws-view',
      task: { hint: 'Click any element in the view.', click: '.ws-canvas' },
    },
    {
      id: 'properties',
      title: 'Properties',
      text: ['The data of what you selected: its type, its level and its other properties.'],
      target: '.ws-props',
      prefer: 'right',
    },
    {
      id: 'browser',
      title: 'Project Browser',
      text: ['The views of the model. Double-click one to open it in a new tab.'],
      target: '.ws-browser',
      prefer: 'right',
    },
    {
      id: 'viewcube',
      title: 'ViewCube',
      text: ['Shows where the camera looks from. Its faces, edges and corners turn the view, and the house brings back the starting view.'],
      target: '.viewcube',
      prefer: 'left',
      task: { hint: 'Click a face of the cube.', click: '.viewcube' },
    },
    {
      id: 'viewbar',
      title: 'View controls',
      text: ['Each view keeps its own look: the visual style and the shadows are set here.'],
      target: '.ws-viewbar',
      prefer: 'top',
    },
    {
      id: 'library',
      title: 'Library',
      text: ['Your library of .ifcx items. Drag one into the view to place it in the model.'],
      target: '.ws-library',
      prefer: 'top',
    },
  ],
};

const LAYERS: TourChapter = {
  id: 'layers',
  title: 'Layers',
  summary: 'How a model is stacked from files, and the Stage, Layer and References tabs.',
  steps: [
    OPEN_MODEL,
    {
      id: 'composer',
      title: 'A model is a stack',
      text: [
        "Your model isn't one file. It is a stack of layers, like sheets of tracing paper: each linked .ifcx file is a layer, and your document is laid down last.",
        'This column shows that stack in three tabs.',
      ],
      target: '.ws-right',
      prefer: 'left',
    },
    {
      id: 'stage',
      title: 'Stage',
      text: ['The result of the stack as one tree. Each row carries the color of the layer it comes from.'],
      target: ['.ws-stage', '#ws-ctab-stage'],
      prefer: 'left',
    },
    {
      id: 'layer-tab',
      title: 'Layer',
      text: ['The Layer tab lists the stack itself, in the order it is laid down.'],
      target: '#ws-ctab-layer',
      prefer: 'left',
      task: { hint: 'Open the Layer tab.', until: selected('#ws-ctab-layer') },
    },
    {
      id: 'layer-panel',
      title: 'Who wins',
      text: [
        'When two layers disagree about an element, the one laid down later wins. Drag a row to change the order.',
        'The checkbox takes a layer out of the model; the eye only hides it in the view.',
        'The edits you make to a linked file are kept in their own layer, right on top of it. The file itself is never touched.',
      ],
      target: ['.ws-layer', '#ws-ctab-layer'],
      prefer: 'left',
    },
    {
      id: 'references',
      title: 'References',
      text: ['Every file the model links, and how many elements use each one.', 'Help (F1) explains the layers again, with pictures.'],
      target: '#ws-ctab-references',
      prefer: 'left',
    },
  ],
};

const MODES: TourChapter = {
  id: 'modes',
  title: 'The four modes',
  summary: 'Model, Materials, Costs and Schedule, and where each one saves.',
  steps: [
    OPEN_MODEL,
    {
      id: 'model-mode',
      title: 'Model',
      text: [
        'Model is where you build: levels, walls and floors. You can also link other .ifcx files and edit their elements without touching them.',
        'It saves to the model file itself.',
      ],
      target: '.tb-mode-list',
    },
    {
      id: 'materials-switch',
      title: 'Materials',
      text: ['Materials says what each element is made of and how it looks.'],
      target: '.tb-mode-list',
      task: { hint: 'Switch to Materials (Ctrl+2).', until: modeIs('Materials') },
    },
    {
      id: 'materials',
      title: 'Materials tools',
      text: [
        'Create a material, then assign it to the selection or by a rule that picks the elements for you.',
        'It saves to a sibling file: <model>.materials.ifcx.',
      ],
      target: '.ws-ribbon',
    },
    {
      id: 'costs-switch',
      title: 'Costs',
      text: ['Costs builds the bill of quantities: items measured from the model by rule, priced from a catalog and classified with OmniClass.'],
      target: '.tb-mode-list',
      task: { hint: 'Switch to Costs (Ctrl+3).', until: modeIs('Costs') },
    },
    {
      id: 'costs',
      title: 'Costs tools',
      text: [
        'Edit the items and the cost system, assign items to the selection, and color the model by item or by cost. The budget exports to CSV and XLSX.',
        'It saves to <model>.costs.ifcx and <model>.classification.ifcx.',
      ],
      target: '.ws-ribbon',
    },
    {
      id: 'schedule-switch',
      title: 'Schedule',
      text: ['Schedule plans the construction over time: tasks with dependencies and a calendar, shown as a Gantt chart.'],
      target: '.tb-mode-list',
      task: { hint: 'Switch to Schedule (Ctrl+4).', until: modeIs('Schedule') },
    },
    {
      id: 'schedule',
      title: 'Schedule tools',
      text: [
        'Link tasks to elements and press Play to watch the building go up in 3D. Critical Path and the S-curve show how the plan is doing.',
        'It saves to <model>.schedule.ifcx.',
      ],
      target: '.ws-ribbon',
    },
    {
      id: 'model-back',
      title: 'Files that travel together',
      text: [
        'When you open a model, Dream BIM finds its sibling files and stacks them by itself.',
        'To share a model, send those files together.',
      ],
      target: '.tb-mode-list',
      task: { hint: 'Go back to Model (Ctrl+1).', until: modeIs('Model') },
    },
  ],
};

const MORE: TourChapter = {
  id: 'more',
  title: 'Assistant and Collection',
  summary: 'The Assistant, the Collection, saving and where to find help.',
  steps: [
    OPEN_MODEL,
    {
      id: 'assistant',
      title: 'Assistant',
      text: [
        'The Assistant is BuiltBot inside Dream BIM. Ask it about the model: it can query it, select elements, change views and take screenshots.',
        'In the web demo it runs in your browser with your own API key.',
      ],
      target: '.tb-btn[title="Assistant"]',
      task: { hint: 'Open the Assistant (Shift+A).', until: assistantOpen },
    },
    {
      id: 'collection',
      title: 'Collection',
      text: [
        'The Collection shows the library as cards, each with a 3D viewer and its levels of detail.',
        'Open it from Home › Collection.',
      ],
    },
    {
      id: 'save',
      title: 'Saving',
      text: [
        'Ctrl+S saves and Ctrl+Shift+S saves as. Ctrl+Z and Ctrl+Y undo and redo.',
        'In the web demo nothing is stored online: Save downloads the files to your computer.',
      ],
      target: '.tb-qat',
    },
    {
      id: 'help',
      title: 'Help',
      text: ['Help (F1) explains the layers with pictures and brings this tour back whenever you want it.'],
      target: '.tb-btn[title="Help (F1)"]',
    },
  ],
};

export const CHAPTERS: readonly TourChapter[] = [GETTING_STARTED, WORKSPACE, LAYERS, MODES, MORE];
