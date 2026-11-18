/* ---------- dialogs, command palette, theme, mobile panes ---------- */
let lastFocus = null;
function openDialog(id, focusId){
  lastFocus = document.activeElement; $(id).hidden = false;
  const el = focusId ? $(focusId) : $(id).querySelector("input,button,select,textarea"); el && el.focus();
}
function closeDialog(id){ $(id).hidden = true; if(lastFocus && lastFocus.isConnected) lastFocus.focus(); }
for(const id of ["palette", "cardModal"]) $(id).addEventListener("mousedown", e => { if(e.target === $(id)) closeDialog(id); });
function trapTab(e, root){
  const f = [...root.querySelectorAll("input,button,select,textarea,a[href]")].filter(x => !x.disabled && x.offsetParent !== null);
  if(!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}

/* theme: system / light / dark */
const THEMES = ["system", "light", "dark"];
let theme = store.get("theme", "system");
function applyTheme(){
  const r = document.documentElement;
  if(theme === "system") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", theme);
  $("themeIcon").textContent = {system:"Auto", light:"Light", dark:"Dark"}[theme]; $("themeBtn").title = "Theme: " + theme;
}
function cycleTheme(){ theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; store.set("theme", theme); applyTheme(); toast("Theme: " + theme); }
$("themeBtn").addEventListener("click", cycleTheme);

/* mobile: one pane at a time (on larger screens this only records the view) */
function showView(v){
  $("desk").dataset.view = v;
  $("mobileNav").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  if(matchMedia("(max-width: 760px)").matches) window.scrollTo({top:0});
}
$("mobileNav").addEventListener("click", e => { const b = e.target.closest("button"); if(b) showView(b.dataset.view); });

/* command palette */
let palItems = [], palIndex = 0;
function commands(){
  const c = [];
  TOOLS.forEach(t => c.push({label:`Open ${toolLabel(t.id)}`, hint:"Tool", run:() => openTool(t.id)}));
  c.push({label: active === "ats" ? "Run the AI review" : `Generate: ${toolLabel(active)}`, hint:(IS_MAC ? "Cmd" : "Ctrl") + " Enter", run:generate});
  c.push({label:"Save this job to the tracker", hint:"Tracker", run:saveCurrent});
  c.push({label:"Start a new job", hint:"Job", run:newJob});
  c.push({label:"Keep only the job description (trim pasted page)", hint:"Job", run:() => { showView("job"); trimJobText(false); }});
  c.push({label:"Fetch a job from a link", hint:"Job", run:() => { showView("job"); $("jobUrl").focus(); }});
  c.push({label:"Edit the job title", hint:"Job", run:() => { showView("job"); $("jobTitle").focus(); $("jobTitle").select(); }});
  c.push({label:"Edit my resume", hint:"Resume", run:() => { showView("resume"); resumeEl.focus(); }});
  c.push({label:"Upload a resume (PDF or text)", hint:"Resume", run:() => $("resumeFile").click()});
  c.push({label:"Copy the current result", hint:"Results", run:() => copyText(outputText())});
  c.push({label:"Go to the tracker board", hint:"Tracker", run:() => $("tracker").scrollIntoView({behavior:"smooth"})});
  c.push({label:"Add an application manually", hint:"Tracker", run:() => openCard(null)});
  c.push({label:"Copy the tracker as CSV", hint:"Tracker", run:() => $("csvBtn").click()});
  c.push({label:`Switch theme (now: ${theme})`, hint:"View", run:cycleTheme});
  if(ignored.size) c.push({label:`Bring back ${ignored.size} ignored skill${ignored.size === 1 ? "" : "s"}`, hint:"Score", run:() => restoreSkills([...ignored])});
  apps.map(a => ({a, d:dueInfo(a)})).filter(x => x.d && x.d.urgent).forEach(x => c.push({label:`Follow up: ${x.a.company || x.a.role} (${x.d.text})`, hint:"Reminder", run:() => openCard(x.a.id)}));
  return c;
}
function renderPal(){
  const q = $("palInput").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = commands();
  palItems = all.filter(c => q.every(t => c.label.toLowerCase().includes(t)))
    .sort((a, b) => (q.length ? a.label.toLowerCase().indexOf(q[0]) - b.label.toLowerCase().indexOf(q[0]) : 0));
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  $("palList").innerHTML = palItems.length ? palItems.map((c, i) => `<li role="option" id="pal-${i}" aria-selected="${i === palIndex}" data-i="${i}">${esc(c.label)}<small>${esc(c.hint)}</small></li>`).join("") : `<li role="option" aria-selected="false" style="cursor:default">No matching command</li>`;
  $("palInput").setAttribute("aria-activedescendant", palItems.length ? "pal-" + palIndex : "");
  const sel = $("palList").querySelector('[aria-selected="true"]'); if(sel) sel.scrollIntoView({block:"nearest"});
}
function openPalette(){ closeGap(false); $("palInput").value = ""; palIndex = 0; renderPal(); openDialog("palette", "palInput"); }
function runPal(i){ const it = palItems[i]; if(!it) return; closeDialog("palette"); setTimeout(it.run, 0); }
$("palInput").addEventListener("input", () => { palIndex = 0; renderPal(); });
$("palInput").addEventListener("keydown", e => {
  if(e.key === "ArrowDown"){ e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); renderPal(); }
  else if(e.key === "ArrowUp"){ e.preventDefault(); palIndex = Math.max(0, palIndex - 1); renderPal(); }
  else if(e.key === "Enter"){ e.preventDefault(); runPal(palIndex); }
});
$("palList").addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if(li) runPal(+li.dataset.i); });
$("paletteBtn").addEventListener("click", openPalette);

/* keyboard shortcuts */
document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if(mod && e.key.toLowerCase() === "k"){ e.preventDefault(); $("palette").hidden ? openPalette() : closeDialog("palette"); return; }
  if(mod && e.key === "Enter"){ e.preventDefault(); generate(); return; }
  if(e.key === "Escape"){
    if(!$("palette").hidden) closeDialog("palette");
    else if(!$("cardModal").hidden) closeDialog("cardModal");
    else closeGap(true);
  }
  if(e.key === "Tab"){ const dlg = [$("palette"), $("cardModal")].find(o => !o.hidden); if(dlg) trapTab(e, dlg); }
});
