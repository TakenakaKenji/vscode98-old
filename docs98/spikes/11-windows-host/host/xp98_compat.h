/* Windows XP stand-ins for the Vista synchronisation calls QuickJS-ng uses (cutils.h: js_once, js_cond_*: Atomics.wait, workers, os.exec's one-time set-up). Force-included
 * (gcc -include) into every source of the XP build (build_win.sh, WINVER < 0x0600): the calls are renamed to the xp98_ versions in xp98_compat.c, so the executable does not import
 * InitOnceExecuteOnce, InitializeConditionVariable, SleepConditionVariableCS, WakeConditionVariable or WakeAllConditionVariable, which XP's kernel32 lacks (it would refuse to start). */
#ifndef XP98_COMPAT_H
#define XP98_COMPAT_H
#include <windows.h>
BOOL WINAPI xp98_InitOnceExecuteOnce(PINIT_ONCE once, PINIT_ONCE_FN fn, PVOID param, LPVOID *context);
VOID WINAPI xp98_InitializeConditionVariable(PCONDITION_VARIABLE cv);
BOOL WINAPI xp98_SleepConditionVariableCS(PCONDITION_VARIABLE cv, PCRITICAL_SECTION cs, DWORD ms);
VOID WINAPI xp98_WakeConditionVariable(PCONDITION_VARIABLE cv);
VOID WINAPI xp98_WakeAllConditionVariable(PCONDITION_VARIABLE cv);
#ifndef XP98_COMPAT_IMPL
#define InitOnceExecuteOnce xp98_InitOnceExecuteOnce
#define InitializeConditionVariable xp98_InitializeConditionVariable
#define SleepConditionVariableCS xp98_SleepConditionVariableCS
#define WakeConditionVariable xp98_WakeConditionVariable
#define WakeAllConditionVariable xp98_WakeAllConditionVariable
#endif
#endif
