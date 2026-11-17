// Copia la interfaz de BuiltBot dentro de Studio (npm run sync-builtbot):
//   1. compila chatbot-revit/frontend con el prefijo /builtbot;
//   2. la copia a studio/public/builtbot/ (fuera de git);
// La carpeta out/ de BuiltBot se deja como estaba: la usa su app de Revit.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studio = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chatbot = process.env.IFCX_CHATBOT_DIR
  ? resolve(process.env.IFCX_CHATBOT_DIR)
  : resolve(studio, '..', '..', 'chatbot-revit');
const frontend = join(chatbot, 'frontend');
const out = join(frontend, 'out');
const backup = join(frontend, 'out.ifcx-backup');
const dest = join(studio, 'public', 'builtbot');

if (!existsSync(join(frontend, 'package.json'))) {
  throw new Error(`BuiltBot not found at ${frontend}. Set IFCX_CHATBOT_DIR to the chatbot-revit folder.`);
}

// la build con prefijo pisa out/: se aparta la de la app de Revit y se repone al final
rmSync(backup, { recursive: true, force: true });
if (existsSync(out)) renameSync(out, backup);
try {
  console.log(`Building BuiltBot (${frontend}) with base path /builtbot…`);
  // sin el NODE_ENV que pone vite-node: con un valor distinto de production, Next falla al pre-renderizar
  const { NODE_ENV: _nodeEnv, ...env } = process.env;
  execSync('npm run build', { cwd: frontend, stdio: 'inherit', env: { ...env, BUILTBOT_BASE_PATH: '/builtbot' } });
  rmSync(dest, { recursive: true, force: true });
  cpSync(out, dest, { recursive: true });
} finally {
  rmSync(out, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, out);
}

console.log(`BuiltBot copied to ${dest}.`);
