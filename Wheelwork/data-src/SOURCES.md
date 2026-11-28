# Reference data: sources

Everything in this folder is a response from a public server, saved byte for byte as it was
retrieved on **2026-11-27**. `scripts/fetch-data.mjs` fetches all of it again (sequential
requests, a pause between them, a generic user agent) and regenerates the two modules in
`src/data/`. `node scripts/fetch-data.mjs --offline` regenerates those modules from the files
here without touching the network; it reproduces them byte for byte.

Nothing here was typed in or edited by hand. The numbers that live in source files rather than
in `src/data/` (the planetary elements in `src/core/astro/planets.ts`, the lunar series and the
precession polynomials in `src/core/astro/moon.ts`) are checked digit for digit against the files
in this folder by the unit tests.

## 1. Planetary elements: JPL Solar System Dynamics

| File | URL |
|---|---|
| `jpl/approx_pos.html` | https://ssd.jpl.nasa.gov/planets/approx_pos.html |

"Approximate Positions of the Planets": the Keplerian elements and rates of E. M. Standish (JPL),
from Standish and Williams (1992), as the page presents them.

Used: Table 2a (elements and rates for 3000 BC to 3000 AD, mean ecliptic and equinox of J2000)
for Mercury, Venus, the Earth-Moon barycentre ("EM Bary"), Mars, Jupiter and Saturn, and Table 2b
(the additional terms b, c, s, f) for Jupiter and Saturn. Table 1 (1800 AD to 2050 AD) and the
rows for Uranus and Neptune are not used.

Transformation: none. The numbers were copied into `ELEMENT_TABLE` and `EXTRA_TERMS` in
`src/core/astro/planets.ts`; `tests/unit/astro-planets.test.ts` strips the HTML tags from this
file and compares every number.

The plain-text tables the task brief pointed to, `https://ssd.jpl.nasa.gov/txt/p_elem_t2.txt` and
`https://ssd.jpl.nasa.gov/txt/p_elem_t1.txt`, returned HTTP 404 on the retrieval date, and
`https://ssd.jpl.nasa.gov/txt/aprx_pos_planets.pdf` redirected (HTTP 301) to the page above. The
page carries the same tables inline.

## 2. Lunar series and precession: ERFA

| File | URL |
|---|---|
| `erfa/moon98.c` | https://raw.githubusercontent.com/liberfa/erfa/master/src/moon98.c |
| `erfa/p06e.c` | https://raw.githubusercontent.com/liberfa/erfa/master/src/p06e.c |

ERFA (Essential Routines for Fundamental Astronomy, https://github.com/liberfa/erfa) is derived,
with permission, from the IAU SOFA library. Copyright (C) 2013-2023, NumFOCUS Foundation; BSD
3-clause licence. The licence text is at the end of each file and is kept with it.

- `moon98.c` (`eraMoon98`) is, in its own words, "a full implementation of the algorithm published
  by Meeus" (*Astronomical Algorithms*, 2nd ed., 1998, ch. 47, a truncation of the lunar theory
  ELP-2000/82), "except that the light-time correction to the Moon's mean longitude has been
  omitted". Used: the polynomials of the five mean elements, the three additional arguments, the
  nine additive terms, the eccentricity factor, the mean distance, and the two tables of 60 terms.
- `p06e.c` (`eraP06e`) holds the IAU 2006 precession angles (Capitaine, Wallace and Chapront 2003).
  Used: `pa` (general precession p_A), `pia` (pi_A) and `bpia` (Pi_A).

Transformation: none. The numbers were copied into `src/core/astro/moon.ts` (the two tables by
script, the distance coefficients left in metres); `tests/unit/astro-moon.test.ts` parses both C
files and compares every coefficient. None of the C code is used.

## 3. Positions: JPL Horizons

| Files | URL |
|---|---|
| `horizons/<body>-NN.txt` (48 files) | https://ssd.jpl.nasa.gov/api/horizons.api |
| `horizons/REQUESTS.txt` | written by the script: the exact URL that produced each file |

Horizons On-Line Ephemeris System, Solar System Dynamics Group, Jet Propulsion Laboratory.
API version 1.2. Every response names its ephemeris as DE441.

Request, the same for every file apart from `COMMAND`, `CENTER` and `TLIST`:

```
format=text  OBJ_DATA='NO'  MAKE_EPHEM='YES'  EPHEM_TYPE='VECTORS'
REF_PLANE='ECLIPTIC'  REF_SYSTEM='ICRF'  OUT_UNITS='AU-D'  VEC_TABLE='1'  VEC_CORR='NONE'
CSV_FORMAT='YES'  TIME_TYPE='TDB'  TLIST_TYPE='JD'  TLIST='<up to 80 Julian Dates>'
```

That is: geometric position vectors (no light time, no aberration), in au, in the frame Horizons
labels "Ecliptic of J2000.0" (the ICRF rotated by the IAU 1976 obliquity of 84381.448 arcsec),
at explicit Julian Dates in TDB.

| Key in `src/data/horizons.ts` | `COMMAND` | `CENTER` | Body |
|---|---|---|---|
| `planets.mercury` | 199 | 500@10 (Sun) | Mercury |
| `planets.venus` | 299 | 500@10 | Venus |
| `planets.earth` | 3 | 500@10 | Earth-Moon barycentre |
| `planets.mars` | 4 | 500@10 | Mars system barycentre |
| `planets.jupiter` | 5 | 500@10 | Jupiter system barycentre |
| `planets.saturn` | 6 | 500@10 | Saturn system barycentre |
| `moon` | 301 | 500@399 (Earth) | Moon |
| `sun` | 10 | 500@399 | Sun |

Why the barycentres 3, 4, 5 and 6: Standish's elements are fits to the JPL planetary ephemerides,
which integrate the Earth-Moon barycentre and, for Mars and the outer planets, the barycentre of
each planet with its satellites; the page labels the third row "EM Bary". The planet centres 499,
599 and 699 differ from those barycentres by a few hundred kilometres at most (an estimate from
the satellite masses, not measured here), far below the errors of the elements. The choice was
made on that reasoning, not by fitting both. Mercury and Venus have no
satellites, so 199 and 299 are their barycentres. The centre is the Sun's body centre, not the
solar system barycentre, because the elements are heliocentric.

Dates. One date at a fixed pseudo-random offset inside each equal stratum, so that the sampling
cannot alias with an orbital period; the generator and its seeds are in the script, so the list
is the same on every run. Julian Dates are rounded to 0.01 day.

- 160 dates, one per 25 years, from -1000 January 1 (1001 BC) to 3000 January 1: every body.
- 300 dates, one per year, 1800 to 2100: the six planets.
- 300 dates, one per 243.5 days, 1900 to 2100: the Moon and the Sun.

So each body has 460 rows. Horizons accepted every date. Its limits were probed with two extra
requests (not saved): an out-of-range date for Mercury was refused with "No ephemeris for target
"Mercury" prior to B.C. 9999-MAR-21 00:00:00.0000 TDB", and one for the Moon with "No ephemeris
for target "Moon" after A.D. 9999-DEC-30 12:00:00.0000 TDB". The other limits of the other
bodies were not probed.

Transformation, for `src/data/horizons.ts`: from each row `JDTDB, X, Y, Z` between `$$SOE` and
`$$EOE`, longitude = atan2(Y, X) in [0, 360), latitude = asin(Z / r), r = sqrt(X^2 + Y^2 + Z^2).
Rounded to 1e-6 degree and 1e-9 au. The Moon's distance is converted with
1 au = 149597870.7 km (the value Horizons prints) and rounded to 0.1 km. Rows sorted by date.

## 4. Eclipses: NASA Goddard Space Flight Center

**Eclipse Predictions by Fred Espenak, NASA's GSFC.**

| File | URL |
|---|---|
| `eclipses/SE1901-2000.html` | https://eclipse.gsfc.nasa.gov/SEcat5/SE1901-2000.html |
| `eclipses/SE2001-2100.html` | https://eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html |
| `eclipses/LE1901-2000.html` | https://eclipse.gsfc.nasa.gov/LEcat5/LE1901-2000.html |
| `eclipses/LE2001-2100.html` | https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html |

The century pages for 1901 to 2000 and 2001 to 2100 of the Five Millennium Catalog of Solar
Eclipses and the Five Millennium Catalog of Lunar Eclipses. The pages state: "Permission is
freely granted to reproduce this data when accompanied by an acknowledgment", and print it as
"Eclipse Predictions by Fred Espenak (NASA's GSFC)"; it is the line in bold above.

Transformation, for `src/data/eclipse-catalogue.ts`: HTML tags stripped; from each catalogue row,
the calendar date and the "TD of Greatest Eclipse" are turned into a Julian Date in Terrestrial
Dynamical Time (Gregorian calendar; rounded to 1e-5 day, 0.9 s); the eclipse type is cut to its
first letter (solar P partial, A annular, T total, H hybrid; lunar N penumbral, P partial,
T total), dropping the catalogue's qualifiers such as `Pb`, `T+` or `Nx`; gamma is kept as
printed. The other columns are not used. The two lists are merged and sorted by date:
452 solar eclipses (228 + 224) and 457 lunar eclipses (229 + 228), 909 in all.
