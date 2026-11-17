import type { WorkspaceContext } from './context';

export interface AssistantPaneDeps {
  layoutChanged(on: boolean, persist?: boolean): void;
}

export interface AssistantPaneController {
  toggleAssistant(): void;
}

/** The Assistant column: layout persistence and the first open (which starts the agent). */
export function mountAssistantPane(ctx: WorkspaceContext, deps: AssistantPaneDeps): AssistantPaneController {
  const { layout, opts } = ctx;
  const { assistantPane } = layout;
  let assistantOpened = false;
  assistantPane?.onChange((on) => {
    deps.layoutChanged(on, false);
    if (!on && !assistantOpened) {
      assistantOpened = true;
      void opts.assistant!.open();
    }
  });
  return {
    toggleAssistant: () => assistantPane?.toggle(),
  };
}
