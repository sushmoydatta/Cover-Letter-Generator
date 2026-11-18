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

let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
  return new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
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

test("falls back to the smaller model when the main one is rate limited", async () => {
  calls = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body).model);
    return n++ === 0 ? new Response("busy", { status: 429 }) : new Response("data: [DONE]\n\n", { status: 200 });
  };
  const res = await worker.fetch(req(body, ORIGIN, "3.3.3.3"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]);
});

test("health and CORS preflight", async () => {
  const h = await worker.fetch(new Request("https://api.example/health"), env);
  assert.deepEqual(await h.json(), { ok: true, configured: true });
  const p = await worker.fetch(new Request("https://api.example/generate", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  assert.equal(p.status, 204);
});

test("reports the upstream status when Groq fails", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
  const res = await worker.fetch(req(body, ORIGIN, "4.4.4.4"), env);
  assert.equal(res.status, 502);
  const { error } = await res.json();
  assert.match(error, /Groq 401: Invalid API Key/);
  assert.ok(!error.includes("test-key"));
});
