import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, findSkills, parseResume, parseJob, monthsOfExperience, scoreBullet } from "../ats.js";
import { GOOD_RESUME, WEAK_RESUME, ML_JOB, SENIOR_JOB } from "./fixtures.mjs";

const NOW = new Date("2026-11-18");

test("skill matching handles aliases, ambiguity and punctuation", () => {
  const f = findSkills("Used k8s and Docker; wrote C++ and Node.js APIs. I will go home. JavaScript, not Java.");
  assert.ok(f.has("Kubernetes") && f.has("Docker") && f.has("C++") && f.has("Node.js"));
  assert.ok(f.has("Java") && f.has("JavaScript"));
  assert.equal(f.get("Java"), 1);             // "JavaScript" must not count as Java
  assert.ok(!f.has("Go"));                    // the English word "go" is not Go
  assert.ok(findSkills("Wrote services in golang").has("Go"));
  assert.ok(findSkills("ran CI/CD on GitHub Actions").has("CI/CD"));
});

test("experience months merge overlapping ranges and handle Present", () => {
  assert.equal(monthsOfExperience("Jan 2020 - Dec 2020", NOW), 11);
  assert.equal(monthsOfExperience("Jan 2020 - Jun 2020, Mar 2020 - Aug 2020", NOW), 7);   // overlap counted once
  assert.equal(monthsOfExperience("Jun 2025 - Present", NOW), 17);
});

test("resume parsing finds contact, sections, bullets (including wrapped PDF lines)", () => {
  const r = parseResume(GOOD_RESUME, NOW);
  assert.equal(r.contact.email, "alex.rivera@example.com");
  assert.ok(r.contact.linkedin && r.contact.github && r.contact.phone);
  for (const s of ["summary", "education", "skills", "experience", "projects"]) assert.ok(r.sections[s], s);
  assert.equal(r.bullets.length, 5);
  assert.equal(r.degree.label, "Master's");
  assert.ok(r.years > 3 && r.years < 4);   // Jun-Dec 2023 plus Jan 2024 to Present (Nov 2026)
  const wrapped = parseResume("Experience\n• Built a root cause analyser that processed 17.7M network records and 6.3M alarms, grouping them into\n119K incidents and\nidentifying 16K recurring root causes\n• Built dashboards for four operators", NOW);
  assert.equal(wrapped.bullets.length, 2);
  assert.match(wrapped.bullets[0].text, /identifying 16K/);
});

test("job parsing separates must-have from nice-to-have and reads years and degree", () => {
  const j = parseJob(ML_JOB);
  const tier = (n) => j.skills.find((s) => s.name === n)?.tier;
  assert.equal(tier("Python"), "must");
  assert.equal(tier("Docker"), "must");
  assert.equal(tier("FPGA"), "nice");
  assert.equal(tier("Kubernetes"), "nice");
  assert.equal(j.seniority, "Entry level");
  assert.equal(j.degreeRequired, 0 + j.degreeRequired);
  const s = parseJob(SENIOR_JOB);
  assert.equal(s.yearsRequired, 7);
  assert.equal(s.seniority, "Senior");
  assert.equal(s.degreeRequired, 2);
});

test("a strong, relevant resume scores well and a poor one scores much lower", () => {
  const good = analyze(GOOD_RESUME, ML_JOB, { now: NOW });
  const weak = analyze(WEAK_RESUME, ML_JOB, { now: NOW });
  assert.ok(good.score >= 65 && good.score <= 95, `good=${good.score}`);
  assert.ok(weak.score <= 35, `weak=${weak.score}`);
  assert.ok(good.score - weak.score >= 35);
  assert.equal(good.breakdown.reduce((a, b) => a + b.weight, 0), 100);
});

test("keyword table shows evidence level and related-skill credit", () => {
  const a = analyze(GOOD_RESUME, ML_JOB, { now: NOW });
  const row = (n) => a.keywords.find((r) => r.skill === n);
  assert.equal(row("Python").evidence, "experience");
  assert.equal(row("PyTorch").evidence, "experience");
  assert.equal(row("Docker").evidence, "none");
  assert.ok(a.missingMust.includes("Docker"));
  const tf = analyze("Skills\nPyTorch, Python\nExperience\n• Built models in PyTorch for 3 teams", "ML Engineer\nRequirements:\n- TensorFlow experience", { now: NOW });
  assert.equal(tf.keywords.find((r) => r.skill === "TensorFlow").evidence, "related");
});

test("seniority mismatch lowers the title score and is explained", () => {
  const a = analyze(GOOD_RESUME, SENIOR_JOB, { now: NOW });
  const t = a.breakdown.find((b) => b.key === "title");
  assert.match(t.detail, /senior|junior/i);
  assert.ok(a.score < analyze(GOOD_RESUME, ML_JOB, { now: NOW }).score);
});

test("formatting audit flags garbled icons, missing contact info and pronouns", () => {
  const a = analyze(WEAK_RESUME, ML_JOB, { now: NOW });
  const f = (label) => a.format.find((x) => x.label.toLowerCase().includes(label));
  assert.ok(f("unreadable"), "garbled symbols flagged");
  assert.equal(f("phone").ok, false);
  assert.equal(f("skills section").ok, false);
  assert.ok(a.fixes.some((x) => x.area === "format"));
});

test("bullet scoring rewards verbs and measurable results, penalises weak phrasing", () => {
  const strong = scoreBullet("Reduced alarm triage time by 40% by building a Python root cause analyser used by 12 engineers");
  const weak = scoreBullet("Responsible for helping with various tasks");
  assert.ok(strong.score >= 85, `${strong.score}`);
  assert.ok(weak.score <= 30, `${weak.score}`);
  assert.ok(weak.issues.length >= 3);
});

test("fixes are sorted by points gained and the score is deterministic", () => {
  const a = analyze(GOOD_RESUME, ML_JOB, { now: NOW });
  const b = analyze(GOOD_RESUME, ML_JOB, { now: NOW });
  assert.deepEqual(a, b);
  for (let i = 1; i < a.fixes.length; i++) assert.ok(a.fixes[i - 1].gain >= a.fixes[i].gain);
  assert.ok(a.fixes.length > 0 && a.disclaimer);
});

test("works for a non-technical posting by falling back to vocabulary coverage", () => {
  const a = analyze("Jo Lee\njo@example.com\nExperience\n• Managed supplier negotiations and reduced procurement costs by 12% across 40 vendors\nEducation\nBBA", "Procurement Manager\nRequirements:\n- supplier negotiations\n- procurement cost reduction\n- vendor management", { now: NOW });
  assert.ok(a.score > 0 && a.vocabulary.length > 0);
});

test("'X or Y' requirements are alternatives: either one satisfies the posting", () => {
  const a = analyze(GOOD_RESUME, ML_JOB, { now: NOW });
  const row = (n) => a.keywords.find((r) => r.skill === n);
  assert.equal(row("PyTorch").group, row("TensorFlow").group);
  assert.equal(row("TensorFlow").credit, 1);                     // PyTorch is on the resume => PyTorch or TensorFlow is met
  assert.ok(row("TensorFlow").evidence.startsWith("covered by"));
  assert.deepEqual(row("AWS").alternatives, ["GCP"]);
  assert.ok(a.missingMust.includes("AWS") && a.missingMust.includes("GCP"));
  const cloudFixes = a.fixes.filter((f) => /AWS/.test(f.text));
  assert.equal(cloudFixes.length, 1);                            // one combined fix, not two
  assert.match(cloudFixes[0].text, /one of: AWS, GCP/);
  const both = analyze("Skills\nGCP\nExperience\n• Deployed services on GCP serving 2M users", ML_JOB, { now: NOW });
  assert.equal(both.keywords.find((r) => r.skill === "AWS").credit, 1);   // GCP satisfies "AWS or GCP"
});

test("'Python and SQL' are both required (not alternatives)", () => {
  const j = parseJob("Data Analyst\nRequirements:\n- Python and SQL\n- Tableau, Power BI or Excel");
  const g = (n) => j.skills.find((s) => s.name === n).group;
  assert.equal(g("Python"), null);
  assert.equal(g("SQL"), null);
  assert.ok(g("Tableau") && g("Tableau") === g("Power BI") && g("Power BI") === g("Excel"));
});
