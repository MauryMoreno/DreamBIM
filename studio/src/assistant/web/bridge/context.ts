import { WebBridgeDeps, Payload } from './types';
import type { Msg } from '../agent/backends/types';
import { type Decision } from '../agent/loop';
import { type WebPrefs } from '../prefs';

/** What the parts of createWebBridge share: its parameters and every local that more than one part uses. */
export interface WebBridgeContext {
  d: WebBridgeDeps;
  prefs: WebPrefs;
  persist: () => void;
  convId: string | null;
  rich: unknown[];
  history: Msg[];
  turns: Map<string, AbortController>;
  pending: Map<string, (decision: Decision) => void>;
  always: Set<string>;
  skill: string | null;
  approvedBuild: string | null;
  needsModelReview: boolean;
  SKILL_GATE: string;
  REVIEW_NOTE: "[skill] The model changed: run review_model before telling the user it is finished.";
  WRITES: Set<string>;
  activeModel: () => string;
  resetSession: () => void;
  reasoningState: () => { event: string; mode: string; can_disable: boolean; always_on: boolean; efforts: string[]; effort: string | null; };
  conversationsList: () => Promise<{ event: string; items: { turns: number; model: string; id: string; title: string; updated_at: string; }[]; current: string | null; }>;
  knownCommands: () => Promise<ReadonlySet<string> | undefined>;
  waitDecision: (toolUseId: string) => Promise<Decision>;
  chatStream: (payload: Payload) => Promise<void>;
  saveKey: (p: Payload) => void;
  removeKey: (p: Payload) => void;
  convRequest: (p: Payload) => Promise<unknown>;
}
