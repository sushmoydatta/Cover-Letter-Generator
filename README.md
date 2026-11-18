# Job Apply Helper

Paste a job posting and your resume, and get everything you need to apply. Every output is grounded in your actual resume: the prompts forbid the model from inventing experience, skills or numbers.

| Tool | What you get |
|---|---|
| **Match report** | A 0-100 fit score, which requirements you meet, which ones your resume doesn't show, and keywords you can truthfully add |
| **Cover letter** | A tailored letter in one of four styles: professional, enthusiastic, concise or academic |
| **Resume tweaks** | A targeted headline, bullets rewritten in the posting's language, and a "do not claim" list |
| **Recruiter outreach** | A LinkedIn note under 300 characters, a recruiter email, a referral request and a follow-up |
| **Interview prep** | Likely questions with talking points from your resume, the tough spots, and questions to ask them |
| **Application question** | An answer to any form question, such as "Why do you want to work here?" |
| **Tracker** | Saved applications with a status for each (Saved → Applied → Interviewing → Offer / Rejected) |

## Use it in the browser

The web app is a single static page (`web/app.html`) with no backend. Your resume, API key and tracker stay in your browser's local storage.

- **On GitHub Pages:** visitors pick a provider in *AI settings* and paste their own key. [Groq](https://console.groq.com/keys) has a free tier. OpenAI, OpenRouter and any OpenAI-compatible endpoint also work.
- **On claude.ai (as a shared Artifact):** the page uses the visitor's own Claude account, so no key is needed. A visitor has to be signed in to Claude.

### Deploying to GitHub Pages

1. Merge this branch into `main`.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The `Deploy web app to GitHub Pages` workflow runs on every push to `main`. The site is published at `https://<user>.github.io/Cover-Letter-Generator/`.

To host it somewhere else (Netlify, Vercel, Cloudflare Pages), run `python scripts/build_web.py` and upload the `dist/` folder.

## Use it from the command line

```bash
pip install -e .
cp .env.example .env        # add GROQ_API_KEY (free) or another provider's key
```

```bash
jobhelper match     --resume resume.pdf --job "https://careers.example.com/job/123"
jobhelper letter    --resume resume.pdf --job-file posting.txt --style concise --out letter.txt
jobhelper tailor    --resume resume.pdf --job-file posting.txt
jobhelper outreach  --resume resume.pdf --job-file posting.txt --contact "Priya, Engineering Manager"
jobhelper interview --resume resume.pdf --job-file posting.txt
jobhelper answer    --resume resume.pdf --job-file posting.txt --question "Why do you want to join us?"
jobhelper all       --resume resume.pdf --job "https://..." --out-dir applications/acme   # the full kit
```

- `--resume` accepts `.pdf`, `.txt`, `.md`, or the older `Field,Value` profile `.csv`. See `data/resume.example.md`.
- `--job` takes a URL or the posting text itself. Pages that render with JavaScript are read through the r.jina.ai reader. If a site blocks it, save the posting to a file and use `--job-file`.
- `--provider groq|openai|openrouter|ollama` and `--model` override the defaults. You can also set `LLM_BASE_URL` to use any OpenAI-compatible server.

## Project structure

```
jobhelper/
  prompts.json   # all prompts in one place (used by the CLI and the web app)
  prompts.py     # renders prompts
  tasks.py       # match / letter / tailor / outreach / interview / answer
  llm.py         # small OpenAI-compatible client with tolerant JSON parsing
  sources.py     # job page fetching and resume loading (PDF/TXT/MD/CSV)
  config.py      # provider settings from env / .env
  cli.py         # `jobhelper` command
web/app.html     # the web app (prompts are injected at build time)
scripts/build_web.py
tests/           # pytest suite (no network; the LLM is mocked)
notebooks/exploration.ipynb   # original prototype
.github/workflows/  # CI + GitHub Pages deploy
```

## Design notes

- **The whole resume goes into the prompt.** The first version used a Chroma vector store, but a resume is only 1-2 pages and fits easily in context. Retrieval was dropping relevant facts. Giving the model the full resume produces better letters and needs far fewer dependencies (no langchain or chromadb).
- **Prompts are defined once.** The CLI reads `prompts.json`, and `build_web.py` inlines the same file into the web app, so the two can't drift apart.
- **Grounding.** The system prompt forbids invented facts. The match report and resume tweaks also list what the resume *doesn't* show, so candidates don't overclaim.
- **No secrets in source.** Keys come from `.env` (gitignored) or the visitor's browser.

## Development

```bash
pip install -e ".[dev]"
pytest -q
python scripts/build_web.py && python -m http.server -d dist 8000
```

## License

MIT
