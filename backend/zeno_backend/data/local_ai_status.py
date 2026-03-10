from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request

DEFAULT_MODEL = os.environ.get("ZENO_INSIGHTS_MODEL", "").strip()
OLLAMA_BASE = os.environ.get("ZENO_OLLAMA_URL", "http://127.0.0.1:11434/api/generate").replace(
    "/api/generate", ""
)


def _request_json(path: str, payload: dict | None = None, timeout: float = 2.0) -> dict | None:
    url = f"{OLLAMA_BASE}{path}"
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if payload is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        return None


def check_status(model: str = DEFAULT_MODEL, setup: bool = False) -> dict:
    tags = _request_json("/api/tags", timeout=1.6)
    if not isinstance(tags, dict):
        return {
            "reachable": False,
            "model": model,
            "model_available": False,
            "installed_models": [],
            "setup_attempted": setup,
            "setup_succeeded": False,
            "message": "Ollama not detected",
        }

    models = tags.get("models")
    model_names: list[str] = []
    if isinstance(models, list):
        for row in models:
            if isinstance(row, dict):
                name = row.get("name")
                if isinstance(name, str):
                    model_names.append(name)
    selected_model = (model or "").strip()

    model_available = bool(selected_model) and any(
        name == selected_model
        or name.startswith(f"{selected_model}:")
        or name.split(":")[0] == selected_model.split(":")[0]
        for name in model_names
    )

    setup_succeeded = False
    if setup and not model_available:
        if not selected_model:
            return {
                "reachable": True,
                "model": selected_model,
                "model_available": False,
                "installed_models": sorted(model_names),
                "setup_attempted": True,
                "setup_succeeded": False,
                "message": "Connected, no model selected",
            }
        # Model pulls can take minutes depending on model size and network.
        pull = _request_json("/api/pull", payload={"name": selected_model, "stream": False}, timeout=900.0)
        setup_succeeded = isinstance(pull, dict) and bool(pull)
        if setup_succeeded:
            tags_after = _request_json("/api/tags", timeout=1.6)
            if isinstance(tags_after, dict) and isinstance(tags_after.get("models"), list):
                model_available = any(
                    isinstance(row, dict)
                    and isinstance(row.get("name"), str)
                    and (
                        row["name"] == selected_model
                        or row["name"].startswith(f"{selected_model}:")
                        or row["name"].split(":")[0] == selected_model.split(":")[0]
                    )
                    for row in tags_after["models"]
                )

    if not selected_model:
        message = "Connected, no model selected"
    elif model_available:
        message = "Connected and model ready"
    else:
        message = "Connected, model missing"
    return {
        "reachable": True,
        "model": selected_model,
        "model_available": model_available,
        "installed_models": sorted(model_names),
        "setup_attempted": setup,
        "setup_succeeded": setup_succeeded,
        "message": message,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Check local Ollama status for Zeno insight cards.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--setup", action="store_true", help="Attempt to pull missing model.")
    args = parser.parse_args()
    print(json.dumps(check_status(model=args.model, setup=bool(args.setup))))


if __name__ == "__main__":
    main()
