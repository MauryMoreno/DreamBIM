// Help guide (Help button and F1): how the model is composed with layers, in three steps with drawings.
// The drawings are our own SVGs with the layer colors of Studio; the text uses currentColor.
import { DOCUMENT_COLOR, LAYER_COLORS } from '../composer/stack';

interface Step {
  title: string;
  svg: string;
  text: string[];
  legend?: [string, string][];
}

const [BLUE, ORANGE] = LAYER_COLORS.slice(0, 2);
const DOC = DOCUMENT_COLOR;

/** Una hoja de la pila en perspectiva (paralelogramo) con su etiqueta a la derecha. */
const sheet = (y: number, color: string, label: string, opacity = 0.9) =>
  `<polygon points="70,${y + 30} 210,${y + 30} 250,${y} 110,${y}" fill="${color}" fill-opacity="${opacity}"/>` +
  `<text x="262" y="${y + 20}">${label}</text>`;

const LAYERS_SVG = `
<svg viewBox="0 0 400 200" role="img" aria-label="Four layers stacked like sheets of paper">
  ${sheet(150, BLUE, 'File A')}
  ${sheet(112, BLUE, 'Edits of File A', 0.4)}
  ${sheet(74, ORANGE, 'File B')}
  ${sheet(36, DOC, 'Your document')}
  <path d="M30 180 V40" stroke="currentColor" stroke-width="1.5" marker-end="url(#help-arrow)"/>
  <text x="14" y="196" font-size="11">first</text>
  <text x="16" y="30" font-size="11">last</text>
  <defs><marker id="help-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>
</svg>`;

const WINS_SVG = `
<svg viewBox="0 0 400 200" role="img" aria-label="A wall 2.5 m high plus an edit that sets 3 m gives a 3 m wall">
  <rect x="20" y="70" width="90" height="75" fill="${BLUE}"/>
  <text x="20" y="166">File A</text>
  <text x="20" y="182" font-size="11">Wall · 2.5 m · blue</text>
  <text x="124" y="114" font-size="20">+</text>
  <rect x="150" y="45" width="90" height="100" fill="none" stroke="${BLUE}" stroke-width="2" stroke-dasharray="5 4"/>
  <text x="166" y="100" font-weight="600">3 m</text>
  <text x="150" y="166">Edits of File A</text>
  <text x="150" y="182" font-size="11">Height · 3 m</text>
  <text x="254" y="114" font-size="20">=</text>
  <rect x="285" y="45" width="90" height="100" fill="${BLUE}"/>
  <text x="285" y="166">What you see</text>
  <text x="285" y="182" font-size="11">Wall · 3 m · blue</text>
</svg>`;

/** Fila del panel Layer dibujada: asa, casilla, color, nombre y, si va, ojo. */
const row = (y: number, color: string, name: string, opts: { indent?: boolean; eye?: boolean; tag?: string } = {}) => {
  const x = opts.indent ? 46 : 26;
  return (
    `<rect x="10" y="${y}" width="300" height="30" rx="3" fill="currentColor" fill-opacity="0.06"/>` +
    (opts.indent ? '' : `<text x="16" y="${y + 20}" font-size="12" fill-opacity="0.6">⠿</text>`) +
    `<rect x="${x + 4}" y="${y + 9}" width="12" height="12" rx="2" fill="none" stroke="currentColor"/>` +
    `<path d="M${x + 6} ${y + 15} l3 3 l5 -6" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    (color ? `<rect x="${x + 24}" y="${y + 9}" width="12" height="12" rx="2" fill="${color}"/>` : '') +
    `<text x="${x + (color ? 44 : 24)}" y="${y + 20}">${name}</text>` +
    (opts.eye
      ? `<g transform="translate(284 ${y + 15})" fill="none" stroke="currentColor"><path d="M-8 0 q8 -7 16 0 q-8 7 -16 0z"/><circle r="2.2"/></g>`
      : '') +
    (opts.tag ? `<text x="300" y="${y + 20}" text-anchor="end" font-size="11" fill-opacity="0.7">${opts.tag}</text>` : '')
  );
};

const STUDIO_SVG = `
<svg viewBox="0 0 400 200" role="img" aria-label="The Layer tab with two files, the edits of one, and the document last">
  <text x="10" y="18" font-weight="600">Layer</text>
  ${row(30, BLUE, 'File A', { eye: true })}
  ${row(64, '', '↳ Edits · File A', { indent: true, tag: '1 edit' })}
  ${row(98, ORANGE, 'File B', { eye: true })}
  ${row(132, DOC, 'Your document', { tag: 'Document' })}
  <path d="M330 40 V160" stroke="currentColor" stroke-width="1.5" marker-end="url(#help-arrow2)"/>
  <text x="342" y="90" font-size="11">laid down</text>
  <text x="342" y="104" font-size="11">in this</text>
  <text x="342" y="118" font-size="11">order;</text>
  <text x="342" y="132" font-size="11">last wins</text>
  <defs><marker id="help-arrow2" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>
</svg>`;

export const HELP_STEPS: readonly Step[] = [
  {
    title: 'Layers',
    svg: LAYERS_SVG,
    text: [
      "Your model isn't one file. It's a stack of layers, like sheets of tracing paper laid one on top of another.",
      'Each linked .ifcx file is a layer. Right on top of it sits its edit layer: the changes you make to that file are kept there, and the file itself is never touched.',
      'Your document is always laid down last.',
    ],
  },
  {
    title: 'Who wins',
    svg: WINS_SVG,
    text: [
      'Several layers can describe the same element. When they disagree, the layer laid down later wins.',
      'Here File A says the wall is 2.5 m high and its edits say 3 m, so you see a 3 m wall. What the edits don’t mention, like the color, comes through from below.',
      'Your document is laid down last, so it wins over everything.',
    ],
  },
  {
    title: 'In Dream BIM',
    svg: STUDIO_SVG,
    text: ['The Layer tab lists the stack in the order it is laid down: the top row first, your document last.'],
    legend: [
      ['⠿ Drag', 'Move a file up or down the stack.'],
      ['☑ Checkbox', 'Take a layer out of the model completely.'],
      ['Eye', 'Only hide a layer in the view. It still counts in the model.'],
      ['↳ Edits', 'Turn off to see the original file. Its elements can’t be edited while the edits are off.'],
      ['Color', 'Each layer gets its own color, so you can tell them apart in the Stage tab too.'],
    ],
  },
];

let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Opens the guide as a modal dialog. It closes with Esc, ✕, Done or a click on the scrim; the focus goes back to
 * where it was. If it is already open, the new request resolves without opening another one.
 */
export function openHelp(opts: { /** Adds a "Take the tour" button that closes the guide and calls this. */ onTour?: () => void } = {}): Promise<void> {
  if (open) return Promise.resolve();
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal help-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'help-title');

  const head = el('div', 'modal-title help-head');
  const title = el('span', '', 'How the model is composed');
  title.id = 'help-title';
  const close = el('button', 'help-close', '✕');
  close.type = 'button';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  head.append(title, close);

  const tabs = el('div', 'help-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = HELP_STEPS.map((s, i) => {
    const b = el('button', 'help-tab', `${i + 1} · ${s.title}`);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(i));
    return b;
  });
  tabs.append(...tabButtons);

  const body = el('div', 'help-body');
  body.setAttribute('role', 'tabpanel');

  const row = el('div', 'modal-buttons help-buttons');
  const back = el('button', 'modal-btn', 'Back');
  back.type = 'button';
  const next = el('button', 'modal-btn modal-btn-primary', 'Next');
  next.type = 'button';
  const tour = el('button', 'modal-btn help-tour', 'Take the tour');
  tour.type = 'button';
  row.append(...(opts.onTour ? [tour] : []), back, next);

  box.append(head, tabs, body, row);
  scrim.append(box);

  let step = 0;
  function show(i: number): void {
    step = i;
    const s = HELP_STEPS[i];
    const figure = el('div', 'help-figure');
    figure.innerHTML = s.svg; // dibujo propio y fijo, sin datos de archivos
    const stepTitle = el('h3', 'help-step-title', s.title);
    body.replaceChildren(figure, stepTitle, ...s.text.map((t) => el('p', 'help-text', t)));
    if (s.legend) {
      const dl = el('dl', 'help-legend');
      for (const [term, def] of s.legend) dl.append(el('dt', '', term), el('dd', '', def));
      body.append(dl);
    }
    tabButtons.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    back.disabled = i === 0;
    next.textContent = i === HELP_STEPS.length - 1 ? 'Done' : 'Next';
  }

  return new Promise<void>((resolve) => {
    const finish = () => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve();
    };
    close.addEventListener('click', finish);
    tour.addEventListener('click', () => {
      finish();
      opts.onTour?.();
    });
    back.addEventListener('click', () => show(Math.max(0, step - 1)));
    next.addEventListener('click', () => (step === HELP_STEPS.length - 1 ? finish() : show(step + 1)));

    // the keyboard does not leave the dialog: not even the workspace shortcuts see Esc or the arrows
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const to = step + (e.key === 'ArrowRight' ? 1 : -1);
        if (to >= 0 && to < HELP_STEPS.length) show(to);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const focusable = [...box.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const i = focusable.indexOf(document.activeElement as HTMLButtonElement);
        const d = e.shiftKey ? -1 : 1;
        focusable[(i + d + focusable.length) % focusable.length].focus();
      }
    });

    // a click on the scrim closes; pressing on the dialog does not take its focus away
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) e.preventDefault();
    });
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) finish();
    });

    show(0);
    document.body.append(scrim);
    next.focus();
  });
}
