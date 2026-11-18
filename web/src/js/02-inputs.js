/* ---------- resume and job inputs ---------- */
const resumeEl = $("resume"), jobEl = $("job");
let jobTitleSource = store.get("titleSource", "none");   // "extracted" | "detected" | "typed" | "none"
let undoJob = null;
let ignored = new Set(store.get("ignored", []));          // skills the user marked "not for me" for this job

function bindText(el, key, example, tagId, countId, onChange){
  el.value = store.get(key, example);
  const update = () => { $(countId).textContent = `${el.value.length.toLocaleString()} chars`; $(tagId).hidden = el.value !== example; };
  el.addEventListener("input", () => { store.set(key, el.value); update(); onChange && onChange(); scheduleRecompute(); });
  update();
  return update;
}
const updResume = bindText(resumeEl, "resume", EXAMPLE_RESUME, "resumeExample", "resumeCount");
const updJob = bindText(jobEl, "job", EXAMPLE_JOB, "jobExample", "jobCount", debounce(() => deriveTitle(), 350));

/* job title: required, always shown next to the score */
function titleBadge(){
  const el = $("titleSrc"), box = $("titleBox"), title = $("jobTitle").value.trim();
  const map = {extracted:["from the job page","ok"], detected:["detected","ok"], typed:["you typed this",""], none:["",""]};
  if(!title){ el.textContent = "required"; el.className = "src warn"; box.classList.add("missing"); }
  else { const [t, c] = map[jobTitleSource] || ["", ""]; el.textContent = t; el.className = "src " + c; box.classList.remove("missing"); }
}
function setTitle(t, source){
  $("jobTitle").value = t; jobTitleSource = t ? source : "none";
  store.set("jobTitle", t); store.set("titleSource", jobTitleSource); titleBadge(); scheduleRecompute();
}
function deriveTitle(){
  if(jobTitleSource === "typed" && $("jobTitle").value.trim()) return;      // never overwrite what the user typed
  const t = ATS.titleFromText(jobEl.value);
  setTitle(t, t ? "detected" : "none");
}
$("jobTitle").addEventListener("input", () => { jobTitleSource = $("jobTitle").value.trim() ? "typed" : "none"; store.set("jobTitle", $("jobTitle").value); store.set("titleSource", jobTitleSource); titleBadge(); scheduleRecompute(); });
$("jobCompany").addEventListener("input", () => store.set("jobCompany", $("jobCompany").value));

function showNote(msg, kind){
  const n = $("jobNote"); if(!msg){ n.hidden = true; return; }
  n.className = "note" + (kind ? " " + kind : ""); n.textContent = msg; n.hidden = false;
}

/* keep only the job description: used on paste, from the button and from the palette */
function trimJobText(auto){
  const before = jobEl.value;
  if(before.trim().length < 200){ if(!auto) toast("Paste the job page first, then trim."); return; }
  const r = ATS.cleanJobText(before);
  const removed = before.trim().length - r.text.length;
  if(r.confidence === "low"){ if(!auto) toast("Couldn't find a clear job description in that text."); return; }
  if(removed < 40){
    if(!auto) toast("That already looks like just the job.");
    if(r.title && jobTitleSource !== "typed") setTitle(r.title, "detected");
    return;
  }
  undoJob = {text: before, title: $("jobTitle").value, source: jobTitleSource};
  jobEl.value = r.text; store.set("job", r.text); updJob();
  if(jobTitleSource !== "typed" || !$("jobTitle").value.trim()) setTitle(r.title, r.title ? "detected" : "none");
  scheduleRecompute();
  toast(`Kept only the job description (removed ${removed.toLocaleString()} characters).`, {label:"Undo", run: undoTrim});
}
function undoTrim(){
  if(!undoJob) return;
  jobEl.value = undoJob.text; store.set("job", undoJob.text); updJob();
  setTitle(undoJob.title, undoJob.source); undoJob = null; scheduleRecompute();
}
jobEl.addEventListener("paste", () => setTimeout(() => trimJobText(true), 0));
$("trimJob").addEventListener("click", () => trimJobText(false));

/* fetch a job link: the backend returns just the posting (title, company, description) */
async function fetchJob(){
  const url = $("jobUrl").value.trim();
  if(!/^https?:\/\//i.test(url)) return showNote("Enter a full link starting with https://", "warn");
  if(!API_URL || claudeSample) return showNote("Reading links needs the web service. Paste the job text instead.", "warn");
  $("fetchBtn").disabled = true; showNote("Reading the page…");
  try{
    const r = await fetch(API_URL + "/job", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({url})});
    const data = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(data.error || `The page could not be read (${r.status}). Paste the job text instead.`);
    applyExtraction(data);
  }catch(e){ showNote(friendly(e), "warn"); }
  finally{ $("fetchBtn").disabled = false; }
}
/* title first, then company and place, then the description; never repeat a line the description already has */
function composeJobText(d, desc){
  const first = desc.split("\n", 1)[0].trim().toLowerCase();
  const hasTitle = d.title && (first === d.title.toLowerCase() || first.startsWith(d.title.toLowerCase()));
  const meta = [d.company, d.location].filter(Boolean).filter(x => !desc.slice(0, 400).toLowerCase().includes(x.toLowerCase())).join(" · ");
  const head = [hasTitle ? "" : d.title, meta].filter(Boolean).join("\n");
  return (head ? head + "\n\n" : "") + desc;
}
function applyExtraction(d){
  const desc = String(d.description || "");
  if(d.title) setTitle(d.title, "extracted");
  if(d.company) { $("jobCompany").value = d.company; store.set("jobCompany", d.company); }
  if(d.confidence === "low" || desc.length < 200){
    showNote((d.warnings && d.warnings[0]) || "We couldn't find the job text on that page. Paste the job description instead.", "warn");
    return;
  }
  resetJobState();
  jobEl.value = composeJobText(d, desc); store.set("job", jobEl.value); updJob();
  if(d.title) setTitle(d.title, "extracted"); else deriveTitle();
  const src = {"structured-data":"the page's job data", api:"the job board", page:"the page text"}[d.source] || "the page";
  showNote(`Kept only the job posting, read from ${src}.${d.title ? "" : " We couldn't find the job title, so please type it."}${(d.warnings || []).length ? " " + d.warnings.join(" ") : ""}`, d.title ? "good" : "warn");
  scheduleRecompute();
}
$("fetchBtn").addEventListener("click", fetchJob);
$("jobUrl").value = store.get("jobUrl", "");
$("jobUrl").addEventListener("input", () => store.set("jobUrl", $("jobUrl").value));
$("jobUrl").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); fetchJob(); } });

function resetJobState(){
  ignored = new Set(); store.set("ignored", []);
  aiState = {key:"", status:"idle"};
  for(const k of Object.keys(results)) delete results[k];
}
function newJob(){
  jobEl.value = ""; store.set("job", ""); $("jobUrl").value = ""; store.set("jobUrl", "");
  $("jobCompany").value = ""; store.set("jobCompany", "");
  setTitle("", "none"); showNote(""); resetJobState(); updJob(); recompute();
  setStatus("Ready for the next job."); showView("job"); jobEl.focus();
}
$("clearJob").addEventListener("click", newJob);

/* resume upload (PDF or text) */
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the PDF reader.")); document.head.appendChild(s); }); }
async function pdfText(file){
  if(!window.pdfjsLib){
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  }
  const pdf = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
  const pages = [];
  for(let i = 1; i <= pdf.numPages; i++){
    const c = await (await pdf.getPage(i)).getTextContent();
    let last = null, line = "";
    const out = [];
    for(const it of c.items){ const y = it.transform[5]; if(last !== null && Math.abs(y - last) > 2){ out.push(line); line = ""; } line += it.str; last = y; if(it.hasEOL){ out.push(line); line = ""; last = null; } }
    out.push(line); pages.push(out.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  return pages.join("\n\n");
}
$("resumeFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if(!f) return;
  setStatus(`Reading ${f.name}…`);
  try{
    const text = /\.pdf$/i.test(f.name) || f.type === "application/pdf" ? await pdfText(f) : await f.text();
    if(text.trim().length < 50) throw new Error("No text found in that file. If it's a scanned PDF, paste your resume text instead.");
    resumeEl.value = text.trim(); store.set("resume", resumeEl.value); updResume(); scheduleRecompute();
    setStatus(`Loaded ${f.name}. Check the text looks right.`);
  }catch(err){ setStatus(err.message, true); }
  e.target.value = "";
});

/* write into the resume box the way a user would, so counts, saving and the live score all update */
function writeResume(text, selStart, selEnd){
  resumeEl.value = text; store.set("resume", text); updResume(); scheduleRecompute();
  showView("resume"); resumeEl.focus();
  if(selStart != null){ resumeEl.setSelectionRange(selStart, selEnd ?? selStart); scrollToIndex(resumeEl, selStart); }
}
function scrollToIndex(ta, index){
  const line = ta.value.slice(0, index).split("\n").length - 1;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
}
