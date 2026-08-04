"""
Generates a tailored cover letter given structured job fields and relevant
candidate profile snippets.
"""

from langchain_core.prompts import PromptTemplate

COVER_LETTER_PROMPT = PromptTemplate.from_template(
    """
    ### JOB POSTING:
    Role: {role}
    Experience required: {experience}
    Skills required: {skills}
    Description: {description}

    ### CANDIDATE BACKGROUND (relevant excerpts):
    {profile_context}

    ### INSTRUCTION:
    Write a concise, professional cover letter (under 350 words) tailored to this job posting,
    using only the candidate background provided above. Do not invent experience or skills
    that aren't supported by the background. Return plain text only.
    """
)


def generate_cover_letter(llm, job_fields: dict, profile_context: list[str]) -> str:
    chain = COVER_LETTER_PROMPT | llm
    response = chain.invoke(
        {
            "role": job_fields.get("role", ""),
            "experience": job_fields.get("experience", ""),
            "skills": job_fields.get("skills", ""),
            "description": job_fields.get("description", ""),
            "profile_context": "\n".join(f"- {c}" for c in profile_context),
        }
    )
    return response.content
