# Test fixtures

`co2_mm_mlo.txt` is an unmodified copy of NOAA GML's Mauna Loa monthly CO₂ file,
downloaded on 18 November 2026 from
<https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt>. The browser tests
serve it in place of the live URL so that a test run is deterministic and does
not depend on the network. The app still fetches the live NOAA file when it is
published.

The fixture is real data, not generated or placeholder data.
