#!/usr/bin/env bash
# Build the user's patched iPhone UI while keeping the proven PyPI backend.
set -euo pipefail
cd "$(dirname "$0")/.."

python -m pip install "OpenJarvis[server,inference-google]==1.0.4" "google-genai<3.0.0"

# Render's Python runtime might not include a compatible Node toolchain.
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || ! command -v npm >/dev/null 2>&1; then
  case "$(uname -m)" in
    x86_64) NODE_ARCH=x64; NODE_SHA=e798599612f4bb71333a3397ab0d095fd62214e115aea45aa858a145fc72d67e ;;
    aarch64) NODE_ARCH=arm64; NODE_SHA=aa881151bd0f9f154a0424dd60a72e9ce10672619121658c278a24327ef46831 ;;
    *) echo "Unsupported Node architecture"; exit 1 ;;
  esac
  NODE_TARBALL="node-v24.13.0-linux-${NODE_ARCH}.tar.xz"
  curl -fsSL --retry 3 "https://nodejs.org/dist/v24.13.0/${NODE_TARBALL}" -o "/tmp/${NODE_TARBALL}"
  echo "${NODE_SHA}  /tmp/${NODE_TARBALL}" | sha256sum --check
  mkdir -p "$HOME/.local/openjarvis-node"
  tar -xJf "/tmp/${NODE_TARBALL}" --strip-components=1 -C "$HOME/.local/openjarvis-node"
  export PATH="$HOME/.local/openjarvis-node/bin:$PATH"
fi

echo "Node $(node --version), npm $(npm --version)"
(cd frontend && npm ci --no-audit --no-fund && npm run build)

# The deployed FastAPI package serves static assets from site-packages, not
# the cloned Git checkout. Copy the newly built web app into that package.
python - <<'PY'
from importlib.util import find_spec
from pathlib import Path
import shutil

src = Path("src/openjarvis/server/static").resolve()
spec = find_spec("openjarvis.server")
if spec is None or spec.origin is None:
    raise RuntimeError("Installed OpenJarvis server package was not found")
dst = Path(spec.origin).resolve().parent / "static"
if not (src / "index.html").is_file():
    raise RuntimeError("Frontend compilation did not produce index.html")
if dst.resolve() != src:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
print(f"Patched iPhone frontend installed: {dst}")
PY
