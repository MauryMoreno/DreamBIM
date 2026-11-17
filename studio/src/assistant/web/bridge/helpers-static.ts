import type { Msg } from '../agent/backends/types';
import { type Dialect } from '../agent/catalog';
import { type Provider } from '../prefs';
import { ImageRecord } from './types';

export const NO_KEY_MESSAGE = 'Add your API key in Settings to start.';

export const CONFIRM_TIMEOUT_MS = 180_000;

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const dialectOf = (p: Provider): Dialect => p;

export function newConvId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(16).slice(2, 6).padEnd(4, '0')}`;
}

/** The types the providers read; the same ones BuiltBot accepts (frontend/src/lib/attachments.ts). */
export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** The images of `chat_stream` (`{data, mediaType, name}`, base64 without prefix) as a data URL and as a record. */
export function readImages(raw: unknown): { urls: string[]; records: ImageRecord[] } {
  const urls: string[] = [];
  const records: ImageRecord[] = [];
  for (const item of Array.isArray(raw) ? (raw as { data?: unknown; mediaType?: unknown; name?: unknown }[]) : []) {
    const name = str(item?.name) || 'image';
    const mediaType = str(item?.mediaType).toLowerCase();
    const data = str(item?.data);
    if (!IMAGE_MEDIA_TYPES.has(mediaType) || !data) {
      throw new Error(`${name} cannot be attached: only PNG, JPEG, GIF and WebP images are supported.`);
    }
    urls.push(`data:${mediaType};base64,${data}`);
    records.push({ name, mediaType });
  }
  return { urls, records };
}

export const imageRecords = (m: { images?: unknown }): ImageRecord[] =>
  Array.isArray(m.images) ? (m.images as ImageRecord[]).filter((i) => typeof i?.name === 'string') : [];

export function titleOf(messages: unknown[]): string {
  const users = (messages as { role?: string; content?: unknown; images?: unknown }[]).filter((m) => m.role === 'user');
  for (const m of users) {
    if (typeof m.content === 'string' && m.content.trim()) return m.content.trim().slice(0, 60);
  }
  for (const m of users) {
    const first = imageRecords(m)[0];
    if (first) return first.name.slice(0, 60);
  }
  return '(new conversation)';
}

/** The history the model sees when opening a conversation: only the text (like `_content_for_llm` of the Python). */
export function textHistory(messages: unknown[]): Msg[] {
  const out: Msg[] = [];
  for (const m of messages as { role?: string; content?: unknown; synthetic?: unknown; images?: unknown }[]) {
    if (m.synthetic) continue;
    let content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'user') {
      // the image is no longer there (it is not saved): it is said that there was one, so that the next answer makes sense
      const marks = imageRecords(m).map((i) => `[Attached image: ${i.name}]`);
      if (marks.length) content = [...marks, ...(content ? [content] : [])].join('\n');
    }
    if (m.role === 'user' && content) out.push({ role: 'user', content });
    else if (m.role === 'assistant') {
      // a turn that did not get to answer (error, Stop) does not leave the user message loose: two in a row are not valid
      if (!content) {
        if (out.at(-1)?.role === 'user') out.pop();
        continue;
      }
      out.push({ role: 'assistant', text: content, toolCalls: [] });
    }
  }
  return out;
}
