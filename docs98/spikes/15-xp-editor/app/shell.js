// The editor's shell around Monaco: explorer (lazy file tree), tabs (one Monaco model per file, view state kept per tab), status bar, quick open (Ctrl+P), saving and the keys of
// a code editor. Runs in the page (globalThis is the window of our DOM); everything outside the page comes from `host` (editor98.mjs): files, the window title, quitting.

const ICON = { chevronRight: String.fromCharCode(60086), chevronDown: String.fromCharCode(60084), close: String.fromCharCode(60022), dot: String.fromCharCode(60017), file: String.fromCharCode(60027) };
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
	byExt.set('.luau', byExt.get('.lua') || 'lua');
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
	const sidebar = el('div', { id: 'sidebar' }, el('div', { class: 'side-title' }, 'EXPLORER'), el('div', { class: 'root-name' }, path.basename(state.root).toUpperCase()), tree);
	const tabsBar = el('div', { id: 'tabs' });
	const editorHost = el('div', { id: 'editor-host' });
	const welcome = el('div', { id: 'welcome' }, el('div', { class: 'big' }, 'editor98'), el('div', { class: 'keys' }, 'Ctrl+P  open a file'), el('div', { class: 'keys' }, 'Ctrl+S  save'), el('div', { class: 'keys' }, 'Ctrl+W  close the tab'), el('div', { class: 'keys' }, 'Ctrl+B  show or hide the explorer'), el('div', { class: 'keys' }, 'Shift+Alt+F  format the document'));
	editorHost.appendChild(welcome);
	const sPos = el('span', { class: 'item' }), sLang = el('span', { class: 'item' }), sIndent = el('span', { class: 'item' }), sEol = el('span', { class: 'item' }), sEnc = el('span', { class: 'item' }, 'UTF-8'), sMsg = el('span', { class: 'item' });
	const statusbar = el('div', { id: 'statusbar' }, sMsg, el('span', { class: 'spacer' }), sPos, sIndent, sEnc, sEol, sLang);
	const quickInput = el('input', { type: 'text', spellcheck: 'false' }); const quickList = el('div', { class: 'list' });
	const quick = el('div', { id: 'quick' }, quickInput, quickList);
	const app = el('div', { id: 'app' }, el('div', { id: 'body' }, sidebar, el('div', { id: 'main' }, tabsBar, editorHost)), statusbar, quick);
	document.body.appendChild(app);

	const editor = monaco.editor.create(editorHost, {
		model: null, theme: 'vs-dark', fontFamily: 'DejaVu Sans Mono', fontSize: host.settings.fontSize || 14, lineHeight: Math.round((host.settings.fontSize || 14) * 1.4),
		minimap: { enabled: false }, automaticLayout: false, editContext: false, smoothScrolling: false, cursorBlinking: 'solid', accessibilitySupport: 'off', fontLigatures: false,
		renderWhitespace: 'none', scrollBeyondLastLine: false, tabSize: host.settings.tabSize || 4, insertSpaces: host.settings.insertSpaces ?? false, stickyScroll: { enabled: false },
	});
	const relayout = () => { const r = editorHost.getBoundingClientRect(); editor.layout({ width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) }); };
	window.addEventListener('resize', relayout);

	// ---- explorer
	const listDir = (dir) => {
		let names; try { names = host.readDir(dir); } catch (e) { return []; }
		const out = []; for (const n of names) { if (SKIP_DIRS.has(n)) { continue; } let isDir = false; try { isDir = host.isDir(path.join(dir, n)); } catch { continue; } out.push({ name: n, path: path.join(dir, n), isDir }); }
		return out.sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
	};
	const dirCache = new Map(); const children = (dir) => { if (!dirCache.has(dir)) { dirCache.set(dir, listDir(dir)); } return dirCache.get(dir); };
	function renderTree() {
		rows.textContent = ''; const activePath = state.active && state.active.path;
		const add = (dir, depth) => {
			for (const it of children(dir)) {
				const open = it.isDir && state.expanded.has(it.path); const tab = state.tabs.find(t => t.path === it.path);
				const row = el('div', { class: 'row' + (it.path === state.selected ? ' selected' : '') + (it.path === activePath ? ' active' : '') + (tab && tab.dirty ? ' dirty' : ''), style: `padding-left:${8 + depth * 12}px` },
					el('span', { class: 'ci' }, it.isDir ? (open ? ICON.chevronDown : ICON.chevronRight) : ''), el('span', { class: 'name' }, it.name));
				row.addEventListener('mousedown', (ev) => { if (ev.button !== 0) { return; } state.selected = it.path; if (it.isDir) { if (open) { state.expanded.delete(it.path); } else { state.expanded.add(it.path); } renderTree(); } else { openFile(it.path); } });
				rows.appendChild(row);
				if (open) { add(it.path, depth + 1); }
			}
		};
		add(state.root, 0);
	}

	// ---- tabs and files
	const isDirty = (t) => t.model.getAlternativeVersionId() !== t.savedVersion;
	function renderTabs() {
		tabsBar.textContent = '';
		for (const t of state.tabs) {
			t.dirty = isDirty(t);
			const close = el('span', { class: 'ci close' }, t.dirty ? ICON.dot : ICON.close);
			close.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); closeTab(t); });
			const tab = el('div', { class: 'tab' + (t === state.active ? ' active' : '') + (t.dirty ? ' dirty' : ''), title: t.path }, el('span', { class: 'label' }, t.name), close);
			tab.addEventListener('mousedown', (ev) => { if (ev.button === 1) { closeTab(t); } else if (ev.button === 0) { activate(t); } });
			tabsBar.appendChild(tab);
		}
		welcome.style.display = state.active ? 'none' : 'block';
		host.setTitle(state.active ? `${state.active.dirty ? '● ' : ''}${state.active.name} - ${path.basename(state.root)} - editor98` : `${path.basename(state.root)} - editor98`);
	}
	function updateStatus() {
		const t = state.active; if (!t) { sPos.textContent = sLang.textContent = sIndent.textContent = sEol.textContent = ''; return; }
		const p = editor.getPosition(); const o = t.model.getOptions();
		sPos.textContent = p ? `Ln ${p.lineNumber}, Col ${p.column}` : ''; sLang.textContent = t.model.getLanguageId(); sIndent.textContent = o.insertSpaces ? `Spaces: ${o.tabSize}` : `Tab Size: ${o.tabSize}`;
		sEol.textContent = t.model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
	}
	function activate(t) {
		if (state.active === t) { editor.focus(); return; }
		if (state.active) { state.active.view = editor.saveViewState(); }
		state.active = t; editor.setModel(t.model); if (t.view) { editor.restoreViewState(t.view); }
		relayout(); renderTabs(); renderTree(); updateStatus(); editor.focus();
	}
	function openFile(file) {
		let t = state.tabs.find(x => x.path === file);
		if (!t) {
			let text; try { text = host.readFile(file); } catch (e) { message(`Cannot open ${file}: ${e.message}`); return; }
			const model = monaco.editor.createModel(text, languageOf(path.basename(file)), monaco.Uri.file(file));
			t = { path: file, name: path.basename(file), model, savedVersion: model.getAlternativeVersionId(), view: null, dirty: false };
			model.onDidChangeContent(() => { const d = isDirty(t); if (d !== t.dirty) { renderTabs(); renderTree(); } });
			state.tabs.push(t);
		}
		activate(t);
	}
	function closeTab(t) {
		if (isDirty(t) && !host.confirm(`Save changes to ${t.name}?`, () => save(t))) { return; }
		const i = state.tabs.indexOf(t); state.tabs.splice(i, 1); t.model.dispose();
		if (state.active === t) { state.active = null; const next = state.tabs[Math.min(i, state.tabs.length - 1)]; if (next) { activate(next); } else { editor.setModel(null); } }
		renderTabs(); renderTree(); updateStatus();
	}
	function save(t = state.active) {
		if (!t) { return; }
		if (host.settings.formatOnSave) { formatDocument(); }
		try { host.writeFile(t.path, t.model.getValue()); } catch (e) { message(`Cannot save ${t.name}: ${e.message}`); return; }
		t.savedVersion = t.model.getAlternativeVersionId(); renderTabs(); renderTree(); message(`Saved ${t.name}`);
	}
	function formatDocument() { const a = editor.getAction('editor.action.formatDocument'); if (a && a.isSupported()) { a.run(); } }
	let msgTimer = 0; function message(m) { sMsg.textContent = m; clearTimeout(msgTimer); msgTimer = setTimeout(() => { sMsg.textContent = ''; }, 4000); }

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
	function closeQuick() { quick.className = ''; if (state.active) { editor.focus(); } }
	quickInput.addEventListener('input', () => { quickSel = 0; renderQuick(); });
	quickInput.addEventListener('keydown', (ev) => {
		if (ev.key === 'ArrowDown') { quickSel = Math.min(quickSel + 1, quickItems.length - 1); renderQuick(); ev.preventDefault(); }
		else if (ev.key === 'ArrowUp') { quickSel = Math.max(quickSel - 1, 0); renderQuick(); ev.preventDefault(); }
		else if (ev.key === 'Enter') { const it = quickItems[quickSel]; closeQuick(); if (it) { openFile(it.f); } ev.preventDefault(); }
		else if (ev.key === 'Escape') { closeQuick(); ev.preventDefault(); }
	});

	// ---- keys: in the editor through Monaco's own keybindings, elsewhere on the window
	const K = monaco.KeyMod, C = monaco.KeyCode;
	const commands = { save: () => save(), close: () => state.active && closeTab(state.active), quickOpen: openQuick, toggleSidebar: () => { state.sidebar = !state.sidebar; sidebar.className = state.sidebar ? '' : 'hidden'; relayout(); },
		nextTab: () => { const n = state.tabs.length; if (n > 1) { activate(state.tabs[(state.tabs.indexOf(state.active) + 1) % n]); } }, prevTab: () => { const n = state.tabs.length; if (n > 1) { activate(state.tabs[(state.tabs.indexOf(state.active) + n - 1) % n]); } } };
	editor.addCommand(K.CtrlCmd | C.KeyS, commands.save); editor.addCommand(K.CtrlCmd | C.KeyW, commands.close); editor.addCommand(K.CtrlCmd | C.KeyP, commands.quickOpen);
	editor.addCommand(K.CtrlCmd | C.KeyB, commands.toggleSidebar); editor.addCommand(K.CtrlCmd | C.Tab, commands.nextTab); editor.addCommand(K.CtrlCmd | K.Shift | C.Tab, commands.prevTab);
	window.addEventListener('keydown', (ev) => {
		if (ev.defaultPrevented || !ev.ctrlKey || ev.altKey) { return; }
		const k = ev.key.toLowerCase(); const f = k === 's' ? commands.save : k === 'w' ? commands.close : k === 'p' ? commands.quickOpen : k === 'b' ? commands.toggleSidebar : null;
		if (f) { ev.preventDefault(); f(); }
	});
	editor.onDidChangeCursorPosition(updateStatus);

	renderTree(); renderTabs(); relayout();
	for (const f of host.openFiles || []) { openFile(f); }
	return { editor, state, commands, openFile, save, closeTab, openQuick, renderTree, relayout };
}
