"""Repair OpenJarvis 1.0.4 trace writes when a tool emits binary data.

The PyPI package in Render differs from the GitHub fork. We patch only the
installed trace JSON call sites rather than replacing the whole trace module.
Binary contents are redacted, retaining only byte length for diagnostics.
"""

from __future__ import annotations

import json
from importlib.util import find_spec
from pathlib import Path

_JSON_ARGS = (
    "trace.metadata",
    "trace.messages",
    "step.input",
    "step.output",
    "step.metadata",
)

_HELPER = '''
def _render_safe_trace_json(value):
    """Keep bytes out of traces; preserve only diagnostic length."""
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__binary_data__": True, "size_bytes": len(value)}
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


'''


def rewrite_trace_store(source: str) -> str:
    """Patch the specific JSON dump calls used by trace persistence.

    Abort if the expected step.output serialization location is missing.
    Re-running the patch is safe, so rebuilds remain reproducible.
    """
    if "_render_safe_trace_json" in source:
        if "default=_render_safe_trace_json" not in source:
            raise RuntimeError("Unexpected partial trace serialization patch")
        return source

    if "import json\n" not in source:
        raise RuntimeError("Missing JSON import in OpenJarvis trace store")
    if "json.dumps(step.output)" not in source:
        raise RuntimeError("Unexpected OpenJarvis trace output serialization")

    patched = source.replace("import json\n", "import json\n\n" + _HELPER, 1)
    substitutions = 0
    for arg in _JSON_ARGS:
        before = f"json.dumps({arg})"
        if before in patched:
            patched = patched.replace(
                before,
                f"json.dumps({arg}, default=_render_safe_trace_json)",
            )
            substitutions += 1
    if substitutions == 0:
        raise RuntimeError("No trace JSON writes were patched")
    compile(patched, "<patched openjarvis trace store>", "exec")
    return patched


def main() -> None:
    spec = find_spec("openjarvis.traces.store")
    if spec is None or not spec.origin:
        raise RuntimeError("Installed OpenJarvis trace store was not found")
    target = Path(spec.origin)
    original = target.read_text(encoding="utf-8")
    updated = rewrite_trace_store(original)
    if updated != original:
        target.write_text(updated, encoding="utf-8")
    print("Trace JSON serialization guard installed for binary tool output")


if __name__ == "__main__":
    main()
