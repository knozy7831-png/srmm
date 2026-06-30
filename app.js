const DOC_CSS = `
  .docview{font-family:'Inter',sans-serif;color:#1E293B;background:#fff}
  .docview header{background:linear-gradient(115deg,#1E3A8A,#2563EB 70%);color:#fff;padding:40px;border-radius:12px;margin-bottom:30px;box-shadow:0 10px 25px -5px rgba(37,99,235,.2)}
  .docview h1{font-size:36px;font-weight:800;margin:0 0 16px;letter-spacing:-1px}
  .docview .meta{display:flex;gap:24px;font-size:14px;opacity:.9}
  .docview .meta div{display:flex;align-items:center;gap:8px}
  .docview h2{font-size:20px;color:#1E3A8A;border-bottom:2px solid #E2E8F0;padding-bottom:12px;margin:32px 0 20px;font-weight:700}
  .docview h3{font-size:16px;color:#334155;margin:24px 0 12px;font-weight:600}
  .docview p{line-height:1.7;margin-bottom:16px;color:#475569}
  .docview ul{padding-left:24px;margin-bottom:24px}
  .docview li{margin-bottom:10px;line-height:1.6;color:#475569}
  .docview li::marker{color:#3B82F6}
  .docview table{width:100%;border-collapse:separate;border-spacing:0;margin:24px 0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden}
  .docview th{background:#F8FAFC;color:#0F172A;font-weight:600;text-align:left;padding:16px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E2E8F0}
  .docview td{padding:16px;border-bottom:1px solid #F1F5F9;color:#475569;font-size:14px}
  .docview tr:last-child td{border-bottom:none}
  .docview tr:nth-child(even){background:#F8FAFC}
  .docview strong{color:#0F172A;font-weight:600}
  .docview .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
`;
/* ============================ STATE ============================ */
const S = { drawing: null, model: null, facts: null, out: {}, activeTab: null };

/* ============================ UPLOAD ============================ */
const drop = document.getElementById('drop'), fileInput = document.getElementById('file');
drop.onclick = () => fileInput.click();
['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('has'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); }));
drop.addEventListener('drop', ev => { ev.preventDefault(); if (ev.dataTransfer.files[0]) handleFile(ev.dataTransfer.files[0]); });
fileInput.onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]); };
function handleFile(f) {
    const r = new FileReader();
    r.onload = () => {
        const b64 = r.result.split(',')[1];
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        S.drawing = { name: f.name, b64, isPdf, mime: f.type || (isPdf ? 'application/pdf' : 'image/png'), dataUrl: r.result };
        drop.classList.add('has');
        document.getElementById('dropbig').textContent = f.name;
        const tw = document.getElementById('thumbwrap');
        tw.innerHTML = isPdf ? '<div class="small" style="margin-top:8px;color:var(--ok)">PDF attached ✓</div>'
            : '<img class="thumb" src="' + r.result + '">';

        // Trigger background auto-fill (Prompt 1)
        autoFillInputs(S.drawing);
    };
    r.readAsDataURL(f);
}

async function autoFillInputs(drawing) {
    try {
        document.getElementById('dropbig').textContent = "Extracting details...";
        const content = [];
        const imgBlock = drawing.isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: drawing.b64 } }
            : { type: 'image', source: { type: 'base64', media_type: drawing.mime, data: drawing.b64 } };
        content.push(imgBlock);
        const p0 = PROMPTS.PROMPT_0 || PROMPTS.PROMPT_3 || "Analyze the site.";
        content.push({
            type: 'text', text: p0 + "\n\nCRITICAL INSTRUCTION FOR THIS STEP: Ignore the request to generate the deliverables listed above. Your ONLY task right now is to extract the basic project details and return EXACTLY ONE JSON block (and nothing else) matching this exact structure:\n" +
                "{\"project\":\"Project name\",\"client\":\"Client / Operator\",\"location\":\"Location / corridor\",\"basis\":\"Basis drawing / tender ref\",\"type\":\"Site type\",\"area\":10.5,\"perim\":2000,\"platform\":500,\"gates\":2,\"bldg\":4,\"cargo\":\"Key cargo\",\"notes\":\"Site constraints\",\"vulnerabilities\":[\"Risk 1\",\"Risk 2\"]}\n" +
                "If a number is not found, leave as 0 or null. Leave unknown text fields empty.\n\n" +
                "CRITICAL SYSTEM INSTRUCTION: Before answering, please take a deep breath and spend time carefully studying the attached drawing. Even if you think you have found the answer quickly, rigorously double-check the visual details, dimensions, and hidden constraints. Do not rush. Take your time to thoroughly understand the project."
        });

        const responseTxt = await claude("You are a technical drawing analyst. Output JSON only.", content, "claude-opus-4-8");
        S.SITE_CONTEXT = responseTxt; // Cache the raw JSON string as requested!
        const j = parseJSON(responseTxt);

        if (j.project) document.getElementById('f_project').value = j.project;
        if (j.client) document.getElementById('f_client').value = j.client;
        if (j.location) document.getElementById('f_location').value = j.location;
        if (j.basis) document.getElementById('f_basis').value = j.basis;
        if (j.type) setSelectByPrefix('f_type', j.type);
        if (j.area) document.getElementById('f_area').value = j.area;
        if (j.perim) document.getElementById('f_perim').value = j.perim;
        if (j.platform) document.getElementById('f_platform').value = j.platform;
        if (j.gates) document.getElementById('f_gates').value = j.gates;
        if (j.bldg) document.getElementById('f_bldg').value = j.bldg;
        if (j.cargo) document.getElementById('f_cargo').value = j.cargo;
        if (j.vulnerabilities && Array.isArray(j.vulnerabilities) && j.vulnerabilities.length > 0) {
            j.notes = (j.notes ? j.notes + "\n\n" : "") + "AI DETECTED VULNERABILITIES:\n- " + j.vulnerabilities.join("\n- ");
        }
        if (j.notes) document.getElementById('f_notes').value = j.notes;

        document.getElementById('dropbig').textContent = drawing.name + " (Auto-filled)";
    } catch (e) {
        console.error("Autofill failed", e);
        document.getElementById('dropbig').textContent = drawing.name + " (Autofill failed)";
    }
}

/* ============================ API LAYER ============================ */
/* This function now securely calls the local Node.js backend. */
async function claude(system, content, modelId = "claude-sonnet-4-6", maxTokens = 2000) {
    const token = localStorage.getItem('token');
    const res = await fetch("/api/claude", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
            model: modelId,
            max_tokens: maxTokens,
            system: system,
            messages: [{ role: "user", content: content }]
        })
    });

    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
        throw new Error('Session expired — please sign in again.');
    }
    if (!res.ok) {
        let errJson = {};
        let errText = "Unknown error";
        try {
            const text = await res.text();
            errText = text;
            errJson = JSON.parse(text);
        } catch (e) { }
        const finalErr = errJson.error?.message || errText;
        throw new Error("API Error (" + res.status + "): " + finalErr.slice(0, 200));
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        throw new Error("Backend returned invalid JSON: " + e.message);
    }
    return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}
function parseJSON(txt) {
    let t = txt.replace(/\`\`\`json|\`\`\`/g, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b >= 0) t = t.slice(a, b + 1);
    try {
        return JSON.parse(t || "{}");
    } catch (e) {
        console.error("AI output was not valid JSON. Output was:", txt);
        return {};
    }
}

/* ============================ INPUTS ============================ */
function readInputs() {
    const g = id => document.getElementById(id).value.trim();
    const n = id => parseFloat(document.getElementById(id).value) || 0;
    return {
        project: g('f_project') || 'Untitled Security & ELV Project',
        client: g('f_client') || 'Client',
        location: g('f_location'),
        basis: g('f_basis'),
        type: g('f_type'),
        area: n('f_area'),
        perim: n('f_perim'),
        platform: n('f_platform'),
        gates: Math.max(1, n('f_gates') || 1),
        bldg: Math.max(1, n('f_bldg') || 1),
        cargo: g('f_cargo'),
        notes: g('f_notes'),
        ccy: g('f_ccy'),
        rev: g('f_rev')
    };
}

/* ============================ CONFIG ============================ */
let TIER = 'Standard';
function readConfig() {
    const g = id => document.getElementById(id).value;
    const checks = rowId => Array.from(document.querySelectorAll('#' + rowId + ' input:checked')).map(c => c.value);
    const redMap = { 'Basic': 'Basic', 'Standard': 'Standard', 'High': 'High', 'Full': 'Full' };
    const redRaw = g('c_redund').split(' ')[0];
    return {
        tier: TIER,
        brand: g('c_brand'),
        model: g('c_model').trim(),
        coverage: g('c_coverage'),
        redund: redMap[redRaw] || 'Standard',
        redundLabel: g('c_redund'),
        retGen: parseInt(g('c_retgen')) || 30,
        retGate: parseInt(g('c_retgate')) || 90,
        expand: parseInt((g('c_expand').match(/\d+/) || [0])[0]),
        expandLabel: g('c_expand'),
        ops: g('c_ops'),
        analytics: checks('analyticsRow'),
        compliance: checks('complianceRow')
    };
}
const PRESETS = {
    Economy: { coverage: 'Detection', redund: 'Basic — single head-end (≈99.0%)', retgen: 15, retgate: 60, expand: 'None', analytics: ['Intrusion detection'] },
    Standard: { coverage: 'Recognition', redund: 'Standard — hot-standby (≈99.5%)', retgen: 30, retgate: 90, expand: '+20%', analytics: ['ANPR', 'Intrusion detection'] },
    Enterprise: { coverage: 'Identification', redund: 'High — N+1, dual core (≈99.9%)', retgen: 30, retgate: 90, expand: '+40%', analytics: ['ANPR', 'Intrusion detection', 'Loitering', 'Face recognition', 'Object left-behind'] }
};
function setSelectByPrefix(id, prefix) { const s = document.getElementById(id); for (const o of s.options) { if (o.value.indexOf(prefix) === 0 || o.value === prefix) { s.value = o.value; return; } } }
function applyPreset(t) {
    const p = PRESETS[t]; if (!p) return;
    document.getElementById('c_coverage').value = p.coverage;
    document.getElementById('c_redund').value = p.redund;
    document.getElementById('c_retgen').value = p.retgen;
    document.getElementById('c_retgate').value = p.retgate;
    document.getElementById('c_expand').value = p.expand;
    document.querySelectorAll('#analyticsRow .chk').forEach(l => {
        const cb = l.querySelector('input'); cb.checked = p.analytics.indexOf(cb.value) >= 0; l.classList.toggle('on', cb.checked);
    });
    refreshChips();
}
function refreshChips() {
    const c = readConfig(); const box = document.getElementById('cfgChips');
    if (!box) return;
    const chips = [c.tier, c.brand, c.coverage + ' grade', c.retGen + 'd/' + c.retGate + 'd retention', c.redund + ' (' + (REDUND[c.redund] || {}).avail + ')', 'expand ' + c.expandLabel, c.ops, ...c.analytics];
    box.innerHTML = chips.map(x => '<span class="c">' + x + '</span>').join('');
}
document.querySelectorAll('#tierSeg button').forEach(b => b.onclick = () => {
    TIER = b.dataset.tier;
    document.querySelectorAll('#tierSeg button').forEach(x => x.classList.toggle('on', x === b));
    applyPreset(TIER);
});
document.querySelectorAll('#analyticsRow .chk, #complianceRow .chk').forEach(l => {
    l.querySelector('input').addEventListener('change', e => { l.classList.toggle('on', e.target.checked); refreshChips(); });
});
['c_brand', 'c_coverage', 'c_redund', 'c_retgen', 'c_retgate', 'c_expand', 'c_ops'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshChips);
});

/* Deterministic estimate from inputs + solution configuration. */
const TIERS = {
    Economy: { cam: 0.72, bitrate: 2.5, raid: 'RAID-5', cont: 0.05, wall: '2×2 (46")', grade: '2–4 MP value' },
    Standard: { cam: 1.00, bitrate: 3.0, raid: 'RAID-6', cont: 0.05, wall: '2×2 (55")', grade: '4 MP AI' },
    Enterprise: { cam: 1.35, bitrate: 4.0, raid: 'RAID-6 + hot-spare', cont: 0.07, wall: '2×3 (55")', grade: '4–8 MP AI + thermal' }
};
const BRANDF = { 'Auto (spec-neutral)': 1, 'CP Plus': 0.80, 'Dahua': 0.85, 'Hikvision': 0.90, 'Honeywell': 1.10, 'Hanwha': 1.20, 'Bosch': 1.35, 'Axis': 1.40 };
const DORIF = { Detection: 1.5, Recognition: 1.0, Identification: 0.65 };
const REDUND = {
    'Basic': { avail: '99.0%', coreMul: 0.55, add: 0 },
    'Standard': { avail: '99.5%', coreMul: 1.00, add: 0 },
    'High': { avail: '99.9%', coreMul: 1.00, add: 1500000 },
    'Full': { avail: '99.95%', coreMul: 1.00, add: 3200000 }
};
function computeModel(i, cfg) {
    const perim = i.perim || 2000, plat = i.platform || 500;
    const T = TIERS[cfg.tier] || TIERS.Standard;
    const brandF = BRANDF[cfg.brand] != null ? BRANDF[cfg.brand] : 1;
    const camMul = T.cam * brandF;
    const dori = DORIF[cfg.coverage] || 1;
    const red = REDUND[cfg.redund] || REDUND.Standard;
    const A = cfg.analytics, headroom = cfg.expand / 100;

    const platSpace = 40 * dori, fenceSpace = 150 * dori;
    const has = k => A.indexOf(k) >= 0;
    const railType = /rail/i.test(i.type);

    const platformCams = Math.min(140, Math.round(plat / platSpace) * 2);
    const fenceCams = Math.min(70, Math.round(perim / fenceSpace));
    const thermalCams = (has('Intrusion detection') || railType) ? Math.min(60, Math.round(perim / 120)) : 0;
    const mastPTZ = 6;
    const anprCams = has('ANPR') ? i.gates * 2 : 0;
    const gateCams = 4 * i.gates + anprCams;
    const faceCams = has('Face recognition') ? Math.max(2, i.bldg) : 0;
    const internalCams = 6;
    const bldgCams = Math.max(4, Math.round(i.bldg * 2));
    const cams = platformCams + fenceCams + thermalCams + mastPTZ + gateCams + faceCams + internalCams + bldgCams;
    const channels = Math.round(cams * 1.02);
    const doors = Math.max(8, i.bldg * 3 + i.gates * 2);
    const pavaZones = Math.min(12, Math.max(4, i.bldg + 4));
    const speakers = Math.round(perim / 60) + i.bldg * 3;
    const pidsM = Math.round(perim * 0.85);

    // storage: split general vs gate/ANPR retention
    const retGen = cfg.retGen || 30, retGate = cfg.retGate || 90;
    const gateCh = gateCams || 1, genCh = Math.max(1, channels - gateCh);
    const tbGenD = genCh * T.bitrate * 86400 / 8 / 1e6 * retGen;
    const tbGateD = gateCh * Math.max(T.bitrate, 4) * 86400 / 8 / 1e6 * retGate;
    let usableTB = Math.ceil((tbGenD + tbGateD) / 5) * 5;
    const provTB = Math.ceil(usableTB * (1 + headroom) / 5) * 5;
    const rawTB = Math.ceil(usableTB * 1.2 / 10) * 10;

    const R = {
        bullet: 18000, thermal: 115000, ptz: 145000, anpr: 220000, uvss: 1400000,
        faceCam: 34000, vmsPerCh: 11000, storagePerTB: 18000,
        pole: 42000, mast: 320000, jb: 350000, ofcKm: 320000, switch: 135000, core: 950000, cabling: 300000,
        pids_m: 1200, fence_m: 950, thermalLine: 450000, anticlimb: 200000,
        boom: 180000, blocker: 650000, weigh: 250000, kiosk: 220000,
        turnstile: 210000, flap: 190000, scanner: 650000,
        acsDoor: 38000, locks: 420000, vms_v: 350000, acsServer: 380000,
        pavaCtrl: 950000, speaker: 4200, pavaCable: 320000,
        wall: T.wall.indexOf('2×3') >= 0 ? 1500000 : 950000, console: 120000, ups: 480000, av: 320000,
        istc: 2600000, pm: 1200000,
        licIntrusion: 6000, licLoiter: 280000, licOLB: 260000, licPeople: 300000, licPPE: 420000, licFire: 380000,
        frServer: 1800000, frPerCam: 45000, anprLane: 120000
    };
    const cm = v => Math.round(v * camMul);
    const lot = (d, a) => ({ d, qty: '1 lot', rate: a, amt: Math.round(a) });
    const li = (d, q, r) => ({ d, qty: q, rate: Math.round(r), amt: Math.round(q * r) });
    const cat = (name, items) => ({ name, items: items.filter(Boolean), sub: items.filter(Boolean).reduce((s, x) => s + x.amt, 0) });

    const fixedBullets = platformCams + fenceCams + internalCams + bldgCams;
    const ofcKm = Math.max(3, Math.round(perim * 2 / 1000));
    const switches = Math.max(4, Math.round(perim / 400));

    const boq = [
        cat('A — Video Surveillance (' + (cfg.brand) + ' · ' + T.grade + ')', [
            li('AI fixed bullet/dome camera (' + T.grade + ')', fixedBullets, cm(R.bullet)),
            thermalCams ? li('Thermal bispectrum camera', thermalCams, cm(R.thermal)) : null,
            li('PTZ + multi-sensor (mast heads)', mastPTZ, cm(R.ptz)),
            anprCams ? li('ANPR camera + lane kit', anprCams, cm(R.anpr)) : null,
            faceCams ? li('Face-capture camera (entries)', faceCams, cm(R.faceCam)) : null,
            has('ANPR') ? li('UVSS under-vehicle system', i.gates, R.uvss) : null,
            li('Enterprise VMS licences (per channel)', channels, R.vmsPerCh),
            li('RAID-6 storage (' + provTB + ' TB provisioned, ' + T.raid + ')', rawTB, R.storagePerTB),
        ]),
        cat('B — Poles & Masts', [
            li('12 m GI camera pole + foundation', Math.round((platformCams + fenceCams) / 2.2), R.pole),
            li('15 m lattice mast (PTZ) + LPS', 3, R.mast),
            lot('Junction boxes / brackets / surge', R.jb),
        ]),
        cat('C — Network (' + cfg.redund.split(' ')[0] + ' redundancy)', [
            li('Armoured SM OFC ring + duct (km)', ofcKm, R.ofcKm),
            li('Industrial managed PoE++ switch + cabinet', switches, R.switch),
            lot('Core switches + NGFW', Math.round(R.core * red.coreMul)),
            red.add ? lot('Redundancy upgrade (' + cfg.redund.split(' ')[0] + ' — ' + red.avail + ' target)', red.add) : null,
            lot('Structured cabling / patching', R.cabling),
        ]),
        cat('D — PIDS & Perimeter', [
            li('Fence-mounted PIDS', pidsM, R.pids_m),
            li('Demarcation fence 2.5 m', pidsM, R.fence_m),
            thermalCams ? lot('Rail/flank thermal tripwire + signage', R.thermalLine) : null,
            lot('Gate anti-climb / culvert grilles', R.anticlimb),
        ]),
        cat('E — Vehicle Barriers & Gate', [
            li('Boom barrier (3 m)', i.gates * 2, R.boom),
            li('Road blocker / tyre killer', i.gates, R.blocker),
            has('ANPR') ? lot('Weighbridge integration', R.weigh) : null,
            lot('Driver/visitor kiosk + controller', R.kiosk),
        ]),
        cat('F — Pedestrian Control & Screening', [
            li('Full-height turnstile', 2, R.turnstile),
            li('Flap barrier (visitor)', 1, R.flap),
            (cfg.compliance.indexOf('Customs bonded') >= 0) ? lot('Walk-through MD + baggage scanner', R.scanner) : null,
        ]),
        cat('G — Access Control & VMS', [
            li('Face/card controller + reader (per door)', doors, R.acsDoor),
            lot('Locks / strikes / PIR / DBB / exit', R.locks),
            lot('Visitor management system + kiosk', R.vms_v),
            lot('ACS server + licence', R.acsServer),
        ]),
        cat('H — PAVA (' + pavaZones + ' zones, EN 54-16)', [
            lot('EN 54-16 controller + amplifiers', R.pavaCtrl),
            li('Weatherproof/indoor speakers', speakers, R.speaker),
            lot('FRLS zone cabling & monitoring', R.pavaCable),
        ]),
        cat('I — Control Room & Power', [
            lot('Video wall ' + T.wall + ' + controller', R.wall),
            li('Operator/supervisor consoles', cfg.ops.indexOf('24') >= 0 ? 3 : 2, R.console),
            lot('Online UPS + batteries (30 min)', R.ups),
            lot('Control-room AV, KVM, furniture', R.av),
        ]),
        cat('J — Analytics & Licensing', [
            has('ANPR') ? li('ANPR engine licence (per lane)', anprCams, R.anprLane) : null,
            has('Intrusion detection') ? li('Intrusion/line-cross licence (per ch)', channels, R.licIntrusion) : null,
            has('Loitering') ? lot('Loitering analytics licence', R.licLoiter) : null,
            has('Face recognition') ? lot('Face-recognition server', R.frServer) : null,
            has('Face recognition') ? li('FR licence (per face camera)', faceCams, R.frPerCam) : null,
            has('Object left-behind') ? lot('Object left-behind licence', R.licOLB) : null,
            has('People counting') ? lot('People-counting licence', R.licPeople) : null,
            has('PPE / safety') ? lot('PPE/safety analytics licence', R.licPPE) : null,
            has('Fire / smoke') ? lot('Visual fire/smoke analytics licence', R.licFire) : null,
        ]),
        cat('K — Services & Future Provisioning', [
            lot('Installation, testing & commissioning', R.istc),
            lot('PM, integration, SAT, training, docs', R.pm),
            headroom > 0 ? lot('Future provisioning (spare duct/fibre cores, head-end & storage headroom @ ' + cfg.expand + '%)', Math.round((R.mast * 3 + R.ofcKm * ofcKm + R.storagePerTB * rawTB) * headroom)) : null,
        ]),
    ];
    const base = boq.reduce((s, c) => s + c.sub, 0);
    const cont = Math.round(base * T.cont);
    const capex = base + cont;
    const gst = Math.round(capex * 0.18);
    const opex = Math.round(capex * 0.115);
    const provCams = Math.round(cams * (1 + headroom));
    return {
        counts: {
            cams, channels, platformCams, thermalCams, fenceCams, faceCams, mastPTZ, gateCams, bldgCams,
            doors, pavaZones, speakers, pidsM, usableTB, provTB, rawTB, provCams,
            avail: red.avail, retGen, retGate, grade: T.grade, raid: T.raid, coverage: cfg.coverage, wall: T.wall
        },
        boq, base, cont, capex, gst, capexInc: capex + gst, opex, tierContPct: T.cont
    };
}
const fmtINR = n => '₹' + Number(Math.round(n)).toLocaleString('en-IN');
const cr = n => '₹' + (n / 1e7).toFixed(2) + ' Cr';


function renderHeader(title, i, cfg) {
    return '<div class="doc-header"><table width="100%"><tr><td width="60%"><img src="https://i.ibb.co/gbfr3hhP/Gemini-Generated-Image-2fw9ur2fw9ur2fw9.png" style="height:60px"><div class="doc-title">' + title + '</div><div class="doc-meta">' + i.project + ' &middot; ' + i.client + ' &middot; ' + i.location + '<br>Generated: ' + new Date().toLocaleDateString() + '</div></td><td align="right" valign="bottom"><div class="doc-meta"><b>Design Tier:</b> ' + cfg.tier + '<br><b>Coverage:</b> ' + cfg.coverage + '<br><b>Retention:</b> ' + cfg.retGen + ' days<br><b>Redundancy:</b> ' + cfg.redund + '</div></td></tr></table></div>';
}
function renderOnePager(i, model, html, cfg) { return renderHeader('Executive Security Brief', i, cfg) + '<div class="doc-body">' + md(html) + '</div>'; }
function renderReport(i, model, html, cfg) { return renderHeader('Detailed Security Design Report', i, cfg) + '<div class="doc-body">' + md(html) + '</div>'; }
function renderHLD(i, model, html, cfg) { return renderHeader('High-Level Architecture Design', i, cfg) + '<div class="doc-body">' + md(html) + '</div>'; }
function renderDoc4(i, model, html, cfg) { return renderHeader('Manpower & Deployment Strategy', i, cfg) + '<div class="doc-body">' + md(html) + '</div>'; }

/* ============================ PROGRESS ============================ */
let stepEls = [];
function setSteps(list) {
    const box = document.getElementById('steps'); box.innerHTML = '';
    stepEls = list.map(t => { const d = document.createElement('div'); d.className = 's'; d.textContent = '• ' + t; box.appendChild(d); return d; });
}
function mark(i, cls) {
    if (stepEls[i]) { stepEls[i].className = 's ' + cls; } const done = stepEls.filter(e => e.classList.contains('done')).length;
    document.getElementById('barfill').style.width = Math.round(done / stepEls.length * 100) + '%';
}

/* ============================ DOC CONTENT PROMPTS ============================ */
const SYS = "You are a senior security & ELV systems design engineer at IInA (Mumbai integrator, Cologic.ai brand). You write concise, technical, India-market document sections for physical-security and ELV designs (CCTV/ANPR, access control, PIDS, PAVA, network, control room). You MUST honour the supplied SOLUTION CONFIG: reflect the budget tier, camera make/model, DORI coverage level, retention, selected analytics, redundancy/availability target, compliance items and expansion headroom in your wording. Output clean Markdown only — short paragraphs and bullet lists, no preamble, no headings above the section you're asked for. Be specific to the site facts given. Never invent commercial figures; those are supplied separately.";

function factsBlock() {
    return "SITE FACTS (JSON):\n" + JSON.stringify(S.facts) +
        "\nSOLUTION CONFIG (honour these — tier, camera brand/model, DORI coverage, retention, analytics, redundancy/availability, compliance, expansion):\n" + JSON.stringify(S.cfg) +
        "\nENGINEERING MODEL (computed):\n" + JSON.stringify(S.model.counts);
}

const REPORT_SECTIONS = [
    ["Executive Summary", "Write the Executive Summary (4 short paragraphs): what the site is, the 4–5 characteristics that dominate the security problem, the recommended system in one paragraph (use the model counts), and a closing line on CAPEX = "],
    ["Site Analysis", "Write Section: Site Analysis — a short intro, then '### Critical Assets' (numbered, 5–6) and '### Sight-lines, Blind Spots & Unused Zones' (bullets). Ground every point in the site facts."],
    ["Security Threat Assessment", "Write Section: Security Threat Assessment with '### External Threats', '### Internal Threats', '### Operational Risks' as bullet lists tailored to this site."],
    ["Vulnerability Assessment", "Write Section: Vulnerability Assessment with '### Perimeter', '### Buildings', '### Surveillance Gaps' as short bullet lists."],
    ["CCTV System Design", "Write Section: CCTV System Design — '### Design Principles' (bullets), '### Camera Types' (bullets), and a short '### Recording & Storage' paragraph referencing the model's usableTB and 30-day/90-day gate retention."],
    ["Access Control & PAVA", "Write two short sections: '### Access Control' (tiers + door logic) and '### PAVA' (zones + safety messaging) for this site."],
    ["Network & Control Room", "Write Section: Network & Control Room — backbone resilience, field aggregation, segmentation/cyber, and the control-room makeup, in tight bullets."],
    ["Phasing & Recommendations", "Write '### Phased Implementation' (3 phases with % split) and '### Final Recommendations' (numbered, 5–6 actions) for this site."],
];
const HLD_SECTIONS = [
    ["Purpose & Design Drivers", "Write HLD Section 1: Purpose, Scope & Design Basis (1 paragraph) + '### Design Drivers' (5–6 bullets tied to the site geometry/constraints)."],
    ["System Architecture", "Write HLD Section 2: System Architecture — three-tier IP/converged model over a resilient backbone, as bullets."],
    ["Security Zoning", "Write HLD Section 3: Security Zoning Concept — list zones Z0..Zn with extent + control intent as a bullet list for this site."],
    ["Subsystem HLDs", "Write HLD Section 4: Subsystem High-Level Designs — short bullet blocks for Video, Gate/ANPR, Access Control, PIDS, PAVA, Network/Cyber, Control Room/Power, using the model counts."],
    ["Integration & Capacity", "Write HLD Section 5: Integration (trigger→response bullets) and Section 6: Capacity & Availability Targets (bullets, use model counts)."],
];

/* lightweight markdown -> html */
function md(t) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = t.split('\n');
    let h = '', inUl = false, inOl = false, inTable = false;
    const closeL = () => {
        if (inUl) { h += '</ul>'; inUl = false; }
        if (inOl) { h += '</ol>'; inOl = false; }
        if (inTable) { h += '</tbody></table></div>'; inTable = false; }
    };
    for (let ln of lines) {
        let s = ln.trim();
        if (!s) { closeL(); continue; }
        s = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        if (/^###\s+/.test(ln)) { closeL(); h += '<h3>' + s.replace(/^###\s+/, '') + '</h3>'; }
        else if (/^##\s+/.test(ln)) { closeL(); h += '<h2>' + s.replace(/^##\s+/, '') + '</h2>'; }
        else if (/^#\s+/.test(ln)) { closeL(); h += '<h1>' + s.replace(/^#\s+/, '') + '</h1>'; }
        else if (/^[-*•]\s+/.test(ln)) { if (!inUl) { closeL(); h += '<ul>'; inUl = true; } h += '<li>' + s.replace(/^[-*•]\s+/, '') + '</li>'; }
        else if (/^\d+[.)]\s+/.test(ln)) { if (!inOl) { closeL(); h += '<ol>'; inOl = true; } h += '<li>' + s.replace(/^\d+[.)]\s+/, '') + '</li>'; }
        else if (s.startsWith('|') && s.endsWith('|')) {
            if (s.includes('|--') || s.includes('|:-')) continue;
            const cells = s.substring(1, s.length - 1).split('|');
            if (!inTable) {
                closeL();
                h += '<div style="overflow-x:auto;"><table><thead><tr>';
                cells.forEach(c => h += '<th>' + c.trim() + '</th>');
                h += '</tr></thead><tbody>';
                inTable = true;
            } else {
                h += '<tr>';
                cells.forEach(c => h += '<td>' + c.trim() + '</td>');
                h += '</tr>';
            }
        }
        else { closeL(); h += '<p>' + s + '</p>'; }
    }
    closeL(); return h;
}

/* ============================ PRINT ============================ */
function printHTML(inner) {
    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up blocked — allow pop-ups to print, or use Download.'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"><style>' + DOC_CSS + 'body{margin:0}</style></head><body>' + inner + '</body></html>');
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 500);
}

// LIVE UI UPDATES
function updateLiveUI() {
    try {
        // Update Overview List
        document.getElementById('ov-type').textContent = document.getElementById('f_type').value || '-';
        document.getElementById('ov-area').textContent = document.getElementById('f_area').value || '-';
        document.getElementById('ov-perim').textContent = (document.getElementById('f_perim').value || '-') + ' m';
        document.getElementById('ov-bldg').textContent = document.getElementById('f_bldg').value || '-';
        document.getElementById('ov-gates').textContent = document.getElementById('f_gates').value || '-';

        // Recompute model
        const currentInputs = readInputs();
        const currentCfg = readConfig();
        const currentModel = computeModel(currentInputs, currentCfg);

        // Update Metric Cards
        document.getElementById('ov-cams').textContent = currentModel.counts.cams;
        document.getElementById('ov-storage').textContent = currentModel.counts.usableTB + ' TB';

        const fmtC = (n) => '₹' + (n / 1e7).toFixed(2) + ' Cr';
        const fmtL = (n) => '₹' + (n / 1e5).toFixed(1) + ' L';

        document.getElementById('ov-capex').textContent = currentModel.capex > 10000000 ? fmtC(currentModel.capex) : fmtL(currentModel.capex);
        document.getElementById('ov-opex').textContent = currentModel.opex > 10000000 ? fmtC(currentModel.opex) : fmtL(currentModel.opex);

        // Toggle card active states
        ['d_one', 'd_rep', 'd_hld', 'd_doc4'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.closest('.doc-card').className = 'doc-card ' + (el.checked ? 'active' : '');
            }
        });

        // Set name
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const u = JSON.parse(userStr);
            document.getElementById('u-name').textContent = u.name;
            document.getElementById('u-initials').textContent = u.name.charAt(0).toUpperCase();
        }
    } catch (e) { console.error(e); }
}

// Debounce the live recompute so typing doesn't recompute the full model
// (and re-render) on every keystroke.
function debounce(fn, ms) {
    let h;
    return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); };
}
const updateLiveUIDebounced = debounce(updateLiveUI, 150);
document.addEventListener('input', updateLiveUIDebounced);
document.addEventListener('change', updateLiveUIDebounced);
setTimeout(updateLiveUI, 500);

function download(name, inner) {
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"><style>' + DOC_CSS + '</style></head><body>' + inner + '</body></html>';
    const b = new Blob([html], { type: 'text/html' }); const u = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u);
}

/* ============================ RESULTS UI ============================ */
function buildResults() {
    document.getElementById('results').style.display = 'block';
    const tabs = document.getElementById('tabs'), panes = document.getElementById('panes');
    tabs.innerHTML = ''; panes.innerHTML = '';

    // Global export toolbar (rebuilt each render).
    const card = tabs.parentElement;
    let tb = document.getElementById('resToolbar');
    if (tb) tb.remove();
    tb = document.createElement('div'); tb.id = 'resToolbar'; tb.className = 'btn-row'; tb.style.marginBottom = '14px';
    const boqBtn = document.createElement('button'); boqBtn.className = 'btn-sm'; boqBtn.textContent = 'Download BOQ (Excel)'; boqBtn.onclick = exportBOQ;
    const saveB = document.createElement('button'); saveB.className = 'btn-sm ghost'; saveB.textContent = 'Save Project'; saveB.onclick = saveProject;
    tb.appendChild(boqBtn); tb.appendChild(saveB);
    card.insertBefore(tb, tabs);

    const order = [['facts', 'Site Facts'], ['one', 'One-Pager'], ['rep', 'Design Report'], ['hld', 'HLD'], ['doc4', 'Manpower Report']];
    let first = null;
    order.forEach(([key, label]) => {
        if (!S.out[key]) return;
        if (!first) first = key;
        const t = document.createElement('div'); t.className = 'tab'; t.textContent = label; t.dataset.k = key;
        t.onclick = () => selectTab(key); tabs.appendChild(t);
        const p = document.createElement('div'); p.className = 'pane'; p.id = 'pane_' + key;
        if (key === 'facts') {
            p.innerHTML = '<p class="muted" style="margin-bottom:8px">Facts the model extracted from your drawing + inputs (editable — these feed the documents).</p>';
            const ta = document.createElement('textarea'); ta.className = 'facts-edit'; ta.value = JSON.stringify(S.facts, null, 2); ta.id = 'factsTA';
            p.appendChild(ta);
        } else {
            const bar = document.createElement('div'); bar.className = 'btn-row';
            const pr = document.createElement('button'); pr.className = 'btn-sm'; pr.textContent = 'Print / Save as PDF'; pr.onclick = () => printHTML(wrapPrint(S.out[key].html));
            const dl = document.createElement('button'); dl.className = 'btn-sm ghost'; dl.textContent = 'Download .html'; dl.onclick = () => download(S.out[key].file, S.out[key].html);
            bar.appendChild(pr); bar.appendChild(dl); p.appendChild(bar);
            const v = document.createElement('div'); v.className = 'docview';
            // Sanitize AI-generated HTML. If DOMPurify failed to load, fall back
            // to rendering as escaped plain text rather than injecting raw HTML.
            let cleanHTML;
            if (typeof DOMPurify !== 'undefined') {
                cleanHTML = DOMPurify.sanitize(S.out[key].html);
            } else {
                console.warn('DOMPurify unavailable — rendering escaped text to avoid XSS.');
                cleanHTML = S.out[key].html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            v.innerHTML = '<style>' + DOC_CSS + '</style>' + cleanHTML;
            p.appendChild(v);
        }
        panes.appendChild(p);
    });
    if (first) selectTab(first);
}
function wrapPrint(inner) { return '<div id="PRINTAREA">' + inner + '</div>'; }
function selectTab(k) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.k === k));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane_' + k));
}

/* ============================ ORCHESTRATION ============================ */
// Per-document token budgets. Detailed sections need far more than the
// old flat 2000 cap or tables/schedules get truncated mid-row.
const TOKENS = { one: 3000, rep: 6000, hld: 4500, doc4: 6000 };

// Section groups produced per report API call.
const REPORT_CHUNKS = [
    "1 Executive Summary · 2 Site Analysis · 3 Risk Assessment + matrix",
    "4 Vulnerability · 5 CCTV (selection, placement, analytics, storage)",
    "6 Barriers · 7 Access Control · 8 PAVA",
    "9 Network · 10 Control Room · 11 Power · 12 Compliance",
    "13 BOQ · 14 CAPEX · 15 OPEX",
    "16 Phasing · 17 Expansion · 18 Markup notes"
];

// Generation context + per-item failure map, kept at module scope so the
// "retry failed" flow can re-run individual documents/chunks.
let GEN = null;
let GEN_FAIL = {};

function cleanHtml(txt) { return txt.replace(/^\`\`\`html/i, '').replace(/\`\`\`$/i, '').trim(); }

function makeInject(i) {
    return (txt) => {
        let t = txt || "";
        let siteCtx = S.SITE_CONTEXT || JSON.stringify(i);
        siteCtx += "\n\n=== USER PROVIDED DATA & OVERRIDES ===\n" + JSON.stringify(i, null, 2);
        const ph = (name) => new RegExp('\\{\\{\\s*' + name + '\\s*\\}\\}', 'g');
        t = t.replace(ph('SITE_CONTEXT'), siteCtx);
        t = t.replace(ph('CLIENT_NAME'), i.client || "Client");
        t = t.replace(ph('PROJECT_NAME'), i.project || "Project");
        t = t.replace(ph('PREPARED_BY'), "Cologic.ai");
        t = t.replace(ph('DATE'), new Date().toLocaleDateString());
        t = t.replace(ph('OUTPUT_FORMAT'), "Professional consultant report format. Output raw content only, no markdown code fences.");
        t = t.replace(ph('PLAN_IMAGE'), S.drawing ? "(see the attached site drawing)" : "(no drawing attached)");
        t += "\n\nCRITICAL SYSTEM INSTRUCTION: Before answering, please take a deep breath and spend time carefully studying the attached drawing. Even if you think you have found the answer quickly, rigorously double-check the visual details, dimensions, and hidden constraints. Do not rush. Take your time to thoroughly understand the project.";
        if (i.notes) {
            t += "\n\nCRITICAL SITE CONSTRAINTS & NOTES FROM USER: " + i.notes + " (You MUST incorporate these constraints explicitly into your design and recommendations!)";
        }
        if (i.cargo) {
            t += "\n\nKEY CARGO/ASSETS: " + i.cargo;
        }
        return t;
    };
}

const contentWithImg = () => (GEN.imgBlock ? [GEN.imgBlock] : []);

async function genOnePager() {
    const content = contentWithImg();
    const p1 = PROMPTS.PROMPT_1 || "Generate an executive one-pager summarizing the security posture based on the site context.";
    content.push({ type: 'text', text: GEN.inject(p1) });
    const out = await claude(SYS, content, "claude-sonnet-4-6", TOKENS.one);
    S.out.one = { html: renderOnePager(GEN.i, S.model, cleanHtml(out), GEN.cfg), file: slug(GEN.i.project) + '_OnePager.html' };
}

async function genReportChunk(c) {
    const p2 = PROMPTS.PROMPT_2 || PROMPTS.PROMPT_3 || PROMPTS.PROMPT_1 || "";
    const content = contentWithImg();
    let t = GEN.inject(p2) + "\n\nCRITICAL INSTRUCTION FOR THIS CALL:\nSECTIONS TO PRODUCE NOW: " + REPORT_CHUNKS[c];
    // Provide previously-generated chunks as consistency context.
    let prev = "";
    for (let k = 0; k < c; k++) { if (S.repChunks[k] && S.repChunks[k].html) prev += "\n\n" + S.repChunks[k].html; }
    if (prev) t += "\n\nPREVIOUSLY COMMITTED FIGURES (ensure consistency with this earlier output):\n" + prev.slice(-5000);
    content.push({ type: 'text', text: t });
    const out = await claude(SYS, content, "claude-sonnet-4-6", TOKENS.rep);
    S.repChunks[c] = { html: cleanHtml(out) };
}

async function genHld() {
    const content = contentWithImg();
    const p3 = PROMPTS.PROMPT_3 || "Generate a High-Level Design (HLD) architecture overview.";
    content.push({ type: 'text', text: GEN.inject(p3) });
    const out = await claude(SYS, content, "claude-sonnet-4-6", TOKENS.hld);
    S.out.hld = { html: renderHLD(GEN.i, S.model, cleanHtml(out), GEN.cfg), file: slug(GEN.i.project) + '_HLD.html' };
}

async function genDoc4() {
    const content = contentWithImg();
    const p4 = PROMPTS.PROMPT_4 || PROMPTS.PROMPT_2 || "";
    content.push({ type: 'text', text: GEN.inject(p4) });
    const out = await claude(SYS, content, "claude-sonnet-4-6", TOKENS.doc4);
    S.out.doc4 = { html: renderDoc4(GEN.i, S.model, cleanHtml(out), GEN.cfg), file: slug(GEN.i.project) + '_Manpower_Report.html' };
}

// Assemble the report from whatever chunks succeeded; missing chunks get
// an inline placeholder so partial reports still render.
function assembleReport() {
    if (!S.repChunks || !S.repChunks.length) return;
    const parts = S.repChunks.map((ch, idx) =>
        (ch && ch.html) ? ch.html : ('\n\n*[Section group ' + (idx + 1) + ' failed to generate — use "Retry failed sections".]*\n\n')
    );
    S.out.rep = { html: renderReport(GEN.i, S.model, parts.join("\n\n"), GEN.cfg), file: slug(GEN.i.project) + '_Design_Report.html' };
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function failLabel(k) {
    if (k === 'one') return 'One-Pager';
    if (k === 'hld') return 'HLD';
    if (k === 'doc4') return 'Manpower Report';
    if (k.indexOf('rep:') === 0) return 'Report — ' + REPORT_CHUNKS[parseInt(k.split(':')[1])];
    return k;
}

function renderFailurePanel() {
    const err = document.getElementById('errbox');
    const keys = Object.keys(GEN_FAIL);
    if (!keys.length) { err.innerHTML = ''; return; }
    const items = keys.map(k => '<li><b>' + escapeHtml(failLabel(k)) + '</b>: ' + escapeHtml(GEN_FAIL[k]) + '</li>').join('');
    err.innerHTML = '<div class="alert"><b>Some sections failed (the rest were kept).</b>' +
        '<ul style="margin:8px 0 10px 18px">' + items + '</ul>' +
        '<button class="btn-sm" id="retryBtn">Retry failed sections</button></div>';
    const btn = document.getElementById('retryBtn');
    if (btn) btn.onclick = retryFailed;
}

async function retryFailed() {
    if (!GEN) return;
    const btn = document.getElementById('retryBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
    const keys = Object.keys(GEN_FAIL);
    for (const k of keys) {
        try {
            if (k === 'one') await genOnePager();
            else if (k === 'hld') await genHld();
            else if (k === 'doc4') await genDoc4();
            else if (k.indexOf('rep:') === 0) await genReportChunk(parseInt(k.split(':')[1]));
            delete GEN_FAIL[k];
        } catch (e) {
            GEN_FAIL[k] = String(e.message || e);
        }
    }
    if (S.repChunks && S.repChunks.length) assembleReport();
    buildResults();
    renderFailurePanel();
}

async function run() {
    const err = document.getElementById('errbox'); err.innerHTML = '';
    const i = readInputs();
    const want = { one: document.getElementById('d_one').checked, rep: document.getElementById('d_rep').checked, hld: document.getElementById('d_hld').checked, doc4: document.getElementById('d_doc4').checked };
    if (!want.one && !want.rep && !want.hld && !want.doc4) { err.innerHTML = '<div class="alert">Select at least one document.</div>'; return; }
    const cfg = readConfig(); S.cfg = cfg;
    S.model = computeModel(i, cfg); S.out = {}; S.repChunks = []; GEN_FAIL = {};
    document.getElementById('go').disabled = true;
    document.getElementById('progwrap').style.display = 'block';

    // Build the visible step list.
    const steps = [];
    if (want.one) steps.push('1-Page Visual Brief');
    if (want.rep) REPORT_CHUNKS.forEach((_, idx) => steps.push('Report Call ' + (idx + 1)));
    if (want.hld) steps.push('Architecture & Subsystems (HLD)');
    if (want.doc4) steps.push('Guard Deployment & Safety');
    steps.push('Assemble & render');
    setSteps(steps);

    const imgBlock = S.drawing ? (S.drawing.isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: S.drawing.b64 } }
        : { type: 'image', source: { type: 'base64', media_type: S.drawing.mime, data: S.drawing.b64 } }) : null;
    GEN = { i, cfg, imgBlock, inject: makeInject(i) };

    // Run each step but DON'T abort the whole batch on a single failure —
    // record the failure and keep going so partial work survives.
    let si = 0;
    const runStep = async (fn, failKey) => {
        mark(si, 'run');
        try { await fn(); mark(si, 'done'); }
        catch (e) { mark(si, 'err'); GEN_FAIL[failKey] = String(e.message || e); }
        si++;
    };

    try {
        if (want.one) await runStep(genOnePager, 'one');
        if (want.rep) {
            for (let c = 0; c < REPORT_CHUNKS.length; c++) {
                await runStep(() => genReportChunk(c), 'rep:' + c);
            }
            assembleReport();
        }
        if (want.hld) await runStep(genHld, 'hld');
        if (want.doc4) await runStep(genDoc4, 'doc4');

        // Assemble & render — always runs, renders whatever succeeded.
        mark(si, 'run');
        buildResults();
        mark(si, 'done');
        si++;

        if (Object.keys(GEN_FAIL).length) {
            renderFailurePanel();
        }
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
    } finally {
        document.getElementById('go').disabled = false;
    }
}
function slug(s) { return (s || 'project').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 48); }

/* ============================ PROJECT PERSISTENCE ============================ */
// If the token is missing/expired/invalid, clear it and bounce to login
// rather than leaving the user stuck on an "Invalid token" message.
function handle401(res) {
    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
        throw new Error('Session expired — please sign in again.');
    }
}

function authHeaders() {
    const t = localStorage.getItem('token');
    return { 'Content-Type': 'application/json', 'Authorization': t ? ('Bearer ' + t) : '' };
}

function toast(msg, isError) {
    let host = document.getElementById('toastHost');
    if (!host) { host = document.createElement('div'); host.id = 'toastHost'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('show'); }, 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

const FORM_IDS = ['f_project', 'f_client', 'f_location', 'f_type', 'f_area', 'f_perim', 'f_gates', 'f_bldg', 'f_platform', 'f_cargo', 'f_notes', 'f_ccy', 'f_basis', 'f_rev', 'c_brand', 'c_coverage', 'c_retgen', 'c_retgate', 'c_redund', 'c_expand', 'c_ops', 'c_model'];

function collectFormState() {
    const fields = {};
    FORM_IDS.forEach(id => { const el = document.getElementById(id); if (el) fields[id] = el.value; });
    const checked = rowId => Array.from(document.querySelectorAll('#' + rowId + ' input:checked')).map(c => c.value);
    return {
        fields,
        tier: TIER,
        analytics: checked('analyticsRow'),
        compliance: checked('complianceRow'),
        docs: {
            one: document.getElementById('d_one').checked,
            rep: document.getElementById('d_rep').checked,
            hld: document.getElementById('d_hld').checked,
            doc4: document.getElementById('d_doc4').checked
        }
    };
}

function applyFormState(state) {
    if (!state) return;
    (FORM_IDS).forEach(id => {
        if (state.fields && state.fields[id] !== undefined) {
            const el = document.getElementById(id);
            if (el) el.value = state.fields[id];
        }
    });
    if (state.tier) {
        TIER = state.tier;
        document.querySelectorAll('#tierSeg button').forEach(x => x.classList.toggle('on', x.dataset.tier === TIER));
    }
    const setRow = (rowId, values) => {
        document.querySelectorAll('#' + rowId + ' .chk').forEach(l => {
            const cb = l.querySelector('input');
            const on = (values || []).indexOf(cb.value) >= 0;
            cb.checked = on; l.classList.toggle('on', on);
        });
    };
    setRow('analyticsRow', state.analytics);
    setRow('complianceRow', state.compliance);
    if (state.docs) {
        ['one', 'rep', 'hld', 'doc4'].forEach(k => {
            const el = document.getElementById('d_' + k);
            if (el) el.checked = !!state.docs[k];
        });
    }
    refreshChips();
    updateLiveUI();
}

function showDrawingThumb(drawing) {
    if (!drawing) return;
    drop.classList.add('has');
    document.getElementById('dropbig').textContent = drawing.name || 'Drawing attached';
    const tw = document.getElementById('thumbwrap');
    tw.innerHTML = drawing.isPdf
        ? '<div class="small" style="margin-top:8px;color:var(--success)">PDF attached ✓</div>'
        : '<img class="thumb" src="' + (drawing.dataUrl || '') + '">';
}

async function saveProject() {
    const btn = document.getElementById('saveBtn');
    if (btn) btn.disabled = true;
    try {
        const payload = {
            id: S.projectId || null,
            name: (document.getElementById('f_project').value || 'Untitled Project'),
            data: {
                form: collectFormState(),
                siteContext: S.SITE_CONTEXT || null,
                drawing: S.drawing || null,
                out: S.out || {},
                repChunks: S.repChunks || [],
                model: S.model || null,
                cfg: S.cfg || null,
                facts: S.facts || null
            }
        };
        const res = await fetch('/api/projects', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
        handle401(res);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
        const j = await res.json();
        S.projectId = j.id;
        toast('Project saved');
    } catch (e) {
        toast('Save failed: ' + (e.message || e), true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function openProjects() {
    const modal = document.getElementById('projModal');
    const list = document.getElementById('projList');
    modal.style.display = 'flex';
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
        const res = await fetch('/api/projects', { headers: authHeaders() });
        handle401(res);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const projects = await res.json();
        if (!projects.length) { list.innerHTML = '<p class="muted">No saved projects yet.</p>'; return; }
        list.innerHTML = '';
        projects.forEach(p => {
            const row = document.createElement('div');
            row.className = 'proj-item';
            const when = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '';
            row.innerHTML = '<div><div class="proj-name">' + escapeHtml(p.name || 'Untitled') + '</div>' +
                '<div class="muted" style="font-size:12px">' + escapeHtml(p.client || '') + (p.client ? ' · ' : '') + escapeHtml(when) + '</div></div>';
            const actions = document.createElement('div');
            actions.style.display = 'flex'; actions.style.gap = '8px';
            const loadB = document.createElement('button'); loadB.className = 'btn-sm'; loadB.textContent = 'Load';
            loadB.onclick = () => loadProject(p.id);
            const delB = document.createElement('button'); delB.className = 'btn-sm ghost'; delB.textContent = 'Delete';
            delB.onclick = () => deleteProject(p.id);
            actions.appendChild(loadB); actions.appendChild(delB);
            row.appendChild(actions);
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<p class="muted">Failed to load projects: ' + escapeHtml(e.message || String(e)) + '</p>';
    }
}

function closeProjects() { document.getElementById('projModal').style.display = 'none'; }

async function loadProject(id) {
    try {
        const res = await fetch('/api/projects/' + encodeURIComponent(id), { headers: authHeaders() });
        handle401(res);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const proj = await res.json();
        const d = proj.data || {};
        applyFormState(d.form);
        S.SITE_CONTEXT = d.siteContext || null;
        S.drawing = d.drawing || null;
        S.cfg = d.cfg || null;
        S.model = d.model || null;
        S.out = d.out || {};
        S.repChunks = d.repChunks || [];
        S.facts = d.facts || null;
        S.projectId = proj.id;
        if (S.drawing) showDrawingThumb(S.drawing);
        // Rebuild GEN context so "retry" still works after a reload.
        const i = readInputs();
        const imgBlock = S.drawing ? (S.drawing.isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: S.drawing.b64 } }
            : { type: 'image', source: { type: 'base64', media_type: S.drawing.mime, data: S.drawing.b64 } }) : null;
        GEN = { i, cfg: S.cfg || readConfig(), imgBlock, inject: makeInject(i) };
        if (S.out && Object.keys(S.out).length) buildResults();
        updateLiveUI();
        closeProjects();
        toast('Loaded "' + (proj.name || 'project') + '"');
    } catch (e) {
        toast('Load failed: ' + (e.message || e), true);
    }
}

async function deleteProject(id) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
        const res = await fetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
        handle401(res);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (S.projectId === id) S.projectId = null;
        toast('Project deleted');
        openProjects();
    } catch (e) {
        toast('Delete failed: ' + (e.message || e), true);
    }
}

/* ============================ BOQ EXCEL EXPORT ============================ */
async function exportBOQ() {
    if (!S.model || !Array.isArray(S.model.boq)) { toast('Generate or load a project first', true); return; }
    try {
        const res = await fetch('/api/export/xlsx', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ project: readInputs(), model: S.model })
        });
        handle401(res);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u; a.download = slug(readInputs().project) + '_BOQ.xlsx'; a.click();
        URL.revokeObjectURL(u);
    } catch (e) {
        toast('Excel export failed: ' + (e.message || e), true);
    }
}

/* ============================ WIRING ============================ */
document.getElementById('go').onclick = run;
const saveBtn = document.getElementById('saveBtn'); if (saveBtn) saveBtn.onclick = saveProject;
const projBtn = document.getElementById('projectsBtn'); if (projBtn) projBtn.onclick = openProjects;
const projClose = document.getElementById('projClose'); if (projClose) projClose.onclick = closeProjects;
const projModal = document.getElementById('projModal');
if (projModal) projModal.addEventListener('click', e => { if (e.target === projModal) closeProjects(); });
refreshChips();

lucide.createIcons();
