/**
 * Job Apply Helper API: a Cloudflare Worker that keeps the Groq key server-side.
 *
 * POST /generate  {task, resume, job, style?, contact?, question?}
 *   -> streams OpenAI-style server-sent events ("data: {choices:[{delta:{content}}]}")
 * POST /analyze   {resume, job, llm?:true}
 *   -> JSON: deterministic ATS report (score, breakdown, keyword evidence, bullet audit, prioritised fixes)
 *      plus, unless llm:false, an AI "posting analysis" and a "recruiter view". The score is computed in code,
 *      never by the model, and is returned even if the AI part fails.
 * POST /job       {url}
 *   -> the job posting only {title, company, location, description, source, confidence, warnings}.
 *      Prefers schema.org JobPosting data and the Greenhouse/Lever JSON APIs; otherwise strips the page
 *      (menus, cookie banners, footers, related jobs) down to the job description.
 * GET  /health    -> {ok:true}
 *
 * Prompts are built here from jobhelper/prompts.json, so the endpoint only does the
 * app's six tasks and cannot be used as a general-purpose free LLM proxy.
 */
import PROMPTS from "../../jobhelper/prompts.json";
import { analyze } from "../../shared/ats.js";
import { extractJobFromHtml, apiUrlFor, parseApiJob } from "../../shared/jobextract.js";

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
  if (body.task === "rewrite" || body.task === "gapplan") {
    extra = str(body.focus).slice(0, 2500);
    if (!extra) throw new Error("Nothing to work on yet. Run the ATS score first.");
  }
  if (body.task === "answer") {
    extra = str(body.question).slice(0, 1000);
    if (!extra) throw new Error("Question is required.");
  }
  const user = task.prompt.replaceAll("{extra}", extra).replaceAll("{resume}", resume).replaceAll("{job}", job);
  return { system: PROMPTS.system, user };
}

async function callGroq(env, prompt, { stream = true, temperature = 0.4 } = {}) {
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
          temperature,
          stream,
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


/* ------------------------------------------------------------------ /job: safe page fetching */
const MAX_PAGE_BYTES = 1_500_000;

/** Only public http(s) pages on the default ports. Blocks localhost, private/link-local IPs and odd IP spellings. */
export function assertPublicUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new Error("That does not look like a valid link."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http and https links are supported.");
  if (u.username || u.password) throw new Error("Links with a username or password are not supported.");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("Only standard web ports are supported.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const bad = !host.includes(".") || host.includes(":") || host.startsWith("[")
    || /^(localhost|.*\.(local|localhost|internal|lan|home|corp|intranet))$/.test(host)
    || /^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host);          // any numeric host (IPv4 in any spelling) is refused
  if (bad) throw new Error("That address is not a public website.");
  return u;
}

async function readLimited(res, limit = MAX_PAGE_BYTES) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, limit);
  const dec = new TextDecoder();
  let out = "", bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    out += dec.decode(value, { stream: true });
    if (bytes >= limit) { try { await reader.cancel(); } catch {} break; }
  }
  return out;
}

async function safeFetch(urlStr, { json = false } = {}) {
  let url = assertPublicUrl(urlStr);
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    let res;
    try {
      res = await fetch(url.toString(), {
        redirect: "manual", signal: ctl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JobApplyHelper/2.0; +https://github.com/sushmoydatta/Cover-Letter-Generator)",
          Accept: json ? "application/json" : "text/html,application/xhtml+xml",
          "Accept-Language": "en",
        },
      });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get("Location")) {
      url = assertPublicUrl(new URL(res.headers.get("Location"), url).toString());   // every hop is re-validated
      continue;
    }
    if (!res.ok) throw new Error(`The site answered with status ${res.status}.`);
    const type = (res.headers.get("Content-Type") || "").toLowerCase();
    if (type.includes("pdf")) throw new Error("This link is a PDF. Paste the job text instead.");
    return { text: await readLimited(res), finalUrl: url.toString() };
  }
  throw new Error("Too many redirects.");
}

export async function readJob(urlStr) {
  assertPublicUrl(urlStr);
  const api = apiUrlFor(urlStr);
  if (api) {
    try {
      const { text } = await safeFetch(api.url, { json: true });
      const job = parseApiJob(api.kind, JSON.parse(text));
      if (job && job.title && job.description.length >= 150) return { ...job, source: "api", confidence: "high", warnings: [], finalUrl: urlStr };
    } catch {}   // fall through to the page itself
  }
  const page = await safeFetch(urlStr);
  const job = extractJobFromHtml(page.text);
  return { ...job, description: job.description.slice(0, 20000), finalUrl: page.finalUrl };
}

function parseJsonLoose(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error("The AI returned an unreadable answer.");
}

async function askJson(env, task, body) {
  const prompt = buildPrompt({ ...body, task });
  const res = await callGroq(env, prompt, { stream: false, temperature: 0.2 });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return parseJsonLoose(data.choices?.[0]?.message?.content || "");
}

const asList = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 400)).slice(0, 15) : []);
const asText = (v, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");

export function cleanRecruiter(r) {
  const decision = ["shortlist", "maybe", "reject"].includes(r?.decision) ? r.decision : "maybe";
  return {
    first_impression: asText(r?.first_impression), decision,
    confidence: Math.max(0, Math.min(100, parseInt(r?.confidence) || 50)),
    reasons_for: asList(r?.reasons_for), reasons_against: asList(r?.reasons_against), red_flags: asList(r?.red_flags),
    questions_to_probe: asList(r?.questions_to_probe), pitch: asText(r?.pitch),
  };
}
export function cleanJd(j) {
  return {
    company: asText(j?.company, 120), role: asText(j?.role, 160), domain: asText(j?.domain, 120), summary: asText(j?.summary),
    must_have: asList(j?.must_have), nice_to_have: asList(j?.nice_to_have), what_they_really_want: asList(j?.what_they_really_want),
    ats_keywords: asList(j?.ats_keywords), red_flags: asList(j?.red_flags), likely_screening_questions: asList(j?.likely_screening_questions),
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: (({ _ok, ...h }) => h)(cors) });
    if (url.pathname === "/health") return json({ ok: true, configured: !!env.GROQ_API_KEY }, 200, cors);
    if (!["/generate", "/analyze", "/job"].includes(url.pathname) || req.method !== "POST") return json({ error: "Not found" }, 404, cors);
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

    if (url.pathname === "/job") {
      let link;
      try { link = JSON.parse(await req.text()).url; assertPublicUrl(link); } catch (e) { return json({ error: e.message?.startsWith("That") || e.message?.startsWith("Only") || e.message?.startsWith("Links") ? e.message : "Send a JSON body like {\"url\": \"https://...\"}." }, 400, cors); }
      try {
        const job = await readJob(link);
        return json({ ...job, titleFound: !!job.title }, 200, cors);
      } catch (e) {
        const msg = /status|PDF|redirect|public|valid|supported/i.test(e.message || "") ? e.message : "We could not open that page (it may block automated readers).";
        return json({ error: `${msg} Paste the job text instead.` }, 502, cors);
      }
    }

    if (url.pathname === "/analyze") {
      let body;
      try {
        const text = await req.text();
        if (text.length > 2 * MAX_INPUT + 4000) throw new Error("Request is too large.");
        body = JSON.parse(text);
        buildPrompt({ ...body, task: "jd" }); // validates resume and job length/size
      } catch (e) {
        return json({ error: e.message || "Invalid request." }, 400, cors);
      }
      const ats = analyze(body.resume, body.job);
      const out = { ats, jd: null, recruiter: null, llm_error: null };
      if (body.llm !== false) {
        const [jd, rec] = await Promise.allSettled([askJson(env, "jd", body), askJson(env, "recruiter", body)]);
        if (jd.status === "fulfilled") out.jd = cleanJd(jd.value);
        if (rec.status === "fulfilled") out.recruiter = cleanRecruiter(rec.value);
        const failed = [jd, rec].find((r) => r.status === "rejected");
        if (failed) out.llm_error = "The AI review is unavailable right now. Your ATS score below is still accurate.";
      }
      return json(out, 200, cors);
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
