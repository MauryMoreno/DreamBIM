import type { Ribbon } from '../ribbon/ribbon';
import type { WorkspaceLayout } from './layout';
import type { WorkspaceState } from './state';
import type { StatusBar } from './statusbar';
import type { WorkspaceOptions, WorkspaceViewer } from './types';

/** Cleanups collected while the workspace mounts; `run` invokes them once. */
export class Disposables {
  private readonly fns: (() => void)[] = [];

  add(fn: () => void): void {
    this.fns.push(fn);
  }

  run(): void {
    for (const fn of this.fns.splice(0)) fn();
  }
}

/** What every workspace controller receives: the shared parts of the mounted workspace. */
export interface WorkspaceContext<V extends WorkspaceViewer = WorkspaceViewer> {
  layout: WorkspaceLayout;
  state: WorkspaceState;
  viewer: V;
  opts: WorkspaceOptions<V>;
  status: StatusBar;
  ribbon: Ribbon;
  dispose: Disposables;
}

/** Registers a window listener and removes it when the workspace is disposed. */
export function onWindow<V extends WorkspaceViewer>(
  ctx: WorkspaceContext<V>,
  type: string,
  fn: (e: KeyboardEvent) => void,
): void {
  window.addEventListener(type, fn as EventListener);
  ctx.dispose.add(() => window.removeEventListener(type, fn as EventListener));
}
