import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJobFromHtml, cleanJobText, cleanTitle, titleFromText, apiUrlFor, parseApiJob, htmlToText } from "../jobextract.js";
import { LD_PAGE, PLAIN_PAGE, SPA_SHELL, PASTED_PAGE, GREENHOUSE_API, LEVER_API } from "./jobpages.mjs";

const NOISE = [/Skip to main content/i, /cookie/i, /Sign in/i, /Log in/i, /Privacy Policy/i, /Terms of Use/i, /Similar jobs/i, /Share on/i, /All rights reserved/i, /Submit application/i, /First name/i, /Follow us/i];
const noNoise = (text) => NOISE.forEach((re) => assert.ok(!re.test(text), `noise leaked: ${re}`));

test("structured data (JSON-LD) gives title, company, location and a clean description", () => {
  const j = extractJobFromHtml(LD_PAGE);
  assert.equal(j.title, "Machine Learning Engineer");
  assert.equal(j.company, "Example Robotics");
  assert.equal(j.location, "Bengaluru, KA, IN");
  assert.equal(j.source, "structured-data");
  assert.equal(j.confidence, "high");
  assert.match(j.description, /Build and deploy machine learning models in Python and PyTorch/);
  assert.match(j.description, /Minimum Qualifications/);
  noNoise(j.description);
});

test("a normal careers page keeps only the job: title from the page, noise removed", () => {
  const j = extractJobFromHtml(PLAIN_PAGE);
  assert.equal(j.title, "Data Analyst");
  assert.equal(j.company, "Acme Analytics");
  assert.equal(j.source, "page");
  assert.notEqual(j.confidence, "low");
  assert.match(j.description, /Write SQL queries and build dashboards in Tableau/);
  assert.match(j.description, /2\+ years of experience in data analysis/);
  noNoise(j.description);
  assert.ok(!/Senior Data Analyst|BI Developer/.test(j.description), "related jobs must be dropped");
});

test("a JavaScript-only page returns low confidence with a clear warning, never garbage", () => {
  const j = extractJobFromHtml(SPA_SHELL);
  assert.equal(j.confidence, "low");
  assert.ok(j.warnings.some((w) => /JavaScript/.test(w)));
  assert.ok(j.description.length < 300);
});

test("pasted whole-page text is trimmed to the job description and the title is found", () => {
  const r = cleanJobText(PASTED_PAGE);
  assert.equal(r.title, "Software Engineer, Network Analytics");
  assert.match(r.text, /^Software Engineer, Network Analytics/);
  assert.match(r.text, /root cause analysis tooling in Python and SQL/);
  assert.match(r.text, /Preferred Qualifications/);
  assert.match(r.text, /Familiarity with Kafka or Spark/);
  noNoise(r.text);
  assert.ok(!/Senior Network Engineer|Data Scientist, Telecom/.test(r.text));
  assert.ok(r.removedChars > 100);
  assert.equal(r.confidence, "high");
});

test("a clean posting passes through unchanged and keeps its title", () => {
  const clean = "Machine Learning Engineer\nAbout the role\nYou will build models that plan routes for robots in busy warehouses every day.\nResponsibilities\nBuild and deploy models in Python and PyTorch for production use\nOwn evaluation and monitoring of every model you ship to customers\nRequirements\n3+ years of Python experience building machine learning systems";
  const r = cleanJobText(clean);
  assert.equal(r.title, "Machine Learning Engineer");
  assert.match(r.text, /3\+ years of Python experience/);
  assert.equal(r.removedChars < 5, true);
});

test("when there is no title, it is left empty (so the UI asks) instead of guessing a heading", () => {
  const r = cleanJobText("About the role\nYou will build and ship models that plan routes for robots working in large warehouses.\nResponsibilities\nBuild and deploy models in Python and PyTorch for production workloads\nOwn evaluation, monitoring and alerting for every model you ship");
  assert.equal(r.title, "");
  assert.equal(titleFromText("Responsibilities\nDo things"), "");
});

test("title cleaning handles Greenhouse, LinkedIn and 'Title | Company' formats", () => {
  assert.deepEqual(cleanTitle("Job Application for Data Analyst at Acme Analytics"), { title: "Data Analyst", company: "Acme Analytics" });
  assert.deepEqual(cleanTitle("Acme Corp hiring Data Analyst in Bengaluru | LinkedIn"), { title: "Data Analyst", company: "Acme Corp" });
  assert.equal(cleanTitle("Machine Learning Engineer | Example Robotics Careers").title, "Machine Learning Engineer");
  assert.equal(cleanTitle("Senior Backend Engineer - Remote - Indeed.com").title, "Senior Backend Engineer");
  assert.equal(cleanTitle("Software Engineer (Remote)").title, "Software Engineer");
});

test("Greenhouse and Lever links map to their JSON APIs and parse into clean postings", () => {
  assert.deepEqual(apiUrlFor("https://boards.greenhouse.io/globex/jobs/4012345?gh_src=x"), { kind: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/globex/jobs/4012345" });
  assert.deepEqual(apiUrlFor("https://jobs.lever.co/acme/8d1a7c3e-0000-4b1a-9c2d-123456789abc/apply"), { kind: "lever", url: "https://api.lever.co/v0/postings/acme/8d1a7c3e-0000-4b1a-9c2d-123456789abc" });
  assert.equal(apiUrlFor("https://example.com/jobs/1"), null);
  const gh = parseApiJob("greenhouse", GREENHOUSE_API);
  assert.equal(gh.title, "Backend Engineer");
  assert.equal(gh.company, "Globex");
  assert.match(gh.description, /3\+ years Go/);
  assert.ok(!/</.test(gh.description));
  const lv = parseApiJob("lever", LEVER_API);
  assert.equal(lv.title, "Product Designer");
  assert.match(lv.description, /Own design end to end/);
});

test("never throws on garbage and stays fast on very large input", () => {
  for (const bad of ["", null, undefined, "<<<>>>", "<div", "\u0000\u0001", "<script>", "a".repeat(5000)]) {
    assert.doesNotThrow(() => extractJobFromHtml(bad));
    assert.doesNotThrow(() => cleanJobText(bad));
  }
  const big = "<div>" + "<p>Some text about nothing in particular here.</p>".repeat(20000) + "</div>";
  const t0 = Date.now();
  extractJobFromHtml(big);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
});

test("htmlToText keeps list structure and decodes entities", () => {
  assert.equal(htmlToText("<p>R&amp;D &ndash; team</p><ul><li>One</li><li>Two &amp; three</li></ul>"), "R&D - team\n- One\n- Two & three");
});
