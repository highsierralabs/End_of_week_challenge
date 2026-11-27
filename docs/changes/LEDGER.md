# Change ledger

| Id | Summary |
|---|---|
| EOWC-CHG-20261126-001 | Repository scaffolding and adapted SOP governance (hook, gate) |
| EOWC-CHG-20261126-002 | Cascade toolchain and the air-shower Monte Carlo engine |
| EOWC-CHG-20261126-003 | Real-DEM terrain of the Reno-Stead area and the night sky |
| EOWC-CHG-20261126-004 | User interface: controls, timeline, charts, tour, about |
| EOWC-CHG-20261126-005 | Aggregate RHACO data snapshot and its generator |
| EOWC-CHG-20261126-006 | Integrate worker, GPU track replay, detector, stage and app; physics unit tests |
| EOWC-CHG-20261126-007 | Rate mode, Observatory comparison with the RHACO snapshot, physics doc, licence, Pages workflow |
| EOWC-CHG-20261126-008 | Visual tuning: camera presets, EM brightness, bloom, portrait framing, presentation mode, tour text fix |
| EOWC-CHG-20261126-009 | Per-shower detector exposure line; READMEs and screenshots |
| EOWC-CHG-20261126-010 | Validation page with precomputed 348-shower ensemble; README cites its numbers |
| EOWC-CHG-20261126-011 | Replay sonification (S key) |
| EOWC-FIX-20261126-012 | check-commit-msg CLI no longer runs on import (gate crash) |
| EOWC-CHG-20261126-013 | Shower-core hit-rate estimate and the Data panel section comparing it with the EAS categories |
| EOWC-CHG-20261126-014 | Sky mode: Poisson-timed showers from the spectrum over the valley |
| EOWC-CHG-20261126-015 | Sky mode on a worker pool (plan / simulate / merge), 9 s to 2 s |
| EOWC-DOC-20261126-016 | Findings note for the RHACO observatory |
| EOWC-CHG-20261126-017 | Split big showers across the worker pool; readout flags Xmax past the ground |
| EOWC-DOC-20261126-018 | Physics doc: split showers and sky mode; architecture table matches the tree |
| EOWC-FIX-20261126-019 | Review fixes: unbiased thinning fallback, lone secondary, horizontal ground check, shared crystal/lead model |
| EOWC-FIX-20261126-020 | QA fixes: replay window, quality param validation, EM-off readout |
| EOWC-FIX-20261126-021 | Thinning: keep-all fallback at the weight limit (energy-conserving), weight factor 1000 |
| EOWC-FIX-20261126-022 | UI QA fixes: tour placement, phone layout, timing chart per core-distance ring, validation table |
| EOWC-CHG-20261126-023 | Regenerate rate, validation and core-hit data on the fixed engine; docs to final numbers |
| EOWC-DOC-20261126-024 | Refresh README screenshots |
| EOWC-CHG-20261126-025 | Smoke test of the production build on both backends, as a gate member |
| EOWC-DOC-20261126-026 | Animated README clips (shower, sky) and the clip renderer |
| EOWC-CHG-20261126-027 | First-visit welcome card with three ways in |
| EOWC-FIX-20261126-028 | Automation scripts pre-dismiss the welcome card |
| EOWC-DOC-20261126-029 | README polish: parallel showers, muon timing wording, commands, URL options |
| EOWC-CHG-20261126-030 | Fluorescence telescope view; replay brightness normalised by primary energy |
| EOWC-CHG-20261126-031 | Tour step for the telescope; README telescope screenshot; debug hook syncs controls |
| EOWC-CHG-20261127-001 | Multi-challenge Pages site: challenges.json manifest, site builder and index page, Cascade served at /cascade/, gate and workflow cover every challenge |
| EOWC-DOC-20261127-002 | Weekly-series README, challenge contract (docs/CHALLENGES.md), governance rules 6, 8 and 11 |
| EOWC-CHG-20261127-003 | Drumhead scaffold and solver: meshing, linear FEM, RCM banded Cholesky, shift-invert Lanczos; tests against exact square, disc and Driscoll (1997) GWW values |
| EOWC-CHG-20261127-004 | Drumhead app: solver worker pool, WebGL2 two-ink renderer, AudioWorklet modal synthesis, Chladni sand, spectrum strip, mode gallery, twins view, About text, phone layout |
| EOWC-CHG-20261127-005 | Drumhead Listen game (which drum is this?, with twins rounds), solved-preset cache, production smoke test served from a subfolder |
| EOWC-CHG-20261127-006 | Drumhead: sand sweep through the modes, share links for drawn drums, the twins seven triangles drawn faintly, synthetic room reverb |
| EOWC-CHG-20261127-007 | Drumhead validation page: Driscoll comparison and convergence, twins agreement per refinement, square and disc exact values, Weyl on every preset, all computed live; smoke covers it |
| EOWC-DOC-20261127-008 | Drumhead README, screenshots, animated clips and clip recorder; layout avoids the info card; Weyl accuracy stated as measured |
| EOWC-FIX-20261127-009 | Drumhead review fixes: worker handler leaked onto the page, NaN drive from rim taps, pitch slider in sand mode, stroke lost on load, degenerate share links, quiz race, Lanczos restart for repeated eigenvalues |
| EOWC-CHG-20261127-010 | Drumhead Metal: free-edged Kirchhoff plates by a Legendre Ritz method, true Chladni figures, plate sound; validated against Porter (2017); sweep skips modes the driver cannot excite |
| EOWC-REL-20261127-011 | Release Drumhead v1.0.0: manifest entry with card image, root README list, third-party notices |
| EOWC-CHG-20261127-012 | Index page plays each build's lead README clip (manifest clip, clipAlt) with the card still for reduced motion; seven kickoff questions in README and index |
| EOWC-FIX-20261127-013 | Drumhead index clip: a 16:9 crop of play.gif (card-clip.gif) so the header and spectrum labels are not cut off; contract says how to make one |
