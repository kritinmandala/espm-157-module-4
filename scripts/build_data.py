#!/usr/bin/env python3
"""Create the app's sea ice and basemap files from the original data sources.

The NSIDC download server does not send CORS headers, so the browser cannot read
its CSV and shapefile files directly from GitHub Pages. This script fetches the
original files, cleans them, projects the map layers to the NSIDC polar
stereographic grid, and writes compact JSON files to web/data/.

Run it from the repository root:

    python scripts/build_data.py

The app itself fetches the Mauna Loa CO2 file from NOAA at runtime. This script
uses that same CO2 file only to decide which years are complete enough to show.
"""

from __future__ import annotations

import io
import json
import tempfile
import time
import zipfile
from datetime import date
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point, box, mapping
from shapely.geometry.polygon import orient
from shapely.validation import make_valid

from data_common import ICE_URL, fetch, load_records

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "data"

SHAPE_URL = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/shapefiles/shp_extent/09_Sep/"
LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"

PROJECTION_NOTE = "NSIDC Sea Ice Polar Stereographic North (EPSG:3411); coordinates in kilometers"

LABELS = [
    ("Alaska", -150, 64),
    ("Canada", -100, 62),
    ("Greenland", -42, 72),
    ("Siberia", 100, 65),
    ("Scandinavia", 20, 65),
]


def load_shapefile(year: int, kind: str) -> gpd.GeoDataFrame:
    url = f"{SHAPE_URL}extent_N_{year}09_{kind}_v4.0.zip"
    with tempfile.TemporaryDirectory() as directory:
        with zipfile.ZipFile(io.BytesIO(fetch(url))) as archive:
            archive.extractall(directory)
        files = list(Path(directory).glob("*.shp"))
        if not files:
            raise RuntimeError(f"No shapefile inside {url}")
        frame = gpd.read_file(files[0])
    if frame.crs is None:
        frame = frame.set_crs(3411)
    elif frame.crs.to_epsg() != 3411:
        frame = frame.to_crs(3411)
    return frame


def polygon_parts(geometry):
    if geometry is None or geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        yield geometry
    elif geometry.geom_type == "MultiPolygon":
        yield from geometry.geoms
    elif geometry.geom_type == "GeometryCollection":
        for part in geometry.geoms:
            yield from polygon_parts(part)


def line_parts(geometry):
    if geometry is None or geometry.is_empty:
        return
    if geometry.geom_type == "LineString":
        yield geometry
    elif geometry.geom_type == "MultiLineString":
        yield from geometry.geoms
    elif geometry.geom_type == "GeometryCollection":
        for part in geometry.geoms:
            yield from line_parts(part)


def clean_polygons(frame: gpd.GeoDataFrame):
    geometries = [
        make_valid(geometry)
        for geometry in frame.geometry
        if geometry is not None and not geometry.is_empty
    ]
    geometry = shapely.union_all(geometries)
    geometry = make_valid(geometry)
    geometry = geometry.simplify(5_000, preserve_topology=True)
    pole = Point(0, 0)
    polygons = [
        orient(part, sign=1.0)
        for part in polygon_parts(geometry)
        if part.area > 0 and part.distance(pole) <= 4_000_000
    ]
    if not polygons:
        raise RuntimeError("A sea ice polygon shapefile produced no polygons.")
    return shapely.MultiPolygon(polygons)


def clean_lines(frame: gpd.GeoDataFrame):
    geometries = [
        make_valid(geometry)
        for geometry in frame.geometry
        if geometry is not None and not geometry.is_empty
    ]
    geometry = shapely.union_all(geometries)
    geometry = make_valid(geometry)
    geometry = geometry.simplify(2_000, preserve_topology=False)
    lines = [part for part in line_parts(geometry) if not part.is_empty]
    if not lines:
        raise RuntimeError("A sea ice line shapefile produced no lines.")
    return shapely.MultiLineString(lines)


def round_coordinates(value):
    if isinstance(value, dict):
        return {key: round_coordinates(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [round_coordinates(item) for item in value]
    if isinstance(value, str):
        return value
    return int(round(value))


def to_km(geometry):
    return shapely.transform(geometry, lambda coordinates: coordinates / 1_000.0)


def geometry_json(geometry):
    return round_coordinates(mapping(geometry))


def build_extent(records: pd.DataFrame) -> None:
    features = []
    for row in records.itertuples():
        year = int(row.year)
        polygon = geometry_json(to_km(clean_polygons(load_shapefile(year, "polygon"))))
        line = geometry_json(to_km(clean_lines(load_shapefile(year, "polyline"))))
        properties = {
            "year": year,
            "extent_million_km2": round(float(row.extent), 2),
            "source_dataset": row.source_dataset,
        }
        features.append(
            {
                "type": "Feature",
                "properties": {**properties, "kind": "polygon"},
                "geometry": polygon,
            }
        )
        features.append(
            {
                "type": "Feature",
                "properties": {**properties, "kind": "line"},
                "geometry": line,
            }
        )
        print(f"  {year}: {row.extent:.2f} million km2")
        time.sleep(0.1)

    payload = {
        "type": "FeatureCollection",
        "projection": PROJECTION_NOTE,
        "source": "NSIDC Sea Ice Index, Version 4 (G02135), September extent polygons and polylines",
        "source_urls": {
            "monthly_data": ICE_URL,
            "shapefiles": SHAPE_URL,
        },
        "citation": (
            "Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. & "
            "Stafford, T. (2025). Sea Ice Index (G02135, Version 4). National Snow and "
            "Ice Data Center. https://doi.org/10.7265/a98x-0f50"
        ),
        "retrieved": date.today().isoformat(),
        "features": features,
    }
    path = OUT / "sea-ice-extent-polar.json"
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {path.relative_to(ROOT)} ({len(features)} features)")


def load_land():
    with tempfile.NamedTemporaryFile(suffix=".geojson") as temporary:
        temporary.write(fetch(LAND_URL))
        temporary.flush()
        land = gpd.read_file(temporary.name)
    land = land.to_crs(4326).clip(box(-180, 20, 180, 90))
    land = land.to_crs(3411).clip(box(-7_000_000, -7_000_000, 7_000_000, 7_000_000))
    land = land[~land.is_empty]
    geometry = shapely.union_all(list(land.geometry))
    geometry = make_valid(geometry).simplify(2_000, preserve_topology=True)
    polygons = [orient(part, sign=1.0) for part in polygon_parts(geometry) if part.area > 0]
    if not polygons:
        raise RuntimeError("Natural Earth land produced no polygons.")
    return shapely.MultiPolygon(polygons)


def build_basemap() -> None:
    transformer = Transformer.from_crs(4326, 3411, always_xy=True)
    graticule = []
    for latitude in (40, 50, 60, 66.56, 70, 80):
        points = [transformer.transform(longitude, latitude) for longitude in range(-180, 181, 5)]
        graticule.append(geometry_json(to_km(LineString(points))))
    for longitude in range(-180, 180, 30):
        points = [transformer.transform(longitude, latitude) for latitude in range(40, 91, 2)]
        graticule.append(geometry_json(to_km(LineString(points))))
    labels = []
    for name, longitude, latitude in LABELS:
        x, y = transformer.transform(longitude, latitude)
        labels.append({"name": name, "coordinates": [round(x / 1_000), round(y / 1_000)]})

    payload = {
        "projection": PROJECTION_NOTE,
        "source": "Natural Earth 1:110m land, public domain",
        "source_url": LAND_URL,
        "retrieved": date.today().isoformat(),
        "land": geometry_json(to_km(load_land())),
        "graticule": graticule,
        "labels": labels,
    }
    path = OUT / "basemap-polar.json"
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {path.relative_to(ROOT)}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Loading the original CO2 and September sea ice values...")
    records = load_records()
    print(f"  {len(records)} complete years: {int(records.year.min())}-{int(records.year.max())}")
    records[["year", "extent", "area", "source_dataset"]].to_csv(
        OUT / "sea-ice-september.csv", index=False, float_format="%.2f"
    )
    print(f"Wrote {(OUT / 'sea-ice-september.csv').relative_to(ROOT)}")
    print("Loading September shapefiles...")
    build_extent(records)
    print("Building the Natural Earth polar basemap...")
    build_basemap()


if __name__ == "__main__":
    main()
