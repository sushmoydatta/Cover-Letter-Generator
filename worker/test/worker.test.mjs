// Runs the worker against a mocked Groq API (no network, no wrangler needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the worker source, swapping the JSON import (bundled by wrangler) for an inline object.
const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = readFileSync(path.join(here, "../../jobhelper/prompts.json"), "utf8");
const src = readFileSync(path.join(here, "../src/index.js"), "utf8").replace(
  /import PROMPTS from .*;/,
  `const PROMPTS = ${prompts};`,
);
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
