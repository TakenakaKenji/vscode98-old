// Randomised test of the incremental layout (06-rendering/host/dom/layout_incremental.js) against a full layout, inside the editor's page:
// a random tree of absolutely / relatively positioned, overflow-clipped, flex and plain blocks with text, then random mutations (insert, remove, move, text,
// display: none, position, size, insets, overflow, class changes); after every step a layout pass, compared box by box with a full layout (__verifyIncLayout98).
//   ... editor98.mjs <folder> --headless 1 --scenario tests/inc_layout_fuzz.mjs [--fuzz-steps 3000] [--fuzz-seed 1]
import * as dmg from '../../06-rendering/host/dom/damage.js';
export async function run({ doc, log, opt, paint }) {
	const steps = Number(opt('fuzz-steps', '3000')); let seed = Number(opt('fuzz-seed', '1')) >>> 0;
	const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; const pick = (a) => a[Math.floor(rnd() * a.length)];
	const host = doc.createElement('div'); host.setAttribute('style', 'position:absolute;left:300px;top:40px;width:600px;height:500px;overflow:hidden'); doc.body.appendChild(host);
	const css = doc.createElement('style'); css.textContent = '.fz-a{padding:3px}.fz-b{border:2px solid red;margin:4px}.fz-c{display:flex}.fz-d{font-size:18px}'; doc.head.appendChild(css);
	const STYLES = [
		() => `position:absolute;left:${Math.floor(rnd() * 200)}px;top:${Math.floor(rnd() * 200)}px;width:${Math.floor(rnd() * 200) + 10}px;height:${Math.floor(rnd() * 100) + 10}px`,
		() => `position:absolute;left:${Math.floor(rnd() * 100)}px;top:${Math.floor(rnd() * 100)}px`,
		() => `position:absolute;right:${Math.floor(rnd() * 50)}px;bottom:${Math.floor(rnd() * 50)}px;width:50%`,
		() => `position:absolute;top:${Math.floor(rnd() * 100)}px;height:20px;width:100%`,
		() => 'position:absolute',
		() => `position:relative;height:${Math.floor(rnd() * 80) + 10}px;overflow:hidden`,
		() => `position:relative;left:${Math.floor(rnd() * 10)}px`,
		() => `overflow:hidden;height:${Math.floor(rnd() * 60) + 5}px`,
		() => 'display:flex;position:relative', () => '', () => '', () => 'display:none', () => 'display:inline', () => `margin-top:${Math.floor(rnd() * 20)}px`,
		() => `position:fixed;left:5px;top:5px;width:30px;height:30px`,
	];
	const WORDS = ['local', 'x', 'function', 'end', 'hello world', '', 'a b c d e f g h i j k l m n o p'];
	const all = [host];
	const make = () => { const e = doc.createElement(rnd() < 0.15 ? 'span' : 'div'); e.setAttribute('style', pick(STYLES)()); if (rnd() < 0.3) { e.className = pick(['fz-a', 'fz-b', 'fz-c', 'fz-d', 'fz-a fz-b']); } if (rnd() < 0.6) { e.appendChild(doc.createTextNode(pick(WORDS))); } all.push(e); return e; };
	for (let i = 0; i < 40; i++) { const p = pick(all); p.appendChild(make()); }
	globalThis.__verifyIncLayout98 = { checked: 0, bad: 0, first: [] }; globalThis.__verifyDamage98 = { partial: 0, bad: 0, first: [] }; doc.__ensureLayout(); paint(true);
	const live = () => all.filter(e => e.isConnected); let lastScroll = null;
	const OPS = [
		() => { const p = pick(live()); const c = make(); const kids = p.__children; if (kids.length && rnd() < 0.5) { p.insertBefore(c, pick(kids)); } else { p.appendChild(c); } },
		() => { const e = pick(live()); if (e !== host && e.parentNode) { e.parentNode.removeChild(e); } },
		() => { const e = pick(live()), p = pick(live()); if (e !== host && !e.contains(p)) { p.appendChild(e); } },
		() => { const e = pick(live()); const t = [...e.__children].find(c => c.nodeType === 3); if (t) { t.data = pick(WORDS); } else { e.appendChild(doc.createTextNode(pick(WORDS))); } },
		() => { const e = pick(live()); if (e !== host) { e.setAttribute('style', pick(STYLES)()); } },
		() => { const e = pick(live()); if (e !== host) { e.style.display = e.style.display === 'none' ? '' : 'none'; } },
		() => { const e = pick(live()); if (e !== host) { e.style.top = Math.floor(rnd() * 150) + 'px'; } },
		() => { const e = pick(live()); if (e !== host) { e.style.width = Math.floor(rnd() * 150) + 'px'; } },
		() => { const e = pick(live()); if (e !== host) { e.className = pick(['', 'fz-a', 'fz-b', 'fz-c', 'fz-d']); } },
		() => { const e = pick(live()); if (e !== host) { e.textContent = pick(WORDS); } },
		() => { const e = pick(live()); if (e !== host) { const t0 = e.scrollTop, l0 = e.scrollLeft; e.scrollTop = Math.floor(rnd() * 40); e.scrollLeft = Math.floor(rnd() * 20); lastScroll = () => { const d = (a) => a.localName + '[' + (a.getAttribute('style') || '') + (a.className ? ' .' + a.className : '') + ']'; const b = doc.__layout.boxOf.get(e); const kids = b ? b.children.map(c => c.el ? (c.el.nodeType === 1 ? d(c.el) : '#text') + '{' + c.kind + ' ' + c.pos + '}' : (c.anon ? 'anon' : '?')).join(' ') : 'no box'; let anc = []; for (let a = e.parentNode; a && a !== host; a = a.parentNode) { anc.push(d(a)); } return `scrolled ${d(e)} kind ${b && b.kind} from ${l0},${t0} to ${e.scrollLeft},${e.scrollTop}; children: ${kids}; ancestors: ${anc.join(' < ')}`; }; } },   // scrolled boxes: paint offsets without a layout
	];
	const t0 = performance.now(); const mod = await import('../../06-rendering/host/dom/layout_incremental.js'); const p0 = mod.incStats.passes;
	for (let s = 0; s < steps; s++) {
		const n = 1 + Math.floor(rnd() * 3); const did = []; lastScroll = null; for (let k = 0; k < n; k++) { const i = Math.floor(rnd() * OPS.length); did.push(i); OPS[i](); }
		doc.__ensureLayout(); if (paint && s % (Number(opt('fuzz-paint-every', '2')) || 1) === 0) { paint(); }   // a partial frame (damage.js) compared pixel by pixel with a full paint (__verifyDamage98)
		const v = globalThis.__verifyIncLayout98; if (v.bad) { log(`[fuzz] step ${s} (seed ${opt('fuzz-seed', '1')}): ${v.first[0]}`); break; }
		if (opt('fuzz-offsets', '0') === '1' && paint) {   // every box painted where damage.js thinks it is (paint.js records the offset it used)
			globalThis.__paintOffsets98 = new Map(); paint(true); const po = globalThis.__paintOffsets98; globalThis.__paintOffsets98 = null; let badOff = null;
			for (const [b, o] of po) { if (!b.el || !host.contains(b.el) || b.pos === 'fixed') { continue; } const m = dmg.paintOffsetOf(b); if (m && (Math.abs(m[0] - o[0]) > 1e-6 || Math.abs(m[1] - o[1]) > 1e-6)) { badOff = [b, o, m]; break; } }
			if (badOff) { const [b, o, m] = badOff; const d = (a) => a.localName + '[' + (a.getAttribute('style') || '') + (a.className ? ' .' + a.className : '') + (a.__scrollTop || a.__scrollLeft ? ' scroll ' + a.__scrollLeft + ',' + a.__scrollTop : '') + ']'; const anc = []; for (let a = b.el.parentNode; a && a !== host; a = a.parentNode) { anc.push(d(a)); } log(`[fuzz] step ${s}: ${d(b.el)} {${b.kind} ${b.pos}} painted at offset ${o} but damage.js says ${m}; ancestors: ${anc.join(' < ')}`); break; }
		}
		const pv = globalThis.__verifyDamage98; if (pv.bad) {
			log(`[fuzz] step ${s} (seed ${opt('fuzz-seed', '1')}): paint: ${pv.first[0]}; ops ${did.join(',')}`); if (lastScroll) { log('[fuzz]   ' + lastScroll().slice(0, 1500)); }
			const m = /first at (\d+),(\d+)/.exec(pv.first[0]); if (m) { const desc = (e) => { const out = []; for (let a = e; a && a.nodeType === 1; a = a.parentNode) { out.push(`${a.localName}[${a.getAttribute('style') || ''}${a.className ? ' .' + a.className : ''}${a.__scrollTop || a.__scrollLeft ? ' scroll ' + a.__scrollLeft + ',' + a.__scrollTop : ''}]`); if (a === host) { break; } } return out.join(' < '); }; for (const e of doc.elementsFromPoint(+m[1], +m[2]).slice(0, 3)) { log('[fuzz]   at the pixel: ' + desc(e)); } }
			break; }
	}
	const v = globalThis.__verifyIncLayout98; const pv = globalThis.__verifyDamage98;
	log(`[fuzz] partial frames ${pv.partial} compared, ${pv.bad} different`);
	log(`[fuzz] ${steps} steps in ${Math.round(performance.now() - t0)} ms: ${mod.incStats.passes - p0} incremental passes, ${v.checked} compared with a full layout, ${v.bad} different; fallbacks ${JSON.stringify(mod.incStats.why)}`);
	globalThis.__verifyIncLayout98 = null; globalThis.__verifyDamage98 = null; host.remove();
}
