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
        self.updated = []

    def delete(self, memory_id):
        self.deleted_ids.append(memory_id)
        return {"deleted": True, "id": memory_id}

    def update(self, memory_id, data):
        self.updated.append((memory_id, data))
        return {"id": memory_id, "memory": data}


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
    assert fake_memory.updated == [("mem-1", "好物: ラーメン")]


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
