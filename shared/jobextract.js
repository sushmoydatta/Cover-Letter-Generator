/**
 * Job Apply Helper: job posting extractor.
 *
 * Goal: keep ONLY the job posting (title, company, location, description) and drop everything else on the page
 * (menus, cookie banners, footers, "similar jobs", sign-in links...). Pure JavaScript, no dependencies, so the same
 * code runs in the Cloudflare Worker (on fetched HTML), in the browser (on pasted text) and in Node tests.
 *
 * Strategy, best source first:
 *   1. schema.org JobPosting JSON-LD: clean, structured data that most career sites publish for Google for Jobs.
 *   2. The page itself: a small HTML parser drops scripts, navigation, footers, cookie and share widgets, then
 *      the text is trimmed to the job-description region.
 *   3. cleanJobText(): finds the job-description region inside any plain text (also used for pasted text).
 * The job title is mandatory output: if it cannot be found with confidence, `title` is "" so the UI asks for it.
 */

/* ------------------------------------------------------------------ entities and text */
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', bull: "-", hellip: "...", middot: "-", copy: "(c)", reg: "(R)", trade: "(TM)" };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const squash = (s) => decodeEntities(s).replace(/[ \t\r\f\v ]+/g, " ").trim();

/* ------------------------------------------------------------------ tiny tolerant HTML parser */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "noscript", "template"]);
const DROP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "nav", "footer", "aside", "form", "button", "select", "option", "dialog", "video", "audio", "object", "embed", "head", "menu"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "header", "blockquote", "pre", "hr", "fieldset", "figure", "details", "summary"]);
const NOISE_TOKENS = new Set(["cookie", "cookies", "consent", "gdpr", "newsletter", "subscribe", "breadcrumb", "breadcrumbs", "share", "sharing", "social", "related", "similar", "recommended", "sidebar", "navbar", "nav", "navigation", "menu", "footer", "modal", "popup", "banner", "advert", "ads", "promo", "login", "signin", "skip", "toolbar", "alert", "alerts"]);

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

export function parseHtml(html) {
  const lower = html.toLowerCase();
  const root = { tag: "#root", attrs: "", children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+|<)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { top.children.push({ text: m[4] }); continue; }
    if (m[2] === undefined) continue; // comment, cdata, doctype
    const closing = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "";
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const node = { tag, attrs, children: [] };
    top.children.push(node);
    const selfClosing = VOID.has(tag) || /\/\s*$/.test(attrs);
    if (RAW_TEXT.has(tag) && !selfClosing) {
      const end = lower.indexOf("</" + tag, re.lastIndex);
      const stop = end === -1 ? html.length : end;
      node.raw = html.slice(re.lastIndex, stop);
      re.lastIndex = end === -1 ? html.length : html.indexOf(">", end) + 1 || html.length;
      continue;
    }
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function isNoise(node) {
  if (DROP_TAGS.has(node.tag)) return true;
  const a = node.attrs;
  if (!a) return false;
  if (/(?:^|\s)hidden(?:\s|=|$)/i.test(a) || /aria-hidden\s*=\s*["']?true/i.test(a) || /display\s*:\s*none/i.test(a)) return true;
  const role = attr(a, "role").toLowerCase();
  if (["navigation", "banner", "contentinfo", "complementary", "search", "dialog", "alertdialog"].includes(role)) return true;
  const tokens = `${attr(a, "class")} ${attr(a, "id")}`.toLowerCase().split(/[^a-z0-9]+/);
  return tokens.some((t) => NOISE_TOKENS.has(t));
}

/** Convert a parsed tree to text lines, dropping noise nodes. List items become "- " lines. */
function treeToText(node, out = [], inLink = false) {
  if (node.text !== undefined) { out.push(node.text); return out; }
  if (node.tag !== "#root" && isNoise(node)) return out;
  const block = BLOCK.has(node.tag), li = node.tag === "li", br = node.tag === "br";
  if (block || li || br) out.push("\n");
  if (li) out.push("- ");
  for (const c of node.children) treeToText(c, out, inLink);
  if (block || li) out.push("\n");
  return out;
}
export function htmlToText(html) {
  const text = treeToText(parseHtml(String(html))).join("");
  return normaliseLines(decodeEntities(text));
}
function normaliseLines(text) {
  return text.split("\n").map((l) => l.replace(/[ \t\r\f\v ]+/g, " ").trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== "")).join("\n").replace(/\n\n(?=- )/g, "\n").trim();
}

function findAll(node, tag, out = []) {
  if (node.tag === tag) out.push(node);
  for (const c of node.children || []) findAll(c, tag, out);
  return out;
}
function plainText(node) { return squash(treeToText(node).join(" ")); }

/* ------------------------------------------------------------------ titles */
const TITLE_WORDS = /\b(engineer|engineering|developer|manager|analyst|scientist|designer|intern|internship|specialist|associate|lead|director|consultant|architect|officer|executive|coordinator|administrator|technician|representative|assistant|researcher|writer|accountant|nurse|teacher|professor|lecturer|trainee|fellow|programmer|strategist|recruiter|marketer|planner|operator|supervisor|head|vp|president|partner|advisor|auditor|buyer|clerk|driver|mechanic|pharmacist|physician|counsel|paralegal|editor|producer|technologist|graduate|apprentice|co-op|sde|swe|devops|sre|qa)\b/i;
const HEADING_RE = /^(about( the)?( role| job| position| team| us| this role| the job)?|job (description|summary|overview|details)|description|overview|the role|role (overview|summary|description)|position (summary|description|overview)|summary|responsibilities|key responsibilities|(your |main |core )?(duties|responsibilities)|what you['’]?ll do|what you will do|what you['’]?ll be doing|your role|the opportunity|the position|requirements|qualifications|minimum (qualifications|requirements)|basic (qualifications|requirements)|preferred (qualifications|requirements)|required (skills|qualifications|experience)|desired (skills|qualifications)|skills( and experience| & experience)?|what we['’]?re looking for|who you are|you have|you['’]?ll bring|what you['’]?ll bring|nice to have|bonus( points)?|benefits|perks( & benefits)?|what we offer|compensation|salary|who we are)\s*:?$/i;
const NOISE_LINE = /^(skip to (main )?content|skip navigation|sign in|sign up|log ?in|log ?out|register|join now|home|careers?|jobs?|search( jobs| results)?|menu|back to (jobs|search|results|all jobs|careers)|apply( now| for this (job|role|position)| online| today)?|easy apply|save( job| this job)?|saved|share( this job| job)?|print|follow us|cookies?|accept( all)?( cookies)?|reject( all)?|manage (cookie|preferences)|cookie (settings|preferences|policy)|privacy( policy| notice| statement)?|terms( of (use|service)| & conditions)?|accessibility|sitemap|contact( us)?|\(c\)|all rights reserved|powered by|report( this)? (job|issue)|view all jobs|create (a )?job alert|get (job )?alerts?|language|select (a )?language|english|help( center)?|notifications?|messaging|my (jobs|profile|network)|for (employers|business)|post a job|back to top)\b.*$/i;
const FOOTER_RE = /^(similar jobs|related jobs|recommended jobs|jobs? (you may|similar)|you may also (like|be interested)|more jobs|view all (jobs|open|positions)|other (open )?(positions|roles|jobs|opportunities)|explore (more )?(jobs|careers|roles)|share this job|follow us|connect with us|sign up for (job )?alerts|get (job )?alerts|join (our )?(talent|community)|stay (connected|in touch)|\(c\)|©|privacy (policy|notice)|terms (of use|of service)|cookie|powered by|people also viewed|jobs? (in|near)|see more jobs)\b/i;

export function cleanTitle(raw, { strip = "" } = {}) {
  let t = squash(raw || "");
  if (!t) return { title: "", company: "" };
  let company = "";
  let m;
  if ((m = /^job application for (.+?) at (.+)$/i.exec(t))) return { title: tidy(m[1]), company: tidy(m[2]) };            // Greenhouse
  if ((m = /^(.+?) (?:is )?hiring (.+?)(?: in .+?)?(?:\s*\|\s*linkedin.*)?$/i.exec(t))) return { title: tidy(m[2]), company: tidy(m[1]) };  // LinkedIn
  const parts = t.split(/\s+[|–—-]\s+|\s+-\s+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const best = parts.find((p) => TITLE_WORDS.test(p) && !/\b(careers?|jobs?|indeed|linkedin|glassdoor|apply)\b/i.test(p)) || parts[0];
    company = parts.find((p) => p !== best && !TITLE_WORDS.test(p) && !/\b(careers?|jobs?|indeed|linkedin|glassdoor|apply|remote|hybrid|on-?site)\b/i.test(p) && p.length < 50) || "";
    t = best;
  }
  const at = /^(.+?)\s+at\s+([A-Z][\w&.' -]{1,40})$/.exec(t);
  if (at && TITLE_WORDS.test(at[1])) { t = at[1]; company = company || at[2]; }
  if (strip) t = t.replace(new RegExp(strip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  return { title: tidy(t), company: tidy(company) };
}
function tidy(s) {
  // Drop a trailing "(Company, City)" style note, but keep short qualifiers such as "(Backend)".
  s = String(s || "").replace(/\s*\([^)]*(?:,|\s\S+\s\S+\s)[^)]*\)\s*$/, "");
  return String(s).replace(/\s*\((?:remote|hybrid|on-?site|full[- ]time|part[- ]time)\)\s*$/i, "").replace(/[\s,;:|-]+$/, "").replace(/^[\s,;:|-]+/, "").trim().slice(0, 120); }

function titleScore(line) {
  const words = line.split(/\s+/).length;
  if (!line || line.length > 120 || words > 14 || /[.!?]$/.test(line) || HEADING_RE.test(line) || NOISE_LINE.test(line) || FOOTER_RE.test(line)) return -1;
  if (/^[-*•]/.test(line) || /\b(posted|apply by|req(uisition)? ?(id|#)|job id|ref(erence)?)\b/i.test(line)) return -1;
  let s = 0;
  if (TITLE_WORDS.test(line)) s += 5;
  if (words >= 2 && words <= 9) s += 2;
  const caps = line.split(/\s+/).filter((w) => /^[A-Z0-9(]/.test(w)).length / words;
  if (caps >= 0.6) s += 1;
  return s;
}

/* ------------------------------------------------------------------ plain-text region finder */
/**
 * Find the job posting inside arbitrary text (a pasted web page, a scraped page...).
 * Returns { text, title, confidence: "high"|"medium"|"low", removedChars }.
 */
export function cleanJobText(input) {
  const original = String(input || "").replace(/\r/g, "");
  const lines = original.split("\n").map((l) => squash(l));
  const nonEmpty = lines.filter(Boolean).length;
  if (nonEmpty < 3) return { text: original.trim(), title: titleFromLines(lines), confidence: "low", removedChars: 0 };

  // 1. The anchor: the first heading that is followed by real content (not just more menu items).
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || !HEADING_RE.test(lines[i])) continue;
    let content = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) if (lines[j] && !NOISE_LINE.test(lines[j]) && lines[j].split(/\s+/).length >= 4) content++;
    if (content >= 2) { anchor = i; break; }
  }
  if (anchor === -1) { // no section headings: use the first long paragraph
    anchor = lines.findIndex((l) => l.split(/\s+/).length >= 25);
  }
  if (anchor === -1) return { text: original.trim(), title: titleFromLines(lines), confidence: "low", removedChars: 0 };

  // 2. The title: the best title-like line in the stretch just before the anchor (or the anchor's own first line).
  let start = anchor, titleIdx = -1, best = 0;
  for (let i = anchor - 1, seen = 0; i >= 0 && seen < 30; i--) {
    if (!lines[i]) continue;
    seen++;
    const sc = titleScore(lines[i]);
    if (sc > best || (sc === best && sc > 0 && titleIdx === -1)) { best = sc; titleIdx = i; }
    if (sc >= 7) break; // a line with a title keyword and sensible length: stop at the nearest one
  }
  if (titleIdx !== -1 && best >= 3) start = titleIdx;
  const title = titleIdx !== -1 && best >= 3 ? cleanTitle(lines[titleIdx]).title : "";

  // 3. The end: where the footer / "similar jobs" block begins (only after real content).
  let end = lines.length;
  for (let i = anchor + 6; i < lines.length; i++) if (lines[i] && FOOTER_RE.test(lines[i])) { end = i; break; }

  // 4. Keep the region, dropping menu/noise lines inside it.
  const kept = lines.slice(start, end).filter((l, i, a) => l ? !NOISE_LINE.test(l) || l.split(/\s+/).length > 8 : a[i - 1] !== "" );
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const confidence = text.length >= 400 && title ? "high" : text.length >= 250 ? "medium" : "low";
  return { text, title, confidence, removedChars: Math.max(0, original.trim().length - text.length) };
}

function titleFromLines(lines) {
  let best = 0, pick = "";
  for (const l of lines.slice(0, 40)) { const s = titleScore(l); if (s > best) { best = s; pick = l; } }
  return best >= 5 ? cleanTitle(pick).title : "";
}
/** Best-effort job title from plain text, or "" if not confident (the UI then asks the user). */
export function titleFromText(text) {
  return cleanJobText(text).title || titleFromLines(String(text || "").split("\n").map(squash));
}

/* ------------------------------------------------------------------ JSON-LD (schema.org JobPosting) */
function fromJsonLd(html) {
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim().replace(/^﻿/, "")); } catch { continue; }
    const queue = Array.isArray(data) ? [...data] : [data];
    while (queue.length) {
      const o = queue.shift();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o["@graph"])) queue.push(...o["@graph"]);
      const type = [].concat(o["@type"] || []).join(",");
      if (!/JobPosting/i.test(type)) continue;
      const desc = typeof o.description === "string" ? o.description : "";
      const text = /<[a-z][\s\S]*>|&lt;/i.test(desc) ? htmlToText(/&lt;/.test(desc) && !/<[a-z]/i.test(desc) ? decodeEntities(desc) : desc) : normaliseLines(decodeEntities(desc));
      const org = o.hiringOrganization;
      const loc = [].concat(o.jobLocation || []).map((l) => {
        const a = l && l.address ? l.address : l || {};
        const country = typeof a.addressCountry === "object" ? a.addressCountry?.name : a.addressCountry;
        return [a.addressLocality, a.addressRegion, country].filter((x) => typeof x === "string" && x).join(", ");
      }).filter(Boolean).join(" / ") || (o.jobLocationType === "TELECOMMUTE" ? "Remote" : "");
      return {
        title: cleanTitle(typeof o.title === "string" ? o.title : "").title,
        company: squash(typeof org === "string" ? org : org?.name || ""),
        location: squash(loc),
        description: text,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ ATS JSON APIs (Greenhouse, Lever) */
/** If the URL is a Greenhouse or Lever posting, the public JSON API URL for it (cleaner than the HTML page). */
export function apiUrlFor(pageUrl) {
  let u;
  try { u = new URL(pageUrl); } catch { return null; }
  let m;
  if (/(^|\.)greenhouse\.io$/i.test(u.hostname)) {
    const gh = u.searchParams.get("gh_jid");
    m = /^\/(?:embed\/job_app\/?)?([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    if (m) return { kind: "greenhouse", url: `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}` };
    if (gh && u.searchParams.get("for")) return { kind: "greenhouse", url: `https://boards-api.greenhouse.io/v1/boards/${u.searchParams.get("for")}/jobs/${gh}` };
  }
  if (/(^|\.)lever\.co$/i.test(u.hostname) && (m = /^\/([^/]+)\/([0-9a-f-]{20,})/i.exec(u.pathname))) return { kind: "lever", url: `https://api.lever.co/v0/postings/${m[1]}/${m[2]}` };
  return null;
}
export function parseApiJob(kind, data) {
  if (!data || typeof data !== "object") return null;
  if (kind === "greenhouse") {
    const body = htmlToText(decodeEntities(String(data.content || "")));
    return { title: cleanTitle(data.title || "").title, company: squash(data.company_name || ""), location: squash(data.location?.name || ""), description: body };
  }
  if (kind === "lever") {
    const parts = [String(data.descriptionPlain || htmlToText(data.description || ""))];
    for (const l of data.lists || []) parts.push(`${squash(l.text || "")}\n${htmlToText(l.content || "")}`);
    if (data.additionalPlain || data.additional) parts.push(String(data.additionalPlain || htmlToText(data.additional)));
    return { title: cleanTitle(data.text || "").title, company: "", location: squash(data.categories?.location || ""), description: normaliseLines(parts.join("\n\n")) };
  }
  return null;
}

/* ------------------------------------------------------------------ HTML page extraction */
/**
 * Extract the job posting from an HTML page. Never throws.
 * Returns { title, company, location, description, source, confidence, warnings }.
 */
export function extractJobFromHtml(htmlInput) {
  const html = String(htmlInput || "").slice(0, 1_500_000);
  const warnings = [];
  const ld = fromJsonLd(html);
  if (ld && ld.description.length >= 250 && ld.title) {
    return { ...ld, source: "structured-data", confidence: "high", warnings };
  }

  const root = parseHtml(html);
  const text = normaliseLines(decodeEntities(treeToText(root).join("")));
  const region = cleanJobText(text);

  const h1s = findAll(root, "h1").map((n) => cleanTitle(plainText(n)).title).filter((t) => titleScore(t) >= 3);
  const metaTitle = (/<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html) || /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["']/i.exec(html) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "";
  const fromMeta = cleanTitle(metaTitle);
  const site = (/<meta[^>]+property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html) || [])[1] || "";

  const title = (ld && ld.title) || h1s[0] || (titleScore(fromMeta.title) >= 3 ? fromMeta.title : "") || region.title || "";
  const description = region.text.length >= (ld ? ld.description.length : 0) ? region.text : ld.description;
  if (description.length < 300) warnings.push("This page loads its job text with JavaScript, so only an empty shell was visible. Paste the job description instead.");
  if (!title) warnings.push("We could not find the job title. Please type it in.");
  return {
    title,
    company: (ld && ld.company) || fromMeta.company || squash(site) || "",
    location: (ld && ld.location) || "",
    description,
    source: "page",
    confidence: description.length < 300 ? "low" : region.confidence,
    warnings,
  };
}
