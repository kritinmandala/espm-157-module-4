# 🤖 Applications Module: Arctic sea ice and atmospheric CO₂

[![App check](../../actions/workflows/check.yml/badge.svg)](../../actions/workflows/check.yml)

## Team Members

🦸 Kritin Mandala

🌐 App: <https://kritinmandala.github.io/espm-157-module-4/>

## The app

The app explores the relationship between atmospheric CO₂ and Arctic sea ice over time. A
year dropdown shows the annual mean CO₂ at Mauna Loa, the September sea ice extent, the
scatter and time-series charts, and a September sea ice map for that year. A second slider
changes only the map, so a reader can sweep through 1979–2025 and see the ice edge move
while the numbers and charts stay out of the way. The map can be dragged, zoomed with the
buttons, mouse wheel, or +/− keys, and reset with 0.

Data are read from the original sources: the
[NOAA GML Mauna Loa CO₂ file](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt)
is fetched by the browser at runtime, and the
[NSIDC Sea Ice Index](https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/) is
used for the September extent values and map geometry. NSIDC's download server does not send
CORS headers, so `scripts/build_data.py` creates the small derived copies in `web/data/`
from the original CSV and shapefiles. The app explains the data, units, missing-value
handling, and citations on the page itself.

The design decisions, dependency list, test coverage, license analysis, and accessibility
checks are in [`design.md`](design.md). The tests are in [`tests/`](tests/) and run with
`pytest tests`. The app is published from `web/` to GitHub Pages by
[the site workflow](.github/workflows/pages.yml).

## 🎓 Learning Objectives

🎛️ Reactive design: controls, state, and what happens when a reader changes something  
🖥️ Where code runs: in the reader's browser or on a server, and what each one costs  
📦 Dependencies: what each library does and where it comes from  
✅ Continuous integration that tests an app in a real browser  
🚀 Shipping: continuous deployment to GitHub Pages  
⚖️ Open source licenses for code and for data  
📱 Layout that works on a phone, and accessibility  

## 📖 Content Overview

[💯 Assignment rubric](rubric.md)  
[📝 Design document](design.md)  

In modules 1 to 3 you answered questions in notebooks. A notebook works for the person who
runs it. An app lets anyone with a link ask their own version of the question: pick a
country, a city, a species or a threshold, and see the answer change.

In this module you take an analysis from one of the earlier modules and turn it into an
interactive app that a reader outside the class could use. You are in charge of the parts
that the earlier modules set up for you: dependencies, tests, deployment and the license.

The starter app in [`web/`](web/) was deliberately small; this submission replaces it with
an app about Arctic sea ice and Mauna Loa CO₂. The app uses Observable Plot for the charts
and a projected SVG map built from NSIDC geometry, with plain JavaScript parsing for the
small data files.

### Streamlit and client-side apps

In past years this module used [Streamlit](https://streamlit.io/), and the
[previous template](https://github.com/espm-157/app-python-template) is still a good
illustration of the idea: each widget call such as `st.selectbox` draws a control and
returns its value, and Streamlit re-runs the whole script whenever a reader touches one.
That model needs a Python server that is always running, which has to be hosted, kept
awake and paid for.

This year we build the same kind of app to run entirely in the reader's browser. GitHub
Pages serves the files and the browser does the computing, so there is no server to run,
and the app keeps working for as long as the files are online. The tools are the ones we
already know:

| In the notebooks | In the browser |
|---|---|
| `ibis` on DuckDB | [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview), the same SQL on the same files |
| `plotnine` | [Observable Plot](https://observablehq.com/plot/), the same grammar of graphics |
| `leafmap.maplibregl` | [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/), the library underneath leafmap |
| `st.selectbox`, `st.slider` | HTML `<select>` and `<input>`, or [Observable Inputs](https://observablehq.com/framework/inputs/) |

The starter app is written in JavaScript, and your coding agent can write JavaScript as
well as Python. Your job is to decide what the app should do, check that it does it, and
explain your choices. The browser's developer tools (the console and the network tab) are
where you see errors and what data the app loads.

### Kinds of apps

An app does not have to be a dashboard. A few kinds that fit this module:

- **Data explorer.** Pick a country, a measure or a year range and see the chart change, like
  the starter app.
- **Map explorer.** Pick a place or a layer and see what the data say there, building on the
  spatial module.
- **What-if calculator.** The controls set the inputs to a calculation rather than a filter:
  if emissions follow this path, when is the remaining carbon budget used up?
- **Model explorer.** Sliders set the parameters of a population, fisheries or disease model,
  and the app draws what the model predicts.
- **Look up your own place.** Enter a city or a zip code and see how it compares with
  everywhere else.
- **Guess, then reveal.** The reader draws or guesses a trend before the app shows the real
  data.

A game-like app can work too, such as managing a fishery over twenty years, as long as it runs
on real data or a model that you check against your Python version from the earlier module.

### Readings

The course website has three pages for this module:

- [HTML, CSS and JavaScript](https://espm-157.carlboettiger.info/apps-web-basics): what each
  of the three files in `web/` does and how they fit together.
- [Frameworks and examples](https://espm-157.carlboettiger.info/apps-examples): published apps on
  the themes of modules 1 to 3, and the chart, map and layout libraries they are built with.
- [Open source licenses](https://espm-157.carlboettiger.info/apps-licenses): permissive and
  copyleft licenses, the `LICENSE` file, and the licenses of the data we use.

### Paths

Most teams will build path 1. The others cover the same objectives in a different form.

1. **Web app.** A responsive app published from `web/` to GitHub Pages.
2. **Installable app.** The web app plus a manifest and a service worker, so that it can be
   installed to a phone's home screen and works offline (a progressive web app).
3. **Command-line tool.** A Python package that others can install with `pip`, published
   with a version number and a changelog.

## What to hand in

- Your app, with tests in `tests/` that pass on GitHub Actions.
- [`design.md`](design.md), filled in.
- A `LICENSE` file. This template has none on purpose; choosing one is part of the
  assignment. See [Open source licenses](https://espm-157.carlboettiger.info/apps-licenses).
- An updated README with a link to your app and a short statement on AI use.

## Setup

To preview the app from the JupyterHub, run `make serve` in a terminal and open the link it
prints. Stop it with Ctrl-C.

To run the tests, install the packages in `requirements.txt` and a headless browser once:

```
pip install -r requirements.txt
playwright install --only-shell chromium
make test
```

The sea ice CSV and map files in `web/data/` are generated from the original NSIDC CSV and
shapefiles. To rebuild them, install `requirements-build.txt` and run
`python scripts/build_data.py`. To check the bundled values against fresh downloads, run
`python scripts/verify_data.py`.

GitHub Actions runs two workflows on every push. The app check runs the tests in a headless
browser. The site workflow publishes the `web/` folder to GitHub Pages.

Anything in a client-side app is public, including any key or token in its code. Never put
one in `web/`. A GitHub Pages site is public even when its repository is private.

## Links

[🌐 Course Website](https://espm-157.carlboettiger.info/)

## AI use

Kilo (deepseek-v4-flash) helped write the app, the data build script, the tests, and this
documentation under my direction. I chose the question and data sources, reviewed the data
cleaning and values, checked the app against the climate-module notebook, ran the tests, and
checked desktop and phone layouts. No data are generated or placeholder; the app loads NOAA
and NSIDC data and shows an error if a source fails. See [`DISCLOSURE.md`](DISCLOSURE.md).
