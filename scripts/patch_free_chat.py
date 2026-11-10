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
    """Use a valid configured Gemini key and only free Flash-family models.

    Avoid repeated agent calls and fail over between the two differently
    named Google credentials only if the provider rejects authentication.
    No credentials are included in URLs, error text, or log output.
    """
    import logging

    keys = _load_keys()
    credentials = []
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        value = str(keys.get(name, "")).strip().strip('"').strip("'")
        if value and not any(existing == value for _, existing in credentials):
            credentials.append((name, value))
    if not credentials:
        raise RuntimeError("Neither GEMINI_API_KEY nor GOOGLE_API_KEY is configured on Render")

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
        "generationConfig": {"maxOutputTokens": max_tokens},
    }
    if system_notes:
        payload["systemInstruction"] = {
            "parts": [{"text": "\\n\\n".join(system_notes)[:6000]}]
        }

    model_ids = list(dict.fromkeys(
        (model, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite")
    )) if model.startswith("gemini-") else [model]
    logger = logging.getLogger("openjarvis.server")

    async with httpx.AsyncClient(timeout=180) as client:
        for idx, candidate in enumerate(model_ids):
            next_model = False
            for key_idx, (key_name, api_key) in enumerate(credentials):
                url = (
                    "https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{candidate}:streamGenerateContent?alt=sse"
                )
                async with client.stream(
                    "POST", url, json=payload,
                    headers={"x-goog-api-key": api_key},
                ) as resp:
                    if resp.status_code in (400, 403):
                        # Only structured Google status/reason, never raw body or key.
                        raw = (await resp.aread())[:8192]
                        try:
                            detail = json.loads(raw).get("error", {})
                            status = str(detail.get("status", "INVALID_ARGUMENT"))
                            message = str(detail.get("message", ""))
                            reasons = [
                                d.get("reason", "")
                                for d in detail.get("details", [])
                                if isinstance(d, dict)
                            ]
                        except (ValueError, TypeError, AttributeError):
                            status, message, reasons = "UNKNOWN", "", []
                        bad_key = (
                            "API_KEY_INVALID" in (status + " " + " ".join(reasons))
                            or "API key not valid" in message
                            or "API_KEY_SERVICE_BLOCKED" in " ".join(reasons)
                        )
                        if bad_key:
                            logger.warning("Gemini authentication rejected %s; trying another configured key if present", key_name)
                            if key_idx < len(credentials) - 1:
                                continue
                            raise RuntimeError(
                                "Google rejected both configured Gemini API keys. "
                                "A valid Google AI Studio key is required on Render. "
                                "Your OpenJarvis iPhone access key is separate."
                            )
                        if resp.status_code == 403 and key_idx < len(credentials) - 1:
                            logger.warning("Gemini denied %s; trying alternative configured key", key_name)
                            continue
                        if "thought_signature" in message.lower():
                            raise RuntimeError(
                                "This conversation has incompatible Gemini history. "
                                "Start a new conversation and try again."
                            )
                        if idx < len(model_ids) - 1:
                            logger.warning("Gemini %s rejected request with %s; trying free Flash-Lite alternative", candidate, status[:64])
                            next_model = True
                            break
                        raise RuntimeError(
                            "Google rejected the Gemini request ("
                            + str(resp.status_code)
                            + ": " + status[:64] + "). "
                            "Check the Google API configuration."
                        )

                    if resp.status_code in (404, 429, 503):
                        if idx < len(model_ids) - 1:
                            logger.warning("Gemini %s returned HTTP %s; trying free Flash-Lite alternative", candidate, resp.status_code)
                            next_model = True
                            break
                        raise RuntimeError(
                            "Google Gemini free models are temporarily "
                            "unavailable or rate-limited. Please try again later."
                        )

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
            if next_model:
                continue
            raise RuntimeError("No valid Gemini API key was accepted by Google")
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
