// Common contract of the three provider dialects of the web agent. The history is neutral (`Msg`); each
// adaptador lo traduce a su API y devuelve eventos neutros (`BackendEvent`).
// Referencia de comportamiento: chatbot-revit/core/builtbot_core/{anthropic_backend,openai_responses_backend,openai_backend}.py

export type Msg =
  | { role: 'user'; content: string; images?: string[] }
  | { role: 'assistant'; text: string; toolCalls: { id: string; name: string; args: unknown }[]; opaque?: unknown }
  | { role: 'tool'; id: string; content: string; image?: string };

export type BackendEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; id: string; name: string; args: unknown }
  | { kind: 'usage'; input: number; output: number }
  /**
   * `opaque`: what must be resent as is in the next round (signed or encrypted reasoning).
   * `truncated`: the provider cut the answer because of the output limit.
   */
  | { kind: 'done'; opaque?: unknown; truncated?: boolean };

export interface BackendRequest {
  model: string;
  system: string;
  messages: Msg[];
  tools: readonly unknown[];
  /** Extra reasoning parameters, already in the dialect of the provider (catalog.reasoningParams). */
  reasoning: Record<string, unknown>;
}

export interface Backend {
  /** Termina sin `done` y sin error si `signal` se aborta. */
  stream(req: BackendRequest, signal: AbortSignal): AsyncIterable<BackendEvent>;
}

/** A failure of the provider or the network. The message is the provider's text, to show it as is. */
export class ProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}
