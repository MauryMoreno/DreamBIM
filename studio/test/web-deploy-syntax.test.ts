// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// deploy.ts does real work when imported (AWS, git), so it is not imported: it is checked that it parses.
describe('scripts de despliegue de la demo web', () => {
  for (const file of ['deploy.ts', 'upload-plan.ts', 'builtbot-guard.ts', 'addin.ts', 'make-addin.ts']) {
    it(`${file} no tiene errores de sintaxis`, () => {
      const src = readFileSync(new URL(`../scripts/web/${file}`, import.meta.url), 'utf8');
      const out = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
      const errors = (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(errors).toEqual([]);
    });
  }
});

// The template is not parsed as YAML (CloudFormation tags such as !Ref are not plain YAML): the checks read its text.
describe('cabeceras de seguridad de la demo web', () => {
  const template = readFileSync(new URL('../deploy/web-demo.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  /** The text of the block under `name:` at the given indentation, up to the next line indented that much or less. */
  const block = (name: string, indent: number): string => {
    const header = `
${' '.repeat(indent)}${name}:
`;
    const at = template.indexOf(header);
    if (at < 0) return '';
    const body = template.slice(at + header.length);
    const next = body.search(new RegExp(`\n {0,${indent}}[A-Za-z]`));
    return next < 0 ? body : body.slice(0, next);
  };
  const resource = (name: string): string => block(name, 2);
  const csp = (name: string): string => /ContentSecurityPolicy: "([^"]*)"/.exec(resource(name))?.[1] ?? '';
  const directive = (policy: string, name: string): string => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

  it('it defines two header policies: that of the app and that of BuiltBot', () => {
    expect(template.match(/Type: AWS::CloudFront::ResponseHeadersPolicy/g)).toHaveLength(2);
    expect(csp('AppHeaders')).not.toBe('');
    expect(csp('BuiltBotHeaders')).not.toBe('');
  });

  it('the CSP of the app allows only the three AI providers and no inline script', () => {
    const policy = csp('AppHeaders');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://api.anthropic.com https://api.deepseek.com https://api.openai.com");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
  });

  it('only the BuiltBot policy allows inline scripts (Next generates them) and only for /builtbot/*', () => {
    expect(directive(csp('BuiltBotHeaders'), 'script-src')).toContain("'unsafe-inline'");
    const behaviors = /\n        CacheBehaviors:\n([\s\S]*?)(?=\n        [A-Za-z]+:|\n\S|$)/.exec(template)?.[1] ?? '';
    expect(behaviors).toContain("PathPattern: 'builtbot/*'");
    expect(behaviors).toContain('ResponseHeadersPolicyId: !Ref BuiltBotHeaders');
  });

  it('the distribution uses the app policy by default and adds HSTS, nosniff and referrer', () => {
    const defaults = /\n        DefaultCacheBehavior:\n([\s\S]*?)(?=\n        [A-Za-z]+:|\n\S|$)/.exec(template)?.[1] ?? '';
    expect(defaults).toContain('ResponseHeadersPolicyId: !Ref AppHeaders');
    for (const name of ['AppHeaders', 'BuiltBotHeaders']) {
      const text = resource(name);
      expect(text).toContain('StrictTransportSecurity');
      expect(text).toContain('ContentTypeOptions');
      expect(text).toMatch(/ReferrerPolicy:\n\s+ReferrerPolicy: no-referrer/);
    }
  });
});
