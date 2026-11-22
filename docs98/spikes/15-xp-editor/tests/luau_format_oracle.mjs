// Oracle for the Luau re-indenting formatter (app/luau.js formatLuau) over a corpus of .lua/.luau files (default: Luau's own tests/conformance):
// 1. only whitespace changes (the files without spaces, tabs and newlines are identical before and after);
// 2. formatting the result again changes nothing (stable);
// 3. long strings ([[ ]], [==[ ]==]) come out byte for byte (their lines are not re-indented).
// Usage: node tests/luau_format_oracle.mjs [dir...]
import fs from 'node:fs';
import path from 'node:path';
import { formatLuau } from '../app/luau.js';
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['/home/user/luau/src/tests/conformance'];
const files = []; const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) { walk(p); } else if (/\.(lua|luau)$/.test(n)) { files.push(p); } } }; dirs.forEach(walk);
const apply = (src, edits) => { const lines = src.split(/\r?\n/); for (const e of edits) { lines[e.line] = e.text; } return lines.join('\n'); };
const strip = (s) => s.replace(/[ \t\r\n]+/g, '');
const longStrings = (s) => s.match(/\[(=*)\[[\s\S]*?\]\1\]/g) || [];
let bad = 0, changedLines = 0, totalLines = 0, ms = 0;
for (const f of files) {
	const src = fs.readFileSync(f, 'utf8'); totalLines += src.split('\n').length;
	const t = performance.now(); const e1 = formatLuau(src, { indent: process.env.INDENT === 'spaces' ? '    ' : '\t' }); ms += performance.now() - t; changedLines += e1.length;
	const once = apply(src, e1); const twice = apply(once, formatLuau(once, { indent: process.env.INDENT === 'spaces' ? '    ' : '\t' }));
	const problems = [];
	if (strip(once) !== strip(src)) { problems.push('non-whitespace changed'); }
	if (twice !== once) { problems.push('not stable'); }
	const a = longStrings(src).filter(x => !x.startsWith('[[]]')), b = longStrings(once);
	if (a.length && JSON.stringify(a) !== JSON.stringify(b.slice(0, a.length)) && !a.every(x => b.includes(x))) { problems.push('long string changed'); }
	if (problems.length) { bad++; if (bad <= 10) { console.log(`${path.basename(f)}: ${problems.join(', ')}`); } }
}
console.log(`${files.length} files, ${totalLines} lines: ${changedLines} lines re-indented, ${Math.round(ms)} ms; files with a problem: ${bad}`);
process.exit(bad ? 1 : 0);
