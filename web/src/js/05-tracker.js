/* ---------- Kanban tracker ---------- */
const STATUSES = ["Saved","Applied","Interviewing","Offer","Rejected"];
const newId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const normaliseApp = a => ({id:a.id || newId(), company:a.company || "", role:a.role || "", score:a.score ?? null, date:a.date || todayStr(),
  status:STATUSES.includes(a.status) ? a.status : "Saved", url:a.url || "", notes:a.notes || "", followUp:a.followUp || ""});
let apps = store.get("apps", []).map(normaliseApp);
let editingId = null;
const saveApps = () => store.set("apps", apps);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return todayStr(d); };
const daysFromToday = s => Math.round((new Date(s + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000);
const scoreTone = s => s >= 70 ? "good" : s >= 55 ? "warn" : "bad";

function dueInfo(a){
  if(!a.followUp || !["Applied","Interviewing"].includes(a.status)) return null;
  const n = daysFromToday(a.followUp);
  if(n < 0) return {cls:"late", text:`Overdue ${-n}d`, urgent:true};
  if(n === 0) return {cls:"soon", text:"Follow up today", urgent:true};
  if(n <= 2) return {cls:"soon", text:`Follow up in ${n}d`, urgent:true};
  return {cls:"", text:`Follow up ${a.followUp.slice(5)}`, urgent:false};
}

function renderTracker(){
  $("trackEmpty").hidden = apps.length > 0;
  $("board").hidden = apps.length === 0;
  $("board").innerHTML = STATUSES.map(st => {
    const items = apps.filter(a => a.status === st);
    return `<div class="kcol" data-status="${st}" role="group" aria-label="${st}, ${items.length} application${items.length === 1 ? "" : "s"}">
      <h3>${st} <span>${items.length}</span></h3>
      ${items.map(cardHTML).join("") || `<p class="none">Drop a card here</p>`}</div>`;
  }).join("");
  const due = apps.map(a => ({a, d:dueInfo(a)})).filter(x => x.d && x.d.urgent);
  $("dueStrip").hidden = !due.length;
  $("dueStrip").innerHTML = due.length ? `<b>Follow-ups:</b> ${due.map(x => `<button data-open="${x.a.id}">${esc(x.a.company || x.a.role)} · ${x.d.text}</button>`).join("")}` : "";
  renderPace();
}
function cardHTML(a){
  const d = dueInfo(a);
  return `<article class="kcard" draggable="true" data-id="${a.id}" tabindex="0" role="button" aria-label="Open ${esc(a.company || a.role)}">
    <div class="c-top"><b>${esc(a.company || "No company")}</b>${a.score != null ? `<span class="pill ${scoreTone(a.score)}">${a.score}</span>` : ""}</div>
    <div class="c-role">${esc(a.role || "No position")}</div>
    <div class="c-meta"><span>${esc(a.date.slice(5))}</span>${d ? `<span class="due-chip ${d.cls}">${d.text}</span>` : ""}${a.notes ? `<span title="${esc(a.notes)}">note</span>` : ""}</div>
    <select data-move aria-label="Move ${esc(a.company || a.role)} to">${STATUSES.map(s => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}</select></article>`;
}

function renderPace(){
  const days = [];
  for(let i = 6; i >= 0; i--){ const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const keys = days.map(d => todayStr(d)), n = apps.filter(a => keys.includes(a.date)).length;
  $("paceCount").textContent = `${n} application${n === 1 ? "" : "s"} this week`;
  $("paceWeek").innerHTML = days.map((d, i) => `<div><i class="${apps.some(a => a.date === keys[i]) ? "on" : ""} ${i === 6 ? "today" : ""}" title="${keys[i]}"></i>${d.toLocaleDateString(undefined, {weekday:"narrow"})}</div>`).join("");
  $("paceNote").textContent = n === 0 ? "A fresh week. One thoughtful application beats ten rushed ones." : n <= 2 ? "Good start. Keep it steady." : n <= 6 ? "Nice, steady pace this week." : "Strong week! Remember to rest too.";
}

function moveCard(id, status){
  const a = apps.find(x => x.id === id); if(!a || a.status === status) return;
  const was = a.status; a.status = status;
  if(status === "Applied" && !a.followUp) a.followUp = addDays(7);
  if(["Offer","Rejected","Saved"].includes(status)) a.followUp = status === "Saved" ? a.followUp : "";
  saveApps(); renderTracker();
  if(status === "Offer" && was !== "Offer"){ celebrate(); toast(`Congratulations on the offer${a.company ? " from " + a.company : ""}!`); }
  else if(status === "Interviewing") toast("An interview! Open Interview prep to get ready.");
  else if(status === "Applied") toast(`Marked applied. We'll remind you to follow up on ${a.followUp.slice(5)}.`);
  else if(status === "Rejected") toast("Their loss. Every application is practice for the next one.");
}

/* drag and drop (desktop) + Move menu (touch and keyboard) + click to open */
const board = $("board");
let dragId = null;
board.addEventListener("dragstart", e => { const c = e.target.closest(".kcard"); if(!c) return; dragId = c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
board.addEventListener("dragend", () => { dragId = null; board.querySelectorAll(".dragging,.over").forEach(n => n.classList.remove("dragging", "over")); });
board.addEventListener("dragover", e => { const col = e.target.closest(".kcol"); if(!col || !dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; board.querySelectorAll(".over").forEach(n => n !== col && n.classList.remove("over")); col.classList.add("over"); });
board.addEventListener("drop", e => { const col = e.target.closest(".kcol"); if(!col) return; e.preventDefault(); const id = dragId || e.dataTransfer.getData("text/plain"); dragId = null; moveCard(id, col.dataset.status); });
board.addEventListener("change", e => { const s = e.target.closest("[data-move]"); if(s) moveCard(s.closest(".kcard").dataset.id, s.value); });
board.addEventListener("click", e => { if(e.target.closest("select")) return; const c = e.target.closest(".kcard"); if(c) openCard(c.dataset.id); });
board.addEventListener("keydown", e => { if((e.key === "Enter" || e.key === " ") && e.target.classList.contains("kcard")){ e.preventDefault(); openCard(e.target.dataset.id); } });
$("dueStrip").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if(b) openCard(b.dataset.open); });

/* card editor */
function openCard(id){
  editingId = id;
  const a = id ? apps.find(x => x.id === id) : {company:"", role:"", status:"Saved", url:"", notes:"", followUp:""};
  $("cardHeading").textContent = id ? "Edit application" : "Add an application";
  $("cfStatus").innerHTML = STATUSES.map(s => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("");
  $("cfCompany").value = a.company; $("cfRole").value = a.role; $("cfUrl").value = a.url; $("cfNotes").value = a.notes; $("cfFollow").value = a.followUp;
  $("cfDelete").hidden = !id; $("cfDelete").textContent = "Delete";
  openDialog("cardModal", "cfCompany");
}
$("cardForm").addEventListener("submit", e => {
  e.preventDefault();
  const role = $("cfRole").value.trim();
  if(!role){ $("cfRole").focus(); return; }
  const vals = {company:$("cfCompany").value.trim(), role, status:$("cfStatus").value, url:$("cfUrl").value.trim(), notes:$("cfNotes").value.trim(), followUp:$("cfFollow").value};
  if(editingId){ Object.assign(apps.find(x => x.id === editingId), vals); }
  else apps.unshift(normaliseApp({...vals, date:todayStr(), score:null}));
  if(vals.status === "Applied" && !vals.followUp){ const a = editingId ? apps.find(x => x.id === editingId) : apps[0]; a.followUp = addDays(7); }
  saveApps(); renderTracker(); closeDialog("cardModal"); toast("Saved.");
});
$("cfCancel").addEventListener("click", () => closeDialog("cardModal"));
let delTimer;
$("cfDelete").addEventListener("click", () => {
  const b = $("cfDelete");
  if(b.dataset.armed){ apps = apps.filter(x => x.id !== editingId); saveApps(); renderTracker(); closeDialog("cardModal"); toast("Deleted."); delete b.dataset.armed; return; }
  b.dataset.armed = "1"; b.textContent = "Click again to delete"; clearTimeout(delTimer); delTimer = setTimeout(() => { delete b.dataset.armed; b.textContent = "Delete"; }, 3000);
});
$("addCard").addEventListener("click", () => openCard(null));

/* save the current job from the workbench; the job position is mandatory */
function saveCurrent(){
  if(!report) recompute();
  if(!report){ toast("Add your resume and the job first."); return; }
  const title = currentTitle();
  if(!title){ showView("job"); $("jobTitle").focus(); toast("Add the job title first. Every saved application needs the position name."); return; }
  const jd = aiState.key === aiKey() ? aiState.jd : null;
  const company = currentCompany() || jd?.company || "";
  const url = $("jobUrl").value.trim();
  const existing = apps.find(a => a.role === title && a.company === company && a.status === "Saved");
  if(existing){ existing.score = report.score; existing.url = url || existing.url; existing.date = todayStr(); saveApps(); renderTracker(); toast("Updated the saved score."); return; }
  apps.unshift(normaliseApp({role:title, company, score:report.score, date:todayStr(), status:"Saved", url}));
  saveApps(); renderTracker(); toast("Saved to your tracker.", {label:"View", run: () => $("tracker").scrollIntoView({behavior:"smooth"})});
}
$("saveBtn").addEventListener("click", saveCurrent);
$("csvBtn").addEventListener("click", e => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Company","Position","Score","Saved","Status","Follow up","Link","Notes"], ...apps.map(a => [a.company, a.role, a.score ?? "", a.date, a.status, a.followUp, a.url, a.notes])];
  copyText(apps.length ? rows.map(r => r.map(q).join(",")).join("\n") : "", e.currentTarget);
});

function celebrate(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("confetti"), ctx = cv.getContext("2d"), dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const cols = ["--accent","--hl-strong","--pencil","--pen"].map(v => css.getPropertyValue(v).trim());
  const P = Array.from({length: 120}, () => ({x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .55, vx: (Math.random() - .5) * 11, vy: -Math.random() * 13 - 5,
    r: Math.random() * 6 + 3, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: cols[Math.random() * cols.length | 0]}));
  const t0 = performance.now();
  (function step(now){
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for(const p of P){ p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); }
    if(now - t0 < 2600) requestAnimationFrame(step); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}
