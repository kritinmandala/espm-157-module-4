#!/usr/bin/env python3
"""Check the app's values against fresh downloads of the original sources.

This is the data-value cross-check described in design.md. It uses the same
shared parser as the build script, checks the bundled files against fresh
downloads of the NOAA and NSIDC sources, and checks key values against the
climate-module notebook.

Run it from the repository root:

    python scripts/verify_data.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from data_common import annual_co2, load_co2_monthly, load_ice

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "data"


def main() -> None:
    monthly_co2 = load_co2_monthly()
    co2 = annual_co2(monthly_co2)
    ice = load_ice()
    live = co2.merge(ice, on="year", how="inner").sort_values("year")
    live = live[(live["year"] >= 1979) & (live["year"] <= 2025)].reset_index(drop=True)

    with (DATA / "sea-ice-september.csv").open(newline="", encoding="utf-8") as handle:
        bundled = list(csv.DictReader(handle))
    assert len(live) == len(bundled) == 47
    for live_row, bundled_row in zip(live.itertuples(), bundled, strict=True):
        assert int(live_row.year) == int(bundled_row["year"])
        assert abs(float(live_row.extent) - float(bundled_row["extent"])) < 0.005, (
            live_row.year,
            live_row.extent,
            bundled_row["extent"],
        )

    map_payload = json.loads((DATA / "sea-ice-extent-polar.json").read_text(encoding="utf-8"))
    map_years = {
        feature["properties"]["year"] for feature in map_payload["features"]
    }
    assert map_years == set(range(1979, 2026))
    for year in (1979, 2000, 2012, 2024, 2025):
        assert any(
            feature["properties"]["year"] == year
            and feature["properties"]["kind"] == "polygon"
            for feature in map_payload["features"]
        )
        assert any(
            feature["properties"]["year"] == year
            and feature["properties"]["kind"] == "line"
            for feature in map_payload["features"]
        )

    baseline = live[(live.year >= 1979) & (live.year <= 2000)]
    expected = {
        1979: (336.84, 7.05),
        2000: (369.71, 6.25),
        2012: (394.06, 3.57),
        2023: (421.08, 4.38),
        2024: (424.60, 4.35),
        2025: (427.35, 4.75),
    }
    for year, (expected_co2, expected_ice) in expected.items():
        row = live[live.year == year].iloc[0]
        assert abs(row.co2 - expected_co2) < 0.01, (year, row.co2)
        assert abs(row.extent - expected_ice) < 0.005, (year, row.extent)

    correlation = live.co2.corr(live.extent)
    slope = live.co2.cov(live.extent) / live.co2.var()
    r_squared = correlation**2
    print(f"Live source check: {len(live)} complete years, {live.year.min()}-{live.year.max()}")
    print(f"  1979: CO2 {live[live.year == 1979].co2.iloc[0]:.2f} ppm, "
          f"September ice {live[live.year == 1979].extent.iloc[0]:.2f} million km2")
    print(f"  2012: CO2 {live[live.year == 2012].co2.iloc[0]:.2f} ppm, "
          f"September ice {live[live.year == 2012].extent.iloc[0]:.2f} million km2")
    print(f"  2024: CO2 {live[live.year == 2024].co2.iloc[0]:.2f} ppm, "
          f"September ice {live[live.year == 2024].extent.iloc[0]:.2f} million km2")
    print(f"  2025: CO2 {live[live.year == 2025].co2.iloc[0]:.2f} ppm, "
          f"September ice {live[live.year == 2025].extent.iloc[0]:.2f} million km2")
    print(f"  1979-2000 mean: CO2 {baseline.co2.mean():.2f} ppm, "
          f"ice {baseline.extent.mean():.2f} million km2")
    print(f"  correlation: {correlation:.4f}; slope: {slope:.4f} million km2 per ppm; "
          f"R2: {r_squared:.4f}")
    print("Bundled CSV and map files match the live source values.")

    august_2026 = monthly_co2[
        (monthly_co2.year == 2026) & (monthly_co2.month == 8)
    ].average.iloc[0]
    assert abs(august_2026 - 427.55) < 0.01
    assert abs(live[live.year == 2024].co2.iloc[0] - 424.60) < 0.01
    assert abs(live[live.year == 2024].extent.iloc[0] - 4.35) < 0.005

    print("Notebook cross-check: August 2026 CO2 427.55 ppm and September 2024 ice "
          "4.35 million km2 match the climate-module notebook; the app's 2024 annual "
          "CO2 mean is 424.60 ppm from the same monthly records.")


if __name__ == "__main__":
    main()
