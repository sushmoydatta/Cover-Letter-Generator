// Runs the worker against a mocked Groq API (no network, no wrangler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the worker source, swapping the JSON import (bundled by wrangler) for an inline object.
const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = readFileSync(path.join(here, "../../jobhelper/prompts.json"), "utf8");
const strip = (t) => t.replace(/^export /gm, "").replace(/^import .*;$/gm, "");
const jobExtract = strip(readFileSync(path.join(here, "../../shared/jobextract.js"), "utf8"));
const engine = strip(readFileSync(path.join(here, "../../shared/ats.js"), "utf8"));
const src = readFileSync(path.join(here, "../src/index.js"), "utf8")
  .replace(/import PROMPTS from .*;/, () => `const PROMPTS = ${prompts};`)
  .replace(/import \{ analyze \} from .*;/, () => engine)
  .replace(/import \{ extractJobFromHtml.*\} from .*;/, () => jobExtract);
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const worker = mod.default;

const ORIGIN = "https://sushmoydatta.github.io";
const env = { GROQ_API_KEY: "test-key", ALLOWED_ORIGINS: ORIGIN };
const body = { task: "letter", style: "concise", resume: "R".repeat(100), job: "J".repeat(100) };
const req = (b, origin = ORIGIN, ip = "1.1.1.1") =>
  new Request("https://api.example/generate", {
    method: "POST",
    headers: { Origin: origin, "CF-Connecting-IP": ip, "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });

const SSE_OK = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
const isModels = (url) => String(url).endsWith("/models");
const modelList = (...ids) => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
const DEFAULT_LIST = ["whisper-large-v3", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "qwen/qwen3-32b"];

let calls = [];
globalThis.fetch = async (url, init) => {
  if (isModels(url)) return modelList(...DEFAULT_LIST);
  calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
  return new Response(SSE_OK, { status: 200 });
};

test("streams a generated draft and builds the prompt server-side", async () => {
  calls = [];
  const res = await worker.fetch(req(body), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(await res.text(), /"Hi"/);
  assert.equal(calls[0].auth, "Bearer test-key");
  assert.match(calls[0].body.messages[1].content, /150-200 words/);
  assert.match(calls[0].body.messages[0].content, /ONLY facts/);
});

test("rejects unknown tasks, short inputs and other origins", async () => {
  assert.equal((await worker.fetch(req({ ...body, task: "chat" }, ORIGIN, "2.2.2.2"), env)).status, 400);
  assert.equal((await worker.fetch(req({ ...body, resume: "x" }, ORIGIN, "2.2.2.3"), env)).status, 400);
  assert.equal((await worker.fetch(req(body, "https://evil.example", "2.2.2.4"), env)).status, 403);
});

test("rate limits a single visitor", async () => {
  let last;
  for (let i = 0; i < 8; i++) last = await worker.fetch(req(body, ORIGIN, "9.9.9.9"), { ...env, RATE_PER_MINUTE: "6" });
  assert.equal(last.status, 429);
});

test("falls back to the next model when the first is rate limited", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-rl" };
  const tried = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    if (isModels(url)) return modelList(...DEFAULT_LIST);
    tried.push(JSON.parse(init.body).model);
    return n++ === 0 ? new Response("busy", { status: 429 }) : new Response("data: [DONE]\n\n", { status: 200 });
  };
  const res = await worker.fetch(req(body, ORIGIN, "3.3.3.3"), env2);
  assert.equal(res.status, 200);
  assert.deepEqual(tried, ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]);
});

test("health and CORS preflight", async () => {
  const h = await worker.fetch(new Request("https://api.example/health"), env);
  assert.deepEqual(await h.json(), { ok: true, configured: true });
  const p = await worker.fetch(new Request("https://api.example/generate", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  assert.equal(p.status, 204);
});

test("reports the upstream status when Groq fails", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-err" };
  globalThis.fetch = async (url) =>
    isModels(url) ? modelList(...DEFAULT_LIST) : new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
  const res = await worker.fetch(req(body, ORIGIN, "4.4.4.4"), env2);
  assert.equal(res.status, 502);
  const { error } = await res.json();
  assert.match(error, /Groq 401: Invalid API Key/);
  assert.ok(!error.includes("key-err"));
});

test("picks the best live model and skips retired ones (404)", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-two" }; // separate key => fresh model cache
  const tried = [];
  globalThis.fetch = async (url, init) => {
    if (isModels(url)) return modelList("llama-3.3-70b-versatile", "openai/gpt-oss-120b", "whisper-large-v3-turbo", "qwen/qwen3-32b");
    const model = JSON.parse(init.body).model;
    tried.push(model);
    return model === "llama-3.3-70b-versatile"
      ? new Response(JSON.stringify({ error: { message: "model does not exist" } }), { status: 404 })
      : new Response("data: [DONE]\n\n", { status: 200 });
  };
  const res = await worker.fetch(req(body, ORIGIN, "5.5.5.5"), env2);
  assert.equal(res.status, 200);
  assert.deepEqual(tried, ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
});

test("uses only a model that exists when the old one is gone", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-new" };
  const tried = [];
  globalThis.fetch = async (url, init) => {
    if (isModels(url)) return modelList("openai/gpt-oss-120b", "openai/gpt-oss-20b", "whisper-large-v3");
    tried.push(JSON.parse(init.body).model);
    return new Response("data: [DONE]\n\n", { status: 200 });
  };
  const res = await worker.fetch(req(body, ORIGIN, "7.7.7.7"), env2);
  assert.equal(res.status, 200);
  assert.deepEqual(tried, ["openai/gpt-oss-120b"]);
});

test("falls back to built-in models when the model list is unavailable", async () => {
  const env3 = { ...env, GROQ_API_KEY: "key-three" };
  const tried = [];
  globalThis.fetch = async (url, init) => {
    if (isModels(url)) return new Response("nope", { status: 500 });
    tried.push(JSON.parse(init.body).model);
    return new Response("data: [DONE]\n\n", { status: 200 });
  };
  const res = await worker.fetch(req(body, ORIGIN, "6.6.6.6"), env3);
  assert.equal(res.status, 200);
  assert.deepEqual(tried, ["llama-3.3-70b-versatile"]);
});

/* ------------------------------------------------------------------ /analyze */
const RESUME = `Alex Rivera
alex@example.com | +91 98765 43210 | linkedin.com/in/alex
Education
M.Tech, Electronics Engineering (2024 - 2026)
Skills
Python, PyTorch, SQL
Experience
ML Engineer Intern, Example Corp (Jun 2023 - Dec 2023)
• Built an online learning pipeline in Python and PyTorch that cut regret by 18% across 40K trials
• Automated KPI reports with SQL, saving the team 6 hours per week`;
const JOB = `Machine Learning Engineer
Requirements:
- Python and PyTorch or TensorFlow
- Docker and AWS or GCP experience
Preferred: Kubernetes`;
const areq = (b, ip) => new Request("https://api.example/analyze", {
  method: "POST", headers: { Origin: ORIGIN, "CF-Connecting-IP": ip, "Content-Type": "application/json" }, body: JSON.stringify(b),
});
const llmReply = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

test("/analyze returns the deterministic ATS report plus AI posting analysis and recruiter view", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-an1" };
  globalThis.fetch = async (url, init) => {
    if (isModels(url)) return modelList(...DEFAULT_LIST);
    const user = JSON.parse(init.body).messages[1].content;
    assert.equal(JSON.parse(init.body).stream, false);
    return user.includes("senior technical recruiter")
      ? llmReply('```json\n{"first_impression":"Relevant ML intern","decision":"SHORTLIST","confidence":"140","reasons_for":["PyTorch pipeline"],"reasons_against":["No Docker"],"questions_to_probe":["Docker?"],"pitch":"Solid junior ML fit"}\n```')
      : llmReply('{"company":"Acme","role":"ML Engineer","must_have":["Python"],"ats_keywords":["PyTorch"],"summary":"ML role"}');
  };
  const res = await worker.fetch(areq({ resume: RESUME, job: JOB }, "10.0.0.1"), env2);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.ats.score > 0 && out.ats.breakdown.length === 6 && out.ats.keywords.length > 0);
  assert.equal(out.jd.company, "Acme");
  assert.equal(out.recruiter.decision, "maybe");           // "SHORTLIST" (wrong case) is not trusted: normalised to a safe default
  assert.equal(out.recruiter.confidence, 100);             // clamped
  assert.deepEqual(out.recruiter.reasons_for, ["PyTorch pipeline"]);
  assert.equal(out.llm_error, null);
});

test("/analyze still returns the score when the AI is unavailable", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-an2" };
  globalThis.fetch = async (url) => (isModels(url) ? modelList(...DEFAULT_LIST) : new Response("boom", { status: 500 }));
  const res = await worker.fetch(areq({ resume: RESUME, job: JOB }, "10.0.0.2"), env2);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.ats.score > 0);
  assert.equal(out.jd, null);
  assert.equal(out.recruiter, null);
  assert.match(out.llm_error, /still accurate/);
});

test("/analyze with llm:false makes no AI calls and is deterministic", async () => {
  let aiCalls = 0;
  globalThis.fetch = async () => { aiCalls++; return new Response("x", { status: 500 }); };
  const a = await (await worker.fetch(areq({ resume: RESUME, job: JOB, llm: false }, "10.0.0.3"), env)).json();
  const b = await (await worker.fetch(areq({ resume: RESUME, job: JOB, llm: false }, "10.0.0.4"), env)).json();
  assert.equal(aiCalls, 0);
  assert.equal(a.ats.score, b.ats.score);
});

test("/analyze validates input and respects origin and rate limits", async () => {
  assert.equal((await worker.fetch(areq({ resume: "short", job: JOB, llm: false }, "10.0.0.5"), env)).status, 400);
  assert.equal((await worker.fetch(areq({ resume: RESUME, job: "x".repeat(20001) , llm: false}, "10.0.0.6"), env)).status, 400);
  const r = areq({ resume: RESUME, job: JOB, llm: false }, "10.0.0.7");
  const bad = new Request(r.url, { method: "POST", headers: { Origin: "https://evil.example", "CF-Connecting-IP": "10.0.0.8" }, body: await r.text() });
  assert.equal((await worker.fetch(bad, env)).status, 403);
});

test("rewrite and gap-plan tasks take a focus list and refuse to run without one", async () => {
  const env2 = { ...env, GROQ_API_KEY: "key-rw" };
  const seen = [];
  globalThis.fetch = async (url, init) => {
    if (isModels(url)) return modelList(...DEFAULT_LIST);
    seen.push(JSON.parse(init.body).messages[1].content);
    return new Response("data: [DONE]\n\n", { status: 200 });
  };
  const ok = await worker.fetch(req({ task: "rewrite", resume: RESUME, job: JOB, focus: "- Worked on stuff" }, ORIGIN, "11.0.0.1"), env2);
  assert.equal(ok.status, 200);
  assert.match(seen[0], /Worked on stuff/);
  assert.match(seen[0], /never make up a figure/i);
  assert.equal((await worker.fetch(req({ task: "gapplan", resume: RESUME, job: JOB }, ORIGIN, "11.0.0.2"), env2)).status, 400);
});

/* ------------------------------------------------------------------ /job */
const { LD_PAGE, PLAIN_PAGE, SPA_SHELL, GREENHOUSE_API } = await import("../../shared/test/jobpages.mjs");
const jreq = (url, { ip = "20.0.0.1", origin = ORIGIN } = {}) =>
  new Request("https://api.example/job", { method: "POST", headers: { Origin: origin, "CF-Connecting-IP": ip, "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "Content-Type": "text/html", ...headers } });

test("/job returns only the job posting from a structured-data page", async () => {
  globalThis.fetch = async () => html(LD_PAGE);
  const res = await worker.fetch(jreq("https://careers.example-robotics.com/jobs/1"), env);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.title, "Machine Learning Engineer");
  assert.equal(j.company, "Example Robotics");
  assert.equal(j.titleFound, true);
  assert.equal(j.source, "structured-data");
  assert.ok(!/cookie|Privacy Policy|Sign in/i.test(j.description));
});

test("/job strips a normal careers page down to the description", async () => {
  globalThis.fetch = async () => html(PLAIN_PAGE);
  const j = await (await worker.fetch(jreq("https://jobs.acme-analytics.com/data-analyst", { ip: "20.0.0.2" }), env)).json();
  assert.equal(j.title, "Data Analyst");
  assert.match(j.description, /Write SQL queries/);
  assert.ok(!/Similar jobs|Submit application|Share on|Terms of Use/i.test(j.description));
});

test("/job uses the Greenhouse JSON API when the link is a Greenhouse posting", async () => {
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify(GREENHOUSE_API), { status: 200, headers: { "Content-Type": "application/json" } }); };
  const j = await (await worker.fetch(jreq("https://boards.greenhouse.io/globex/jobs/4012345", { ip: "20.0.0.3" }), env)).json();
  assert.equal(seen[0], "https://boards-api.greenhouse.io/v1/boards/globex/jobs/4012345");
  assert.equal(j.title, "Backend Engineer");
  assert.equal(j.source, "api");
});

test("/job warns clearly about JavaScript-only pages instead of returning page junk", async () => {
  globalThis.fetch = async () => html(SPA_SHELL);
  const j = await (await worker.fetch(jreq("https://careers.spa-company.com/jobs/9", { ip: "20.0.0.4" }), env)).json();
  assert.equal(j.confidence, "low");
  assert.ok(j.warnings.some((w) => /JavaScript/.test(w)));
});

test("/job refuses private, local and odd addresses and never fetches them", async () => {
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return html("x"); };
  const bad = ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/a", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://2130706433/", "http://0x7f000001/",
    "file:///etc/passwd", "ftp://example.com/x", "https://user:pw@example.com/", "https://example.com:8080/x", "http://intranet/jobs", "http://printer.local/"];
  for (const [i, u] of bad.entries()) assert.equal((await worker.fetch(jreq(u, { ip: `21.0.0.${i}` }), env)).status, 400, u);
  assert.equal(fetched, 0);
});

test("/job re-checks every redirect hop and blocks a redirect to a private address", async () => {
  globalThis.fetch = async (url) => String(url).includes("evil.example")
    ? new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/" } })
    : html(PLAIN_PAGE);
  const res = await worker.fetch(jreq("https://evil.example.com/jobs/1", { ip: "22.0.0.1" }), env);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /public|Paste the job text/i);
  globalThis.fetch = async (url) => String(url).includes("short.example")
    ? new Response(null, { status: 301, headers: { Location: "https://jobs.acme-analytics.com/final" } })
    : html(PLAIN_PAGE);
  const ok = await worker.fetch(jreq("https://short.example.com/x", { ip: "22.0.0.2" }), env);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).finalUrl, "https://jobs.acme-analytics.com/final");
});

test("/job handles blocked sites, PDFs, other origins and respects the rate limit", async () => {
  globalThis.fetch = async () => new Response("Forbidden", { status: 403 });
  const blocked = await worker.fetch(jreq("https://www.linkedin.com/jobs/view/1", { ip: "23.0.0.1" }), env);
  assert.equal(blocked.status, 502);
  assert.match((await blocked.json()).error, /403|Paste the job text/);
  globalThis.fetch = async () => new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } });
  assert.equal((await worker.fetch(jreq("https://example.com/job.pdf", { ip: "23.0.0.2" }), env)).status, 502);
  assert.equal((await worker.fetch(jreq("https://example.com/job", { ip: "23.0.0.3", origin: "https://evil.example" }), env)).status, 403);
  globalThis.fetch = async () => html(PLAIN_PAGE);
  let last;
  for (let i = 0; i < 8; i++) last = await worker.fetch(jreq("https://jobs.acme-analytics.com/x", { ip: "23.0.0.9" }), { ...env, RATE_PER_MINUTE: "6" });
  assert.equal(last.status, 429);
});
