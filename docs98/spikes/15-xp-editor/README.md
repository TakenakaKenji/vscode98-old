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

## The editor: `host/editor98.mjs` + `app/shell.js`

One process: our DOM/CSS engine, Monaco, and a shell of ~200 lines (`app/shell.js`, `app/shell.css`, VS Code's dark colours):
- **Explorer**: the folder given on the command line, read lazily (a directory is listed when it is opened; `.git`, `node_modules` skipped), sorted folders first.
- **Tabs**: one Monaco model per file, the view state (cursor, scroll, folding) kept per tab; a dot on changed tabs, middle click closes. The language comes from the file name through what Monaco registered (`.luau` is Lua for now).
- **Status bar**: line and column, indentation, encoding, line ends, language, messages.
- **Keys**: Ctrl+S save, Ctrl+W close, Ctrl+P quick open (every file of the folder, the characters of the query in order, matches in blue), Ctrl+B explorer, Ctrl+Tab next tab; Monaco's own (F1 command palette, Ctrl+F find, Ctrl+H replace, Shift+Alt+F format, Ctrl+/ comment, multi-cursor ...).
- **Settings**: `userdata/settings.json` (`fontSize`, `tabSize`, `insertSpaces`, `formatOnSave`).
- Closing a changed tab saves it (there are no dialogs yet).

**Language workers on threads.** Monaco runs the language services of JSON, CSS/SCSS/Less, HTML and TypeScript/JavaScript (validation, formatting, completion, hover) in web workers. `build_monaco.mjs` bundles each worker as an ES module with `worker_prelude.js` in front (self, postMessage/onmessage against `os.Worker.parent`, timers, navigator), and `editor98.mjs` gives Monaco a `Worker` (`QjsWorker`) that is a QuickJS `os.Worker`: a real thread with its own runtime, so a slow TypeScript check does not freeze typing. On Windows our event loop's hooks (pipes, child processes, the window: `winhook.h`, `patch_libc.py`) now belong to the thread that registered them; a worker thread runs the stock loop.

Headless test (`tests/smoke.mjs`, sandbox): ready in 0.6 s (Monaco loaded at 0.4 s); open a folder in the explorer 32 ms, open a file 90 to 150 ms; typing about 50 ms a key in this test (it waits for the page to settle after each key, the proto's 20 ms is the cost itself); save 40 ms (the file on disk changed); quick open 60 ms; open `package.json` from it 65 ms; format JSON through the worker 340 ms (first use, the worker starts).

![editor98](editor98-shell.png)

## Windows XP

- **The host loads on XP** (statically checked): `build_win.sh` with `WINVER=0x0501` force-includes `xp98_compat.h`, which renames QuickJS's Vista calls (`InitOnceExecuteOnce`, condition variables) to stand-ins in `xp98_compat.c` (a one-time flag; a semaphore-and-counter condition variable); `strtok_s` (not in XP's msvcrt) replaced by a local tokenizer; `WM_MOUSEHWHEEL` defined. The executable imports 231 functions, all present in XP SP3's kernel32, user32, gdi32, psapi, shell32, winmm and msvcrt; PE subsystem version 4.0; job objects and DPI awareness are looked up at run time. Not yet run on an XP machine.
- **Package**: `host/package_editor.sh` → `editor98.exe` (2.3 MB, i586 without SSE), `js/` (6 MB), `monaco/` (28 MB: the editor 10.5 MB, the TypeScript worker 13 MB, the others 0.6 to 1.9 MB), `fonts/` (Inter, DejaVu Sans and Sans Mono, 4 MB), `sample/`, `run-editor.cmd`: 40 MB, a 9 MB zip (the VS Code package was 322 MB).
- **Wine is not usable in this sandbox any more** (the cloud container was replaced on 2026-11-22: `wineserver` aborts with `sock_init: shutdown() causes EOF` and `free(): invalid pointer`, for `cmd /c echo` too, 32 and 64 bit). Windows runs happen on the owner's machines until that changes.
