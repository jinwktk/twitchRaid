import importlib.util
import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient


def load_app_module():
    fake_mem0 = types.ModuleType("mem0")
    fake_mem0.Memory = type(
        "ImportOnlyMemory",
        (),
        {"from_config": staticmethod(lambda _config: object())},
    )
    sys.modules["mem0"] = fake_mem0
    module_path = Path(__file__).resolve().parents[1] / "ops" / "mem0-oss-server" / "app.py"
    spec = importlib.util.spec_from_file_location("twitchraid_mem0_app", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["twitchraid_mem0_app"] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeMemory:
    def __init__(self):
        self.deleted_ids = []
        self.searched = []
        self.updated = []
        self.listed = []

    def delete(self, memory_id):
        self.deleted_ids.append(memory_id)
        return {"deleted": True, "id": memory_id}

    def update(self, memory_id, data, metadata=None):
        self.updated.append((memory_id, data, metadata))
        return {"id": memory_id, "memory": data}

    def search(self, **params):
        self.searched.append(params)
        return [{"id": "mem-1", "memory": "好物: ラーメン", "score": 0.8}]

    def get_all(self, **params):
        self.listed.append(params)
        return [{"id": "mem-1", "memory": "好物: ラーメン"}]


def test_initializes_mem0_before_accepting_requests(monkeypatch):
    app_module = load_app_module()
    initialized = []
    fake_memory = FakeMemory()
    monkeypatch.setattr(
        app_module,
        "get_memory",
        lambda: initialized.append("ready") or fake_memory,
    )

    with TestClient(app_module.app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert initialized == ["ready"]


def test_retries_mem0_initialization_on_request_after_startup_failure(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    attempts = []

    def initialize_memory():
        attempts.append("attempt")
        if len(attempts) == 1:
            raise RuntimeError("startup dependency unavailable")
        return fake_memory

    monkeypatch.setattr(app_module, "get_memory", initialize_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "")

    with TestClient(app_module.app) as client:
        response = client.post(
            "/search",
            json={"query": "好きな食べ物は？", "user_id": "rukalun"},
        )

    assert response.status_code == 200
    assert len(attempts) == 2


def test_delete_memory_by_id(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "local-key")
    client = TestClient(app_module.app)

    response = client.delete("/memories/mem-1", headers={"X-API-Key": "local-key"})

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "id": "mem-1"}
    assert fake_memory.deleted_ids == ["mem-1"]


def test_delete_memory_requires_supported_mem0_method(monkeypatch):
    app_module = load_app_module()
    monkeypatch.setattr(app_module, "get_memory", lambda: object())
    monkeypatch.setattr(app_module, "_api_key", lambda: "")
    client = TestClient(app_module.app)

    response = client.delete("/memories/mem-1")

    assert response.status_code == 404
    assert response.json() == {"detail": "delete unsupported"}


def test_update_memory_by_id(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "local-key")
    client = TestClient(app_module.app)

    response = client.patch(
        "/memories/mem-1",
        headers={"X-API-Key": "local-key"},
        json={"memory": "好物: ラーメン"},
    )

    assert response.status_code == 200
    assert response.json() == {"id": "mem-1", "memory": "好物: ラーメン"}
    assert fake_memory.updated == [("mem-1", "好物: ラーメン", None)]


def test_update_memory_by_id_with_metadata(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "local-key")
    client = TestClient(app_module.app)

    response = client.patch(
        "/memories/mem-1",
        headers={"X-API-Key": "local-key"},
        json={
            "memory": "好きな食べ物: ラーメン",
            "metadata": {
                "key": "好きな食べ物",
                "kind": "semantic",
                "sourceUser": "memory-web",
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {"id": "mem-1", "memory": "好きな食べ物: ラーメン"}
    assert fake_memory.updated == [
        (
            "mem-1",
            "好きな食べ物: ラーメン",
            {
                "key": "好きな食べ物",
                "kind": "semantic",
                "sourceUser": "memory-web",
            },
        )
    ]


def test_update_memory_requires_text(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "")
    client = TestClient(app_module.app)

    response = client.patch("/memories/mem-1", json={"memory": ""})

    assert response.status_code == 400
    assert response.json() == {"detail": "memory is required"}
    assert fake_memory.updated == []


def test_list_memories_forwards_scope_and_explicit_limit(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "")
    client = TestClient(app_module.app)

    response = client.get(
        "/memories?user_id=rukalun&agent_id=twitchRaid"
        "&app_id=twitchRaid&limit=250"
    )

    assert response.status_code == 200
    assert fake_memory.listed == [
        {
            "filters": {
                "user_id": "rukalun",
                "agent_id": "twitchRaid",
                "app_id": "twitchRaid",
            },
            "limit": 250,
        }
    ]


def test_list_memories_rejects_unbounded_limit(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "")
    client = TestClient(app_module.app)

    response = client.get("/memories?limit=10001")

    assert response.status_code == 422
    assert fake_memory.listed == []


def test_search_forwards_similarity_threshold_to_mem0(monkeypatch):
    app_module = load_app_module()
    fake_memory = FakeMemory()
    monkeypatch.setattr(app_module, "get_memory", lambda: fake_memory)
    monkeypatch.setattr(app_module, "_api_key", lambda: "")
    client = TestClient(app_module.app)

    response = client.post(
        "/search",
        json={
            "query": "好きな食べ物は？",
            "user_id": "rukalun",
            "top_k": 3,
            "threshold": 0.5,
        },
    )

    assert response.status_code == 200
    assert response.json() == [
        {"id": "mem-1", "memory": "好物: ラーメン", "score": 0.8}
    ]
    assert fake_memory.searched == [
        {
            "query": "好きな食べ物は？",
            "filters": {"user_id": "rukalun"},
            "top_k": 3,
            "threshold": 0.5,
        }
    ]
