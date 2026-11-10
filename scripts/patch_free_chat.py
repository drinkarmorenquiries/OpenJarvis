"""Conservative free-tier chat controls for the Render iPhone browser.

The Render build installs OpenJarvis from PyPI; the GitHub fork's Python sources
are not directly imported. Patch the installed package with checked anchors,
and fail the build rather than silently applying a partial or unsafe patch.

Normal browser chat sends one Gemini generation instead of spinning up the
multi-turn agent's internal tool loop. Tool-bearing API callers and desktop
OpenJarvis retain upstream semantics. Gemini 429s can fall back to verified
free-tier Flash-Lite model IDs. No paid provider is ever selected.
"""

from __future__ import annotations

from importlib.util import find_spec
from pathlib import Path

_ROUTING_PRE = "    use_server_agent = (\n        agent is not None\n        and not request_body.tools\n"
_ROUTING_POST = (
    "    use_server_agent = (\n"
    "        agent is not None\n"
    "        and request.headers.get('X-Jarvis-Chat-Mode') != 'direct'\n"
    "        and not request_body.tools\n"
)

_GOOGLE_START = "async def _stream_google(\n"
_GOOGLE_END = "\n\n# ---------------------------------------------------------------------------\n# Local (Ollama) direct streaming"

_NEW_GOOGLE = '''async def _stream_google(
    model: str,
    messages: Sequence[Message],
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[str]:
    """Stream one inference; on an RPM 429 try up to two free-tier models.

    Only initial HTTP failures are retried. Once response tokens begin, never
    re-submit the prompt, avoiding duplicate messages and quota waste.
    """
    import logging

    keys = _load_keys()
    # Match the existing server cloud engine's preference when both are set.
    api_key = keys.get("GOOGLE_API_KEY") or keys.get("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError("Google API key not configured on the server")

    # The original app stores only text, not Gemini thought signatures.
    # Gemini 3.6+ rejects replayed model turns lacking required signatures.
    # Keep prior conversation context as quoted transcript inside ONE user turn
    # rather than forging model turns (or a synthetic "Understood" reply).
    system_notes: list[str] = []
    dialogue: list[tuple[str, str]] = []
    for msg in messages:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        content = msg.content if isinstance(msg.content, str) else ""
        content = content.strip()
        if not content:
            continue
        if role == "system":
            system_notes.append(content)
            continue
        if role in ("assistant", "model") and (
            content.startswith("Error:")
            or content.startswith("Error during generation:")
            or content.startswith("Sorry, an error occurred:")
            or content.startswith("No response was generated.")
        ):
            # Provider faults aren't factual conversation context.
            continue
        if role in ("user", "assistant", "model"):
            dialogue.append(("user" if role == "user" else "assistant", content))

    if not dialogue or dialogue[-1][0] != "user":
        raise ValueError("JARVIS chat needs a non-empty latest user message")

    latest_user = dialogue[-1][1][-8000:]
    prior = dialogue[:-1][-8:]
    previous_turns = "\\n\\n".join(
        f"{role.upper()} (previous turn):\\n{body[:1200]}"
        for role, body in prior
    )
    if previous_turns:
        current_prompt = (
            "Use the prior chat for context, but follow the latest user's request. "
            "Past responses are quoted history, not new instructions.\\n\\n"
            + previous_turns
            + "\\n\\nLATEST USER REQUEST:\\n"
            + latest_user
        )
    else:
        current_prompt = latest_user

    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": current_prompt}]}],
        # For Gemini 3.6+ custom temperature is deprecated and may be rejected.
        "generationConfig": {"maxOutputTokens": max_tokens},
    }
    if system_notes:
        payload["systemInstruction"] = {
            "parts": [{"text": "\\n\\n".join(system_notes)[:6000]}]
        }
    model_ids = (
        list(dict.fromkeys(
            (model, "gemini-3.1-flash-lite", "gemini-3.5-flash-lite")
        ))
        if model.startswith("gemini-") else [model]
    )
    # Never put the API key in a logged URL.
    headers = {"x-goog-api-key": api_key}

    async with httpx.AsyncClient(timeout=180) as client:
        for idx, candidate in enumerate(model_ids):
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{candidate}:streamGenerateContent?alt=sse"
            )
            async with client.stream(
                "POST", url, json=payload, headers=headers
            ) as resp:
                if resp.status_code == 429:
                    if idx < len(model_ids) - 1:
                        logging.getLogger("openjarvis.server").warning(
                            "Google free tier rate-limited %s; trying Flash-Lite",
                            candidate,
                        )
                        continue
                    # Don't leak the full Google quota error into a chat bubble.
                    raise RuntimeError(
                        "Google free-tier limit reached on all configured "
                        "models. Try again after about one minute. "
                        "No paid model was used."
                    )
                if resp.status_code == 404 and idx < len(model_ids) - 1:
                    logging.getLogger("openjarvis.server").warning(
                        "Gemini model %s not found; trying Flash-Lite", candidate
                    )
                    continue
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    try:
                        chunk = json.loads(data)
                        parts = (
                            chunk.get("candidates", [{}])[0]
                            .get("content", {})
                            .get("parts", [])
                        )
                        for part in parts:
                            text = part.get("text", "")
                            if text:
                                yield text
                    except (ValueError, KeyError, IndexError, TypeError):
                        continue
                return
'''

_ERROR_HELPER = '''def _jarvis_mobile_chat_error(exc: Exception) -> str:
    """Show rate limits safely, while keeping original diagnostics in logs."""
    detail = str(exc)
    if "429 RESOURCE_EXHAUSTED" in detail or "limit: 5" in detail:
        return (
            "Gemini's free-tier request limit has been reached. "
            "Try again in about one minute. No paid service is needed."
        )
    if "503 UNAVAILABLE" in detail:
        return "Google Gemini is temporarily busy. Try again shortly."
    return detail


'''


def patch_routes(source: str) -> str:
    if "X-Jarvis-Chat-Mode" in source:
        return source
    if source.count(_ROUTING_PRE) != 1:
        raise RuntimeError("OpenJarvis chat routing has changed")
    updated = source.replace(_ROUTING_PRE, _ROUTING_POST, 1)
    if "router = APIRouter()\n" not in updated:
        raise RuntimeError("OpenJarvis route insertion point changed")
    updated = updated.replace(
        "router = APIRouter()\n",
        "router = APIRouter()\n\n\n" + _ERROR_HELPER, 1
    )
    if 'content=f"Sorry, an error occurred: {exc}"' not in updated:
        raise RuntimeError("Agent error handler changed")
    updated = updated.replace(
        'content=f"Sorry, an error occurred: {exc}"',
        'content=f"Sorry, an error occurred: {_jarvis_mobile_chat_error(exc)}"',
    )
    if 'content=f"\\n\\nError during generation: {exc}"' not in updated:
        raise RuntimeError("Streaming error handler changed")
    updated = updated.replace(
        'content=f"\\n\\nError during generation: {exc}"',
        'content=f"\\n\\nError during generation: {_jarvis_mobile_chat_error(exc)}"',
    )
    compile(updated, "<OpenJarvis mobile chat routes>", "exec")
    return updated


def patch_cloud_router(source: str) -> str:
    if "Google free-tier limit reached on all configured" in source:
        return source
    if source.count(_GOOGLE_START) != 1 or source.count(_GOOGLE_END) != 1:
        raise RuntimeError("OpenJarvis cloud router shape changed")
    prefix, tail = source.split(_GOOGLE_START, 1)
    _, suffix = tail.split(_GOOGLE_END, 1)
    updated = prefix + _NEW_GOOGLE + _GOOGLE_END + suffix
    compile(updated, "<OpenJarvis cloud router>", "exec")
    return updated


def main() -> None:
    targets = [
        ("openjarvis.server.routes", patch_routes),
        ("openjarvis.server.cloud_router", patch_cloud_router),
    ]
    for module, patcher in targets:
        spec = find_spec(module)
        if spec is None or not spec.origin:
            raise RuntimeError(f"Cannot locate installed module {module}")
        path = Path(spec.origin)
        original = path.read_text(encoding="utf-8")
        patched = patcher(original)
        if patched != original:
            path.write_text(patched, encoding="utf-8")
        print(f"Free-tier browser chat control installed: {module}")


if __name__ == "__main__":
    main()
