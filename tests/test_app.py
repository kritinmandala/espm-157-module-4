"""Browser tests for the Arctic sea ice and CO₂ app.

Run them with `pytest`. The tests serve the same web/ folder that GitHub Pages
publishes and replace the live NOAA CO₂ request with an unmodified local copy of
the real file, so they do not depend on NOAA being online.
"""

import functools
import http.server
import re
import threading
from pathlib import Path

import pytest
from playwright.sync_api import expect

WEB = Path(__file__).parent.parent / "web"
CO2_FIXTURE = Path(__file__).parent / "fixtures" / "co2_mm_mlo.txt"


@pytest.fixture(scope="session")
def url():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=WEB)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/"
    server.shutdown()


def route_co2(page):
    body = CO2_FIXTURE.read_text(encoding="utf-8")
    page.route(
        "https://gml.noaa.gov/**",
        lambda route: route.fulfill(
            status=200,
            content_type="text/plain; charset=utf-8",
            body=body,
            headers={"Access-Control-Allow-Origin": "*"},
        ),
    )


@pytest.fixture
def app(page, url):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: message.type == "error" and errors.append(message.text))
    route_co2(page)
    page.goto(url)
    expect(page.locator("#year")).to_be_enabled(timeout=60_000)
    expect(page.locator("#details")).to_be_visible()
    expect(page.locator("#scatter svg")).to_be_visible(timeout=60_000)
    expect(page.locator("#map svg")).to_be_visible(timeout=60_000)
    yield page
    assert errors == []


def test_default_year_shows_values_charts_and_map(app):
    expect(app.locator("#details-year")).to_have_text("2012")
    expect(app.locator("#co2-value")).to_have_text("394.06")
    expect(app.locator("#ice-value")).to_have_text("3.57")
    expect(app.locator("#co2-series svg")).to_be_visible()
    expect(app.locator("#ice-series svg")).to_be_visible()
    expect(app.locator("#scatter")).to_contain_text("Annual mean CO₂ (ppm)")
    expect(app.locator("#scatter")).to_contain_text("million km²")
    expect(app.locator("#map svg")).to_have_attribute(
        "aria-label", re.compile("September 2012")
    )


def test_dropdown_updates_values_charts_and_map(app):
    app.select_option("#year", "2024")
    expect(app.locator("#details-year")).to_have_text("2024")
    expect(app.locator("#co2-value")).to_have_text("424.60")
    expect(app.locator("#ice-value")).to_have_text("4.35")
    expect(app.locator("#map-caption")).to_contain_text("September 2024")
    expect(app.locator("#map-caption")).to_contain_text("4.35")
    expect(app.locator("#map svg")).to_have_attribute(
        "aria-label", re.compile("September 2024")
    )
    expect(app.locator("#scatter-caption")).to_contain_text("2024")


def test_slider_shows_only_the_map(app):
    slider = app.locator("#map-year")
    slider.focus()
    app.keyboard.press("ArrowRight")
    expect(app.locator("#map-year-label")).to_have_text("2013")
    expect(app.locator("#year")).to_have_value("")
    expect(app.locator("#details")).to_be_hidden()
    expect(app.locator("#scatter svg")).to_be_hidden()
    expect(app.locator("#map-only-note")).to_be_visible()
    expect(app.locator("#map-caption")).to_contain_text("September 2013")
    expect(app.locator("#map svg")).to_be_visible()


def test_dropdown_restores_details_after_slider(app):
    slider = app.locator("#map-year")
    slider.focus()
    app.keyboard.press("ArrowRight")
    expect(app.locator("#details")).to_be_hidden()
    app.select_option("#year", "2012")
    expect(app.locator("#details")).to_be_visible()
    expect(app.locator("#map-only-note")).to_be_hidden()
    expect(app.locator("#map-year")).to_have_value("2012")
    expect(app.locator("#co2-value")).to_have_text("394.06")


def test_map_zoom_and_keyboard_controls(app):
    svg = app.locator("#map svg")
    expect(svg).to_have_attribute("data-zoom", "1.000")
    app.click("#zoom-in")
    expect(svg).not_to_have_attribute("data-zoom", "1.000")
    svg.focus()
    before = svg.get_attribute("data-pan-x")
    app.keyboard.press("ArrowLeft")
    assert svg.get_attribute("data-pan-x") != before
    app.keyboard.press("0")
    expect(svg).to_have_attribute("data-zoom", "1.000")


def test_keyboard_moves_between_controls(app):
    app.locator("#year").focus()
    app.keyboard.press("Tab")
    expect(app.locator("#map-year")).to_be_focused()


def test_all_years_are_in_the_data_table(app):
    app.locator(".data-table summary").click()
    expect(app.locator("#data-body tr")).to_have_count(47)
    expect(app.locator("#data-body tr.selected")).to_have_count(1)
    expect(app.locator("#data-body tr.selected")).to_contain_text("2012")
    expect(app.locator("#data-body tr").last).to_contain_text("2025")


def test_fits_a_phone_screen(app):
    app.set_viewport_size({"width": 390, "height": 844})
    overflow = app.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    assert not overflow
    expect(app.locator("#map svg")).to_be_visible()


def test_says_when_the_co2_data_cannot_load(page, url):
    page.route("https://gml.noaa.gov/**", lambda route: route.abort())
    page.goto(url)
    expect(page.get_by_role("alert")).to_contain_text(
        "CO₂ data could not be loaded", timeout=60_000
    )
    expect(page.locator("#year")).to_be_disabled()
    expect(page.locator("#details")).to_be_hidden()


def test_says_when_the_sea_ice_data_cannot_load(page, url):
    route_co2(page)
    page.route("**/data/sea-ice-september.csv", lambda route: route.abort())
    page.goto(url)
    expect(page.get_by_role("alert")).to_contain_text(
        "Sea ice data could not be loaded", timeout=60_000
    )
    expect(page.locator("#year")).to_be_disabled()


def test_map_failure_keeps_the_charts(page, url):
    route_co2(page)
    page.route("**/data/sea-ice-extent-polar.json", lambda route: route.abort())
    page.goto(url)
    expect(page.locator("#year")).to_be_enabled(timeout=60_000)
    expect(page.locator("#details")).to_be_visible()
    expect(page.locator("#scatter svg")).to_be_visible()
    expect(page.locator("#map [role='alert']")).to_contain_text(
        "Map data could not be loaded"
    )
    expect(page.locator("#zoom-in")).to_be_disabled()
    expect(page.locator("#map-year")).to_be_disabled()


def test_incomplete_year_reports_and_falls_back(page, url):
    route_co2(page)
    page.goto(url + "?year=2026")
    expect(page.get_by_role("alert")).to_contain_text(
        "There is no complete data for 2026", timeout=60_000
    )
    expect(page.locator("#details")).to_be_visible()
    expect(page.locator("#details-year")).to_have_text("2012")
    expect(page.locator("#year option[value='2026']")).to_have_count(0)

    page.select_option("#year", "2024")
    expect(page.locator("#details-year")).to_have_text("2024")
    expect(page.locator("#status")).to_be_hidden()

    page.goto(url + "?year=2026")
    expect(page.get_by_role("alert")).to_contain_text(
        "There is no complete data for 2026", timeout=60_000
    )
    page.locator("#map-year").focus()
    page.keyboard.press("ArrowRight")
    expect(page.locator("#status")).to_be_hidden()
    expect(page.locator("#details")).to_be_hidden()
