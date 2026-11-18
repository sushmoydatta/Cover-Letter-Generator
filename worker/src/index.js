/**
 * Job Apply Helper API: a Cloudflare Worker that keeps the Groq key server-side.
 *
 * POST /generate  {task, resume, job, style?, contact?, question?}
 *   -> streams OpenAI-style server-sent events ("data: {choices:[{delta:{content}}]}")
 * GET  /health    -> {ok:true}
 *
 * Prompts are built here from jobhelper/prompts.json, so the endpoint only does the
 * app's six tasks and cannot be used as a general-purpose free LLM proxy.
 */
import PROMPTS from "../../jobhelper/prompts.json";

const MAX_INPUT = 15000;
const DEFAULT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]; // second is the fallback on rate limits

// Best-effort per-isolate limiter, used when the Rate Limiting binding isn't configured.
const memHits = new Map();
function memLimited(ip, limit, windowMs) {
  const now = Date.now();
  const arr = (memHits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  memHits.set(ip, arr);
  if (memHits.size > 5000) memHits.clear();
  return arr.length > limit;
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    _ok: ok,
  };
}

function json(data, status, cors) {
  const { _ok, ...headers } = cors;
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

export function buildPrompt(body) {
  const task = PROMPTS.tasks[body.task];
  if (!task) throw new Error(`Unknown task. Use one of: ${Object.keys(PROMPTS.tasks).join(", ")}`);
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const resume = str(body.resume), job = str(body.job);
  if (resume.length < 50) throw new Error("Resume is missing or too short.");
  if (job.length < 50) throw new Error("Job posting is missing or too short.");
  if (resume.length > MAX_INPUT || job.length > MAX_INPUT) throw new Error(`Resume and posting must each be under ${MAX_INPUT} characters.`);
  let extra = "";
  if (body.task === "letter") extra = PROMPTS.letter_styles[str(body.style)] || PROMPTS.letter_styles.professional;
  if (body.task === "outreach" && str(body.contact)) extra = `The recipient is: ${str(body.contact).slice(0, 200)}.`;
  if (body.task === "answer") {
    extra = str(body.question).slice(0, 1000);
    if (!extra) throw new Error("Question is required.");
  }
  const user = task.prompt.replaceAll("{extra}", extra).replaceAll("{resume}", resume).replaceAll("{job}", job);
  return { system: PROMPTS.system, user };
}

async function callGroq(env, prompt) {
  const models = env.MODEL ? [env.MODEL, ...DEFAULT_MODELS.filter((m) => m !== env.MODEL)] : DEFAULT_MODELS;
  let last;
  for (const model of models) {
    last = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        stream: true,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });
    if (last.status !== 429 && last.status !== 503) return last;
  }
  return last;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: (({ _ok, ...h }) => h)(cors) });
    if (url.pathname === "/health") return json({ ok: true, configured: !!env.GROQ_API_KEY }, 200, cors);
    if (url.pathname !== "/generate" || req.method !== "POST") return json({ error: "Not found" }, 404, cors);
    if (!cors._ok) return json({ error: "This site is not allowed to use the API." }, 403, cors);
    if (!env.GROQ_API_KEY) return json({ error: "The service is not configured yet." }, 503, cors);

    const ip = req.headers.get("CF-Connecting-IP") || "anon";
    const perMinute = Number(env.RATE_PER_MINUTE || 6);
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many requests. Please wait a minute and try again." }, 429, cors);
    } else if (memLimited(ip, perMinute, 60_000)) {
      return json({ error: "Too many requests. Please wait a minute and try again." }, 429, cors);
    }

    let prompt;
    try {
      const text = await req.text();
      if (text.length > 2 * MAX_INPUT + 4000) throw new Error("Request is too large.");
      prompt = buildPrompt(JSON.parse(text));
    } catch (e) {
      return json({ error: e.message || "Invalid request." }, 400, cors);
    }

    const upstream = await callGroq(env, prompt);
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      const msg = status === 429 ? "The service is busy right now. Please try again in a minute." : "The AI service had a problem. Please try again.";
      return json({ error: msg }, status, cors);
    }
    const { _ok, ...headers } = cors;
    return new Response(upstream.body, {
      status: 200,
      headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  },
};
