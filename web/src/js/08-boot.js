/* ---------- boot ---------- */
$("kbdHint").textContent = IS_MAC ? "⌘ K" : "Ctrl K";
document.querySelectorAll("footer .kbd").forEach(k => k.textContent = IS_MAC ? "⌘ K" : "Ctrl K");

$("jobTitle").value = store.get("jobTitle", "");
$("jobCompany").value = store.get("jobCompany", "");
if(!$("jobTitle").value.trim()){
  if(jobEl.value === EXAMPLE_JOB){ $("jobCompany").value = $("jobCompany").value || "Example Robotics"; setTitle(ATS.titleFromText(EXAMPLE_JOB), "detected"); }
  else deriveTitle();
}
titleBadge(); applyTheme(); showView("resume");
renderEngine(); renderTabs(); renderTracker(); recompute();
(async () => {
  if(window.claude && typeof window.claude.use === "function"){
    try{ claudeSample = await window.claude.use("sample"); }catch{ claudeSample = null; }
  }
  checkApi();
})();
