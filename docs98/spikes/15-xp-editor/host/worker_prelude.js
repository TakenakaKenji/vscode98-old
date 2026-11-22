// What a web worker's global scope gives Monaco's language workers (vs/language/*/…worker.js), on a QuickJS os.Worker thread: self, postMessage/onmessage/addEventListener against
// os.Worker.parent, timers, and the few web globals the workers touch. Bundled in front of each worker by build_monaco.mjs; the page side is QjsWorker in editor98.mjs.
import * as os from 'qjs:os';
const parent = os.Worker.parent;
const g = globalThis;
g.self = g;
g.setTimeout ??= (f, ms, ...a) => os.setTimeout(() => f(...a), ms || 0);
g.clearTimeout ??= (h) => { if (h) { os.clearTimeout(h); } };
g.setInterval ??= (f, ms, ...a) => { const h = { t: 0 }; const tick = () => { h.t = os.setTimeout(tick, ms || 0); f(...a); }; h.t = os.setTimeout(tick, ms || 0); return h; };
g.clearInterval ??= (h) => { if (h && h.t) { os.clearTimeout(h.t); h.t = 0; } };
g.queueMicrotask ??= (f) => { Promise.resolve().then(f); };
g.performance ??= { now: () => Date.now() };
g.navigator ??= {};   // QuickJS-ng has a navigator of its own, with userAgent only
for (const [k, v] of Object.entries({ userAgent: 'Mozilla/5.0 (Windows NT 5.1) editor98', language: 'en', languages: ['en'], platform: 'Win32', hardwareConcurrency: 1 })) { if (g.navigator[k] === undefined) { try { Object.defineProperty(g.navigator, k, { value: v, configurable: true }); } catch { } } }
g.location ??= { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', pathname: '/', search: '', hash: '' };
g.console ??= { log() { }, warn() { }, error() { }, info() { }, debug() { } };
const listeners = [];
g.addEventListener = (type, f) => { if (type === 'message') { listeners.push(f); } };
g.removeEventListener = (type, f) => { const i = listeners.indexOf(f); if (i >= 0) { listeners.splice(i, 1); } };
g.postMessage = (data) => parent.postMessage(data);
g.close = () => { parent.onmessage = null; };
parent.onmessage = (e) => {
	if (e.data && e.data.__qjsTerminate) { parent.onmessage = null; return; }
	const ev = { data: e.data, type: 'message' };
	if (typeof g.onmessage === 'function') { g.onmessage(ev); }
	for (const f of listeners.slice()) { f(ev); }
};
