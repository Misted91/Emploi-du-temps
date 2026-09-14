// ============================================================
//  Backend ÉcoleDirecte — fonction serverless (Vercel)
//  Rôle : se connecter à ÉcoleDirecte et renvoyer l'emploi du temps.
//
//  ⚠️  L'API d'ÉcoleDirecte est NON officielle. Elle peut changer
//      sans préavis. Si l'import cesse de marcher, il faut le plus
//      souvent mettre à jour la constante API_VERSION ci-dessous.
// ============================================================

const API = "https://api.ecoledirecte.com/v3";
// version de l'API ÉcoleDirecte — surchargeable via variable d'env ED_VERSION
const API_VERSION = process.env.ED_VERSION || "4.64.0";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Palette pastel (identique au site) : couleur lisible attribuée par matière.
const PALETTE = [
  "#c7d7fd", "#c3ecd6", "#ffe0b3", "#ffd0d6",
  "#e2d1fb", "#c9eef2", "#fbe8a6", "#d9dee6",
];

// ---------- Petits utilitaires ----------
// ÉcoleDirecte attend le corps « data=<json brut> » SANS ré-encodage
// (c'est ce qu'envoient les clients qui fonctionnent). Ré-encoder casse
// la lecture du mot de passe => "identifiant/mot de passe invalide".
function formBody(obj) {
  return "data=" + JSON.stringify(obj);
}
function b64decode(s) { return Buffer.from(s, "base64").toString("utf-8"); }
function b64encode(s) { return Buffer.from(s, "utf-8").toString("base64"); }

function setCookies(resp) {
  if (typeof resp.headers.getSetCookie === "function") {
    const arr = resp.headers.getSetCookie();
    if (arr && arr.length) return arr;
  }
  // Repli : en-tête brut (undici joint les cookies par ", ")
  const raw = resp.headers.get("set-cookie");
  return raw ? [raw] : [];
}

// Récupère le jeton GTK (obligatoire avant la connexion).
async function getGtk() {
  const resp = await fetch(`${API}/login.awp?gtk=1&v=${API_VERSION}`, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "fr-FR,fr;q=0.9",
      "Referer": "https://www.ecoledirecte.com/",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  for (const c of setCookies(resp)) {
    const m = /GTK=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

// Appel POST générique vers l'API.
async function edPost(path, dataObj, { token, gtk } = {}) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer": "https://www.ecoledirecte.com/",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (token) headers["X-Token"] = token;
  if (gtk) {
    headers["X-GTK"] = gtk;
    headers["Cookie"] = "GTK=" + gtk;
  }
  const sep = path.includes("?") ? "&" : "?";
  const resp = await fetch(`${API}${path}${sep}v=${API_VERSION}`, {
    method: "POST",
    headers,
    body: formBody(dataObj),
  });
  return resp.json();
}

// ---------- Connexion ----------
async function login(identifiant, motdepasse, fa) {
  const gtk = await getGtk();
  const payload = {
    identifiant,
    motdepasse,
    isReLogin: false,
    uuid: "",
    fa: fa || [],
  };
  const json = await edPost("/login.awp", payload, { gtk });
  json._gtkFound = !!gtk; // diagnostic
  return json;
}

// ---------- Emploi du temps ----------
function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return d;
}
function fmtDate(d) {
  return (
    d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function colorFor(subject) {
  let h = 0;
  for (const ch of subject || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

async function fetchTimetable(accountId, token) {
  const monday = mondayOf(new Date());
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const json = await edPost(
    `/E/${accountId}/emploidutemps.awp?verbe=get`,
    { dateDebut: fmtDate(monday), dateFin: fmtDate(sunday), avecTrous: false },
    { token }
  );
  if (json.code !== 200) {
    throw new Error(json.message || "Impossible de récupérer l'emploi du temps.");
  }

  const lessons = (json.data || [])
    .filter((l) => !l.isAnnule)
    .map((l) => {
      const [, startTime] = String(l.start_date).split(" ");
      const [, endTime] = String(l.end_date).split(" ");
      const toMin = (t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };
      const wd = new Date(l.start_date.replace(" ", "T")).getDay();
      const parts = [l.salle, l.prof].filter(Boolean);
      return {
        id: "ed" + l.id,
        day: DAY_KEYS[wd],
        start: toMin(startTime),
        end: toMin(endTime),
        title: l.matiere || l.text || "Cours",
        room: parts.join(" — "),
        color: colorFor(l.matiere || l.text),
      };
    });

  return lessons;
}

function accountId(loginJson) {
  const acc = (loginJson.data && loginJson.data.accounts && loginJson.data.accounts[0]) || {};
  if (acc.typeCompte === "1" && acc.profile && acc.profile.eleves && acc.profile.eleves.length) {
    return acc.profile.eleves[0].id; // compte famille -> premier élève
  }
  return acc.id;
}

// ============================================================
//  Handler HTTP
// ============================================================
export default async function handler(req, res) {
  // CORS (utile si le site est ouvert depuis GitHub Pages)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const { identifiant, motdepasse, token, choix, cn, cv } = body;

  if (!identifiant || !motdepasse) {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }

  try {
    // --- Étape B : l'utilisateur vient de répondre au QCM ---
    if (choix && token) {
      const da = await edPost(
        "/connexion/doubleauth.awp?verbe=post",
        { choix: b64encode(choix) },
        { token }
      );
      if (da.code !== 200 || !da.data) {
        return res.status(401).json({ error: "Réponse de sécurité incorrecte." });
      }
      const fa = [{ cn: da.data.cn, cv: da.data.cv }];
      const l = await login(identifiant, motdepasse, fa);
      if (l.code !== 200) {
        return res.status(401).json({ error: l.message || "Échec de la connexion." });
      }
      const lessons = await fetchTimetable(accountId(l), l.token);
      // cn/cv permettent de sauter le QCM les prochaines fois
      return res.status(200).json({ ok: true, lessons, cn: da.data.cn, cv: da.data.cv });
    }

    // --- Connexion (avec cn/cv mémorisés si dispo) ---
    const fa = cn && cv ? [{ cn, cv }] : [];
    const l = await login(identifiant, motdepasse, fa);

    // --- Double authentification demandée ---
    if (l.code === 250) {
      const da = await edPost("/connexion/doubleauth.awp?verbe=get", {}, { token: l.token });
      if (da.code !== 200 || !da.data) {
        return res.status(401).json({ error: "Double authentification indisponible." });
      }
      return res.status(200).json({
        needAuth: true,
        token: l.token,
        question: b64decode(da.data.question),
        propositions: (da.data.propositions || []).map(b64decode),
      });
    }

    if (l.code !== 200) {
      return res.status(401).json({
        error: (l.message || "Identifiant ou mot de passe incorrect.") +
          " (code ÉD " + l.code + ", GTK " + (l._gtkFound ? "ok" : "manquant") +
          ", v " + API_VERSION + ")",
        code: l.code,
      });
    }

    const lessons = await fetchTimetable(accountId(l), l.token);
    return res.status(200).json({ ok: true, lessons });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur serveur." });
  }
}
