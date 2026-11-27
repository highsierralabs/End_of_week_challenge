# End of week challenge

One autonomous build, made with Claude Code in the last hours of a weekly subscription (26-27 November 2026).

## [Cascade](Cascade/): cosmic-ray air showers over the high desert

![Cascade](Cascade/docs/screenshots/hero.png)

An interactive Monte Carlo of cosmic-ray air showers that runs in the browser. Showers are replayed in 3D on WebGPU,
with a WebGL2 fallback, over real terrain north of Reno, Nevada. The simulator is validated against standard
air-shower physics and compared with a real citizen observatory's data.

**Live:** https://highsierralabs.github.io/End_of_week_challenge/ · [Read more](Cascade/README.md)

## How this repository is run

The repository follows the shared-layer rules of the RHACO Git Repository Governance SOP, adapted for a small software
project. In summary:

- id-prefixed ASCII commit messages, enforced by a validate-only hook;
- one commit per deliverable unit;
- no automated commits;
- no rewriting of pushed history;
- a gate (check, build, message audit, public-safety scan, clean tree) run before every push.

See [docs/GOVERNANCE.md](docs/GOVERNANCE.md) for the rules and [docs/changes/LEDGER.md](docs/changes/LEDGER.md) for
the change ledger.

```bash
git config core.hooksPath tools/githooks   # enable the commit-message hook
node tools/gate.mjs                        # the closeout gate
```

MIT licence ([LICENSE](LICENSE)); third-party notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
