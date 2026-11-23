// Monaco alone on our engine (06-rendering DOM + CSS + layout, 07-native-render native layout, style and rasterizer): how much memory, how long to load, how long a keystroke takes
// end to end (keydown, Monaco's update in its animation frame, our layout pass and paint), compared with the full workbench (spike 14). Headless.
//   qjs-spike7 --stack-size 0 proto.mjs <monacoDir> [--file sample.lua] [--lang lua] [--keys 40] [--width 1000] [--height 700] [--ppm out.ppm] [--style native|js]
import * as std from 'qjs:std';
import * as os from 'qjs:os';
import '../../02-node-shim/host/globals.js';
import * as opentype from '../../../../node_modules/opentype.js/dist/opentype.mjs';
import '../../06-rendering/host/dom/intl_shim.js';
import { installEnvironment } from '../../06-rendering/host/dom/env.js';
import { paintDocument, toPPM } from '../../06-rendering/host/dom/paint.js';
import { createInputDriver } from '../../06-rendering/host/dom/input_driver.js';
import { NativeBackend } from '../../07-native-render/host/native_backend.js';
import { installWebShims } from '../../08-workbench-boot/host/web_shims.js';

console.error ??= (...a) => { std.err.puts(a.map(String).join(' ') + '\n'); std.err.flush(); };
const args = scriptArgs.slice(1); const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const monacoDir = args[0]; const W = Number(opt('width', 1000)), H = Number(opt('height', 700));
const log = (m) => { std.out.puts(m + '\n'); std.out.flush(); };
globalThis.__readFileBytes = (p) => { const f = std.open(p, 'rb'); f.seek(0, std.SEEK_END); const n = f.tell(); f.seek(0, std.SEEK_SET); const ab = new ArrayBuffer(n); f.read(ab, 0, n); f.close(); return ab; };
const rss = () => { const s = std.loadFile('/proc/self/status') || ''; const m = /VmRSS:\s+(\d+)/.exec(s), h = /VmHWM:\s+(\d+)/.exec(s); return `${m ? Math.round(+m[1] / 1024) : '?'} MB (peak ${h ? Math.round(+h[1] / 1024) : '?'} MB)`; };
const sleep = (ms) => new Promise(r => os.setTimeout(r, ms));
const SAMPLE = `-- sample: a Roblox-style Luau module
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("PlayerData")

local Module = {}
Module.__index = Module

function Module.new(player: Player)
	local self = setmetatable({}, Module)
	self.player = player
	self.coins = 0
	return self
end

function Module:addCoins(n: number)
	self.coins += n
	if self.coins > 100 then
		print(\`\${self.player.Name} is rich\`)
	end
end

Players.PlayerAdded:Connect(function(player)
	local data = Module.new(player)
	local ok, saved = pcall(function() return store:GetAsync(player.UserId) end)
	if ok and saved then data.coins = saved end
end)

return Module
`;

async function main() {
	const t0 = performance.now();
	const env = installEnvironment({ width: W, height: H, opentype }); const doc = env.document;
	installWebShims(env, { baseUrl: 'http://localhost', readFile: (p) => globalThis.__readFileBytes(monacoDir + '/' + p) });   // performance marks, fetch and the other web globals Monaco expects
	const nl = await import('../../07-native-render/host/native_layout.js'); env.layoutEngine = nl.engine;
	if (opt('style', 'native') !== 'js') { const ns = await import('../../07-native-render/host/native_style.js'); env.styleEngine = ns.engine; }
	const st = doc.createElement('style'); st.textContent = std.loadFile(monacoDir + '/monaco.css') + '\nhtml,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#1e1e1e}#container{position:absolute;left:0;top:0;right:0;bottom:0}'; doc.head.appendChild(st);
	const box = doc.createElement('div'); box.id = 'container'; doc.body.appendChild(box);
	const tEval = performance.now(); await import(monacoDir + '/monaco.mjs'); const evalMs = performance.now() - tEval; const rssEval = rss();
	const file = opt('file', null); const text = file ? std.loadFile(file) : SAMPLE;
	const tCreate = performance.now();
	const editor = globalThis.monaco.editor.create(box, { value: text, language: opt('lang', 'lua'), theme: opt('theme', 'vs-dark'), fontFamily: 'DejaVu Sans Mono', fontSize: 14, lineHeight: 19, minimap: { enabled: opt('minimap', '0') === '1' },
		automaticLayout: false, dimension: { width: W, height: H }, editContext: false, smoothScrolling: false, cursorBlinking: 'solid', accessibilitySupport: 'off', fontLigatures: false });
	const createMs = performance.now() - tCreate;
	const settle = async () => { for (let i = 0, stable = 0, last = -1; i < 400 && stable < 4; i++) { await sleep(5); env.flushFrames(); doc.__ensureLayout(); const n = doc.getElementsByTagName('*').length; if (n === last && !env.pendingFrames()) { stable++; } else { stable = 0; } last = n; } };
	await settle();
	const backend = new NativeBackend(W, H); const paint = () => { backend.reset(); return paintDocument(doc, W, H, backend); };
	if (opt('debug', '0') === '1') { for (const sel of ['#container', '.monaco-editor', '.overflow-guard', '.view-lines', '.view-line', '.margin']) { const e = doc.querySelector(sel); const r = e && e.getBoundingClientRect(); log(`[debug] ${sel}: ${e ? `${r.x},${r.y} ${r.width}x${r.height} display=${getComputedStyle(e).display} pos=${getComputedStyle(e).position} bg=${getComputedStyle(e).backgroundColor} vis=${getComputedStyle(e).visibility} op=${getComputedStyle(e).opacity} z=${getComputedStyle(e).zIndex} color=${getComputedStyle(e).color}` : 'none'}`); } const vl = doc.querySelector('.view-line'); log('[debug] first line html: ' + (vl ? vl.outerHTML.slice(0, 300) : '-')); }
	let tp = performance.now(); paint(); const firstPaint = performance.now() - tp;
	log(`load: eval ${Math.round(evalMs)} ms (RSS ${rssEval}), create ${Math.round(createMs)} ms, until stable and painted ${Math.round(performance.now() - t0)} ms; first paint ${Math.round(firstPaint)} ms; elements ${doc.getElementsByTagName('*').length}; layouts ${doc.__layoutCount}; RSS ${rss()}`);
	// typing through the window's input path (keydown, char, keyup), then what the window does on its next tick: animation frames, layout, paint
	editor.focus(); await settle();
	const driver = createInputDriver({ doc, env, log, opt: () => '0' }, { setCursor() { }, activity() { } });
	editor.setPosition({ lineNumber: 12, column: 15 });
	const word = 'local totalCoins = self.coins * 2 '; const nKeys = Number(opt('keys', 40)); const times = [];
	for (let i = 0; i < nKeys; i++) {
		const ch = word[i % word.length]; const vk = ch === ' ' ? 32 : ch === '=' ? 187 : ch === '*' ? 56 : ch === '.' ? 190 : /[0-9]/.test(ch) ? ch.charCodeAt(0) : ch.toUpperCase().charCodeAt(0); const mods = ch === '*' ? 1 : 0;
		const t = performance.now(); const passes0 = doc.__layoutCount;
		driver.handle('keydown', vk, 0, 0, 0, mods); driver.handle('char', ch.charCodeAt(0), 0, 0, 0, mods); driver.handle('keyup', vk, 0, 0, 0, mods);
		await sleep(0); env.flushFrames(); doc.__ensureLayout(); paint();
		times.push([performance.now() - t, doc.__layoutCount - passes0]);
	}
	const ms = times.map(x => x[0]).sort((a, b) => a - b); const q = (f) => ms[Math.min(ms.length - 1, Math.floor(ms.length * f))].toFixed(1);
	log(`typing ${nKeys} keys: median ${q(0.5)} ms, 90th percentile ${q(0.9)} ms, slowest ${q(1)} ms, layout passes per key ${(times.reduce((a, x) => a + x[1], 0) / nKeys).toFixed(1)}; line now: ${JSON.stringify(editor.getModel().getLineContent(12))}; RSS ${rss()}`);
	// scrolling a page down and back, and a select-all + delete + undo
	let t = performance.now(); editor.setScrollTop(400); await sleep(0); env.flushFrames(); doc.__ensureLayout(); paint(); const scrollMs = performance.now() - t;
	t = performance.now(); editor.trigger('k', 'undo'); await sleep(0); env.flushFrames(); doc.__ensureLayout(); paint(); const undoMs = performance.now() - t;
	log(`scroll ${Math.round(scrollMs)} ms, undo ${Math.round(undoMs)} ms; heap: ${globalThis.__gcStats ? Math.round(globalThis.__gcStats()[2] / 1048576) + ' MB' : '?'}`);
	const ppm = opt('ppm', null); if (ppm) { const r = opt('backend', 'native') === 'js' ? paintDocument(doc, W, H) : paint(); const u8 = toPPM(r.px, r.w, r.h); const f = std.open(ppm, 'wb'); f.write(u8.buffer, u8.byteOffset, u8.byteLength); f.close(); log('wrote ' + ppm + ' ' + JSON.stringify(backend.stats)); }
	std.exit(0);
}
main().catch(e => { log('FATAL ' + (e && e.stack || e)); std.exit(1); });
