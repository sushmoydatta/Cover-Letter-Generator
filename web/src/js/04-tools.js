/* ---------- tools (tabs in the results pane) ---------- */
const LABELS = {ats:"ATS score"};
const TOOLS = [
  {id:"ats", opts:""},
  {id:"letter", opts:`<label class="field">Style<select id="optStyle">${Object.keys(PROMPTS.letter_styles).map(s => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></label>`},
  {id:"tailor", opts:""},
  {id:"rewrite", opts:""},
  {id:"gapplan", opts:""},
  {id:"outreach", opts:`<label class="field">Writing to (optional)<input type="text" id="optContact" placeholder="e.g. Priya, Engineering Manager"></label>`},
  {id:"interview", opts:""},
  {id:"answer", opts:`<label class="field" style="flex-basis:100%">Application question<input type="text" id="optQuestion" placeholder="Why do you want to work at this company?"></label>`}
];
let active = store.get("tab", "ats");
if(!TOOLS.some(t => t.id === active)) active = "ats";
let controller = null;
const toolLabel = id => LABELS[id] || PROMPTS.tasks[id].label;

function renderTabs(){
  $("tabs").innerHTML = TOOLS.map(t => `<button class="tab" role="tab" id="tab-${t.id}" aria-selected="${t.id === active}" data-id="${t.id}">${esc(toolLabel(t.id))}</button>`).join("");
  $("opts").innerHTML = TOOLS.find(t => t.id === active).opts;
  $("opts").hidden = !$("opts").innerHTML;
  const optEl = $("opts").querySelector("select,input");
  const remembered = store.get("opt:" + active, null);
  if(optEl && remembered !== null) optEl.value = remembered;
  if(optEl) optEl.addEventListener("change", () => store.set("opt:" + active, optEl.value));
  $("goBtn").textContent = active === "ats" ? "AI review" : "Generate";
  renderOutput();
}
function openTool(id){ active = id; store.set("tab", id); setStatus(""); renderTabs(); showView("results"); }
$("tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if(b) openTool(b.dataset.id); });

function renderOutput(){
  const r = results[active], out = $("out");
  out.classList.remove("plain");
  if(active !== "ats") closeGap(false);
  if(active === "ats"){
    if(!report){ out.innerHTML = `<p class="hint">Add your resume and the job (a few lines each) and your ATS score appears here, live as you type.</p>`; return; }
    out.innerHTML = atsHTML(report, resumeEl.value === EXAMPLE_RESUME && jobEl.value === EXAMPLE_JOB); rebindPop(); return;
  }
  if(!r){ out.innerHTML = `<p class="hint">Press <b>Generate</b> to create your ${esc(toolLabel(active).toLowerCase())}.</p>`; return; }
  if(r.kind === "plain"){ out.classList.add("plain"); out.textContent = r.data; }
  else out.innerHTML = md(r.data);
}

function md(src){
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g,"$1<em>$2</em>").replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g,"$1<em>$2</em>").replace(/`([^`]+)`/g,"<code>$1</code>");
  const lines = src.replace(/\r/g,"").split("\n"); let html = "", inList = false, para = [];
  const flush = () => { if(para.length){ html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
  const endList = () => { if(inList){ html += "</ul>"; inList = false; } };
  for(const raw of lines){
    const line = raw.trimEnd();
    let m;
    if(!line.trim()){ flush(); endList(); continue; }
    if((m = line.match(/^#{1,2}\s+(.*)/))){ flush(); endList(); html += `<h2>${inline(m[1])}</h2>`; continue; }
    if((m = line.match(/^#{3,6}\s+(.*)/))){ flush(); endList(); html += `<h3>${inline(m[1])}</h3>`; continue; }
    if((m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/))){ flush(); if(!inList){ html += "<ul>"; inList = true; } html += `<li>${inline(m[1])}</li>`; continue; }
    if(inList && /^\s{2,}\S/.test(raw)){ html = html.replace(/<\/li>$/, `<br>${inline(line.trim())}</li>`); continue; }
    endList(); para.push(line);
  }
  flush(); endList(); return html;
}

async function generate(){
  const resume = resumeEl.value.trim(), job = jobEl.value.trim();
  if(resume.length < 80){ showView("resume"); return setStatus("Add your resume first (paste it or upload a PDF).", true); }
  if(job.length < 80){ showView("job"); return setStatus("Add the job posting first.", true); }
  if(!currentTitle()){ showView("job"); $("jobTitle").focus(); return setStatus("Add the job title first, so every result says which job it is for.", true); }
  if(!engineReady()) return setStatus(apiOk === false ? "The AI service is offline right now. Your ATS score still works." : "Still connecting to the AI service. Try again in a moment.", true);
  if(active === "ats"){ if(!report) recompute(); showView("results"); return runAIReview(); }

  const task = PROMPTS.tasks[active];
  const req = {task: active, resume: resume.slice(0, 15000), job: jobForAI().slice(0, 15000)};
  if(active === "rewrite" || active === "gapplan"){
    if(!report) recompute();
    const weakB = report ? report.bullets.weakest.map(b => "- " + b.text) : [];
    const gaps = report ? report.keywords.filter(k => k.credit === 0).map(k => `- ${k.alternatives && k.alternatives.length ? k.skill + " (or " + k.alternatives.join(" / ") + ")" : k.skill} (${k.tier === "must" ? "must-have" : k.tier === "core" ? "central to the duties" : "nice-to-have"})`) : [];
    const focus = (active === "rewrite" ? weakB : [...new Set(gaps)]).slice(0, 8).join("\n");
    if(!focus) return setStatus(active === "rewrite" ? "Your bullets are already strong, so there is nothing to rewrite." : "No gaps found. Your resume covers the job's skills.", true);
    req.focus = focus;
  }
  if(active === "letter") req.style = $("optStyle").value;
  if(active === "outreach") req.contact = $("optContact").value.trim();
  if(active === "answer"){ req.question = $("optQuestion").value.trim(); if(!req.question) return setStatus("Type the application question first.", true); }

  const toolId = active, plain = toolId === "letter" || toolId === "answer";
  controller = new AbortController();
  $("goBtn").disabled = true; $("stopBtn").hidden = false; showView("results");
  setStatus("Writing your draft…");
  const out = $("out");
  out.classList.toggle("plain", plain); out.textContent = "";
  try{
    const text = await callAI(req, {signal: controller.signal, onText: t => {
      if(active !== toolId) return;
      if(plain) out.textContent = t; else out.innerHTML = md(t);
    }});
    results[toolId] = {kind: plain ? "plain" : "md", data: text};
    setStatus("Done. Review and edit before you send it.");
  }catch(e){
    if(e.name === "AbortError" || e.code === "cancelled") setStatus("Stopped.");
    else setStatus(friendly(e), true);
  }finally{
    controller = null; $("goBtn").disabled = false; $("stopBtn").hidden = true;
    if(active === toolId) renderOutput();
  }
}
$("goBtn").addEventListener("click", generate);
$("stopBtn").addEventListener("click", () => controller && controller.abort());

function outputText(){
  if(active === "ats"){
    if(!report) return "";
    const a = report;
    return `ATS readiness for ${a.job.title || "this job"}${currentCompany() ? " at " + currentCompany() : ""}: ${a.score}/100 (${a.grade.label})\n${a.grade.verdict}\n\n` +
      a.breakdown.map(b => `${b.label}: ${b.points}/${b.weight}`).join("\n") +
      `\n\nFix first:\n` + a.fixes.slice(0, 7).map(f => `+${f.gain}  ${f.text} ${f.action}`).join("\n") + (a.missing.length ? `\n\nMissing: ${a.missing.join(", ")}` : "");
  }
  const r = results[active];
  return r ? r.data : "";
}
async function copyText(text, btn){
  if(!text){ setStatus("Nothing to copy yet. Generate something first.", true); return; }
  try{ await navigator.clipboard.writeText(text); if(btn){ const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = old, 1400); } else toast("Copied."); }
  catch{ const r = document.createRange(); r.selectNodeContents($("out")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); setStatus("Press Ctrl+C / Cmd+C to copy the selected text."); }
}
$("copyBtn").addEventListener("click", e => copyText(outputText(), e.currentTarget));

/* shortcuts inside the report: "Rewrite these with AI", "Plan to close the gaps", "Add the job title" */
$("out").addEventListener("click", e => {
  const go = e.target.closest("[data-go]");
  if(go){ openTool(go.dataset.go); generate(); return; }
  const act = e.target.closest("[data-act]");
  if(act && act.dataset.act === "focus-title"){ showView("job"); $("jobTitle").focus(); }
});
