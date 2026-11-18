/*ATS_ENGINE*/
const PROMPTS = /*PROMPTS*/null;
const API_URL = /*API_URL*/"";

const EXAMPLE_RESUME = `Alex Rivera
alex.rivera@example.com | linkedin.com/in/alex-rivera-example

EDUCATION
M.Tech, Electronics & Communication Engineering, Example Institute of Technology (2024 - present)
B.Tech, Electronics & Communication Engineering, Example University (2018 - 2022)

SKILLS
Python, SQL, C/C++, Verilog, MATLAB, scikit-learn, PyTorch, Xilinx Vivado, Git

EXPERIENCE
Teaching Assistant, Basic Electronics Lab (2024 - present)
- Supervised weekly lab sessions for 60+ undergraduates; wrote troubleshooting guides.
Business Development Intern, Example Corp (2023)
- Researched 200+ prospective B2B clients; built a lead-scoring spreadsheet used by sales.

PROJECTS
- Online learning for IRS element selection (thesis): FTRL and FTPL bandit algorithms in Python; lower regret than a greedy baseline in simulation.
- MIPS32 processor: 5-stage pipelined CPU in Verilog, verified on an FPGA.`;

const EXAMPLE_JOB = `Machine Learning Engineer, Graduate (Example Robotics, Bengaluru)

About the role: You'll build and deploy models that help our warehouse robots plan routes and detect obstacles.

Requirements:
- Degree in CS, ECE or a related field (Master's preferred)
- Strong Python; experience with PyTorch or TensorFlow
- Solid grasp of ML fundamentals, including online / reinforcement learning
- Familiarity with embedded or FPGA deployment is a plus
- Experience with Docker and cloud (AWS/GCP)
- Clear written communication`;

/* ---------- helpers ---------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem("jah:"+k); return v===null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem("jah:"+k, JSON.stringify(v)); }catch{} },
  del(k){ try{ localStorage.removeItem("jah:"+k); }catch{} }
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = v => Array.isArray(v) ? v.map(x => String(x)).slice(0, 15) : [];
const hashStr = t => { let h = 5381; for(let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return String(h); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const todayStr = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

/* ---------- AI engine ----------
   On claude.ai the page uses the visitor's own Claude account. Everywhere else it calls the Job Apply Helper
   API (a Cloudflare Worker that holds the key), so visitors never need an API key. */
let claudeSample = null;
let apiOk = null;   // null = checking, true/false after the health check

function engineReady(){ return !!claudeSample || apiOk === true; }

function renderEngine(){
  const dot = $("engineDot"), txt = $("engineText");
  if(claudeSample){
    dot.className = "dot on"; txt.innerHTML = 'Ready<span class="long"> · your Claude account</span>';
    $("urlRow").hidden = true;
  } else if(apiOk === true){ dot.className = "dot on"; txt.innerHTML = 'Ready<span class="long"> · free to use</span>'; }
  else if(apiOk === false){ dot.className = "dot off"; txt.textContent = "AI offline"; }
  else { dot.className = "dot"; txt.textContent = "Connecting…"; }
}

async function checkApi(){
  if(claudeSample || !API_URL){ if(!API_URL && !claudeSample) apiOk = false; renderEngine(); return; }
  try{
    const r = await fetch(API_URL + "/health", {cache:"no-store"});
    apiOk = r.ok && (await r.json()).configured === true;
  }catch{ apiOk = false; }
  renderEngine();
}

async function readSSE(resp, onText){
  const reader = resp.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "";
  for(;;){
    const {value, done} = await reader.read(); if(done) break;
    buf += dec.decode(value, {stream:true});
    const lines = buf.split("\n"); buf = lines.pop();
    for(const line of lines){
      const l = line.trim(); if(!l.startsWith("data:")) continue;
      const data = l.slice(5).trim(); if(data === "[DONE]") continue;
      try{ const d = JSON.parse(data).choices?.[0]?.delta?.content; if(d){ text += d; onText && onText(text); } }catch{}
    }
  }
  return text.trim();
}

/* req = {task, resume, job, style?, contact?, question?, focus?} */
async function callAI(req, {onText, signal} = {}){
  if(claudeSample){
    const t = PROMPTS.tasks[req.task];
    let extra = "";
    if(req.task === "letter") extra = PROMPTS.letter_styles[req.style] || PROMPTS.letter_styles.professional;
    if(req.task === "outreach" && req.contact) extra = `The recipient is: ${req.contact}.`;
    if(req.task === "answer") extra = req.question;
    if(req.task === "rewrite" || req.task === "gapplan") extra = req.focus;
    const user = t.prompt.replaceAll("{extra}", extra).replaceAll("{resume}", req.resume).replaceAll("{job}", req.job);
    const res = await claudeSample(`${PROMPTS.system}\n\n${user}`, {onText: ({text}) => onText && onText(text), signal, modelTier:"default", cache:false});
    return res.text;
  }
  if(!API_URL) throw new Error("The AI service isn't connected yet. Please check back soon.");
  const resp = await fetch(API_URL + "/generate", {method:"POST", signal, headers:{"Content-Type":"application/json"}, body: JSON.stringify(req)});
  if(!resp.ok){
    let msg = ""; try{ msg = (await resp.json()).error; }catch{}
    throw new Error(msg || `The AI service returned an error (${resp.status}). Please try again.`);
  }
  apiOk = true; renderEngine();
  return readSSE(resp, onText);
}

function parseJSON(text){
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  try{ return JSON.parse(t); }catch{}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a !== -1 && b > a){ try{ return JSON.parse(t.slice(a, b+1)); }catch{} }
  throw new Error("The model's reply wasn't valid JSON. Press Generate again.");
}

function friendly(e){
  const map = {not_granted:"Claude access wasn't allowed for this page. You can allow it from the page's permissions menu.",
    rate_limited:"You've hit a usage limit. Wait a bit and try again.", prompt_too_large:"The resume or posting is too long. Trim it and retry.",
    refused:"Claude declined this request. Try rewording the inputs.", session_expired:"Your session expired. Reload the page and sign in."};
  if(e && e.code && map[e.code]) return map[e.code];
  if(e instanceof TypeError && /fetch/i.test(e.message)) return "Couldn't reach the AI service. Check your internet connection and try again.";
  return (e && e.message) || "Something went wrong. Try again.";
}

function setStatus(msg, err){ const s = $("status"); s.textContent = msg; s.classList.toggle("err", !!err); }

let toastTimer;
function toast(msg, action){
  const t = $("toast"); t.textContent = msg;
  if(action){ const b = document.createElement("button"); b.textContent = action.label; b.className = "btn small"; b.style.marginLeft = "10px"; b.onclick = () => { action.run(); t.classList.remove("show"); }; t.appendChild(b); t.style.pointerEvents = "auto"; }
  else t.style.pointerEvents = "none";
  t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), action ? 7000 : 3200);
}
