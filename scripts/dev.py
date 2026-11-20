"""Local dev server: build the web app, serve it, and rebuild whenever a source file changes.

    python scripts/dev.py              # http://localhost:8000, talks to the deployed API
    python scripts/dev.py --local-api  # talk to a local Worker (cd worker && npx wrangler dev)
    python scripts/dev.py --port 3000

Edit anything in web/src/, shared/ or jobhelper/prompts.json, save, and refresh the browser.
"""

import argparse
import functools
import http.server
import os
import threading
import time
from pathlib import Path

import build_web  # lives next to this file

ROOT = Path(__file__).resolve().parent.parent
WATCH = [ROOT / "web" / "src", ROOT / "shared", ROOT / "jobhelper" / "prompts.json"]


def snapshot() -> float:
    newest = 0.0
    for item in WATCH:
        files = [item] if item.is_file() else [p for p in item.rglob("*") if p.is_file() and "test" not in p.parts]
        for f in files:
            newest = max(newest, f.stat().st_mtime)
    return newest


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):  # keep the console readable
        pass


def rebuild() -> None:
    try:
        build_web.build()
        print(time.strftime("%H:%M:%S"), "rebuilt")
    except SystemExit as e:        # build_web reports problems with SystemExit
        print(time.strftime("%H:%M:%S"), "BUILD FAILED:", e)
    except Exception as e:
        print(time.strftime("%H:%M:%S"), "BUILD FAILED:", repr(e))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--local-api", action="store_true", help="use http://localhost:8787 instead of the deployed API")
    args = ap.parse_args()
    if args.local_api:
        os.environ["API_URL"] = "http://localhost:8787"

    rebuild()
    handler = functools.partial(NoCache, directory=str(ROOT / "dist"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    api = os.environ.get("API_URL") or build_web.DEFAULT_API_URL
    print(f"Serving http://localhost:{args.port}  (API: {api})\nWatching web/src, shared, prompts.json. Ctrl+C to stop.")

    last = snapshot()
    try:
        while True:
            time.sleep(0.6)
            now = snapshot()
            if now != last:
                last = now
                rebuild()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
