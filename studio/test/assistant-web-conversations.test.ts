import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  idbConversations,
  memoryConversations,
  nowStamp,
  type ConversationStore,
} from '../src/assistant/web/conversations';

const conv = (id: string, updated_at: string, extra = {}) => ({
  id,
  title: `Chat ${id}`,
  updated_at,
  messages: [{ role: 'user', content: id }],
  ...extra,
});

function suite(name: string, make: () => ConversationStore) {
  describe(name, () => {
    it('list returns the most recent first, without the messages', async () => {
      const s = make();
      await s.save(conv('a', '2026-11-10 10:00:00'));
      await s.save(conv('b', '2026-11-10 11:00:00'));
      expect(await s.list()).toEqual([
        { id: 'b', title: 'Chat b', updated_at: '2026-11-10 11:00:00' },
        { id: 'a', title: 'Chat a', updated_at: '2026-11-10 10:00:00' },
      ]);
    });

    it('with the same timestamp the one saved later wins', async () => {
      const s = make();
      await s.save(conv('a', '2026-11-10 10:00:00'));
      await s.save(conv('b', '2026-11-10 10:00:00'));
      expect((await s.list()).map((c) => c.id)).toEqual(['b', 'a']);
      await s.save(conv('a', '2026-11-10 10:00:00'));
      expect((await s.list()).map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('guardar de nuevo el mismo id la reemplaza', async () => {
      const s = make();
      await s.save(conv('a', '2026-11-10 10:00:00'));
      await s.save(conv('a', '2026-11-10 12:00:00', { title: 'Nuevo' }));
      expect(await s.list()).toHaveLength(1);
      expect((await s.load('a'))?.title).toBe('Nuevo');
    });

    it('load devuelve los mensajes y null si el id no existe', async () => {
      const s = make();
      await s.save(conv('a', '2026-11-10 10:00:00'));
      expect((await s.load('a'))?.messages).toEqual([{ role: 'user', content: 'a' }]);
      expect(await s.load('zzz')).toBeNull();
    });

    it('remove removes it and removing one that does not exist does not fail', async () => {
      const s = make();
      await s.save(conv('a', '2026-11-10 10:00:00'));
      await s.remove('a');
      await s.remove('a');
      expect(await s.list()).toEqual([]);
      expect(await s.load('a')).toBeNull();
    });

    it('what is saved is a copy: changing the original afterwards does not alter it', async () => {
      const s = make();
      const c = conv('a', '2026-11-10 10:00:00');
      await s.save(c);
      c.messages.push({ role: 'assistant', content: 'x' });
      expect((await s.load('a'))?.messages).toHaveLength(1);
    });
  });
}

suite('conversaciones en memoria', () => memoryConversations());

describe('conversaciones en IndexedDB', () => {
  afterEach(() => vi.unstubAllGlobals());

  suite('sin indexedDB (ventana privada o bloqueado) se comporta como la de memoria', () => {
    vi.stubGlobal('indexedDB', undefined);
    return idbConversations('ifcx-test-sin-idb');
  });
});

describe('nowStamp', () => {
  it('tiene el formato YYYY-MM-DD HH:MM:SS de conversation_store.py', () => {
    expect(nowStamp(new Date(2026, 10, 10, 9, 5, 3))).toBe('2026-11-10 09:05:03');
  });
});
