import json

import pytest

from jobhelper import cli, tasks
from jobhelper.llm import LLMError, parse_json
from jobhelper.prompts import load_prompts, render
from jobhelper.sources import html_to_text, load_job, load_resume

RESUME = "Jane Doe\nSkills: Python, SQL"
JOB = "Data Analyst at Acme. Requires Python, SQL, Tableau."


def fake_llm(reply):
    calls = []

    def llm(system, user):
        calls.append((system, user))
        return reply

    llm.calls = calls
    return llm


def test_parse_json_variants():
    assert parse_json('{"a": 1}') == {"a": 1}
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('Sure! Here it is: {"a": [1, 2]} hope it helps') == {"a": [1, 2]}
    with pytest.raises(LLMError):
        parse_json("no json here")


def test_render_fills_placeholders_and_keeps_braces():
    system, user = render("answer", "R {weird}", "J", "Why us?")
    assert "ONLY facts" in system
    assert "R {weird}" in user and "Why us?" in user and "{resume}" not in user


def test_every_task_has_required_placeholders():
    data = load_prompts()
    for name, task in data["tasks"].items():
        assert "{resume}" in task["prompt"] and "{job}" in task["prompt"], name
        assert task["label"]


def test_match_report_normalises():
    reply = json.dumps({"score": "140", "role": "Data Analyst", "company": "Acme",
                        "matched_skills": ["Python"], "missing_skills": "Tableau"})
    report = tasks.match_report(fake_llm(reply), RESUME, JOB)
    assert report["score"] == 100
    assert report["missing_skills"] == ["Tableau"]
    assert report["gaps"] == []
    text = tasks.format_match_report(report)
    assert "100/100" in text and "Data Analyst at Acme" in text


def test_cover_letter_uses_style():
    llm = fake_llm("Dear team...")
    assert tasks.cover_letter(llm, RESUME, JOB, "concise") == "Dear team..."
    assert "150-200 words" in llm.calls[0][1]
    with pytest.raises(KeyError):
        tasks.cover_letter(llm, RESUME, JOB, "nope")


def test_html_to_text_strips_scripts():
    text = html_to_text("<html><script>x=1</script><h1>Engineer</h1><p>Build things</p></html>")
    assert "x=1" not in text and "Engineer" in text and "Build things" in text


def test_load_resume_formats(tmp_path):
    md = tmp_path / "r.md"
    md.write_text("# Jane\nPython", encoding="utf-8")
    assert "Jane" in load_resume(str(md))
    csv_file = tmp_path / "profile.csv"
    csv_file.write_text('Field,Value\nSkills,"Python, SQL"\n', encoding="utf-8")
    assert load_resume(str(csv_file)) == "Skills: Python, SQL"
    with pytest.raises(FileNotFoundError):
        load_resume(str(tmp_path / "missing.pdf"))


def test_load_job_text_and_file(tmp_path):
    assert load_job("Plain posting text") == "Plain posting text"
    f = tmp_path / "job.txt"
    f.write_text("From file", encoding="utf-8")
    assert load_job(None, str(f)) == "From file"


def test_cli_end_to_end(tmp_path, monkeypatch, capsys):
    resume = tmp_path / "resume.txt"
    resume.write_text(RESUME, encoding="utf-8")
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setattr(cli, "make_llm", lambda settings: fake_llm("Generated text"))
    out = tmp_path / "letter.txt"
    code = cli.main(["letter", "--resume", str(resume), "--job", JOB, "--out", str(out)])
    assert code == 0
    assert out.read_text() == "Generated text"


def test_cli_missing_key(tmp_path, monkeypatch, capsys):
    resume = tmp_path / "resume.txt"
    resume.write_text(RESUME, encoding="utf-8")
    for var in ("GROQ_API_KEY", "LLM_API_KEY", "LLM_PROVIDER"):
        monkeypatch.delenv(var, raising=False)
    assert cli.main(["tailor", "--resume", str(resume), "--job", JOB]) == 1
    assert "GROQ_API_KEY" in capsys.readouterr().err
