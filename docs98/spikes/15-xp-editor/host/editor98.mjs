// editor98: a code editor for old Windows: Monaco (monaco-editor, bundled by build_monaco.mjs) and the shell of ../app/shell.js on our engine (06-rendering DOM and CSS, 07-native-render
// layout, style and rasterizer), in one window process. Run through the Node shims, which give Unicode-safe file access on Windows:
//   qjs --stack-size 0 <05-child-process/host/fork_main.mjs> <shimsDir> editor98.mjs [folder] [--monaco dir] [--user-data-dir dir] [--font-dir dir] [--width 1000] [--height 700]
//       [--headless 1 [--scenario file.mjs] [--ppm out.ppm]]
import * as std from 'qjs:std';
import * as os from 'qjs:os';
import * as opentype from '../../../../node_modules/opentype.js/dist/opentype.mjs';
import '../../06-rendering/host/dom/intl_shim.js';
import { installEnvironment } from '../../06-rendering/host/dom/env.js';
import { paintDocument, toPPM } from '../../06-rendering/host/dom/paint.js';
import { NativeBackend } from '../../07-native-render/host/native_backend.js';
import { installWebShims } from '../../08-workbench-boot/host/web_shims.js';

const fs = globalThis.__builtins.fs, path = globalThis.__builtins.path, P = globalThis.process;
const args = P.argv.slice(2); const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const W = Number(opt('width', 1000)), H = Number(opt('height', 700)); const headless = opt('headless', '0') === '1';
const log = (m) => { std.out.puts(m + '\n'); std.out.flush(); };
console.error ??= (...a) => { std.err.puts(a.map(String).join(' ') + '\n'); };
globalThis.__readFileBytes = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const t0 = performance.now();

// ---- settings (userdata/settings.json next to the program unless --user-data-dir says otherwise)
const userDir = path.resolve(opt('user-data-dir', path.join(here, '..', 'userdata')));
const DEFAULTS = { fontSize: 14, tabSize: 4, insertSpaces: false, formatOnSave: false };
let settings = { ...DEFAULTS }; try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8')) }; } catch { }

// ---- the page
{ const fd = opt('font-dir', null); if (fd && fs.existsSync(fd)) { globalThis.__fontRoot = fd.replace(/\\/g, '/'); } }
const env = installEnvironment({ width: W, height: H, opentype }); const doc = env.document;
const monacoDir = path.resolve(opt('monaco', path.join(here, '..', 'monaco')));
installWebShims(env, { baseUrl: 'http://localhost', readFile: (p) => globalThis.__readFileBytes(path.join(monacoDir, p)) });   // performance marks, fetch and the other web globals Monaco expects
const nl = await import('../../07-native-render/host/native_layout.js'); env.layoutEngine = nl.engine;
const ns = await import('../../07-native-render/host/native_style.js'); env.styleEngine = ns.engine;
const style = doc.createElement('style'); style.textContent = fs.readFileSync(path.join(monacoDir, 'monaco.css'), 'utf8') + '\n' + fs.readFileSync(path.join(here, '..', 'app', 'shell.css'), 'utf8'); doc.head.appendChild(style);
// Monaco's language workers on QuickJS threads (os.Worker): the bundles of build_monaco.mjs (workers/*.worker.js, worker_prelude.js inside), behind the Worker interface Monaco expects
class QjsWorker extends env.window.EventTarget {
	constructor(file) {
		super(); this.onmessage = null; this.onerror = null; this.w = new os.Worker(file);
		this.w.onmessage = (e) => { const ev = new env.window.MessageEvent('message', { data: e.data }); if (typeof this.onmessage === 'function') { this.onmessage(ev); } this.dispatchEvent(ev); };
	}
	postMessage(data) { this.w.postMessage(data); }
	terminate() { if (this.w) { this.w.postMessage({ __qjsTerminate: true }); this.w.onmessage = null; this.w = null; } }
}
const WORKER_OF = { json: 'json', css: 'css', scss: 'css', less: 'css', html: 'html', handlebars: 'html', razor: 'html', typescript: 'ts', javascript: 'ts' };
const workerStarted = [];
globalThis.MonacoEnvironment = { getWorker: (id, label) => { const name = WORKER_OF[label] || 'editor'; workerStarted.push(name); return new QjsWorker(path.join(monacoDir, 'workers', name + '.worker.js').replace(/\\/g, '/')); } };
globalThis.__workersStarted98 = workerStarted;
(0, eval)(fs.readFileSync(path.join(monacoDir, 'monaco.js'), 'utf8'));
const tMonaco = performance.now();

// ---- what the shell may do outside the page
let winHost = null;
const workspace = path.resolve(positional[0] || P.cwd());
const host = {
	path, settings, workspace, platform: P.platform,
	readDir: (d) => fs.readdirSync(d), isDir: (p) => fs.statSync(p).isDirectory(),
	readFile: (f) => fs.readFileSync(f, 'utf8'), writeFile: (f, text) => fs.writeFileSync(f, text, 'utf8'),
	setTitle: (t) => { if (winHost) { winHost.setTitle(t); } },
	confirm: (msg, onSave) => { onSave(); return true; },   // no dialogs yet: closing a changed tab saves it rather than losing the change
	openFiles: positional.slice(1).map(f => path.resolve(f)),
};
const { startShell } = await import('../app/shell.js');
const shell = startShell({ host, monaco: globalThis.monaco });
globalThis.__shell98 = shell;
const settle = async () => { for (let i = 0, stable = 0, last = -1; i < 400 && stable < 4; i++) { await new Promise(r => setTimeout(r, 5)); env.flushFrames(); doc.__ensureLayout(); const n = doc.getElementsByTagName('*').length; if (n === last && !env.pendingFrames()) { stable++; } else { stable = 0; } last = n; } };
await settle();
log(`[editor98] ready after ${Math.round(performance.now() - t0)} ms (Monaco loaded at ${Math.round(tMonaco - t0)} ms); workspace ${workspace}; elements ${doc.getElementsByTagName('*').length}`);

if (headless) {
	const backend = new NativeBackend(W, H); const paint = () => { backend.reset(); return paintDocument(doc, W, H, backend); };
	const ctx = { env, doc, log, opt, shell, settle, paint, monaco: globalThis.monaco };
	if (opt('scenario', null)) { const sc = await import(path.resolve(opt('scenario'))); await sc.run(ctx); }
	const ppm = opt('ppm', null); if (ppm) { const r = paint(); const u8 = toPPM(r.px, r.w, r.h); const f = std.open(ppm, 'wb'); f.write(u8.buffer, u8.byteOffset, u8.byteLength); f.close(); log('[editor98] wrote ' + ppm); }
	std.exit(0);
} else {
	const { openWindow } = await import('../../11-windows-host/host/window_host98.mjs');
	const win = await import('spike:win');
	const ctx = { env, doc, log, opt, note: (k, e) => log(`[error] ${k}: ${e && (e.stack || e.message) || e}`) };
	const w = openWindow(ctx, { width: W, height: H, title: 'editor98', background: [31, 31, 31], onClose: () => { } });
	winHost = { setTitle: (t) => win.setTitle(w.id, t) };
	host.setTitle(`${path.basename(workspace)} - editor98`);
}
