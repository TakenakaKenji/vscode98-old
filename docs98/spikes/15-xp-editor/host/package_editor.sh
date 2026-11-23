#!/usr/bin/env bash
# Builds the editor98 package for Windows XP and later: the host built for XP (WINVER 0x0501, build_win.sh), the JavaScript (package_win.sh's layout plus spike 15), the Monaco
# bundle and its workers (build_monaco.mjs), the fonts the editor uses, a sample folder and run-editor.cmd.
# Usage (repo root): bash docs98/spikes/15-xp-editor/host/package_editor.sh <outDir>
set -euo pipefail
OUT=$(mkdir -p "${1:?outDir}" && cd "$1" && pwd); S=docs98/spikes
WINVER=0x0501 USE_MI=0 bash "$S/11-windows-host/host/package_win.sh" "$OUT" x86 >/dev/null
mv "$OUT/qjs-win-x86.exe" "$OUT/editor98.exe"; rm -f "$OUT"/*.cmd
for d in 15-xp-editor/host 15-xp-editor/app; do mkdir -p "$OUT/js/$S/$d"; cp -r "$S/$d/." "$OUT/js/$S/$d/"; done
node "$S/15-xp-editor/host/build_monaco.mjs" "$OUT/monaco" >/dev/null
# fonts: the renderer's font table names /usr/share/fonts/...; the same subpaths under fonts/ (--font-dir)
mkdir -p "$OUT/fonts/opentype/inter" "$OUT/fonts/truetype/dejavu" "$OUT/fonts/LICENSES"
cp /usr/share/fonts/opentype/inter/Inter-Regular.otf /usr/share/fonts/opentype/inter/Inter-Bold.otf /usr/share/fonts/opentype/inter/Inter-Italic.otf "$OUT/fonts/opentype/inter/" 2>/dev/null || cp /usr/share/fonts/opentype/inter/Inter-*.otf "$OUT/fonts/opentype/inter/"
cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf /usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf "$OUT/fonts/truetype/dejavu/"
for d in fonts-inter fonts-dejavu-core; do [ -f /usr/share/doc/$d/copyright ] && cp /usr/share/doc/$d/copyright "$OUT/fonts/LICENSES/$d.txt"; done
rm -rf "$OUT/sample"; cp -r "$S/15-xp-editor/sample" "$OUT/sample"
sed 's/\r$//; s/$/\r/' "$S/15-xp-editor/package/run-editor.cmd" > "$OUT/run-editor.cmd"
cp node_modules/monaco-editor/LICENSE "$OUT/monaco/LICENSE.txt"
# Luau linting: luau-analyze built by build_luau_analyze.sh (LUAU_OUT) and Roblox's API definitions from luau-lsp (LUAU_DEFS: globalTypes.None.d.luau)
LUAU_OUT=${LUAU_OUT:-/home/user/luau/out}; LUAU_DEFS=${LUAU_DEFS:-/home/user/luau/lsp/repo/scripts/globalTypes.None.d.luau}
mkdir -p "$OUT/tools"; cp "$LUAU_OUT/luau-analyze.exe" "$OUT/tools/"; cp "$LUAU_DEFS" "$OUT/tools/roblox.d.luau"
cp "${LUAU:-/home/user/luau/src}/LICENSE.txt" "$OUT/tools/LICENSE-luau.txt"; cp "$(dirname "$LUAU_DEFS")/../LICENSE.md" "$OUT/tools/LICENSE-luau-lsp.txt" 2>/dev/null || cp "$(dirname "$LUAU_DEFS")/../LICENSE" "$OUT/tools/LICENSE-luau-lsp.txt"
# the bytecode of monaco.mjs (05-child-process/host/esm.c), made by one headless start of the package's own tree with the Linux host (LINUX_QJS): the first start on Windows
# reads it instead of compiling 10 MB (module paths are rewritten on load; a cache it cannot read is compiled again and replaced, so a mismatch only costs that one start)
LINUX_QJS=${LINUX_QJS:-/tmp/claude-0/s7new/qjs-spike7}
if [ -x "$LINUX_QJS" ]; then
	T=$(mktemp -d); J="$OUT/js"
	timeout 300 "$LINUX_QJS" --stack-size 0 "$J/$S/05-child-process/host/fork_main.mjs" "$J/s11" "$J/$S/15-xp-editor/host/editor98.mjs" "$OUT/sample" --monaco "$OUT/monaco" --font-dir "$OUT/fonts" --tools "$T/none" --user-data-dir "$T/ud" --headless 1 >"$T/log.txt" 2>&1 || true
	if ls "$T/ud/code-cache/"*.qbc >/dev/null 2>&1; then mkdir -p "$OUT/userdata"; rm -rf "$OUT/userdata/code-cache"; cp -r "$T/ud/code-cache" "$OUT/userdata/code-cache"; echo "code cache: $(du -sh "$OUT/userdata/code-cache" | cut -f1)"; else echo "code cache: not made"; tail -3 "$T/log.txt"; fi
	rm -rf "$T"
fi
echo "editor98 package: $OUT ($(du -sh "$OUT" | cut -f1))"
