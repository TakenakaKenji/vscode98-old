// Where the time of an input goes, headless: for each input the handler (the DOM event: Monaco's keydown/input), the frames it asked for (Monaco renders in
// requestAnimationFrame), style + layout (doc.__ensureLayout) and a full paint, as the window would do it. Median and 90th percentile of each part per kind of input.
//   ... editor98.mjs <copy of sample> --headless 1 --scenario tests/perf.mjs [--perf-rounds 40]
import { createInputDriver } from '../../06-rendering/host/dom/input_driver.js';
export async function run({ env, doc, log, shell, settle, paint, opt, frames, gcIdle }) {
	let gcRuns = 0;
	const path = globalThis.__builtins.path; const N = Number(opt('perf-rounds', '40'));
	const driver = createInputDriver({ doc, env, log, opt: () => '0' }, { setCursor() { }, activity() { } });
	shell.openFile(path.join(shell.state.root, 'main.luau')); await settle(); paint();
	const ed = shell.editor; ed.setPosition({ lineNumber: 14, column: 16 }); ed.focus(); await settle(); paint();
	const parts = {}, spans = []; if (opt('perf-nodamage', '0') === '1') { globalThis.__noDamage98 = true; } const damages = {}; if (opt('perf-verify', '0') === '1') { globalThis.__verifyIncLayout98 = { checked: 0, bad: 0, first: [] }; globalThis.__verifyDamage98 = { partial: 0, bad: 0, first: [] }; }
	const measure = async (kind, input) => {
		const e0 = Date.now(); const lc0 = doc.__layoutCount | 0; const t0 = performance.now(); input(); const t1 = performance.now();
		env.flushFrames(); const t2 = performance.now();
		doc.__ensureLayout(); let t3 = performance.now(); let later = 0;
		for (let k = 0; k < 3; k++) { await new Promise(res => setTimeout(res, 0)); const a = performance.now(); env.flushFrames(); doc.__ensureLayout(); later += performance.now() - a; }   // what Monaco left to a timer or the next frame (the window would paint it on its next tick)
		const t3b = performance.now(); paint(); if (frames) { (damages[kind] ||= []).push(JSON.stringify(frames.last)); } const t4 = performance.now() - (t3b - t3) + later; t3 += later;
		const r = (parts[kind] ||= { handler: [], frames: [], styleLayout: [], paint: [], total: [], passes: [] });   // styleLayout includes the work of the timers and frames that followed
		r.handler.push(t1 - t0); r.frames.push(t2 - t1); r.styleLayout.push(t3 - t2); r.paint.push(t4 - t3); r.total.push(t4 - t0); r.passes.push((doc.__layoutCount | 0) - lc0); spans.push([kind, e0, Date.now()]);
		await new Promise(res => setTimeout(res, 1)); env.flushFrames(); doc.__ensureLayout();   // timers it set (Monaco's, the shell's) run outside the measurement
		if (gcIdle && globalThis.__gcWanted?.()) { globalThis.__gcNow(); gcRuns++; }   // what the window does at an idle moment
	};
	const key = (vk, ch, mods = 0) => () => { driver.handle('keydown', vk, 0, 0, 0, mods); if (ch) { driver.handle('char', ch.charCodeAt(0), 0, 0, 0, mods); } driver.handle('keyup', vk, 0, 0, 0, mods); };
	for (let i = 0; i < N; i++) { const ch = 'abcdefghij'[i % 10]; await measure('type a letter', key(ch.toUpperCase().charCodeAt(0), ch)); }
	for (let i = 0; i < N; i++) { await measure('arrow down', key(40)); }
	for (let i = 0; i < N; i++) { await measure('arrow right', key(39)); }
	for (let i = 0; i < Math.min(N, 20); i++) { await measure('page down/up', key(i % 2 ? 33 : 34)); }
	const r = doc.querySelector('.monaco-editor .view-lines').getBoundingClientRect();
	for (let i = 0; i < Math.min(N, 20); i++) { await measure('wheel', () => driver.handle('wheel', Math.round(r.x + 100), Math.round(r.y + 100), i % 4 < 2 ? -120 : 120, 0, 0)); }
	for (let i = 0; i < Math.min(N, 20); i++) { const y = Math.round(r.y + 20 + (i % 10) * 19); await measure('click in text', () => { driver.handle('mousedown', Math.round(r.x + 60), y, 0, 1, 0); driver.handle('mouseup', Math.round(r.x + 60), y, 0, 0, 0); }); }
	const tabs = () => [...doc.querySelectorAll('.tab')]; shell.openFile(path.join(shell.state.root, 'roblox.luau')); await settle();
	for (let i = 0; i < Math.min(N, 10); i++) { const t = tabs()[i % 2]; const b = t.getBoundingClientRect(); await measure('switch tab', () => { driver.handle('mousedown', Math.round(b.x + 20), Math.round(b.y + 10), 0, 1, 0); driver.handle('mouseup', Math.round(b.x + 20), Math.round(b.y + 10), 0, 0, 0); }); }
	if (opt('perf-spans', null)) { globalThis.__builtins.fs.writeFileSync(opt('perf-spans'), JSON.stringify(spans)); globalThis.__timelineDump?.(); }   // for a profile of the inputs only (QJS98_PROFILE)
	if (opt('perf-verify', '0') === '1') { const v = globalThis.__verifyIncLayout98; log(`[perf] incremental layout oracle: ${v.checked || 0} passes compared, ${v.bad || 0} different${(v.first || []).length ? ': ' + v.first.join(' || ') : ''}`); }
	if (opt('perf-verify', '0') === '1') { const v = globalThis.__verifyDamage98; log(`[perf] partial paint oracle: ${v.partial} partial frames compared with a full paint, ${v.bad} different${v.first.length ? ': ' + v.first.join(' || ') : ''}`); }
	if (frames) { const f = frames.stats; log(`[perf] frames: ${f.full} full, ${f.partial} partial, ${f.skipped} with nothing to paint; ${Math.round(f.pixels / Math.max(1, f.full + f.partial))} pixels per frame`); }
	{ const m = await import('../../06-rendering/host/dom/layout_incremental.js'); const s = m.incStats; s.why.mode = doc.__styleInfo && doc.__styleInfo.reason; log(`[perf] incremental passes ${s.passes} (roots ${s.roots}, boxes ${s.boxes}), full layouts ${doc.__layoutCount - (doc.__styleOnlyPasses || 0)}, style-only ${(doc.__styleOnlyPasses || 0) - (doc.__incPasses || 0)}; fallbacks: ${JSON.stringify(s.why)}`); }
	if (opt('perf-damage', '0') === '1') { for (const [k, v] of Object.entries(damages)) { log(`[perf] damage ${k}: ${v.slice(2, 6).join(' ')}`); } }
	const q = (v, f) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
	log(`[perf] idle collections between inputs: ${gcRuns}${globalThis.__gcStats ? ', forced inside inputs: ' + globalThis.__gcStats()[1] : ''}`);
	log(`[perf] elements ${doc.getElementsByTagName('*').length}; ms per input, median / 90th percentile:`);
	for (const [k, r] of Object.entries(parts)) { log(`[perf] ${k.padEnd(14)} ` + Object.entries(r).map(([n, v]) => `${n} ${q(v, 0.5).toFixed(1)}/${q(v, 0.9).toFixed(1)}`).join('  ')); }
}
