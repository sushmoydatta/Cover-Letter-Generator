# Cover Letter Generator

An LLM-powered pipeline that turns a job posting URL into a tailored cover letter — grounded in your actual background, not hallucinated.

## How it works

1. **Scrape** — pulls the raw text of a job posting page (`langchain_community.WebBaseLoader`).
2. **Extract** — an LLM (Llama 3.3 70B via Groq) parses the scraped text into structured fields: role, experience, skills, description.
3. **Retrieve** — your background (skills, education, experience) is stored as embeddings in a local Chroma vector store. The pipeline retrieves the snippets most relevant to the job's required skills.
4. **Generate** — the LLM writes a cover letter using only the retrieved, relevant background — this keeps the output grounded and reduces fabricated claims.

```
Job URL → scrape → extract fields (LLM) → retrieve relevant profile chunks (RAG) → generate letter (LLM)
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
# edit .env and add your GROQ_API_KEY (get one at https://console.groq.com)
```

Add your background to `data/profile.csv` with two columns, `Field` and `Value`:

```csv
Field,Value
Skills,"Python, SQL, Machine Learning, VLSI Design"
Education,"M.Tech in Electronics & Communication Engineering, IIT (ISM) Dhanbad"
Experience,"Teaching Assistant, Basic Electronics — IIT ISM"
```

## Usage

```bash
python cli.py "https://careers.example.com/software-engineer/job/12345"
```

Save directly to a file:

```bash
python cli.py "https://careers.example.com/job/12345" --out letter.txt
```

## Project structure

```
cover-letter-generator/
├── cli.py                 # Entry point — orchestrates the full pipeline
├── config.py               # Loads settings/secrets from environment variables
├── job_extractor.py         # Scraping + structured field extraction
├── profile_store.py         # Chroma vector store for candidate background
├── letter_generator.py      # Final letter generation
├── data/
│   └── profile.csv          # Your background (not committed — see .gitignore)
├── .env.example
├── requirements.txt
└── README.md
```

## Notes on design choices

- **RAG over hardcoding**: candidate background is retrieved via similarity search rather than stuffed entirely into the prompt, so this scales to a longer, more detailed profile without blowing the context window.
- **Secrets never touch source**: API key and config load from environment variables via `python-dotenv`. `.env` is gitignored.
- **Grounding, not generation from scratch**: the letter prompt explicitly restricts the model to the retrieved background to reduce hallucinated experience.

## Possible extensions

- Support multiple LLM providers (OpenAI, Anthropic) behind a common interface
- Add a lightweight web UI (Streamlit/Gradio)
- Batch mode: generate letters for a list of job URLs in one run

## License

MIT
