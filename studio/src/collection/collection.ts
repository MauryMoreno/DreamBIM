// Collection screen: the library of .ifcx as cards, in a grid, with filters. It only paints and notifies; reading
// the disk, analyzing the cards and placing them are done by the commands and dependencies it receives.
import { installChrome } from './view/chrome';
import { installState } from './view/state';
import { installThumbs } from './view/thumbs';
import { installFilters } from './view/filters';
import { installLarge } from './view/large';
import { installApi } from './view/api';
import { installWiring } from './view/wiring';
import type { CollectionContext } from './view/context';
import { CollectionCallbacks, CollectionDeps, Collection } from './view/types';
export type { CollectionCallbacks, CardViewer, CollectionDeps, Collection } from './view/types';

export function mountCollection(host: HTMLElement, cb: CollectionCallbacks, deps: CollectionDeps): Collection {
  const ctx = { host, cb, deps } as unknown as CollectionContext;
  installChrome(ctx);
  installState(ctx);
  installThumbs(ctx);
  installFilters(ctx);
  installLarge(ctx);
  installApi(ctx);
  installWiring(ctx);

  return ctx.col;
}
