// Realistic (hand-written) page fixtures. They contain lots of non-job text on purpose.
export const JD_BODY_HTML = `<p>We build robots that move boxes. You will design and ship models that plan routes and detect obstacles.</p>
<h2>Responsibilities</h2><ul><li>Build and deploy machine learning models in Python and PyTorch</li><li>Own model evaluation and monitoring</li><li>Work with embedded engineers on FPGA deployment</li></ul>
<h2>Minimum Qualifications</h2><ul><li>Degree in Computer Science, ECE or a related field</li><li>3+ years of experience with Python</li><li>Experience with Docker and AWS or GCP</li></ul>
<h2>Preferred Qualifications</h2><ul><li>Kubernetes experience is a bonus</li></ul>`;

export const LD_PAGE = `<!doctype html><html><head><title>Machine Learning Engineer | Example Robotics Careers</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "JobPosting", title: "Machine Learning Engineer",
  description: JD_BODY_HTML, hiringOrganization: { "@type": "Organization", name: "Example Robotics" },
  jobLocation: { "@type": "Place", address: { addressLocality: "Bengaluru", addressRegion: "KA", addressCountry: "IN" } },
}).replace(/</g, "\\u003c")}</script></head>
<body><nav><a href="/">Home</a><a href="/jobs">Jobs</a><a href="/signin">Sign in</a></nav>
<div class="cookie-banner">We use cookies. Accept all cookies</div>
<main><h1>Machine Learning Engineer</h1>${JD_BODY_HTML}</main>
<footer>Privacy Policy Terms of Use (c) 2026 Example Robotics</footer></body></html>`;

export const PLAIN_PAGE = `<!doctype html><html><head><title>Job Application for Data Analyst at Acme Analytics</title></head><body>
<header class="site-header"><a class="logo" href="/">Acme</a><nav class="navbar"><a href="/jobs">All jobs</a><a href="/about">About us</a><a href="/login">Log in</a></nav></header>
<div id="cookie-consent-banner"><p>We value your privacy. Manage cookie preferences</p><button>Accept all</button></div>
<div class="breadcrumbs"><a href="/">Home</a> / <a href="/jobs">Jobs</a></div>
<div class="job"><div class="job-header"><h1>Data Analyst</h1><div class="location">Remote - India</div></div>
<div class="content"><h3>About the role</h3><p>Acme Analytics helps retailers understand demand. You will turn messy data into decisions for our customers every week.</p>
<h3>Responsibilities</h3><ul><li>Write SQL queries and build dashboards in Tableau</li><li>Design and analyse A/B tests</li><li>Present findings to stakeholders</li></ul>
<h3>Requirements</h3><ul><li>2+ years of experience in data analysis</li><li>Strong SQL and Python</li><li>Excellent communication</li></ul></div>
<aside class="share"><a>Share on LinkedIn</a><a>Share on Twitter</a></aside></div>
<section class="related-jobs"><h2>Similar jobs</h2><ul><li><a>Senior Data Analyst</a></li><li><a>BI Developer</a></li></ul></section>
<form id="apply-form"><label>First name <input name="f"></label><button>Submit application</button></form>
<footer><a>Privacy Policy</a> <a>Terms of Use</a> (c) 2026 Acme Analytics. All rights reserved.</footer></body></html>`;

export const SPA_SHELL = `<!doctype html><html><head><title>Careers</title></head><body><div id="root"></div>
<script>window.__DATA__={}</script><script src="/app.js"></script><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;

// What you get when you select-all and copy a careers page, then paste it.
export const PASTED_PAGE = `Skip to main content
Careers
Jobs
Teams
Locations
Sign in
Search jobs
Back to all jobs
Software Engineer, Network Analytics
Bengaluru, India
Apply now
Save
Share
Responsibilities
Design and build analytics pipelines that process millions of network records
Develop root cause analysis tooling in Python and SQL for operations teams
Partner with network engineers to turn alarms into actionable insights
Minimum Qualifications
Bachelor's degree in Computer Science, Electronics or a related field
2+ years of experience building data pipelines
Proficiency in Python and SQL
Preferred Qualifications
Experience with telecom networks (4G/5G)
Familiarity with Kafka or Spark
Similar jobs
Senior Network Engineer
Data Scientist, Telecom
Follow us
Privacy Policy
Terms of Use
(c) 2026 Example Telecom. All rights reserved.`;

export const GREENHOUSE_API = { title: "Backend Engineer", location: { name: "Remote, EU" }, company_name: "Globex", content: "&lt;p&gt;Build and operate the payment APIs that power our marketplace, working closely with product and data teams across Europe.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;3+ years Go&lt;/li&gt;&lt;li&gt;PostgreSQL and Kubernetes&lt;/li&gt;&lt;/ul&gt;" };
export const LEVER_API = { text: "Product Designer", categories: { location: "Berlin" }, descriptionPlain: "Design delightful products.", lists: [{ text: "What you'll do", content: "<li>Own design end to end</li><li>Run user research</li>" }], additionalPlain: "We are an equal opportunity employer." };
