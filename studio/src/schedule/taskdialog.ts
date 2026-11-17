// Task dialog: name, phase, type, start, duration (0 = milestone), progress, predecessors with their link
// type and lag, and the elements rule.
import { parseDay } from './calendar';
import { DEP_TYPES, type Dep, type DepType, type Task, type TaskKind } from './state';

const KIND_LABELS: [TaskKind, string][] = [['construct', 'Construct'], ['demolish', 'Demolish'], ['temporary', 'Temporary']];

export interface TaskChoices {
  /** The other tasks (possible predecessors). */
  tasks: { id: string; name: string }[];
  classes: string[];
  storeys: string[];
  materials: { code: string; name: string }[];
  /** What the manually linked elements are called (by their edit path). */
  elements?: { key: string; label: string }[];
  /**
   * "Select elements": the dialog is compressed into a strip while elements are chosen in the model (`current` are
   * the keys already linked in the draft and `onPick` receives each batch) and unfolds when `done` resolves;
   * `stop` ends the choosing. Without this the button is disabled.
   */
  pickElements?(current: string[], onPick: (items: { key: string; label: string }[]) => void): { done: Promise<void>; stop(): void };
}

const ANY = '__any__';
let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** null if cancelled (Esc, Cancel) or if a dialog is already open. The dependency cycle is validated by the caller. */
export function askTask(initial: Task, c: TaskChoices): Promise<Task | null> {
  if (open) return Promise.resolve(null);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal sch-task-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Task');
  box.append(el('div', 'modal-title', 'Task'));
  // the strip it is compressed into while elements are chosen in the model, like the range boxes of Excel
  const strip = el('div', 'sch-task-strip');
  const stripText = el('span', 'sch-task-strip-text');
  // con clases propias: `.modal-btn-primary` es Save y `.modal-btn` el resto de botones del pie
  const stripDone = el('button', 'sch-btn sch-strip-done', 'Done');
  stripDone.type = 'button';
  strip.append(stripText, stripDone);
  box.append(strip);
  // the body scrolls if it does not fit; the title and the buttons stay fixed
  const form = el('div', 'sch-task-form');
  box.append(form);
  const grid = el('div', 'sch-grid');
  const ruleGrid = el('div', 'sch-grid sch-grid-3');
  form.append(el('div', 'sch-section', 'General'), grid);

  const field = <T extends HTMLElement>(label: string, control: T, into: HTMLElement = grid, size: 'half' | 'wide' | 'third' = 'half'): T => {
    const wrap = el('label', 'sch-field');
    if (size !== 'half') wrap.classList.add(`is-${size}`);
    wrap.append(el('span', 'sch-field-label', label), control);
    into.append(wrap);
    return control;
  };
  const input = (type: string, value: string) => Object.assign(el('input'), { type, value });
  const select = (options: [string, string][], value: string) => {
    const s = el('select');
    s.append(...options.map(([v, t]) => Object.assign(el('option', undefined, t), { value: v })));
    s.value = value;
    return s;
  };

  const name = field('Name', input('text', initial.name), grid, 'wide');
  const phase = field('Phase', input('text', initial.phase));
  const kind = field('Type', select(KIND_LABELS, initial.kind ?? 'construct'));
  const start = field('Start', input('date', initial.start), grid, 'third');
  const duration = field('Duration (days, 0 = milestone)', input('number', String(initial.duration)), grid, 'third');
  duration.min = '0';
  duration.step = '1';
  const progress = field('% complete', input('number', String(initial.progress ?? 0)), grid, 'third');
  progress.min = '0';
  progress.max = '100';
  progress.step = '1';

  const preds = el('fieldset', 'sch-preds');
  preds.append(el('legend', undefined, 'Predecessors'));
  // con muchas tareas la lista hace scroll y se puede filtrar por nombre
  const list = el('div', 'sch-pred-list');
  const filter = el('input', 'sch-pred-filter');
  filter.type = 'search';
  filter.placeholder = 'Filter tasks…';
  filter.setAttribute('aria-label', 'Filter tasks');
  filter.hidden = c.tasks.length <= 8;
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const row of list.querySelectorAll<HTMLElement>('.sch-pred-row')) row.hidden = !!q && !(row.dataset.name ?? '').includes(q);
  });
  preds.append(filter, list);
  const checks = c.tasks.map((t) => {
    const dep = initial.deps.find((d) => d.task === t.id);
    const line = el('div', 'sch-pred-row');
    line.dataset.name = t.name.toLowerCase();
    const lab = el('label', 'sch-check');
    const cb = Object.assign(el('input'), { type: 'checkbox', value: t.id, checked: !!dep });
    lab.title = t.name; // los nombres largos se cortan en la lista
    lab.append(cb, document.createTextNode(t.name));
    const type = select(DEP_TYPES.map((x): [string, string] => [x, x]), dep?.type ?? 'FS');
    type.setAttribute('aria-label', `Link type to ${t.name}`);
    type.title = 'FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish';
    const lag = Object.assign(input('number', String(dep?.lag ?? 0)), { step: '1', className: 'sch-lag' });
    lag.setAttribute('aria-label', `Lag to ${t.name} (days)`);
    lag.title = 'Lag in working days (negative = lead)';
    const sync = () => {
      type.disabled = !cb.checked;
      lag.disabled = !cb.checked;
    };
    cb.addEventListener('change', sync);
    sync();
    line.append(lab, type, lag);
    list.append(line);
    return { cb, type, lag };
  });
  if (!c.tasks.length) preds.append(el('p', 'sch-empty', 'No other tasks.'));
  form.append(preds);

  const useRule = Object.assign(el('input'), { type: 'checkbox', checked: initial.rule !== null });
  const ruleLabel = el('label', 'sch-check');
  ruleLabel.append(useRule, document.createTextNode('Use a rule'));
  form.append(el('div', 'sch-section', 'Elements'), ruleLabel, ruleGrid);
  const rule = initial.rule ?? {};
  const cls = field('Class', select([[ANY, 'Any'], ...c.classes.map((x): [string, string] => [x, x])], rule.cls ?? ANY), ruleGrid);
  const storey = field('Level', select([[ANY, 'Any'], ...c.storeys.map((x): [string, string] => [x, x])], rule.storey ?? ANY), ruleGrid);
  const material = field(
    'Material',
    select([[ANY, 'Any'], ['', 'No material'], ...c.materials.map((m): [string, string] => [m.code, m.name])], rule.material ?? ANY),
    ruleGrid,
  );
  const sync = () => {
    for (const s of [cls, storey, material]) s.disabled = !useRule.checked;
  };
  useRule.addEventListener('change', sync);
  sync();
  // the elements linked by hand: they can be removed and what is selected in the model is added (saved with Save)
  let linked = [...initial.elements];
  const names = new Map((c.elements ?? []).map((e): [string, string] => [e.key, e.label]));
  const elTitle = el('span', 'sch-elements-title');
  const selectElements = el('button', 'sch-btn', 'Select elements…');
  selectElements.type = 'button';
  selectElements.disabled = !c.pickElements;
  selectElements.title = 'Click elements in the model to add them to this task';
  const elHead = el('div', 'sch-elements-head');
  elHead.append(elTitle, selectElements);
  const elList = el('ul', 'sch-element-list');
  const drawLinked = () => {
    elTitle.textContent = linked.length ? `${linked.length} linked elements` : 'No linked elements';
    elList.hidden = linked.length === 0;
    elList.replaceChildren(
      ...linked.slice(0, 300).map((key) => {
        const li = el('li', 'sch-element-row');
        const label = names.get(key) ?? key;
        const name = el('span', 'sch-element-name', label);
        name.title = label;
        const remove = el('button', 'sch-btn sch-element-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${label}`);
        remove.addEventListener('click', () => {
          linked = linked.filter((k) => k !== key);
          drawLinked();
        });
        li.append(name, remove);
        return li;
      }),
      ...(linked.length > 300 ? [el('li', 'sch-note', `and ${linked.length - 300} more`)] : []),
    );
  };
  const drawStrip = () => {
    stripText.textContent = `${linked.length} linked elements · click elements in the model to add them`;
  };
  /** Compressed, the dialog lets clicks through: only the strip responds and the model can be chosen. */
  const collapse = (on: boolean) => {
    scrim.classList.toggle('is-collapsed', on);
    box.classList.toggle('is-collapsed', on);
  };
  selectElements.addEventListener('click', async () => {
    if (!c.pickElements) return;
    drawStrip();
    collapse(true);
    const session = c.pickElements(linked, (items) => {
      for (const it of items) {
        names.set(it.key, it.label);
        if (!linked.includes(it.key)) linked.push(it.key);
      }
      drawStrip();
    });
    stripDone.onclick = () => session.stop();
    stripDone.focus();
    await session.done;
    collapse(false);
    drawLinked();
    selectElements.focus();
  });
  drawLinked();
  form.append(elHead, elList);
  const error = el('div', 'sch-error');
  error.setAttribute('role', 'alert');
  const row = el('div', 'modal-buttons');
  const foot = el('div', 'sch-task-foot');
  foot.append(error, row);
  box.append(foot);
  scrim.append(box);

  return new Promise((resolve) => {
    const finish = (answer: Task | null) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(answer);
    };
    const ok = el('button', 'modal-btn modal-btn-primary', 'Save');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      const days = Number(duration.value);
      const pct = Number(progress.value);
      if (!name.value.trim()) return void (error.textContent = 'A task needs a name');
      if (Number.isNaN(parseDay(start.value))) return void (error.textContent = 'Enter a valid date');
      if (!Number.isInteger(days) || days < 0) return void (error.textContent = 'Duration must be 0 days or more');
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return void (error.textContent = 'Progress goes from 0 to 100');
      const deps: Dep[] = [];
      for (const x of checks) {
        if (!x.cb.checked) continue;
        const lag = Number(x.lag.value);
        if (!Number.isInteger(lag)) return void (error.textContent = 'A lag is a whole number of days');
        deps.push({ task: x.cb.value, type: x.type.value as DepType, lag });
      }
      let r: Task['rule'] = null;
      if (useRule.checked) {
        r = {};
        if (cls.value !== ANY) r.cls = cls.value;
        if (storey.value !== ANY) r.storey = storey.value;
        if (material.value !== ANY) r.material = material.value;
      }
      const done: Task = {
        ...initial,
        name: name.value.trim(),
        phase: phase.value.trim(),
        start: start.value,
        duration: days,
        deps,
        rule: r,
        elements: linked,
      };
      delete done.kind;
      delete done.progress;
      if (kind.value !== 'construct') done.kind = kind.value as TaskKind;
      if (Math.round(pct) > 0) done.progress = Math.round(pct);
      finish(done);
    });
    const cancel = el('button', 'modal-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    row.append(ok, cancel);
    // the keyboard does not leave the dialog: not even the workspace shortcuts see Esc or Del
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
        e.preventDefault();
        ok.click();
      }
    });
    document.body.append(scrim);
    name.focus();
  });
}
