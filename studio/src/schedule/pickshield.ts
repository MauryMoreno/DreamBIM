// While elements are chosen in the model for a task, only the 3d model is active: everything else in the
// window (ribbon, panels, bars) stays inert —no clicks or focus— and dimmed. It is marked `inert` on the
// siblings of `active` and of each one of its ancestors up to the body; the modal that is compressed into a strip
// (`.modal-scrim`) se deja activo para poder terminar.
let marked: Element[] = [];

export function setPickShield(active: Element, on: boolean): void {
  for (const e of marked) {
    e.removeAttribute('inert');
    e.classList.remove('is-pick-dim');
  }
  marked = [];
  if (!on) return;
  for (let node: Element = active; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.classList.contains('modal-scrim') || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      sibling.classList.add('is-pick-dim');
      marked.push(sibling);
    }
  }
}
