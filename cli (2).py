"""
Command-line interface for the Cover Letter Generator.

Usage:
    python cli.py "https://careers.example.com/job/12345"
"""

import argparse
import sys

from langchain_groq import ChatGroq

from config import load_settings
from job_extractor import scrape_job_posting, extract_job_fields
from profile_store import ProfileStore
from letter_generator import generate_cover_letter


def main():
    parser = argparse.ArgumentParser(description="Generate a tailored cover letter from a job posting URL.")
    parser.add_argument("job_url", help="URL of the job posting")
    parser.add_argument("--out", default=None, help="Optional file path to save the letter")
    args = parser.parse_args()

    settings = load_settings()
    llm = ChatGroq(groq_api_key=settings.groq_api_key, model_name=settings.llm_model)

    print("Scraping job posting...")
    page_data = scrape_job_posting(args.job_url)

    print("Extracting job details...")
    job_fields = extract_job_fields(llm, page_data)

    print("Retrieving relevant background...")
    store = ProfileStore(settings.candidate_profile_path, settings.vectorstore_path)
    profile_context = store.query(job_fields.get("skills", ""), n_results=5)

    print("Generating cover letter...\n")
    letter = generate_cover_letter(llm, job_fields, profile_context)

    print(letter)

    if args.out:
        with open(args.out, "w") as f:
            f.write(letter)
        print(f"\nSaved to {args.out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
