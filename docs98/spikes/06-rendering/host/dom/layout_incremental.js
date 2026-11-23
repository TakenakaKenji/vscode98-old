// Incremental layout: a pass whose changes all sit inside boxes that nothing outside depends on lays out only those boxes ("layout roots") and grafts the result
// into the previous layout, instead of laying out the whole document again (an editor typing a character changed one line of text, and paid for 217 elements).
//
// A layout root R is a box of the previous layout such that laying out R's subtree on its own gives the same result as the full layout:
//  - R is positioned (relative, absolute, fixed, or has a transform), so every absolutely positioned descendant has its containing block inside R; a descendant with
//    position: fixed (containing block: the viewport) makes the attempt fail;
//  - out of flow (absolute/fixed): nothing outside depends on R except scroll extents. R is laid out alone inside a stand-in for its containing block (the padding box
//    of the nearest positioned ancestor, or the viewport); an axis with an explicit inset (left/right, top/bottom) takes the position computed there, an axis that
//    uses the static position keeps R's previous position, which is only right when R's own style did not change (otherwise R does not qualify);
//  - in flow: R is block-level, establishes a block formatting context (overflow other than visible, or display flex / flow-root: no margin collapsing through it),
//    has a width in px (an auto width lets its content reach a shrink-to-fit ancestor), is not a flex item, its own style did not change, and after the layout its border box has the same size as before (else the attempt fails);
//  - the scroll extents of R's ancestors are recomputed afterwards exactly as layout.c's compute_scroll does.
// Each change of the mutation log is assigned the nearest qualifying root above it; a root that fails is replaced by the next one up; no root at all means a full layout.
// Oracle: globalThis.__verifyIncLayout98 = { checked, bad, first: [] } runs a full layout after every incremental pass and compares the box trees field by field.
import { Box, Layout, NO_LAYOUT_ATTR, resolveStyles, anonStyle, disposeSubtree, disposeLayout } from './layout.js';
import { damageBox, invalidateInk } from './damage.js';
import { deepEqual } from './style_invalidation.js';

export const incStats = { passes: 0, fallbacks: 0, roots: 0, boxes: 0, why: {} };
const why = (k) => { incStats.why[k] = (incStats.why[k] || 0) + 1; if (globalThis.__incDebug98) { globalThis.__incDebug98('fail: ' + k); } return false; };
const visible = (v) => v['overflow-x'] === 'visible' && v['overflow-y'] === 'visible';
const hasTransform = (v) => v.transform && v.transform !== 'none';
const inFlexParent = (b) => b.parent && (b.parent.display === 'flex' || b.parent.display === 'inline-flex');

/** the containing block of an out-of-flow box in the previous layout (layout.c containing_block): { x, y, w, h } or null when it is an inline box */
function containingBlock(b, vw, vh) {
	if (b.pos === 'fixed') { return { x: 0, y: 0, w: vw, h: vh }; }
	for (let p = b.parent; p; p = p.parent) {
		if (p.pos !== 'static' || (p.v && hasTransform(p.v))) { if (p.kind === 'inline') { return null; } return { x: p.ax + p.bl, y: p.ay + p.bt, w: p.w - p.bl - p.br, h: p.h - p.bt - p.bb }; }
	}
	return { x: 0, y: 0, w: vw, h: vh };
}
/** does layout.c give box b an absolute position? absolutize() never enters an inline box, so a box under one (up to the nearest out-of-flow box, which layout_oof places) keeps 0, 0 */
function positionedByLayout(b) { if (b.oof) { return true; } for (let a = b.parent; a; a = a.parent) { if (a.kind === 'inline') { return false; } if (a.oof) { return true; } } return true; }
/** can box b be laid out on its own? own = its own style (or a layout attribute) changed in a way layout reads */
function qualifies(b, own, lay) {
	if (!b || !b.el || b.anon || b.pseudo || b === lay.rootBox || !b.parent || !b.v) { return false; }
	if (!positionedByLayout(b)) { return false; }
	if (b.pos === 'static' && !hasTransform(b.v)) { return false; }
	if (b.oof) {
		if (b.kind === 'inline' || b.kind === 'text' || b.kind === 'br') { return false; }
		if (own) {   // its style changed: the new one must keep it out of flow, with explicit insets (b.v is the old style)
			const v = b.el.__cs && b.el.__cs.values; if (!v || (v.position !== 'absolute' && v.position !== 'fixed') || v.display === 'none') { return false; }
			if ((v.left === 'auto' && v.right === 'auto') || (v.top === 'auto' && v.bottom === 'auto')) { return false; }
		}
		return true;
	}
	if (own || (b.kind !== 'block' && b.kind !== 'flex') || b.replaced) { return false; }
	if (visible(b.v) && b.display !== 'flex' && b.display !== 'flow-root') { return false; }
	if (typeof b.v.width !== 'number') { return false; }   // an auto or percentage width: its content can reach a shrink-to-fit ancestor's width (min/max-content) without changing its own size here
	if (inFlexParent(b) || (b.parent.kind !== 'block' && b.parent.kind !== 'inline-block')) { return false; }
	return true;
}
/** the computed values of the stand-in root: a positioned block of the containing block's size, without margins, padding, borders or overflow */
function standInValues(base, w, h) {
	const v = anonStyle(base);
	Object.assign(v, { display: 'block', position: 'relative', 'box-sizing': 'content-box', width: w, height: h, 'min-width': 0, 'min-height': 0, 'max-width': 'none', 'max-height': 'none', top: 'auto', left: 'auto', right: 'auto', bottom: 'auto', 'overflow-x': 'visible', 'overflow-y': 'visible', transform: 'none', float: 'none' });
	return v;
}
/** lays out root box R's element alone; returns { box, tmp } with the new subtree at its final position, or null */
function layoutRoot(doc, env, lay, R, own) {
	const tmp = new Layout(doc, env); tmp.fragsByText = new Map(); tmp.vw = env.vw; tmp.vh = env.vh;
	const nb = tmp.build(R.el, R.parent); if (!nb) { return why('no box'); }
	if (nb.oof !== R.oof) { return why('in/out of flow changed'); }
	let cb;   // from the new box: its position may have changed (absolute <-> fixed)
	if (nb.oof) { cb = containingBlock(nb, env.vw, env.vh); if (!cb) { return why('inline containing block'); } }
	else { const p = R.parent; cb = { x: 0, y: 0, w: p.w - p.hx, h: p.h - p.vy }; }   // in flow: the parent's content box (the position is kept)
	const fake = new Box(null, null, 'block'); fake.v = standInValues(R.parent.v, cb.w, cb.h); fake.display = 'block'; fake.children = [nb];
	const realParent = nb.parent; nb.parent = fake;
	env.layoutEngine.run(tmp, fake, cb.w, cb.h);
	nb.parent = realParent;
	let nx, ny;
	if (nb.oof) { const v = nb.v; nx = v.left !== 'auto' || v.right !== 'auto' ? cb.x + nb.ax : R.ax; ny = v.top !== 'auto' || v.bottom !== 'auto' ? cb.y + nb.ay : R.ay; }
	else { if (nb.w !== R.w || nb.h !== R.h) { return why('in-flow size changed'); } nx = R.ax; ny = R.ay; }
	const n = translate(nb, nx - nb.ax, ny - nb.ay); if (!n) { return false; }
	return { box: nb, tmp, n };
}
/**
 * A container of positioned boxes: a block whose children are all absolutely positioned (before and after the pass), with no text and no ::before/::after. Nothing in it is in
 * flow, so its size does not depend on its children and a child's static position is the container's content-box corner: a child that is new or whose own style changed is laid
 * out alone, the others keep their boxes (Monaco's lines, overlays, line numbers and cursors are such containers, and it replaces a line's element on every change).
 */
function qualifiesContainer(P, own, lay) {
	if (!P || !P.el || P.anon || P.pseudo || P === lay.rootBox || P.kind !== 'block' || P.display === 'flex' || P.replaced || own.has(P.el) || P.el.__before || P.el.__after || !P.v || !positionedByLayout(P)) { return false; }
	if (typeof P.v['padding-left'] !== 'number' || typeof P.v['padding-top'] !== 'number') { return false; }
	for (const c of P.children) { if (!c.oof) { return false; } }
	for (const c of P.el.__children) {
		if (c.nodeType === 3) { if (c.__data !== '') { return false; } continue; }
		if (c.nodeType !== 1) { continue; } const v = c.__cs && c.__cs.values; if (!v) { return false; }
		if (v.display !== 'none' && v.position !== 'absolute' && v.position !== 'fixed') { return false; }
	}
	return true;
}
/** lays out child element C of container P alone; { box, tmp, n }, { box: null } for display: none, or null */
function layoutChild(doc, env, lay, C, P) {
	const tmp = new Layout(doc, env); tmp.fragsByText = new Map(); tmp.vw = env.vw; tmp.vh = env.vh;
	const nb = tmp.build(C, P); if (!nb) { return { box: null }; }
	const cb = containingBlock(nb, env.vw, env.vh); if (!cb) { return why('inline containing block'); }
	const fake = new Box(null, null, 'block'); fake.v = standInValues(P.v, cb.w, cb.h); fake.display = 'block'; fake.children = [nb]; nb.parent = fake;
	env.layoutEngine.run(tmp, fake, cb.w, cb.h); nb.parent = P;
	const v = nb.v; const sx = P.ax + P.bl + P.v['padding-left'], sy = P.ay + P.bt + P.v['padding-top'];   // the static position: the container's content-box corner (the stand-in's is 0, 0)
	const nx = (v.left !== 'auto' || v.right !== 'auto' ? cb.x : sx) + nb.ax, ny = (v.top !== 'auto' || v.bottom !== 'auto' ? cb.y : sy) + nb.ay;
	const res = translate(nb, nx - nb.ax, ny - nb.ay); if (!res) { return false; }
	return { box: nb, tmp, n: res };
}
/**
 * moves a freshly laid out subtree by dx, dy; the number of boxes, or false when it holds a fixed box (whose containing block is the viewport).
 * Only what layout.c gave an absolute position moves: absolutize() positions a box and its frags, then recurses into children that are neither inline, text nor out
 * of flow; layout_oof() positions every out-of-flow box (and recurses the same way). So boxes under an inline box keep the coordinates of their own layout.
 */
function translate(nb, dx, dy) {
	let n = 0, fixed = false, loose = false;
	const move = (b, positioned, cbInline) => {
		n++; if (b !== nb && b.pos === 'fixed') { fixed = true; }
		if (b !== nb && b.oof && cbInline) { loose = true; }   // its containing block is an inline box: layout.c places it from that box's first line rectangle, or from page coordinates when it has none
		const own = positioned && b.kind !== 'text' && (b.kind !== 'inline' || b.oof);   // an out-of-flow inline box is positioned by layout_oof
		if (!positioned && b.kind !== 'text' && b.kind !== 'inline') { loose = true; }   // a block under an inline box: never positioned, its coordinates are not relative to anything, and layout.c's scroll extents use them as they are
		if (own) { b.ax += dx; b.ay += dy; if (b.frags) { for (const f of b.frags) { f.ax += dx; f.ay += dy; f.abaseline += dy; } } }
		if (b.__rects) { for (const r of b.__rects.rects) { if (r.ax !== undefined) { r.ax += dx; r.ay += dy; } } }   // set (hasA) only where the owning block was positioned
		const cbi = b.pos !== 'static' || (b.v && hasTransform(b.v)) ? b.kind === 'inline' : cbInline;
		for (const c of b.children) { move(c, c.oof || (own && c.kind !== 'inline' && c.kind !== 'text'), cbi); }
	};
	move(nb, true, false);
	return fixed ? why('fixed descendant') : loose ? why('block inside an inline box') : n;
}
/** layout.c compute_scroll for one box, with the stored extents of its children (recomputing them would give the same numbers) */
function rescroll(b) {
	const px = b.ax + b.bl, py = b.ay + b.bt; let right = 0, bottom = 0;
	const gather = (c) => {
		if (c.kind === 'text') { return; }
		if (c.kind === 'inline') { if (c.__rects) { for (const r of c.__rects.rects) { if (r.ax !== undefined) { right = Math.max(right, (r.ax - px) + r.w); bottom = Math.max(bottom, (r.ay - py) + r.h); } } } for (const k of c.children) { gather(k); } return; }
		right = Math.max(right, (c.ax - px + 0) + c.w); bottom = Math.max(bottom, (c.ay - py + 0) + c.h);
		if (c.v && visible(c.v)) { right = Math.max(right, (c.ax - px + 0) + c.scrollW); bottom = Math.max(bottom, (c.ay - py + 0) + c.scrollH); }
	};
	for (const c of b.children) { gather(c); }
	if (b.frags) { for (const f of b.frags) { right = Math.max(right, (f.ax - px) + f.w); bottom = Math.max(bottom, (f.ay - py) + (f.asc + f.desc)); } }
	const cw = b.w - b.bl - b.br, ch = b.h - b.bt - b.bb; b.scrollW = Math.max(cw, right); b.scrollH = Math.max(ch, bottom);
}

/**
 * Tries an incremental pass over the previous layout `lay` for the mutation log `log`. stylesResolved: resolveStyles already ran for this log (Layout.styleOnly returned null).
 * Returns true when `lay` is now up to date; false when a full layout is needed (styles are resolved by then: doc.__stylesResolved is set for the caller).
 */
export function incrementalLayout(doc, env, lay, log, stylesResolved) {
	if (!env.layoutEngine || globalThis.__noIncLayout98 || !lay.rootBox || lay.vw !== env.vw || lay.vh !== env.vh || doc.__logOverflow || !log || !log.length || doc.__hasAnchors) { return false; }
	if (!stylesResolved) { resolveStyles(doc, env, log); doc.__stylesResolved = true; }
	const r = doc.__styleResult; const info = doc.__styleInfo;
	if (!r || (info && info.mode === 'full')) { incStats.fallbacks++; return why('full restyle'); }
	// the changes: inside(el) = el's children or text changed; own(el) = el's own layout changed
	const own = new Set(r.layoutEls), points = new Map();   // element -> own?
	if (globalThis.__verifyIncLayout98) { own0 = own; }
	const add = (el, isOwn) => { if (!el || el.nodeType !== 1 || !el.isConnected) { return true; } if (el === doc.documentElement || el === doc.body) { return false; } if (isOwn || !points.has(el)) { points.set(el, isOwn || points.get(el) || false); } return true; };
	for (const e of log) {
		const what = e[1], node = e[2];
		if (what === 'ins' || what === 'rem') { if (node.nodeType === 9) { incStats.fallbacks++; return why('document child'); } if (!add(node, false)) { incStats.fallbacks++; return why('root element'); } }
		else if (what === 'text') { if (node.parentNode && !add(node.parentNode, false)) { incStats.fallbacks++; return why('root element'); } }
		else if (what === 'attr' && e[0] === 'layout' && !NO_LAYOUT_ATTR.has(e[3])) { if (!add(node, true)) { incStats.fallbacks++; return why('root element'); } }
	}
	for (const el of own) { if (!add(el, true)) { incStats.fallbacks++; return why('root element'); } }
	if (!points.size) { // only paint-only restyles that styleOnly did not take (it refuses logs with insertions or text): patch them
		patchStyles(doc, lay, r.changed, null); finish(doc, lay, log, 0, 0); return true;
	}
	// the nearest qualifying root of each change
	const cq = new Map(); const isContainer = (b) => { if (!b) { return false; } let q = cq.get(b); if (q === undefined) { q = qualifiesContainer(b, own, lay); cq.set(b, q); } return q; };
	const containers = new Set();
	const rootOf = (el, isOwn) => {
		for (let a = el; a && a.nodeType === 1; a = a.parentNode) {
			const b = lay.boxOf.get(a); const aOwn = a === el ? isOwn || own.has(a) : own.has(a);
			if (a === el && !isOwn && isContainer(b)) { containers.add(b); return true; }   // children added or removed: the container's other children stay
			if ((!b || aOwn) && a.parentNode && isContainer(lay.boxOf.get(a.parentNode))) { containers.add(lay.boxOf.get(a.parentNode)); return true; }   // a new or changed child of a container: laid out alone
			if (!b) { continue; }
			if (qualifies(b, aOwn, lay)) { return b; }
		}
		return null;
	};
	let roots = new Set();
	for (const [el, isOwn] of points) { const b = rootOf(el, isOwn); if (!b) { incStats.fallbacks++; return why('no root'); } if (b !== true) { roots.add(b); } }
	const dedupe = (set) => { const out = new Set(); for (const b of set) { let inner = false; for (let a = b.parent; a; a = a.parent) { if (set.has(a)) { inner = true; break; } } if (!inner) { out.add(b); } } return out; };
	roots = dedupe(roots);
	// lay out each root alone; a root that fails gives way to the next qualifying one above it
	const done = new Map();
	for (let guard = 0; guard < 64; guard++) {
		let failed = null;
		for (const R of roots) { if (done.has(R)) { continue; } const res = layoutRoot(doc, env, lay, R, own.has(R.el)); if (!res) { failed = R; break; } done.set(R, res); }
		if (!failed) { break; }
		let up = null; for (let a = failed.parent; a && !up; a = a.parent) { if (a.el && lay.boxOf.get(a.el) === a && qualifies(a, own.has(a.el), lay)) { up = a; } }
		if (!up) { incStats.fallbacks++; return why('no root after a failure'); }
		roots.delete(failed); roots.add(up); roots = dedupe(roots); for (const k of [...done.keys()]) { if (!roots.has(k)) { done.delete(k); } }
	}
	if (done.size !== roots.size) { incStats.fallbacks++; return why('too many retries'); }
	// containers: which children are laid out again (new ones and those whose own style changed); a container inside a root is the root's business
	const plans = new Map(), gone = new Set();   // gone: old child boxes of containers that are replaced or dropped (display: none, removed): nothing under them may be grafted
	const under = (b, set) => { for (let a = b; a; a = a.parent) { if (set.has(a)) { return true; } } return false; };
	for (const P of containers) {
		if (under(P, roots)) { continue; }
		const kids = [];
		for (const C of P.el.__children) {
			if (C.nodeType !== 1) { continue; } const old = lay.boxOf.get(C);
			if (old && old.parent === P && !own.has(C)) { kids.push({ box: old }); continue; }
			const res = layoutChild(doc, env, lay, C, P); if (!res) { incStats.fallbacks++; return why('container child'); } if (res.box) { kids.push(res); }
		}
		const keep = new Set(kids.map(k => k.box)); for (const c of P.children) { if (!keep.has(c)) { gone.add(c); } }
		plans.set(P, kids);
	}
	const inGone = (b) => { for (let a = b; a; a = a.parent) { if (gone.has(a)) { return true; } } return false; };
	for (const P of [...plans.keys()]) { if (inGone(P)) { plans.delete(P); } }
	for (const R of [...done.keys()]) { if (inGone(R)) { done.delete(R); } }
	// graft: the old subtrees leave the maps, the new ones enter them
	let boxes = 0; const retired = (lay.__retired98 ??= []);
	const unmap = (R) => { const stack = [R]; while (stack.length) { const b = stack.pop(); if (b.el) { if (b.kind === 'text') { lay.fragsByText.delete(b.el); } else if (lay.boxOf.get(b.el) === b) { lay.boxOf.delete(b.el); } } for (const c of b.children) { stack.push(c); } } };
	for (const [R] of done) { damageBox(doc, R); unmap(R); }   // damage: where the old subtree was painted (damage.js)
	for (const [P, kids] of plans) { const keep = new Set(kids.map(k => k.box)); for (const c of P.children) { if (!keep.has(c)) { damageBox(doc, c); unmap(c); retired.push(c); } } }
	for (const [P, kids] of plans) {
		for (const k of kids) { if (k.tmp) { for (const [el, b] of k.tmp.boxOf) { lay.boxOf.set(el, b); } for (const [t, f] of k.tmp.fragsByText) { lay.fragsByText.set(t, f); } boxes += k.n; } k.box.parent = P; }
		P.children = kids.map(k => k.box);
	}
	for (const [R, res] of done) {
		for (const [el, b] of res.tmp.boxOf) { lay.boxOf.set(el, b); } for (const [t, f] of res.tmp.fragsByText) { lay.fragsByText.set(t, f); }
		const sib = R.parent.children; const i = sib.indexOf(R); sib[i] = res.box; res.box.parent = R.parent; retired.push(R); boxes += res.n;
	}
	patchStyles(doc, lay, r.changed, done);
	// the scroll extents up the chain (layout.c computes none for inline boxes: they keep 0, and the walk goes on through them)
	const upward = (from) => { for (let a = from; a; a = a.parent) { if (a.kind === 'inline' || a.kind === 'text') { continue; } const w = a.scrollW, h = a.scrollH; rescroll(a); if (a.scrollW === w && a.scrollH === h) { break; } } };
	for (const P of plans.keys()) { upward(P); invalidateInk(P); }
	for (const [, res] of done) { upward(res.box.parent); invalidateInk(res.box.parent); }
	for (const [, res] of done) { doc.__applyTransforms({ rootBox: res.box }); damageBox(doc, res.box); } for (const kids of plans.values()) { for (const k of kids) { if (k.tmp) { doc.__applyTransforms({ rootBox: k.box }); damageBox(doc, k.box); } } }   // and where the new one is   // transforms of the new boxes only (the walk takes any root)
	{ const nm = (b) => b.el.localName + '.' + String(b.el.className).split(' ').slice(0, 2).join('.'); lay.__lastDesc98 = globalThis.__verifyIncLayout98 ? `roots ${[...done].map(([R, res]) => nm(R) + '(' + R.pos + (own.has(R.el) ? ',own' : '') + ',new ' + res.box.ax + ',' + res.box.w + ') ' + res.n).join(', ')}; points ${[...points].map(([el, o]) => (o ? 'own ' : 'in ') + el.localName + '.' + el.className).join(', ')}; containers ${[...plans].map(([P, k]) => nm(P) + ' ' + k.filter(x => x.tmp).length + '/' + k.length).join(', ')}` : ''; }
	if (globalThis.__incDebug98) { const nm = (b) => b.el.localName + '.' + String(b.el.className).split(' ').slice(0, 2).join('.'); globalThis.__incDebug98(`roots: ${[...done].map(([R, res]) => nm(R) + ' ' + res.n).join(', ')}; containers: ${[...plans].map(([P, k]) => nm(P) + ' ' + k.filter(x => x.tmp).length + '/' + k.length).join(', ')}; points: ${[...points].slice(0, 6).map(([el, o]) => (o ? 'own ' : 'in ') + el.localName + '.' + String(el.className).split(' ')[0]).join(', ')}`); }
	incStats.roots += done.size + plans.size; incStats.boxes += boxes; finish(doc, lay, log, done.size + plans.size, boxes);
	if (globalThis.__verifyIncLayout98) { verify(doc, env, lay); }
	return true;
}
/** elements restyled in paint-only ways outside the new subtrees: their boxes take the new style (as Layout.styleOnly does) */
function patchStyles(doc, lay, changed, done) {
	for (const el of changed) {
		const box = lay.boxOf.get(el); if (!box || box.cs === el.__cs) { continue; }
		const same = deepEqual(box.v, el.__cs.values); box.cs = el.__cs; box.v = el.__cs.values; if (!same) { damageBox(doc, box); }   // restyled to the same values (Monaco rewrites every line's style): nothing to repaint
		for (const c of box.children) {
			if (c.kind === 'text') { if (c.pseudo === undefined) { lay.patchText(c, box); } }
			else if (c.anon) { c.v = anonStyle(box.v); for (const t of c.children) { if (t.kind === 'text') { lay.patchText(t, c); } } }
		}
	}
}
function finish(doc, lay, log, roots, boxes) {
	incStats.passes++; lay.dirtyLog = log; lay.styleInfo = doc.__styleInfo; lay.incremental = { roots, boxes };
	// the subtrees replaced by the pass before this one are taken apart now (as env.js does for whole layouts, one pass later)
	if (lay.__retiredPrev98) { for (const b of lay.__retiredPrev98) { disposeSubtree(b); } } lay.__retiredPrev98 = lay.__retired98 || null; lay.__retired98 = null;
}

// ---- oracle: the incremental result against a full layout of the same document
const FIELDS = ['kind', 'ax', 'ay', 'w', 'h', 'bl', 'bt', 'br', 'bb', 'scrollW', 'scrollH', 'relDx', 'relDy', 'pos'];
const near = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6);
let own0 = null;
function verify(doc, env, lay) {
	const st = globalThis.__verifyIncLayout98; st.checked = (st.checked || 0) + 1; st.first ??= [];
	const full = new Layout(doc, env); full.skipStyle = true; full.run(); doc.__applyTransforms(full);
	const bad = [];
	const name = (b) => b.el ? (b.el.nodeType === 1 ? b.el.localName + '.' + String(b.el.className).split(' ')[0] : '#text') : (b.anon ? 'anon' : b.pseudo ? '::' + b.pseudo : 'box');
	const cmp = (a, b, path) => {
		if (bad.length > 4) { return; }
		if (a.el !== b.el) { bad.push(`${path}: element ${name(a)} vs ${name(b)}`); return; }
		for (const k of FIELDS) { if (!near(a[k], b[k])) { const kids = (x) => x.children.map(c => `${name(c)}[${c.kind} ax${c.ax} w${c.w} sw${c.scrollW} ov${c.v ? c.v['overflow-x'] : '?'} pos${c.pos}]`).join(' ').slice(0, 600); bad.push(`${path}/${name(a)}: ${k} ${a[k]} (incremental) vs ${b[k]} (full); children: ${kids(a)} || full: ${kids(b)}`); return; } }
		const fa = a.frags || [], fb = b.frags || []; if (fa.length !== fb.length) { bad.push(`${path}/${name(a)}: ${fa.length} vs ${fb.length} text fragments`); return; }
		for (let i = 0; i < fa.length; i++) { const x = fa[i], y = fb[i]; if (x.text !== y.text || !near(x.ax, y.ax) || !near(x.ay, y.ay) || !near(x.w, y.w) || !near(x.abaseline, y.abaseline)) { bad.push(`${path}/${name(a)}: fragment ${i} "${x.text}" ${x.ax},${x.ay} w${x.w} b${x.abaseline} vs "${y.text}" ${y.ax},${y.ay} w${y.w} b${y.abaseline}; owner ${a.kind} ${a.ax},${a.ay} parent ${a.parent && a.parent.kind}/${a.parent && a.parent.pos}`); return; } }
		const ra = a.__rects ? a.__rects.rects : [], rb = b.__rects ? b.__rects.rects : []; if (ra.length !== rb.length) { bad.push(`${path}/${name(a)}: ${ra.length} vs ${rb.length} inline rects`); return; }
		for (let i = 0; i < ra.length; i++) { if (!near(ra[i].ax, rb[i].ax) || !near(ra[i].ay, rb[i].ay) || !near(ra[i].w, rb[i].w) || !near(ra[i].h, rb[i].h)) { bad.push(`${path}/${name(a)}: inline rect ${i}`); return; } }
		if (!!a.matrix !== !!b.matrix) { bad.push(`${path}/${name(a)}: transform`); return; }
		if (a.children.length !== b.children.length) { bad.push(`${path}/${name(a)}: ${a.children.length} vs ${b.children.length} children`); return; }
		for (let i = 0; i < a.children.length; i++) { cmp(a.children[i], b.children[i], path + '/' + name(a)); }
	};
	cmp(lay.rootBox, full.rootBox, '');
	if (lay.boxOf.size !== full.boxOf.size) { const extra = [...lay.boxOf.keys()].filter(e => !full.boxOf.has(e)).slice(0, 3).map(e => { const b = lay.boxOf.get(e); let chain = []; for (let a = b; a; a = a.parent) { chain.push(a.el ? (a.el.localName + '.' + String(a.el.className).split(' ')[0]) : '?'); } let hid = null; for (let a = e; a && a.nodeType === 1; a = a.parentNode) { if (a.__cs && a.__cs.values.display === 'none') { hid = a.localName + '.' + String(a.className).split(' ').slice(0, 2).join('.') + (own0 && own0.has(a) ? ' (own)' : ''); break; } } return `${name(b)} hidden by ${hid}`; }); bad.push(`boxOf ${lay.boxOf.size} vs ${full.boxOf.size}: extra ${extra.join('; ')} [last: ${lay.__lastDesc98}]`); }
	if (lay.fragsByText.size !== full.fragsByText.size) { bad.push(`fragsByText ${lay.fragsByText.size} vs ${full.fragsByText.size}`); }
	for (const [el, b] of lay.boxOf) { if (b.el !== el) { bad.push('boxOf entry of another element'); break; } let a = b; while (a.parent) { a = a.parent; } if (a !== lay.rootBox) { bad.push(`boxOf: detached box for ${name(b)}`); break; } }
	if (bad.length) { st.bad = (st.bad || 0) + 1; if (st.first.length < 8) { st.first.push(bad.join(" | ") + `  [${lay.__lastDesc98}]`); } }
	disposeLayout(full);
}
