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

**Visitors need no API key and no sign-up.** The web app (`web/app.html`) calls a small backend, the Job Apply Helper API (`worker/`). The API is a Cloudflare Worker that holds the Groq key as a secret. Resumes, drafts and the tracker stay in the visitor's browser and are never stored on a server.

- **On GitHub Pages:** the page calls the API, and the API calls Groq with the owner's key.
- **On claude.ai (as a shared Artifact):** the page uses the visitor's own Claude account instead.

### How the API is protected

- Prompts are built **on the server** from `jobhelper/prompts.json`. The API only runs the app's six tasks, so it can't be used as a free general-purpose LLM endpoint.
- Only origins listed in `ALLOWED_ORIGINS` can call it (`worker/wrangler.toml`).
- Each IP address gets 6 requests per minute (Cloudflare rate limiting), and inputs are capped at 15,000 characters.
- If the main model is rate-limited, the API falls back to a smaller model.

### One-time setup (owner only)

1. Create a free Cloudflare account. Copy your **Account ID** from the dashboard sidebar.
2. Create an API token: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**.
3. In this repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `GROQ_API_KEY` (from https://console.groq.com/keys)
4. Run **Actions → Deploy API (Cloudflare Worker) → Run workflow**. The run summary shows the API URL, for example `https://job-apply-helper.<you>.workers.dev`.
5. The API URL is built into the page (`DEFAULT_API_URL` in `scripts/build_web.py`). To use a different URL, set a repository variable named `API_URL`, then re-run **Deploy web app to GitHub Pages**.

The API is redeployed automatically whenever `worker/` or the prompts change on `main`.

**Free-tier limits:** Groq's free tier allows roughly 30 requests a minute and a few thousand a day across all visitors. If the app becomes popular, upgrade to Groq's paid developer tier. It costs cents per thousand drafts.

### Deploying the page

GitHub Pages deploys from `main` (**Settings → Pages → Source: GitHub Actions**). To host it somewhere else, run `API_URL=https://your-worker.workers.dev python scripts/build_web.py` and upload `dist/`.

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
web/app.html     # the web app (prompts and API URL are injected at build time)
worker/          # Cloudflare Worker API that keeps the Groq key server-side
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
node --test worker/test/worker.test.mjs
python scripts/build_web.py && python -m http.server -d dist 8000
```

## License

MIT
