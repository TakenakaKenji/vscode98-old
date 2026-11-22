// Bundles the standalone Monaco editor from the monaco-editor npm package (node_modules/monaco-editor, the published build with the Monarch tokenizers of ~80 languages)
// into one IIFE (globalThis.monaco) and one CSS file, with esbuild. The language services that run in web workers (TypeScript, JSON, CSS, HTML) come later.
// Usage (repo root): ESBUILD_DIR=<dir of the esbuild package> node docs98/spikes/15-xp-editor/host/build_monaco.mjs <outDir> [entry=editor.main.js]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_DIR || '/home/user/xpdeps/node_modules/esbuild');
const [outDir, entryName = 'editor.main.js'] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '../../../..');
fs.mkdirSync(outDir, { recursive: true });
const entry = path.join(outDir, '.entry.js');
fs.writeFileSync(entry, `import * as monaco from '${root}/node_modules/monaco-editor/esm/vs/editor/${entryName}';\nglobalThis.monaco = monaco;\n`);
const r = await build({
	entryPoints: [entry], outfile: path.join(outDir, 'monaco.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
	loader: { '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'warning', minify: false, sourcemap: false, metafile: true,
});
fs.rmSync(entry);
// the language workers (TypeScript/JavaScript, JSON, CSS, HTML, and the base editor worker for the rest), as ES modules for QuickJS's os.Worker with worker_prelude.js in front
fs.mkdirSync(path.join(outDir, 'workers'), { recursive: true });
const workers = { editor: 'editor/editor.worker.js', json: 'language/json/json.worker.js', css: 'language/css/css.worker.js', html: 'language/html/html.worker.js', ts: 'language/typescript/ts.worker.js' };
for (const [name, file] of Object.entries(workers)) {
	const we = path.join(outDir, `.${name}.entry.js`);
	fs.writeFileSync(we, `import '${import.meta.dirname}/worker_prelude.js';\nimport '${root}/node_modules/monaco-editor/esm/vs/${file}';\n`);
	const wr = await build({ entryPoints: [we], outfile: path.join(outDir, 'workers', `${name}.worker.js`), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['qjs:*'], logLevel: 'warning', minify: false, metafile: true, mainFields: ['module', 'main'] });
	fs.rmSync(we); for (const [k, v] of Object.entries(wr.metafile.outputs)) { r.metafile.outputs[k] = v; }
}
console.log(Object.entries(r.metafile.outputs).map(([k, v]) => `${path.relative(outDir, k)} ${v.bytes}`).join(', '));
