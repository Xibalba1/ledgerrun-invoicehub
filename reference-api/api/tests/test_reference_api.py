import importlib
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


def load_seed(name: str) -> list[dict]:
    path = API_ROOT / "seed" / "data" / name
    return json.loads(path.read_text())


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'reference.db'}")
    for name in list(sys.modules):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    database = importlib.import_module("app.database")
    models = importlib.import_module("app.models")
    main = importlib.import_module("app.main")

    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
    db = database.SessionLocal()
    try:
        for row in load_seed("sponsors.json"):
            db.add(models.Sponsor(**row))
        for row in load_seed("studies.json"):
            db.add(models.Study(**row))
        for row in load_seed("sites.json"):
            db.add(models.Site(**row))
        for row in load_seed("study_sites.json"):
            db.add(models.StudySite(**row))
        for row in load_seed("catalog_items.json"):
            db.add(models.CatalogItem(**row))
        db.commit()
    finally:
        db.close()

    return TestClient(main.app)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_sponsors_are_paginated(client):
    response = client.get("/api/v1/sponsors?page=1&page_size=2")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 4
    assert body["page_size"] == 2
    assert body["pages"] == 2
    assert [item["code"] for item in body["items"]] == ["NWD", "CON"]


def test_studies_filter_by_sponsor(client):
    response = client.get("/api/v1/studies?sponsor_id=2")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert {item["name"] for item in body["items"]} == {"CATALYST Trial", "AURORA Extension"}


def test_catalog_filters_by_sponsor_and_study(client):
    response = client.get("/api/v1/catalog-items?sponsor_id=2&study_id=3&page_size=200")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 7
    assert {item["item_code"] for item in body["items"]} == {
        "VISIT-SCR",
        "VISIT-BL",
        "VISIT-WK12",
        "VISIT-WK24",
        "PROC-INFUS",
        "LAB-CBC",
        "ADMIN-SITE",
    }


def test_study_sites_filter_by_study_and_site(client):
    response = client.get("/api/v1/study-sites?study_id=1&site_id=2")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0] == {"id": 2, "study_id": 1, "site_id": 2, "status": "active"}


def test_get_endpoints_return_404_for_missing_records(client):
    assert client.get("/api/v1/sponsors/999").status_code == 404
    assert client.get("/api/v1/studies/999").status_code == 404
    assert client.get("/api/v1/sites/999").status_code == 404
    assert client.get("/api/v1/study-sites/999").status_code == 404
    assert client.get("/api/v1/catalog-items/999").status_code == 404


def test_query_validation_rejects_invalid_pagination(client):
    assert client.get("/api/v1/sponsors?page=0").status_code == 422
    assert client.get("/api/v1/catalog-items?page_size=201").status_code == 422
