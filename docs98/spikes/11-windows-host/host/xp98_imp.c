/* For code already compiled against Vista's kernel32 (static libraries such as libstdc++'s condition variables, built with the gthr-win32 of _WIN32_WINNT 0x0600): the import pointers
 * those objects call through (__imp__Name@N) defined here, pointing at the stand-ins of xp98_compat.c. An object that defines them is linked before the import libraries are searched, so
 * the executable does not import the Vista functions and XP's loader accepts it. Link xp98_compat.c and this file into such a program. */
#define XP98_COMPAT_IMPL
#include "xp98_compat.h"
#define XP98_IMP(name, bytes, fn) void *xp98_imp_##name __asm__("__imp__" #name "@" #bytes) = (void *)(fn)
XP98_IMP(InitializeConditionVariable, 4, xp98_InitializeConditionVariable);
XP98_IMP(SleepConditionVariableCS, 12, xp98_SleepConditionVariableCS);
XP98_IMP(WakeConditionVariable, 4, xp98_WakeConditionVariable);
XP98_IMP(WakeAllConditionVariable, 4, xp98_WakeAllConditionVariable);
XP98_IMP(InitOnceExecuteOnce, 16, xp98_InitOnceExecuteOnce);
XP98_IMP(GetThreadId, 4, xp98_GetThreadId);
