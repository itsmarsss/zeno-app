from __future__ import annotations

import argparse
import json
from datetime import datetime

from zeno_backend.analyzers.presence_detector import detect_presence


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one presence check and emit JSON.")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()

    detected = detect_presence(preview_seconds=1.0 if args.preview else 0.0)
    print(
        json.dumps(
            {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "presence_detected": bool(detected),
            }
        )
    )


if __name__ == "__main__":
    main()
