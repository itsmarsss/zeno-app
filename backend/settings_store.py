from __future__ import annotations

import argparse
import json
from pathlib import Path

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parent / "data" / "settings.json"
DEFAULT_SETTINGS = {
    "monitoring_paused": False,
    "focus_mode_active": False,
    "session_frequency_minutes": 10,
    "daily_report_hour": 21,
    "daily_report_minute": 0,
    "onboarding_completed": False,
}


def _sanitize(settings: dict) -> dict:
    cleaned = dict(DEFAULT_SETTINGS)
    cleaned.update(settings or {})

    cleaned["monitoring_paused"] = bool(cleaned.get("monitoring_paused", False))
    cleaned["focus_mode_active"] = bool(cleaned.get("focus_mode_active", False))
    cleaned["session_frequency_minutes"] = int(cleaned.get("session_frequency_minutes", 10))
    cleaned["session_frequency_minutes"] = min(30, max(5, cleaned["session_frequency_minutes"]))

    cleaned["daily_report_hour"] = int(cleaned.get("daily_report_hour", 21))
    cleaned["daily_report_hour"] = min(23, max(0, cleaned["daily_report_hour"]))

    cleaned["daily_report_minute"] = int(cleaned.get("daily_report_minute", 0))
    cleaned["daily_report_minute"] = min(59, max(0, cleaned["daily_report_minute"]))
    cleaned["onboarding_completed"] = bool(cleaned.get("onboarding_completed", False))
    return cleaned


def load_settings(path: Path) -> dict:
    if not path.exists():
        return dict(DEFAULT_SETTINGS)
    try:
        return _sanitize(json.loads(path.read_text()))
    except Exception:
        return dict(DEFAULT_SETTINGS)


def save_settings(path: Path, settings: dict) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    cleaned = _sanitize(settings)
    path.write_text(json.dumps(cleaned, indent=2))
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Get or set local Zeno settings.")
    parser.add_argument("--path", default=str(DEFAULT_SETTINGS_PATH))
    parser.add_argument("--set-json", default=None, help="JSON object with partial settings.")
    args = parser.parse_args()

    path = Path(args.path).expanduser().resolve()
    current = load_settings(path)
    if args.set_json:
        patch = json.loads(args.set_json)
        current.update(patch)
        current = save_settings(path, current)

    print(json.dumps(current))


if __name__ == "__main__":
    main()
