"""Dependency-free tests for direct iPhone chat and quota fallback patch."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from patch_free_chat import (
    _ROUTING_PRE,
    _GOOGLE_START,
    _GOOGLE_END,
    patch_routes,
    patch_cloud_router,
)

def run() -> None:
    route = (
        "router = APIRouter()\n"
        "async def chat_completions():\n"
        + _ROUTING_PRE +
        "    )\n"
        '    content=f"Sorry, an error occurred: {exc}"\n'
        '    content=f"\\n\\nError during generation: {exc}"\n'
    )
    patched = patch_routes(route)
    assert "X-Jarvis-Chat-Mode" in patched
    assert "_jarvis_mobile_chat_error" in patched
    assert patch_routes(patched) == patched
    assert "and not request_body.tools" in patched

    cloud = (
        "from __future__ import annotations\n"
        "import json\n"
        "from collections.abc import AsyncIterator\n"
        "from typing import Any, Sequence\n"
        "import httpx\n"
        + _GOOGLE_START
        + "    pass\n"
        + _GOOGLE_END
        + "\n\nasync def stream_local():\n    pass\n"
    )
    fixed = patch_cloud_router(cloud)
    assert 'resp.status_code == 429' in fixed
    assert '"gemini-3.1-flash-lite"' in fixed
    assert '"gemini-3.5-flash-lite"' in fixed
    assert patch_cloud_router(fixed) == fixed
    assert "return" in fixed
    print("Free Gemini chat request-budget and fallback checks passed")

if __name__ == "__main__":
    run()
