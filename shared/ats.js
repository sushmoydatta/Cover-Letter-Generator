/**
 * Job Apply Helper: deterministic ATS / recruiter scoring engine.
 *
 * No dependencies, no network. The same file runs in the Cloudflare Worker, in the browser
 * (inlined by scripts/build_web.py) and in Node tests, so a score is identical everywhere and
 * can update live while the user edits their resume.
 *
 * Important: real ATS products (Workday, Greenhouse, Lever, Taleo...) do not publish a score.
 * This is an "ATS readiness estimate" built from the signals they and recruiters actually use:
 * parseable structure, keyword and skill coverage (with evidence of use), title and seniority fit,
 * years of experience, education, and the quality of the bullet points.
 * Every point it awards or withholds is explained, so the number is never a black box.
 */

/* ------------------------------------------------------------------ skills taxonomy */
// "Canonical|category|alias,alias". A leading "~" means the canonical word is too ambiguous to match
// on its own (e.g. "Go", "R", "C"), so only the aliases are matched.
import { cleanTitle, titleFromText } from "./jobextract.js";

const SKILL_DEFS = `
Python|lang|py,python3
Java|lang|
JavaScript|lang|js,ecmascript,es6
TypeScript|lang|ts
C++|lang|cpp,c/c++
~C|lang|c programming,embedded c,ansi c
C#|lang|csharp,c sharp,.net,dotnet
~Go|lang|golang,go language
Rust|lang|
SQL|data|t-sql,pl/sql,plsql,sql queries
Bash|lang|shell scripting,shell script,bash scripting
MATLAB|lang|simulink
~R|lang|r programming,rstudio,r language
Scala|lang|
Kotlin|lang|
Swift|lang|
PHP|lang|
Ruby|lang|ruby on rails,rails
TCL|lang|tcl/tk
HTML|web|html5
CSS|web|css3,sass,scss
React|web|reactjs,react.js
Angular|web|angularjs
Vue|web|vuejs,vue.js
Node.js|web|nodejs,node js
Next.js|web|nextjs
FastAPI|web|
Flask|web|
Django|web|
Spring Boot|web|spring framework,springboot
REST APIs|web|rest api,restful,rest apis,restful apis,rest services
GraphQL|web|
Microservices|web|micro-services,microservice
System Design|web|distributed systems,scalable systems
Machine Learning|ml|ml,machine-learning
Deep Learning|ml|neural networks,neural network,cnn,rnn,lstm,transformers
NLP|ml|natural language processing,text mining
Computer Vision|ml|image processing,object detection,opencv
Reinforcement Learning|ml|bandits,bandit algorithms,multi-armed bandit
Online Learning|ml|online machine learning,ftrl,ftpl
Generative AI|ml|genai,gen ai,generative ai
LLM|ml|llms,large language models,large language model
RAG|ml|retrieval augmented generation,retrieval-augmented generation
Prompt Engineering|ml|prompt design
PyTorch|ml|torch
TensorFlow|ml|tf
Keras|ml|
scikit-learn|ml|sklearn,scikit learn
Pandas|data|
NumPy|data|
SciPy|data|
Statistics|data|statistical analysis,statistical modeling,statistical modelling,hypothesis testing
Data Analysis|data|data analytics,analytics,exploratory data analysis,eda
Data Visualization|data|data visualisation,dashboards,dashboarding
Feature Engineering|ml|
Time Series|ml|time-series,forecasting
Anomaly Detection|ml|outlier detection
Clustering|ml|k-means,kmeans,unsupervised learning
A/B Testing|data|ab testing,a/b tests,experimentation
Tableau|data|
Power BI|data|powerbi
Excel|data|microsoft excel,ms excel,advanced excel
Spark|data|pyspark,apache spark
Hadoop|data|hdfs,mapreduce
Kafka|data|apache kafka
Airflow|data|apache airflow
dbt|data|
ETL|data|data pipelines,data pipeline,elt
Data Engineering|data|data warehouse,data warehousing,data modeling
MLOps|ml|ml ops,model deployment,model serving
AWS|cloud|amazon web services,ec2,s3,lambda
GCP|cloud|google cloud,google cloud platform,bigquery
Azure|cloud|microsoft azure
Docker|cloud|containers,containerization,containerisation
Kubernetes|cloud|k8s
Terraform|cloud|infrastructure as code,iac
Ansible|cloud|
CI/CD|cloud|cicd,continuous integration,continuous delivery,continuous deployment
Jenkins|cloud|
GitHub Actions|cloud|
Git|cloud|github,gitlab,version control
Linux|cloud|unix
PostgreSQL|data|postgres
MySQL|data|
MongoDB|data|nosql
Redis|data|
Elasticsearch|data|elk,opensearch
VLSI|hw|vlsi design,chip design
Verilog|hw|
SystemVerilog|hw|system verilog
VHDL|hw|
FPGA|hw|fpgas,xilinx,altera
ASIC|hw|
RTL Design|hw|rtl,rtl coding
Digital Design|hw|digital circuit design,digital logic,digital electronics
Analog Design|hw|analog circuit design,analog ic design,analog circuits
Cadence Virtuoso|hw|virtuoso,cadence
Xilinx Vivado|hw|vivado
Synopsys|hw|design compiler,primetime
Static Timing Analysis|hw|sta,timing closure
Physical Design|hw|place and route,floorplanning
Design Verification|hw|uvm,functional verification,testbench
SPICE|hw|ltspice,hspice,spectre
Embedded Systems|hw|embedded software,firmware,embedded programming
Microcontrollers|hw|stm32,arduino,arm cortex,esp32
RTOS|hw|freertos,real-time operating system
Signal Processing|hw|dsp,digital signal processing
PCB Design|hw|altium,kicad,pcb layout
Telecom|telecom|telecommunications,telecommunication
4G/LTE|telecom|lte,4g
5G|telecom|5g nr,5g core,nr
RAN|telecom|radio access network,ran optimization
Core Network|telecom|epc,5gc
Network Analytics|telecom|network performance analysis,network data analysis
Root Cause Analysis|telecom|rca,root-cause analysis,root cause
Alarm Management|telecom|fault management,alarm correlation,alarm analysis
OSS/BSS|telecom|oss,bss
Network Optimization|telecom|network optimisation,network planning
Spectrum Management|telecom|spectrum
KPI Analysis|telecom|kpi,kpis,performance monitoring
TCP/IP|telecom|tcp ip,networking fundamentals,computer networks
BGP|telecom|ospf,mpls
Network Automation|telecom|netconf,yang,network programmability
Wireshark|telecom|packet analysis,packet capture
Project Management|biz|project planning,program management
Agile|biz|scrum,kanban,sprint
Jira|biz|confluence
Product Management|biz|product roadmap,roadmapping,product strategy
Business Analysis|biz|requirements gathering,business requirements
Business Development|biz|b2b sales,lead generation,sales development
Market Research|biz|competitive analysis,market analysis
CRM|biz|salesforce,hubspot
Technical Writing|biz|documentation
Stakeholder Management|soft|stakeholder engagement,stakeholder communication
Leadership|soft|team lead,led a team,people management
Mentoring|soft|coaching,mentorship
Teaching|soft|teaching assistant,instructor,tutoring
Presentation|soft|public speaking,presentations
Collaboration|soft|cross-functional,cross functional,teamwork
Problem Solving|soft|analytical thinking,analytical skills,critical thinking
`;

// Skills that substitute for one another. A related skill earns partial credit and a tailored tip.
const RELATED_GROUPS = [
  ["PyTorch", "TensorFlow", "Keras"],
  ["AWS", "GCP", "Azure"],
  ["PostgreSQL", "MySQL", "SQL"],
  ["React", "Angular", "Vue"],
  ["Tableau", "Power BI"],
  ["Verilog", "VHDL", "SystemVerilog"],
  ["Machine Learning", "Deep Learning", "Online Learning", "Reinforcement Learning"],
  ["Docker", "Kubernetes"],
  ["Spark", "Hadoop", "Kafka"],
  ["Network Analytics", "KPI Analysis", "Root Cause Analysis", "Data Analysis"],
  ["Cadence Virtuoso", "SPICE", "Analog Design"],
  ["Embedded Systems", "Microcontrollers", "RTOS"],
  ["Flask", "FastAPI", "Django"],
];

const SOFT_WEIGHT = 0.5; // soft skills count half as much as hard skills

const SKILLS = SKILL_DEFS.trim().split("\n").map((line) => {
  const [rawName, category, aliasStr] = line.split("|");
  const skipCanonical = rawName.startsWith("~");
  const name = skipCanonical ? rawName.slice(1) : rawName;
  const terms = [...(skipCanonical ? [] : [name]), ...(aliasStr ? aliasStr.split(",") : [])].filter(Boolean);
  const esc = terms
    .sort((a, b) => b.length - a.length)
    .map((t) => t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+"));
  const re = new RegExp(`(?<![A-Za-z0-9+#])(?:${esc.join("|")})(?![A-Za-z0-9+#])`, "gi");
  return { name, category, re };
});
const SKILL_BY_NAME = new Map(SKILLS.map((s) => [s.name, s]));

/** Count occurrences of every known skill in `text`. Returns Map(skillName -> count). */
export function findSkills(text) {
  const found = new Map();
  for (const s of SKILLS) {
    s.re.lastIndex = 0;
    const n = (String(text).match(s.re) || []).length;
    if (n) found.set(s.name, n);
  }
  return found;
}

/** Like findSkills but returns positions, so "AWS or GCP" can be recognised as alternatives. */
function skillSpans(text) {
  const spans = [];
  for (const s of SKILLS) {
    s.re.lastIndex = 0;
    for (const m of String(text).matchAll(s.re)) spans.push({ name: s.name, start: m.index, end: m.index + m[0].length });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ small helpers */
const STOP = new Set(
  `a an the and or of to in on for with at by from as is are was were be been being this that these those it its you your we our they their will can could should would may might must have has had do does did not no yes if then than so such about into over under per via etc eg ie including include includes within across among between using use used while also more most other any all each both few many much some own same only very just able ability looking seeking join team teams work working role roles job company position candidate candidates experience experienced years year strong good great excellent knowledge understanding skills skill required requirements preferred plus bonus responsibilities responsible duties qualifications minimum degree related field etc new help build building develop developing ensure support provide providing opportunity opportunities environment business world who what where when how why what's we're you'll`.split(/\s+/),
);
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const MONTH_IDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;
const words = (s) => (String(s).match(/[A-Za-z0-9][A-Za-z0-9+#./'-]*/g) || []);

/* ------------------------------------------------------------------ resume parsing */
const SECTION_HEADS = {
  summary: /^(professional\s+)?(summary|profile|objective|about(\s+me)?)$/i,
  experience: /^(work\s+|professional\s+|relevant\s+|industry\s+)?(experience|employment(\s+history)?|work\s+history|internships?)$/i,
  education: /^(education|academic(\s+background|\s+qualifications)?|qualifications)$/i,
  skills: /^(technical\s+|key\s+|core\s+)?(skills|competencies|technologies|tech\s+stack|skills\s*(&|and)\s*tools|tools\s*(&|and)\s*technologies)$/i,
  projects: /^(academic\s+|personal\s+|key\s+|selected\s+)?(projects|research(\s*(&|and)\s*projects)?|publications)$/i,
  extras: /^(certifications?|licen[sc]es|courses|training|achievements|awards|honou?rs|leadership|activities|volunteering)$/i,
};
const BULLET_RE = /^\s*(?:[•●▪◦·‣∙*]|[-–—](?=\s)|\d{1,2}[.)](?=\s))\s*/;
const DATE_RANGE_RE = new RegExp(
  `((?:${MONTHS})[a-z]*\\.?,?\\s+)?((?:19|20)\\d{2})\\s*(?:-|–|—|to|until)\\s*(?:((?:${MONTHS})[a-z]*\\.?,?\\s+)?((?:19|20)\\d{2})|(present|current|now|ongoing|till\\s+date|today))`,
  "gi",
);
// Built from char codes so the source stays plain ASCII: private-use icon glyphs, the replacement char, stray Latin-extended letters and symbols.
const cc = (n) => String.fromCharCode(n);
const GARBLED_RE = new RegExp("[" + cc(0xE000) + "-" + cc(0xF8FF) + cc(0xFFFD) + "]|(?:^|\\s)[" + cc(0x100) + "-" + cc(0x24F) + cc(0xA7) + cc(0xB6) + cc(0xAC) + cc(0xA6) + "](?=\\s)", "g");

function headingOf(line) {
  const t = line.trim().replace(/[:：]+$/, "").replace(/^[#*_\s-]+|[*_\s-]+$/g, "");
  if (!t || t.length > 42 || /[.,;@]|\d{3,}/.test(t) || t.split(/\s+/).length > 5) return null;
  for (const [key, re] of Object.entries(SECTION_HEADS)) if (re.test(t)) return key;
  return null;
}

function toMonthIndex(monthStr, year, fallbackMonth) {
  const m = monthStr ? MONTH_IDX[monthStr.trim().toLowerCase().slice(0, 3)] : undefined;
  return year * 12 + (m === undefined ? fallbackMonth : m);
}

/** Merge date ranges found in `text` and return total months (overlaps counted once). */
export function monthsOfExperience(text, now = new Date()) {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const spans = [];
  for (const m of String(text).matchAll(DATE_RANGE_RE)) {
    const start = toMonthIndex(m[1], +m[2], 0);
    const end = m[5] ? nowIdx : toMonthIndex(m[3], +m[4], 0);
    if (end >= start && start <= nowIdx + 1) spans.push([start, Math.max(end, start + (end === start ? 6 : 0))]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, curS = null, curE = null;
  for (const [s, e] of spans) {
    if (curS === null) { curS = s; curE = e; }
    else if (s <= curE) curE = Math.max(curE, e);
    else { total += curE - curS; curS = s; curE = e; }
  }
  if (curS !== null) total += curE - curS;
  return total;
}

function extractBullets(lines) {
  const bullets = [];
  let open = false;
  let sawGlyph = lines.some((l) => BULLET_RE.test(l) && l.trim().length > 12);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { open = false; continue; }
    if (BULLET_RE.test(raw) && sawGlyph) {
      bullets.push(line.replace(BULLET_RE, "").trim());
      open = true;
    } else if (sawGlyph && open && !headingOf(line) && (/^[a-z0-9(]/.test(line) || /(,|\band|\bor|\bwith|\bto|\bof|\bfor|\bthe|\ba|\bin|\bon|\bby)$/i.test(bullets[bullets.length - 1]))) {
      bullets[bullets.length - 1] += " " + line; // wrapped line from a PDF
    } else if (!sawGlyph && words(line).length >= 8 && !DATE_RANGE_RE.test(line)) {
      bullets.push(line);
      DATE_RANGE_RE.lastIndex = 0;
    } else open = false;
    DATE_RANGE_RE.lastIndex = 0;
  }
  return bullets.filter((b) => b.length > 12);
}

const DEGREE_LEVELS = [
  [4, /\b(ph\.?\s?d|doctorate|doctoral)\b/i, "PhD"],
  [3, /\b(master'?s?|m\.?\s?tech|m\.?\s?sc|m\.?\s?eng|m\.?\s?e\b|mba|m\.?\s?s\b\.?)(?=[\s,.)\-–—]|$)/i, "Master's"],
  [2, /\b(bachelor'?s?|b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?eng|b\.?\s?s\b\.?|undergraduate|b\.?\s?a\b)(?=[\s,.)\-–—]|$)/i, "Bachelor's"],
  [1, /\b(diploma|associate'?s?\s+degree)\b/i, "Diploma"],
];
function degreeLevel(text) {
  let best = [0, "None"];
  for (const [lvl, re, label] of DEGREE_LEVELS) if (re.test(text) && lvl > best[0]) best = [lvl, label];
  return best;
}

export function parseResume(text, now = new Date()) {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw.split("\n");
  const secLines = { header: [] };
  const present = {};
  let cur = "header";
  for (const line of lines) {
    const h = headingOf(line);
    if (h) { cur = h; present[h] = true; (secLines[cur] ||= []); continue; }
    (secLines[cur] ||= []).push(line);
  }
  const sec = (k) => (secLines[k] || []).join("\n");
  const expText = sec("experience");
  const workLines = [...(secLines.experience || []), ...(secLines.projects || [])];
  const bullets = [
    ...extractBullets(secLines.experience || []).map((text) => ({ text, section: "experience" })),
    ...extractBullets(secLines.projects || []).map((text) => ({ text, section: "projects" })),
  ];
  // If the resume has no recognisable sections, treat every bullet-like line as a bullet.
  if (!bullets.length) extractBullets(lines).forEach((text) => bullets.push({ text, section: "other" }));

  const head = lines.filter((l) => l.trim()).slice(0, 6).join(" ");
  const email = (raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || "";
  const phone = (raw.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,5}(?!\d)/g) || []).find((p) => p.replace(/\D/g, "").length >= 9) || "";
  const linkedin = (raw.match(/linkedin\.com\/in\/[\w-]+/i) || [])[0] || "";
  const github = (raw.match(/github\.com\/[\w-]+/i) || [])[0] || "";
  const website = (raw.match(/(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:dev|io|me|com|net|github\.io)\/?\S*/i) || [])[0] || "";

  const expMonths = monthsOfExperience(expText || raw.replace(sec("education"), ""), now);
  const [eduLevel, eduLabel] = degreeLevel(sec("education") || raw);
  const garbled = (raw.match(GARBLED_RE) || []).length;
  const firstPerson = bullets.filter((b) => /(^|[\s,;])(I|my|me)(?=[\s,.;])/.test(b.text)).length;

  return {
    name: (lines.find((l) => l.trim()) || "").trim().slice(0, 60),
    contact: { email, phone, linkedin, github, website: website && !email.includes(website) ? website : "" },
    sections: present,
    text: raw,
    sectionText: { experience: expText, projects: sec("projects"), skills: sec("skills"), education: sec("education"), summary: sec("summary") },
    head,
    bullets,
    wordCount: words(raw).length,
    years: round1(expMonths / 12),
    degree: { level: eduLevel, label: eduLabel },
    datedRoles: [...expText.matchAll(DATE_RANGE_RE)].length,
    garbled,
    firstPerson,
  };
}

/* ------------------------------------------------------------------ job posting parsing */
const NICE_RE = /\b(preferred|nice[\s-]to[\s-]have|good[\s-]to[\s-]have|bonus|a plus|is a plus|are a plus|desirable|desired|ideally|advantage|familiarity with|exposure to)\b/i;
const MUST_HEAD_RE = /\b(requirements?|qualifications?|minimum|must[\s-]have|what you('|’)ll need|what we('|’)re looking for|you have|you bring|about you|skills)\b/i;
const DUTY_HEAD_RE = /\b(responsibilities|what you('|’)ll do|duties|the role|in this role|day[\s-]to[\s-]day|you will)\b/i;
const SENIORITY = [
  [0, /\b(intern(ship)?|trainee|apprentice)\b/i, "Intern"],
  [1, /\b(graduate|entry[\s-]level|junior|jr\.?|associate|fresher|new grad)\b/i, "Entry level"],
  [4, /\b(senior|sr\.?|lead|staff|principal)\b/i, "Senior"],
  [6, /\b(manager|head of|director|vp|chief)\b/i, "Management"],
];
const SENIORITY_YEARS = { Intern: 0, "Entry level": 1, Mid: 3, Senior: 5, Management: 8 };

export function parseJob(text, titleOverride = "") {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  // The title is never guessed from "the first line": it is the confirmed title, or one the extractor is sure of, or "".
  const given = cleanTitle(titleOverride).title;
  const title = given || titleFromText(raw);
  const titleFound = !!title;

  const importance = new Map(); // skill -> {tier:"must"|"core"|"nice", count}
  const tierRank = { nice: 1, core: 2, must: 3 };
  let mode = "must";
  for (const line of lines) {
    // A heading is short, is not a bullet and is not a sentence: "Preferred Qualifications:" or "Requirements".
    const isHeading = !BULLET_RE.test(line) && !/[;]/.test(line) && ((/:$/.test(line) && line.length < 70) || (line.length < 50 && line.split(/\s+/).length <= 6 && !/[.,]$/.test(line)));
    if (isHeading && NICE_RE.test(line)) mode = "nice";
    else if (isHeading && DUTY_HEAD_RE.test(line)) mode = "core";
    else if (isHeading && MUST_HEAD_RE.test(line)) mode = "must";
    const lineMode = NICE_RE.test(line) && !isHeading ? "nice" : mode;
    // "AWS or GCP", "PyTorch / TensorFlow", "AWS, GCP, or Azure": any one of them satisfies the requirement.
    const spans = skillSpans(line);
    const lineGroups = new Map();
    let chain = [spans[0]], chainOr = false;
    const closeChain = () => {
      if (chain.length > 1 && chainOr) { const id = `${lines.indexOf(line)}:${chain[0].start}`; chain.forEach((c) => lineGroups.set(c.name, id)); }
    };
    for (let i = 1; i < spans.length; i++) {
      const gap = line.slice(spans[i - 1].end, spans[i].start);
      if (/^\s*(,\s*)?(or|\/|and\/or)\s*$/i.test(gap) || /^\s*,\s*$/.test(gap)) { chain.push(spans[i]); if (/or|\//i.test(gap)) chainOr = true; }
      else { closeChain(); chain = [spans[i]]; chainOr = false; }
    }
    if (spans.length) closeChain();
    for (const [skill, count] of findSkills(line)) {
      const prev = importance.get(skill) || { tier: lineMode, count: 0 };
      if (lineGroups.has(skill) && !prev.group) prev.group = lineGroups.get(skill);
      prev.count += count;
      if (tierRank[lineMode] > tierRank[prev.tier]) prev.tier = lineMode;
      importance.set(skill, prev);
    }
  }
  // Anything repeated three or more times is clearly central: promote one tier.
  for (const v of importance.values()) if (v.count >= 3 && v.tier === "nice") v.tier = "core";
  const skills = [...importance].map(([name, v]) => ({ name, category: SKILL_BY_NAME.get(name).category, tier: v.tier, count: v.count, group: v.group || null }));

  const yearMatches = [...raw.matchAll(/(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*years?/gi)]
    .filter((m) => /experience|exp\b|background|industry|working|professional/i.test(raw.slice(Math.max(0, m.index - 80), m.index + 120)))
    .map((m) => +m[1]).filter((n) => n > 0 && n <= 20);
  const yearsRequired = yearMatches.length ? Math.max(...yearMatches) : null;

  let seniority = "Mid", seniorityLevel = 2;
  for (const [lvl, re, label] of SENIORITY) if (re.test(title) || (lvl <= 1 && re.test(lines.slice(0, 3).join(" ")))) { seniority = label; seniorityLevel = lvl; }
  if (yearsRequired !== null && seniority === "Mid") {
    if (yearsRequired >= 8) seniority = "Management";
    else if (yearsRequired >= 5) seniority = "Senior";
    else if (yearsRequired <= 1) seniority = "Entry level";
  }

  let degreeRequired = 0, degreePreferred = 0;
  for (const line of lines) {
    if (!/degree|bachelor|master|ph\.?d|b\.?tech|m\.?tech|diploma|graduate/i.test(line)) continue;
    const [lvl] = degreeLevel(line);
    if (!lvl) continue;
    if (NICE_RE.test(line) || /preferred/i.test(line)) degreePreferred = Math.max(degreePreferred, lvl);
    else degreeRequired = degreeRequired ? Math.min(degreeRequired, lvl) : lvl; // "Bachelor's or Master's" => bachelor's required
  }
  const orEquivalent = /(or equivalent|equivalent (practical )?experience|or related)/i.test(raw);

  return { title, titleFound, skills, yearsRequired, seniority, seniorityLevel, degreeRequired, degreePreferred, orEquivalent, text: raw, lines };
}

/* ------------------------------------------------------------------ bullet quality */
const STRONG_VERBS = new Set(
  `accelerated achieved administered analyzed analysed architected audited authored automated benchmarked built calibrated championed collaborated completed configured consolidated constructed contributed coordinated created curated debugged decreased delivered deployed designed detected developed devised diagnosed directed discovered documented drove eliminated enabled engineered enhanced established evaluated executed expanded extended extracted fabricated facilitated forecasted formulated generated grew guided identified implemented improved increased initiated integrated introduced investigated launched led leveraged maintained managed mapped mentored migrated minimized modeled modelled monitored negotiated onboarded optimized optimised orchestrated organized overhauled owned partnered performed piloted pioneered planned prepared presented prioritized processed produced programmed prototyped published reduced refactored refined released replaced researched resolved restructured reviewed revamped scaled scoped secured shipped simplified simulated solved spearheaded standardized streamlined strengthened supervised supported synthesized taught tested trained transformed troubleshot upgraded validated verified wrote`.split(/\s+/),
);
const WEAK_PHRASES = /\b(responsible for|worked on|helped( with| to)?|assisted( with| in)?|duties included|involved in|participated in|tasked with|in charge of|exposure to|familiar with)\b/i;
const METRIC_RE = /(\d[\d,.]*\s*(%|x\b|k\b|m\b|b\b|ms\b|hrs?\b|hours?\b|days?\b|weeks?\b|months?\b|users?\b|customers?\b|clients?\b|records?\b|alarms?\b|incidents?\b|operators?\b|engineers?\b|students?\b|\$|₹|€|£)|[$₹€£]\s?\d|\b\d{2,}[\d,.]*\+|\b\d+(\.\d+)?\s?(percent|per cent)\b|\b(from|to)\s\d[\d,.]*\b)/i;

export function scoreBullet(text) {
  const w = words(text);
  const first = (w[0] || "").toLowerCase().replace(/[^a-z]/g, "");
  const verb = STRONG_VERBS.has(first) || (/(ed|ing)$/.test(first) && first.length > 4 && !WEAK_PHRASES.test(text.slice(0, 30)));
  const weak = WEAK_PHRASES.test(text);
  const metric = METRIC_RE.test(text);
  const len = w.length;
  const lenOk = len >= 10 && len <= 32;
  const tools = findSkills(text).size;
  let score = 0;
  const issues = [], strengths = [];
  if (verb && !weak) { score += 25; strengths.push("starts with an action verb"); } else issues.push(weak ? "uses a weak phrase (\"responsible for\", \"worked on\", \"helped\")" : "does not start with a strong action verb");
  if (metric) { score += 35; strengths.push("includes a measurable result"); } else issues.push("no number, scale or result");
  if (lenOk) { score += 15; strengths.push("good length"); } else issues.push(len < 10 ? "too short to show impact" : "too long; aim for 10 to 30 words");
  if (tools) { score += 15; strengths.push(`names the tools (${[...findSkills(text).keys()].slice(0, 3).join(", ")})`); } else issues.push("does not name the tools or methods used");
  if (!weak) score += 10;
  return { text, score: Math.min(100, score), issues, strengths, words: len, metric, verb: verb && !weak, weak };
}

/* ------------------------------------------------------------------ vocabulary (non-taxonomy keywords) */
function vocabulary(jobText, resumeLower, skillNames) {
  const known = new Set(skillNames.map((s) => s.toLowerCase()));
  const toks = (String(jobText).toLowerCase().match(/[a-z][a-z0-9+#/-]{2,}/g) || []).filter((t) => !STOP.has(t) && !known.has(t));
  const counts = new Map();
  const add = (k) => counts.set(k, (counts.get(k) || 0) + 1);
  toks.forEach(add);
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i], b = toks[i + 1];
    if (!STOP.has(a) && !STOP.has(b)) add(`${a} ${b}`);
  }
  const out = [];
  for (const [term, n] of [...counts].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)) {
    if (n < 2 || out.length >= 14) continue;
    if (out.some((o) => o.term.includes(term) && o.count >= n)) continue; // keep the longest phrase
    out.push({ term, count: n, inResume: resumeLower.includes(term) });
  }
  return out;
}

/* ------------------------------------------------------------------ scoring */
const WEIGHTS = { skills: 35, title: 10, experience: 15, education: 5, impact: 17, format: 18 };
const TIER_WEIGHT = { must: 3, core: 2, nice: 1 };

function relatedOf(skill, resumeSkills) {
  for (const g of RELATED_GROUPS) if (g.includes(skill)) {
    const have = g.filter((x) => x !== skill && resumeSkills.has(x));
    if (have.length) return have;
  }
  return [];
}

export function analyze(resumeText, jobText, opts = {}) {
  const now = opts.now || new Date();
  const resume = parseResume(resumeText, now);
  const job = parseJob(jobText, opts.jobTitle);
  // Skills the user marked "not for me / ignore for this job" are left out of the score and reported separately.
  const ignoreSet = new Set(opts.ignore || []);
  const ignored = job.skills.filter((s) => ignoreSet.has(s.name)).map((s) => s.name);
  if (ignored.length) job.skills = job.skills.filter((s) => !ignoreSet.has(s.name));
  const lower = resume.text.toLowerCase();
  const resumeSkills = findSkills(resume.text);
  const proofText = [resume.sectionText.experience, resume.sectionText.projects, resume.sectionText.summary].join("\n") ||
    resume.bullets.map((b) => b.text).join("\n");
  const proofSkills = findSkills(proofText);

  /* 1. Skills & keywords ------------------------------------------------ */
  const rows = job.skills.map((s) => {
    const weight = TIER_WEIGHT[s.tier] * (s.category === "soft" ? SOFT_WEIGHT : 1);
    const inProof = proofSkills.has(s.name), inResume = resumeSkills.has(s.name);
    const related = inResume ? [] : relatedOf(s.name, resumeSkills);
    let evidence = "none", credit = 0;
    if (inProof) { evidence = "experience"; credit = 1; }
    else if (inResume) { evidence = "skills-list"; credit = 0.6; }
    else if (related.length) { evidence = "related"; credit = 0.35; }
    return { skill: s.name, group: s.group, category: s.category, tier: s.tier, jdCount: s.count, resumeCount: resumeSkills.get(s.name) || 0, weight, evidence, credit, related };
  }).sort((a, b) => b.weight - a.weight || a.credit - b.credit);
  // Alternatives ("AWS or GCP"): the group earns its best member's credit and counts once.
  const groups = new Map();
  for (const r of rows) if (r.group) (groups.get(r.group) || groups.set(r.group, []).get(r.group)).push(r);
  for (const members of groups.values()) {
    const best = members.reduce((a, b) => (b.credit > a.credit ? b : a));
    const names = members.map((m) => m.skill);
    for (const m of members) {
      m.alternatives = names.filter((n) => n !== m.skill);
      m.weight = m.weight / members.length;
      m.credit = best.credit;
      if (m !== best) { m.evidence = best.credit ? `covered by ${best.skill}` : m.evidence; m.related = best.credit ? [] : m.related; }
    }
  }
  const totalW = rows.reduce((a, r) => a + r.weight, 0);
  const skillCredit = totalW ? rows.reduce((a, r) => a + r.weight * r.credit, 0) / totalW : 0;
  const vocab = vocabulary(job.text, lower, job.skills.map((s) => s.name));
  const vocabCredit = vocab.length ? vocab.filter((v) => v.inResume).length / vocab.length : 0;
  const skillsScore = totalW ? 0.88 * skillCredit + 0.12 * vocabCredit : vocabCredit;

  /* 2. Title & seniority ------------------------------------------------ */
  const titleTokens = words(job.title.toLowerCase()).filter((t) => !STOP.has(t) && !SENIORITY.some(([, re]) => re.test(t)) && t.length > 2);
  const titleZone = (resume.head + "\n" + resume.sectionText.summary + "\n" + resume.sectionText.experience.split("\n").filter((l) => l.trim().length < 90).join("\n")).toLowerCase();
  const hitTokens = titleTokens.filter((t) => titleZone.includes(t.replace(/s$/, "")));
  let titleScore = titleTokens.length ? hitTokens.length / titleTokens.length : 0.5;
  const candLevel = resume.years >= 8 ? 6 : resume.years >= 4 ? 4 : resume.years >= 1.5 ? 2 : resume.years >= 0.5 ? 1 : 0;
  const seniorityGap = job.seniorityLevel - candLevel;
  let seniorityNote = "";
  if (seniorityGap >= 3) { titleScore *= 0.5; seniorityNote = `The role is ${job.seniority.toLowerCase()}; your experience reads as more junior.`; }
  else if (seniorityGap === 2) { titleScore *= 0.75; seniorityNote = `The role leans more senior than your ${resume.years} years suggest.`; }
  else if (seniorityGap <= -4) { titleScore *= 0.85; seniorityNote = "You may look overqualified for this level."; }

  /* 3. Experience ------------------------------------------------------- */
  const requiredYears = job.yearsRequired ?? SENIORITY_YEARS[job.seniority] ?? 2;
  const yearsRatio = requiredYears === 0 ? 1 : clamp(resume.years / requiredYears);
  const contextShare = rows.length ? rows.filter((r) => r.credit === 1).length / rows.length : proofSkills.size ? 1 : 0;
  const expScore = 0.65 * yearsRatio + 0.35 * contextShare;

  /* 4. Education -------------------------------------------------------- */
  let eduScore = 1, eduNote = "Meets the stated requirement.";
  if (job.degreeRequired) {
    if (resume.degree.level >= job.degreeRequired) eduScore = 1;
    else if (job.orEquivalent) { eduScore = 0.6; eduNote = "Below the stated degree, but the posting accepts equivalent experience."; }
    else if (resume.degree.level === job.degreeRequired - 1) { eduScore = 0.5; eduNote = "One level below the required degree."; }
    else { eduScore = 0.2; eduNote = "Below the required degree level."; }
  } else if (job.degreePreferred && resume.degree.level < job.degreePreferred) { eduScore = 0.8; eduNote = "A higher degree is preferred but not required."; }
  else if (!resume.degree.level) { eduScore = 0.6; eduNote = "No degree detected on the resume."; }

  /* 5. Impact & writing ------------------------------------------------- */
  const audit = resume.bullets.map((b) => ({ ...scoreBullet(b.text), section: b.section }));
  const n = audit.length;
  const ratio = (f) => (n ? audit.filter(f).length / n : 0);
  const metricRatio = ratio((b) => b.metric), verbRatio = ratio((b) => b.verb), weakRatio = ratio((b) => b.weak);
  const lenRatio = ratio((b) => b.words >= 10 && b.words <= 32);
  const impactScore = n ? clamp(0.45 * clamp(metricRatio / 0.55) + 0.28 * clamp(verbRatio / 0.85) + 0.15 * lenRatio + 0.12 * (1 - weakRatio)) : 0;

  /* 6. ATS formatting & structure -------------------------------------- */
  const fmt = [];
  const add = (key, label, pts, got, tip) => fmt.push({ key, label, pts, got, tip });
  const c = resume.contact;
  add("email", "Email address", 14, c.email ? 14 : 0, "Add a professional email at the top.");
  add("phone", "Phone number", 8, c.phone ? 8 : 0, "Add a phone number with country code.");
  add("links", "LinkedIn, GitHub or portfolio link", 6, c.linkedin || c.github || c.website ? 6 : 0, "Add a LinkedIn or GitHub link recruiters can click.");
  add("sec-work", "Experience or projects section", 14, resume.sections.experience || resume.sections.projects ? 14 : 0, "Add a heading named \"Experience\" or \"Projects\". Parsers look for standard names.");
  add("sec-edu", "Education section", 12, resume.sections.education ? 12 : 0, "Add a heading named \"Education\".");
  add("sec-skills", "Skills section", 12, resume.sections.skills ? 12 : 0, "Add a heading named \"Skills\" listing your tools in plain text.");
  const wc = resume.wordCount;
  const lenPts = wc >= 300 && wc <= 1100 ? 10 : wc >= 200 && wc <= 1400 ? 6 : 2;
  add("length", `Length (${wc} words, about ${round1(wc / 500)} pages)`, 10, lenPts, wc < 300 ? "Too short: add detail on projects and results." : "Too long: trim to 1 to 2 pages.");
  add("garbled", resume.garbled ? `${resume.garbled} unreadable icon or symbol character(s)` : "Clean text, no stray symbols", 10, resume.garbled ? Math.max(0, 10 - resume.garbled * 4) : 10, "Remove icon glyphs (they appear as odd symbols near your email or links). ATS parsers misread them.");
  add("dates", "Dated roles", 6, resume.datedRoles ? 6 : 0, "Add start and end dates (e.g. \"Jun 2023 – Present\") to each role.");
  const pron = n ? resume.firstPerson / n : 0;
  add("voice", "No first-person pronouns", 4, pron < 0.1 ? 4 : 0, "Drop \"I\" and \"my\" from bullets. Start with the action verb.");
  add("bullets", `Bullet points detected (${n})`, 4, n >= 4 ? 4 : 0, "Use real bullet points (•) for each achievement.");
  const fmtMax = fmt.reduce((a, f) => a + f.pts, 0);
  const formatScore = fmt.reduce((a, f) => a + f.got, 0) / fmtMax;

  /* assemble -------------------------------------------------------------- */
  const parts = [
    ["skills", "Skills & keywords", skillsScore],
    ["title", "Title & seniority fit", titleScore],
    ["experience", "Experience", expScore],
    ["education", "Education", eduScore],
    ["impact", "Impact of your bullets", impactScore],
    ["format", "ATS-friendly structure", formatScore],
  ];
  const breakdown = parts.map(([key, label, raw]) => ({ key, label, weight: WEIGHTS[key], ratio: round1(clamp(raw) * 100) / 100, points: round1(clamp(raw) * WEIGHTS[key]) }));
  const total = Math.round(breakdown.reduce((a, b) => a + b.points, 0));

  const grade = total >= 85 ? { label: "Excellent", verdict: "A strong match. Your resume should read clearly to ATS software and to a recruiter." }
    : total >= 70 ? { label: "Strong", verdict: "A good match. A few fixes will lift it further." }
    : total >= 55 ? { label: "Fair", verdict: "A partial match. The fixes below matter most." }
    : { label: "Needs work", verdict: "A weak match for this posting. Start with the top fixes." };

  /* explanations + prioritised fixes -------------------------------------- */
  const detail = {
    skills: `${rows.filter((r) => r.credit === 1).length} of ${rows.length} skills in the posting are shown in use on your resume; ${rows.filter((r) => r.evidence === "skills-list").length} appear only in a skills list; ${rows.filter((r) => r.credit === 0).length} are missing.`,
    title: `${hitTokens.length} of ${titleTokens.length} words from the job title ("${job.title}") appear in your headline, summary or role titles. ${seniorityNote}`.trim(),
    experience: `${resume.years} years detected vs about ${requiredYears} expected${job.yearsRequired ? "" : " for this seniority"}; ${Math.round(contextShare * 100)}% of the posting's skills appear in your experience bullets.`,
    education: `${resume.degree.label} detected. ${eduNote}`,
    impact: n ? `${Math.round(metricRatio * 100)}% of bullets show a measurable result (aim for 55%+); ${Math.round(verbRatio * 100)}% start with a strong action verb (aim for 85%+).` : "No bullet points were detected in your experience or projects.",
    format: `${fmt.filter((f) => f.got === f.pts).length} of ${fmt.length} structure checks fully passed.`,
  };
  for (const b of breakdown) b.detail = detail[b.key];

  const fixes = [];
  const skillPts = WEIGHTS.skills * 0.88;
  const seenGroups = new Set();
  for (const r of rows) {
    if (r.credit === 1) continue;
    if (r.group) {
      if (seenGroups.has(r.group)) continue;
      seenGroups.add(r.group);
      const all = rows.filter((x) => x.group === r.group);
      const groupGain = round1((skillPts * all.reduce((a, x) => a + x.weight, 0) * (1 - r.credit)) / totalW);
      if (groupGain >= 0.3) fixes.push({ area: "skills", gain: groupGain, text: `The posting needs one of: ${all.map((x) => x.skill).join(", ")}${r.credit ? ` (you show partial evidence)` : ` and none appear on your resume`}.`, action: `If you have used any of them, add a bullet that shows it${all.some((x) => x.related.length) ? `; mention your ${[...new Set(all.flatMap((x) => x.related))].join(", ")} experience as transferable` : ""}.` });
      continue;
    }
    const gain = totalW ? round1((skillPts * r.weight * (1 - r.credit)) / totalW) : 0;
    if (gain < 0.3) continue;
    if (r.evidence === "none") fixes.push({ area: "skills", gain, text: `"${r.skill}" is ${r.tier === "must" ? "a must-have" : r.tier === "core" ? "central to the duties" : "a nice-to-have"} in the posting and is not on your resume.`, action: `Add it only if it is true, in a bullet that shows how you used it.` });
    else if (r.evidence === "related") fixes.push({ area: "skills", gain, text: `The posting asks for ${r.skill}; you list ${r.related.join(", ")}.`, action: `Mention that ${r.related[0]} experience transfers, and name ${r.skill} if you have touched it.` });
    else fixes.push({ area: "skills", gain, text: `"${r.skill}" appears only in your skills list.`, action: `Use it in an experience or project bullet so it counts as proven.` });
  }
  for (const f of fmt) if (f.got < f.pts) fixes.push({ area: "format", gain: round1(((f.pts - f.got) / fmtMax) * WEIGHTS.format), text: f.label + " needs attention.", action: f.tip });
  if (n && metricRatio < 0.55) fixes.push({ area: "impact", gain: round1(WEIGHTS.impact * 0.45 * clamp(1 - metricRatio / 0.55)), text: `Only ${Math.round(metricRatio * 100)}% of your bullets contain a number or result.`, action: "Add scale, speed, accuracy, cost or volume to your best bullets." });
  if (n && verbRatio < 0.85) fixes.push({ area: "impact", gain: round1(WEIGHTS.impact * 0.28 * clamp(1 - verbRatio / 0.85)), text: `${Math.round((1 - verbRatio) * 100)}% of bullets do not open with a strong action verb.`, action: "Start each bullet with Built, Reduced, Designed, Automated and similar." });
  if (titleScore < 0.6 && titleTokens.length) fixes.push({ area: "title", gain: round1(WEIGHTS.title * (0.8 - titleScore)), text: `Words from the job title ("${titleTokens.join(" ")}") are rare on your resume.`, action: "Add a one-line headline under your name that mirrors the target role, if it honestly describes you." });
  if (seniorityNote) fixes.push({ area: "title", gain: 2, text: seniorityNote, action: "Address the level gap in your summary or cover letter." });
  if (job.degreeRequired && resume.degree.level < job.degreeRequired && eduScore < 1) fixes.push({ area: "education", gain: round1(WEIGHTS.education * (1 - eduScore)), text: eduNote, action: "Explain equivalent experience in your cover letter." });
  fixes.sort((a, b) => b.gain - a.gain);
  // Keep the list balanced: a long list of missing skills must not hide formatting or writing fixes.
  const caps = { skills: 5, format: 4, impact: 3, title: 2, education: 1 }, used = {};
  const picked = fixes.filter((f) => (used[f.area] = (used[f.area] || 0) + 1) <= (caps[f.area] || 2));

  const missingMust = rows.filter((r) => r.tier === "must" && r.credit === 0).map((r) => r.skill);
  const missing = rows.filter((r) => r.credit === 0).map((r) => r.skill);
  const worst = [...audit].sort((a, b) => a.score - b.score);

  return {
    score: total,
    grade,
    breakdown,
    keywords: rows,
    vocabulary: vocab,
    fixes: picked.slice(0, 14),
    format: fmt.map((f) => ({ label: f.label, ok: f.got === f.pts, points: f.got, max: f.pts, tip: f.got === f.pts ? "" : f.tip })),
    bullets: { total: n, average: n ? Math.round(audit.reduce((a, b) => a + b.score, 0) / n) : 0, withMetrics: Math.round(metricRatio * 100), withVerbs: Math.round(verbRatio * 100), audit: worst, weakest: worst.filter((b) => b.score < 70).slice(0, 8) },
    ignored,
    job: { title: job.title, titleFound: job.titleFound, seniority: job.seniority, yearsRequired: job.yearsRequired, degreeRequired: job.degreeRequired },
    candidate: { name: resume.name, years: resume.years, degree: resume.degree.label, contact: resume.contact, wordCount: resume.wordCount, sections: Object.keys(resume.sections) },
    missing,
    missingMust,
    disclaimer: "ATS readiness estimate. Real ATS products do not publish a score; this reflects the signals they and recruiters use. Treat it as a guide, not a guarantee.",
  };
}

/** Positions of the named skills (and their aliases) in `text`, for highlighting. Sorted, may overlap. */
export function skillMatches(text, names) {
  const want = new Set(names), out = [];
  for (const s of SKILLS) {
    if (!want.has(s.name)) continue;
    s.re.lastIndex = 0;
    for (const m of String(text).matchAll(s.re)) out.push({ name: s.name, start: m.index, end: m.index + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}
