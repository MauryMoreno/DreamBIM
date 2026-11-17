// Usage: elements, area and volume per material. Clicking a row selects those elements in 3D.
import type { UsageRow } from './catalog';

export interface UsagePanel {
  setRows(rows: UsageRow[]): void;
}

type SortKey = 'name' | 'elements' | 'area' | 'volume';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Material' },
  { key: 'elements', label: 'Elements' },
  { key: 'area', label: 'Area (m²)' },
  { key: 'volume', label: 'Volume (m³)' },
];

const area = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const volume = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountUsagePanel(host: HTMLElement, cb: { onRow(paths: string[]): void }): UsagePanel {
  const root = el('section', 'ws-panel mat-usage');
  root.setAttribute('aria-label', 'Usage');
  const body = el('div', 'ws-panel-body mat-body');
  const table = el('table', 'mat-table');
  const head = el('tr');
  const tbody = el('tbody');
  table.append(el('thead'), tbody);
  table.tHead!.append(head);
  body.append(table);
  root.append(el('header', 'ws-panel-title', 'Usage'), body);
  host.replaceChildren(root);

  let rows: UsageRow[] = [];
  let sortKey: SortKey = 'volume';
  let desc = true;

  const heads = COLUMNS.map((c) => {
    const th = el('th');
    th.scope = 'col';
    const b = el('button', 'mat-sort', c.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      desc = sortKey === c.key ? !desc : c.key !== 'name'; // the numbers start from largest to smallest
      sortKey = c.key;
      render();
    });
    th.append(b);
    head.append(th);
    return th;
  });

  function render(): void {
    COLUMNS.forEach((c, i) =>
      heads[i].setAttribute('aria-sort', c.key === sortKey ? (desc ? 'descending' : 'ascending') : 'none'),
    );
    const sign = desc ? -1 : 1;
    const sorted = [...rows].sort((a, b) =>
      sortKey === 'name' ? sign * a.name.localeCompare(b.name) : sign * (a[sortKey] - b[sortKey]),
    );
    tbody.replaceChildren(
      ...sorted.map((r) => {
        const tr = el('tr', 'mat-usage-row');
        tr.tabIndex = 0;
        const name = el('td');
        const swatch = el('span', 'mat-swatch');
        swatch.style.background = r.color; // dato del usuario, no del tema
        name.append(swatch, document.createTextNode(r.name));
        const num = (text: string) => el('td', 'mat-num', text);
        tr.append(name, num(String(r.elements)), num(area.format(r.area)), num(volume.format(r.volume)));
        const go = () => cb.onRow(r.paths);
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          go();
        });
        return tr;
      }),
    );
  }

  render();
  return {
    setRows(r) {
      rows = r;
      render();
    },
  };
}
