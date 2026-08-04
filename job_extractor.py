"""
Scrapes a job posting URL and extracts structured fields (role, experience,
skills, description) using an LLM.
"""

from langchain_community.document_loaders import WebBaseLoader
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import PromptTemplate

EXTRACT_PROMPT = PromptTemplate.from_template(
    """
    ### SCRAPED TEXT FROM WEBSITE:
    {page_data}

    ### INSTRUCTION:
    The scraped text is from the careers page of a company website.
    Extract the job posting and return it as JSON with exactly these keys:
    'role', 'experience', 'skills', and 'description'.
    Return only valid JSON — no preamble, no markdown fences.
    ### VALID JSON:
    """
)


def scrape_job_posting(url: str) -> str:
    """Fetch and return the raw text content of a job posting page."""
    loader = WebBaseLoader(url)
    page = loader.load().pop()
    return page.page_content


def extract_job_fields(llm, page_data: str) -> dict:
    """Use the LLM to pull structured fields out of scraped job posting text."""
    chain = EXTRACT_PROMPT | llm
    response = chain.invoke({"page_data": page_data})

    parser = JsonOutputParser()
    return parser.parse(response.content)
