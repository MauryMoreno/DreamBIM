import type { CollectionContext } from './context';

export function installWiring(ctx: CollectionContext): void {
  // Esc: closes the big card; without it, clears the search if it has text and, if not, goes back.
  document.addEventListener('keydown', (k) => {
    if (k.key !== 'Escape' || !ctx.active) return;
    if (ctx.closeLarge) ctx.closeLarge();
    else if (k.target === ctx.search && ctx.search.value) {
      ctx.search.value = '';
      ctx.query = '';
      ctx.firstPage();
    } else ctx.cb.onBack();
  });

  const chooseFolder = async (): Promise<void> => {
    let dir: string | null;
    try {
      dir = await ctx.cb.chooseFolder();
    } catch {
      return; // the dialog already notifies on its own
    }
    if (!dir) return;
    await ctx.col.setFolder(dir);
    ctx.cb.onFolderChange(dir);
  };

  ctx.pick.addEventListener('click', () => void chooseFolder());

  ctx.choose.addEventListener('click', () => void chooseFolder());

  ctx.render();
}
