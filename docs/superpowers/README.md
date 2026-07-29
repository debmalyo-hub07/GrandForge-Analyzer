# Archival — audits and execution logs

The files in `audits/` and the `exec-*.log.md` files in this directory are a
historical record of the July 2026 upgrade: nine full-subsystem audits and the
execution logs of the phases that acted on them. Together they are ~330 KB.

**Do not read them for orientation.** Every finding that still matters was
either fixed in the code or written into `docs/arch/*.md`, which is far cheaper
to load. Open a file here only when:

- a code comment or reference doc cites it by path *and* section (e.g.
  `backend/positionCacheGuards.ts` cites `audits/backend-audit.md` §3), or
- the user asks for the audit itself.

`specs/` holds the approved design; `plans/` holds per-phase implementation
plans. Read the spec to know where the work stands; read a plan only when
resuming that phase.
