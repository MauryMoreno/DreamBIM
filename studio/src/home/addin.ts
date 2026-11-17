// Revit add-in of the web demo: reads the manifest in dist/descargas/ and shows the download dialog.

export interface AddinInfo {
  url: string;
  sourceUrl: string;
  version: string;
  sizeMB: number;
}

/** Un nombre de archivo del manifiesto: un zip simple, sin carpetas ni `..`. */
function isZipName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.endsWith('.zip') &&
    value.length > '.zip'.length &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('..')
  );
}

/** Reads <base>descargas/addin.json. Any failure (network, 404, HTML, invalid JSON, missing fields) gives null. */
export async function loadAddin(base: string, fetchFn: typeof fetch = fetch): Promise<AddinInfo | null> {
  try {
    const dir = base.endsWith('/') ? base : `${base}/`;
    const res = await fetchFn(`${dir}descargas/addin.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return null;
    const { file, version, sizeMB, source } = data;
    if (!isZipName(file) || !isZipName(source)) return null;
    if (typeof version !== 'string' || version === '') return null;
    if (typeof sizeMB !== 'number' || !Number.isFinite(sizeMB) || sizeMB < 0) return null;
    return {
      url: `${dir}descargas/${file}`,
      sourceUrl: `${dir}descargas/${source}`,
      version,
      sizeMB,
    };
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Modal dialog; it closes with Close, Escape or a click outside. */
export function showAddinDialog(info: AddinInfo): void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal addin-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'addin-title');

  const title = el('div', 'modal-title', 'Revit add-in');
  title.id = 'addin-title';

  const download = el('a', 'addin-download', `Download (${info.sizeMB} MB)`);
  download.href = info.url;
  download.download = info.url.split('/').pop() ?? '';
  const source = el('a', undefined, 'Source code');
  source.href = info.sourceUrl;
  const links = el('div', 'addin-links');
  links.append(download, source);

  const close = el('button', 'modal-btn modal-btn-primary', 'Close');
  close.type = 'button';
  const row = el('div', 'modal-buttons');
  row.append(close);

  box.append(
    title,
    el('p', 'addin-text', 'Export your own Revit model as .ifcx and open it here.'),
    el('p', 'addin-text', 'Requires Windows and Revit 2026.'),
    el('p', 'addin-text', "While installed it replaces Revit's built-in IFC exporter. Desinstalar.cmd, inside the zip, restores it."),
    el('p', 'addin-text', 'Unofficial fork of Autodesk revit-ifc, not signed: Revit asks once to load it — choose Always Load.'),
    links,
    el('div', 'addin-version', `Version ${info.version}`),
    row,
  );
  scrim.append(box);

  const finish = () => {
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    if (previous?.isConnected) previous.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  };

  close.addEventListener('click', finish);
  // a click on the scrim closes; clicks inside the dialog do not
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) finish();
  });
  document.addEventListener('keydown', onKey);

  document.body.append(scrim);
  close.focus();
}
