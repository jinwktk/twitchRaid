import logging
import os
from functools import lru_cache
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from mem0 import Memory


logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("twitchraid-mem0-oss")


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _api_key() -> str:
    return _env("MEM0_ADMIN_API_KEY", "")


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = _api_key()
    if not expected:
        return
    if not x_api_key or x_api_key != expected:
        raise HTTPException(status_code=401, detail="invalid api key")


def build_memory_config() -> dict[str, Any]:
    qdrant_host = _env("MEM0_QDRANT_HOST", "qdrant")
    qdrant_port = _env_int("MEM0_QDRANT_PORT", 6333)
    collection_name = _env("MEM0_COLLECTION_NAME", "twitchraid_memories")
    embedding_dims = _env_int("MEM0_EMBEDDING_DIMS", 768)
    ollama_base_url = _env("MEM0_OLLAMA_BASE_URL", "http://ollama:11434")
    llm_model = _env("MEM0_LLM_MODEL", "qwen3.5:9b")
    embedder_model = _env("MEM0_EMBEDDER_MODEL", "nomic-embed-text:latest")
    history_db_path = _env("MEM0_HISTORY_DB_PATH", "/app/history/history.db")

    return {
        "version": "v1.1",
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "collection_name": collection_name,
                "host": qdrant_host,
                "port": qdrant_port,
                "embedding_model_dims": embedding_dims,
            },
        },
        "llm": {
            "provider": "ollama",
            "config": {
                "model": llm_model,
                "temperature": 0,
                "max_tokens": _env_int("MEM0_LLM_MAX_TOKENS", 512),
                "ollama_base_url": ollama_base_url,
            },
        },
        "embedder": {
            "provider": "ollama",
            "config": {
                "model": embedder_model,
                "ollama_base_url": ollama_base_url,
            },
        },
        "history_db_path": history_db_path,
    }


@lru_cache(maxsize=1)
def get_memory() -> Memory:
    config = build_memory_config()
    logger.info(
        "initializing mem0 oss: qdrant=%s:%s collection=%s embedder=%s",
        config["vector_store"]["config"]["host"],
        config["vector_store"]["config"]["port"],
        config["vector_store"]["config"]["collection_name"],
        config["embedder"]["config"]["model"],
    )
    return Memory.from_config(config)


class Message(BaseModel):
    role: str = Field(default="user")
    content: str


class MemoryCreate(BaseModel):
    messages: list[Message]
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict[str, Any] | None = None
    infer: bool | None = None
    memory_type: str | None = None
    prompt: str | None = None


class SearchRequest(BaseModel):
    query: str
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    filters: dict[str, Any] | None = None
    top_k: int | None = None
    limit: int | None = None
    threshold: float | None = None


app = FastAPI(title="twitchRaid Mem0 OSS REST", version="1.0.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "twitchRaid Mem0 OSS REST", "status": "ok"}


@app.post("/memories")
def create_memory(
    payload: MemoryCreate,
    _auth: None = Depends(require_api_key),
) -> Any:
    if not any([payload.user_id, payload.agent_id, payload.run_id]):
        raise HTTPException(
            status_code=400,
            detail="At least one identifier is required.",
        )

    params: dict[str, Any] = {
        "messages": [message.model_dump() for message in payload.messages],
        "infer": payload.infer
        if payload.infer is not None
        else _env_bool("MEM0_INFER_DEFAULT", False),
    }
    for key in ("user_id", "agent_id", "run_id", "metadata", "memory_type", "prompt"):
        value = getattr(payload, key)
        if value is not None:
            params[key] = value

    try:
        return get_memory().add(**params)
    except Exception as exc:
        logger.exception("mem0 add failed")
        raise HTTPException(status_code=502, detail="mem0 add failed") from exc


@app.post("/search")
def search_memories(
    payload: SearchRequest,
    _auth: None = Depends(require_api_key),
) -> Any:
    filters = dict(payload.filters or {})
    for key in ("user_id", "agent_id", "run_id"):
        value = getattr(payload, key)
        if value is not None:
            filters[key] = value

    top_k = payload.top_k or payload.limit
    params: dict[str, Any] = {"query": payload.query, "filters": filters}
    if top_k is not None:
        params["top_k"] = top_k
    if payload.threshold is not None:
        params["threshold"] = payload.threshold

    try:
        return get_memory().search(**params)
    except Exception as exc:
        logger.exception("mem0 search failed")
        raise HTTPException(status_code=502, detail="mem0 search failed") from exc


@app.get("/memories")
def list_memories(
    request: Request,
    user_id: str | None = None,
    agent_id: str | None = None,
    run_id: str | None = None,
    _auth: None = Depends(require_api_key),
) -> Any:
    filters = {
        key: value
        for key, value in {
            "user_id": user_id,
            "agent_id": agent_id,
            "run_id": run_id,
        }.items()
        if value is not None
    }
    limit = _env_int("MEM0_LIST_LIMIT", 100)

    try:
        if hasattr(get_memory(), "get_all"):
            if filters:
                return get_memory().get_all(filters=filters)
            return get_memory().get_all(limit=limit)
        raise HTTPException(status_code=404, detail="list unsupported")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("mem0 list failed path=%s", request.url.path)
        raise HTTPException(status_code=502, detail="mem0 list failed") from exc
