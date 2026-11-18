"""Shared parsing for the NOAA CO2 and NSIDC September sea ice files.

Both the build script and the verification script use these functions so the
two Python paths cannot silently disagree about which rows are complete.
"""

from __future__ import annotations

import io
import urllib.request

import pandas as pd

CO2_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt"
ICE_URL = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv"
USER_AGENT = "espm-157-module-4-app/1.0 (educational student project)"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def load_co2_monthly() -> pd.DataFrame:
    rows = []
    for line in fetch(CO2_URL).decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split()
        if len(parts) < 5:
            continue
        try:
            year = int(parts[0])
            month = int(parts[1])
            average = float(parts[3])
        except ValueError:
            continue
        if average < 0:
            continue
        rows.append((year, month, average))
    return pd.DataFrame(rows, columns=["year", "month", "average"])


def annual_co2(monthly: pd.DataFrame) -> pd.DataFrame:
    monthly = monthly.groupby(["year", "month"], as_index=False)["average"].mean()
    annual = monthly.groupby("year").agg(
        months=("month", "nunique"), co2=("average", "mean")
    )
    return annual[annual["months"] == 12].reset_index()


def load_ice() -> pd.DataFrame:
    frame = pd.read_csv(
        io.StringIO(fetch(ICE_URL).decode("utf-8")),
        skipinitialspace=True,
    )
    frame = frame[frame["mo"] == 9].copy()
    frame["extent"] = pd.to_numeric(frame["extent"], errors="coerce")
    frame["area"] = pd.to_numeric(frame["area"], errors="coerce")
    frame.loc[frame["extent"] < 0, "extent"] = float("nan")
    frame.loc[frame["area"] < 0, "area"] = float("nan")
    frame = frame.dropna(subset=["extent"]).sort_values("year")
    return frame[["year", "extent", "area", "source_dataset"]]


def load_records() -> pd.DataFrame:
    records = annual_co2(load_co2_monthly()).merge(load_ice(), on="year", how="inner")
    records = records.dropna(subset=["co2", "extent"]).sort_values("year")
    if records.empty:
        raise RuntimeError("The CO2 and sea ice files have no complete years in common.")
    return records.reset_index(drop=True)
