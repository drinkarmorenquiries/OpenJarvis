#!/usr/bin/env bash
# Build the user's patched iPhone UI while keeping the proven PyPI backend.
set -euo pipefail
cd "$(dirname "$0")/.."

python -m pip install "OpenJarvis[server,inference-google]==1.0.4" "google-genai<3.0.0"


# Keep the existing Free Render start command compatible with current Gemini
# models and fall back safely on another free-tier model when Google is busy.
# No billing, provider or service changes are made by this build step.
python - <<'PY'
from importlib.util import find_spec
from pathlib import Path
import sys

launcher = Path(sys.executable).parent / "jarvis"
launch_src = launcher.read_text()
if "import sys\n" not in launch_src:
    raise RuntimeError("OpenJarvis launcher shape changed")
shim = (
    "import sys\n"
    "# Translate legacy Render model argument to the current supported model.\n"
    "for _i in range(len(sys.argv) - 1):\n"
    "    if sys.argv[_i] in ('--model', '-m') and sys.argv[_i + 1] == 'gemini-2.5-flash':\n"
    "        sys.argv[_i + 1] = 'gemini-3.6-flash'\n"
)
launch_src = launch_src.replace("import sys\n", shim, 1)
compile(launch_src, str(launcher), "exec")

spec = find_spec("openjarvis.engine.cloud")
if not spec or not spec.origin:
    raise RuntimeError("Installed OpenJarvis cloud engine missing")
engine_path = Path(spec.origin)
engine_src = engine_path.read_text()
model_list = "_GOOGLE_MODELS = [\n"
if engine_src.count(model_list) != 1:
    raise RuntimeError("OpenJarvis model registry changed")

resilient_google = '''
# Render iPhone Gemini stability fix: prioritize working free-tier stable
# models, never silently switch to a different provider or paid API.
_RENDER_GOOGLE_FALLBACKS = (
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
)


def _render_google_models(requested: str) -> list[str]:
    if not requested.startswith("gemini"):
        return [requested]
    if requested in ("gemini-2.5-flash", "gemini-3.8-flash"):
        return list(_RENDER_GOOGLE_FALLBACKS)
    return list(dict.fromkeys((requested,) + _RENDER_GOOGLE_FALLBACKS))


def _render_google_capacity_error(exc: Exception) -> bool:
    # Only try another model on an unavailable or unsupported model.
    # Do not hide an invalid API key, billing problem or bad prompt.
    code = getattr(exc, "code", None)
    if code is None:
        code = getattr(exc, "status_code", None)
    return code in (503, 404) or (
        "503 UNAVAILABLE" in str(exc) or "404 NOT_FOUND" in str(exc)
    )


def _render_google_generate(client, *, model, contents, config):
    candidates = _render_google_models(model)
    for index, candidate in enumerate(candidates):
        try:
            return client.models.generate_content(
                model=candidate, contents=contents, config=config
            )
        except Exception as exc:
            if not _render_google_capacity_error(exc) or index == len(candidates) - 1:
                raise
            logger.warning("Gemini %s unavailable; trying free-tier fallback", candidate)
    raise RuntimeError("No Gemini model available")


def _render_google_stream(client, *, model, contents, config):
    candidates = _render_google_models(model)
    for index, candidate in enumerate(candidates):
        emitted = False
        try:
            for chunk in client.models.generate_content_stream(
                model=candidate, contents=contents, config=config
            ):
                emitted = True
                yield chunk
            return
        except Exception as exc:
            # Once tokens have begun streaming, never duplicate partial output.
            if emitted or not _render_google_capacity_error(exc) or index == len(candidates) - 1:
                raise
            logger.warning("Gemini %s stream unavailable; trying fallback", candidate)
    raise RuntimeError("No Gemini streaming model available")


'''
engine_src = engine_src.replace(
    model_list,
    resilient_google + model_list
    + '    "gemini-3.6-flash",\n'
    + '    "gemini-3.5-flash-lite",\n'
    + '    "gemini-3.1-flash-lite",\n'
    + '    "gemini-3.8-flash",\n',
    1,
)
old_config = (
    "config = genai_types.GenerateContentConfig(\n"
    "            temperature=temperature,\n"
    "            max_output_tokens=max_tokens,\n"
    "        )"
)
new_config = (
    "config = genai_types.GenerateContentConfig(\n"
    "            max_output_tokens=max_tokens,\n"
    "        )"
)
config_count = engine_src.count(old_config)
if not config_count:
    raise RuntimeError("Google sampling config signature changed")
engine_src = engine_src.replace(old_config, new_config)
generate_call = "self._google_client.models.generate_content("
stream_call = "self._google_client.models.generate_content_stream("
generate_count = engine_src.count(generate_call)
stream_count = engine_src.count(stream_call)
if generate_count != 1 or stream_count != 2:
    raise RuntimeError(f"Unexpected Gemini call sites: {generate_count}/{stream_count}")
engine_src = engine_src.replace(
    generate_call, "_render_google_generate(self._google_client, "
).replace(
    stream_call, "_render_google_stream(self._google_client, "
)
compile(engine_src, str(engine_path), "exec")
launcher.write_text(launch_src)
engine_path.write_text(engine_src)
print(
    f"Gemini free-tier fallback installed: {generate_count} sync, "
    f"{stream_count} streams, {config_count} configs"
)
PY
jarvis serve --help > /dev/null

# Fix bytes returned by tools crashing SQLite trace persistence.
# This patches the installed PyPI module only, leaving all other code intact.
python scripts/patch_trace_store.py
python scripts/test_trace_store_patch.py

# Reduce free Gemini RPM usage on ordinary iPhone chat.
python scripts/patch_free_chat.py
python scripts/test_free_chat_patch.py


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
