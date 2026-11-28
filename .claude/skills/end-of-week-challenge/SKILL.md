---
name: end-of-week-challenge
description: >-
  Kick off the weekly End of week challenge: an autonomous build that spends whatever is
  left of the weekly Claude subscription before it resets, added as a new challenge to an
  End of week challenge repository (https://github.com/highsierralabs/End_of_week_challenge
  or a fork of it) and its GitHub Pages site. Use only when the operator runs
  /end-of-week-challenge.
argument-hint: "[optional notes: an idea, constraints, a different overrun %]"
user-invocable: true
disable-model-invocation: true
---

# End of week challenge

The operator is at the end of their weekly subscription and is handing you what is left of it.

**Your challenge: build something that would impress them, on your own, and ship it.**

Operator's notes for this run (may be empty; where they conflict with this file, they win):

$ARGUMENTS

## 0. Before anything else

- **Local notes.** If `~/.claude/end-of-week-challenge.local.md` exists, read it. It is the
  operator's own notes for their machine: where the repository and their other work are, where
  the usage figures can be read, the reset time, the hardware, what is off limits. Where it
  conflicts with this file it wins; the notes for this run win over both.
- **The repository.** Work in the End of week challenge repository: the path the local notes
  give, or else the git repository you were started in. It has `challenges.json`,
  `docs/CHALLENGES.md` and `tools/gate.mjs` at its root. If you cannot find one, stop and say
  so; this skill only runs in a clone of that repository or a fork of it.

## 1. Budget and deadline

- The deadline is the next weekly reset of the operator's Claude subscription. Read the 7-day
  usage percentage and the time to the reset from wherever the local notes say they are kept
  (a statusline cache, a usage log). With no such source, ask the operator to run `/usage` and
  tell you both figures; that question does not count as one of the seven below.
- Spend what is left of this week. If you have not finished at the reset, you may go on into
  the new week until it shows **5%** used, and then you stop, finished or not.
- Sanity check before anything else: if the reset is more than two days away, or more than
  about half of the week is still unspent, this is probably not an end-of-week run. Tell the
  operator what you see and ask what share to spend. That does not count as one of the seven
  questions below either.
- Size the project to the budget you actually have, and check usage at every unit boundary
  (if you have no source you can read during the run, size it conservatively and keep to the
  reset time). Hold back roughly the last tenth of the budget for the release steps in
  section 6. A smaller build that is finished, verified and live beats a larger one that is
  not.
- Note the start time and the usage figures before the first question. The README's build cost
  (section 6) and the closeout report start from them.

## 2. The seven questions

You ask the operator **four initial questions, then three follow-up questions**, with
AskUserQuestion, before you start building: two calls, the first carrying four questions and
the second three. Come with your own proposals rather than open questions. After the seventh
answer you work without approval and without check-ins until the build is live or the budget
is gone.

**Round one (four questions).** One of them picks the build. Before you write it, look at the
operator's work (their other projects, as their local notes, CLAUDE.md files and memory
describe them, and the earlier challenges in this repository) so the suggestions are grounded
in it. Give exactly four options, in this order:

1. **Close to their work**: a build that grows directly out of one of their projects or
   interests.
2. **Tangential**: a build that borrows something from their work (a technique, a subject,
   a kind of data) and takes it somewhere new.
3. **Outside their usual work**: a build from a field they do not normally touch.
4. **Surprise me**: you choose.

Each of the first three names its build in the label and says in the description what a
visitor would do with it. All three must still be different in kind from the earlier
challenges (section 3). If the operator picks **Surprise me**, choose a new build that is none
of the three you proposed and not a variant of any of them, and keep it a surprise: do not
name it in the follow-up questions, and spend those on things that do not give it away. If
the operator types their own answer instead, that is the build.

Spend the other three round-one questions on what would most change the build: its ambition
and size, anything of theirs you would like to use, the look, the platform (phone, desktop,
GPU).

**Round two (three questions).** Follow-ups on the chosen direction: the decisions the first
answers opened up that you cannot settle from sensible defaults.

## 3. Where the work goes

- Your project lives in a new top-level folder of the repository: `<YourProjectName>/`.
- Before choosing a project, read in the repository: `README.md`, `challenges.json`,
  `docs/CHALLENGES.md` (the contract a challenge folder must meet), `docs/GOVERNANCE.md`
  (the commit and release rules) and the README of each earlier challenge. Build something
  different in kind from what is already there.
- The result must be shareable from the repository's GitHub Pages site: it ends up at
  `https://<owner>.github.io/<repository>/<slug>/` (read the owner and name from
  `git remote get-url origin`), as a static site that works from a subfolder.
- Leave the other challenges' folders alone. The shared files you do touch are few:
  `challenges.json`, the root `README.md` list, `THIRD-PARTY-NOTICES.md`, the ledger.

## 4. Repository rules

`docs/GOVERNANCE.md` is the authority. The parts that are easy to get wrong:

- Commit regularly, one commit per deliverable unit, subject
  `EOWC-<CHG|FIX|DOC|REL>-<YYYYMMDD>-<SEQ>: <summary>`, ASCII only, 72 characters or fewer.
  Run `git config core.hooksPath tools/githooks` if it is not already set. Add each id to
  `docs/changes/LEDGER.md`.
- **Commits in this repository carry the Claude attribution trailers**
  (`Co-Authored-By: Claude ...` and `Claude-Session: ...`; GOVERNANCE.md rule 4). For this
  repository only, that overrides any global no-attribution rule the operator has, unless their
  local notes say otherwise.
- Use the git identity already configured for the repository and do not change it. If none is
  set (`git config user.email` is empty), stop and say so.
- Never amend, rebase or force-push a pushed commit.

## 5. How you work

- No approval is needed after the seven questions. Install tools you need if they are missing.
- The machine is yours for the run, within the limits the operator sets. Find out what it
  has: the GPU (and check that it is actually free before you rely on it; another process may
  be holding the VRAM), and any MCP servers that could help, such as Blender. If something the
  build depends on is not available, say so in your first question.
- Anything the operator's instructions (CLAUDE.md files, memory, the local notes) mark as off
  limits stays off limits. Nothing outside the challenge repository is changed by this run,
  apart from installing tools.
- Test what you build the way a visitor would meet it: in a real browser, on the production
  build, served from a subfolder. Report only what you checked.
- Everything you commit will be public. No user-home paths, host names, private network
  addresses, device serials or credentials in tracked files; the gate scans for them.

## 6. Release

Commit locally as you go, and **do not push until the challenge is finished**: a push to `main`
rebuilds and redeploys the whole public site.

When it is finished, follow "Releasing" in `docs/CHALLENGES.md`: README ending with its build
cost (below), third-party notices,
manifest entry with a card image and the README's lead GIF as its `clip` (a 16:9 crop of it
if it is another shape; see the `clip` row in `docs/CHALLENGES.md`), `node tools/gate.mjs`
passing, the gate tuple in the last commit's body, an annotated tag `<slug>-v1.0.0`, then
`git push --follow-tags`. Running this skill is the operator's standing approval for that one
push. Watch the Pages run, then open the index page and your challenge on the live site and
confirm both work.

**Build cost.** The README ends with a `## Build cost` section: what the run took, from Claude
Code's own records. `Lightbox/README.md` and `Wheelwork/README.md` show the form. Write it last,
just before the release commit, so it ships with the README. Its figures stop when you write it:
say when that was and which release steps were still to come.

- Sum the main session's transcript and every subagent's, counting each API response once.
  `node Lightbox/scripts/build-cost.mjs <session transcript .jsonl> [<usage log>] --until <ISO time>`
  does it. Transcripts are under `~/.claude/projects/<project>/`, named by session id, with the
  subagents' in `<session id>/subagents/`. It reads only counts and timestamps. Run it
  where it is rather than copying it into your folder. If it is missing (a fork without Lightbox),
  sum the transcripts the same way yourself.
- First table: start date and time, elapsed wall clock, model time summed over the agents, the
  model or models with their ids, API responses, output tokens, input tokens (uncached / written to
  cache / read from cache), the cost at API prices as Claude Code metered it, and the weekly meter
  at the start and when you wrote the section. Take the metered cost from the source the local
  notes name. If there is none, write "not metered" and do not price the tokens yourself.
- Second table, one row per agent, each subagent named by what it did: API responses, output,
  cache writes, cache reads, first to last response.
- Then "How to read these" notes, at least these: the dollar figure is an estimate on a
  subscription, not a bill; the weekly meter is the account's, so it is an upper bound if other
  sessions ran; and anything left out is named as not counted: work by another model or service
  (such as a Codex review), the machine's own work (GPU renders, test runs, Blender), and the
  Pages deploy.
- Numbers and times only. No session ids, transcript paths or transcript text in the README.

Two cases where you hold the push and ask instead:

- the build ships any of the operator's own data or files (anything from another project of
  theirs). Build and commit it, then have them review the selection first;
- the gate does not pass, or you stopped at the budget limit with the build unfinished. Leave
  everything committed locally and unpushed, with no manifest entry.

## 7. Closeout

End with a short report: what you built and why you chose it, the live URL, what you verified
and how, what is unfinished or uncertain, the usage figures at start and finish, and the build cost's
headline figures. If the
operator keeps a memory note for this series, update it with the new build's name, tag and
date.
