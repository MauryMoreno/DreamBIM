import type { StudioExecutor } from '../../studio/executor';
import type { EventBus } from '../bus';
import { type ConversationStore } from '../conversations';

export interface WebBridgeDeps {
  bus: EventBus;
  store: ConversationStore;
  executor: StudioExecutor;
  /** Where the keys and preferences live; without it, the browser's localStorage. */
  storage?: Storage | null;
  fetchImpl?: typeof fetch;
}

export type Payload = Record<string, unknown>;

/** What is saved of an attached image: its name and type, never its bytes (the conversation lives in IndexedDB). */
export interface ImageRecord {
  name: string;
  mediaType: string;
}
