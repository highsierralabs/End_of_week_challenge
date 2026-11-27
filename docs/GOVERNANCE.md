# Repository governance

This repository follows the shared-layer rules of RHACO-SOP-20260708-001 v4
(Git Repository Governance) and its Amendment A1 (gate-then-amend-before-push),
adapted for a small public software project. RHACO-specific machinery (catalog
cards, librarians, CHG routing) is not used.

## Rules

1. **Branch.** Work commits directly on `main`. No force-push; `main` is never rewritten
   once pushed.
2. **Commit unit.** One commit per deliverable unit (a module, a feature, a fix set),
   each under its own change id.
3. **Message grammar.** Line 1 is `EOWC-<TYPE>-<YYYYMMDD>-<SEQ>: <imperative summary>`,
   72 characters or fewer, TYPE one of CHG (change), FIX, DOC, REL (release). Line 2 is
   blank. The whole message is printable ASCII plus LF: no em dashes, curly quotes or
   ellipsis characters. Enforced by `tools/githooks/commit-msg`
   (`git config core.hooksPath tools/githooks`).
4. **Attribution.** At the owner's direction, commits in this repository carry
   `Co-Authored-By: Claude ...` and `Claude-Session: ...` trailers.
5. **No automated commits.** No script, hook or scheduled task stages files or creates
   commits. Hooks validate only.
6. **Tags.** Annotated tags only, forward-only, pushed with `--follow-tags`
   (`cascade-vX.Y.Z` for releases).
7. **History immutability.** Never amend, rebase or force-push a pushed commit; correct
   forward with a new commit or `git revert`. Local amend of an unpushed commit is
   allowed.
8. **Gate before push.** `node tools/gate.mjs` gives one verdict over: the project check
   (typecheck, lint, unit tests), the production build, the commit-message audit, a
   public-safety scan (no user-home paths, host names, device serials, MAC addresses or
   credentials in tracked files), and a clean working tree.
9. **Gate-then-amend (SOP Amendment A1).** The last commit before a push is gated over
   the committed tree, then amended (body only, while still unpushed) to carry the gate's
   own tuple line verbatim, then pushed.
10. **Ledger.** Every change id is listed in `docs/changes/LEDGER.md` with its summary.
