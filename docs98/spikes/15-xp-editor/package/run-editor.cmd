@echo off
rem editor98: a code editor for Windows XP and later (Monaco on the vscode98 engine). Usage: run-editor.cmd [folder] [file...]   (default folder: sample)
rem Log: results\editor.txt. Settings: userdata\settings.json (fontSize, tabSize, insertSpaces, formatOnSave).
setlocal
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "JF=%HERE:\=/%/js"
set "DIR=%~1"
if "%DIR%"=="" set "DIR=%HERE%\sample"
if not exist "%HERE%\results" mkdir "%HERE%\results"
if not exist "%HERE%\userdata" mkdir "%HERE%\userdata"
"%HERE%\editor98.exe" --stack-size 0 "%JF%/docs98/spikes/05-child-process/host/fork_main.mjs" "%JF%/s11" "%JF%/docs98/spikes/15-xp-editor/host/editor98.mjs" "%DIR%" %2 %3 %4 --monaco "%HERE%\monaco" --font-dir "%HERE%\fonts" --user-data-dir "%HERE%\userdata" > "%HERE%\results\editor.txt" 2>&1
endlocal
