/* ============================================================
   site.js — client runtime for the playbook site.
   Zero dependencies. Page-specific features initialise only when
   their root element exists. Data arrives either via
   <script type="application/json"> islands (per-page data) or
   window.SEARCH_INDEX (search-index.js, loaded on every page).
   ============================================================ */
(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const readJSON = (id) => { const el = document.getElementById(id); return el ? JSON.parse(el.textContent) : null; };
  const ROOT = document.documentElement.getAttribute("data-root") || "";

  const CAT_LABEL = { grant: "Grant", equity: "Equity", "loan-credit": "Loan / Credit", incubation: "Incubation", "market-access": "Market Access", mixed: "Mixed", other: "Other" };
  const STAGE_LABEL = { ideation: "Ideation", prototype: "Prototype / PoC", "early-stage": "Seed / Early-Stage", growth: "Growth / Scaling", "market-access": "Market Access & IP" };
  const badge = (cat) => `<span class="badge b-${esc(cat)}">${esc(CAT_LABEL[cat] || cat)}</span>`;

  const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollBehavior = motionOK ? "smooth" : "auto";

  /* ---------- theme ---------- */
  const themeBtn = $("#theme-toggle");
  if (themeBtn) {
    const syncLabel = () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    };
    syncLabel();
    themeBtn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("usa-guide-theme", next); } catch {}
      syncLabel();
    });
  }

  /* ---------- nav: off-canvas drawer on mobile, rail collapse on desktop ---------- */
  const navToggle = $("#nav-toggle");
  const scrim = $("#scrim");
  const openNav = () => {
    const y = window.scrollY || 0;
    document.body.dataset.lockY = String(y);
    document.body.style.top = `-${y}px`;         // freeze the page at its scroll offset
    document.body.classList.add("nav-open");
    document.documentElement.classList.add("nav-open");
    const sb = $("#sidebar"); if (sb) sb.scrollTop = 0;
    navToggle && navToggle.setAttribute("aria-expanded", "true");
  };
  const closeNav = () => {
    if (!document.body.classList.contains("nav-open")) return;
    document.body.classList.remove("nav-open");
    document.documentElement.classList.remove("nav-open");
    const y = parseInt(document.body.dataset.lockY || "0", 10);
    document.body.style.top = "";
    // restore the pre-open position instantly, then once more next frame to
    // win over the browser's scroll anchoring
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: "instant" }));
    navToggle && navToggle.setAttribute("aria-expanded", "false");
  };
  if (navToggle) {
    // one button, two jobs: off-canvas drawer on mobile, rail collapse on desktop
    const desktop = window.matchMedia("(min-width: 1024px)");
    const syncToggle = () => {
      if (desktop.matches) {
        const open = !document.documentElement.classList.contains("rail-collapsed");
        navToggle.setAttribute("aria-expanded", String(open));
        navToggle.setAttribute("aria-label", open ? "Collapse sidebar" : "Expand sidebar");
      } else {
        const open = document.body.classList.contains("nav-open");
        navToggle.setAttribute("aria-expanded", String(open));
        navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      }
    };
    syncToggle();
    desktop.addEventListener && desktop.addEventListener("change", syncToggle);
    navToggle.addEventListener("click", () => {
      if (desktop.matches) {
        const collapsed = document.documentElement.classList.toggle("rail-collapsed");
        try { localStorage.setItem("rail-collapsed", collapsed ? "1" : "0"); } catch {}
      } else {
        document.body.classList.contains("nav-open") ? closeNav() : openNav();
      }
      syncToggle();
    });
    scrim && scrim.addEventListener("click", closeNav);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });
  }

  /* ---------- sidebar: open group containing current page ---------- */
  const current = $('.sidebar a[aria-current="page"]');
  if (current) {
    let el = current.parentElement;
    while (el && !el.classList.contains("sidebar")) {
      if (el.tagName === "DETAILS") el.open = true;
      el = el.parentElement;
    }
    current.scrollIntoView({ block: "nearest" });
  }

  /* ---------- back to top ---------- */
  const toTop = $("#to-top");
  if (toTop) {
    const onScroll = () => toTop.classList.toggle("show", window.scrollY > 700);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: scrollBehavior }));
  }

  /* ---------- toc scroll-spy ---------- */
  const tocLinks = $$(".toc a");
  if (tocLinks.length) {
    const map = new Map();
    tocLinks.forEach((a) => {
      const id = decodeURIComponent(a.getAttribute("href").slice(1));
      const target = document.getElementById(id);
      if (target) map.set(target, a);
    });
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          tocLinks.forEach((a) => a.classList.remove("active"));
          const link = map.get(en.target);
          link && link.classList.add("active");
        }
      });
    }, { rootMargin: "-70px 0px -70% 0px" });
    map.forEach((_, target) => spy.observe(target));
  }

  /* ---------- search modal ---------- */
  const modal = $("#search-modal");
  if (modal) {
    const input = $("#search-input");
    const results = $("#search-results");
    const status = $("#search-status");
    let sel = -1;
    let lastTrigger = null;

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", "search-results");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-autocomplete", "list");
    results.setAttribute("role", "listbox");

    const open = () => {
      lastTrigger = document.activeElement;
      modal.classList.add("open");
      document.body.style.overflow = "hidden";
      input.value = ""; render(""); input.focus();
    };
    const close = () => {
      modal.classList.remove("open"); sel = -1;
      document.body.style.overflow = "";
      if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    };

    // keep Tab inside the dialog while open
    modal.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = [input, ...$$(".hit", results)];
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    $$("[data-search-open]").forEach((b) => b.addEventListener("click", open));
    $(".backdrop", modal).addEventListener("click", close);
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); modal.classList.contains("open") ? close() : open(); }
      else if (e.key === "/" && !modal.classList.contains("open") && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); open(); }
      else if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    const score = (item, q) => {
      const hay = `${item.t} ${item.s || ""} ${item.g || ""} ${item.m || ""}`.toLowerCase();
      if (!hay.includes(q)) return -1;
      let sc = 0;
      const tl = item.t.toLowerCase(), sn = (item.s || "").toLowerCase();
      if (sn === q || tl === q) sc += 100;
      if (sn.startsWith(q)) sc += 60;
      if (tl.startsWith(q)) sc += 40;
      if (tl.includes(q)) sc += 20;
      if (item.k === "scheme") sc += 10;
      return sc;
    };

    const mark = (text, q) => {
      if (!q) return esc(text);
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) return esc(text);
      return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
    };

    const render = (qRaw) => {
      const q = qRaw.trim().toLowerCase();
      const index = window.SEARCH_INDEX || [];
      let hits;
      if (!q) {
        hits = index.filter((x) => x.k === "page").slice(0, 8);
      } else {
        hits = index.map((x) => [score(x, q), x]).filter(([s]) => s >= 0)
          .sort((a, b) => b[0] - a[0]).slice(0, 12).map(([, x]) => x);
      }
      sel = -1;
      input.removeAttribute("aria-activedescendant");
      if (status) status.textContent = q ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : "";
      if (!hits.length) { results.innerHTML = `<div class="none">No matches for “${esc(qRaw)}”. Try a scheme abbreviation like “SISFS”.</div>`; return; }
      results.innerHTML = hits.map((h, i) => `
        <a class="hit" role="option" id="hit-${i}" href="${ROOT}${esc(h.u)}">
          <div class="h-name">${mark(h.t, q)}${h.s ? ` <span class="abbr muted">· ${mark(h.s, q)}</span>` : ""}${h.c ? " " + badge(h.c) : ""}</div>
          ${h.d ? `<div class="h-sub">${mark(h.d, q)}</div>` : ""}
        </a>`).join("");
    };

    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", (e) => {
      const hits = $$(".hit", results);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = e.key === "ArrowDown" ? Math.min(sel + 1, hits.length - 1) : Math.max(sel - 1, 0);
        hits.forEach((h, i) => h.classList.toggle("sel", i === sel));
        if (hits[sel]) {
          hits[sel].scrollIntoView({ block: "nearest" });
          input.setAttribute("aria-activedescendant", hits[sel].id);
        }
      } else if (e.key === "Enter" && sel >= 0 && hits[sel]) {
        window.location.href = hits[sel].href;
      }
    });
  }

  /* ================= DIRECTORY ================= */
  const dirRoot = $("#directory");
  if (dirRoot) {
    const DATA = readJSON("directory-data") || [];
    const state = { q: "", part: "", support: "", stage: "", sector: "", audience: "", view: "cards" };

    const els = {
      q: $("#f-q"), part: $("#f-part"), support: $("#f-support"), stage: $("#f-stage"),
      sector: $("#f-sector"), audience: $("#f-audience"),
      count: $("#f-count"), out: $("#dir-out"),
      viewBtns: $$("#view-toggle button"), reset: $("#f-reset"),
    };

    const matches = (s) =>
      (!state.part || s.part === state.part) &&
      (!state.support || s.category === state.support || s.supportTypes.includes(state.support)) &&
      (!state.stage || s.stages.includes(state.stage)) &&
      (!state.sector || s.sectors.includes(state.sector)) &&
      (!state.audience || s.audience.includes(state.audience)) &&
      (!state.q || `${s.name} ${s.shortName} ${s.ministry} ${s.tagline} ${s.maxFunding}`.toLowerCase().includes(state.q));

    const cardHTML = (s) => `
      <a class="scheme-card" href="${ROOT}schemes/${esc(s.slug)}.html">
        <div class="top">
          <span class="abbr">${s.shortName ? `${esc(s.shortName)} · ` : ""}Part ${esc(s.part)}</span>
          ${badge(s.category)}
        </div>
        <h3>${esc(s.name)}</h3>
        <div class="ministry">${esc(s.ministry)}</div>
        <p class="tagline">${esc(s.tagline)}</p>
        <div class="meta">
          ${s.stages.map((st) => `<span class="badge b-plain b-part">${esc(STAGE_LABEL[st] || st)}</span>`).join("")}
          ${state.support && s.category !== state.support && s.supportTypes.includes(state.support) ? `<span class="badge b-${esc(state.support)}">Also: ${esc(CAT_LABEL[state.support])}</span>` : ""}
          ${s.maxFunding ? `<span class="amount">${esc(s.maxFunding)}</span>` : ""}
        </div>
      </a>`;

    const rowHTML = (s) => `
      <tr>
        <td class="cell-scheme"><a href="${ROOT}schemes/${esc(s.slug)}.html"><strong>${esc(s.shortName || s.name)}</strong></a><span class="sub">${esc(s.name)}</span></td>
        <td class="cell-ministry">${esc(s.ministry)}</td>
        <td>${badge(s.category)}</td>
        <td class="cell-stages">${s.stages.map((st) => `<span class="badge b-plain b-part">${esc(STAGE_LABEL[st] || st)}</span>`).join("")}</td>
        <td class="num cell-amount">${esc(s.maxFunding || "—")}</td>
      </tr>`;

    const render = () => {
      const found = DATA.filter(matches);
      els.count.innerHTML = `Showing <b>${found.length}</b> of ${DATA.length} schemes`;
      if (!found.length) {
        els.out.innerHTML = `<div class="empty-state"><div class="big">🔍</div><p>No schemes match those filters.</p><p class="small">Try clearing a filter or two — or <button class="btn-ghost btn" id="f-reset2">reset all filters</button></p></div>`;
        const r2 = $("#f-reset2"); r2 && r2.addEventListener("click", reset);
        return;
      }
      if (state.view === "cards") {
        els.out.innerHTML = `<div class="grid grid-2">${found.map(cardHTML).join("")}</div>`;
      } else {
        els.out.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr><th>Scheme</th><th>Ministry</th><th>Support</th><th>Stage</th><th>Headline amount</th></tr></thead>
          <tbody>${found.map(rowHTML).join("")}</tbody></table></div>`;
      }
    };

    const reset = () => {
      state.q = state.part = state.support = state.stage = state.sector = state.audience = "";
      els.q.value = ""; [els.part, els.support, els.stage, els.sector, els.audience].forEach((el) => el && (el.value = ""));
      render();
    };

    els.q.addEventListener("input", () => { state.q = els.q.value.trim().toLowerCase(); render(); });
    ["part", "support", "stage", "sector", "audience"].forEach((k) => {
      els[k] && els[k].addEventListener("change", () => { state[k] = els[k].value; render(); });
    });
    els.reset && els.reset.addEventListener("click", reset);
    els.viewBtns.forEach((b) => b.addEventListener("click", () => {
      state.view = b.dataset.view;
      els.viewBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    }));

    // deep-link filters: directory.html?support=grant&stage=ideation&q=seed
    const params = new URLSearchParams(location.search);
    ["part", "support", "stage", "sector", "audience"].forEach((k) => {
      const v = params.get(k);
      if (v && els[k] && [...els[k].options].some((o) => o.value === v)) { state[k] = v; els[k].value = v; }
    });
    if (params.get("q")) { state.q = params.get("q").toLowerCase(); els.q.value = params.get("q"); }
    render();
  }

  /* ================= FINDER WIZARD ================= */
  const wizRoot = $("#wizard");
  if (wizRoot) {
    const TREE = readJSON("tree-data"); // {intro, questions:[{id,question,branches:[{label,note,tone,schemes:[{name,qual,slug,category}]}]}]}
    const picks = []; // {q, label, schemes}
    let step = 0;

    const BRANCH_TONE = ["var(--brand-saffron)", "var(--brand-green)", "var(--brand-navy)", "var(--cat-incubation)", "var(--cat-equity)", "var(--warning)"];

    const progress = () => `
      <div class="wizard-progress" aria-hidden="true">
        ${TREE.questions.map((_, i) => `<span class="seg ${i < step ? "done" : ""}"><span class="fill"></span></span>`).join("")}
      </div>`;

    const resultCards = (schemes) => `
      <div class="related" style="margin-top:12px">${schemes.map((s) => s.slug
        ? `<a href="${ROOT}schemes/${esc(s.slug)}.html"><span class="rn">${esc(s.name)}${s.qual ? ` <span class="qual">${esc(s.qual)}</span>` : ""}</span>${s.full && s.full !== s.name ? `<span class="rm">${esc(s.full)}</span>` : s.tagline ? `<span class="rm">${esc(s.tagline)}</span>` : ""}</a>`
        : `<span class="dead">${esc(s.name)}</span>`).join("")}
      </div>`;

    const focusHeading = () => {
      const h = $("h2", wizRoot);
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    };

    const renderStep = () => {
      const q = TREE.questions[step];
      wizRoot.innerHTML = `
        ${progress()}
        <div class="qcard" role="group" aria-labelledby="wq">
          <div class="qnum">Question ${q.id} of ${TREE.questions.length}</div>
          <h2 id="wq">${esc(q.question)}</h2>
          <div class="answers ${q.branches.length > 2 ? "answers-many" : ""}">
            ${q.branches.map((b, i) => `
              <button class="answer" data-i="${i}">
                <span class="a-label"><span class="a-dot" style="background:${BRANCH_TONE[i % BRANCH_TONE.length]}"></span>${esc(b.label)}</span>
                ${b.note ? `<span class="a-note">${esc(b.note)}</span>` : b.schemes.length ? `<span class="a-note">${b.schemes.length} scheme${b.schemes.length > 1 ? "s" : ""}</span>` : ""}
              </button>`).join("")}
            <button class="answer" data-skip="1">
              <span class="a-label"><span class="a-dot" style="background:var(--border-strong)"></span>Skip this question</span>
              <span class="a-note">Not relevant to me</span>
            </button>
          </div>
          ${step > 0 ? `<button class="btn btn-ghost wizard-back" data-back="1">← Back</button>` : ""}
        </div>`;
      $$(".answer", wizRoot).forEach((btn) => btn.addEventListener("click", () => {
        if (btn.dataset.skip) { picks[step] = null; }
        else {
          const b = TREE.questions[step].branches[Number(btn.dataset.i)];
          picks[step] = { q: TREE.questions[step].question, label: b.label, note: b.note, schemes: b.schemes };
        }
        step += 1;
        step < TREE.questions.length ? renderStep() : renderResults();
        wizRoot.scrollIntoView({ behavior: scrollBehavior, block: "start" });
        focusHeading();
      }));
      const back = $("[data-back]", wizRoot);
      back && back.addEventListener("click", () => { step -= 1; renderStep(); focusHeading(); });
    };

    const renderResults = () => {
      const answered = picks.filter(Boolean).filter((p) => p.schemes.length);
      wizRoot.innerHTML = `
        ${progress()}
        <div class="wizard-results">
          <h2>Your matched schemes</h2>
          ${answered.length ? "" : `<p class="muted" style="margin-top:10px">You skipped every question — here's the full playbook instead.</p>`}
          ${answered.map((p) => `
            <div class="r-group">
              <h3>${esc(p.q)}</h3>
              <p class="r-note">You answered: <strong>${esc(p.label)}</strong>${p.schemes.length ? ` — ${p.schemes.length} matching scheme${p.schemes.length > 1 ? "s" : ""}` : ""}</p>
              ${resultCards(p.schemes)}
            </div>`).join("")}
          <div class="restart-row">
            <button class="btn btn-secondary" id="wiz-restart">↺ Start over</button>
            <a class="btn btn-primary" href="${ROOT}directory.html">Browse all schemes</a>
            <a class="btn btn-ghost" href="${ROOT}compare.html">Compare schemes</a>
          </div>
        </div>`;
      $("#wiz-restart").addEventListener("click", () => { picks.length = 0; step = 0; renderStep(); focusHeading(); });
    };

    renderStep();
  }

  /* ================= COMPARE ================= */
  const cmpRoot = $("#compare");
  if (cmpRoot) {
    const DATA = readJSON("compare-data") || []; // full scheme objects (lean fields)
    const bySlug = new Map(DATA.map((s) => [s.slug, s]));
    const selects = $$(".compare-pickers select");
    const out = $("#compare-out");

    const opt = (sel) => `<option value="">— Choose a scheme —</option>` +
      DATA.map((s) => `<option value="${esc(s.slug)}" ${sel === s.slug ? "selected" : ""}>${esc(s.shortName ? `${s.shortName} — ${s.name}` : s.name)}</option>`).join("");

    const rowsSpec = [
      ["Support type", (s) => badge(s.category)],
      ["Ministry", (s) => esc(s.ministry)],
      ["Best suited for", (s) => esc(s.bestSuitedFor)],
      ["What is it?", (s) => esc(s.tagline)],
      ["Who can apply", (s) => `<ul>${s.eligibility.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`],
      ["What you get", (s) => `<ul>${s.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`],
      ["Headline amount", (s) => s.maxFunding ? `<strong>${esc(s.maxFunding)}</strong>` : "—"],
      ["How to apply", (s) => esc(s.howToApply)],
    ];

    const render = () => {
      const chosen = selects.map((s) => bySlug.get(s.value)).filter(Boolean);
      const params = new URLSearchParams();
      selects.forEach((s, i) => s.value && params.set(`s${i + 1}`, s.value));
      history.replaceState(null, "", params.toString() ? `?${params}` : location.pathname);
      const statusEl = $("#compare-status");
      if (statusEl) statusEl.textContent = chosen.length >= 2 ? `Comparing ${chosen.map((s) => s.shortName || s.name).join(" and ")}` : "";
      if (chosen.length < 2) {
        out.innerHTML = `<div class="empty-state"><div class="big">⚖️</div><p>Pick at least two schemes above to compare them side by side.</p></div>`;
        return;
      }
      out.innerHTML = `<div class="compare-table-wrap"><table class="compare">
        <thead><tr><td></td>${chosen.map((s) => `<th scope="col" class="col-head"><a href="${ROOT}schemes/${esc(s.slug)}.html">${esc(s.shortName || s.name)}</a><span class="m">${esc(s.name)}</span></th>`).join("")}</tr></thead>
        <tbody>${rowsSpec.map(([label, fn]) => `<tr><th scope="row">${label}</th>${chosen.map((s) => `<td>${fn(s)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
    };

    const params = new URLSearchParams(location.search);
    selects.forEach((sel, i) => {
      sel.innerHTML = opt(params.get(`s${i + 1}`) || "");
      sel.addEventListener("change", render);
    });
    render();
  }

  /* ================= INCUBATORS ================= */
  const incRoot = $("#incubators");
  if (incRoot) {
    const DATA = readJSON("incubators-data") || [];
    const MAP = readJSON("india-map-data");

    const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14">${d}</svg>`;
    const IC = {
      pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
      globe: svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z"/>'),
      phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z"/>'),
      mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
      close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    };
    const TYPE_LABEL = { SBDC: "Small Business Development Center", ICORPS: "NSF I-Corps Hub/Site", Academic: "Academic", Government: "Government", Private: "Private", "Sector-specific": "Sector-specific" };
    const TYPE_SHORT = { SBDC: "SBDC", ICORPS: "I-Corps", Academic: "Academic", Government: "Govt", Private: "Private", "Sector-specific": "Sector" };
    const typeCls = (t) => t.toLowerCase().replace(/[^a-z]+/g, "-");
    const supportTag = (s) => {
      if (/SBA|SBDC/i.test(s)) return "SBA / SBDC network";
      if (/\bNSF\b/i.test(s)) return "NSF";
      if (/DOD|Defense/i.test(s)) return "DOD";
      if (/State/i.test(s)) return "State government";
      if (/Private/i.test(s)) return "Private";
      return "";
    };
    const telHref = (p) => p.replace(/[^+\d]/g, "");

    const state = { q: "", state: "", type: "", support: "", view: "map", city: "" };
    const els = {
      q: $("#i-q"), state: $("#i-state"), type: $("#i-type"), support: $("#i-support"),
      count: $("#i-count"), out: $("#inc-out"), viewBtns: $$("#i-view-toggle button"), reset: $("#i-reset"),
    };

    const matches = (r) =>
      (!state.type || r.type === state.type) &&
      (!state.state || r.state === state.state) &&
      (!state.support || supportTag(r.supportedBy) === state.support) &&
      (!state.q || `${r.name} ${r.host} ${r.city} ${r.state} ${r.sectors.join(" ")} ${r.supportedBy}`.toLowerCase().includes(state.q));

    const contactRow = (r) => {
      const b = [];
      if (r.website) b.push(`<a class="i-chip" href="${esc(r.website)}" target="_blank" rel="noopener">${IC.globe} Website</a>`);
      if (r.phone) b.push(`<a class="i-chip" href="tel:${esc(telHref(r.phone))}">${IC.phone} ${esc(r.phone)}</a>`);
      if (r.email) b.push(`<a class="i-chip" href="mailto:${esc(r.email)}">${IC.mail} Email</a>`);
      return b.length ? `<div class="i-contact">${b.join("")}</div>` : "";
    };

    const cardHTML = (r) => `
      <div class="inc-card">
        <div class="inc-top">
          <span class="inc-badge t-${typeCls(r.type)}" title="${esc(TYPE_LABEL[r.type] || r.type)}">${esc(TYPE_SHORT[r.type] || r.type)}</span>
          ${supportTag(r.supportedBy) ? `<span class="inc-support">${esc(supportTag(r.supportedBy))}</span>` : ""}
        </div>
        <h3>${r.website ? `<a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</h3>
        ${r.host ? `<div class="inc-host">${esc(r.host)}</div>` : ""}
        <div class="inc-loc">${IC.pin}<span>${esc(r.city)}, ${esc(r.state)}</span></div>
        ${r.sectors.length ? `<div class="inc-sectors">${r.sectors.slice(0, 5).map((s) => `<span class="inc-sec">${esc(s)}</span>`).join("")}</div>` : ""}
        ${r.contact ? `<div class="inc-poc">${esc(r.contact)}</div>` : ""}
        ${contactRow(r)}
      </div>`;

    const rowHTML = (r) => `
      <tr>
        <td class="cell-scheme">${r.website ? `<a href="${esc(r.website)}" target="_blank" rel="noopener"><strong>${esc(r.name)}</strong></a>` : `<strong>${esc(r.name)}</strong>`}${r.host ? `<span class="sub">${esc(r.host)}</span>` : ""}</td>
        <td>${esc(r.city)}<span class="sub">${esc(r.state)}</span></td>
        <td><span class="inc-badge t-${typeCls(r.type)}">${esc(TYPE_SHORT[r.type] || r.type)}</span></td>
        <td>${esc(supportTag(r.supportedBy) || "—")}</td>
        <td class="i-tcontact">${[r.phone ? `<a href="tel:${esc(telHref(r.phone))}">${esc(r.phone)}</a>` : "", r.email ? `<a href="mailto:${esc(r.email)}">${IC.mail}</a>` : ""].filter(Boolean).join(" ") || "—"}</td>
      </tr>`;

    const emptyState = () => `<div class="empty-state"><div class="big">🔍</div><p>No incubators match those filters.</p><p class="small"><button class="btn-ghost btn" id="i-reset2">Reset all filters</button></p></div>`;
    const wireReset2 = () => { const r2 = $("#i-reset2"); r2 && r2.addEventListener("click", reset); };

    /* ---- map view ---- */
    const bucket = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : n <= 20 ? 4 : 5);
    const panelItem = (r) => `
      <div class="inc-pi">
        <div class="inc-pi-h">${r.website ? `<a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)} <span class="inc-badge t-${typeCls(r.type)}">${esc(TYPE_SHORT[r.type] || r.type)}</span></div>
        ${r.host ? `<div class="inc-pi-sub">${esc(r.host)}</div>` : ""}
        <div class="inc-pi-sub">${esc(r.city)}, ${esc(r.state)}${supportTag(r.supportedBy) ? ` · ${esc(supportTag(r.supportedBy))}` : ""}</div>
        ${contactRow(r)}
      </div>`;

    const renderMap = () => {
      const found = DATA.filter(matches);
      const counts = {};
      found.forEach((r) => (counts[r.state] = (counts[r.state] || 0) + 1));
      const [W, H] = MAP.viewBox;
      const p = MAP.proj;
      const P = (lng, lat) => [p.pad + (lng * p.cosLat0 - p.rxMin) * p.s, p.pad + (p.ryMax - lat) * p.s];

      const paths = Object.entries(MAP.states).map(([name, st]) => {
        const n = counts[name] || 0;
        const sel = state.state === name ? " sel" : "";
        return `<path d="${st.d}" class="h${bucket(n)}${sel}" data-state="${esc(name)}" tabindex="0" role="button" aria-label="${esc(name)}: ${n} incubator${n === 1 ? "" : "s"}"></path>`;
      }).join("");

      // aggregate markers by exact city coords
      const cityMap = {};
      found.forEach((r) => {
        const k = `${r.lat},${r.lng}`;
        (cityMap[k] = cityMap[k] || { lat: r.lat, lng: r.lng, city: r.city, items: [] }).items.push(r);
      });
      const markers = Object.values(cityMap).sort((a, b) => a.items.length - b.items.length).map((c) => {
        const [x, y] = P(c.lng, c.lat);
        const n = c.items.length;
        const rad = Math.min(15, 3.5 + Math.sqrt(n) * 2.3);
        const active = state.city === `${c.lat},${c.lng}` ? " active" : "";
        return `<circle class="inc-marker${active}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" data-key="${c.lat},${c.lng}" tabindex="0" role="button" aria-label="${esc(c.city)}: ${n} incubator${n === 1 ? "" : "s"}"><title>${esc(c.city)}: ${n}</title></circle>`;
      }).join("");

      // panel scope
      let panelItems, scopeLabel;
      if (state.city) {
        panelItems = found.filter((r) => `${r.lat},${r.lng}` === state.city);
        scopeLabel = `${panelItems[0] ? esc(panelItems[0].city) : "City"} · ${panelItems.length}`;
      } else {
        panelItems = found;
        scopeLabel = `${state.state ? esc(state.state) : "All US"} · ${found.length}`;
      }
      const legend = [["h1", "1–2"], ["h2", "3–5"], ["h3", "6–10"], ["h4", "11–20"], ["h5", "20+"]]
        .map(([c, l]) => `<span class="inc-leg"><span class="sw ${c}"></span>${l}</span>`).join("");

      els.out.innerHTML = `
        <div class="inc-mapwrap">
          <div class="inc-map-col">
            <div class="inc-map-scroll">
              <svg class="inc-map" viewBox="0 0 ${W} ${H}" role="group" aria-label="Map of the US — incubators by state. Select a state to filter.">${paths}${markers}</svg>
            </div>
            <div class="inc-legend"><span class="inc-leg-t">Incubators per state</span>${legend}<span class="inc-leg-m"><span class="dot"></span>city</span></div>
          </div>
          <aside class="inc-panel" aria-label="Incubators list">
            <div class="inc-panel-head">
              <span class="inc-scope">${scopeLabel}</span>
              ${state.state || state.city ? `<button class="i-chip i-clear" id="i-clear-sel">${IC.close} Clear</button>` : ""}
            </div>
            <div class="inc-panel-list">${panelItems.length ? panelItems.map(panelItem).join("") : `<p class="muted small" style="padding:12px">No incubators here. ${state.q || state.type || state.support ? "Try clearing filters." : ""}</p>`}</div>
          </aside>
        </div>`;

      $$(".inc-map path", els.out).forEach((el) => {
        const pick = () => { const nm = el.dataset.state; state.state = state.state === nm ? "" : nm; state.city = ""; els.state.value = state.state; render(); };
        el.addEventListener("click", pick);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      });
      $$(".inc-marker", els.out).forEach((el) => {
        const pick = () => { state.city = state.city === el.dataset.key ? "" : el.dataset.key; render(); };
        el.addEventListener("click", pick);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      });
      const clr = $("#i-clear-sel");
      clr && clr.addEventListener("click", () => { state.state = ""; state.city = ""; els.state.value = ""; render(); });
    };

    const render = () => {
      const found = DATA.filter(matches);
      els.count.innerHTML = `Showing <b>${found.length}</b> of ${DATA.length} incubators`;
      els.viewBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
      if (state.view === "map") { renderMap(); return; }
      if (!found.length) { els.out.innerHTML = emptyState(); wireReset2(); return; }
      if (state.view === "cards") {
        els.out.innerHTML = `<div class="inc-grid">${found.map(cardHTML).join("")}</div>`;
      } else if (state.view === "table") {
        els.out.innerHTML = `<div class="table-wrap"><table class="data inc-table">
          <thead><tr><th>Incubator</th><th>City</th><th>Type</th><th>Support</th><th>Contact</th></tr></thead>
          <tbody>${found.map(rowHTML).join("")}</tbody></table></div>`;
      } else if (state.view === "state") {
        const byState = {};
        found.forEach((r) => (byState[r.state] = byState[r.state] || []).push(r));
        els.out.innerHTML = Object.keys(byState).sort().map((st) => `
          <section class="inc-state-group">
            <h3 class="inc-state-h">${esc(st)} <span class="count-pill">${byState[st].length}</span></h3>
            <div class="inc-grid">${byState[st].map(cardHTML).join("")}</div>
          </section>`).join("");
      }
    };

    const reset = () => {
      state.q = state.state = state.type = state.support = state.city = "";
      els.q.value = ""; [els.state, els.type, els.support].forEach((el) => el && (el.value = ""));
      render();
    };

    els.q.addEventListener("input", () => { state.q = els.q.value.trim().toLowerCase(); state.city = ""; render(); });
    ["state", "type", "support"].forEach((k) => els[k] && els[k].addEventListener("change", () => { state[k] = els[k].value; state.city = ""; render(); }));
    els.reset && els.reset.addEventListener("click", reset);
    els.viewBtns.forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; state.city = ""; render(); }));

    // deep links: incubators.html?q=...&state=...&type=...&view=...
    const params = new URLSearchParams(location.search);
    if (params.get("q")) { state.q = params.get("q").toLowerCase(); els.q.value = params.get("q"); }
    ["state", "type", "support", "view"].forEach((k) => {
      const v = params.get(k);
      if (!v) return;
      if (k === "view" && els.viewBtns.some((b) => b.dataset.view === v)) state.view = v;
      else if (els[k] && [...els[k].options].some((o) => o.value === v)) { state[k] = v; els[k].value = v; }
    });
    render();
  }

  /* ================= STATE SCHEMES ================= */
  const ssRoot = $("#state-schemes");
  if (ssRoot) {
    const DATA = readJSON("state-schemes-data") || []; // array of state objects
    const MAP = readJSON("india-map-data");
    const svg2 = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14">${d}</svg>`;
    const I2 = {
      ext: svg2('<path d="M15 3h6v6m0-6L10 14M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
      close: svg2('<path d="M18 6 6 18M6 6l12 12"/>'),
    };
    const tCls = (t) => t.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "portal"; } };

    const byState = new Map(DATA.map((s) => [s.state, s]));
    const flat = DATA.flatMap((s) => s.schemes.map((sc) => ({ ...sc, state: s.state, policy: s.policy })));

    const st = { q: "", state: "", type: "", view: "state" };
    const els = {
      q: $("#s-q"), state: $("#s-state"), type: $("#s-type"),
      count: $("#s-count"), out: $("#ss-out"), viewBtns: $$("#s-view-toggle button"), reset: $("#s-reset"),
    };

    const schemeMatches = (sc, stateName, policy) =>
      (!st.type || sc.type === st.type) &&
      (!st.state || stateName === st.state) &&
      (!st.q || `${sc.name} ${sc.benefit} ${sc.description} ${sc.eligibility} ${sc.type} ${stateName} ${policy}`.toLowerCase().includes(st.q));

    const schemeCard = (sc, showState) => `
      <div class="ss-scheme">
        <div class="ss-scheme-top">
          <span class="ss-badge s-${tCls(sc.type)}">${esc(sc.type)}</span>
          ${sc.benefit ? `<span class="ss-benefit">${esc(sc.benefit)}</span>` : ""}
          ${showState ? `<span class="ss-state-tag">${esc(sc.state)}</span>` : ""}
        </div>
        <h4>${sc.url ? `<a href="${esc(sc.url)}" target="_blank" rel="noopener">${esc(sc.name)}</a>` : esc(sc.name)}</h4>
        ${sc.description ? `<p class="ss-desc">${esc(sc.description)}</p>` : ""}
        ${sc.eligibility ? `<p class="ss-elig"><span>Eligibility</span> ${esc(sc.eligibility)}</p>` : ""}
      </div>`;

    const stateHeader = (s, n) => `
      <div class="ss-state-head">
        <div class="ss-state-title"><h3>${esc(s.state)}</h3>${n != null ? `<span class="count-pill">${n}</span>` : ""}</div>
        ${s.policy ? `<div class="ss-policy">${esc(s.policy)}${s.period ? ` · ${esc(s.period)}` : ""}</div>` : ""}
        ${s.summary ? `<p class="ss-summary">${esc(s.summary)}</p>` : ""}
        <div class="ss-metarow">
          ${s.nodalAgency ? `<span class="ss-agency">${esc(s.nodalAgency)}</span>` : ""}
          ${(s.sectors || []).slice(0, 6).map((x) => `<span class="inc-sec">${esc(x)}</span>`).join("")}
          ${s.portal ? `<a class="i-chip" href="${esc(s.portal)}" target="_blank" rel="noopener">${I2.ext} ${esc(host(s.portal))}</a>` : ""}
        </div>
      </div>`;

    const emptyMsg = () => `<div class="empty-state"><div class="big">🔍</div><p>No state schemes match those filters.</p><p class="small"><button class="btn-ghost btn" id="s-reset2">Reset all filters</button></p></div>`;

    const renderStateView = (matchByState) => {
      const names = [...matchByState.keys()].sort();
      els.out.innerHTML = names.map((name) => {
        const s = byState.get(name);
        const list = matchByState.get(name);
        return `<section class="ss-group">${stateHeader(s, list.length)}<div class="ss-schemes">${list.map((sc) => schemeCard(sc, false)).join("")}</div></section>`;
      }).join("");
    };

    const bucket = (n) => (n === 0 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : n <= 9 ? 3 : n <= 12 ? 4 : 5);
    const renderMap = (matchByState) => {
      // choropleth reflects q + type but NOT the state selection, so the
      // whole distribution stays visible while one state is highlighted
      const counts = {};
      for (const s of DATA) {
        const n = s.schemes.filter((sc) =>
          (!st.type || sc.type === st.type) &&
          (!st.q || `${sc.name} ${sc.benefit} ${sc.description} ${sc.eligibility} ${sc.type} ${s.state} ${s.policy}`.toLowerCase().includes(st.q))
        ).length;
        if (n) counts[s.state] = n;
      }
      const [W, H] = MAP.viewBox;
      const paths = Object.entries(MAP.states).map(([name, sp]) => {
        const n = counts[name] || 0;
        const sel = st.state === name ? " sel" : "";
        return `<path d="${sp.d}" class="h${bucket(n)}${sel}" data-state="${esc(name)}" tabindex="0" role="button" aria-label="${esc(name)}: ${n} scheme${n === 1 ? "" : "s"}"></path>`;
      }).join("");
      const legend = [["h1", "1–3"], ["h2", "4–6"], ["h3", "7–9"], ["h4", "10–12"], ["h5", "13+"]]
        .map(([c, l]) => `<span class="inc-leg"><span class="sw ${c}"></span>${l}</span>`).join("");

      let panel;
      if (st.state && byState.get(st.state)) {
        const s = byState.get(st.state);
        const list = matchByState.get(st.state) || [];
        panel = `<div class="inc-panel-head"><span class="inc-scope">${esc(st.state)} · ${list.length}</span><button class="i-chip i-clear" id="s-clear-sel">${I2.close} Clear</button></div>
          <div class="inc-panel-list ss-panel-list">${stateHeader(s, null)}${list.map((sc) => schemeCard(sc, false)).join("") || `<p class="muted small" style="padding:12px">No schemes match filters in ${esc(st.state)}.</p>`}</div>`;
      } else {
        const tot = [...matchByState.values()].reduce((a, l) => a + l.length, 0);
        const rows = [...matchByState.entries()].sort((a, b) => b[1].length - a[1].length)
          .map(([name, list]) => `<button class="ss-pick" data-pick="${esc(name)}"><span>${esc(name)}</span><span class="count-pill">${list.length}</span></button>`).join("");
        panel = `<div class="inc-panel-head"><span class="inc-scope">All US · ${tot}</span></div>
          <div class="inc-panel-list"><p class="muted small" style="padding:10px 12px 4px">Select a state on the map, or:</p>${rows}</div>`;
      }

      els.out.innerHTML = `
        <div class="inc-mapwrap">
          <div class="inc-map-col">
            <div class="inc-map-scroll"><svg class="inc-map" viewBox="0 0 ${W} ${H}" role="group" aria-label="Map of the US — state schemes by count. Select a state to filter.">${paths}</svg></div>
            <div class="inc-legend"><span class="inc-leg-t">Schemes per state</span>${legend}</div>
          </div>
          <aside class="inc-panel" aria-label="State schemes">${panel}</aside>
        </div>`;

      $$(".inc-map path", els.out).forEach((el) => {
        const pick = () => { const nm = el.dataset.state; st.state = st.state === nm ? "" : nm; els.state.value = st.state; render(); };
        el.addEventListener("click", pick);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      });
      $$("[data-pick]", els.out).forEach((b) => b.addEventListener("click", () => { st.state = b.dataset.pick; els.state.value = st.state; render(); }));
      const clr = $("#s-clear-sel");
      clr && clr.addEventListener("click", () => { st.state = ""; els.state.value = ""; render(); });
    };

    const render = () => {
      // group matching schemes by state
      const matchByState = new Map();
      for (const s of DATA) {
        const list = s.schemes.filter((sc) => schemeMatches(sc, s.state, s.policy));
        if (list.length) matchByState.set(s.state, list);
      }
      const total = [...matchByState.values()].reduce((a, l) => a + l.length, 0);
      els.count.innerHTML = `Showing <b>${total}</b> of ${flat.length} schemes across <b>${matchByState.size}</b> states`;
      els.viewBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === st.view)));

      if (st.view === "map") { renderMap(matchByState); return; }
      if (!total) { els.out.innerHTML = emptyMsg(); const r2 = $("#s-reset2"); r2 && r2.addEventListener("click", reset); return; }
      if (st.view === "state") { renderStateView(matchByState); return; }
      // list view: flat cards
      const items = flat.filter((sc) => schemeMatches(sc, sc.state, sc.policy));
      els.out.innerHTML = `<div class="ss-schemes ss-flat">${items.map((sc) => schemeCard(sc, true)).join("")}</div>`;
    };

    const reset = () => {
      st.q = st.state = st.type = ""; els.q.value = "";
      [els.state, els.type].forEach((el) => el && (el.value = ""));
      render();
    };

    els.q.addEventListener("input", () => { st.q = els.q.value.trim().toLowerCase(); render(); });
    ["state", "type"].forEach((k) => els[k] && els[k].addEventListener("change", () => { st[k] = els[k].value; render(); }));
    els.reset && els.reset.addEventListener("click", reset);
    els.viewBtns.forEach((b) => b.addEventListener("click", () => { st.view = b.dataset.view; render(); }));

    const params = new URLSearchParams(location.search);
    if (params.get("q")) { st.q = params.get("q").toLowerCase(); els.q.value = params.get("q"); }
    ["state", "type", "view"].forEach((k) => {
      const v = params.get(k);
      if (!v) return;
      if (k === "view" && els.viewBtns.some((b) => b.dataset.view === v)) st.view = v;
      else if (els[k] && [...els[k].options].some((o) => o.value === v)) { st[k] = v; els[k].value = v; }
    });
    render();
  }
})();
