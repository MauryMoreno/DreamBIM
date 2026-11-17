// Floor tool: state machine of the boundary sketch (Pick Walls, Line, Rectangle). No DOM.
import { JOIN_TOLERANCE } from './constants';
import type { Vec2, WallAxis } from './footprint';
import { closeLoop, joinPicked, nearestLine, rectangle, wallAt, wallFace, type LoopResult, type SketchLine } from './sketch';

export type DrawMode = 'pick' | 'line' | 'rect';

const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);

export class FloorTool {
  private on = false;
  private lns: SketchLine[] = [];
  private sel: string | null = null;
  private from: Vec2 | null = null; // inicio del tramo de Line en curso
  private first: Vec2 | null = null; // primer punto de la cadena de Line
  private corner: Vec2 | null = null; // primera esquina de Rectangle
  /** Active drawing tool; null: only lines are selected. */
  mode: DrawMode | null = null;

  get active(): boolean {
    return this.on;
  }

  get lines(): readonly SketchLine[] {
    return this.lns;
  }

  get selected(): string | null {
    return this.sel;
  }

  /** Start of the Line segment in progress (null if the first point is awaited); for the orthogonal snap. */
  get currentStart(): Vec2 | null {
    return this.mode === 'line' ? this.from : null;
  }

  /** Primer punto de la cadena de Line en curso (para el ajuste de cierre). */
  get chainStart(): Vec2 | null {
    return this.mode === 'line' ? this.first : null;
  }

  /** Enters the sketch, with Pick Walls active and no lines. */
  start(): void {
    this.on = true;
    this.lns = [];
    this.sel = null;
    this.mode = 'pick';
    this.dropPending();
  }

  setMode(m: DrawMode | null): void {
    this.mode = m;
    this.sel = null;
    this.dropPending();
  }

  private dropPending(): void {
    this.from = null;
    this.first = null;
    this.corner = null;
  }

  private add(l: Omit<SketchLine, 'id'>): void {
    this.lns = joinPicked(this.lns, { ...l, id: crypto.randomUUID() });
  }

  /** Does `p` fall on the end of any line? There a click of Line/Rectangle starts drawing. */
  private atEndpoint(p: Vec2, tol: number): boolean {
    return this.lns.some((l) => dist(l.a, p) <= tol || dist(l.b, p) <= tol);
  }

  /** `tol`: radius (m) within which a click reaches a line of the sketch. */
  click(p: Vec2, walls: WallAxis[], tol: number): void {
    if (!this.on) return;
    // in Pick Walls an unchosen wall wins over a nearby line: this way a corner does not steal the click
    if (this.mode === 'pick') {
      const w = wallAt(walls, p);
      if (w && !this.lns.some((l) => l.wallId === w.id)) {
        this.sel = null;
        this.pickWall(p, walls);
        return;
      }
    }
    const drawing = this.from !== null || this.corner !== null;
    const selecting = this.mode === null || this.mode === 'pick' || (!drawing && !this.atEndpoint(p, tol));
    if (selecting) {
      const hit = nearestLine(this.lns, p, tol);
      if (hit || this.mode === null) {
        this.sel = hit;
        return;
      }
    }
    this.sel = null;
    if (this.mode === 'pick') this.pickWall(p, walls);
    else if (this.mode === 'line') this.lineClick(p);
    else if (this.mode === 'rect') this.rectClick(p);
  }

  private pickWall(p: Vec2, walls: WallAxis[]): void {
    const w = wallAt(walls, p);
    if (!w || this.lns.some((l) => l.wallId === w.id)) return;
    const [a, b] = wallFace(w, p);
    this.add({ a, b, source: 'pick', wallId: w.id, thickness: w.thickness });
  }

  private lineClick(p: Vec2): void {
    if (!this.from) {
      this.from = [p[0], p[1]];
      this.first = [p[0], p[1]];
      return;
    }
    if (dist(p, this.from) < JOIN_TOLERANCE) return;
    const end: Vec2 = [p[0], p[1]];
    this.add({ a: this.from, b: end, source: 'line' });
    // when returning to the first point the loop is closed: the chain ends
    const closed = this.first !== null && dist(end, this.first) < JOIN_TOLERANCE && this.first !== this.from;
    if (closed) this.dropPending();
    else this.from = end;
  }

  private rectClick(p: Vec2): void {
    if (!this.corner) {
      this.corner = [p[0], p[1]];
      return;
    }
    const sides = rectangle(this.corner, p);
    if (!sides) return;
    for (const [a, b] of sides) this.add({ a, b, source: 'rect' });
    this.corner = null;
  }

  /** Preview segments for the pointer at `p`; empty if there is nothing to show. */
  move(p: Vec2, walls: WallAxis[]): [Vec2, Vec2][] {
    if (!this.on) return [];
    if (this.mode === 'pick') {
      const w = wallAt(walls, p);
      return w && !this.lns.some((l) => l.wallId === w.id) ? [wallFace(w, p)] : [];
    }
    if (this.mode === 'line' && this.from) return [[this.from, [p[0], p[1]]]];
    if (this.mode === 'rect' && this.corner) return rectangle(this.corner, p) ?? [];
    return [];
  }

  /** Cuts the chain or rectangle in progress; then leaves the drawing tool; then leaves the sketch. */
  escape(): 'chain-cut' | 'mode-off' | 'exit' {
    if (this.from || this.corner) {
      this.dropPending();
      return 'chain-cut';
    }
    if (this.mode !== null) {
      this.setMode(null);
      return 'mode-off';
    }
    this.cancel();
    return 'exit';
  }

  /** Deletes the selected line; false if there is none. */
  deleteSelected(): boolean {
    if (this.sel === null) return false;
    this.lns = this.lns.filter((l) => l.id !== this.sel);
    this.sel = null;
    return true;
  }

  /** Closes the boundary: on success it leaves the sketch and returns the polygon; otherwise nothing changes. */
  finish(): LoopResult {
    const r = closeLoop(this.lns);
    if (r.ok) this.cancel();
    return r;
  }

  /** Sale descartando el boceto (cambio de vista o de documento, Cancel). */
  cancel(): void {
    this.on = false;
    this.lns = [];
    this.sel = null;
    this.mode = null;
    this.dropPending();
  }

  get prompt(): string | null {
    if (!this.on) return null;
    switch (this.mode) {
      case 'pick':
        return 'Pick walls to create lines.';
      case 'line':
        return this.from ? 'Click to enter line end point.' : 'Click to enter line start point.';
      case 'rect':
        return this.corner ? 'Click to enter rectangle opposite corner.' : 'Click to enter rectangle start corner.';
      default:
        return 'Select a line, or click Finish Edit Mode.';
    }
  }
}
