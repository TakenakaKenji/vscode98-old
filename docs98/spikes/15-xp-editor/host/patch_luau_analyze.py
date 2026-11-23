#!/usr/bin/env python3
"""Patches Luau's CLI/src/Analyze.cpp (luau-analyze) for editor98. Usage: patch_luau_analyze.py <Analyze.cpp>   (in place)
- --definitions=<file>: a Luau definition file (declare class ...; Roblox's API from luau-lsp's globalTypes.None.d.luau) loaded into the global scope, so Roblox types and globals check;
- --server: stay running; read one file path per line on stdin, check it again (it may have changed) and print its problems, then a line `@@END`. The definitions (700 KB) are parsed
  once instead of on every check, which matters on a Pentium 4."""
import sys
p = sys.argv[1]; s = open(p).read()
if '--definitions=' in s:
    sys.exit(0)
def rep(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)
rep('#include <fstream>\n', '#include <fstream>\n#include <iostream>\nLUAU_FASTINT(LuauTarjanChildLimit)\n#ifdef _WIN32\nextern "C" __declspec(dllimport) int __stdcall SetPriorityClass(void *, unsigned long);\nextern "C" __declspec(dllimport) void *__stdcall GetCurrentProcess(void);\n#endif\n')   # two kernel32 calls without windows.h (its macros clash with Luau's names)
rep('    bool annotate = false;\n    int threadCount = 0;\n', '    bool annotate = false;\n    int threadCount = 0;\n    std::string definitionsFile98;\n    bool server98 = false;\n')
rep('        else if (strcmp(argv[i], "--annotate") == 0)\n',
    '        else if (strncmp(argv[i], "--definitions=", 14) == 0)\n            definitionsFile98 = argv[i] + 14;\n        else if (strcmp(argv[i], "--server") == 0)\n            server98 = true;\n        else if (strcmp(argv[i], "--annotate") == 0)\n')
rep('    Luau::registerBuiltinGlobals(frontend, frontend.globals);\n    Luau::freeze(frontend.globals.globalTypes);\n',
    '''    Luau::registerBuiltinGlobals(frontend, frontend.globals);
    if (!definitionsFile98.empty())
    {
        std::optional<std::string> defs = readFile(definitionsFile98);
        if (!defs)
            fprintf(stderr, "Error opening %s\\n", definitionsFile98.c_str());
        else
        {
            if (FInt::LuauTarjanChildLimit > 0 && FInt::LuauTarjanChildLimit < 15000)   // as luau-lsp does: Roblox's definitions are too large for the default
                FInt::LuauTarjanChildLimit.value = 15000;
            Luau::LoadDefinitionFileResult r = frontend.loadDefinitionFile(frontend.globals, frontend.globals.globalScope, *defs, "@roblox", false, false);
            if (!r.success)
            {
                for (const auto& e : r.parseResult.errors)
                    fprintf(stderr, "%s:%d: definitions: %s\\n", definitionsFile98.c_str(), e.getLocation().begin.line + 1, e.getMessage().c_str());
                if (r.module)
                    for (const auto& e : r.module->errors)
                        fprintf(stderr, "%s:%d: definitions: %s\\n", definitionsFile98.c_str(), e.location.begin.line + 1, Luau::toString(e).c_str());
            }
        }
    }
    Luau::freeze(frontend.globals.globalTypes);

    if (server98)
    {
#ifdef _WIN32
        SetPriorityClass(GetCurrentProcess(), 0x00004000 /* BELOW_NORMAL_PRIORITY_CLASS */);   // the editor's window comes first on a single-core machine
#endif
        std::string line;
        while (std::getline(std::cin, line))
        {
            if (!line.empty() && line.back() == '\\r')
                line.pop_back();
            if (line.empty())
                continue;
            frontend.markDirty(line);
            try
            {
                frontend.check(line);
                reportModuleResult(frontend, line, format, false);
            }
            catch (const Luau::InternalCompilerError& ice)
            {
                printf("%s:1:1-1: (W0) InternalCompilerError: %s\\n", line.c_str(), ice.message.c_str());
            }
            printf("@@END\\n");
            fflush(stdout);
        }
        return 0;
    }
''')
open(p, 'w').write(s)
