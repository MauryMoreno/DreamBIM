import { PAGE_SIZE } from './helpers';
import type { LibraryEntry } from '../../library/librarypanel';
import { type CardRecord } from '../store';
import type { CollectionContext } from './context';

export function installState(ctx: CollectionContext): void {
  const pageSize = Math.max(1, ctx.deps.pageSize ?? PAGE_SIZE);
  ctx.pageSize = pageSize;

  /** Current page, from 0. */
  ctx.page = 0;

  ctx.root = null;

  ctx.files = [];

  ctx.error = null;

  ctx.complete = false;

  ctx.query = '';

  const records = new Map<string, CardRecord>();
  ctx.records = records;

  const entries = new Map<string, LibraryEntry>();
  ctx.entries = entries;

  /** Entry number of each card (from 1), in the order of the folder: it does not change with filters or pages. */
  const numbers = new Map<string, number>();
  ctx.numbers = numbers;

  const cards = new Map<string, HTMLElement>();
  ctx.cards = cards;

  /** Each walk invalidates the previous ones. */
  ctx.ticket = 0;
}
