# Adding a challenge

Each challenge is one top-level folder in this repository and one entry in `challenges.json`. The Pages site is
assembled from that manifest by `tools/build-site.mjs`:

```
https://highsierralabs.github.io/End_of_week_challenge/            index page, generated from the manifest
https://highsierralabs.github.io/End_of_week_challenge/<slug>/     one challenge
```

## The folder

A challenge keeps everything it needs inside its own folder: source, tests, its README, its docs and screenshots. It
does not import from another challenge's folder, and it does not change one. The shared files are few: the manifest,
`THIRD-PARTY-NOTICES.md`, the ledger, and the root README's list of builds.

A folder is one of two kinds.

- **An npm project** (it has a `package.json`). It must provide these scripts:
  - `check`: typecheck, lint and unit tests, with no GPU or browser needed. CI runs it.
  - `build`: writes the finished static site to `dist/` (or the folder named by `out` in the manifest).
  - `smoke` (optional): tests the built site in a real browser. The gate runs it locally; CI does not, because the
    runners have no GPU.

  CI installs with `npm ci` on Node 24.14.1, so commit the `package-lock.json` and keep `engines` compatible.
- **A static folder** (no `package.json`). Set `out` in the manifest to the folder of ready-to-serve files, which is
  committed as it is. Use this for anything CI cannot build: another toolchain, or output rendered on the local GPU.

Either way the output must have an `index.html` and must work from a subfolder. Use relative URLs only (in Vite,
`base: './'`); the site builder fails on a `src="/..."` or `href="/..."` in a built page.

## The manifest entry

```json
{
  "slug": "cascade",
  "dir": "Cascade",
  "title": "Cascade",
  "tagline": "Cosmic-ray air showers over the high desert",
  "summary": "Two or three sentences for the index page.",
  "date": "2026-11-27",
  "image": "Cascade/docs/screenshots/card.jpg",
  "imageAlt": "What the picture shows",
  "clip": "Cascade/docs/screenshots/shower.gif",
  "clipAlt": "What the clip shows",
  "tech": ["WebGPU", "TypeScript"],
  "tag": "cascade-v1.0.0"
}
```

| Field | Meaning |
|---|---|
| `slug` | The URL folder: lowercase letters, digits and hyphens. It never changes once published. |
| `dir` | The challenge's folder in the repository. |
| `title`, `tagline`, `summary` | The text of its entry on the index page. |
| `date` | The Friday the week ended, `YYYY-MM-DD`. Entries are numbered in date order and listed newest first. |
| `image`, `imageAlt` | Optional picture for the entry: 16:9, about 1200 px wide, under 300 KB. |
| `clip`, `clipAlt` | Optional animated GIF that plays on the index in place of the picture, normally the README's lead clip. It is shown at 16:9 and cropped to fill, so if the README clip is another shape, add a 16:9 crop of it as `card-clip.gif` that keeps the app's edges whole (ffmpeg `crop`, then a fresh `palettegen`/`paletteuse` with `dither=none`). Under about 4 MB. It needs `image`, which visitors who ask for reduced motion see instead. `clipAlt` defaults to `imageAlt`. |
| `tech` | Optional short labels. |
| `out` | Optional output folder inside `dir`. The default is `dist`. |
| `tag` | Optional release tag, for reference. |

Two optional keys sit at the top of `challenges.json`, beside `challenges`: `owner`, the name that heads the index page
(by default the GitHub owner), and `repo`, the repository the site links to (by default the one GitHub Actions is
building, or else the `origin` remote, so a fork links to itself).

**A folder that is not in the manifest is not built and not deployed.** Its source is still public as soon as it is
pushed, so the public-safety scan applies from the first commit. Add the manifest entry when the challenge is ready to
be seen.

## What a push does

A push to `main` rebuilds every challenge in the manifest and replaces the whole site. A challenge whose check or build
fails therefore blocks the deploy of all of them, including the new one. Pin dependency versions exactly, and run the
gate before pushing:

```bash
node tools/build-site.mjs      # build every challenge and assemble _site/
node tools/gate.mjs            # the closeout gate: checks, builds, smoke tests, site, messages, scan, clean tree
```

To look at the assembled site, serve `_site/` with any static file server. Serving it under a path prefix, as Pages
does, is the stricter test.

## Releasing

1. The challenge folder has a README that says what the build is, how to run it and what was verified. A build run
   by the skill ends its README with a `## Build cost` section: time, tokens per agent, the metered cost and the
   weekly meter, as the skill's section 6 sets out (Lightbox is the first; Cascade and Drumhead predate the rule).
2. `THIRD-PARTY-NOTICES.md` lists any third-party code, data or assets the build ships.
3. The manifest entry (with its card image and the README's lead clip) and the root README's list are added.
4. The gate passes, and its tuple line goes into the body of the last commit before the push
   ([GOVERNANCE.md](GOVERNANCE.md), rule 9).
5. The release is tagged `<slug>-vX.Y.Z` and pushed with `--follow-tags`.
6. After the Pages run finishes, the index page and the new challenge are opened on the live site.
