# Manual Toggle Review

Date: 2026-10-07
Author: Codex
Reviewer: Existing Model Coordination owner, chat 01a0f717-06e5-7e42-8044-999b8dff35b2
Scope: Public manual toggle during ordinary automation pause and deferred policy. Source acceptance only; no native deployment acceptance.

The first diff preserved queue, pause, pending/debug/restricted/compatibility/protection guards but bypassed the archive guard in the manual deferred branch. The reviewer reproduced installed/archive overlap loading an archived plugin; the new causal case failed before repair. The repaired guard rejects before any scheduler cancellation, pending journal or host call. It does not automatically restore archived content.

The reviewer closed the delta as PASS, matching runtime SHA efc22cd3c7c8a0d04f4dd1dafad89fef7f90c42074aacd315e94bf5204bb5ce4 and checker SHA f3fea58b2e8e359cc8a8699b966eab006e9274c08fa0e699f4c2a106c76717c8. Ten causal behavior checks and 35 existing runtime tests pass. The reviewer read those results and the exact source rather than repeating the suites.

The new scoped writer exception permits this existing chat to type the confirmed current human task without another CLI/model job. Its inference is real; effective model billing/account totals are not exposed here. It is not reported as CPU-only or zero consumption. The prior readonly job remains FAIL/TIMEOUT with no deliverable; that is separate from this source acceptance.
