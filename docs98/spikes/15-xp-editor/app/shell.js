// The editor's shell around Monaco: explorer (lazy file tree), tabs (one Monaco model per file, view state kept per tab), status bar, quick open (Ctrl+P), saving and the keys of
// a code editor. Runs in the page (globalThis is the window of our DOM); everything outside the page comes from `host` (editor98.mjs): files, the window title, the dialogs of Windows
// (host.confirm -> 'save' | 'discard' | 'cancel'; host.pickFolder / openFileDialog / saveFileDialog -> a path or null; all synchronous: the dialogs are modal).

const ICON = { newFile: String.fromCharCode(60031), refresh: String.fromCharCode(60215), collapseAll: String.fromCharCode(60101), folderOpened: String.fromCharCode(60151), chevronRight: String.fromCharCode(60086), chevronDown: String.fromCharCode(60084), close: String.fromCharCode(60022), dot: String.fromCharCode(60017), file: String.fromCharCode(60027) };
const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg']);

/** builds an element: el('div', { class: 'x', onclick }, child, 'text', ...) */
function el(tag, props, ...kids) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(props || {})) {
		if (k.startsWith('on')) { e.addEventListener(k.slice(2), v); } else if (k === 'class') { e.className = v; } else { e.setAttribute(k, v); }
	}
	for (const k of kids) { if (k !== null && k !== undefined) { e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); } }
	return e;
}

/** languages by file extension, from what Monaco registered (Monarch tokenizers and language services) */
function languageIndex(monaco) {
	const byExt = new Map(), byName = new Map();
	for (const l of monaco.languages.getLanguages()) {
		for (const x of l.extensions || []) { byExt.set(x.toLowerCase(), l.id); }
		for (const f of l.filenames || []) { byName.set(f.toLowerCase(), l.id); }
	}
	if (monaco.languages.getLanguages().some(l => l.id === 'luau')) { byExt.set('.lua', 'luau'); byExt.set('.luau', 'luau'); } else { byExt.set('.luau', byExt.get('.lua') || 'lua'); }
	return (name) => { const n = name.toLowerCase(); if (byName.has(n)) { return byName.get(n); } const i = n.lastIndexOf('.'); return i >= 0 && byExt.get(n.slice(i)) || 'plaintext'; };
}

/** fuzzy match of a query against a path: the characters in order; returns a score (higher is better) and the matched positions, or null */
function fuzzy(query, text) {
	const q = query.toLowerCase(), t = text.toLowerCase(); const pos = []; let j = 0, score = 0, last = -2;
	for (let i = 0; i < q.length; i++) {
		const k = t.indexOf(q[i], j); if (k < 0) { return null; }
		score += k === last + 1 ? 5 : 1; if (k === 0 || '/\\._- '.includes(t[k - 1])) { score += 3; }
		pos.push(k); last = k; j = k + 1;
	}
	return { score: score - text.length * 0.01, pos };
}

export function startShell({ host, monaco }) {
	const path = host.path; const languageOf = languageIndex(monaco);
	const state = { root: host.workspace, tabs: [], active: null, expanded: new Set([host.workspace]), selected: null, sidebar: true };

	// ---- layout
	const tree = el('div', { class: 'tree' }); const rows = el('div', { class: 'tree-rows' }); tree.appendChild(rows);
	const button = (icon, title, fn) => el('span', { class: 'ci act', title, onmousedown: (ev) => { ev.preventDefault(); ev.stopPropagation(); if (ev.button === 0) { fn(); } } }, icon);
	const rootName = el('span', { class: 'label' }, path.basename(state.root).toUpperCase());
	const explorerView = el('div', { class: 'view' }, el('div', { class: 'side-title' }, 'EXPLORER'),
		el('div', { class: 'root-name' }, rootName, el('span', { class: 'actions' }, button(ICON.newFile, 'New File (Ctrl+N)', () => newFile()), button(ICON.folderOpened, 'Open Folder (Ctrl+K Ctrl+O)', () => openFolder()), button(ICON.refresh, 'Refresh', () => refresh()), button(ICON.collapseAll, 'Collapse All', () => { state.expanded = new Set([state.root]); renderTree(); }))), tree);
	const searchInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'Search (Enter); /regex/' }); const searchInfo = el('div', { class: 'search-info' }); const searchResults = el('div', { class: 'search-results' });
	const searchView = el('div', { class: 'view hidden' }, el('div', { class: 'side-title' }, 'SEARCH'), el('div', { class: 'search-box' }, searchInput), searchInfo, searchResults);
	const sidebar = el('div', { id: 'sidebar' }, explorerView, searchView);
	const tabsRow = el('div', { class: 'tabs-row' }); const tabsBar = el('div', { id: 'tabs' }, tabsRow);
	const editorHost = el('div', { id: 'editor-host' });
	const welcome = el('div', { id: 'welcome' }, el('div', { class: 'big' }, 'editor98'), el('div', { class: 'keys' }, 'Ctrl+P  go to a file of the folder'), el('div', { class: 'keys' }, 'Ctrl+O  open a file'), el('div', { class: 'keys' }, 'Ctrl+K Ctrl+O  open a folder'), el('div', { class: 'keys' }, 'Ctrl+N  new file'), el('div', { class: 'keys' }, 'Ctrl+S  save'), el('div', { class: 'keys' }, 'Ctrl+W  close the tab'), el('div', { class: 'keys' }, 'Ctrl+Shift+F  search in the folder'), el('div', { class: 'keys' }, 'Ctrl+B  show or hide the explorer'), el('div', { class: 'keys' }, 'Shift+Alt+F  format the document'));
	editorHost.appendChild(welcome);
	const sPos = el('span', { class: 'item' }), sLang = el('span', { class: 'item' }), sIndent = el('span', { class: 'item' }), sEol = el('span', { class: 'item' }), sEnc = el('span', { class: 'item' }, 'UTF-8'), sMsg = el('span', { class: 'item' }), sProb = el('span', { class: 'item' });
	const statusbar = el('div', { id: 'statusbar' }, el('div', { class: 'sb-row' }, sProb, sMsg, el('span', { class: 'spacer' }), sPos, sIndent, sEnc, sEol, sLang));
	const quickInput = el('input', { type: 'text', spellcheck: 'false' }); const quickList = el('div', { class: 'list' });
	const quick = el('div', { id: 'quick' }, quickInput, quickList);
	const app = el('div', { id: 'app' }, el('div', { id: 'body' }, sidebar, el('div', { id: 'main' }, tabsBar, editorHost)), statusbar, quick);
	document.body.appendChild(app);

	// one Monaco editor per recently used tab (at most settings.editors, default 4), each in its own pane: switching tabs shows another pane instead of rendering the
	// other file's lines again (a switch was ~85 ms of restyle and layout on the sandbox, showing a kept editor ~20). The least recently used editor is recycled (setModel).
	const EDITOR_OPTS = {
		model: null, theme: 'editor98-dark', fontFamily: 'DejaVu Sans Mono', fontSize: host.settings.fontSize || 14, lineHeight: Math.round((host.settings.fontSize || 14) * 1.4),
		minimap: { enabled: false }, automaticLayout: false, editContext: false, smoothScrolling: false, cursorBlinking: 'solid', accessibilitySupport: 'off', fontLigatures: false,
		renderWhitespace: 'none', scrollBeyondLastLine: false, tabSize: host.settings.tabSize || 4, insertSpaces: host.settings.insertSpaces ?? false, stickyScroll: { enabled: false },
		defaultColorDecorators: 'never',   // the regex scan of every document for color values on each change (30 ms a key in a 17,000-line file on the sandbox); CSS keeps its own color provider
		...(host.settings.editor || {}),   // settings.json "editor": any Monaco editor option, as is
	};
	const MAX_EDITORS = Math.max(1, Number(host.settings.editors) || 4);
	const pool = []; let editor = null, useClock = 0;   // editor: the active tab's
	let hostW = -1, hostH = -1;   // the editor area's size, measured on resize and sidebar changes
	const sizeSlot = (sl) => { if (hostW < 0) { measureHost(); } if (sl.w !== hostW || sl.h !== hostH) { sl.w = hostW; sl.h = hostH; sl.ed.layout({ width: hostW, height: hostH }); } };   // Monaco lays out and renders everything again on layout(), even for the same size
	const measureHost = () => { const r = editorHost.getBoundingClientRect(); hostW = Math.max(0, Math.round(r.width)); hostH = Math.max(0, Math.round(r.height)); };
	const relayout = () => { measureHost(); const sl = state.active && state.active.slot; if (sl) { sizeSlot(sl); } };
	function makeEditor() {
		const pane = el('div', { class: 'ed-pane', style: 'display:none' }); editorHost.appendChild(pane);
		const ed = monaco.editor.create(pane, EDITOR_OPTS); setupEditor(ed);
		const sl = { ed, pane, tab: null, w: -1, h: -1, used: 0 }; pool.push(sl); return sl;
	}
	/** the editor showing tab t: its own, a free one, a new one (below the limit) or the least recently used other one, which then shows t */
	function slotFor(t) {
		if (t.slot) { return t.slot; }
		let sl = pool.find(x => !x.tab) || (pool.length < MAX_EDITORS ? makeEditor() : pool.filter(x => x.tab !== state.active).sort((a, b) => a.used - b.used)[0]);
		if (sl.tab) { sl.tab.view = sl.ed.saveViewState(); sl.tab.slot = null; }
		sl.tab = t; t.slot = sl; sl.ed.setModel(t.model); if (t.view) { sl.ed.restoreViewState(t.view); } return sl;
	}
	function releaseSlot(t) { const sl = t.slot; if (!sl) { return; } t.view = sl.ed.saveViewState(); sl.ed.setModel(null); sl.tab = null; t.slot = null; if (sl.pane.style.display !== 'none') { sl.pane.style.display = 'none'; } }
	window.addEventListener('resize', relayout);

	// ---- explorer
	const listDir = (dir) => {
		let names; try { names = host.readDir(dir); } catch (e) { return []; }
		const out = []; for (const n of names) { if (SKIP_DIRS.has(n)) { continue; } let isDir = false; try { isDir = host.isDir(path.join(dir, n)); } catch { continue; } out.push({ name: n, path: path.join(dir, n), isDir }); }
		return out.sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
	};
	const dirCache = new Map(); const children = (dir) => { if (!dirCache.has(dir)) { dirCache.set(dir, listDir(dir)); } return dirCache.get(dir); };
	// the tree and the tabs are rebuilt only when their rows change; a new active file or a changed dirty mark only sets classes (every DOM change is a layout pass)
	const treeRows = new Map();   // path -> row element
	const setClass = (e, c) => { if (e.className !== c) { e.className = c; } };
	const rowClass = (p) => { const tab = state.tabs.find(t => t.path === p); return 'row' + (p === state.selected ? ' selected' : '') + (state.active && p === state.active.path ? ' active' : '') + (tab && tab.dirty ? ' dirty' : ''); };
	function markTree() { for (const [p, row] of treeRows) { setClass(row, rowClass(p)); } }
	function renderTree() {
		rows.textContent = ''; treeRows.clear(); const activePath = state.active && state.active.path;
		const add = (dir, depth) => {
			for (const it of children(dir)) {
				const open = it.isDir && state.expanded.has(it.path); const tab = state.tabs.find(t => t.path === it.path);
				const row = el('div', { class: 'row' + (it.path === state.selected ? ' selected' : '') + (it.path === activePath ? ' active' : '') + (tab && tab.dirty ? ' dirty' : ''), style: `padding-left:${8 + depth * 12}px` },
					el('span', { class: 'ci' }, it.isDir ? (open ? ICON.chevronDown : ICON.chevronRight) : ''), el('span', { class: 'name' }, it.name));
				row.addEventListener('mousedown', (ev) => { if (ev.button !== 0) { return; } state.selected = it.path; if (it.isDir) { if (open) { state.expanded.delete(it.path); } else { state.expanded.add(it.path); } renderTree(); } else { openFile(it.path); } });
				rows.appendChild(row); treeRows.set(it.path, row);
				if (open) { add(it.path, depth + 1); }
			}
		};
		add(state.root, 0);
	}

	// ---- tabs and files
	const isDirty = (t) => t.model.getAlternativeVersionId() !== t.savedVersion;
	let tabEls = [];   // [{ t, name, el, close }] in order
	function renderTabs() {
		for (const t of state.tabs) { t.dirty = isDirty(t); }
		if (tabEls.length === state.tabs.length && tabEls.every((x, i) => x.t === state.tabs[i] && x.name === x.t.name)) {   // same tabs: classes and the close/dirty icon only
			for (const x of tabEls) { setClass(x.el, 'tab' + (x.t === state.active ? ' active' : '') + (x.t.dirty ? ' dirty' : '')); const ic = x.t.dirty ? ICON.dot : ICON.close; if (x.close.textContent !== ic) { x.close.textContent = ic; } }
			return finishTabs();
		}
		tabsRow.textContent = ''; tabEls = [];
		for (const t of state.tabs) {
			t.dirty = isDirty(t);
			const close = el('span', { class: 'ci close' }, t.dirty ? ICON.dot : ICON.close);
			close.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); closeTab(t); });
			const tab = el('div', { class: 'tab' + (t === state.active ? ' active' : '') + (t.dirty ? ' dirty' : ''), title: t.path || t.name }, el('span', { class: 'label' }, t.name), close);
			tab.addEventListener('mousedown', (ev) => { if (ev.button === 1) { closeTab(t); } else if (ev.button === 0) { activate(t); } });
			tabsRow.appendChild(tab); tabEls.push({ t, name: t.name, el: tab, close });
		}
		finishTabs();
	}
	function finishTabs() {
		const wd = state.active ? 'none' : 'block'; if (welcome.style.display !== wd) { welcome.style.display = wd; }
		host.setTitle(state.active ? `${state.active.dirty ? '● ' : ''}${state.active.name} - ${path.basename(state.root)} - editor98` : `${path.basename(state.root)} - editor98`);
	}
	const setText = (e, t) => { if (e.textContent !== t) { e.textContent = t; } };   // an unchanged text is not set again: every change is a layout pass
	function updateStatus() {
		const t = state.active; if (!t) { for (const e of [sPos, sLang, sIndent, sEol, sProb]) { setText(e, ''); } return; }
		setText(sProb, t.problems ? `${t.problems.errors} errors, ${t.problems.warnings} warnings` : '');
		const p = editor ? editor.getPosition() : null; const o = t.model.getOptions();
		setText(sPos, p ? `Ln ${p.lineNumber}, Col ${p.column}` : ''); setText(sLang, t.model.getLanguageId()); setText(sIndent, o.insertSpaces ? `Spaces: ${o.tabSize}` : `Tab Size: ${o.tabSize}`);
		setText(sEol, t.model.getEOL() === '\r\n' ? 'CRLF' : 'LF');
	}
	function activate(t) {
		if (state.active === t && editor) { editor.focus(); return; }
		state.active = t; const sl = slotFor(t); sl.used = ++useClock; editor = sl.ed;
		for (const x of pool) { const d = x === sl ? 'block' : 'none'; if (x.pane.style.display !== d) { x.pane.style.display = d; } }
		sizeSlot(sl);
		// suggestions as you type gather every word of the document in the worker on each key: in a large file, only once typing pauses (a single-core machine does it on the UI's time)
		if (!(host.settings.editor && 'quickSuggestionsDelay' in host.settings.editor)) { const d = t.model.getLineCount() > 2000 ? 400 : 50; if (editor.getRawOptions().quickSuggestionsDelay !== d) { editor.updateOptions({ quickSuggestionsDelay: d }); } }
		renderTabs(); markTree(); updateStatus(); editor.focus();
	}
	function openFile(file) {
		let t = state.tabs.find(x => x.path === file);
		if (!t) {
			let text; try { text = host.readFile(file); } catch (e) { message(`Cannot open ${file}: ${e.message}`); return; }
			const model = monaco.editor.createModel(text, languageOf(path.basename(file)), monaco.Uri.file(file));
			t = { path: file, name: path.basename(file), model, savedVersion: model.getAlternativeVersionId(), view: null, dirty: false };
			model.onDidChangeContent(() => { const d = isDirty(t); if (d !== t.dirty) { renderTabs(); markTree(); } scheduleLint(t, 800); });
			state.tabs.push(t); scheduleLint(t, 50);
		}
		activate(t);
	}
	// the question of Windows editors before changes are lost: Save / Don't Save / Cancel; false = keep everything as it is
	function askSave(list) {
		const dirty = list.filter(isDirty); if (!dirty.length) { return true; }
		const msg = dirty.length === 1 ? `Do you want to save the changes you made to ${dirty[0].name}?\n\nYour changes will be lost if you don't save them.`
			: `Do you want to save the changes to the following ${dirty.length} files?\n\n${dirty.slice(0, 12).map(t => t.name).join('\n')}${dirty.length > 12 ? '\n...' : ''}\n\nYour changes will be lost if you don't save them.`;
		const a = host.confirm(msg); if (a === 'cancel') { return false; }
		if (a === 'save') { for (const t of dirty) { if (!save(t)) { return false; } } }
		return true;
	}
	function closeTab(t, ask = true) {
		if (ask && !askSave([t])) { return false; }
		const i = state.tabs.indexOf(t); state.tabs.splice(i, 1); clearTimeout(t.lintTimer); t.model.dispose();
		releaseSlot(t);
		if (state.active === t) { state.active = null; const next = state.tabs[Math.min(i, state.tabs.length - 1)]; if (next) { activate(next); } else { editor = null; } }
		renderTabs(); markTree(); updateStatus(); return true;
	}
	/** writes the tab's file (an untitled tab asks where); true when saved */
	function save(t = state.active) {
		if (!t) { return false; }
		if (!t.path) { return saveAs(t); }
		if (host.settings.formatOnSave && t === state.active) { formatDocument(); }
		try { host.writeFile(t.path, t.model.getValue()); } catch (e) { message(`Cannot save ${t.name}: ${e.message}`); return false; }
		t.savedVersion = t.model.getAlternativeVersionId(); renderTabs(); markTree(); message(`Saved ${t.name}`); scheduleLint(t, 0); return true;
	}
	function saveAs(t = state.active) {
		if (!t) { return false; }
		const target = host.saveFileDialog(t.path || path.join(state.root, t.name)); if (!target) { return false; }
		const other = state.tabs.find(x => x !== t && x.path === target); if (other) { closeTab(other, false); }
		const was = t.path; t.path = target; t.name = path.basename(target);
		const lang = languageOf(t.name); if (lang !== t.model.getLanguageId()) { monaco.editor.setModelLanguage(t.model, lang); }
		if (!save(t)) { t.path = was; t.name = was ? path.basename(was) : t.name; return false; }
		dirCache.delete(path.dirname(target)); renderTree(); updateStatus(); return true;
	}
	function saveAll() { for (const t of state.tabs.filter(isDirty)) { if (!save(t)) { return false; } } return true; }
	let untitled = 0;
	function newFile() {
		const name = `Untitled-${++untitled}`; const model = monaco.editor.createModel('', 'plaintext', monaco.Uri.from({ scheme: 'untitled', path: name }));
		const t = { path: null, name, model, savedVersion: model.getAlternativeVersionId(), view: null, dirty: false };
		model.onDidChangeContent(() => { const d = isDirty(t); if (d !== t.dirty) { renderTabs(); } });
		state.tabs.push(t); activate(t); return t;
	}
	function openFileDialog() { const f = host.openFileDialog(state.active && state.active.path ? path.dirname(state.active.path) : state.root); if (f) { openFile(f); } }
	// another folder: the tabs of this one close first (asking about changes), the tree starts again
	function setRoot(dir) {
		if (!askSave(state.tabs)) { return false; }
		for (const t of [...state.tabs]) { closeTab(t, false); }
		state.root = dir; state.expanded = new Set([dir]); state.selected = null; dirCache.clear(); allFiles = null;
		rootName.textContent = path.basename(dir).toUpperCase(); searchResults.textContent = ''; searchInfo.textContent = '';
		host.setWorkspace?.(dir); showView('explorer'); renderTree(); renderTabs(); updateStatus(); message(`Opened ${dir}`); return true;
	}
	function openFolder() { const d = host.pickFolder(state.root); if (d && d !== state.root) { setRoot(d); } }
	function refresh() { dirCache.clear(); renderTree(); }
	// ---- linting (host.lint: Luau's analyzer for luau files): squiggles, and the count in the status bar
	function scheduleLint(t, ms) {
		if (!host.lint || t.model.isDisposed() || t.model.getLanguageId() !== 'luau') { return; }
		clearTimeout(t.lintTimer); t.lintTimer = setTimeout(async () => {
			if (t.model.isDisposed()) { return; }
			const version = t.model.getVersionId(); const res = await host.lint(t.model.getValue(), t.path);
			if (!res || t.model.isDisposed() || t.model.getVersionId() !== version) { return; }
			const S = monaco.MarkerSeverity;
			monaco.editor.setModelMarkers(t.model, 'luau', res.map(p => ({ startLineNumber: p.line, startColumn: p.col, endLineNumber: p.line, endColumn: Math.max(p.endCol, p.col + 1), message: p.message, code: p.code, source: 'luau', severity: p.severity === 'error' ? S.Error : S.Warning })));
			t.problems = { errors: res.filter(p => p.severity === 'error').length, warnings: res.filter(p => p.severity !== 'error').length }; updateStatus();
		}, ms);
	}
	function formatDocument() { if (!editor) { return; } const a = editor.getAction('editor.action.formatDocument'); if (a && a.isSupported()) { a.run(); } }
	let msgTimer = 0; function message(m) { setText(sMsg, m); clearTimeout(msgTimer); msgTimer = setTimeout(() => { setText(sMsg, ''); }, 4000); }

	// ---- quick open (Ctrl+P): every file of the workspace, matched by the characters of the query in order
	let allFiles = null, quickItems = [], quickSel = 0;
	const walkFiles = () => { const out = []; const walk = (dir) => { for (const it of listDir(dir)) { if (out.length > 20000) { return; } if (it.isDir) { walk(it.path); } else { out.push(it.path); } } }; walk(state.root); return out; };
	function renderQuick() {
		const q = quickInput.value.trim(); quickList.textContent = '';
		const scored = []; for (const f of allFiles) { const rel = path.relative(state.root, f); if (!q) { scored.push({ f, rel, s: 0, pos: [] }); continue; } const m = fuzzy(q, rel); if (m) { scored.push({ f, rel, s: m.score, pos: m.pos }); } }
		scored.sort((a, b) => b.s - a.s); quickItems = scored.slice(0, 15); quickSel = Math.min(quickSel, Math.max(0, quickItems.length - 1));
		quickItems.forEach((it, i) => {
			const name = path.basename(it.rel), off = it.rel.length - name.length; const label = el('span');
			for (let k = 0; k < name.length; k++) { label.appendChild(it.pos.includes(off + k) ? el('b', null, name[k]) : document.createTextNode(name[k])); }
			const row = el('div', { class: 'item' + (i === quickSel ? ' sel' : '') }, label, el('span', { class: 'dim' }, path.dirname(it.rel) === '.' ? '' : path.dirname(it.rel)));
			row.addEventListener('mousedown', (ev) => { ev.preventDefault(); closeQuick(); openFile(it.f); });
			quickList.appendChild(row);
		});
	}
	function openQuick() { allFiles = walkFiles(); quickInput.value = ''; quickSel = 0; quick.className = 'open'; renderQuick(); quickInput.focus(); }
	function closeQuick() { quick.className = ''; if (state.active && editor) { editor.focus(); } }
	quickInput.addEventListener('input', () => { quickSel = 0; renderQuick(); });
	quickInput.addEventListener('keydown', (ev) => {
		if (ev.key === 'ArrowDown') { quickSel = Math.min(quickSel + 1, quickItems.length - 1); renderQuick(); ev.preventDefault(); }
		else if (ev.key === 'ArrowUp') { quickSel = Math.max(quickSel - 1, 0); renderQuick(); ev.preventDefault(); }
		else if (ev.key === 'Enter') { const it = quickItems[quickSel]; closeQuick(); if (it) { openFile(it.f); } ev.preventDefault(); }
		else if (ev.key === 'Escape') { closeQuick(); ev.preventDefault(); }
	});

	// ---- search across the folder (Ctrl+Shift+F): every text file under 1 MB, plain text (case-insensitive) or /regex/; at most 2,000 matches; a click opens the match
	function showView(name) {
		state.view = name; explorerView.className = name === 'explorer' ? 'view' : 'view hidden'; searchView.className = name === 'search' ? 'view' : 'view hidden';
		if (!state.sidebar) { state.sidebar = true; sidebar.className = ''; relayout(); }
		if (name === 'search') { const sel = state.active && editor && editor.getModel() && editor.getModel().getValueInRange(editor.getSelection()); if (sel && !sel.includes('\n')) { searchInput.value = sel; } searchInput.focus(); searchInput.select && searchInput.select(); }
	}
	function runSearch() {
		const q = searchInput.value; searchResults.textContent = ''; if (!q) { searchInfo.textContent = ''; return; }
		let re; try { const m = /^\/(.+)\/([a-z]*)$/.exec(q); re = m ? new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); } catch (e) { searchInfo.textContent = 'Invalid expression: ' + e.message; return; }
		const t0 = Date.now(); let total = 0, filesHit = 0; const files = walkFiles();
		for (const f of files) {
			if (total >= 2000) { break; }
			let text; try { const tab = state.tabs.find(t => t.path === f); text = tab ? tab.model.getValue() : host.readFile(f); } catch { continue; }
			if (text.length > 1 << 20 || text.includes('\u0000')) { continue; }
			const lines = text.split(/\r?\n/); let header = null;
			for (let i = 0; i < lines.length && total < 2000; i++) {
				re.lastIndex = 0; const m = re.exec(lines[i]); if (!m) { continue; }
				if (!header) { header = el('div', { class: 'sr-file' }, el('span', { class: 'name' }, path.basename(f)), el('span', { class: 'dim' }, ' ' + path.relative(state.root, path.dirname(f)))); searchResults.appendChild(header); filesHit++; }
				const line = lines[i]; const start = Math.max(0, m.index - 30); const pre = (start > 0 ? '…' : '') + line.slice(start, m.index).replace(/^\s+/, ''); const hit = m[0] || ' '; const post = line.slice(m.index + hit.length, m.index + hit.length + 60);
				const row = el('div', { class: 'sr-line' }, el('span', null, pre), el('b', null, hit), el('span', null, post));
				const at = { line: i + 1, col: m.index + 1, len: hit.length };
				row.addEventListener('mousedown', (ev) => { if (ev.button !== 0) { return; } openFile(f); editor.setSelection(new monaco.Range(at.line, at.col, at.line, at.col + at.len)); editor.revealLineInCenter(at.line); editor.focus(); });
				searchResults.appendChild(row); total++;
			}
		}
		searchInfo.textContent = `${total}${total >= 2000 ? '+' : ''} results in ${filesHit} files (${files.length} searched, ${Date.now() - t0} ms)`;
	}
	searchInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { runSearch(); ev.preventDefault(); } else if (ev.key === 'Escape') { showView('explorer'); if (state.active && editor) { editor.focus(); } ev.preventDefault(); } });

	// ---- keys: in the editor through Monaco's own keybindings, elsewhere on the window
	const K = monaco.KeyMod, C = monaco.KeyCode;
	const commands = { save: () => save(), saveAs: () => saveAs(), saveAll, newFile, openFile: openFileDialog, openFolder, refresh, close: () => state.active && closeTab(state.active), quickOpen: openQuick, toggleSidebar: () => { state.sidebar = !state.sidebar; sidebar.className = state.sidebar ? '' : 'hidden'; relayout(); },
		nextTab: () => { const n = state.tabs.length; if (n > 1) { activate(state.tabs[(state.tabs.indexOf(state.active) + 1) % n]); } }, prevTab: () => { const n = state.tabs.length; if (n > 1) { activate(state.tabs[(state.tabs.indexOf(state.active) + n - 1) % n]); } } };
	commands.search = () => showView('search'); commands.explorer = () => showView('explorer');
	// Monaco's keybindings and palette entries belong to one editor: each editor of the pool gets them
	function setupEditor(editor) {
		editor.addCommand(K.CtrlCmd | C.KeyS, commands.save); editor.addCommand(K.CtrlCmd | C.KeyW, commands.close); editor.addCommand(K.CtrlCmd | C.KeyP, commands.quickOpen);
		editor.addCommand(K.CtrlCmd | K.Shift | C.KeyF, commands.search); editor.addCommand(K.CtrlCmd | K.Shift | C.KeyE, commands.explorer);
		editor.addCommand(K.CtrlCmd | K.Shift | C.KeyS, commands.saveAs); editor.addCommand(K.CtrlCmd | C.KeyN, commands.newFile); editor.addCommand(K.CtrlCmd | C.KeyO, commands.openFile);
		editor.addCommand(K.chord(K.CtrlCmd | C.KeyK, K.CtrlCmd | C.KeyO), commands.openFolder); editor.addCommand(K.chord(K.CtrlCmd | C.KeyK, C.KeyS), commands.saveAll);
		// the same in Monaco's command palette (F1)
		for (const [id, label, run] of [['openFolder', 'File: Open Folder...', commands.openFolder], ['openFile', 'File: Open File...', commands.openFile], ['newFile', 'File: New File', commands.newFile], ['saveAs', 'File: Save As...', commands.saveAs],
			['saveAll', 'File: Save All', commands.saveAll], ['refresh', 'File: Refresh Explorer', commands.refresh], ['quickOpen', 'Go to File...', commands.quickOpen], ['search', 'Search: Find in Files', commands.search]]) { editor.addAction({ id: 'editor98.' + id, label, run: () => run() }); }
		editor.addCommand(K.CtrlCmd | C.KeyB, commands.toggleSidebar); editor.addCommand(K.CtrlCmd | C.Tab, commands.nextTab); editor.addCommand(K.CtrlCmd | K.Shift | C.Tab, commands.prevTab);
		editor.onDidChangeCursorPosition(() => { if (editor === activeEditor()) { updateStatus(); } });
	}
	const activeEditor = () => editor;
	let chordK = false;
	window.addEventListener('keydown', (ev) => {
		if (ev.defaultPrevented || ev.altKey || ev.key === 'Control' || ev.key === 'Shift') { return; }
		const k = ev.key.toLowerCase();
		if (chordK) { chordK = false; const f = ev.ctrlKey && k === 'o' ? commands.openFolder : !ev.ctrlKey && k === 's' ? commands.saveAll : null; if (f) { ev.preventDefault(); f(); } return; }   // Ctrl+K then ...
		if (!ev.ctrlKey) { return; }
		if (k === 'k' && !ev.shiftKey) { chordK = true; ev.preventDefault(); return; }
		const f = ev.shiftKey ? (k === 'f' ? commands.search : k === 'e' ? commands.explorer : k === 's' ? commands.saveAs : null) : k === 's' ? commands.save : k === 'w' ? commands.close : k === 'p' ? commands.quickOpen : k === 'b' ? commands.toggleSidebar
			: k === 'n' ? commands.newFile : k === 'o' ? commands.openFile : null;
		if (f) { ev.preventDefault(); f(); }
	});

	renderTree(); renderTabs(); relayout();
	for (const f of host.openFiles || []) { openFile(f); }
	return { get editor() { return editor; }, state, commands, openFile, save, saveAs, saveAll, newFile, setRoot, openFolder, askSave, canClose: () => askSave(state.tabs), closeTab, openQuick, renderTree, relayout, showView, runSearch };
}
