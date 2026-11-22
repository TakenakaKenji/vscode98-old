// Luau (Roblox's Lua): the language for Monaco (brackets, comments, auto-indent rules, a Monarch tokenizer with Luau's syntax: type annotations, `type`/`export type`, `continue`,
// compound assignment, `//`, `::` casts, backtick strings with {interpolation}, long strings [[ ]] / [==[ ]==], 0b and 1_000 numbers) and a formatter that re-indents the code
// (block structure from a small lexer; lines inside long strings and comments are left as they are, trailing spaces removed). Plain Lua is the same language without the extras.

const BLOCK_OPEN = new Set(['function', 'do', 'then', 'repeat']);
const BLOCK_CLOSE = new Set(['end', 'until']);
const ROBLOX_GLOBALS = ['game', 'workspace', 'script', 'plugin', 'shared', 'Instance', 'Vector2', 'Vector3', 'Vector2int16', 'Vector3int16', 'CFrame', 'Color3', 'ColorSequence', 'ColorSequenceKeypoint',
	'NumberSequence', 'NumberSequenceKeypoint', 'NumberRange', 'UDim', 'UDim2', 'Rect', 'Ray', 'Region3', 'Region3int16', 'BrickColor', 'Enum', 'TweenInfo', 'PhysicalProperties', 'Axes', 'Faces', 'Random',
	'DateTime', 'Font', 'OverlapParams', 'RaycastParams', 'PathWaypoint', 'CatalogSearchParams', 'DockWidgetPluginGuiInfo', 'SharedTable', 'Content', 'task', 'wait', 'spawn', 'delay', 'tick', 'time',
	'elapsedTime', 'warn', 'settings', 'UserSettings', 'version', 'stats', 'gcinfo'];
const LUA_GLOBALS = ['print', 'pairs', 'ipairs', 'next', 'select', 'type', 'typeof', 'tostring', 'tonumber', 'pcall', 'xpcall', 'error', 'assert', 'require', 'setmetatable', 'getmetatable',
	'rawget', 'rawset', 'rawequal', 'rawlen', 'unpack', 'newproxy', 'math', 'string', 'table', 'coroutine', 'os', 'debug', 'utf8', 'bit32', 'buffer', 'vector', '_G', '_VERSION', 'self'];

export const luauGlobals = ROBLOX_GLOBALS;

const conf = {
	comments: { lineComment: '--', blockComment: ['--[[', ']]'] },
	brackets: [['{', '}'], ['[', ']'], ['(', ')']],
	autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"', notIn: ['string'] }, { open: "'", close: "'", notIn: ['string'] }, { open: '`', close: '`', notIn: ['string'] }],
	surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }, { open: "'", close: "'" }, { open: '`', close: '`' }],
	indentationRules: {
		increaseIndentPattern: /^((?!--).)*((\b(function|then|do|repeat|else)\b((?!\b(end|until)\b).)*)|(\{[^}]*)|(\([^)]*))$/,
		decreaseIndentPattern: /^\s*((\b(end|until|else|elseif)\b)|(\})|(\)))/,
	},
	wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+\[{\]}\\|;:'",.<>/?\s]+)/g,
};

const language = {
	defaultToken: '', tokenPostfix: '.luau',
	keywords: ['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'goto', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while', 'continue', 'export'],
	flow: ['if', 'then', 'else', 'elseif', 'end', 'for', 'while', 'do', 'repeat', 'until', 'return', 'break', 'continue', 'in'],
	constants: ['true', 'false', 'nil'],
	predefined: [...LUA_GLOBALS, ...ROBLOX_GLOBALS],
	brackets: [{ token: 'delimiter.bracket', open: '{', close: '}' }, { token: 'delimiter.array', open: '[', close: ']' }, { token: 'delimiter.parenthesis', open: '(', close: ')' }],
	symbols: /[=><!~?:&|+\-*\/\^%.#]+/,
	escapes: /\\(?:[abfnrtvz\\"'`{}\n]|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\}|\d{1,3})/,
	tokenizer: {
		root: [
			[/(export)(\s+)(type)(\s+)([a-zA-Z_]\w*)/, ['keyword', '', 'keyword', '', 'type']],
			[/^(\s*)(type)(\s+)([a-zA-Z_]\w*)(?=\s*(?:<[^>]*>)?\s*=)/, ['', 'keyword', '', 'type']],
			[/(function)(\s+)([a-zA-Z_][\w.:]*)/, ['keyword', '', 'function']],
			[/(::)(\s*)([a-zA-Z_][\w.]*)/, ['delimiter', '', 'type']],
			[/(:)(\s*)([a-zA-Z_][\w.]*)(?!\s*[({"'`\[])/, ['delimiter', '', 'type']],
			[/(->)(\s*)([a-zA-Z_][\w.]*)/, ['delimiter', '', 'type']],
			[/[a-zA-Z_]\w*(?=\s*[({"'`]|\s*\[\[)/, { cases: { '@flow': 'keyword.flow', '@keywords': 'keyword', '@constants': 'constant', '@predefined': 'variable.predefined', '@default': 'function' } }],
			[/[a-zA-Z_]\w*/, { cases: { '@flow': 'keyword.flow', '@keywords': 'keyword', '@constants': 'constant', '@predefined': 'variable.predefined', '@default': 'identifier' } }],
			{ include: '@whitespace' },
			[/(,|\{)(\s*)([a-zA-Z_]\w*)(\s*)(=)(?!=)/, ['delimiter', '', 'key', '', 'delimiter']],
			[/[{}()\[\]]/, '@brackets'],
			[/\.\.\.|\.\.=|\/\/=|[+\-*\/%^]=|\/\/|->|::|==|~=|<=|>=|\.\./, 'delimiter'],
			[/@symbols/, 'delimiter'],
			[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
			[/0[bB][01_]+/, 'number.hex'],
			[/(\d[\d_]*)?\.\d[\d_]*([eE][\-+]?\d+)?/, 'number.float'],
			[/\d[\d_]*([eE][\-+]?\d+)?/, 'number'],
			[/[;,]/, 'delimiter'],
			[/\[(=*)\[/, { token: 'string', next: '@longstring.$1' }],
			[/"([^"\\]|\\.)*$/, 'string.invalid'],
			[/'([^'\\]|\\.)*$/, 'string.invalid'],
			[/"/, 'string', '@string."'],
			[/'/, 'string', "@string.'"],
			[/`/, 'string', '@interp'],
		],
		whitespace: [[/[ \t\r\n]+/, ''], [/--\[(=*)\[/, 'comment', '@longcomment.$1'], [/--.*$/, 'comment']],
		longcomment: [[/[^\]]+/, 'comment'], [/\](=*)\]/, { cases: { '$1==$S2': { token: 'comment', next: '@pop' }, '@default': 'comment' } }], [/./, 'comment']],
		longstring: [[/[^\]]+/, 'string'], [/\](=*)\]/, { cases: { '$1==$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }], [/./, 'string']],
		string: [[/[^\\"']+/, 'string'], [/@escapes/, 'string.escape'], [/\\./, 'string.escape.invalid'], [/["']/, { cases: { '$#==$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }]],
		interp: [[/[^\\`{]+/, 'string'], [/@escapes/, 'string.escape'], [/\\./, 'string.escape.invalid'], [/\{/, { token: 'delimiter.bracket', next: '@interpexpr' }], [/`/, 'string', '@pop']],
		interpexpr: [[/\}/, { token: 'delimiter.bracket', next: '@pop' }], { include: '@root' }],
	},
};

/** Lexes Luau source into tokens { t: kind, v: text, line } (kinds: name, kw, open, close, str, comment, other); long strings and comments record the lines they cover. */
function lex(src) {
	const out = []; let i = 0, line = 0; const n = src.length;
	const push = (t, v, l0, l1) => { out.push({ t, v, line: l0, endLine: l1 ?? l0 }); };
	const longEnd = (eq, from) => { const close = ']' + '='.repeat(eq) + ']'; const k = src.indexOf(close, from); return k < 0 ? n : k + close.length; };
	const countNl = (a, b) => { let c = 0; for (let k = a; k < b; k++) { if (src.charCodeAt(k) === 10) { c++; } } return c; };
	while (i < n) {
		const c = src[i];
		if (c === '\n') { line++; i++; continue; }
		if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
		if (c === '-' && src[i + 1] === '-') {
			const m = /^\[(=*)\[/.exec(src.slice(i + 2, i + 2 + 64));
			if (m) { const e = longEnd(m[1].length, i + 2 + m[0].length); const l1 = line + countNl(i, e); push('comment', src.slice(i, e), line, l1); line = l1; i = e; continue; }
			let e = src.indexOf('\n', i); if (e < 0) { e = n; } push('comment', src.slice(i, e), line); i = e; continue;
		}
		if (c === '[' && /^\[=*\[/.test(src.slice(i, i + 64))) { const m = /^\[(=*)\[/.exec(src.slice(i, i + 64)); const e = longEnd(m[1].length, i + m[0].length); const l1 = line + countNl(i, e); push('str', src.slice(i, e), line, l1); line = l1; i = e; continue; }
		if (c === '"' || c === "'") { let k = i + 1; while (k < n && src[k] !== c && src[k] !== '\n') { k += src[k] === '\\' ? 2 : 1; } k = Math.min(n, k + 1); const l1 = line + countNl(i, k); push('str', src.slice(i, k), line, l1); line = l1; i = k; continue; }
		if (c === '`') {   // interpolated string: braces inside {...} belong to the expression
			let k = i + 1, depth = 0; while (k < n) { const d = src[k]; if (d === '\\') { k += 2; continue; } if (depth === 0 && d === '`') { k++; break; } if (d === '{') { depth++; } else if (d === '}' && depth > 0) { depth--; } k++; }
			const l1 = line + countNl(i, k); push('str', src.slice(i, k), line, l1); line = l1; i = k; continue;
		}
		if (/[A-Za-z_]/.test(c)) { let k = i + 1; while (k < n && /\w/.test(src[k])) { k++; } const w = src.slice(i, k); push(BLOCK_OPEN.has(w) || BLOCK_CLOSE.has(w) || w === 'else' || w === 'elseif' ? 'kw' : 'name', w, line); i = k; continue; }
		if (c === '{' || c === '(' || c === '[') { push('open', c, line); i++; continue; }
		if (c === '}' || c === ')' || c === ']') { push('close', c, line); i++; continue; }
		push('other', c, line); i++;
	}
	return out;
}

/**
 * New indentation for every line: a line is indented once for every earlier line that still has an unclosed opener (several openers on one line count once: `foo({` indents the next line by one);
 * closers at the start of a line (`end`, `until`, `}`, `)`, `else`, `elseif`) are taken off before the line's own indentation is computed. Lines that begin inside a long string or comment keep
 * their text. Returns [{ line, text }] for the lines that change.
 */
export function formatLuau(src, { indent = '\t' } = {}) {
	const lines = src.split(/\r?\n/); const toks = lex(src);
	const byLine = new Map(); const frozen = new Set();
	for (const t of toks) { (byLine.get(t.line) || byLine.set(t.line, []).get(t.line)).push(t); for (let l = t.line + 1; l <= t.endLine; l++) { frozen.add(l); } }
	const stack = [];   // for every opener still open, the line it is on
	const exprIfs = [];   // Luau if-expressions (`x = if a then b else c`: no `end`), each with the depth of the stack where it began: its then/elseif/else open and close nothing
	const pop = () => { if (stack.length) { stack.pop(); } };
	const EXPR_BEFORE = new Set(['=', ',', '(', '[', '{', '+', '-', '*', '/', '%', '^', '.', '<', '>', '~', '#', 'return', 'and', 'or', 'not']);
	let prev = null;
	const ofExprIf = (t) => exprIfs.length > 0 && exprIfs[exprIfs.length - 1] === stack.length && (t.v === 'then' || t.v === 'elseif' || t.v === 'else');
	const isCloser = (t) => !ofExprIf(t) && (t.t === 'close' || (t.t === 'kw' && (BLOCK_CLOSE.has(t.v) || t.v === 'else' || t.v === 'elseif')));
	const take = (t, l) => {
		if (t.t === 'comment') { return; }
		if (t.t === 'name' && t.v === 'if' && prev && EXPR_BEFORE.has(prev.v)) { exprIfs.push(stack.length); }
		else if (ofExprIf(t)) { if (t.v === 'else') { exprIfs.pop(); } }
		else if (t.t === 'open' || (t.t === 'kw' && BLOCK_OPEN.has(t.v))) { stack.push(l); }
		else if (t.t === 'close' || (t.t === 'kw' && (BLOCK_CLOSE.has(t.v) || t.v === 'elseif'))) { pop(); }
		else if (t.t === 'kw' && t.v === 'else') { pop(); stack.push(l); }
		prev = t;
	};
	const edits = [];
	for (let l = 0; l < lines.length; l++) {
		const ts = byLine.get(l) || []; let k = 0, reopen = false;
		while (k < ts.length && isCloser(ts[k])) { pop(); prev = ts[k]; if (ts[k].v === 'else') { reopen = true; k++; break; } k++; }   // closers at the start of the line (else: back one level, then open again)
		const levels = new Set(stack).size;
		if (!frozen.has(l)) {
			const body = lines[l].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
			const want = body === '' ? '' : indent.repeat(levels) + body;
			if (want !== lines[l]) { edits.push({ line: l, text: want }); }
		}
		if (reopen) { stack.push(l); }
		for (; k < ts.length; k++) { take(ts[k], l); }
	}
	return edits;
}

/** registers Luau with Monaco (for .luau and .lua files: Luau is a superset of Lua 5.1) and its formatter */
export function registerLuau(monaco) {
	monaco.languages.register({ id: 'luau', extensions: ['.luau', '.lua'], aliases: ['Luau', 'Lua', 'luau', 'lua'] });
	monaco.languages.setLanguageConfiguration('luau', conf);
	monaco.languages.setMonarchTokensProvider('luau', language);
	const provider = {
		provideDocumentFormattingEdits(model, options) {
			const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
			return formatLuau(model.getValue(), { indent }).map(e => ({ range: new monaco.Range(e.line + 1, 1, e.line + 1, model.getLineMaxColumn(e.line + 1)), text: e.text }));
		},
	};
	monaco.languages.registerDocumentFormattingEditProvider('luau', provider);
	monaco.editor.defineTheme('editor98-dark', { base: 'vs-dark', inherit: true, colors: {}, rules: [
		{ token: 'keyword.flow', foreground: 'C586C0' }, { token: 'function', foreground: 'DCDCAA' }, { token: 'variable.predefined', foreground: '4FC1FF' }, { token: 'type', foreground: '4EC9B0' },
		{ token: 'constant', foreground: '569CD6' }, { token: 'key', foreground: '9CDCFE' }, { token: 'identifier', foreground: '9CDCFE' }, { token: 'string.escape', foreground: 'D7BA7D' },
	] });
}
