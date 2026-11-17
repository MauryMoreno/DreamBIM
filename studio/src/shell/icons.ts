// Own line-stroke icons (24x24, stroke currentColor). Each entry is
// the inner content of the <svg>. To add an icon: a new key in ICONS.
const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICONS = {
  open: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  undo: '<path d="M9 6L4 11l5 5"/><path d="M4 11h10a6 6 0 0 1 0 12"/>',
  redo: '<path d="M15 6l5 5-5 5"/><path d="M20 11H10a6 6 0 0 0 0 12"/>',
  cube3d: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  assistant: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  // visual styles of the view bar (like Revit's): the same cube with a different fill
  styleWireframe: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/><path d="M12 3v9M12 12l-8 4.5M12 12l8 4.5" stroke-dasharray="1.5 1.5"/>',
  styleHidden: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  styleShaded: '<path d="M12 3l8 4.5-8 4.5-8-4.5z" fill="currentColor" fill-opacity="0.15" stroke="none"/><path d="M4 7.5l8 4.5v9l-8-4.5z" fill="currentColor" fill-opacity="0.6" stroke="none"/><path d="M12 12l8-4.5v9L12 21z" fill="currentColor" fill-opacity="0.35" stroke="none"/><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  styleConsistent: '<path d="M12 3l8 4.5-8 4.5-8-4.5z" fill="currentColor" fill-opacity="0.4" stroke="none"/><path d="M4 7.5l8 4.5v9l-8-4.5z" fill="currentColor" fill-opacity="0.4" stroke="none"/><path d="M12 12l8-4.5v9L12 21z" fill="currentColor" fill-opacity="0.4" stroke="none"/><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  styleTextures: '<path d="M12 3l8 4.5-8 4.5-8-4.5z" fill="currentColor" fill-opacity="0.15" stroke="none"/><path d="M4 7.5l8 4.5v9l-8-4.5z" fill="currentColor" fill-opacity="0.6" stroke="none"/><path d="M12 12l8-4.5v9L12 21z" fill="currentColor" fill-opacity="0.35" stroke="none"/><path d="M4 11.5l8 4.5M8 9.7v4.5M8 14.2v4.5M12 16v5M16 11.8v4.5M20 11.5l-8 4.5" stroke-width="1"/><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>',
  minimize: '<path d="M6 17h12"/>',
  maximize: '<rect x="6" y="6" width="12" height="12"/>',
  restore: '<rect x="5" y="9" width="10" height="10"/><path d="M9 9V5h10v10h-4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  pickWalls: '<rect x="3" y="6" width="9" height="12"/><path d="M12 12h9M18 9l3 3-3 3"/>',
  line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
  rectangle: '<rect x="4" y="7" width="16" height="10"/><circle cx="4" cy="7" r="1.3"/><circle cx="20" cy="17" r="1.3"/>',
  wall: '<rect x="3" y="6" width="18" height="12"/><path d="M3 10h18M3 14h18M9 6v4M15 10v4M9 14v4"/>',
  door: '<path d="M6 21V4h12v17"/><path d="M4 21h16"/><circle cx="15" cy="13" r="0.8"/>',
  window: '<rect x="5" y="4" width="14" height="16"/><path d="M12 4v16M5 12h14"/>',
  floor: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M3 14l9 5 9-5"/>',
  roof: '<path d="M3 13l9-8 9 8"/><path d="M6 11v8h12v-8"/>',
  column: '<path d="M7 5h10M8 5v14M16 5v14M6 19h12"/>',
  level: '<path d="M3 12h18"/><path d="M8 12V6l4 2-4 2"/><path d="M6 17h12"/>',
  grid: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v5h-5"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="9" y="9" width="6" height="6"/>',
  xray: '<rect x="4" y="4" width="11" height="11"/><rect x="9" y="9" width="11" height="11" stroke-dasharray="2 2"/>',
  section: '<path d="M3 12h18" stroke-dasharray="3 2"/><path d="M12 3v6M12 15v6"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  walk: '<circle cx="13" cy="5" r="1.8"/><path d="M13 8l-2 5 3 3v5M11 13l-3 2M13 9l3 3 3 1M14 16l3 4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  plan: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h8V4M12 12v8M16 12h4"/>',
  elevation: '<path d="M3 20h18"/><rect x="6" y="8" width="12" height="12"/><path d="M4 8l8-4 8 4"/>',
  folder: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 11h18"/>',
  tree: '<rect x="3" y="4" width="6" height="4"/><rect x="12" y="10" width="8" height="4"/><rect x="12" y="16" width="8" height="4"/><path d="M6 8v10h6M6 12h6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.5 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-down': '<path d="M5 9l7 7 7-7"/>',
  'chevron-up': '<path d="M5 15l7-7 7 7"/>',
  stairs: '<path d="M3 20h5v-4h5v-4h5V8h3"/><path d="M3 20v1h18V8"/>',
  ramp: '<path d="M3 19L21 7"/><path d="M3 19h18V7"/><path d="M8 19v-3M13 19v-6M18 19V10"/>',
  beam: '<rect x="3" y="9" width="18" height="6"/><path d="M3 12h18"/><path d="M7 9v6M17 9v6"/>',
  foundation: '<path d="M9 4h6v8H9z"/><path d="M4 12h16v4H4z"/><path d="M3 20h18"/>',
  brace: '<rect x="4" y="4" width="16" height="16"/><path d="M4 4l16 16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3" y="5" width="18" height="14"/><circle cx="9" cy="10" r="1.8"/><path d="M3 17l5-4 4 3 3-2 6 4"/>',
  text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  dimension: '<path d="M4 8v8M20 8v8"/><path d="M4 12h16"/><path d="M7 10l-3 2 3 2M17 10l3 2-3 2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  detail: '<rect x="4" y="4" width="16" height="16"/><path d="M4 10h16M10 4v16"/><path d="M13 14l5 5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  phases: '<rect x="3" y="4" width="6" height="16"/><rect x="9" y="4" width="6" height="16" stroke-dasharray="2 2"/><path d="M17 8l4 4-4 4"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  params: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
} as const satisfies Record<string, string>;

export type StudioIcon = keyof typeof ICONS;

/** An icon already parsed by name and size: parsing the SVG on every row of a big tree is expensive. */
const templates = new Map<string, SVGElement>();

export function svgIcon(name: StudioIcon, size = 16): SVGElement {
  const key = `${name}:${size}`;
  let t = templates.get(key);
  if (!t || t.ownerDocument !== document) {
    t = buildIcon(name, size);
    templates.set(key, t);
  }
  return t.cloneNode(true) as SVGElement;
}

function buildIcon(name: StudioIcon, size: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = ICONS[name];
  return svg;
}
