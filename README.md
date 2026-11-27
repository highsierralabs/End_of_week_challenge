# End of week challenge

A Claude Code skill and the series of builds it runs. Once a week, whatever is left of the week's Claude subscription
before it resets goes into one build: Claude picks the project, asks seven questions, then designs, builds and ships it
without further direction. The skill that runs it is in this repository, so you can run the same series on your own
subscription.

**All builds:** https://highsierralabs.github.io/End_of_week_challenge/

## The skill

[`.claude/skills/end-of-week-challenge/SKILL.md`](.claude/skills/end-of-week-challenge/SKILL.md) is the whole brief.
Run as `/end-of-week-challenge`, Claude:

1. **Reads the budget**: the week's usage and the time to the reset. If more than half the week is left, it asks before
   spending it. It sizes the build to what is left and keeps the last tenth for the release.
2. **Asks seven questions**, in two rounds. Round one offers three builds grounded in your own work (one close to it,
   one tangential, one from outside it) and *Surprise me*, which picks a fourth it keeps secret until it ships, plus
   questions on ambition, your material and the look. Round two has three follow-ups on the chosen direction.
3. **Builds on its own**: no check-ins, one commit per unit of work, tested in a real browser on the production build
   served from a subfolder.
4. **Ships**: a README with a lead GIF, third-party notices, a manifest entry with a card picture and clip, the gate,
   a release tag and one push, which redeploys the site. Then it opens the live pages to confirm they work.
5. **Reports** what it built and why, what it verified, what is unfinished and the usage at start and finish.

It holds the push and asks instead when the build ships your own data or files, when the gate fails, or when it ran out
of budget before finishing.

## Run your own

You need Claude Code on a Pro or Max subscription, Node 24, git and a GitHub account. A GPU helps: most builds use one,
and the gate's smoke tests run each build in GPU Chromium (`node tools/gate.mjs --no-smoke` skips them).

1. **Fork this repository** and clone your fork. In the fork's Settings, under Pages, set the source to *GitHub
   Actions*. The site deploys only from a public repository.
2. **Make it yours.**
   - In `challenges.json`, set `owner` to your name: it heads the index page. Keep the existing builds, or delete their
     folders, entries, lines in this README and notices in `THIRD-PARTY-NOTICES.md` to start your own series at No. 1.
   - Add your own account name, host names and device serials to the public-safety patterns in `tools/gate.mjs`, so a
     run cannot publish them.
   - Set a repo-local git identity (`git config user.name`, `git config user.email`; a GitHub no-reply address keeps
     your email out of a public history) and `git config core.hooksPath tools/githooks`.
3. **Optionally, leave notes for the run** in `~/.claude/end-of-week-challenge.local.md`: where your other projects are
   (round one's suggestions come from them), where your weekly usage figures can be read (without them the skill asks
   you to run `/usage`), your hardware, and anything on the machine that is off limits. The skill reads the file first,
   and it wins over the skill where they differ.
4. **Near the end of your week**, start Claude Code in your clone and run `/end-of-week-challenge`. Anything you type
   after the command (an idea, a constraint, a different overrun) wins over the skill for that run.

The skill is a project skill, so it is there whenever Claude Code starts in the clone. To run it from anywhere, copy
`.claude/skills/end-of-week-challenge/` into `~/.claude/skills/` and give the clone's path in your notes.

Before the first run, know that:

- **it publishes.** Running the skill is your approval for one push to `main` at the end of a finished run, and that push
  makes the source and the site public;
- **Claude Code's permission prompts still apply.** The skill asks no questions after the seventh, but your permission
  mode decides which commands stop for your approval;
- **commits carry Claude attribution trailers**, by rule 4 of [docs/GOVERNANCE.md](docs/GOVERNANCE.md). Change that
  rule, and say so in your notes, if you want otherwise.

## The builds

### 3. [Lightbox](Lightbox/): a spectral path tracer you can rearrange (27 November 2026)

![The studio: a still life settles from noise, a glass ball is dragged across the table and its caustic follows, then the camera orbits](Lightbox/docs/screenshots/studio.gif)

Arrange glass, mirrors, cut gems and gas-discharge tubes, and watch a photograph of them form. Light is traced one
wavelength at a time through measured glass and metal, on WebGL2, with a photon pass for caustics. A twelve-step tour,
a spectroscope with a quiz, a camera with lens rings and a darkroom come with it, and a validation page that checks
the tracer against 38 known answers on your own GPU.

**Live:** https://highsierralabs.github.io/End_of_week_challenge/lightbox/ · [Read more](Lightbox/README.md)

### 2. [Drumhead](Drumhead/): draw a drum, hear its shape (27 November 2026)

![A guitar-shaped drum struck four times: two-ink contours of the membrane ripple and fade](Drumhead/docs/screenshots/play.gif)

Draw any shape and play it as a drum. Its vibration modes are solved in the browser with finite elements and played
by modal synthesis. Sand settles on the nodal lines; a Metal switch turns any shape into a free-edged plate that draws
Chladni's own figures. The two Gordon-Webb-Wolpert drums from Kac's question "can one hear the shape of a drum?" sound
exactly alike. A listening game, a mode gallery and a validation page against published eigenvalues come with it.

**Live:** https://highsierralabs.github.io/End_of_week_challenge/drumhead/ · [Read more](Drumhead/README.md)

### 1. [Cascade](Cascade/): cosmic-ray air showers over the high desert (27 November 2026)

![Cascade: a 1 PeV proton shower replayed over Lemmon Valley, Nevada](Cascade/docs/screenshots/shower.gif)

An interactive Monte Carlo of cosmic-ray air showers that runs in the browser. Showers are replayed in 3D on WebGPU,
with a WebGL2 fallback, over real terrain north of Reno, Nevada. The simulator is validated against standard
air-shower physics and compared with a real citizen observatory's data.

**Live:** https://highsierralabs.github.io/End_of_week_challenge/cascade/ · [Read more](Cascade/README.md)

## How this repository is run

The repository follows the shared-layer rules of the RHACO Git Repository Governance SOP, adapted for a small software
project. In summary:

- id-prefixed ASCII commit messages, enforced by a validate-only hook;
- one commit per deliverable unit;
- no automated commits;
- no rewriting of pushed history;
- a gate (each build's checks, build and smoke test, the assembled site, message audit, public-safety scan, clean
  tree) run before every push.

Each build lives in its own folder and is listed in `challenges.json`; a push to `main` rebuilds all of them into one
Pages site, with links to whichever repository it is built from, so a fork's site points at the fork. See [docs/CHALLENGES.md](docs/CHALLENGES.md) for how a build is added,
[docs/GOVERNANCE.md](docs/GOVERNANCE.md) for the rules and [docs/changes/LEDGER.md](docs/changes/LEDGER.md) for the
change ledger.

```bash
git config core.hooksPath tools/githooks   # enable the commit-message hook
node tools/build-site.mjs                  # build every challenge and assemble the site in _site/
node tools/gate.mjs                        # the closeout gate
```

MIT licence ([LICENSE](LICENSE)); third-party notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
