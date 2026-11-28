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
| EOWC-CHG-20261127-014 | Lightbox scaffold and engine: fetched optical reference data (CIE observer, NIST lines, Sellmeier glasses, metal indices), spectral core, scene model, exact shapes, WebGL2 path tracer and light tracer with tiled accumulation; unit tests |
| EOWC-CHG-20261127-015 | Lightbox meshes: binary glTF and OBJ loaders, mesh normalisation, SAH BVH packed for the shader with a mirrored CPU traversal; four models built by a Blender script (wine glass, tumbler, trefoil knot, cat) |
| EOWC-CHG-20261127-016 | Lightbox app: studio editor (pick, drag, orbit, inspector, lens rings, darkroom, share links, export, own models), seven scenes, twelve-step tour, spectroscope with grating and prism, computed wavelength scale and a mystery-lamp quiz; lights chosen by their emission at each wavelength |
| EOWC-CHG-20261127-017 | Lightbox validation page: 33 live GPU comparisons (furnace tests, inverse-square and cosine laws, rectangular lamp irradiance, Fresnel reflectance, prism and lens spot positions against exact ray traces, tracer agreement, CIE chromaticities, mesh against exact sphere, blur disc); it exposed lamp self-shadowing by rounding, fixed with skip-the-lamp shadow rays and cancellation-free cone sampling |
| EOWC-CHG-20261127-018 | Lightbox smoke test of the production build from a subfolder (desktop, phone, validation, Vulkan backend, software renderer); shader loop limits as uniforms; tile size adapts on slow GPUs; favicon |
| EOWC-CHG-20261127-019 | Lightbox photon map: each sweep shares eight wavelengths between camera paths and photons, photons go into a stochastic hashed grid, and camera paths gather them at surfaces seen through glass or in mirrors with a shrinking radius; validation check against the path tracer alone (35 of 35 agree) |
| EOWC-FIX-20261127-020 | Lightbox fixes from an independent code review and a browser QA pass: radiance scaled by n squared across refraction on camera paths, robust GGX and NaN guards, polish threshold, air gap under resting glass, closed lens solids, bounce limit shared by photons, beam sampling by aperture or by cone, hue-keeping film curve; studio scene kept across modes, undo limited to scene contents, ordered loads, export lock, hostile mesh names, startup fallback, spectroscope framing at any shape; validation rows that only report excluded, checks added for a lamp inside glass and a beam through a pane; ray box scene |
| EOWC-DOC-20261127-021 | Lightbox README, physics note, screenshots, clips and the recorder (clips cut between marker flashes); smaller lamp in the inside-glass check so its closed-form comparison holds to 0.4 percent |
| EOWC-REL-20261127-022 | Release Lightbox v1.0.0: manifest entry with card image and lead clip, root README list |
| EOWC-CHG-20261127-023 | The /end-of-week-challenge skill ships in the repository as a project skill (.claude/skills), with machine specifics moved to optional local notes; README leads with the skill and a run-your-own guide; site links to the repository it is built from and takes its header name from the manifest owner |
| EOWC-DOC-20261127-024 | Lightbox README: build cost section (elapsed time, model, tokens per agent, metered cost) and scripts/build-cost.mjs, which sums it from a Claude Code session's transcripts and usage log |
| EOWC-CHG-20261127-025 | Wheelwork core: reference astronomy (JPL Keplerian elements, Meeus lunar series from ERFA, checked against fetched JPL Horizons vectors and NASA's eclipse catalogue), rack-generated involute gears with mesh checks and a Tredgold bevel pair, a mesh kit with closed-solid checks and STL, the gear-train solver, and the machine itself: layout from tooth counts, exact kinematics, every part as a solid, and the print kit |
| EOWC-CHG-20261127-026 | Wheelwork app: the orrery drawn in three.js from its own solids (brass, walnut, an engraved deck, a Sun lamp for phases), crank and transport, Sky panel against the reference ephemeris, Workbench with the solver, a thirteen-stop tour, and the print kit download |
| EOWC-CHG-20261127-027 | Wheelwork validation page (58 live checks against JPL Horizons, NASA's eclipse catalogue, closed forms, brute force and exact identities) and smoke test of the production build from a subfolder (desktop, phone viewport, software renderer, kit download); the error of each body split into an exact gearing part and the rest |
| EOWC-FIX-20261127-028 | Wheelwork fixes from an independent Codex review: rigid clusters share one tooth phase on screen and in the kit, the solver keeps one train per exact ratio (the coarsest) before pruning, cluster wheels clear the cluster hub, eclipses judged at the exact new or full Moon, date limits enforced on every way of moving time, exploded view survives a rebuild; a headless Blender script checks the assembled solids for open meshes and interference |
| EOWC-CHG-20261127-029 | Wheelwork crank sound (a tick per pinion tooth, a whirr at speed), an opening camera drift, a tuned look (brass, walnut, pool of light, vignette, lamp mode) and scripts/clip.mjs, which records the README stills, card and lead clip |
