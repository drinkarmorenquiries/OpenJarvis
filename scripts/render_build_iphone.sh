#!/usr/bin/env bash
# Build the user's patched iPhone UI while keeping the proven PyPI backend.
set -euo pipefail
cd "$(dirname "$0")/.."

python -m pip install "OpenJarvis[server,inference-google]==1.0.4" "google-genai<3.0.0"


# Render's start command is fixed in the dashboard to an older Gemini model.
# Keep the existing free service, migrate startup to the supported Gemini 3.8
# model, and ensure previously saved iPhone chats continue to work.
python - <<'PY'
from importlib.util import find_spec
from pathlib import Path
import sys

launcher = Path(sys.executable).parent / "jarvis"
launch_src = launcher.read_text()
if "import sys\n" not in launch_src:
    raise RuntimeError("OpenJarvis launcher changed; refusing unsafe model migration")
shim = (
    "import sys\n"
    "# Use supported Gemini model for this existing Render start command.\n"
    "for _i in range(len(sys.argv) - 1):\n"
    "    if sys.argv[_i] in ('--model', '-m') and sys.argv[_i + 1] == 'gemini-2.5-flash':\n"
    "        sys.argv[_i + 1] = 'gemini-3.8-flash'\n"
)
launch_src = launch_src.replace("import sys\n", shim, 1)
compile(launch_src, str(launcher), "exec")

spec = find_spec("openjarvis.engine.cloud")
if not spec or not spec.origin:
    raise RuntimeError("Installed OpenJarvis cloud engine missing")
engine_path = Path(spec.origin)
engine_src = engine_path.read_text()
model_list = "_GOOGLE_MODELS = [\n"
if model_list not in engine_src:
    raise RuntimeError("OpenJarvis Google model list changed")
engine_src = engine_src.replace(
    model_list,
    'def _render_legacy_model(model: str) -> str:\n'
    '    return "gemini-3.8-flash" if model == "gemini-2.5-flash" else model\n\n\n'
    + model_list + '    "gemini-3.8-flash",\n',
    1,
)
legacy_config = (
    "config = genai_types.GenerateContentConfig(\n"
    "            temperature=temperature,\n"
    "            max_output_tokens=max_tokens,\n"
    "        )"
)
modern_config = (
    "config = genai_types.GenerateContentConfig(\n"
    "            max_output_tokens=max_tokens,\n"
    "        )"
)
config_count = engine_src.count(legacy_config)
if not config_count:
    raise RuntimeError("Google config signature changed")
engine_src = engine_src.replace(legacy_config, modern_config)
legacy_call = "model=model,\n            contents=contents,\n            config=config,"
call_count = engine_src.count(legacy_call)
if not call_count:
    raise RuntimeError("Google SDK call sites changed")
engine_src = engine_src.replace(
    legacy_call,
    "model=_render_legacy_model(model),\n            contents=contents,\n            config=config,",
)
compile(engine_src, str(engine_path), "exec")
launcher.write_text(launch_src)
engine_path.write_text(engine_src)
print(f"Gemini 3.8 migration: patched {config_count} config(s), {call_count} call(s)")
PY
jarvis serve --help > /dev/null


# Render's Python runtime might not include a compatible Node toolchain.
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=22)?0:1)' || ! command -v npm >/dev/null 2>&1; then
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

# Use the exact npm version that passed the independent GitHub build.
mkdir -p "$HOME/.local/openjarvis-npm"
npm install --prefix "$HOME/.local/openjarvis-npm" --no-audit --no-fund --no-save npm@11.19.0
export PATH="$HOME/.local/openjarvis-npm/node_modules/.bin:$PATH"
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
