# Zeno

Local wellness / focus monitor (Tauri + React + Python camera sidecar).

## Run the app

From the repo root:

```bash
./scripts/dev.sh
```

That will:

1. Use (or create) `.venv` for the Python backend
2. Install Python + frontend deps if needed
3. Start **Tauri dev** (desktop window + Vite + Python sidecars)

Options:

```bash
./scripts/dev.sh --skip-install   # already set up; just launch
./scripts/dev.sh --web-only       # Vite UI only (no desktop / camera)
```

### Manual (same as the script)

```bash
# once
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && pnpm install

# each time
cd frontend && pnpm tauri dev
```

Requires: **pnpm**, **Rust/cargo**, **Python 3.11+**, macOS camera permissions for capture features.
