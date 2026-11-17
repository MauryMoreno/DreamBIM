// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const security = (JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
  app: { security: { csp: unknown; devCsp: unknown } };
}).app.security;

const directive = (policy: string, name: string): string => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

describe('desktop Content Security Policy', () => {
  for (const key of ['csp', 'devCsp'] as const) {
    const policy = String(security[key]);

    it(`${key} is set and allows no inline script and no plugin content`, () => {
      expect(typeof security[key]).toBe('string');
      expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
      expect(directive(policy, 'object-src')).toBe("object-src 'none'");
      expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    });

    it(`${key} lets the webview reach Tauri and nothing on the internet`, () => {
      const connect = directive(policy, 'connect-src');
      expect(connect).toContain('ipc:');
      expect(connect).toContain('http://ipc.localhost');
      expect(connect).not.toMatch(/https:\/\//); // the desktop Assistant goes through the Python bridge, not the browser
    });
  }

  it('only devCsp allows the Vite dev server websocket', () => {
    expect(directive(String(security.csp), 'connect-src')).not.toContain('ws://');
    expect(directive(String(security.devCsp), 'connect-src')).toContain('ws://localhost:1420');
  });
});
