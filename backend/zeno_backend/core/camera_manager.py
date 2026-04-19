from __future__ import annotations

import platform
import threading
import time
from collections.abc import Callable

import cv2
import numpy as np

FrameCallback = Callable[[np.ndarray], None]

# Desktop wellness capture: keep resolution modest for fast open + lower CPU.
DEFAULT_WIDTH = 640
DEFAULT_HEIGHT = 480
DEFAULT_FPS = 20.0
WARMUP_FRAMES = 4


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
            self._latest = frame
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


def open_camera(
    camera_index: int = 0,
    *,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    fps: float = DEFAULT_FPS,
    warmup_frames: int = WARMUP_FRAMES,
) -> cv2.VideoCapture:
    """
    Open a webcam with fast-path settings for desktop capture.

    Prefer AVFoundation on macOS; request modest resolution + tiny buffer so
    open + first-frame latency stays low.
    """
    index = int(camera_index)
    backends: list[int] = []
    if platform.system() == "Darwin":
        backends.append(getattr(cv2, "CAP_AVFOUNDATION", cv2.CAP_ANY))
    backends.append(cv2.CAP_ANY)

    last_error: Exception | None = None
    for backend in backends:
        try:
            cap = cv2.VideoCapture(index, backend)
        except Exception as err:  # pragma: no cover
            last_error = err
            continue
        if not cap.isOpened():
            cap.release()
            continue

        # Request lightweight stream before first reads.
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(width))
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(height))
        cap.set(cv2.CAP_PROP_FPS, float(fps))
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        # Prefer MJPG when available — often much faster on USB webcams.
        try:
            fourcc = cv2.VideoWriter_fourcc(*"MJPG")
            cap.set(cv2.CAP_PROP_FOURCC, fourcc)
        except Exception:
            pass

        # First readable frame must arrive quickly — otherwise the device is busy.
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.release()
            continue

        # Discard a few more frames (auto-exposure / device settle).
        for _ in range(max(0, int(warmup_frames) - 1)):
            ok, _frame = cap.read()
            if not ok:
                break

        if cap.isOpened():
            return cap
        cap.release()

    detail = f" ({last_error})" if last_error is not None else ""
    raise RuntimeError(
        f"Unable to open camera index {index}.{detail} "
        "It may be in use by another app or a live Zeno stream."
    )


class CameraManager:
    """Shared camera feed manager with demand-driven lifecycle."""

    def __init__(
        self,
        camera_index: int = 0,
        target_fps: float = DEFAULT_FPS,
        width: int = DEFAULT_WIDTH,
        height: int = DEFAULT_HEIGHT,
    ) -> None:
        self._camera_index = int(camera_index)
        self._target_fps = max(1.0, float(target_fps))
        self._width = int(width)
        self._height = int(height)
        self._workers: dict[str, _SubscriberWorker] = {}
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._cap: cv2.VideoCapture | None = None
        self._latest_frame: np.ndarray | None = None
        self._opened_at: float | None = None

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            cap = open_camera(
                self._camera_index,
                width=self._width,
                height=self._height,
                fps=self._target_fps,
            )
            self._cap = cap
            self._opened_at = time.perf_counter()
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
            self._opened_at = None
            workers = list(self._workers.values())
            self._workers.clear()
            self._latest_frame = None
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

    def is_running(self) -> bool:
        with self._lock:
            return bool(self._thread and self._thread.is_alive() and self._cap is not None)

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
                time.sleep(0.01)
                continue

            # One owned copy for latest + subscribers (workers hold refs until processed).
            owned = frame.copy()
            with self._lock:
                self._latest_frame = owned
            for worker in workers:
                # Each worker needs its own buffer when multiple subscribers run async.
                worker.push(owned.copy() if len(workers) > 1 else owned)

            elapsed = time.perf_counter() - start
            remaining = frame_interval - elapsed
            if remaining > 0:
                time.sleep(remaining)
