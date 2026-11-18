"""Build the web app from web/src/ and the shared engine.

  web/src/head.html, base.css, layout.css, body.html, js/*.js  (joined in file-name order)
  shared/jobextract.js + shared/ats.js                         (inlined as `ATS`, same code the Worker runs)
  jobhelper/prompts.json                                       (injected as PROMPTS)

Outputs:
  dist/index.html  full HTML document, for GitHub Pages or any static host
  dist/app.html    body fragment, for hosts that wrap pages in their own skeleton (claude.ai artifacts)
"""

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
DEFAULT_API_URL = "https://job-apply-helper.sushmoi007.workers.dev"   # override with the API_URL env var
ENGINE_EXPORTS = ("analyze, findSkills, parseResume, parseJob, scoreBullet, skillMatches, monthsOfExperience, "
                  "cleanJobText, titleFromText, cleanTitle, extractJobFromHtml, htmlToText")


def strip_module(text: str) -> str:
    text = re.sub(r"^export ", "", text, flags=re.M)
    return re.sub(r"^import .*;\s*$", "", text, flags=re.M)


def build_engine() -> str:
    parts = [strip_module((ROOT / "shared" / name).read_text(encoding="utf-8")) for name in ("jobextract.js", "ats.js")]
    seen: dict[str, int] = {}
    for i, part in enumerate(parts):
        for name in re.findall(r"^(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", part, flags=re.M):
            if name in seen and seen[name] != i:
                raise SystemExit(f"Name clash between shared modules: {name!r}")
            seen[name] = i
    body = "\n".join(parts)
    return f"const ATS = (() => {{\n{body}\nreturn {{ {ENGINE_EXPORTS} }};\n}})();".replace("</", "<\\/")


def build() -> Path:
    prompts = json.loads((ROOT / "jobhelper" / "prompts.json").read_text(encoding="utf-8"))
    css = "".join((SRC / name).read_text(encoding="utf-8") for name in ("base.css", "layout.css"))
    js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((SRC / "js").glob("*.js")))
    api_url = (os.environ.get("API_URL") or DEFAULT_API_URL).strip().rstrip("/")

    for marker in ("/*ATS_ENGINE*/", "/*PROMPTS*/null", '/*API_URL*/""'):
        if marker not in js:
            raise SystemExit(f"Marker {marker!r} not found in web/src/js")
    engine = build_engine()
    js = js.replace("/*ATS_ENGINE*/", engine, 1)
    js = js.replace("/*PROMPTS*/null", json.dumps(prompts, ensure_ascii=False).replace("</", "<\\/"), 1)
    js = js.replace('/*API_URL*/""', json.dumps(api_url), 1)

    fragment = (
        (SRC / "head.html").read_text(encoding="utf-8")
        + f"<style>\n{css}</style>\n"
        + (SRC / "body.html").read_text(encoding="utf-8")
        + f"<script>\n{js}\n</script>\n"
    )
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "app.html").write_text(fragment, encoding="utf-8")
    page = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        "<style>[hidden]{display:none!important}body{margin:0;font-size:14px}img{max-width:100%}</style>\n"
        "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n"
    )
    (dist / "index.html").write_text(page, encoding="utf-8")
    return dist


if __name__ == "__main__":
    print(f"Built {build()}/index.html and app.html")
