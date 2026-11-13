// Presentation + loader only. The showcase imports the real app's TypeScript modules.
import ts from 'typescript';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const compiled = new Map();
const cache = resolve(root, '.cache/showcase');
function compile(file) {
  if (compiled.has(file)) return compiled.get(file);
  mkdirSync(cache, { recursive: true });
  const output = resolve(cache, `${compiled.size}.mjs`);
  compiled.set(file, output);
  if (file.endsWith('.json')) {
    writeFileSync(output, `export default ${readFileSync(file, 'utf8')};`);
    return output;
  }
  let code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  code = code.replace(/(^import\s+(?:[^'"\n]*?from\s*)?)(['"])([^'"]+)\2/gm, (match, prefix, quote, spec) => {
    let dest;
    if (spec.startsWith('.') || spec.startsWith('@/')) {
      const base = spec.startsWith('@/') ? resolve(root, 'src', spec.slice(2)) : resolve(dirname(file), spec);
      dest = pathToFileURL(compile(base.endsWith('.json') ? base : `${base}.ts`)).href;
    } else dest = spec.startsWith('node:') ? spec : pathToFileURL(require.resolve(spec)).href;
    return `${prefix}${quote}${dest}${quote}`;
  });
  writeFileSync(output, code);
  return output;
}
export async function appModule(relative) {
  return import(pathToFileURL(compile(resolve(root, relative))).href);
}
const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
export const paint = (text, code) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
export function box(lines) {
  const width = Math.max(...lines.map(x => x.length)) + 2;
  console.log(`┌${'─'.repeat(width)}┐`);
  for (const line of lines) console.log(`│ ${line.padEnd(width - 2)} │`);
  console.log(`└${'─'.repeat(width)}┘`);
}
export async function step(label, run) {
  let frame = 0;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
  const timer = process.stdout.isTTY ? setInterval(() => process.stdout.write(`\r${paint(frames[frame++ % frames.length], '36')} ${label}`), 90) : null;
  try {
    const result = await run();
    if (timer) process.stdout.write('\r\x1b[2K');
    console.log(paint(`✔ ${label}`, '32'));
    return result;
  } catch (error) {
    if (timer) process.stdout.write('\r\x1b[2K');
    console.log(paint(`✕ ${label}`, '31'));
    throw error;
  } finally { if (timer) clearInterval(timer); }
}
export const pause = () => new Promise(resolve => setTimeout(resolve, process.env.SHOWCASE_FAST === '1' ? 0 : 2200));
