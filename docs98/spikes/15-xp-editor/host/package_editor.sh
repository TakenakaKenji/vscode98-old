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
echo "editor98 package: $OUT ($(du -sh "$OUT" | cut -f1))"
