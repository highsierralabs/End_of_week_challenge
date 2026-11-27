#!/usr/bin/env python3
"""
PURPOSE
    Build a small, aggregate, publication-safe data snapshot from a RHACO
    observatory data tree, for the Cascade air-shower simulator. The output
    holds daily aggregates only: no per-event identifiers, no timestamps of
    individual events, no device serials, no file paths, no host names, no
    coordinates. Every quantity carries its honest-scope provenance
    (detector, configuration, window, baseline anchor, classifier version).

    Sources read (all READ-ONLY; nothing in the RHACO tree is written):
      <root>/data/spectra/spectrum_*.csv       cumulative 1024-channel spectra
                                               (ch1023 = overflow, E > 2.78 MeV)
      <root>/data/pressure/castle_pressure_*.csv  station pressure, ~60 s cadence
      <root>/data/science/castle_log_*.csv     1 Hz firmware-filtered CPS
      <root>/castle_event_log.csv              classified event log (live,
                                               appended; read once into memory,
                                               a partial trailing line dropped)

USAGE
    python rhaco_snapshot.py <RHACO_ROOT> --out <path/to/rhaco_snapshot.json>
        [--era-start 2026-05-20T23:11:04.132705+00:00]
        [--end-day YYYY-MM-DD]     last UTC day to include (default: the last
                                   complete UTC day before the newest spectrum)
        [--max-interval-s 3600]    spectrum pairs further apart are not used
        [--no-gamma]               skip the 1 Hz science pass (slowest part)

    The RHACO root is a required positional argument so that this script
    carries no machine paths.

OUTPUT
    One JSON file (column-oriented arrays, UTC dates) with sections:
      provenance, overflow_daily, pressure_daily, barometric_regression,
      event_class_daily, event_class_totals, eas_ratio_histogram, gamma_daily.
    ASCII-only progress lines on stdout.

VERSION HISTORY
    v1.0  2026-11-26  Initial generator (overflow, pressure, barometric fit,
                      event classes, EAS ratio histogram, gamma daily mean;
                      event rates per calendar day and per live day).
"""

import argparse
import csv
import glob
import io
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

SCRIPT_VERSION = "v1.0"

# Documented observatory constants (public, from the observatory's own
# reference documents). They are quoted, not re-derived here.
T_RESTART_UTC = "2026-05-20T23:11:04.132705+00:00"  # sealed-castle era boundary
OVERFLOW_ACCUM_RESET_UTC = "2026-05-22T12:25:04+00:00"  # device accumulator reset
SETTLING_END_UTC = "2026-05-29T12:25:04+00:00"  # first post-reset week = settling
GAMMA_BASELINE_CPS = 0.7070
OVERFLOW_REF_CPS = 0.07021
OVERFLOW_REF_ERR_CPS = 0.0002
DOCUMENTED_BARO_COEFF_PCT_PER_HPA = -0.25
SITE_ALT_M = 1539
SITE_ALT_FT = 5050
PRESSURE_REF_HPA = 844.1

EVENT_CLASSES = ["MUON", "MUON_SUB", "RADON", "EAS", "SUPER-EAS", "INCLINED-EAS"]
OVERFLOW_CHANNEL = 1023

SPEC_NAME_RE = re.compile(r"spectrum_(\d{8}T\d{6})\.csv$")
DUR_RE = re.compile(r"^\s*(?:(\d+)\s+days?,\s*)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\s*$")
EID_RE = re.compile(r"eid=E\d+")


def log(msg):
    print(str(msg).encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def parse_iso(s):
    return datetime.fromisoformat(s)


def parse_duration(s):
    m = DUR_RE.match(s)
    if not m:
        return None
    days = int(m.group(1) or 0)
    return days * 86400 + int(m.group(2)) * 3600 + int(m.group(3)) * 60 + float(m.group(4))


def read_complete_lines(path):
    """Read a possibly-live text file once, read-only, and return its complete
    lines (a trailing line without a terminator is dropped)."""
    with open(path, "rb") as f:
        data = f.read()
    text = data.decode("latin-1")
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith(("\n", "\r")):
        lines = lines[:-1]
    return [ln.rstrip("\r\n") for ln in lines]


def rnd(x, n):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return float(round(x, n))


def day_range(d0, d1):
    out = []
    d = d0
    while d <= d1:
        out.append(d)
        d += timedelta(days=1)
    return out


# --------------------------------------------------------------------------
# Spectra -> overflow channel
# --------------------------------------------------------------------------

def read_spectrum_tail(path):
    """Return (ch1023_counts, duration_s) from the last line of a cumulative
    spectrum file, or None when the file is unreadable or incomplete."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 600))
            tail = f.read().decode("latin-1")
    except OSError:
        return None
    lines = [ln for ln in tail.splitlines() if ln.strip()]
    if not lines or not tail.endswith(("\n", "\r")):
        return None
    try:
        row = next(csv.reader([lines[-1]]))
        if int(row[0]) != OVERFLOW_CHANNEL:
            return None
        counts = int(float(row[2]))
        dur = parse_duration(row[3])
    except (ValueError, IndexError, StopIteration):
        return None
    if dur is None:
        return None
    return counts, dur


def overflow_daily(root, era_start, end_day, max_interval_s):
    files = glob.glob(os.path.join(root, "data", "spectra", "spectrum_*.csv"))
    snaps = []
    for p in files:
        m = SPEC_NAME_RE.search(os.path.basename(p))
        if not m:
            continue
        t = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        if t < era_start or t.date() > end_day + timedelta(days=1):
            continue
        snaps.append((t, p))
    snaps.sort()
    log("spectra in window: %d files" % len(snaps))

    series = []
    bad = 0
    for t, p in snaps:
        r = read_spectrum_tail(p)
        if r is None:
            bad += 1
            continue
        series.append((t, r[0], r[1]))
    log("spectra parsed: %d (unreadable/incomplete: %d)" % (len(series), bad))

    per_day_n = defaultdict(int)
    per_day_t = defaultdict(float)
    per_day_k = defaultdict(int)
    resets = 0
    long_gaps = 0
    long_gap_s = 0.0
    clock_mismatch = 0
    for (t1, c1, d1), (t2, c2, d2) in zip(series, series[1:]):
        dn = c2 - c1
        dt = d2 - d1
        wall = (t2 - t1).total_seconds()
        if dt <= 0 or dn < 0:
            resets += 1
            continue
        if wall > max_interval_s or dt > max_interval_s:
            long_gaps += 1
            long_gap_s += dt
            continue
        if abs(dt - wall) > 60:
            clock_mismatch += 1
        mid = t1 + (t2 - t1) / 2
        day = mid.date()
        if day > end_day:
            continue
        per_day_n[day] += dn
        per_day_t[day] += dt
        per_day_k[day] += 1

    days = sorted(d for d in per_day_t if d >= era_start.date())
    settle_end = parse_iso(SETTLING_END_UTC).date()
    out = {"date": [], "rate_cps": [], "rate_err_cps": [], "counts": [],
           "accum_seconds": [], "n_intervals": [], "coverage": [], "settling": []}
    for d in days:
        n, T = per_day_n[d], per_day_t[d]
        if T <= 0:
            continue
        out["date"].append(d.isoformat())
        out["rate_cps"].append(rnd(n / T, 6))
        out["rate_err_cps"].append(rnd(math.sqrt(n) / T if n > 0 else float("nan"), 6))
        out["counts"].append(int(n))
        out["accum_seconds"].append(int(round(T)))
        out["n_intervals"].append(per_day_k[d])
        out["coverage"].append(rnd(T / 86400.0, 4))
        out["settling"].append(d <= settle_end)
    diag = {"spectrum_files_used": len(series), "spectrum_files_unreadable": bad,
            "accumulator_resets_skipped": resets,
            "intervals_skipped_gt_max": long_gaps,
            "accum_seconds_skipped_gt_max": int(round(long_gap_s)),
            "intervals_device_vs_wall_clock_diff_gt_60s": clock_mismatch,
            "max_interval_s": max_interval_s}
    log("overflow days: %d, resets skipped: %d, long gaps skipped: %d"
        % (len(out["date"]), resets, long_gaps))
    return out, diag


# --------------------------------------------------------------------------
# Pressure
# --------------------------------------------------------------------------

def pressure_daily(root, era_start, end_day):
    files = sorted(glob.glob(os.path.join(root, "data", "pressure", "castle_pressure_*.csv")))
    acc = defaultdict(list)
    rejected = 0
    for p in files:
        m = re.search(r"castle_pressure_(\d{8})\.csv$", p)
        if not m:
            continue
        fday = datetime.strptime(m.group(1), "%Y%m%d").date()
        if fday < era_start.date() - timedelta(days=1) or fday > end_day + timedelta(days=1):
            continue
        lines = read_complete_lines(p)
        if not lines:
            continue
        rdr = csv.DictReader(io.StringIO("\n".join(lines)))
        for row in rdr:
            try:
                t = parse_iso(row["timestamp_utc"])
                v = float(row["pressure_hpa"])
            except (ValueError, KeyError, TypeError):
                rejected += 1
                continue
            if t < era_start or t.date() > end_day:
                continue
            if not (750.0 <= v <= 950.0):
                rejected += 1
                continue
            acc[t.date()].append(v)
    out = {"date": [], "pressure_hpa": [], "pressure_min_hpa": [],
           "pressure_max_hpa": [], "n_samples": []}
    for d in sorted(acc):
        v = acc[d]
        out["date"].append(d.isoformat())
        out["pressure_hpa"].append(rnd(sum(v) / len(v), 2))
        out["pressure_min_hpa"].append(rnd(min(v), 2))
        out["pressure_max_hpa"].append(rnd(max(v), 2))
        out["n_samples"].append(len(v))
    log("pressure days: %d (rejected samples: %d)" % (len(out["date"]), rejected))
    return out, {"samples_rejected_unparseable_or_out_of_range": rejected}


# --------------------------------------------------------------------------
# Barometric regression (weighted least squares, numpy-free)
# --------------------------------------------------------------------------

def wls(X, y, w):
    """Weighted least squares. X: list of rows (with intercept column).
    Returns (beta, cov_formal, chi2, dof)."""
    k = len(X[0])
    A = [[0.0] * k for _ in range(k)]
    b = [0.0] * k
    for xi, yi, wi in zip(X, y, w):
        for i in range(k):
            b[i] += wi * xi[i] * yi
            for j in range(k):
                A[i][j] += wi * xi[i] * xi[j]
    inv = invert(A)
    beta = [sum(inv[i][j] * b[j] for j in range(k)) for i in range(k)]
    chi2 = 0.0
    for xi, yi, wi in zip(X, y, w):
        r = yi - sum(beta[i] * xi[i] for i in range(k))
        chi2 += wi * r * r
    return beta, inv, chi2, len(y) - k


def invert(M):
    n = len(M)
    A = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(M)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(A[r][c]))
        A[c], A[piv] = A[piv], A[c]
        pv = A[c][c]
        if pv == 0:
            raise ValueError("singular matrix")
        A[c] = [v / pv for v in A[c]]
        for r in range(n):
            if r != c:
                f = A[r][c]
                A[r] = [a - f * bb for a, bb in zip(A[r], A[c])]
    return [row[n:] for row in A]


def barometric(ov, pr, min_cov=0.9, min_p_samples=1200):
    pmap = {d: (p, n) for d, p, n in zip(pr["date"], pr["pressure_hpa"], pr["n_samples"])}
    pts = []
    for d, r, e, cov, st in zip(ov["date"], ov["rate_cps"], ov["rate_err_cps"],
                                 ov["coverage"], ov["settling"]):
        if st or cov is None or cov < min_cov or d not in pmap or e is None:
            continue
        p, n = pmap[d]
        if n < min_p_samples:
            continue
        pts.append((d, r, e, p))
    res = {"n_days": len(pts),
           "selection": ("post-settling days with overflow accumulation coverage >= %.2f "
                         "and >= %d pressure samples" % (min_cov, min_p_samples)),
           "method": ("weighted least squares of daily overflow rate on daily mean "
                      "pressure, weights 1/sigma_Poisson^2; coefficient = 100 * slope / "
                      "intercept-at-mean-pressure, in percent per hPa"),
           "documented_coeff_pct_per_hpa": DOCUMENTED_BARO_COEFF_PCT_PER_HPA}
    if len(pts) < 10:
        res["note"] = "too few days for a regression"
        return res
    pm = sum(p for _, _, _, p in pts) / len(pts)
    t0 = parse_iso(pts[0][0] + "T00:00:00+00:00")
    y = [r for _, r, _, _ in pts]
    w = [1.0 / (e * e) for _, _, e, _ in pts]

    def fit(with_trend):
        X = []
        for d, _, _, p in pts:
            row = [1.0, p - pm]
            if with_trend:
                row.append((parse_iso(d + "T00:00:00+00:00") - t0).days / 30.0)
            X.append(row)
        beta, cov, chi2, dof = wls(X, y, w)
        scale = max(1.0, chi2 / dof) if dof > 0 else 1.0
        a, b = beta[0], beta[1]
        # delta-method error on 100*b/a
        va, vb, vab = cov[0][0], cov[1][1], cov[0][1]
        coeff = 100.0 * b / a
        var = (100.0 / a) ** 2 * (vb - 2 * (b / a) * vab + (b / a) ** 2 * va)
        se_formal = math.sqrt(var)
        out = {"coeff_pct_per_hpa": rnd(coeff, 4),
               "se_formal_pct_per_hpa": rnd(se_formal, 4),
               "se_scaled_pct_per_hpa": rnd(se_formal * math.sqrt(scale), 4),
               "rate_at_mean_pressure_cps": rnd(a, 6),
               "chi2_per_dof": rnd(chi2 / dof, 3), "dof": dof}
        if with_trend:
            out["trend_pct_per_30d"] = rnd(100.0 * beta[2] / a, 4)
        return out

    ps = [p for _, _, _, p in pts]
    res.update({"mean_pressure_hpa": rnd(pm, 2),
                "pressure_range_hpa": [rnd(min(ps), 2), rnd(max(ps), 2)],
                "date_range": [pts[0][0], pts[-1][0]],
                "pressure_only": fit(False),
                "pressure_plus_linear_time_trend": fit(True)})
    log("barometric (pressure only): %s %%/hPa +- %s (scaled)"
        % (res["pressure_only"]["coeff_pct_per_hpa"], res["pressure_only"]["se_scaled_pct_per_hpa"]))
    return res


# --------------------------------------------------------------------------
# Event log
# --------------------------------------------------------------------------

def event_classes(root, era_start, end_day):
    path = os.path.join(root, "castle_event_log.csv")
    lines = read_complete_lines(path)
    hdr = next(csv.reader([lines[0]]))
    idx = {k: i for i, k in enumerate(hdr)}
    need = ["timestamp_utc", "event_type", "morph_class", "ratio",
            "classifier_version", "schema_version"]
    for k in need:
        if k not in idx:
            raise SystemExit("event log lacks column %s" % k)
    n_bad = 0
    per_day = defaultdict(Counter)
    day_cv = defaultdict(Counter)
    day_sv = defaultdict(Counter)
    totals = Counter()
    rowtypes = Counter()
    ratios = {"EAS": [], "SUPER-EAS": []}
    ratio_cv = Counter()
    for row in csv.reader(lines[1:]):
        if len(row) != len(hdr):
            n_bad += 1
            continue
        try:
            t = parse_iso(row[idx["timestamp_utc"]])
        except ValueError:
            n_bad += 1
            continue
        if t < era_start or t.date() > end_day:
            continue
        et = row[idx["event_type"]]
        mc = row[idx["morph_class"]]
        rowtypes[(et, mc)] += 1
        # One CLASSIFIED row per classified event (FW_ENRICHMENT rows annotate an
        # already-CLASSIFIED event and are not counted again).
        if et != "CLASSIFIED" or mc not in EVENT_CLASSES:
            continue
        d = t.date()
        per_day[d][mc] += 1
        totals[mc] += 1
        cv = row[idx["classifier_version"]] or "unrecorded"
        sv = row[idx["schema_version"]] or "unrecorded"
        day_cv[d][cv] += 1
        day_sv[d][sv] += 1
        if mc in ratios:
            try:
                ratios[mc].append(float(row[idx["ratio"]]))
                ratio_cv[cv] += 1
            except ValueError:
                pass
    days = day_range(era_start.date(), end_day)
    out = {"date": [d.isoformat() for d in days]}
    for c in EVENT_CLASSES:
        out[c] = [per_day[d][c] for d in days]
    out["classifier_version"] = ["+".join(sorted(day_cv[d])) if day_cv[d] else None for d in days]
    out["schema_version"] = ["+".join(sorted(day_sv[d])) if day_sv[d] else None for d in days]
    fw_enrich = sum(v for (et, mc), v in rowtypes.items() if et == "FW_ENRICHMENT")
    poisson = rowtypes.get(("CLASSIFIED", "POISSON"), 0)
    diag = {"malformed_rows_skipped": n_bad,
            "fw_enrichment_rows_not_counted": fw_enrich,
            "poisson_rows_excluded": poisson,
            "rows_in_window_by_type": {"%s/%s" % (et, mc or "-"): v
                                       for (et, mc), v in sorted(rowtypes.items())}}
    log("event days: %d, totals: %s" % (len(days), dict(totals)))
    return out, totals, ratios, ratio_cv, diag


def ratio_histogram(ratios, ratio_cv, lo=8.0, hi=300.0, nbins=12):
    edges = [lo * (hi / lo) ** (i / nbins) for i in range(nbins + 1)]
    h = {"bin_edges": [rnd(e, 3) for e in edges], "EAS": [0] * nbins,
         "SUPER-EAS": [0] * nbins, "below_lo": {"EAS": 0, "SUPER-EAS": 0},
         "above_hi": {"EAS": 0, "SUPER-EAS": 0}}
    for cls, vals in ratios.items():
        for v in vals:
            if v < lo:
                h["below_lo"][cls] += 1
            elif v >= hi:
                h["above_hi"][cls] += 1
            else:
                i = min(nbins - 1, int(math.log(v / lo) / math.log(hi / lo) * nbins))
                h[cls][i] += 1
    allv = sorted(ratios["EAS"] + ratios["SUPER-EAS"])
    h["n_events"] = len(allv)
    h["median_ratio"] = rnd(allv[len(allv) // 2], 2) if allv else None
    h["max_ratio"] = rnd(allv[-1], 1) if allv else None
    h["classifier_versions"] = dict(ratio_cv)
    h["observable"] = ("classification ratio = trigger CPS / 300-sample rolling-median "
                       "CPS at trigger time (event-log column 'ratio')")
    h["binning"] = "%d log-spaced bins from %g to %g (x)" % (nbins, lo, hi)
    return h


# --------------------------------------------------------------------------
# Gamma channel (1 Hz science CPS)
# --------------------------------------------------------------------------

def gamma_daily(root, era_start, end_day):
    import pandas as pd
    files = sorted(glob.glob(os.path.join(root, "data", "science", "castle_log_*.csv")))
    out = {"date": [], "mean_cps": [], "median_cps": [], "n_samples": []}
    serial_sets = set()
    for p in files:
        m = re.search(r"castle_log_(\d{8})\.csv$", p)
        if not m:
            continue
        d = datetime.strptime(m.group(1), "%Y%m%d").date()
        if d < era_start.date() or d > end_day:
            continue
        lines = read_complete_lines(p)
        if len(lines) < 2:
            continue
        df = pd.read_csv(io.StringIO("\n".join(lines)), on_bad_lines="skip",
                         low_memory=False)
        if "device_serial" in df.columns:
            serial_sets.update(df["device_serial"].dropna().unique().tolist())
        ts = pd.to_datetime(df["timestamp_utc"], utc=True, errors="coerce", format="ISO8601")
        sel = (df["record_source"] == "RT") & (ts >= pd.Timestamp(era_start))
        cps = pd.to_numeric(df.loc[sel, "cps"], errors="coerce").dropna()
        if len(cps) == 0:
            continue
        out["date"].append(d.isoformat())
        out["mean_cps"].append(rnd(float(cps.mean()), 5))
        out["median_cps"].append(rnd(float(cps.median()), 5))
        out["n_samples"].append(int(len(cps)))
    log("gamma days: %d (distinct detector serials seen: %d)" % (len(out["date"]), len(serial_sets)))
    return out, {"distinct_detector_units_in_source": len(serial_sets)}


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Build the Cascade RHACO aggregate snapshot.")
    ap.add_argument("rhaco_root", help="root of the RHACO observatory tree (read-only)")
    ap.add_argument("--out", required=True, help="output JSON path")
    ap.add_argument("--era-start", default=T_RESTART_UTC)
    ap.add_argument("--end-day", default=None)
    ap.add_argument("--max-interval-s", type=float, default=3600.0)
    ap.add_argument("--no-gamma", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(a.rhaco_root)
    out_path = os.path.abspath(a.out)
    if os.path.commonpath([root, out_path]) == root:
        raise SystemExit("refusing to write inside the RHACO tree")
    era_start = parse_iso(a.era_start)

    if a.end_day:
        end_day = datetime.strptime(a.end_day, "%Y-%m-%d").date()
    else:
        names = [SPEC_NAME_RE.search(os.path.basename(p)) for p in
                 glob.glob(os.path.join(root, "data", "spectra", "spectrum_*.csv"))]
        latest = max(datetime.strptime(m.group(1), "%Y%m%dT%H%M%S") for m in names if m)
        end_day = latest.date() - timedelta(days=1)
    log("window: %s -> end of %s (UTC)" % (era_start.isoformat(), end_day.isoformat()))

    ov, ov_diag = overflow_daily(root, era_start, end_day, a.max_interval_s)
    pr, pr_diag = pressure_daily(root, era_start, end_day)
    baro = barometric(ov, pr)
    ev, totals, ratios, ratio_cv, ev_diag = event_classes(root, era_start, end_day)
    hist = ratio_histogram(ratios, ratio_cv)
    gm, gm_diag = (None, None) if a.no_gamma else gamma_daily(root, era_start, end_day)

    # Era means
    post = [(n, T) for n, T, s in zip(ov["counts"], ov["accum_seconds"], ov["settling"]) if not s]
    N = sum(n for n, _ in post)
    T = sum(t for _, t in post)
    ov_summary = {"post_settling_rate_cps": rnd(N / T, 6) if T else None,
                  "post_settling_rate_err_cps": rnd(math.sqrt(N) / T, 6) if T else None,
                  "post_settling_counts": N, "post_settling_accum_seconds": int(T),
                  "post_settling_days": len(post)}
    ndays = len(ev["date"])
    live_days = None
    if gm is not None:
        # Logger-uptime proxy: 1 Hz science samples per UTC day / 86400.
        gmap = dict(zip(gm["date"], gm["n_samples"]))
        ev["science_coverage"] = [rnd(min(1.0, gmap.get(d, 0) / 86400.0), 4) for d in ev["date"]]
        live_days = sum(gmap.get(d, 0) for d in ev["date"]) / 86400.0
    ev_summary = {}
    for c in EVENT_CLASSES:
        ev_summary[c] = {"total": totals[c], "per_calendar_day": rnd(totals[c] / ndays, 3)}
        if live_days:
            ev_summary[c]["per_live_day"] = rnd(totals[c] / live_days, 3)
            ev_summary[c]["per_live_day_poisson_err"] = rnd(math.sqrt(totals[c]) / live_days, 3)
    ev_summary["calendar_days"] = ndays
    ev_summary["live_days"] = rnd(live_days, 2) if live_days else None
    ev_summary["note"] = ("live_days = 1 Hz science samples / 86400 (logger-uptime proxy); "
                          "the first day starts at the era boundary (23:11 UTC)")

    snap = {
        "schema": "cascade-rhaco-snapshot/1",
        "provenance": {
            "generated_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "generator": "scripts/rhaco_snapshot.py " + SCRIPT_VERSION,
            "credit": "RHACO citizen observatory",
            "source": ("Daily aggregates derived read-only from the observatory's own "
                       "records: cumulative 1024-channel spectra (~5 min cadence), the "
                       "station pressure sidecar (~60 s cadence), the 1 Hz science "
                       "count-rate log, and the classified event log of the primary "
                       "castle-shielded detector."),
            "detector": "RadiaCode RC-110 (CsI(Tl), 1 cm^3)",
            "shielding": "graded-Z lead castle, 30 mm walls / 40 mm lid",
            "configuration_era": ("post-2026-05-20 sealed castle (lid notched, labyrinth-sealed "
                                  "USB penetration; approaches but is not true 4 pi)"),
            "era_start_utc": era_start.isoformat(),
            "window_utc": {"start": era_start.isoformat(),
                           "end": (datetime.combine(end_day, datetime.min.time(), timezone.utc)
                                   + timedelta(days=1)).isoformat(),
                           "last_complete_day": end_day.isoformat()},
            "overflow_accumulator_reset_utc": OVERFLOW_ACCUM_RESET_UTC,
            "overflow_settling_until_utc": SETTLING_END_UTC,
            "classifier_versions_in_window": sorted({v for s in ev["classifier_version"] if s
                                                     for v in s.split("+")}),
            "event_log_schema_versions_in_window": sorted({v for s in ev["schema_version"] if s
                                                           for v in s.split("+")}),
            "baselines": {
                "gamma_cps": GAMMA_BASELINE_CPS,
                "gamma_note": "locked gamma-channel quiescent baseline, Phase 8.1 (2026-06-13/20)",
                "overflow_cps": OVERFLOW_REF_CPS, "overflow_err_cps": OVERFLOW_REF_ERR_CPS,
                "overflow_note": ("locked cosmic-ray-channel reference: spectrum overflow bin "
                                  "ch1023 (E > 2.78 MeV), settled, first week excluded"),
                "barometric_coeff_pct_per_hpa": DOCUMENTED_BARO_COEFF_PCT_PER_HPA,
            },
            "site": {"altitude_m": SITE_ALT_M, "altitude_ft": SITE_ALT_FT,
                     "mean_pressure_hpa": PRESSURE_REF_HPA,
                     "atmospheric_depth_g_cm2": 840,
                     "region": "Great Basin, northern Nevada, USA (~39 deg N)"},
            "time_basis": "all dates are UTC calendar days",
            "caveats_doc": "docs/rhaco_snapshot.md",
            "operator_review_required": True,
        },
        "overflow_daily": ov,
        "overflow_summary": ov_summary,
        "overflow_diagnostics": ov_diag,
        "pressure_daily": pr,
        "pressure_diagnostics": pr_diag,
        "barometric_regression": baro,
        "event_class_daily": ev,
        "event_class_totals": ev_summary,
        "event_log_diagnostics": ev_diag,
        "eas_ratio_histogram": hist,
    }
    if gm is not None:
        snap["gamma_daily"] = gm
        snap["gamma_diagnostics"] = gm_diag

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(snap, f, separators=(",", ":"), ensure_ascii=True)
        f.write("\n")
    log("wrote %d bytes" % os.path.getsize(out_path))


if __name__ == "__main__":
    main()
