import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
// This optional override keeps the author's portable compiler out of system PATH.
const toolRoot = env.KONVERSON_RUST_HOME;
if (toolRoot) {
  env.CARGO_HOME = join(toolRoot, 'cargo');
  env.RUSTUP_HOME = join(toolRoot, 'rustup');
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = join(env.CARGO_HOME, 'bin') + (process.platform === 'win32' ? ';' : ':') + env[pathKey];
}
const pack = resolve(root, 'node_modules', 'wasm-pack', 'run.js');
if (!existsSync(pack)) throw new Error('Run npm ci before building the engine.');
const result = spawnSync(process.execPath, [pack, 'build', 'engine', '--target', 'web', '--release', '--out-dir', 'pkg', '--out-name', 'konverson_engine', '--no-opt'], { cwd: root, env, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(resolve(root, 'src/generated'), { recursive: true });
for (const name of ['konverson_engine.js', 'konverson_engine.d.ts', 'konverson_engine_bg.wasm']) {
  cpSync(resolve(root, 'engine/pkg', name), resolve(root, 'src/generated', name));
}
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
console.log(`Konverson ${version}: WebAssembly engine built.`);
