from __future__ import annotations

import argparse
import json
import time
from datetime import datetime

from zeno_backend.analyzers.rppg_estimator import estimate_heart_rate

METHODS = ("chrom", "lab", "hybrid")


def run_back_to_back(
    seconds: float,
    rounds: int,
    warmup_seconds: float,
    preview: bool,
    pause_seconds: float,
) -> dict:
    seconds = max(8.0, float(seconds))
    rounds = max(1, int(rounds))
    warmup_seconds = max(0.0, float(warmup_seconds))
    pause_seconds = max(0.0, float(pause_seconds))

    runs: list[dict] = []
    started_at = datetime.now().isoformat(timespec="seconds")

    for round_index in range(rounds):
        for method in METHODS:
            wall_start = time.perf_counter()
            bpm = estimate_heart_rate(
                capture_seconds=seconds,
                warmup_seconds=warmup_seconds,
                preview=preview,
                signal_method=method,
            )
            elapsed = round(time.perf_counter() - wall_start, 2)
            runs.append(
                {
                    "round": round_index + 1,
                    "method": method,
                    "heart_rate_bpm": None if bpm <= 0 else float(round(bpm, 1)),
                    "elapsed_seconds": elapsed,
                    "captured_at": datetime.now().isoformat(timespec="seconds"),
                }
            )
            if pause_seconds > 0:
                time.sleep(pause_seconds)

    by_method: dict[str, list[float]] = {name: [] for name in METHODS}
    for run in runs:
        bpm = run.get("heart_rate_bpm")
        if isinstance(bpm, (int, float)):
            by_method[run["method"]].append(float(bpm))

    summary = {}
    for method, values in by_method.items():
        if not values:
            summary[method] = {
                "samples": 0,
                "mean_bpm": None,
                "spread_bpm": None,
                "min_bpm": None,
                "max_bpm": None,
            }
            continue
        mean_value = sum(values) / len(values)
        summary[method] = {
            "samples": len(values),
            "mean_bpm": round(mean_value, 1),
            "spread_bpm": round(max(values) - min(values), 1),
            "min_bpm": round(min(values), 1),
            "max_bpm": round(max(values), 1),
        }

    return {
        "started_at": started_at,
        "capture_seconds_per_run": seconds,
        "rounds": rounds,
        "methods": list(METHODS),
        "runs": runs,
        "summary": summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run back-to-back rPPG captures for chrom/lab/hybrid and summarize BPM stability."
    )
    parser.add_argument("--seconds", type=float, default=12.0, help="Capture duration per method (default: 12).")
    parser.add_argument("--rounds", type=int, default=2, help="How many full method cycles to run (default: 2).")
    parser.add_argument(
        "--warmup-seconds",
        type=float,
        default=0.6,
        help="Warmup applied before each run (default: 0.6).",
    )
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=0.5,
        help="Pause between method runs (default: 0.5).",
    )
    parser.add_argument("--preview", action="store_true", help="Show camera preview during captures.")
    args = parser.parse_args()

    payload = run_back_to_back(
        seconds=args.seconds,
        rounds=args.rounds,
        warmup_seconds=args.warmup_seconds,
        preview=args.preview,
        pause_seconds=args.pause_seconds,
    )
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
