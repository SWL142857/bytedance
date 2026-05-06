#!/usr/bin/env bash
# HireLoop UI entrypoint for systemd. Resolves repo root from this script location.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

export HIRELOOP_COMPETITION_ROOT="${HIRELOOP_COMPETITION_ROOT:-/data/competition}"
PORT="${PORT:-3000}"

resolve_node() {
  if [[ -n "${HIRELOOP_NODE_BIN:-}" && -x "${HIRELOOP_NODE_BIN}" ]]; then
    echo "${HIRELOOP_NODE_BIN}"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  local conda_sh
  for conda_sh in \
    "${HOME}/miniconda3/etc/profile.d/conda.sh" \
    "${HOME}/Miniconda3/etc/profile.d/conda.sh" \
    "/root/miniconda3/etc/profile.d/conda.sh" \
    "/opt/miniconda3/etc/profile.d/conda.sh"; do
    if [[ -f "${conda_sh}" ]]; then
      # shellcheck source=/dev/null
      source "${conda_sh}"
      if [[ -n "${HIRELOOP_CONDA_ENV:-}" ]]; then
        conda activate "${HIRELOOP_CONDA_ENV}" >/dev/null 2>&1 || true
      else
        conda activate hireloop >/dev/null 2>&1 || true
      fi
      if command -v node >/dev/null 2>&1; then
        command -v node
        return
      fi
    fi
  done
  return 1
}

NODE_BIN="$(resolve_node)" || {
  echo "hireloop: node not found. Set HIRELOOP_NODE_BIN in /etc/default/hireloop or install Node 20+." >&2
  exit 1
}

exec "${NODE_BIN}" --import tsx "${REPO_ROOT}/scripts/start-ui-server.ts" -- --port="${PORT}"
