import type { DocPickerContext } from './context';

export function installFinish(ctx: DocPickerContext): void {
  ctx.finish = () => {};
}
