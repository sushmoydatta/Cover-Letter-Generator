// Runs the worker against a mocked Groq API (no network, no wrangler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the worker source, swapping the JSON import (bundled by wrangler) for an inline object.
const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = readFileSync(path.join(here, "../../jobhelper/prompts.json"), "utf8");
const engine = readFileSync(path.join(here, "../../shared/ats.js"), "utf8").replace(/^export /gm, "");
const src = readFileSync(path.join(here, "../src/index.js"), "utf8")
  .replace(/import PROMPTS from .*;/, () => `const PROMPTS = ${prompts};`)
  .replace(/import \{ analyze \} from .*;/, () => engine);
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
