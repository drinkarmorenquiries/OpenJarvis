"""Dependency-free checks of the Render trace serialization patch."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from patch_trace_store import rewrite_trace_store


def run() -> None:
    sample = (
        "import json\n"
        "\n"
        "class Sample:\n"
        "    pass\n"
        "step = Sample()\n"
        "step.output = {'tool': {'blob': b'example-binary'}}\n"
        "trace = Sample()\n"
        "trace.metadata = {'other': bytearray(b'secret')}\n"
        "saved_output = json.dumps(step.output)\n"
        "saved_meta = json.dumps(trace.metadata)\n"
    )
    out = rewrite_trace_store(sample)
    scope = {}
    exec(out, scope)
    payload = json.loads(scope["saved_output"])
    assert payload["tool"]["blob"] == {"__binary_data__": True, "size_bytes": 14}
    meta = json.loads(scope["saved_meta"])
    assert meta["other"] == {"__binary_data__": True, "size_bytes": 6}
    assert rewrite_trace_store(out) == out  # idempotent on second run
    try:
        scope["_render_safe_trace_json"](object())
    except TypeError:
        pass
    else:
        raise AssertionError("Unexpected silent serialization of unknown object")
    print("Trace binary serialization checks passed")


if __name__ == "__main__":
    run()
