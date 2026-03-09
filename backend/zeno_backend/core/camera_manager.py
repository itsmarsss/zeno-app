from __future__ import annotations

import threading
import time
from collections.abc import Callable

import cv2
import numpy as np

FrameCallback = Callable[[np.ndarray], None]


class _SubscriberWorker:
    """Run one subscriber callback off the camera capture thread."""

    def __init__(self, callback: FrameCallback, name: str) -> None:
        self._callback = callback
        self._name = name
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._stop = threading.Event()
        self._latest: np.ndarray | None = None
        self._thread = threading.Thread(target=self._run, name=f"CameraSub:{name}", daemon=True)
        self._thread.start()

    def push(self, frame: np.ndarray) -> None:
        # Keep only the latest frame to avoid backlog growth.
        with self._lock:
            self._latest = frame.copy()
        self._event.set()

    def stop(self) -> None:
        self._stop.set()
        self._event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        while not self._stop.is_set():
            self._event.wait(timeout=0.2)
            self._event.clear()
            if self._stop.is_set():
                break
            with self._lock:
                frame = self._latest
                self._latest = None
            if frame is None:
                continue
            try:
                self._callback(frame)
            except Exception:
                # One subscriber failure should not stop the shared stream.
                continue


class CameraManager:
    """Shared camera feed manager with demand-driven lifecycle."""

    def __init__(self, camera_index: int = 0, target_fps: float = 20.0) -> None:
        self._camera_index = int(camera_index)
        self._target_fps = max(1.0, float(target_fps))
        self._workers: dict[str, _SubscriberWorker] = {}
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._cap: cv2.VideoCapture | None = None
        self._latest_frame: np.ndarray | None = None

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            cap = cv2.VideoCapture(self._camera_index)
            if not cap.isOpened():
                cap.release()
                raise RuntimeError("Unable to open camera.")
            self._cap = cap
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, name="CameraManager", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        thread: threading.Thread | None = None
        with self._lock:
            self._stop_event.set()
            thread = self._thread

        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.5)

        with self._lock:
            cap = self._cap
            self._cap = None
            self._thread = None
            workers = list(self._workers.values())
            self._workers.clear()
            if cap is not None:
                cap.release()
        for worker in workers:
            worker.stop()

    def subscribe(self, name: str, callback: FrameCallback) -> None:
        key = str(name).strip()
        if not key:
            raise ValueError("Subscriber name is required.")

        previous: _SubscriberWorker | None = None
        with self._lock:
            previous = self._workers.pop(key, None)
            self._workers[key] = _SubscriberWorker(callback=callback, name=key)
        if previous is not None:
            previous.stop()

        self.start()

    def unsubscribe(self, name: str) -> None:
        worker: _SubscriberWorker | None = None
        should_stop = False
        with self._lock:
            worker = self._workers.pop(str(name), None)
            should_stop = len(self._workers) == 0
        if worker is not None:
            worker.stop()

        if should_stop:
            self.stop()

    def get_latest_frame(self) -> np.ndarray | None:
        with self._lock:
            if self._latest_frame is None:
                return None
            return self._latest_frame.copy()

    def _run_loop(self) -> None:
        frame_interval = 1.0 / self._target_fps
        while not self._stop_event.is_set():
            start = time.perf_counter()

            with self._lock:
                cap = self._cap
                workers = list(self._workers.values())
            if cap is None:
                break

            ok, frame = cap.read()
            if not ok:
                time.sleep(0.02)
                continue

            with self._lock:
                self._latest_frame = frame.copy()

            for worker in workers:
                worker.push(frame)

            elapsed = time.perf_counter() - start
            remaining = frame_interval - elapsed
            if remaining > 0:
                time.sleep(remaining)
