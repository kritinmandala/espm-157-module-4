# Design document

## Readers

The app is for people interested in seeing the relationship between atmospheric CO₂ and
Arctic sea ice over time. Readers input a specific year and the app outputs the CO₂ and
sea ice values for that year, charts, and a visualization on a polar map. The page explains
its units, sources, and what counts as a complete year, so a reader outside the class can
use it without reading the README.

## Data

- Mauna Loa monthly CO₂ (requires cleaning):
  <https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt>
- NOAA/NSIDC Sea Ice Extent, Northern Hemisphere monthly data:
  <https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/>

The app uses **1979–2025**, the years covered by both records. The CO₂ file starts in 1958,
but the sea ice record starts in 1979. The app leaves out 2026: the sea ice September file
has a 2026 value, but the CO₂ file only runs through September 2026, so a 2026 annual mean
would not be a complete year.

**CO₂ cleaning.** The `.txt` file has a prose header, whitespace-separated columns, and
negative sentinels (`-1`, `-9.99`, `-0.99`) in the `ndays`, `sdev`, and `unc` columns. The
app skips comment lines, reads `year`, `month`, and the `average` column, treats negative
averages as missing, and keeps a year only when all 12 months have a value. The annual CO₂
value is the mean of the 12 monthly means, in ppm.

**Sea ice cleaning.** `N_09_extent_v4.0.csv` has one row per year for September. The app
masks negative values (`-9999`) as missing and uses the September `extent` column, in
million km². September is the month of the annual minimum. The value is the **September
monthly mean**, not the single-day minimum. NSIDC's Sea Ice Today page may quote a
slightly different monthly value (4.38 for September 2024) because it is a different
product or update; the app and notebook use the monthly file's 4.35. The `source_dataset`
column is preserved: 2025 uses
NSIDC-0803; earlier years use NSIDC-0051.

**Map.** The September extent polygons and ice-edge polylines come from the NSIDC monthly
shapefiles under
<https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/shapefiles/shp_extent/09_Sep/>.
They are projected to EPSG:3411, the NSIDC polar stereographic grid. Natural Earth 1:110m
land is the gray basemap. The build script drops isolated grid cells more than 4,000 km
from the pole; a few source files contain such cells near 46°N, which cannot be September
Arctic sea ice and are artifacts of the source geometry.

**Why some data are copied into the repository.** NSIDC's download server does not send
`Access-Control-Allow-Origin`, so a browser running on GitHub Pages cannot fetch the CSV or
shapefiles directly. The NOAA server does send that header, so the app fetches the live CO₂
file at runtime. `scripts/build_data.py` downloads the original NSIDC CSV and shapefiles and
writes the small derived files in `web/data/`:

- `sea-ice-september.csv` — the September extent values used by the charts.
- `sea-ice-extent-polar.json` — one polygon and one line per year, in EPSG:3411 kilometres.
- `basemap-polar.json` — Natural Earth land, graticule, and map labels.

Run `python scripts/build_data.py` to refresh the copies. The script writes the source URLs,
citation, and retrieval date into the JSON metadata. The app links to the original sources
and explains this in the "About the data" section.

**Check against the notebook.** The climate-module notebook
(`climate-module-kritinmandala/climate.ipynb`, outside this repository) loads the same NOAA
CO₂ file and NSIDC September file, masks the NSIDC `-9999` values, and reports September
2024 = 4.35 million km² and August 2026 CO₂ = 427.55 ppm. `scripts/verify_data.py` fetches
the live URLs, recomputes the series, and compares it with the bundled files. Its output:

```
47 complete years, 1979-2025
1979: CO2 336.83 ppm, September ice 7.05 million km2
2012: CO2 394.06 ppm, September ice 3.57 million km2
2024: CO2 424.60 ppm, September ice 4.35 million km2
2025: CO2 427.35 ppm, September ice 4.75 million km2
1979-2000 mean: CO2 353.13 ppm, ice 6.91 million km2
correlation: -0.8903; slope: -0.0391 million km2 per ppm; R2: 0.7926
```

The app's default 2012 view shows 394.06 ppm and 3.57 million km², matching the same source
values used by the notebook. The notebook's cross-check with NSIDC Sea Ice Today noted that
September 2024 was 4.38 in that product while the monthly file used here gives 4.35. The
app and notebook use the monthly file value; the difference is between NSIDC products or
updates, not a calculation error.

## Interactions

- The **year dropdown** is the full view. It shows the year's CO₂ and sea ice values, the
  scatter and time-series charts, the data table, and the map.
- The **year slider** is map-only. Moving it changes the map and its caption but hides the
  numbers and charts. The dropdown is cleared, so the reader must choose a year in the
  dropdown to bring the full view back. This is the behavior described in the original
  design.
- The **map** supports dragging to pan, mouse-wheel zoom, +/− buttons, and keyboard pan,
  zoom, and reset. The selected September is filled light blue; the 1979 September outline
  is a dashed orange line for comparison.
- The selected year is stored in the URL (`?year=2012`) and map-only years use `?map=2012`,
  so a reader can share a view.
- The app has more than two controls (dropdown, slider, zoom, reset), and each one changes
  something meaningful for the question.

## Path

The Web Path: a responsive app published from `web/` to GitHub Pages, because it is easy to
access and needs no server or install step.

## Dependencies

| Library or service | Version | Purpose |
| --- | --- | --- |
| Observable Plot | 0.6.17 | Draws the scatter plot and the two line charts (axes, labels, tooltips, highlighting). Loaded from jsDelivr as an ES module at a pinned version. |
| Browser APIs | Current browser | `fetch` to read the NOAA file, SVG for the map, `URL`/`URLSearchParams` for shareable state, `AbortController` for timeout handling, and `Intl` for number formatting. No framework is used. |
| NOAA GML CO₂ file | File dated 9 October 2026 | The live CO₂ measurements, fetched from `gml.noaa.gov` at runtime. |
| NSIDC Sea Ice Index (G02135) | Version 4 | September extent values and the September extent/edge map geometry. |
| Natural Earth land | 1:110m | The gray land basemap in `web/data/basemap-polar.json` (public domain). |
| pytest | 9.2.0 | Runs the test suite. |
| pytest-playwright | 0.10.0 | Provides the Playwright browser fixtures for the tests. |
| Playwright | 1.65.2 | Drives the headless browser in tests. Chromium headless shell 159.0.8154.6 is installed by the workflow. |
| geopandas | 1.2.0 | Build script only: reads the NSIDC shapefiles and reprojects/clips the layers. |
| pandas | 2.3.3 | Build and verification scripts: parses the NOAA and NSIDC CSV files. |
| shapely | 2.2.0 | Build script only: repairs, unions, simplifies, and orients polygons and lines. |
| pyproj | 3.8.0 | Build script only: transforms Natural Earth and graticule coordinates to EPSG:3411. |
| pyogrio | 0.13.0 | Build script only: GeoPandas' shapefile/GeoJSON driver. |
| GitHub Actions `actions/checkout` | v7 | Checks out the repository for the test and Pages workflows. |
| GitHub Actions `actions/setup-python` | v7 | Sets up Python 3.12 for the test workflow. |
| GitHub Actions `actions/upload-pages-artifact` | v5 | Uploads `web/` as the Pages artifact. |
| GitHub Actions `actions/deploy-pages` | v5 | Publishes the artifact to GitHub Pages. |

The versions used by the app itself are pinned in the CDN import; the test and build
versions are pinned in `requirements.txt` and `requirements-build.txt`. No keys, tokens, or
private services are used.

I did not use DuckDB-WASM. The data are small (about 823 monthly CO₂ rows and 48 September
sea ice rows), so plain JavaScript parsing is faster to load and easier to audit than a
multi-megabyte WASM database. I did not use MapLibre GL JS: the map is a static projected
SVG built from the NSIDC geometry, so a tile basemap and a full map engine are unnecessary.
Plot's jsDelivr build includes its own D3 modules, so there is no separate D3 import.

## Tests

`tests/test_app.py` opens the published `web/` folder in a headless Chromium browser and
checks that:

- The default 2012 view shows 394.06 ppm, 3.57 million km², all three chart SVGs, the map,
  the map caption, and labeled chart axes.
- Choosing 2024 in the dropdown updates the values to 424.60 ppm and 4.35 million km² and
  updates the map caption/aria-label and the highlighted chart year.
- Moving the slider with the keyboard changes the map year, clears the dropdown, hides the
  numbers and charts, and shows the map-only note.
- Choosing a year in the dropdown after using the slider restores the values and charts.
- The map zooms with the + button and pans/resets with the arrow and 0 keys.
- Tab moves from the year dropdown to the map-year slider.
- The data table has 47 rows, marks the selected year, and ends at 2025.
- A 390×844 phone viewport has no horizontal overflow and still shows the map.
- A blocked NOAA request shows an alert and leaves the controls disabled; a blocked sea ice
  CSV shows the sea ice alert; a blocked map file still leaves the charts usable and shows
  a map error.
- A request for the incomplete 2026 year reports the problem, falls back to 2012, and 2026
  is not offered in the dropdown.
- The browser console has no errors during the normal operating tests. The error-path
  tests check the visible alerts instead, because an aborted fetch is expected to log a
  resource error.

The live NOAA request is replaced in the tests by an unmodified copy of the real file in
`tests/fixtures/co2_mm_mlo.txt`, so the tests do not depend on NOAA being online and cannot
silently pass with different values. The copy is documented in the fixtures README.

The browser CO₂ parser and the shared Python parser in `scripts/data_common.py` use the
same completeness rule: at least five whitespace-separated columns, all 12 months, negative
values treated as missing, and duplicate months averaged. The browser tests compare the
rendered 2012 and 2024 values with the fixture; `scripts/verify_data.py` reuses the Python
parser to check the bundled data against fresh source values, and the notebook is the
independent value check.

`tests/test_data.py` checks the bundled sea ice CSV and map JSON without a browser: 47 rows
for 1979–2025, known values (1979 = 7.05, 2012 = 3.57, 2024 = 4.35, 2025 = 4.75), source
dataset names, a polygon and a line for every year, reasonable polar coordinates, and the
land/graticule/labels in the basemap.

Run everything with `pytest tests`. The GitHub Actions check installs the pinned
`requirements.txt`, installs Chromium with `playwright install --with-deps --only-shell
chromium`, and runs the same command.

**What the tests would not catch.** A CDN outage or a change to the Plot ES module would
break the charts even though the data files are fine. A future change to NOAA's column
format could make the parser drop years; the app would show an error only if no years
remain. A change to NSIDC's URL, version, or CORS policy would not update the committed
copy until `scripts/build_data.py` is rerun. The map is checked structurally, not pixel by
pixel, so a projection or label-overlap problem on a specific screen could escape. The
tests do not run a real screen reader, forced-colors mode, or a color-blindness simulator;
they check the semantics, keyboard paths, and non-color cues instead.

## License

The code is under the **MIT License** (`LICENSE`). MIT is short, permissive, and lets a
reader reuse the app with attribution; it is compatible with the course template and with
the data terms below. The license covers the HTML, CSS, JavaScript, Python scripts, and
tests, not the data.

- **NOAA GML Mauna Loa CO₂.** The file says the data are "made freely available to the
  public and the scientific community" and asks for citation. As U.S. federal government
  work, the data are public domain in the United States. The app may use and redistribute
  them; it links to NOAA and credits NOAA GML. The test fixture is a copy of that public
  file.
- **NSIDC Sea Ice Index, Version 4 (G02135).** The dataset page states: "As a condition of
  using these data, you must cite the use of this data set." It does not attach a separate
  Creative Commons or OSI license, and its terms do not prohibit redistribution. The app
  cites Fetterer et al. (2025), DOI 10.7265/a98x-0f50, in the About section, the footer,
  and the JSON metadata, and redistributes only the small derived September values and map
  geometry needed for this educational app. Anyone reusing the data should keep that
  citation and check NSIDC's current terms.
- **Natural Earth.** 1:110m land is public domain; use and redistribution are allowed. The
  source URL is recorded in `basemap-polar.json`.
- **Observable Plot.** ISC license. It is loaded from jsDelivr at runtime and is not
  redistributed in this repository; its bundled D3 modules are also permissively licensed.
  The Python test/build dependencies are development-only and are not shipped to readers.

The data licenses and the code license are separate: the MIT license does not override
NOAA's or NSIDC's citation requirements, and the app keeps those credits visible.

## Accessibility and layout

**Phone and small screens.** The layout uses a fluid `main` width, grid columns that collapse
to one column, `clamp()` type, flexible stat cards, and charts that redraw at the container's
width. The Playwright test sets a 390×844 viewport and checks
`document.documentElement.scrollWidth <= window.innerWidth`; I also checked 320×700,
768×1024, and 1280×900 manually and in a screen-measurement script. The data table scrolls
inside its own `overflow-x: auto` wrapper rather than widening the page. The map is an SVG
with a fixed viewBox, so it scales without horizontal overflow; its labels use a larger SVG
font size on narrow screens so they remain readable.

**Keyboard.** The page has a skip link. The year dropdown and slider are native controls, so
they work with Tab, arrow keys, Home/End, and Enter. A test presses Tab from the dropdown and
checks that the slider receives focus. The map is focusable; with it focused, the arrow keys
pan, `+`/`−` zoom, and `0` resets, and the +/−/Reset buttons do the same for readers who
prefer controls. All buttons and form controls have a visible `:focus-visible` outline. The
charts are images with text alternatives, and the full data table is available without the
charts.

**Color and color blindness.** The map encodes the selected September as a filled light-blue
area and the 1979 comparison as a dashed orange outline, so the comparison survives without
color: one is a fill and one is a dashed line, and the legend names both. Land is a gray fill
with a contrasting outline; the legend also names it. The charts put CO₂ and sea ice in
separate panels, use direct labels on the selected point, and make the trend line dashed;
the scatter's selected point is larger and labeled with its year. No information is carried
by color alone. The palette has light and dark variants. Representative contrast ratios:
body text 16.4:1 (light) and 14.8:1 (dark); muted text 6.5:1 and 8.0:1; chart orange/blue
5.0:1 and 5.7:1 on the light surface; map ice on ocean 7.5:1 (light) and 7.4:1 (dark); the
land outline is 5.3:1 (light) and 6.8:1 (dark) on the ocean. The map's land fill is
deliberately lower contrast in dark mode, but its outline and the legend keep it
identifiable, while the ice remains the high-contrast layer.

**Screen readers and status.** Headings, labels, the form, the map, the charts, and the table
use semantic HTML. The status line is `role="status"` while loading and becomes
`role="alert"` on an error. The map-only note is a `role="status"` message so a reader who
moves the slider is told that the charts have been hidden. Each chart container has a
dynamic `aria-label` describing the selected year's values; the generated Plot SVG is
`aria-hidden` so its tick marks are not read as a wall of numbers. The map's `aria-label`
states the year and extent and explains the keyboard controls. The selected table row is
marked with `aria-current="true"`. The app also respects `prefers-color-scheme` and
`prefers-reduced-motion`.

**Known limits.** The map's spatial pattern is summarized in text rather than described
point by point. Pinch-to-zoom on a touch screen is not implemented; touch users can drag and
use the +/− buttons. The Plot tooltips are pointer/touch aids, not the only way to read the
values, and the data table provides every value for keyboard and screen-reader users. I did
not run a real screen reader or a forced-colors simulation as part of the automated tests;
those are the areas most likely to need a manual check on another device.
