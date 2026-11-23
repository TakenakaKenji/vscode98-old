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
	const ed = new Proxy({}, { get: (_, k) => { const e = shell.editor; const v = e[k]; return typeof v === 'function' ? v.bind(e) : v; } }); /* the active tab's editor (shell.js keeps one per recent tab) */ ed.setPosition({ lineNumber: 14, column: 16 }); ed.focus(); await tick();
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
	await runLuau({ doc, log, shell, settle, monaco });
	await runSearchTest({ doc, log, shell, settle });
	await runDialogs({ doc, log, shell, settle });
}
// Luau: lint markers and the re-indenting formatter
export async function runLuau({ doc, log, shell, settle, monaco }) {
	const fs = globalThis.__builtins.fs, path = globalThis.__builtins.path;
	const f = path.join(shell.state.root, 'messy.luau'); fs.writeFileSync(f, 'local unused = 1\nfunction f(x)\nif x then\nprint(game.Workspace)\n      end\nend\nreturn f\n');
	shell.openFile(f); await settle();
	for (let i = 0; i < 100 && !monaco.editor.getModelMarkers({ owner: 'luau' }).length; i++) { await new Promise(r => setTimeout(r, 50)); }
	log(`[smoke] lint markers: ${monaco.editor.getModelMarkers({ owner: 'luau' }).map(m => `${m.startLineNumber}:${m.code}`).join(', ')}; status: ${doc.getElementById('statusbar').textContent}`);
	await shell.editor.getAction('editor.action.formatDocument').run(); await settle();
	log(`[smoke] formatted: ${JSON.stringify(shell.editor.getModel().getValue())}`);
	const tokens = monaco.editor.tokenize('local x: number = if a then 1 else 2 -- c\nlocal s = `hi {name}`', 'luau');
	log(`[smoke] tokens: ${tokens[0].map(t => t.type).join(' ')} | ${tokens[1].map(t => t.type).join(' ')}`);
}
// search across the folder
export async function runSearchTest({ doc, log, shell, settle }) {
	shell.showView('search'); const input = doc.querySelector('.search-box input'); input.value = 'GetService'; shell.runSearch(); await settle();
	log(`[smoke] search: ${doc.querySelector('.search-info').textContent}; first: ${[...doc.querySelectorAll('.sr-line')].slice(0, 2).map(e => e.textContent).join(' | ')}`);
	const row = doc.querySelector('.sr-line'); row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); await settle();
	log(`[smoke] after click: ${shell.state.active && shell.state.active.name} selection ${JSON.stringify(shell.editor.getSelection())}`);
}
// the questions and dialogs (answered by a script here, by Windows in the window): Save / Don't Save / Cancel on closing, New File + Save As, Open Folder
export async function runDialogs({ doc, log, shell, settle }) {
	const fs = globalThis.__builtins.fs, path = globalThis.__builtins.path; const answers = []; const asked = [];
	globalThis.__dialog98 = (kind, ...a) => { asked.push(kind); const r = answers.shift(); return r === undefined ? null : r; };
	const tabs = () => shell.state.tabs.map(t => t.name + (t.model.getAlternativeVersionId() !== t.savedVersion ? '*' : '')).join(', ');
	const root = shell.state.root; const ed = new Proxy({}, { get: (_, k) => { const e = shell.editor; const v = e[k]; return typeof v === 'function' ? v.bind(e) : v; } }); /* the active tab's editor (shell.js keeps one per recent tab) */
	shell.openFile(path.join(root, 'README.md')); ed.getModel().setValue('# changed\n'); await settle();
	answers.push('cancel'); log(`[smoke] close changed README, Cancel: closed ${shell.closeTab(shell.state.active)}; tabs ${tabs()}`);
	answers.push('discard'); log(`[smoke] close again, Don't Save: closed ${shell.closeTab(shell.state.active)}; on disk ${JSON.stringify(fs.readFileSync(path.join(root, 'README.md'), 'utf8').slice(0, 12))}; tabs ${tabs()}`);
	const t = shell.newFile(); ed.getModel().setValue('print("new")\n'); await settle();
	const target = path.join(root, 'new.luau'); answers.push('save', target);
	log(`[smoke] new file then close, Save -> Save As ${path.basename(target)}: closed ${shell.closeTab(t)}; exists ${fs.existsSync(target)}; text ${JSON.stringify(fs.existsSync(target) && fs.readFileSync(target, 'utf8'))}; tree has it ${[...doc.querySelectorAll('.row .name')].some(e => e.textContent === 'new.luau')}`);
	shell.openFile(path.join(root, 'main.luau')); ed.getModel().setValue(ed.getModel().getValue() + '-- more\n'); await settle();
	answers.push('cancel'); log(`[smoke] window close with a change, Cancel: may close ${shell.canClose()}`);
	const other = path.join(root, 'src'); answers.push(other, 'discard');
	shell.openFolder(); await settle();
	log(`[smoke] Open Folder src (Don't Save): root ${path.basename(shell.state.root)}, header ${doc.querySelector('.root-name .label').textContent}, rows ${[...doc.querySelectorAll('.row .name')].map(e => e.textContent).join(' ')}; tabs [${tabs()}]; asked ${asked.join(' ')}`);
	globalThis.__dialog98 = null;
}
