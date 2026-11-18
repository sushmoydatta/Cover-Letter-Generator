/* ---------- click-to-fix: act on a skill gap straight from the report ---------- */
const pop = $("gapPop");
let popState = null;   // {names, sel, kind, tier, anchor}

function openGap(btn){
  const names = btn.dataset.gap.split("|");
  popState = {names, sel:names[0], kind:btn.dataset.kind, tier:btn.dataset.tier, anchor:btn};
  renderPop(); positionPop(btn);
  const first = pop.querySelector(".opt"); if(first) first.focus();
}
function renderPop(){
  const {names, sel, kind, tier} = popState;
  const why = {
    missing:`Not on your resume. It is ${tier === "must" ? "a must-have" : tier === "core" ? "central to the duties" : "a nice-to-have"} for this job.`,
    listed:"On your resume, but only in a skills list. Showing it in a bullet counts as proof.",
    related:"You have a related skill. Naming this one, if it is true, earns full credit.",
    proven:"Already proven in your experience."}[kind];
  const canAdd = kind === "missing" || kind === "related";
  pop.innerHTML = `<h4>${esc(names.join(" or "))}</h4><p class="why">${esc(why)}</p>
    ${canAdd || kind === "listed" ? `<p class="warn">Only add what is true.</p>` : ""}
    ${names.length > 1 ? `<div class="chips" role="group" aria-label="Which of these have you used?">${names.map(n => `<button class="chip2 ${n === sel ? "proven" : "add"}" data-pick="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
    ${canAdd ? `<button class="opt" data-fix="skill">Add “${esc(sel)}” to your Skills<small>One word in your Skills section</small></button>` : ""}
    ${kind !== "proven" ? `<button class="opt" data-fix="bullet">Add a bullet that shows ${esc(sel)}<small>A template you finish with your real result</small></button>` : `<button class="opt" data-fix="inresume">Find it in your resume</button>`}
    <button class="opt" data-fix="find">Show it in the job posting</button>
    <button class="opt" data-fix="ignore">Not for me: ignore for this job<small>Leaves ${names.length > 1 ? "these" : "it"} out of the score</small></button>`;
  pop.hidden = false;
}
function positionPop(el){
  pop.style.left = "0px"; pop.style.top = "0px";
  const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let y = r.bottom + 8; if(y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
  pop.style.left = x + "px"; pop.style.top = y + "px";
}
function closeGap(refocus){ if(pop.hidden) return; pop.hidden = true; if(refocus && popState && popState.anchor.isConnected) popState.anchor.focus(); popState = null; }

pop.addEventListener("click", e => {
  const pick = e.target.closest("[data-pick]");
  if(pick){ popState.sel = pick.dataset.pick; renderPop(); const a = popState.anchor; if(a.isConnected) positionPop(a); return; }
  const fix = e.target.closest("[data-fix]"); if(!fix) return;
  const {names, sel} = popState; closeGap(false);
  ({skill: () => addSkillToResume(sel), bullet: () => insertBulletTemplate(sel), find: () => findInPosting(names), inresume: () => findInResume(names), ignore: () => ignoreSkills(names)})[fix.dataset.fix]();
});
$("out").addEventListener("click", e => {
  const gap = e.target.closest("[data-gap]");
  if(gap){ if(popState && popState.anchor === gap) closeGap(); else openGap(gap); return; }
  const back = e.target.closest("[data-restore]");
  if(back) restoreSkills([back.dataset.restore]);
});
document.addEventListener("click", e => { if(!pop.hidden && !pop.contains(e.target) && !e.target.closest("[data-gap]")) closeGap(); });
/* the popover follows its chip when the pane scrolls or the report re-renders, and closes only if the chip is gone or out of view */
$("paneResults").querySelector(".scroll").addEventListener("scroll", () => {
  if(!popState || pop.hidden) return;
  const a = popState.anchor; if(!a.isConnected) return closeGap(false);
  const pr = $("paneResults").querySelector(".scroll").getBoundingClientRect(), ar = a.getBoundingClientRect();
  if(ar.bottom < pr.top || ar.top > pr.bottom) closeGap(false); else positionPop(a);
}, {passive:true});
addEventListener("resize", () => { if(popState && popState.anchor.isConnected) positionPop(popState.anchor); else closeGap(false); });
function rebindPop(){
  if(!popState || pop.hidden) return;
  const key = popState.names.join("|");
  const el = [...$("out").querySelectorAll("[data-gap]")].find(x => x.dataset.gap === key);
  if(el){ popState.anchor = el; positionPop(el); } else closeGap(false);
}

const HEADING_NEXT = /^\s*(experience|education|projects?|summary|certifications?|work experience|achievements|publications|awards)\b/i;
const BULLET_LINE = /^\s*[•●▪◦·*\-–]\s+/;

function addSkillToResume(name){
  const lines = resumeEl.value.split("\n");
  let i = -1, inline = false;
  for(let k = 0; k < lines.length; k++){
    const m = /^\s*(?:technical\s+|key\s+|core\s+)?(?:skills|technologies|tech stack)\s*(?::|-)?\s*(.*)$/i.exec(lines[k]);
    if(m && (!m[1] ? lines[k].trim().length < 40 : lines[k].includes(":"))){ i = k; inline = !!m[1]; break; }
  }
  let mi;
  if(i >= 0){
    if(inline){ lines[i] = lines[i].replace(/[\s,;]*$/, "") + ", " + name; mi = i; }
    else {
      let j = i + 1; while(j < lines.length && !lines[j].trim()) j++;
      if(j < lines.length && !HEADING_NEXT.test(lines[j]) && !BULLET_LINE.test(lines[j])){ lines[j] = lines[j].replace(/[\s,;]*$/, "") + ", " + name; mi = j; }
      else { lines.splice(i + 1, 0, name); mi = i + 1; }
    }
  } else { lines.push("", "Skills", name); mi = lines.length - 1; }
  const text = lines.join("\n");
  const lineStart = lines.slice(0, mi).join("\n").length + (mi ? 1 : 0);
  const start = text.lastIndexOf(name, lineStart + lines[mi].length);
  writeResume(text, start, start + name.length);
  toast(`Added ${name} to your Skills. Check that it is true.`);
}

function insertBulletTemplate(name){
  const lines = resumeEl.value.split("\n");
  const exp = lines.findIndex(l => /^\s*(?:work\s+|professional\s+)?(?:experience|employment)\b/i.test(l) && l.trim().length < 40);
  let at = lines.length, glyph = "•";
  if(exp >= 0){
    at = exp + 1;
    for(let j = exp + 1; j < lines.length; j++){
      if(BULLET_LINE.test(lines[j])){ at = j; glyph = lines[j].trim()[0]; break; }
      if(j > exp + 1 && HEADING_NEXT.test(lines[j]) && !/experience|employment/i.test(lines[j])){ break; }
    }
  } else lines.push("");
  const placeholder = "[Action verb]";
  const line = `${glyph} ${placeholder} ... using ${name} to ... [add your real result, e.g. a number]`;
  lines.splice(at, 0, line);
  const text = lines.join("\n");
  const start = lines.slice(0, at).join("\n").length + (at ? 1 : 0) + glyph.length + 1;
  writeResume(text, start, start + placeholder.length);
  toast(`Template added. Replace the brackets with what you really did.`);
}

function findInPosting(names){
  const m = ATS.skillMatches(jobEl.value, names)[0];
  if(!m){ toast(`The job text doesn't mention ${names[0]} by that name.`); return; }
  showView("job"); jobEl.focus(); jobEl.setSelectionRange(m.start, m.end); scrollToIndex(jobEl, m.start);
}
function findInResume(names){
  const m = ATS.skillMatches(resumeEl.value, names)[0];
  if(!m){ toast(`Couldn't find ${names[0]} in your resume.`); return; }
  showView("resume"); resumeEl.focus(); resumeEl.setSelectionRange(m.start, m.end); scrollToIndex(resumeEl, m.start);
}
function ignoreSkills(names){
  names.forEach(n => ignored.add(n)); store.set("ignored", [...ignored]); recompute();
  toast(`Ignoring ${names.join(" and ")} for this job.`, {label:"Undo", run: () => restoreSkills(names)});
}
function restoreSkills(names){
  names.forEach(n => ignored.delete(n)); store.set("ignored", [...ignored]); recompute();
}
