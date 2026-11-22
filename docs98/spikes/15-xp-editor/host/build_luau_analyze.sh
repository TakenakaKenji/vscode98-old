#!/usr/bin/env bash
# Builds luau-analyze (Luau's type checker and linter, https://github.com/luau-lang/luau, MIT) with patch_luau_analyze.py: for Windows XP and later (mingw-w64, i586 without SSE,
# _WIN32_WINNT 0x0601 headers with the Vista calls of libstdc++ redirected to 11-windows-host/host/xp98_compat.c through xp98_imp.c) and for Linux (the headless tests).
# Usage: bash build_luau_analyze.sh <outDir>   (LUAU=<luau checkout, default /home/user/luau/src, commit 3d91c9d = release 748>)
set -euo pipefail
OUT=$(mkdir -p "${1:?outDir}" && cd "$1" && pwd); HERE=$(cd "$(dirname "$0")" && pwd); XP="$HERE/../../11-windows-host/host"; LUAU=${LUAU:-/home/user/luau/src}
python3 "$HERE/patch_luau_analyze.py" "$LUAU/CLI/src/Analyze.cpp"
F="-march=i586 -mno-sse -mno-sse2 -mno-mmx -mfpmath=387 -D_WIN32_WINNT=0x0601 -DWINVER=0x0601"
B="$OUT/build"; mkdir -p "$B"
for f in xp98_compat xp98_imp; do i686-w64-mingw32-gcc $F -O2 -c "$XP/$f.c" -o "$B/$f.o"; done
cat > "$B/mingw.cmake" <<EOT
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR i686)
set(CMAKE_C_COMPILER i686-w64-mingw32-gcc)
set(CMAKE_CXX_COMPILER i686-w64-mingw32-g++)
set(CMAKE_C_FLAGS_INIT "$F")
set(CMAKE_CXX_FLAGS_INIT "$F")
set(CMAKE_EXE_LINKER_FLAGS_INIT "-static -static-libgcc -static-libstdc++ $B/xp98_compat.o $B/xp98_imp.o")
EOT
cmake -S "$LUAU" -B "$B/xp" -DCMAKE_TOOLCHAIN_FILE="$B/mingw.cmake" -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF >/dev/null
cmake --build "$B/xp" --target Luau.Analyze.CLI -j4 >/dev/null
i686-w64-mingw32-strip -o "$OUT/luau-analyze.exe" "$B/xp/luau-analyze.exe"
cmake -S "$LUAU" -B "$B/linux" -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF >/dev/null
cmake --build "$B/linux" --target Luau.Analyze.CLI -j4 >/dev/null
cp "$B/linux/luau-analyze" "$OUT/luau-analyze"
echo "luau-analyze: $OUT (exe $(du -h "$OUT/luau-analyze.exe" | cut -f1))"
