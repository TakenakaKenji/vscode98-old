# Spike 15 — a light code editor for Windows XP (Monaco on our engine)

**Direction (owner, 2026-11-22):** go straight to an XP build that runs well on a low-spec machine (Pentium 4 / Athlon XP, 512 MB or more). Not the whole of VS Code: a code editor with
the major languages, file tree and tabs, linting and formatting. Lua/Luau first (the owner writes Roblox code). No VS Code extension API needed: the Claude integration will be the owner's own.

**Chosen design:** Monaco (VS Code's own editor component, the `monaco-editor` npm package) on our engine (06/07: DOM, CSS, layout, style and rasterizer in C; QuickJS-ng host; Win32 window)
with a small shell of our own (file tree, tabs, status bar, quick open, search) instead of the workbench, one window process, tools started when needed.

## Monaco alone on our engine (`host/proto.mjs`)

`host/build_monaco.mjs` bundles `monaco-editor` 0.57.0 (`esm/vs/editor/editor.main.js`: all editor features, the Monarch highlighters of ~80 languages, the language services of
TypeScript/JSON/CSS/HTML inlined) into one IIFE of 10.5 MB and 416 KB of CSS. `host/proto.mjs` loads it into the DOM, opens a 30-line Luau file, types 40 keys through the window's input
path (keydown, char, keyup into `input_driver.js`) and after each key does what the window does on its next tick (animation frames, layout pass, paint with the native rasterizer).

Sandbox (Linux, the same machine as the earlier control benchmarks), headless:

| | Monaco alone | full workbench (spike 14, laptop) |
|---|---|---|
| load: evaluate the bundle, create the editor, stable and painted | 0.75 s (evaluate 0.42 s, create 0.15 s) | 22 s until stable |
| memory (RSS of the one process) | 103 MB loaded, 123 MB after typing; JS heap 111 MB | ~800 MB in 6 to 11 processes, window 250 to 400 MB |
| keystroke, end to end | median 19.9 ms, 90th percentile 21 ms, slowest 32 ms, 1 layout pass per key | median 140 to 180 ms on the laptop |
| elements in the DOM | 358 | 450 to 1,100 |

![Monaco with Luau on our engine](proto-monaco-lua.png)

Found on the way: our painter clips the canvas by `overflow: hidden` on `html`/`body` when those boxes have no height (a browser propagates their overflow to the viewport): the page
came out empty until `html, body` got `height: 100%`. To be fixed in the engine.
