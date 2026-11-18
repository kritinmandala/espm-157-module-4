"""Checks on the data files that web/ publishes.

These run without a browser and without network access. They catch a stale or
incomplete copy of the NSIDC sea ice values or the polar map files.
"""

import csv
import json
from pathlib import Path

DATA = Path(__file__).parent.parent / "web" / "data"


def load_csv():
    with (DATA / "sea-ice-september.csv").open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_sea_ice_csv_has_the_complete_record():
    rows = load_csv()
    assert len(rows) == 47
    assert [int(row["year"]) for row in rows] == list(range(1979, 2026))
    assert all(float(row["extent"]) > 0 for row in rows)
    assert all(float(row["area"]) > 0 for row in rows)
    assert rows[0]["source_dataset"] == "NSIDC-0051"
    assert rows[-1]["source_dataset"] == "NSIDC-0803"


def test_known_sea_ice_values_match_the_sources():
    values = {int(row["year"]): float(row["extent"]) for row in load_csv()}
    assert values[1979] == 7.05
    assert values[2012] == 3.57
    assert values[2023] == 4.38
    assert values[2024] == 4.35
    assert values[2025] == 4.75


def test_map_has_every_year_and_both_layers():
    payload = json.loads((DATA / "sea-ice-extent-polar.json").read_text(encoding="utf-8"))
    assert payload["features"]
    assert "EPSG:3411" in payload["projection"]
    years = {feature["properties"]["year"] for feature in payload["features"]}
    assert years == set(range(1979, 2026))
    for year in years:
        kinds = {
            feature["properties"]["kind"]
            for feature in payload["features"]
            if feature["properties"]["year"] == year
        }
        assert kinds == {"polygon", "line"}
    for feature in payload["features"]:
        assert feature["geometry"]["type"] in {"MultiPolygon", "MultiLineString"}


def test_map_coordinates_stay_in_the_polar_domain():
    payload = json.loads((DATA / "sea-ice-extent-polar.json").read_text(encoding="utf-8"))

    def coordinates(value):
        if isinstance(value, list) and value and isinstance(value[0], (int, float)):
            yield value
        elif isinstance(value, list):
            for item in value:
                yield from coordinates(item)

    for feature in payload["features"]:
        for x, y in coordinates(feature["geometry"]["coordinates"]):
            assert abs(x) <= 7000
            assert abs(y) <= 7000


def test_basemap_has_land_graticule_and_labels():
    payload = json.loads((DATA / "basemap-polar.json").read_text(encoding="utf-8"))
    assert payload["land"]["type"] == "MultiPolygon"
    assert len(payload["graticule"]) == 18
    names = {label["name"] for label in payload["labels"]}
    assert {"Alaska", "Canada", "Greenland", "Siberia", "Scandinavia"} <= names
