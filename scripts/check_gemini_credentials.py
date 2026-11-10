"""Non-secret pre-deployment health check for configured Google API keys.

Uses only the free ListModels metadata endpoint, never model generation.
Only outputs the variable's NAME and HTTP status, never the key or response.
Probe failure does not expose the secret and does not block Render startup.
"""
import os
import urllib.error
import urllib.request

URL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"

def run() -> None:
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        value = os.environ.get(name, "").strip().strip('"').strip("'")
        if not value:
            print(f"Gemini credential check: {name} is not configured")
            continue
        req = urllib.request.Request(URL, headers={"x-goog-api-key": value, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=7) as resp:
                status = resp.status
        except urllib.error.HTTPError as exc:
            status = exc.code
        except Exception:
            status = "unreachable"
        print(f"Gemini credential check: {name} ListModels HTTP {status}")

if __name__ == "__main__":
    run()
