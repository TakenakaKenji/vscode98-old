// Headless smoke test of the shell: open a file from the explorer, type through the window's input path, save, reopen from quick open, format JSON; prints timings.
//   ... editor98.mjs <copy of sample> --headless 1 --scenario tests/smoke.mjs --ppm out.ppm
import { createInputDriver } from '../../06-rendering/host/dom/input_driver.js';
export async function run({ env, doc, log, shell, settle, paint, monaco }) {
	const fs = globalThis.__builtins.fs, path = globalThis.__builtins.path;
	const driver = createInputDriver({ doc, env, log, opt: () => '0' }, { setCursor() { }, activity() { } });
	const click = (e) => { const r = e.getBoundingClientRect(); const x = Math.round(r.x + 20), y = Math.round(r.y + r.height / 2); driver.handle('mousedown', x, y, 0, 0, 0); driver.handle('mouseup', x, y, 0, 0, 0); };
	const tick = async () => { await settle(); paint(); };
	const timed = async (name, f) => { const t = performance.now(); await f(); await tick(); log(`[smoke] ${name}: ${Math.round(performance.now() - t)} ms`); };
	const row = (name) => [...doc.querySelectorAll('.row')].find(r => r.querySelector('.name').textContent === name);
	await tick();
	await timed('expand src', () => click(row('src')));
	await timed('open util.lua', () => click(row('util.lua')));
	await timed('open main.luau', () => click(row('main.luau')));
	const ed = shell.editor; ed.setPosition({ lineNumber: 14, column: 16 }); ed.focus(); await tick();
	const keyTimes = [];
	for (const ch of ' -- ok') { const vk = ch === ' ' ? 32 : ch === '-' ? 189 : ch.toUpperCase().charCodeAt(0); const t = performance.now(); driver.handle('keydown', vk, 0, 0, 0, 0); driver.handle('char', ch.charCodeAt(0), 0, 0, 0, 0); driver.handle('keyup', vk, 0, 0, 0, 0); await tick(); keyTimes.push(performance.now() - t); }
	log(`[smoke] typed: ${JSON.stringify(ed.getModel().getLineContent(14))}, ${keyTimes.map(x => Math.round(x)).join(' ')} ms per key; tab dirty: ${doc.querySelector('.tab.active').className}`);
	await timed('save (Ctrl+S)', () => { driver.handle('keydown', 17, 0, 0, 0, 2); driver.handle('keydown', 83, 0, 0, 0, 2); driver.handle('keyup', 83, 0, 0, 0, 2); driver.handle('keyup', 17, 0, 0, 0, 0); });
	log(`[smoke] saved line 14 on disk: ${JSON.stringify(fs.readFileSync(path.join(shell.state.root, 'main.luau'), 'utf8').split('\n')[13])}; tab: ${doc.querySelector('.tab.active').className}`);
	await timed('quick open (Ctrl+P)', () => { driver.handle('keydown', 17, 0, 0, 0, 2); driver.handle('keydown', 80, 0, 0, 0, 2); driver.handle('keyup', 80, 0, 0, 0, 2); driver.handle('keyup', 17, 0, 0, 0, 0); });
	for (const ch of 'pkg') { driver.handle('keydown', ch.toUpperCase().charCodeAt(0), 0, 0, 0, 0); driver.handle('char', ch.charCodeAt(0), 0, 0, 0, 0); driver.handle('keyup', ch.toUpperCase().charCodeAt(0), 0, 0, 0, 0); }
	await tick(); log(`[smoke] quick open items: ${[...doc.querySelectorAll('#quick .item')].map(e => e.textContent).join(' | ')}`);
	await timed('open package.json (Enter)', () => { driver.handle('keydown', 13, 0, 0, 0, 0); driver.handle('keyup', 13, 0, 0, 0, 0); });
	log(`[smoke] tabs: ${[...doc.querySelectorAll('.tab')].map(e => e.textContent.slice(0, -1)).join(', ')}; language ${ed.getModel().getLanguageId()}; status: ${doc.getElementById('statusbar').textContent}`);
	await timed('format JSON (Shift+Alt+F)', async () => { try { await ed.getAction('editor.action.formatDocument').run(); } catch (e) { log('[smoke] format failed: ' + (e && e.stack || e)); } await new Promise(r => setTimeout(r, 300)); });
	log(`[smoke] formatted JSON: ${JSON.stringify(ed.getModel().getValue().slice(0, 60))}`);
	await timed('back to main.luau', () => click([...doc.querySelectorAll('.tab')].find(t => t.textContent.startsWith('main.luau'))));
}
