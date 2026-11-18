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
// Used only if Groq's model list can't be fetched.
const FALLBACK_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
// Preference order when picking from Groq's live model list (first match wins). Models that print
// <think> reasoning tags (qwen, deepseek) and non-chat models (whisper, guard, tts...) are excluded.
const PREFERRED = [/llama-3\.3-70b/, /llama-4-maverick/, /gpt-oss-120b/, /llama-4-scout/, /gpt-oss-20b/, /llama-3\.1-8b/];
const EXCLUDED = /whisper|guard|tts|orpheus|embed|playai|distil|qwen|deepseek|compound|safeguard|prompt-guard/i;

let modelCache = { key: "", list: null, at: 0 };

export function rankModels(ids) {
  const usable = ids.filter((id) => !EXCLUDED.test(id) && /llama|gpt-oss/i.test(id));
  const score = (id) => { const i = PREFERRED.findIndex((re) => re.test(id)); return i === -1 ? PREFERRED.length : i; };
  return [...usable].sort((x, y) => score(x) - score(y));
}

async function getModels(env, force = false) {
  const fresh = modelCache.key === env.GROQ_API_KEY && modelCache.list && Date.now() - modelCache.at < 3600_000;
  if (fresh && !force) return modelCache.list;
  let list = null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` } });
    if (r.ok) {
      const ranked = rankModels(((await r.json()).data || []).filter((m) => m.active !== false).map((m) => m.id));
      if (ranked.length) list = ranked;
    }
  } catch {}
  list = list || FALLBACK_MODELS;
  modelCache = { key: env.GROQ_API_KEY, list, at: Date.now() };
  return list;
}

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
  for (let attempt = 0; attempt < 2; attempt++) {
    const discovered = await getModels(env, attempt === 1);
    const models = [...new Set([env.MODEL, ...discovered].filter(Boolean))].slice(0, 3);
    let last, sawMissing = false;
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
      if (last.status === 404) { sawMissing = true; continue; }       // model retired: try the next one
      if (last.status !== 429 && last.status !== 503) return last;     // success or a real error
    }
    if (!sawMissing) return last;       // only rate limits: nothing to refresh
  }
  return new Response(JSON.stringify({ error: { message: "No Groq model is available for this key." } }), { status: 502 });
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
      // Surface Groq's status and message (never the key) so problems are diagnosable from the page.
      let detail = "";
      try {
        const raw = await upstream.text();
        try { detail = JSON.parse(raw).error?.message || raw; } catch { detail = raw; }
      } catch {}
      detail = String(detail).replace(/\s+/g, " ").slice(0, 160);
      console.log(`Groq error ${upstream.status}: ${detail}`);
      const status = upstream.status === 429 ? 429 : 502;
      const msg = status === 429
        ? "The service is busy right now. Please try again in a minute."
        : `The AI service had a problem (Groq ${upstream.status}${detail ? ": " + detail : ""}). Please try again.`;
      return json({ error: msg }, status, cors);
    }
    const { _ok, ...headers } = cors;
    return new Response(upstream.body, {
      status: 200,
      headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  },
};
