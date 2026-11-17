import { beforeEach, describe, expect, it } from 'vitest';
import { mountShell, showScreen } from '../src/shell/screens';

describe('pantallas', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('mountShell creates Home, the workspace and the Collection, and starts on Home', () => {
    const shell = mountShell(document.getElementById('app')!);
    expect(shell.collection.id).toBe('collection');
    expect(document.body.dataset.screen).toBe('home');
    expect(shell.collection.hidden).toBe(true);
  });

  it('showScreen("collection") hides the others', () => {
    const shell = mountShell(document.getElementById('app')!);
    showScreen('collection');
    expect(shell.collection.hidden).toBe(false);
    expect(shell.home.hidden).toBe(true);
    expect(shell.workspace.hidden).toBe(true);
    expect(document.body.dataset.screen).toBe('collection');
  });
});
