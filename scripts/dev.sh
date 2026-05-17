#!/usr/bin/env bash
# Start Zeno desktop app (Tauri + Vite + Python backend sidecar).
#
# Usage:
#   ./scripts/dev.sh
#   ./scripts/dev.sh --skip-install   # skip dependency checks
#   ./scripts/dev.sh --web-only       # Vite UI only (no Tauri / camera sidecar)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
VENV_PY="$ROOT/.venv/bin/python"
SKIP_INSTALL=0
WEB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --web-only) WEB_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

die() {
  echo "error: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

echo "==> Zeno dev"
echo "    root: $ROOT"

need pnpm
if [[ "$WEB_ONLY" -eq 0 ]]; then
  need cargo
  need rustc
fi

# Prefer project venv (matches frontend/src-tauri python_sidecar.rs)
if [[ ! -x "$VENV_PY" ]]; then
  need python3
  if [[ "$SKIP_INSTALL" -eq 1 ]]; then
    die "no .venv at $ROOT/.venv — create one or re-run without --skip-install"
  fi
  echo "==> Creating Python venv (.venv)"
  python3 -m venv "$ROOT/.venv"
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  echo "==> Ensuring Python packages"
  "$VENV_PY" -m pip install -q --upgrade pip
  if [[ -f "$BACKEND/requirements.txt" ]]; then
    "$VENV_PY" -m pip install -q -r "$BACKEND/requirements.txt"
  fi

  echo "==> Ensuring frontend packages"
  if [[ ! -d "$FRONTEND/node_modules" ]]; then
    (cd "$FRONTEND" && pnpm install)
  else
    (cd "$FRONTEND" && pnpm install --prefer-offline)
  fi
else
  echo "==> Skipping installs (--skip-install)"
fi

# Quick sanity: backend package importable from project python
if ! (cd "$BACKEND" && "$VENV_PY" -c "import zeno_backend" 2>/dev/null); then
  echo "warn: zeno_backend import failed under .venv — camera/data sidecars may break" >&2
fi

export PATH="$ROOT/.venv/bin:${PATH:-}"

cd "$FRONTEND"
if [[ "$WEB_ONLY" -eq 1 ]]; then
  echo "==> Starting Vite only (no Tauri window / Python sidecar)"
  echo "    open the URL Vite prints (usually http://127.0.0.1:1420)"
  exec pnpm dev
fi

echo "==> Starting Tauri dev (Vite + desktop shell)"
echo "    Python sidecar: $VENV_PY"
exec pnpm tauri dev
