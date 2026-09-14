// ===== Emploi du temps personnalisable =====
(function () {
  "use strict";

  const DAYS = [
    { key: "mon", label: "Lundi" },
    { key: "tue", label: "Mardi" },
    { key: "wed", label: "Mercredi" },
    { key: "thu", label: "Jeudi" },
    { key: "fri", label: "Vendredi" },
    { key: "sat", label: "Samedi" },
    { key: "sun", label: "Dimanche" },
  ];

  const COLORS = [
    "#c7d7fd", "#c3ecd6", "#ffe0b3", "#ffd0d6",
    "#e2d1fb", "#c9eef2", "#fbe8a6", "#d9dee6",
  ];

  const STORAGE_KEY = "edt.data.v1";

  const DEFAULT_STATE = {
    settings: {
      startHour: 8,
      endHour: 18,
      step: 60, // minutes
      days: ["mon", "tue", "wed", "thu", "fri"],
    },
    courses: [],
  };

  let state = load();
  let editingId = null;      // id du cours en cours d'édition (null = nouveau)
  let selectedColor = COLORS[0];

  // ---------- Persistance ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return {
        settings: Object.assign({}, DEFAULT_STATE.settings, parsed.settings),
        courses: Array.isArray(parsed.courses) ? parsed.courses : [],
      };
    } catch (e) {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* stockage indisponible : on ignore */ }
  }

  // ---------- Utilitaires ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function minutesToLabel(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function slotCount() {
    const s = state.settings;
    return Math.max(1, Math.round(((s.endHour - s.startHour) * 60) / s.step));
  }
  function slotMinutes(i) { return state.settings.startHour * 60 + i * state.settings.step; }
  function activeDays() { return DAYS.filter((d) => state.settings.days.includes(d.key)); }

  function timeOptions() {
    const opts = [];
    const total = slotCount();
    for (let i = 0; i <= total; i++) {
      const m = slotMinutes(i);
      opts.push({ value: m, label: minutesToLabel(m) });
    }
    return opts;
  }

  // ---------- Rendu de la grille ----------
  function render() {
    const tt = document.getElementById("timetable");
    tt.innerHTML = "";
    const days = activeDays();
    const rows = slotCount();
    const step = state.settings.step;

    tt.style.gridTemplateColumns = `70px repeat(${days.length}, minmax(120px, 1fr))`;
    tt.style.gridTemplateRows = `auto repeat(${rows}, minmax(38px, auto))`;

    // Coin haut-gauche
    tt.appendChild(el("div", "tt-cell tt-corner"));

    // En-têtes de jours
    days.forEach((d) => {
      const head = el("div", "tt-dayhead");
      head.textContent = d.label;
      tt.appendChild(head);
    });

    // Labels d'heures (colonne 1)
    for (let i = 0; i < rows; i++) {
      const t = el("div", "tt-cell tt-timehead");
      t.style.gridColumn = "1";
      t.style.gridRow = String(i + 2);
      t.textContent = minutesToLabel(slotMinutes(i));
      tt.appendChild(t);
    }

    // Cases + cours, colonne par colonne
    days.forEach((d, colIdx) => {
      const col = colIdx + 2;
      const dayCourses = state.courses
        .filter((c) => c.day === d.key)
        .sort((a, b) => a.start - b.start);

      // occupation : index de slot -> "start"|"covered"
      const occ = new Array(rows).fill(null);
      const startAt = {}; // slotIndex -> course
      dayCourses.forEach((c) => {
        const sIdx = Math.round((c.start - state.settings.startHour * 60) / step);
        const eIdx = Math.round((c.end - state.settings.startHour * 60) / step);
        if (sIdx < 0 || sIdx >= rows) return;
        startAt[sIdx] = { course: c, span: Math.max(1, Math.min(eIdx, rows) - sIdx) };
        for (let k = sIdx; k < Math.min(eIdx, rows); k++) occ[k] = k === sIdx ? "start" : "covered";
      });

      for (let i = 0; i < rows; i++) {
        if (occ[i] === "covered") continue;
        if (occ[i] === "start") {
          const { course, span } = startAt[i];
          const node = renderCourse(course);
          node.style.gridColumn = String(col);
          node.style.gridRow = `${i + 2} / span ${span}`;
          tt.appendChild(node);
        } else {
          const slot = el("div", "tt-cell tt-slot");
          slot.style.gridColumn = String(col);
          slot.style.gridRow = String(i + 2);
          slot.addEventListener("click", () => openCourseModal(null, d.key, slotMinutes(i)));
          tt.appendChild(slot);
        }
      }
    });
  }

  function renderCourse(c) {
    const node = el("div", "tt-course");
    node.style.background = c.color || COLORS[0];
    const title = el("div", "c-title");
    title.textContent = c.title;
    node.appendChild(title);
    if (c.room) {
      const room = el("div", "c-room");
      room.textContent = c.room;
      node.appendChild(room);
    }
    const meta = el("div", "c-room");
    meta.textContent = minutesToLabel(c.start) + " – " + minutesToLabel(c.end);
    node.appendChild(meta);
    node.addEventListener("click", () => openCourseModal(c.id));
    return node;
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---------- Modale cours ----------
  function fillSelect(sel, options, selected) {
    sel.innerHTML = "";
    options.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (String(o.value) === String(selected)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderPalette() {
    const pal = document.getElementById("colorPalette");
    pal.innerHTML = "";
    COLORS.forEach((c) => {
      const sw = el("div", "swatch" + (c === selectedColor ? " selected" : ""));
      sw.style.background = c;
      sw.addEventListener("click", () => {
        selectedColor = c;
        renderPalette();
      });
      pal.appendChild(sw);
    });
  }

  function openCourseModal(id, presetDay, presetStart) {
    editingId = id;
    const times = timeOptions();
    const course = id ? state.courses.find((c) => c.id === id) : null;

    document.getElementById("modalTitle").textContent = course ? "Modifier le cours" : "Ajouter un cours";
    document.getElementById("courseTitle").value = course ? course.title : "";
    document.getElementById("courseRoom").value = course ? course.room || "" : "";

    const daySel = document.getElementById("courseDay");
    fillSelect(daySel, activeDays().map((d) => ({ value: d.key, label: d.label })),
      course ? course.day : (presetDay || activeDays()[0].key));

    const start = course ? course.start : (presetStart != null ? presetStart : times[0].value);
    const end = course ? course.end : Math.min(start + state.settings.step, times[times.length - 1].value);
    fillSelect(document.getElementById("courseStart"), times, start);
    fillSelect(document.getElementById("courseEnd"), times, end);

    selectedColor = course ? (course.color || COLORS[0]) : COLORS[state.courses.length % COLORS.length];
    renderPalette();

    document.getElementById("deleteCourseBtn").hidden = !course;
    show("courseModal");
    document.getElementById("courseTitle").focus();
  }

  function submitCourse(e) {
    e.preventDefault();
    const title = document.getElementById("courseTitle").value.trim();
    const room = document.getElementById("courseRoom").value.trim();
    const day = document.getElementById("courseDay").value;
    const start = parseInt(document.getElementById("courseStart").value, 10);
    let end = parseInt(document.getElementById("courseEnd").value, 10);
    if (!title) return;
    if (end <= start) end = start + state.settings.step;

    if (editingId) {
      const c = state.courses.find((x) => x.id === editingId);
      Object.assign(c, { title, room, day, start, end, color: selectedColor });
    } else {
      state.courses.push({
        id: "c" + Date.now() + Math.random().toString(36).slice(2, 6),
        title, room, day, start, end, color: selectedColor,
      });
    }
    save();
    render();
    hide("courseModal");
  }

  function deleteCourse() {
    if (!editingId) return;
    state.courses = state.courses.filter((c) => c.id !== editingId);
    save();
    render();
    hide("courseModal");
  }

  // ---------- Modale réglages ----------
  function openSettings() {
    const s = state.settings;
    document.getElementById("setStart").value = s.startHour;
    document.getElementById("setEnd").value = s.endHour;
    document.getElementById("setStep").value = String(s.step);

    const wrap = document.getElementById("daysToggle");
    wrap.innerHTML = "";
    DAYS.forEach((d) => {
      const chip = el("div", "day-chip" + (s.days.includes(d.key) ? " active" : ""));
      chip.textContent = d.label;
      chip.dataset.key = d.key;
      chip.addEventListener("click", () => chip.classList.toggle("active"));
      wrap.appendChild(chip);
    });
    show("settingsModal");
  }

  function saveSettings() {
    let startHour = clamp(parseInt(document.getElementById("setStart").value, 10), 0, 23);
    let endHour = clamp(parseInt(document.getElementById("setEnd").value, 10), 1, 24);
    if (endHour <= startHour) endHour = startHour + 1;
    const step = parseInt(document.getElementById("setStep").value, 10) === 30 ? 30 : 60;

    const days = Array.from(document.querySelectorAll("#daysToggle .day-chip.active"))
      .map((c) => c.dataset.key);

    state.settings = {
      startHour, endHour, step,
      days: days.length ? DAYS.filter((d) => days.includes(d.key)).map((d) => d.key) : ["mon"],
    };
    save();
    render();
    hide("settingsModal");
  }

  function clamp(n, min, max) {
    if (isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // ---------- Import / Export ----------
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "emploi-du-temps.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        state = {
          settings: Object.assign({}, DEFAULT_STATE.settings, parsed.settings || {}),
          courses: Array.isArray(parsed.courses) ? parsed.courses : [],
        };
        save();
        render();
      } catch (e) {
        alert("Fichier invalide : impossible d'importer cet emploi du temps.");
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm("Vider tout l'emploi du temps ? Cette action est irréversible.")) return;
    state.courses = [];
    save();
    render();
  }

  // ---------- ÉcoleDirecte ----------
  const ED_API = "/api/edt";       // même domaine (Vercel) -> chemin relatif
  const ED_CREDS_KEY = "edt.ed.cnv"; // cn/cv mémorisés (pour sauter le QCM)
  let edPendingToken = null;       // jeton temporaire pendant la double auth

  function edShow(id) { document.getElementById(id).hidden = false; }
  function edHide(id) { document.getElementById(id).hidden = true; }

  function edMessage(text, kind) {
    const m = document.getElementById("edMessage");
    if (!text) { m.hidden = true; return; }
    m.hidden = false;
    m.textContent = text;
    m.className = "ed-message " + (kind || "info");
  }

  function openEd() {
    edPendingToken = null;
    edHide("edAuthStep");
    edShow("edLoginStep");
    edMessage("", "info");
    document.getElementById("edPropositions").innerHTML = "";
    document.getElementById("edConnectBtn").disabled = false;
    document.getElementById("edConnectBtn").textContent = "Se connecter";
    show("edModal");
    document.getElementById("edUser").focus();
  }

  async function edCall(payload) {
    const res = await fetch(ED_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  function edStoredCreds() {
    try { return JSON.parse(localStorage.getItem(ED_CREDS_KEY) || "null"); }
    catch (e) { return null; }
  }

  async function edConnect() {
    const identifiant = document.getElementById("edUser").value.trim();
    const motdepasse = document.getElementById("edPass").value;
    if (!identifiant || !motdepasse) {
      edMessage("Renseigne ton identifiant et ton mot de passe.", "error");
      return;
    }
    const btn = document.getElementById("edConnectBtn");
    btn.disabled = true;
    btn.textContent = "Connexion…";
    edMessage("Connexion à ÉcoleDirecte…", "info");

    try {
      const saved = edStoredCreds() || {};
      const data = await edCall({ identifiant, motdepasse, cn: saved.cn, cv: saved.cv });

      if (data.needAuth) {
        edPendingToken = data.token;
        edShowAuth(identifiant, motdepasse, data.question, data.propositions);
        return;
      }
      if (data.ok) {
        edSaveCnv(data);
        edFinish(data.lessons);
        return;
      }
      edMessage(data.error || "Échec de la connexion.", "error");
    } catch (e) {
      edMessage("Impossible de joindre le backend. Le site doit être ouvert depuis l'adresse Vercel.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Se connecter";
    }
  }

  function edShowAuth(identifiant, motdepasse, question, propositions) {
    edHide("edLoginStep");
    edShow("edAuthStep");
    edMessage("Réponds à la question de sécurité.", "info");
    document.getElementById("edQuestion").textContent = question;
    const box = document.getElementById("edPropositions");
    box.innerHTML = "";
    document.getElementById("edConnectBtn").hidden = true;

    propositions.forEach((p) => {
      const b = el("button", "btn btn-ghost");
      b.type = "button";
      b.textContent = p;
      b.addEventListener("click", () => edAnswer(identifiant, motdepasse, p));
      box.appendChild(b);
    });
  }

  async function edAnswer(identifiant, motdepasse, choix) {
    edMessage("Vérification…", "info");
    Array.from(document.querySelectorAll("#edPropositions .btn")).forEach((b) => (b.disabled = true));
    try {
      const data = await edCall({ identifiant, motdepasse, token: edPendingToken, choix });
      if (data.ok) {
        edSaveCnv(data);
        edFinish(data.lessons);
        return;
      }
      edMessage(data.error || "Réponse incorrecte.", "error");
      Array.from(document.querySelectorAll("#edPropositions .btn")).forEach((b) => (b.disabled = false));
    } catch (e) {
      edMessage("Erreur réseau. Réessaie.", "error");
      Array.from(document.querySelectorAll("#edPropositions .btn")).forEach((b) => (b.disabled = false));
    }
  }

  function edSaveCnv(data) {
    if (data.cn && data.cv) {
      try { localStorage.setItem(ED_CREDS_KEY, JSON.stringify({ cn: data.cn, cv: data.cv })); }
      catch (e) { /* ignore */ }
    }
  }

  function edFinish(lessons) {
    document.getElementById("edConnectBtn").hidden = false;
    if (!lessons || !lessons.length) {
      edMessage("Connecté, mais aucun cours trouvé pour cette semaine.", "error");
      return;
    }
    applyImportedLessons(lessons);
    hide("edModal");
  }

  // Remplace l'emploi du temps et ajuste la grille aux cours importés.
  function applyImportedLessons(lessons) {
    let minStart = 24 * 60, maxEnd = 0;
    const daysPresent = new Set();
    let half = false;
    lessons.forEach((l) => {
      minStart = Math.min(minStart, l.start);
      maxEnd = Math.max(maxEnd, l.end);
      daysPresent.add(l.day);
      if (l.start % 60 !== 0 || l.end % 60 !== 0) half = true;
    });
    const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    state.settings.days = order.filter((d) => daysPresent.has(d));
    if (!state.settings.days.length) state.settings.days = ["mon"];
    state.settings.startHour = Math.max(0, Math.floor(minStart / 60));
    state.settings.endHour = Math.min(24, Math.ceil(maxEnd / 60));
    if (state.settings.endHour <= state.settings.startHour) state.settings.endHour = state.settings.startHour + 1;
    state.settings.step = half ? 30 : state.settings.step;
    state.courses = lessons;
    save();
    render();
  }

  // ---------- Helpers modales ----------
  function show(id) { document.getElementById(id).hidden = false; }
  function hide(id) { document.getElementById(id).hidden = true; }

  // ---------- Événements ----------
  function bind() {
    document.getElementById("courseForm").addEventListener("submit", submitCourse);
    document.getElementById("cancelBtn").addEventListener("click", () => hide("courseModal"));
    document.getElementById("deleteCourseBtn").addEventListener("click", deleteCourse);

    document.getElementById("edBtn").addEventListener("click", openEd);
    document.getElementById("edConnectBtn").addEventListener("click", edConnect);
    document.getElementById("edCancelBtn").addEventListener("click", () => hide("edModal"));

    document.getElementById("settingsBtn").addEventListener("click", openSettings);
    document.getElementById("settingsSaveBtn").addEventListener("click", saveSettings);
    document.getElementById("settingsCancelBtn").addEventListener("click", () => hide("settingsModal"));

    document.getElementById("exportBtn").addEventListener("click", exportData);
    document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    document.getElementById("printBtn").addEventListener("click", () => window.print());
    document.getElementById("clearBtn").addEventListener("click", clearAll);

    // Fermer une modale en cliquant sur le fond ou avec Échap
    document.querySelectorAll(".modal-backdrop").forEach((b) => {
      b.addEventListener("click", (e) => { if (e.target === b) b.hidden = true; });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((b) => (b.hidden = true));
    });
  }

  // ---------- Démarrage ----------
  bind();
  render();
})();
