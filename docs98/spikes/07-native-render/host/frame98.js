// One window's frames: a full paint when needed (first frame, size change, zoom, a full layout, damage it cannot place), otherwise only the damaged
// rectangles (06-rendering/host/dom/damage.js) over the previous frame's pixels, which the backend keeps. Used by the window host (11-windows-host/host/window_host98.mjs)
// and the headless tests. Oracle: globalThis.__verifyDamage98 = { frames, partial, bad, first: [] } paints every partial frame in full as well and compares the pixels.
import { NativeBackend } from './native_backend.js';
import { paintDocument } from '../../06-rendering/host/dom/paint.js';
import { takeDamage, FULL } from '../../06-rendering/host/dom/damage.js';

export class FramePainter {
	constructor({ exact = false } = {}) { this.exact = exact; this.backend = null; this.gen = -1; this.stats = { full: 0, partial: 0, skipped: 0, pixels: 0 }; }
	/** paints doc into a W x H frame; returns { px, rect: [x, y, w, h] to present, or null when nothing changed } */
	paint(doc, W, H, { full = false, paintWith = null } = {}) {
		doc.__ensureLayout();
		let d = takeDamage(doc, W, H); if (globalThis.__noDamage98 && d !== null) { d = FULL; } this.last = d; const gen = doc.__paintGen | 0; const genMoved = gen !== this.gen; this.gen = gen;
		const b = this.backend;
		if (full || paintWith || !b || b.w !== W || b.h !== H || d === FULL || (d === null && genMoved)) {
			const why = full ? 'asked' : paintWith ? 'zoom' : !b || b.w !== W || b.h !== H ? 'size' : d === FULL ? 'damage' : 'paint state without damage'; this.stats[why] = (this.stats[why] || 0) + 1;
			if (!b || b.w !== W || b.h !== H) { this.backend = new NativeBackend(W, H, { exact: this.exact }); } else { b.reset(); }
			const r = paintWith ? paintWith(this.backend) : paintDocument(doc, W, H, this.backend); this.stats.full++; this.stats.pixels += W * H;
			return { px: r.px, rect: [0, 0, W, H], full: true };
		}
		if (d === null || d.length === 0) { this.stats.skipped++; return { px: b.pixels, rect: null, full: false }; }
		b.resetCommands(); const r = paintDocument(doc, W, H, b, { damage: d }); this.stats.partial++;
		let x0 = W, y0 = H, x1 = 0, y1 = 0; for (const q of d) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[2]); y1 = Math.max(y1, q[3]); this.stats.pixels += (q[2] - q[0]) * (q[3] - q[1]); }
		const v = globalThis.__verifyDamage98; if (v) { this.verify(doc, W, H, r.px, d, v); }
		return { px: r.px, rect: [x0, y0, x1 - x0, y1 - y0], full: false };
	}
	verify(doc, W, H, px, d, v) {
		v.partial = (v.partial || 0) + 1; v.first ??= [];
		const ref = (this.vb && this.vb.w === W && this.vb.h === H) ? this.vb : (this.vb = new NativeBackend(W, H, { exact: this.exact })); ref.reset();
		const full = paintDocument(doc, W, H, ref).px; let n = 0, fx = -1, fy = -1;
		for (let i = 0; i < full.length; i += 4) { if (full[i] !== px[i] || full[i + 1] !== px[i + 1] || full[i + 2] !== px[i + 2]) { if (n === 0) { fx = (i / 4) % W; fy = Math.floor(i / 4 / W); } n++; } }
		if (n) { v.bad = (v.bad || 0) + 1; if (v.first.length < 6) { v.first.push(`${n} pixels differ, first at ${fx},${fy}; damage ${JSON.stringify(d)}`); } px.set(full); }   // the frame shown is the right one either way
	}
}
