/* ---------- ATS report: computed in the browser (instant, private); AI parts are optional extras ---------- */
const results = {};
let report = null, reportKey = "", aiState = {key:"", status:"idle"}, recomputeTimer = 0, shownScore = null, deltaTimer = 0;

const currentTitle = () => $("jobTitle").value.trim();
const currentCompany = () => $("jobCompany").value.trim();
const aiKey = () => hashStr(resumeEl.value.trim() + "\u0000" + jobEl.value.trim());

function recompute(){
  const r = resumeEl.value.trim(), j = jobEl.value.trim();
  reportKey = hashStr(r + "\u0000" + j + "\u0000" + currentTitle() + "\u0000" + [...ignored].sort().join(","));
  const old = report ? report.score : null;
  try{ report = (r.length >= 80 && j.length >= 80) ? ATS.analyze(r, j, {jobTitle: currentTitle(), ignore: [...ignored]}) : null; }
  catch(e){ console.error(e); report = null; }
  updateTicker(old); updateResumeQuality();
  if(active === "ats") renderOutput();
}
function scheduleRecompute(){ clearTimeout(recomputeTimer); recomputeTimer = setTimeout(recompute, 300); }

/* live ticker in the top bar: score, change since the last edit, and always the job position */
function animateNumber(el, from, to){
  if(from === to || matchMedia("(prefers-reduced-motion: reduce)").matches){ el.textContent = to; return; }
  const t0 = performance.now(), dur = 380;
  (function step(now){
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if(k < 1) requestAnimationFrame(step);
  })(t0);
}
function updateTicker(old){
  const tk = $("ticker"), sc = $("tickScore"), dl = $("tickDelta"), tt = $("tickTitle");
  if(!report){
    sc.textContent = "--"; sc.className = "tick-score"; dl.hidden = true; shownScore = null;
    tt.textContent = "Add your resume and the job"; tk.classList.remove("missing"); return;
  }
  const s = report.score;
  sc.className = "tick-score " + (s >= 70 ? "good" : s >= 55 ? "warn" : "bad");
  animateNumber(sc, shownScore ?? s, s);
  if(old != null && old !== s){
    dl.textContent = (s > old ? "+" : "") + (s - old); dl.className = "tick-delta " + (s > old ? "up" : "down"); dl.hidden = false;
    clearTimeout(deltaTimer); deltaTimer = setTimeout(() => dl.hidden = true, 4500);
  }
  shownScore = s;
  const title = currentTitle(), company = currentCompany();
  if(title){ tt.innerHTML = `<b>${esc(title)}</b>${company ? " · " + esc(company) : ""}`; tk.classList.remove("missing"); }
  else { tt.textContent = "Add the job title: this score needs to say which job it is for"; tk.classList.add("missing"); }
}
$("ticker").addEventListener("click", () => { if($("ticker").classList.contains("missing")){ showView("job"); $("jobTitle").focus(); } });

function updateResumeQuality(){
  const q = $("resumeQuality");
  if(!report){ q.textContent = "Saved in this browser only."; return; }
  const bad = report.format.filter(f => !f.ok);
  q.textContent = bad.length ? `⚠ ${bad[0].label}${bad.length > 1 ? ` (+${bad.length - 1} more)` : ""}` : "Reads cleanly: contact details and standard sections found.";
}

/* ---------- report rendering ---------- */
const tone = v => v >= .75 ? "good" : v >= .5 ? "warn" : "bad";
const list = a => a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";

/* group the skill rows for display: alternatives ("AWS or GCP") become one chip */
function kwGroups(a){
  const seen = new Set(), out = {proven:[], listed:[], related:[], missing:[]};
  for(const r of a.keywords){
    let names = [r.skill], credit = r.credit, via = "", related = r.related;
    if(r.group){
      if(seen.has(r.group)) continue; seen.add(r.group);
      const mem = a.keywords.filter(x => x.group === r.group);
      const best = mem.find(x => !String(x.evidence).startsWith("covered")) || mem[0];
      names = mem.map(x => x.skill); credit = best.credit; via = credit ? best.skill : ""; related = best.related;
    }
    const kind = credit >= 1 ? "proven" : credit >= .6 ? "listed" : credit > 0 ? "related" : "missing";
    out[kind].push({names, label: names.join(" or "), tier:r.tier, via, related, kind});
  }
  return out;
}

function proofMarkup(resume, a){
  const names = a.keywords.filter(k => k.resumeCount > 0).map(k => k.skill);
  let out = "", pos = 0, hits = 0;
  for(const m of ATS.skillMatches(resume, names)){
    if(m.start < pos) continue;
    out += esc(resume.slice(pos, m.start)) + "<mark>" + esc(resume.slice(m.start, m.end)) + "</mark>"; pos = m.end; hits++;
  }
  out += esc(resume.slice(pos));
  return hits ? `<h3>Your resume, marked up</h3><p class="legend"><span><span class="mk-hl">${hits} matches</span> skills from the posting, highlighted where they appear in your resume</span></p><div class="proof">${out}</div>` : "";
}

function aiSection(a){
  const st = aiState.key === aiKey() ? aiState : {status:"idle"};
  if(st.status === "idle") return `<h3>AI recruiter review</h3><div class="ai-card"><p style="margin:0">A recruiter's first-pass verdict, plus what the posting really wants and the questions to expect. Press <b>Generate</b> to add it.</p></div>`;
  if(st.status === "loading") return `<h3>AI recruiter review</h3><div class="ai-card"><p class="hint" style="margin:0">The recruiter is reading your resume…</p><div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:75%"></div><div class="skeleton" style="width:84%"></div></div>`;
  let html = "";
  const rc = st.recruiter, jd = st.jd;
  if(st.error && !rc && !jd) return `<h3>AI recruiter review</h3><div class="ai-card"><p style="margin:0;color:var(--bad)">${esc(st.error)}</p><p class="hint" style="margin:6px 0 0">Your ATS score above is unaffected. Press Generate to try again.</p></div>`;
  if(rc){
    const label = {shortlist:"Would shortlist", maybe:"On the fence", reject:"Would pass for now"}[rc.decision];
    html += `<h3>Recruiter view</h3><div class="ai-card live"><div class="row" style="gap:10px"><span class="decision ${rc.decision}">${label}</span><span class="count">${rc.confidence}% confident</span></div>
      ${rc.first_impression ? `<p class="quote">${esc(rc.first_impression)}</p>` : ""}
      <div class="two"><div><h3>Working for you</h3>${list(rc.reasons_for)}</div><div><h3>Working against you</h3>${list(rc.reasons_against)}</div></div>
      ${rc.red_flags.length ? `<h3>Red flags to explain</h3>${list(rc.red_flags)}` : ""}
      ${rc.questions_to_probe.length ? `<h3>Questions they'd ask on a screening call</h3>${list(rc.questions_to_probe)}` : ""}
      ${rc.pitch ? `<h3>The pitch to the hiring manager</h3><p><em>${esc(rc.pitch)}</em></p>` : ""}</div>`;
  } else html += `<h3>Recruiter view</h3><div class="ai-card"><p class="hint" style="margin:0">The recruiter review didn't load this time. Press Generate to retry.</p></div>`;
  if(jd){
    const low = resumeEl.value.toLowerCase();
    html += `<h3>What this posting really wants</h3><div class="ai-card live">
      ${jd.summary ? `<p style="margin-top:0"><b>${esc(jd.role || "")}</b>${jd.company ? " at " + esc(jd.company) : ""}${jd.domain ? " · " + esc(jd.domain) : ""}<br>${esc(jd.summary)}</p>` : ""}
      ${jd.what_they_really_want.length ? `<h3>Underlying priorities</h3>${list(jd.what_they_really_want)}` : ""}
      ${jd.ats_keywords.length ? `<h3>Exact phrases an ATS will search for</h3><div class="chips">${jd.ats_keywords.map(k => low.includes(k.toLowerCase()) ? `<span class="chip2 proven">${esc(k)}</span>` : `<span class="chip2 missing">${esc(k)}</span>`).join("")}</div><p class="fineprint">Highlighted = already on your resume. Underlined = add it only if it is true.</p>` : ""}
      ${jd.red_flags.length ? `<h3>Warning signs in the posting</h3>${list(jd.red_flags)}` : ""}
      ${jd.likely_screening_questions.length ? `<h3>Likely application questions</h3>${list(jd.likely_screening_questions)}` : ""}</div>`;
  }
  if(st.error) html += `<p class="fineprint">${esc(st.error)}</p>`;
  return html;
}

function atsHTML(a, example){
  const s = a.score, t = s >= 70 ? "good" : s >= 55 ? "warn" : "bad";
  const color = {good:"var(--good)", warn:"var(--warn)", bad:"var(--bad)"}[t];
  const g = kwGroups(a);
  const chip = c => {
    const tag = c.kind === "related" ? ` <em>≈ ${esc(c.related[0] || "")}</em>` : c.kind === "listed" ? " <em>listed only</em>" : c.kind === "missing" ? ` <em>${c.tier}</em>` : c.via && c.via !== c.label ? ` <em>via ${esc(c.via)}</em>` : "";
    return `<button class="chip2 ${c.kind}" data-gap="${esc(c.names.join("|"))}" data-kind="${c.kind}" data-tier="${c.tier}" aria-haspopup="dialog" title="Click to fix">${esc(c.label)}${tag}</button>`;
  };
  const grp = (title, kind) => g[kind].length ? `<div class="kw-group"><h4>${title}</h4><div class="chips">${g[kind].map(chip).join("")}</div></div>` : "";
  const weak = a.bullets.weakest;
  const title = a.job.title, company = currentCompany();
  return `${example ? `<p class="example-note">This is a live score of the example resume and job. Replace them with yours and it updates as you type.</p>` : ""}
  ${title ? `<p class="scoring-for">Scoring for <b>${esc(title)}</b>${company ? " at " + esc(company) : ""}</p>` : `<div class="needs-title">We couldn't find the job position. <button class="btn small" data-act="focus-title">Add the job title</button></div>`}
  <div class="ats-head">
    <div class="score" role="img" aria-label="ATS readiness ${s} out of 100"><svg viewBox="0 0 140 120" aria-hidden="true"><path stroke="${color}" d="M78 10 C112 8 136 34 130 64 C124 98 84 116 50 108 C18 100 2 72 10 44 C18 18 50 6 84 12 C96 14 104 18 110 23"/></svg><div class="n">${s}<small>/100</small></div></div>
    <div style="min-width:0"><span class="grade ${t}">${esc(a.grade.label)}</span><p class="verdict">${esc(a.grade.verdict)}</p></div>
  </div>
  <p class="fineprint">${esc(a.disclaimer)}</p>
  <h3>Where your points come from</h3>
  <div class="bars">${a.breakdown.map(b => `<div class="bar"><div class="bar-top"><b>${esc(b.label)}</b><span>${b.points} / ${b.weight}</span></div><div class="track"><i class="${tone(b.ratio)}" style="width:${Math.round(b.ratio * 100)}%"></i></div><p>${esc(b.detail)}</p></div>`).join("")}</div>
  <h3>Fix these first</h3>
  ${a.fixes.length ? `<ol class="fixes">${a.fixes.slice(0, 7).map(f => `<li><span class="gain">+${f.gain}</span><div><b>${esc(f.text)}</b><small>${esc(f.action)}</small></div></li>`).join("")}</ol>` : `<p>Nothing major to fix. Nicely done.</p>`}
  <h3>Skills the job asks for <span class="hint" style="font-weight:400">(click a skill to fix it)</span></h3>
  ${grp("Proven in your experience", "proven")}${grp("On your resume, but only in a skills list", "listed")}${grp("Related skills you have", "related")}${grp("Not on your resume", "missing")}
  ${a.ignored.length ? `<div class="kw-group"><h4>Ignored for this job (click to bring back)</h4><div class="chips">${a.ignored.map(n => `<button class="chip2 ignored" data-restore="${esc(n)}">${esc(n)}</button>`).join("")}</div></div>` : ""}
  ${a.keywords.length ? "" : `<p class="hint">No known skills were recognised in this posting, so the score leans on its wording instead.</p>`}
  ${a.vocabulary.length ? `<div class="kw-group"><h4>Other terms the posting repeats</h4><div class="chips">${a.vocabulary.map(v => `<span class="chip2 ${v.inResume ? "proven" : "missing"}">${esc(v.term)}</span>`).join("")}</div></div>` : ""}
  <h3>Your bullet points</h3>
  <p style="margin:0 0 10px">${a.bullets.total} bullets · average ${a.bullets.average}/100 · ${a.bullets.withMetrics}% show a result · ${a.bullets.withVerbs}% open with an action verb</p>
  ${weak.length ? `<div class="audit">${weak.slice(0, 5).map(b => `<div class="audit-item"><q>${esc(b.text)}</q><div class="meta"><span class="pill ${tone(b.score / 100)}">${b.score}/100</span>${b.issues.map(i => `<span>${esc(i)}</span>`).join(" · ")}</div></div>`).join("")}</div><div class="cta-row"><button class="btn small" data-go="rewrite">Rewrite these with AI</button></div>` : a.bullets.total ? `<p>Every bullet is in good shape.</p>` : `<p class="hint">No bullet points were found. Use • bullets under each role.</p>`}
  <h3>Structure checklist</h3>
  <ul class="checks">${a.format.map(f => `<li><span class="${f.ok ? "ok" : "no"}">${f.ok ? "✓" : "✕"}</span><span>${esc(f.label)}${f.ok ? "" : `<small>${esc(f.tip)}</small>`}</span></li>`).join("")}</ul>
  ${a.missing.length ? `<div class="cta-row"><button class="btn small" data-go="gapplan">Plan to close the gaps</button></div>` : ""}
  ${aiSection(a)}
  ${proofMarkup(resumeEl.value, a)}`;
}

/* ---------- AI review (recruiter view + posting analysis) ---------- */
function cleanRec(r){
  return {decision:["shortlist","maybe","reject"].includes(r?.decision) ? r.decision : "maybe", confidence:Math.max(0, Math.min(100, parseInt(r?.confidence) || 50)),
    first_impression:typeof r?.first_impression === "string" ? r.first_impression : "", reasons_for:arr(r?.reasons_for), reasons_against:arr(r?.reasons_against),
    red_flags:arr(r?.red_flags), questions_to_probe:arr(r?.questions_to_probe), pitch:typeof r?.pitch === "string" ? r.pitch : ""};
}
function cleanJd(j){
  const t = v => typeof v === "string" ? v : "";
  return {company:t(j?.company), role:t(j?.role), domain:t(j?.domain), summary:t(j?.summary), must_have:arr(j?.must_have), nice_to_have:arr(j?.nice_to_have),
    what_they_really_want:arr(j?.what_they_really_want), ats_keywords:arr(j?.ats_keywords), red_flags:arr(j?.red_flags), likely_screening_questions:arr(j?.likely_screening_questions)};
}
/* the AI always sees the confirmed job title and company at the top, so it talks about the right job */
function jobForAI(){
  const head = [currentTitle() && `Job title: ${currentTitle()}`, currentCompany() && `Company: ${currentCompany()}`].filter(Boolean).join("\n");
  return (head ? head + "\n\n" : "") + jobEl.value.trim();
}
async function runAIReview(){
  const key = aiKey();
  aiState = {key, status:"loading"};
  controller = new AbortController();
  $("goBtn").disabled = true; $("stopBtn").hidden = false;
  setStatus("Your score is ready. The AI recruiter is reviewing your resume…");
  renderOutput();
  const base = {resume: resumeEl.value.trim().slice(0, 15000), job: jobForAI().slice(0, 15000)};
  const ask = async task => parseJSON(await callAI({...base, task}, {signal: controller.signal}));
  try{
    const [jd, rec] = await Promise.allSettled([ask("jd"), ask("recruiter")]);
    if(controller.signal.aborted){ aiState = {key:"", status:"idle"}; setStatus("Stopped."); return; }
    const ok = x => x.status === "fulfilled";
    aiState = {key, status: ok(jd) || ok(rec) ? "done" : "error", jd: ok(jd) ? cleanJd(jd.value) : null, recruiter: ok(rec) ? cleanRec(rec.value) : null,
      error: ok(jd) && ok(rec) ? "" : friendly((ok(jd) ? rec : jd).reason)};
    setStatus(aiState.status === "done" ? "Done. Your score is calculated from your resume; the recruiter view is an AI opinion." : friendly((ok(jd) ? rec : jd).reason), aiState.status === "error");
  }catch(e){ aiState = {key, status:"error", error: friendly(e)}; setStatus(friendly(e), true); }
  finally{ controller = null; $("goBtn").disabled = false; $("stopBtn").hidden = true; if(active === "ats") renderOutput(); }
}
