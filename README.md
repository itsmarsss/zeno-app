# Zeno

**Local-first wellness and focus companion for desk work.**

Zeno runs on your Mac as a desktop app: a compact menubar panel for quick status, plus a full main window for overview, live monitoring, posture, exercises, and focus history. Camera-based signals (posture, stress proxies, presence) are processed **on device** by a Python sidecar. Session data lives in a local SQLite database - no cloud account required for core use.

---

## What it does

| Area | Features |
| --- | --- |
| **Menubar** | Always-available status, focus timer (when active), quick actions, check-in feedback |
| **Overview** | Today’s sessions, focused time, stress/posture signals, shortcuts into deeper tabs |
| **Monitor** | Live camera + signal stack (idle / passive check-in / Focus Mode) |
| **Posture** | Baseline calibration, posture insights, exercise recommendations |
| **Exercises** | Guided desk exercises with camera coaching, instructions, session logging |
| **Focus History** | Period summaries, study patterns, heatmap, daily rhythm, duration vs. effectiveness |
| **Settings** | Notifications, daily report timing, launch at login, privacy-minded local preferences |

**Focus Mode** keeps the camera on for a continuous work session. **Passive check-ins** briefly sample presence and stress so you get a lightweight pulse without a full focus block.

---

## Stack

| Layer | Tech |
| --- | --- |
| Desktop shell | [Tauri 2](https://tauri.app/) (Rust) |
| UI | React 19, TypeScript, Vite, Framer Motion, Lucide |
| Computer vision / signals | Python 3.11+, OpenCV, MediaPipe, rPPG / stress / posture pipelines |
| Storage | Local SQLite (`backend/data/zeno_sessions.db`) + JSON settings |
| Package managers | `pnpm` (frontend), `pip` + project `.venv` (backend) |

Optional `api/` folder contains a separate serverless/auth stack used for experimental or future cloud features. **Day-to-day Zeno runs fully offline** for capture and history.

---

## Prerequisites

- **macOS** (primary target; camera + menubar UX)
- **Node.js** + **[pnpm](https://pnpm.io/)**
- **Rust** (`rustc` / `cargo`) - [rustup](https://rustup.rs/)
- **Python 3.11+**
- Camera permission when macOS prompts (required for check-ins, Focus Mode, posture, exercises)

---

## Quick start

From the repo root:

```bash
./scripts/dev.sh
```

This will:

1. Create `.venv` if missing  
2. Install Python deps from `backend/requirements.txt`  
3. Install frontend deps with `pnpm`  
4. Launch **Tauri dev** (desktop app + Vite on `http://127.0.0.1:1420` + Python sidecars)

### Useful flags

```bash
./scripts/dev.sh --skip-install   # already set up; just launch
./scripts/dev.sh --web-only       # Vite UI only (no Tauri / camera)
./scripts/dev.sh --help
```

### Manual setup (same idea as the script)

```bash
# once
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd frontend
pnpm install

# each session
pnpm tauri dev
# or from repo root after activate:
# cd frontend && pnpm tauri dev
```

### Production-style build

```bash
cd frontend
pnpm build:tauri
```

---

## Project layout

```
zeno-app/
├── scripts/dev.sh          # One-command local launch
├── frontend/               # React UI + Tauri crate
│   ├── src/                # App shell, tabs, shared metrics
│   └── src-tauri/          # Rust: windows, tray, commands, Python sidecar
├── backend/
│   ├── zeno_backend/       # Analyzers, pipelines, SQLite access
│   ├── models/             # On-device model assets (gitignored if large)
│   ├── data/               # Local DB + settings (gitignored)
│   └── requirements.txt
├── api/                    # Optional cloud/auth (not required for local app)
└── README.md
```

### Frontend entry points

- **Menubar / compact window** - `frontend/src/App.tsx`  
- **Main app window** - `frontend/src/components/MainWindowShell.tsx`  
- Tabs live under `frontend/src/components/{overview,monitor,posture,exercises,focus,settings}/`

### Backend highlights

- **`zeno_backend/core/`** - camera manager, stress index helpers  
- **`zeno_backend/analyzers/`** - posture, presence, rPPG, emotion, respiration  
- **`zeno_backend/pipelines/`** - focus stream, passive check-in, session runner  
- **`zeno_backend/data/`** - SQLite logging, aggregates, settings, export  

Rust commands in `frontend/src-tauri/src/` invoke Python modules as short-lived or streaming sidecars.

---

## Data & privacy

- Session history, exercises, and aggregates are stored **locally** under `backend/data/`.  
- That directory is **gitignored** so personal telemetry never lands in commits.  
- Camera frames are used for live analysis and coaching; they are not uploaded by the local app path.  
- Clear or reset data via in-app settings / backend clear utilities when available.

To seed demo history for UI work (optional):

```bash
source .venv/bin/activate
cd backend
python -m zeno_backend.data.seed_dummy_sessions
```

(Exact module path may vary slightly; check `backend/zeno_backend/data/seed_dummy_sessions.py`.)

---

## Development notes

- Prefer **`./scripts/dev.sh --skip-install`** once the venv and `node_modules` exist - faster iteration.  
- If camera features fail, confirm:
  - macOS **Camera** permission for the Zeno / Terminal host process  
  - `.venv` exists and `import zeno_backend` works  
  - No other app is exclusively locking the camera  
- Frontend lint/format:

  ```bash
  cd frontend
  pnpm lint
  pnpm format
  ```

- Typecheck:

  ```bash
  cd frontend
  npx tsc --noEmit
  ```

---

## Version

App identifier: `com.zeno.app` · product version in `frontend/src-tauri/tauri.conf.json` (currently `0.1.0`).

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
