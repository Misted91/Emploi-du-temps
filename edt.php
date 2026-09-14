<?php
/* ============================================================
 *  Backend ÉcoleDirecte — version PHP (hébergement mutualisé OVH)
 *  À déposer à la racine web, à côté de index.html.
 *
 *  ⚠️ L'API d'ÉcoleDirecte est NON officielle : elle peut changer.
 *     Si l'import cesse de marcher, mettre à jour API_VERSION.
 *
 *  ⚠️ 1re connexion : l'IP du serveur OVH sera bloquée par ÉcoleDirecte
 *     ("IP suspecte"). Un mail est envoyé -> clique "Autoriser la
 *     connexion". L'IP OVH étant fixe, une seule autorisation suffit.
 * ============================================================ */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

const API         = 'https://api.ecoledirecte.com/v3';
const API_VERSION = '4.75.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         . '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

$PALETTE = ['#c7d7fd','#c3ecd6','#ffe0b3','#ffd0d6','#e2d1fb','#c9eef2','#fbe8a6','#d9dee6'];

/* ---------- Appel HTTP générique vers l'API ---------- */
function ed_request($path, $body = null, $token = null, $gtk = null, $cookie = null, &$outCookies = null) {
    $url = API . $path . (strpos($path, '?') !== false ? '&' : '?') . 'v=' . API_VERSION;
    $headers = [
        'User-Agent: ' . UA,
        'Accept: application/json, text/plain, */*',
        'Accept-Language: fr-FR,fr;q=0.9',
        'Referer: https://www.ecoledirecte.com/',
        'X-Requested-With: XMLHttpRequest',
    ];
    if ($body !== null)   $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    if ($token)           $headers[] = 'X-Token: ' . $token;
    if ($gtk)             $headers[] = 'X-Gtk: ' . $gtk;
    if ($cookie)          $headers[] = 'Cookie: ' . $cookie;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_CUSTOMREQUEST  => $body !== null ? 'POST' : 'GET',
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);

    $raw        = curl_exec($ch);
    if ($raw === false) { $err = curl_error($ch); curl_close($ch); return ['__curl_error' => $err]; }
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);

    $rawHeaders = substr($raw, 0, $headerSize);
    $rawBody    = substr($raw, $headerSize);

    if ($outCookies !== null) {
        preg_match_all('/^Set-Cookie:\s*([^;\r\n]+)/im', $rawHeaders, $m);
        $outCookies = $m[1];
    }
    $json = json_decode($rawBody, true);
    return is_array($json) ? $json : ['__parse_error' => true, 'raw' => substr($rawBody, 0, 300)];
}

/* ---------- GTK + tous les cookies ---------- */
function get_gtk() {
    $cookies = [];
    ed_request('/login.awp?gtk=1', null, null, null, null, $cookies);
    $gtk = null; $pairs = [];
    foreach ($cookies as $c) {
        $nv = trim($c);
        $eq = strpos($nv, '=');
        if ($eq === false) continue;
        $name = substr($nv, 0, $eq);
        $val  = substr($nv, $eq + 1);
        if ($name === 'GTK') $gtk = $val;
        $pairs[] = $name . '=' . $val;
    }
    return [$gtk, implode('; ', $pairs)];
}

/* ---------- Connexion ---------- */
function ed_login($identifiant, $motdepasse, $fa = []) {
    list($gtk, $cookie) = get_gtk();
    $payload = [
        'identifiant' => $identifiant,
        'motdepasse'  => $motdepasse,
        'isRelogin'   => false,
        'uuid'        => '',
        'fa'          => $fa ? $fa : [],
    ];
    $body = 'data=' . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $json = ed_request('/login.awp', $body, null, $gtk, $cookie);
    $json['_gtkFound'] = $gtk ? 'ok' : 'manquant';
    return $json;
}

/* ---------- Identifiant du compte élève ---------- */
function account_id($login) {
    $acc = $login['data']['accounts'][0] ?? [];
    if (($acc['typeCompte'] ?? '') === '1' && !empty($acc['profile']['eleves'])) {
        return $acc['profile']['eleves'][0]['id'];
    }
    return $acc['id'] ?? null;
}

/* ---------- Emploi du temps ---------- */
function color_for($subject, $palette) {
    $h = 0;
    $s = $subject ?? '';
    $len = strlen($s);
    for ($i = 0; $i < $len; $i++) $h = ($h * 31 + ord($s[$i])) & 0xFFFFFFFF;
    return $palette[$h % count($palette)];
}

function fetch_timetable($accountId, $token) {
    global $PALETTE;
    $tz = new DateTimeZone('Europe/Paris');
    $monday = new DateTime('now', $tz);
    $dow = (int)$monday->format('N');           // 1 = lundi
    $monday->modify('-' . ($dow - 1) . ' days');
    $sunday = clone $monday; $sunday->modify('+6 days');

    $body = 'data=' . json_encode([
        'dateDebut' => $monday->format('Y-m-d'),
        'dateFin'   => $sunday->format('Y-m-d'),
        'avecTrous' => false,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $json = ed_request('/E/' . $accountId . '/emploidutemps.awp?verbe=get', $body, $token);
    if (($json['code'] ?? 0) !== 200) {
        throw new Exception($json['message'] ?? "Impossible de récupérer l'emploi du temps.");
    }

    $keys = [1 => 'mon', 2 => 'tue', 3 => 'wed', 4 => 'thu', 5 => 'fri', 6 => 'sat', 7 => 'sun'];
    $lessons = [];
    foreach (($json['data'] ?? []) as $l) {
        if (!empty($l['isAnnule'])) continue;
        $start = DateTime::createFromFormat('Y-m-d H:i', $l['start_date']);
        $end   = DateTime::createFromFormat('Y-m-d H:i', $l['end_date']);
        if (!$start || !$end) continue;
        $wd = (int)$start->format('N');
        $parts = array_filter([$l['salle'] ?? '', $l['prof'] ?? '']);
        $lessons[] = [
            'id'    => 'ed' . ($l['id'] ?? uniqid()),
            'day'   => $keys[$wd],
            'start' => ((int)$start->format('H')) * 60 + (int)$start->format('i'),
            'end'   => ((int)$end->format('H')) * 60 + (int)$end->format('i'),
            'title' => $l['matiere'] ?: ($l['text'] ?? 'Cours'),
            'room'  => implode(' — ', $parts),
            'color' => color_for($l['matiere'] ?? ($l['text'] ?? ''), $PALETTE),
        ];
    }
    return $lessons;
}

/* ============================================================
 *  Traitement de la requête
 * ============================================================ */
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];

$identifiant = $input['identifiant'] ?? '';
$motdepasse  = $input['motdepasse']  ?? '';
$token       = $input['token']       ?? null;
$choix       = $input['choix']       ?? null;
$cn          = $input['cn']          ?? null;
$cv          = $input['cv']          ?? null;

if ($identifiant === '' || $motdepasse === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Identifiant et mot de passe requis.']);
    exit;
}

try {
    /* --- Étape B : réponse au QCM de sécurité --- */
    if ($choix && $token) {
        $da = ed_request('/connexion/doubleauth.awp?verbe=post',
            'data=' . json_encode(['choix' => base64_encode($choix)], JSON_UNESCAPED_UNICODE),
            $token);
        if (($da['code'] ?? 0) !== 200 || empty($da['data'])) {
            http_response_code(401);
            echo json_encode(['error' => 'Réponse de sécurité incorrecte.']);
            exit;
        }
        $fa = [['cn' => $da['data']['cn'], 'cv' => $da['data']['cv']]];
        $l = ed_login($identifiant, $motdepasse, $fa);
        if (($l['code'] ?? 0) !== 200) {
            http_response_code(401);
            echo json_encode(['error' => $l['message'] ?? 'Échec de la connexion.']);
            exit;
        }
        $lessons = fetch_timetable(account_id($l), $l['token']);
        echo json_encode(['ok' => true, 'lessons' => $lessons,
                          'cn' => $da['data']['cn'], 'cv' => $da['data']['cv']]);
        exit;
    }

    /* --- Connexion (avec cn/cv mémorisés si dispo) --- */
    $fa = ($cn && $cv) ? [['cn' => $cn, 'cv' => $cv]] : [];
    $l = ed_login($identifiant, $motdepasse, $fa);

    /* --- Double authentification demandée --- */
    if (($l['code'] ?? 0) === 250) {
        $da = ed_request('/connexion/doubleauth.awp?verbe=get', 'data={}', $l['token']);
        if (($da['code'] ?? 0) !== 200 || empty($da['data'])) {
            http_response_code(401);
            echo json_encode(['error' => 'Double authentification indisponible.']);
            exit;
        }
        echo json_encode([
            'needAuth'     => true,
            'token'        => $l['token'],
            'question'     => base64_decode($da['data']['question']),
            'propositions' => array_map('base64_decode', $da['data']['propositions'] ?? []),
        ]);
        exit;
    }

    if (($l['code'] ?? 0) !== 200) {
        $code = $l['code'] ?? '?';
        $hint = ($code == 505)
            ? " — si le mot de passe est bon, c'est sûrement l'IP du serveur bloquée par ÉcoleDirecte : vérifie tes mails et clique « Autoriser la connexion »."
            : '';
        http_response_code(401);
        echo json_encode([
            'error' => ($l['message'] ?? 'Identifiant ou mot de passe incorrect.')
                     . " (code ÉD $code, GTK " . ($l['_gtkFound'] ?? '?') . ", v " . API_VERSION . ")" . $hint,
            'code'  => $code,
        ]);
        exit;
    }

    $lessons = fetch_timetable(account_id($l), $l['token']);
    echo json_encode(['ok' => true, 'lessons' => $lessons]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
