/* The XP stand-ins declared in xp98_compat.h.
 * - One-time initialisation: the INIT_ONCE word is 0 (not run), 1 (running), 2 (done); whoever moves it from 0 to 1 runs the callback, the others wait for 2.
 * - Condition variable: a semaphore and a count of waiters, behind a critical section of its own (the classic emulation; spurious wake-ups are possible, which every caller of a
 *   condition variable must handle anyway). The CONDITION_VARIABLE word points at it; allocated by InitializeConditionVariable, or on first use for a statically initialised one. */
#define XP98_COMPAT_IMPL
#include "xp98_compat.h"
#include <stdlib.h>

BOOL WINAPI xp98_InitOnceExecuteOnce(PINIT_ONCE once, PINIT_ONCE_FN fn, PVOID param, LPVOID *context) {
	volatile LONG *st = (volatile LONG *)&once->Ptr;
	for (;;) {
		LONG v = InterlockedCompareExchange(st, 1, 0);
		if (v == 0) { BOOL ok = fn(once, param, context); InterlockedExchange(st, ok ? 2 : 0); return ok; }
		if (v == 2) { return TRUE; }
		Sleep(0);
	}
}

typedef struct { CRITICAL_SECTION lock; HANDLE sema; LONG waiters; } XpCond;
static XpCond *cond_of(PCONDITION_VARIABLE cv) {
	XpCond *c = (XpCond *)cv->Ptr; if (c) { return c; }
	XpCond *n = (XpCond *)calloc(1, sizeof *n); InitializeCriticalSection(&n->lock); n->sema = CreateSemaphoreW(NULL, 0, 0x7fffffff, NULL);
	if (InterlockedCompareExchangePointer(&cv->Ptr, n, NULL) != NULL) { DeleteCriticalSection(&n->lock); CloseHandle(n->sema); free(n); }   /* another thread was first */
	return (XpCond *)cv->Ptr;
}
VOID WINAPI xp98_InitializeConditionVariable(PCONDITION_VARIABLE cv) { cv->Ptr = NULL; cond_of(cv); }
BOOL WINAPI xp98_SleepConditionVariableCS(PCONDITION_VARIABLE cv, PCRITICAL_SECTION cs, DWORD ms) {
	XpCond *c = cond_of(cv);
	EnterCriticalSection(&c->lock); c->waiters++; LeaveCriticalSection(&c->lock);
	LeaveCriticalSection(cs);
	DWORD r = WaitForSingleObject(c->sema, ms);
	if (r != WAIT_OBJECT_0) {   /* timed out: take ourselves off the count, or, if a wake already counted us, consume the token it released */
		EnterCriticalSection(&c->lock); if (c->waiters > 0) { c->waiters--; } else { WaitForSingleObject(c->sema, 0); } LeaveCriticalSection(&c->lock);
	}
	EnterCriticalSection(cs);
	if (r != WAIT_OBJECT_0) { SetLastError(ERROR_TIMEOUT); return FALSE; }
	return TRUE;
}
VOID WINAPI xp98_WakeConditionVariable(PCONDITION_VARIABLE cv) {
	XpCond *c = cond_of(cv); EnterCriticalSection(&c->lock); if (c->waiters > 0) { c->waiters--; ReleaseSemaphore(c->sema, 1, NULL); } LeaveCriticalSection(&c->lock);
}
VOID WINAPI xp98_WakeAllConditionVariable(PCONDITION_VARIABLE cv) {
	XpCond *c = cond_of(cv); EnterCriticalSection(&c->lock); LONG n = c->waiters; c->waiters = 0; if (n > 0) { ReleaseSemaphore(c->sema, n, NULL); } LeaveCriticalSection(&c->lock);
}

/* GetThreadId (Server 2003 / Vista; libstdc++'s std::thread ids): the thread's id from NtQueryInformationThread (ThreadBasicInformation), which XP's ntdll has */
typedef struct { LONG ExitStatus; PVOID TebBaseAddress; struct { HANDLE UniqueProcess, UniqueThread; } ClientId; ULONG_PTR AffinityMask; LONG Priority, BasePriority; } Xp98ThreadInfo;
typedef LONG (WINAPI *Xp98NtQIT)(HANDLE, int, PVOID, ULONG, PULONG);
DWORD WINAPI xp98_GetThreadId(HANDLE thread) {
	if (thread == GetCurrentThread()) { return GetCurrentThreadId(); }
	static Xp98NtQIT q; if (!q) { q = (Xp98NtQIT)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationThread"); if (!q) { return 0; } }
	Xp98ThreadInfo info; if (q(thread, 0, &info, sizeof info, NULL) != 0) { SetLastError(ERROR_INVALID_HANDLE); return 0; }
	return (DWORD)(ULONG_PTR)info.ClientId.UniqueThread;
}
