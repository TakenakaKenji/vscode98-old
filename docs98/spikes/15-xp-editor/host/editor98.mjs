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
const here = path.dirname(globalThis.__builtins.url.fileURLToPath(import.meta.url));   // Windows-aware (a drive letter is not a URL host)
const W = Number(opt('width', 1000)), H = Number(opt('height', 700)); const headless = opt('headless', '0') === '1';
const log = (m) => { std.out.puts(m + '\n'); std.out.flush(); };
console.error ??= (...a) => { std.err.puts(a.map(String).join(' ') + '\n'); };
globalThis.__readFileBytes = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const t0 = performance.now();

// ---- settings (userdata/settings.json next to the program unless --user-data-dir says otherwise)
const userDir = path.resolve(opt('user-data-dir', path.join(here, '..', 'userdata')));
const DEFAULTS = { fontSize: 14, tabSize: 4, insertSpaces: false, formatOnSave: false, workers: true, lint: true, luauMode: 'nonstrict' };   // workers: Monaco's language services on threads (false: none, no JSON/CSS/HTML/TS features)
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
		this.first = true; this.file = file;
		this.w.onmessage = (e) => { if (this.first) { this.first = false; log(`[editor98] first message from ${path.basename(file)} at ${Math.round(performance.now() - t0)} ms`); } const ev = new env.window.MessageEvent('message', { data: e.data }); if (typeof this.onmessage === 'function') { this.onmessage(ev); } this.dispatchEvent(ev); };
	}
	postMessage(data) { this.w.postMessage(data); }
	terminate() { if (this.w) { this.w.postMessage({ __qjsTerminate: true }); this.w.onmessage = null; this.w = null; } }
}
const WORKER_OF = { json: 'json', css: 'css', scss: 'css', less: 'css', html: 'html', handlebars: 'html', razor: 'html', typescript: 'ts', javascript: 'ts' };
const workerStarted = [];
globalThis.MonacoEnvironment = { getWorker: (id, label) => { const name = WORKER_OF[label] || 'editor'; if (settings.workers === false) { log(`[editor98] worker ${name} (${label}) not started: "workers": false`); return undefined; } workerStarted.push(name); log(`[editor98] starting worker ${name} for ${label} at ${Math.round(performance.now() - t0)} ms`); return new QjsWorker(path.join(monacoDir, 'workers', name + '.worker.js').replace(/\\/g, '/')); } };
globalThis.__workersStarted98 = workerStarted;
(0, eval)(fs.readFileSync(path.join(monacoDir, 'monaco.js'), 'utf8'));
const tMonaco = performance.now();

// ---- Luau linting: Luau's own analyzer (luau-analyze, cross-built for XP: tools/) on a copy of the buffer next to a .luaurc that declares Roblox's globals (and those of the
// project's own .luaurc, the nearest one above the file); its Luacheck-style lines become { line, col, endCol, severity, code, message }
const toolsDir = path.resolve(opt('tools', path.join(here, '..', 'tools')));
const analyzer = [path.join(toolsDir, 'luau-analyze.exe'), path.join(toolsDir, 'luau-analyze')].find(f => fs.existsSync(f)) || null;
const lintDir = path.join(userDir, 'lint');
let robloxGlobals = null;
function projectLuaurc(file) {
	for (let d = path.dirname(file); d.length >= workspace.length; d = path.dirname(d)) { const f = path.join(d, '.luaurc'); if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch { return null; } } if (d === path.dirname(d)) { break; } }
	return null;
}
// one luau-analyze process for the session (--server: the 700 KB of Roblox definitions are read once), one check at a time: write the buffer, send its name, read until @@END
const definitions = [path.join(toolsDir, 'roblox.d.luau')].find(f => fs.existsSync(f)) || null;
let lintProc = null, lintQueue = Promise.resolve(), lintOut = '', lintWait = null;
function lintServer() {
	if (lintProc) { return lintProc; }
	const argsA = ['--formatter=plain', '--server', ...(definitions ? ['--definitions=' + definitions] : [])];
	lintProc = globalThis.__builtins.child_process.spawn(analyzer, argsA, { cwd: lintDir, windowsHide: true });
	lintProc.stdout.on('data', (d) => { lintOut += String(d); const k = lintOut.indexOf('@@END'); if (k >= 0 && lintWait) { const text = lintOut.slice(0, k); lintOut = lintOut.slice(lintOut.indexOf('\n', k) + 1); const w = lintWait; lintWait = null; w(text); } });
	lintProc.stderr.on('data', (d) => log('[editor98] luau-analyze: ' + String(d).trim().slice(0, 300)));
	lintProc.on('exit', (code) => { log(`[editor98] luau-analyze exited (${code})`); lintProc = null; if (lintWait) { const w = lintWait; lintWait = null; w(''); } });
	return lintProc;
}
function lintLuau(text, file) {
	if (!analyzer || settings.lint === false) { return Promise.resolve(null); }
	const run = async () => {
		try { fs.mkdirSync(lintDir, { recursive: true }); } catch { }
		const own = projectLuaurc(file) || {};
		const rc = { languageMode: own.languageMode || settings.luauMode, lint: own.lint, lintErrors: false, globals: [...new Set([...(robloxGlobals || []), ...(own.globals || [])])] };
		const rcText = JSON.stringify(rc); if (rcText !== lintLuau.rc) { fs.writeFileSync(path.join(lintDir, '.luaurc'), rcText); lintLuau.rc = rcText; }
		const name = /\.lua$/i.test(file) ? 'buffer.lua' : 'buffer.luau'; fs.writeFileSync(path.join(lintDir, name), text);
		const t = performance.now(); const p = lintServer();
		const outText = await new Promise((resolve) => { lintWait = resolve; p.stdin.write(name + '\n'); });
		const out = []; for (const lineText of outText.split(/\r?\n/)) {
			const m = /^.*?:(\d+):(\d+)(?:-(\d+))?: \((\w+)\) (\w+): (.*)$/.exec(lineText); if (!m) { continue; }
			out.push({ line: +m[1], col: +m[2], endCol: (m[3] ? +m[3] : +m[2]) + 1, code: m[5], message: m[6], severity: m[5] === 'SyntaxError' || m[5] === 'TypeError' ? 'error' : 'warning' });
		}
		log(`[editor98] lint ${path.basename(file)}: ${out.length} problems in ${Math.round(performance.now() - t)} ms`);
		return out;
	};
	const r = lintQueue.then(run, run); lintQueue = r.catch(() => { }); return r;
}

// ---- what the shell may do outside the page
let winHost = null;
// the folder: the one named on the command line, else the one open when the editor last closed (userdata/state.json), else --default-folder, else the current directory
const statePath = path.join(userDir, 'state.json'); let saved = {}; try { saved = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { }
const remember = (k, v) => { saved[k] = v; try { fs.mkdirSync(userDir, { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(saved, null, 1)); } catch (e) { log('[editor98] cannot write state.json: ' + e.message); } };
const isFolder = (d) => { try { return !!d && fs.statSync(d).isDirectory(); } catch { return false; } };
let workspace = path.resolve(positional[0] || (isFolder(saved.folder) ? saved.folder : null) || opt('default-folder', null) || P.cwd());
// the dialogs of Windows (spike:win, modal to the window); headless runs answer from globalThis.__dialog98(kind, ...args) (a test sets it) or cancel
const dialog = (kind, ...a) => { if (winHost) { return winHost[kind](...a); } const f = globalThis.__dialog98; return f ? f(kind, ...a) : null; };
const native = (p) => p && P.platform === 'win32' ? p.replace(/\//g, '\\') : p;
const host = {
	path, settings, workspace, platform: P.platform,
	readDir: (d) => fs.readdirSync(d), isDir: (p) => fs.statSync(p).isDirectory(),
	readFile: (f) => fs.readFileSync(f, 'utf8'), writeFile: (f, text) => fs.writeFileSync(f, text, 'utf8'),
	setTitle: (t) => { if (winHost) { winHost.setTitle(t); } },
	confirm: (msg) => { const r = dialog('confirm', msg); log(`[editor98] asked "${msg.split('\n')[0]}": ${r || 'cancel'}`); return r || 'cancel'; },
	pickFolder: (start) => { const d = dialog('pickFolder', native(start)); return d ? path.resolve(d) : null; },
	openFileDialog: (start) => { const f = dialog('openFile', native(start)); return f ? path.resolve(f) : null; },
	saveFileDialog: (start) => { const f = dialog('saveFile', native(start)); return f ? path.resolve(f) : null; },
	setWorkspace: (d) => { workspace = d; host.workspace = d; remember('folder', d); log('[editor98] folder ' + d); },
	lint: (text, file) => lintLuau(text, file),
	openFiles: positional.slice(1).map(f => path.resolve(f)),
};
const { registerLuau, luauGlobals } = await import('../app/luau.js'); robloxGlobals = luauGlobals; registerLuau(globalThis.monaco);
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
	const w = openWindow(ctx, { width: W, height: H, title: 'editor98', background: [31, 31, 31], onClose: () => { remember('folder', workspace); }, canClose: () => shell.canClose() });
	const MB_YESNOCANCEL = 0x3, MB_ICONWARNING = 0x30;
	winHost = {
		setTitle: (t) => win.setTitle(w.id, t),
		confirm: (msg) => { const r = win.messageBox(w.id, msg.replace(/\n/g, '\r\n'), 'editor98', MB_YESNOCANCEL | MB_ICONWARNING); w.afterModal(); return r === 6 ? 'save' : r === 7 ? 'discard' : 'cancel'; },
		pickFolder: (start) => { const r = win.pickFolder(w.id, 'Open Folder', start || ''); w.afterModal(); return r; },
		openFile: (start) => { const r = win.openFileDialog(w.id, 'Open File', start || ''); w.afterModal(); return r; },
		saveFile: (start) => { const r = win.saveFileDialog(w.id, 'Save As', start || ''); w.afterModal(); return r; },
	};
	host.setTitle(`${path.basename(workspace)} - editor98`);
}
