// Damage: the parts of the window that changed since the last paint, so the window repaints only those (paint.js paintDocument({ damage })) instead of
// every pixel and every box for each key. doc.__damage98 is null (nothing recorded), FULL, or a list of [x0, y0, x1, y1] in window pixels.
// Recorded by: full layout passes (FULL), incremental passes (the old and new extent of each subtree laid out again), style-only passes and paint-only
// restyles (the restyled boxes), text controls (their box), scrolling (the scrolled box), and anything else that bumps doc.__paintGen without saying where (FULL).
// The window host takes and clears it before each paint. Oracle: globalThis.__verifyDamage98 compares each partial frame with a full paint.
export const FULL = 'full';
const MAX_RECTS = 48;

export function damageFull(doc) { if (doc) { doc.__damage98 = FULL; if (globalThis.__damageWhy98) { globalThis.__damageWhy98(new Error().stack.split('\n').slice(2, 4).map(x => x.trim()).join(' < ')); } } }
export function damageRect(doc, x0, y0, x1, y1) {
	const d = doc.__damage98; if (d === FULL) { return; }
	if (!(x1 > x0 && y1 > y0)) { return; }
	const list = d || (doc.__damage98 = []); if (list.length >= MAX_RECTS) { const m = merge(list); list.length = 0; list.push(...m); }
	list.push([Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1) + 2, Math.ceil(y1) + 2]);   // 2 px for glyph overhang, carets and rounding
}
/**
 * where box b and everything under it is painted: the union of its boxes, text fragments and inline rectangles, each at the offset paint.js paints it at;
 * FULL when that cannot be worked out (a scaled or rotated box on the way)
 */
export function damageBox(doc, b) {
	if (!b || doc.__damage98 === FULL) { return; }
	const memo = new Map(); let unknown = false;
	// paint.js: a box's own translation moves it and everything under it; an element's scroll offset moves its in-flow descendants and the out-of-flow ones whose
	// containing block is it or inside it (paintItem applies the scroll of the ancestors whose clip applies); a fixed box is painted against the viewport
	const tr = (a) => { const m = a.matrix; if (!m || m.id) { return [0, 0]; } if (m[0] !== 1 || m[3] !== 1 || m[1] || m[2]) { unknown = true; return [0, 0]; } return [m[4], m[5]]; };
	const offset = (a) => {   // where a itself is painted, relative to its layout position
		let o = memo.get(a); if (o) { return o; }
		let base = [0, 0];
		if (a.pos === 'fixed') { base = [0, 0]; }
		else if (a.oof) { let p = a.parent; while (p && !(p.pos !== 'static' || p.matrix)) { p = p.parent; } base = p ? content(p) : [0, 0]; }
		else if (a.parent) { base = content(a.parent); }
		const t = tr(a); o = [base[0] + t[0], base[1] + t[1]]; memo.set(a, o); return o;
	};
	const content = (a) => { const o = offset(a); const sx = a.el ? a.el.__scrollLeft || 0 : 0, sy = a.el ? a.el.__scrollTop || 0 : 0; return [o[0] - sx, o[1] - sy]; };
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	const add = (x, y, w, h) => { if (!(w > 0 && h > 0)) { return; } if (x < x0) { x0 = x; } if (y < y0) { y0 = y; } if (x + w > x1) { x1 = x + w; } if (y + h > y1) { y1 = y + h; } };
	const stack = [b];
	while (stack.length) {
		const c = stack.pop(); const o = c.kind === 'text' ? [0, 0] : offset(c); const dx = o[0], dy = o[1];
		if (c.kind !== 'text' && c.kind !== 'inline') { add(c.ax + dx, c.ay + dy, c.w, c.h); if (c.v && c.v.display === 'list-item') { add(c.ax + dx - 48, c.ay + dy, 48, c.h); } }
		if (c.frags && c.frags.length) { const q = content(c); for (const f of c.frags) { add(f.ax + q[0], f.ay + q[1], f.w + 2, (f.asc + f.desc) || 1); } }   // paintInline draws the owner's text with its content offset (scroll applied)
		if (c.__rects) { let blk = c.parent; while (blk && blk.kind === 'inline') { blk = blk.parent; } const q = blk ? content(blk) : [0, 0]; for (const r of c.__rects.rects) { if (r.ax !== undefined) { add(r.ax + q[0], r.ay + q[1], r.w, r.h); } } }   // inline boxes: drawn by their block container
		for (const k of c.children) { stack.push(k); }
	}
	if (unknown) { doc.__damage98 = FULL; globalThis.__damageWhy98?.('scaled box'); return; }
	if (x1 > x0) { damageRect(doc, x0, y0, x1, y1); }
}
/** the paint bounds cached on boxes (paint.js inkOf) of b and its ancestors are stale: b's subtree changed or moved */
export function invalidateInk(b) { for (let a = b; a; a = a.parent) { if (!a.__ink) { break; } a.__ink = null; } }
/** an element's own box changed how it paints (a text control's value or caret, a checkbox): its box and what is under it */
export function damageEl(el) { const d = el && el.ownerDocument; if (!d) { return; } const box = d.__layout && d.__layout.boxOf.get(el); if (box) { damageBox(d, box); } else { damageFull(d); } }
/** the damage since the last call, merged into a few rectangles clipped to the window; null = nothing, FULL = everything */
export function takeDamage(doc, w, h) {
	const d = doc.__damage98; doc.__damage98 = null; if (!d || d === FULL) { return d || null; }
	const rects = merge(d.map(r => [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(w, r[2]), Math.min(h, r[3])]).filter(r => r[2] > r[0] && r[3] > r[1]));
	const total = rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0); if (total > w * h * 0.6) { globalThis.__damageWhy98?.('large area ' + JSON.stringify(rects)); return FULL; }
	return rects;
}
/** overlapping or nearby rectangles merged (any two whose union costs little more than the pair); more than 6 left become their union */
function merge(rects) {
	rects = rects.slice();
	for (let changed = true; changed;) {
		changed = false;
		for (let i = 0; i < rects.length && !changed; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				const a = rects[i], b = rects[j]; const u = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
				const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
				if (area(u) <= (area(a) + area(b)) * 1.3 + 2000) { rects[i] = u; rects.splice(j, 1); changed = true; break; }
			}
		}
	}
	if (rects.length > 6) { const u = rects.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]); rects = [u]; }
	return rects;
}
