/**
 * Wrap the client source in the loader call the host expects.
 *
 * Deliberately not a bundler: the source is already CommonJS with
 * React.createElement, so all this does is add the `__ModuleLoader__.load`
 * envelope. `require` inside the factory is supplied by the host loader, which
 * resolves the `dsh.client.inject` packages plus react.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const source = await readFile(join(root, 'src-client.js'), 'utf8')

const wrapped = [
  'window.__ModuleLoader__.load({ id: "@shion/dsh-vision-bridge", factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  source,
  'return module.exports; } });',
  '',
].join('\n')

await writeFile(join(root, 'client.js'), wrapped)
console.log(`client.js: ${wrapped.length} bytes`)
