"""Build the web app: inject jobhelper/prompts.json into web/app.html.

Outputs:
  dist/index.html  full HTML document, for GitHub Pages or any static host
  dist/app.html    body fragment, for hosts that wrap pages in their own skeleton (claude.ai artifacts)
"""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKER = "/*PROMPTS*/null"
API_MARKER = '/*API_URL*/""'
# URL of the deployed Cloudflare Worker (see worker/). Override with the API_URL env var.
DEFAULT_API_URL = "https://job-apply-helper.sushmoi007.workers.dev"


def build() -> Path:
    src = (ROOT / "web" / "app.html").read_text(encoding="utf-8")
    prompts = json.loads((ROOT / "jobhelper" / "prompts.json").read_text(encoding="utf-8"))
    if MARKER not in src:
        raise SystemExit(f"Marker {MARKER!r} not found in web/app.html")
    # Escape "</" so prompt text can never close the <script> tag.
    fragment = src.replace(MARKER, json.dumps(prompts, ensure_ascii=False).replace("</", "<\\/"))
    api_url = (os.environ.get("API_URL") or DEFAULT_API_URL).strip().rstrip("/")
    if API_MARKER not in fragment:
        raise SystemExit(f"Marker {API_MARKER!r} not found in web/app.html")
    fragment = fragment.replace(API_MARKER, json.dumps(api_url))
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "app.html").write_text(fragment, encoding="utf-8")
    page = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        "<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>\n"
        "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n"
    )
    (dist / "index.html").write_text(page, encoding="utf-8")
    return dist


if __name__ == "__main__":
    print(f"Built {build()}/index.html and app.html")
