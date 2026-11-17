// Web bridge of the Assistant: it does in the browser what on desktop Tauri + the Python agent do. BuiltBot
// calls it as it would call Tauri (`invoke`), with the same commands, the same answers and the same events.
// Referencias: studio/src-tauri/src/assistant/commands.rs y chatbot-revit/AI_Manage/src/bridge/stdio/chat_handlers.py
import { installState } from './bridge/state';
import { installHelpers } from './bridge/helpers';
import { installChat } from './bridge/chat';
import { installKeys } from './bridge/keys';
import { installConversations } from './bridge/conversations';
import type { WebBridgeContext } from './bridge/context';
import { WebBridgeDeps, Payload } from './bridge/types';
import { str } from './bridge/helpers-static';
export type { WebBridgeDeps } from './bridge/types';

export function createWebBridge(d: WebBridgeDeps): { invoke(cmd: string, args?: { payload?: Payload }): Promise<unknown> } {
  const ctx = { d } as unknown as WebBridgeContext;
  installState(ctx);
  installHelpers(ctx);
  installChat(ctx);
  installKeys(ctx);
  installConversations(ctx);

  return {
    async invoke(cmd, args) {
      const payload = (args?.payload ?? {}) as Payload;
      switch (cmd) {
        case 'chat_stream':
          return ctx.chatStream(payload);
        case 'cancel_stream': {
          const id = str(payload.id);
          if (id) ctx.turns.get(id)?.abort();
          return undefined;
        }
        case 'tool_confirm': {
          const decision = str(payload.decision);
          ctx.pending.get(str(payload.tool_use_id))?.(decision === 'always' || decision === 'once' ? decision : 'deny');
          return undefined;
        }
        case 'ask_answer':
          return undefined;
        case 'bridge_status':
          return { running: true, error: null, log: '' };
        case 'restart_bridge':
          // BuiltBot asks for it after every settings change. The preferences in memory are already the current ones: reading
          // them again from storage would lose the key just saved if the browser does not allow saving.
          ctx.resetSession();
          return undefined;
        case 'graph_request':
          throw new Error('Graphs are not available in the web demo');
        case 'send_request':
          d.bus.emit('chat://end', { id: str(payload.id) });
          return undefined;
        case 'conv_request':
          return ctx.convRequest(payload);
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    },
  };
}
