import { useState, useMemo, useRef, useCallback } from "react";

// ============ JSON PARSER ============
function parseRosterJSON(json) {
  try {
    const roster = json.roster || json;
    const pts = roster.costs?.find(c => c.name === "pts")?.value || 0;
    const ptsLimit = roster.costLimits?.find(c => c.name === "pts")?.value || 0;
    const force = roster.forces?.[0];
    const selections = force?.selections || [];

    let battleSize = "";
    let detachmentName = "";
    let detachmentRule = "";
    let blessings = [];
    const parsedUnits = [];

    for (const sel of selections) {
      if (sel.name === "Battle Size") {
        battleSize = sel.selections?.[0]?.name || "";
      }
      if (sel.name === "Blessings of Khorne Reference" && sel.profiles) {
        blessings = sel.profiles.map(p => ({
          name: p.name,
          roll: getChar(p, "Roll"),
          effect: cleanText(getChar(p, "Effect")),
        }));
      }
      if (sel.name === "Detachment") {
        const det = sel.selections?.[0];
        if (det) {
          detachmentName = det.name || "";
          detachmentRule = det.rules?.[0]?.description ? cleanText(det.rules[0].description) : "";
        }
      }
      if (sel.type === "model" || sel.type === "unit") {
        parsedUnits.push(parseUnit(sel));
      }
    }

    return {
      name: roster.name || force?.name || "Army",
      faction: force?.catalogueName?.replace("Chaos - ", "") || "Unknown",
      detachment: detachmentName,
      detachmentRule,
      points: pts,
      pointsLimit: ptsLimit,
      battleSize,
      blessings,
      units: parsedUnits,
    };
  } catch (e) {
    console.error("Parse error:", e);
    return null;
  }
}

function getChar(profile, charName) {
  const c = profile?.characteristics?.find(ch => ch.name === charName);
  return c?.$text || c?.value || "";
}

function cleanText(text) {
  if (!text) return "";
  return text.replace(/\^\^\*\*/g, "").replace(/\*\*\^\^/g, "").replace(/\^\^/g, "").replace(/\*\*/g, "").replace(/\\n/g, "\n");
}

function parseUnit(sel) {
  const unit = { name: sel.name, id: sel.id };
  const ptsCost = sel.costs?.find(c => c.name === "pts");
  unit.pts = ptsCost?.value || 0;
  const cats = sel.categories || [];
  const catNames = cats.map(c => c.name);
  unit.keywords = catNames.filter(n => !["Faction: World Eaters"].includes(n) && !n.startsWith("Faction:"));
  unit.warlord = catNames.includes("Warlord") || sel.selections?.some(s => s.name === "Warlord");
  const primaryCat = cats.find(c => c.primary)?.name || "";
  if (catNames.includes("Epic Hero")) unit.role = "Epic Hero";
  else if (catNames.includes("Character")) unit.role = "Character";
  else if (catNames.includes("Battleline")) unit.role = "Battleline";
  else if (catNames.includes("Dedicated Transport")) unit.role = "Dedicated Transport";
  else if (catNames.includes("Vehicle")) unit.role = "Vehicle";
  else if (catNames.includes("Beast")) unit.role = "Beast";
  else unit.role = primaryCat || sel.type || "Other";

  const unitProfile = sel.profiles?.find(p => p.typeName === "Unit");
  if (unitProfile) {
    unit.stats = { M: getChar(unitProfile, "M"), T: getChar(unitProfile, "T"), SV: getChar(unitProfile, "SV"), W: getChar(unitProfile, "W"), LD: getChar(unitProfile, "LD"), OC: getChar(unitProfile, "OC") };
  } else {
    unit.stats = { M: "-", T: "-", SV: "-", W: "-", LD: "-", OC: "-" };
  }

  unit.abilities = (sel.profiles || [])
    .filter(p => p.typeName === "Abilities" && p.name !== "Leader" && p.name !== "Invulnerable Save")
    .map(p => ({ name: p.name, desc: cleanText(getChar(p, "Description")) }));

  const invProf = sel.profiles?.find(p => p.name === "Invulnerable Save");
  if (invProf) {
    const desc = getChar(invProf, "Description");
    const match = desc.match(/(\d\+)/);
    if (match) unit.invuln = match[1];
  }

  const leaderProf = sel.profiles?.find(p => p.name === "Leader" && p.typeName === "Abilities");
  if (leaderProf) {
    const desc = getChar(leaderProf, "Description");
    const match = desc.match(/attached to the following unit[s]?:\s*(.+)/i);
    if (match) unit.leader = cleanText(match[1]).replace(/\./g, "").trim();
  }

  const transProf = sel.profiles?.find(p => p.typeName === "Transport");
  if (transProf) unit.transport = getChar(transProf, "Capacity");

  unit.rules = (sel.rules || []).filter(r =>
    !["Leader", "Blessings of Khorne", "Pistol", "Hazardous", "Extra Attacks", "Lance", "Devastating Wounds", "Precision", "Anti-", "Rapid Fire", "Blast"].includes(r.name) && !r.name.startsWith("Blessings")
  ).map(r => r.name);

  unit.ranged = [];
  unit.melee = [];
  unit.enhancement = null;

  const processSelections = (sels) => {
    for (const s of (sels || [])) {
      if (s.group === "Enhancements" && s.profiles) {
        const enhProf = s.profiles.find(p => p.typeName === "Abilities");
        unit.enhancement = { name: s.name, pts: s.costs?.find(c => c.name === "pts")?.value || 0, desc: enhProf ? cleanText(getChar(enhProf, "Description")) : "" };
      }
      for (const p of (s.profiles || [])) {
        if (p.typeName === "Ranged Weapons") {
          unit.ranged.push({ name: p.name.replace(/^➤\s*/, ""), range: getChar(p, "Range"), A: getChar(p, "A"), BS: getChar(p, "BS"), S: getChar(p, "S"), AP: getChar(p, "AP"), D: getChar(p, "D"), keywords: getChar(p, "Keywords") });
        }
        if (p.typeName === "Melee Weapons") {
          unit.melee.push({ name: p.name.replace(/^➤\s*/, ""), A: getChar(p, "A"), WS: getChar(p, "WS"), S: getChar(p, "S"), AP: getChar(p, "AP"), D: getChar(p, "D"), keywords: getChar(p, "Keywords") });
        }
      }
      if (s.name === "Warlord") unit.warlord = true;
      processSelections(s.selections);
    }
  };
  processSelections(sel.selections);

  const dedup = (arr) => { const seen = new Set(); return arr.filter(w => { if (seen.has(w.name)) return false; seen.add(w.name); return true; }); };
  unit.ranged = dedup(unit.ranged);
  unit.melee = dedup(unit.melee);

  const modelSel = sel.selections?.find(s => s.type === "model" && s.number > 1);
  if (modelSel) unit.models = modelSel.number + 1;

  return unit;
}

// ============ STRATAGEMS ============
const detachmentStratagems = [
  { name: "BLOOD OFFERING", cp: "1CP", type: "Epic Deed", when: "Any phase.", target: "One WORLD EATERS unit from your army that was just destroyed while it was within range of one or more objective markers you controlled at the end of the previous phase.", effect: "Select one of those objective markers. That objective marker remains under your control until your opponent's Level of Control over that objective marker is greater than yours at the end of a phase.", color: "#8B0000" },
  { name: "SKULLS FOR THE SKULL THRONE!", cp: "1CP", type: "Strategic Ploy", when: "Fight phase, just after a WORLD EATERS unit from your army destroys a CHARACTER or MONSTER model.", target: "That WORLD EATERS unit.", effect: "Make a Blessings of Khorne roll and use the results to activate one Blessing of Khorne. Until the end of the battle round, that Blessing is active in addition to any others.", color: "#8B0000" },
  { name: "HACK AND SLASH", cp: "1CP", type: "Battle Tactic", when: "Fight phase.", target: "One WORLD EATERS unit that has not been selected to fight this phase and that made a charge move this turn.", effect: "Until the end of the phase, improve the AP of melee weapons equipped by models in your unit by 1.", color: "#8B0000" },
  { name: "APOPLECTIC FRENZY", cp: "1CP", type: "Strategic Ploy", when: "Your Movement phase, just after a KHORNE BERZERKERS unit is selected to Advance.", target: "That KHORNE BERZERKERS unit.", effect: "Until the end of the turn, your unit is eligible to declare a charge in a turn in which it Advanced.", color: "#8B0000" },
  { name: "FRENZIED RESILIENCE", cp: "2CP", type: "Battle Tactic", when: "Fight phase, just after an enemy unit has selected its targets.", target: "One WORLD EATERS unit that was selected as the target of one or more of the attacking unit's attacks.", effect: "Until end of phase, each time an attack is allocated to a model in your unit, subtract 1 from the Damage characteristic of that attack.", color: "#8B0000" },
  { name: "BERZERKER'S WRATH", cp: "1CP", type: "Strategic Ploy", when: "Your opponent's Shooting phase, just after an enemy unit has shot.", target: "One KHORNE BERZERKERS unit that can make a Blood Surge move as a result of those attacks.", effect: "Do not roll a D6. Instead, models can move up to 8\" when making their Blood Surge move.", color: "#8B0000" },
];

const coreStratagems = [
  { name: "COMMAND RE-ROLL", cp: "1CP", type: "Battle Tactic", when: "Any phase, just after you make an Advance roll, Charge roll, Desperate Escape test, Hazardous test, Hit roll, Wound roll, Damage roll, saving throw, or roll to determine number of attacks.", target: "That unit or model from your army.", effect: "You re-roll that roll, test or saving throw.", timing: "ANY TURN", color: "#1a5276" },
  { name: "COUNTER-OFFENSIVE", cp: "2CP", type: "Strategic Ploy", when: "Fight phase, just after an enemy unit has fought.", target: "One unit from your army within Engagement Range of enemy units, not yet selected to fight.", effect: "Your unit fights next.", timing: "ANY TURN", color: "#1a5276" },
  { name: "EPIC CHALLENGE", cp: "1CP", type: "Epic Deed", when: "Fight phase, when a CHARACTER unit within Engagement Range of Attached units is selected to fight.", target: "One CHARACTER model in your unit.", effect: "Until end of phase, all melee attacks by that model have [PRECISION].", timing: "ANY TURN", color: "#1a5276" },
  { name: "INSANE BRAVERY", cp: "1CP", type: "Epic Deed", when: "Battle-shock step of your Command phase, just before a Battle-shock test.", target: "That unit from your army.", effect: "Your unit automatically passes that Battle-shock test.", restrictions: "Once per battle.", timing: "YOUR TURN", color: "#006400" },
  { name: "GRENADE", cp: "1CP", type: "Wargear", when: "Your Shooting phase.", target: "One GRENADES unit (not Advanced/Fell Back/shot, not in Engagement Range).", effect: "Select one GRENADES model and one enemy unit within 8\" and visible, not in Engagement Range. Roll 6D6: each 4+ = 1 mortal wound.", timing: "YOUR TURN", color: "#006400" },
  { name: "TANK SHOCK", cp: "1CP", type: "Strategic Ploy", when: "Your Charge phase, just after a VEHICLE ends a Charge move.", target: "That VEHICLE unit.", effect: "Select one enemy unit within Engagement Range. Roll D6 equal to VEHICLE's Toughness. Each 5+ = 1 mortal wound (max 6).", timing: "YOUR TURN", color: "#006400" },
  { name: "RAPID INGRESS", cp: "1CP", type: "Strategic Ploy", when: "End of your opponent's Movement phase.", target: "One unit from your army in Reserves.", effect: "Your unit arrives as if Reinforcements step. Deep Strike units can use Deep Strike rules.", restrictions: "Cannot arrive in a battle round it normally couldn't.", timing: "THEIR TURN", color: "#4a235a" },
  { name: "FIRE OVERWATCH", cp: "1CP", type: "Strategic Ploy", when: "Opponent's Movement or Charge phase, after enemy unit sets up/moves/declares charge.", target: "One unit within 24\" eligible to shoot.", effect: "Your unit can shoot that enemy unit as if it were your Shooting phase.", restrictions: "Not vs TITANIC. Unmodified 6 to hit only. Once per turn.", timing: "THEIR TURN", color: "#4a235a" },
  { name: "GO TO GROUND", cp: "1CP", type: "Battle Tactic", when: "Opponent's Shooting phase, after an enemy unit selects targets.", target: "One INFANTRY unit targeted by one or more attacks.", effect: "Until end of phase, models have 6+ invulnerable save and Benefit of Cover.", timing: "THEIR TURN", color: "#4a235a" },
];

// ============ COMPONENTS ============
const roleIcons = { "Epic Hero": "⚔️", "Character": "👑", "Battleline": "🛡️", "Infantry": "🦶", "Beast": "🐺", "Vehicle": "🔧", "Dedicated Transport": "🚛", "Other": "📋" };

function StatBlock({ stats, invuln }) {
  const sn = ["M", "T", "SV", "W", "LD", "OC"];
  return (
    <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
      {sn.map(s => (
        <div key={s} style={{ textAlign: "center", flex: 1, background: "var(--stat-bg)", borderRadius: 4, padding: "2px 0" }}>
          <div style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 700 }}>{s}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>{stats[s]}</div>
        </div>
      ))}
      {invuln && (
        <div style={{ textAlign: "center", flex: 1, background: "#5b1a1a", borderRadius: 4, padding: "2px 0" }}>
          <div style={{ fontSize: 9, color: "#ff9999", fontWeight: 700 }}>INV</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#ff4444" }}>{invuln}</div>
        </div>
      )}
    </div>
  );
}

function WeaponTable({ weapons, type }) {
  const m = type === "melee";
  return (
    <div style={{ overflowX: "auto", marginBottom: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: m ? "#3d1010" : "#0d2137", color: "#ccc" }}>
            <th style={{ textAlign: "left", padding: "3px 4px", fontWeight: 600 }}>{m ? "⚔ Melee" : "🎯 Ranged"}</th>
            {!m && <th style={{ padding: "3px 2px", fontWeight: 600 }}>Rng</th>}
            <th style={{ padding: "3px 2px", fontWeight: 600 }}>A</th>
            <th style={{ padding: "3px 2px", fontWeight: 600 }}>{m ? "WS" : "BS"}</th>
            <th style={{ padding: "3px 2px", fontWeight: 600 }}>S</th>
            <th style={{ padding: "3px 2px", fontWeight: 600 }}>AP</th>
            <th style={{ padding: "3px 2px", fontWeight: 600 }}>D</th>
          </tr>
        </thead>
        <tbody>
          {weapons.map((w, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "3px 4px", color: "var(--text-main)", fontWeight: 500 }}>
                {w.name}
                {w.keywords && w.keywords !== "-" && <div style={{ fontSize: 9, color: "#c0a040", fontStyle: "italic" }}>{w.keywords}</div>}
              </td>
              {!m && <td style={{ textAlign: "center", padding: "3px 2px", color: "var(--text-dim)" }}>{w.range}</td>}
              <td style={{ textAlign: "center", padding: "3px 2px", color: "var(--text-main)", fontWeight: 700 }}>{w.A}</td>
              <td style={{ textAlign: "center", padding: "3px 2px", color: "var(--text-dim)" }}>{m ? w.WS : w.BS}</td>
              <td style={{ textAlign: "center", padding: "3px 2px", color: "#e8a040", fontWeight: 700 }}>{w.S}</td>
              <td style={{ textAlign: "center", padding: "3px 2px", color: "#60b0e0" }}>{w.AP}</td>
              <td style={{ textAlign: "center", padding: "3px 2px", color: "#e06060", fontWeight: 700 }}>{w.D}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnitCard({ unit }) {
  const [open, setOpen] = useState(false);
  const icon = roleIcons[unit.role] || "📋";
  const totalPts = unit.pts + (unit.enhancement?.pts || 0);
  return (
    <div style={{ background: "var(--card-bg)", borderRadius: 8, marginBottom: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", padding: "10px 12px", cursor: "pointer", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-main)", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {unit.name}
            {unit.warlord && <span style={{ fontSize: 9, background: "#c9a000", color: "#000", padding: "1px 5px", borderRadius: 3, fontWeight: 800 }}>WARLORD</span>}
            {unit.enhancement && <span style={{ fontSize: 9, background: "#6a1b9a", color: "#fff", padding: "1px 5px", borderRadius: 3 }}>{unit.enhancement.name}</span>}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{unit.role}{unit.models ? ` · ${unit.models} modelli` : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#e63946" }}>{totalPts}</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)" }}>pts</div>
        </div>
        <span style={{ fontSize: 14, color: "var(--text-dim)", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <StatBlock stats={unit.stats} invuln={unit.invuln} />
          {unit.transport && <div style={{ fontSize: 10, color: "#80cbc4", background: "#1a3330", padding: "4px 6px", borderRadius: 4, marginBottom: 6 }}>🚛 {unit.transport}</div>}
          {unit.rules?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>
              {unit.rules.map((r, i) => <span key={i} style={{ fontSize: 9, background: "#2e4a1e", color: "#a5d6a7", padding: "2px 6px", borderRadius: 3 }}>{r}</span>)}
            </div>
          )}
          {unit.leader && <div style={{ fontSize: 10, color: "#90caf9", marginBottom: 6 }}>📎 Leader: {unit.leader}</div>}
          {unit.enhancement && <div style={{ fontSize: 10, color: "#ce93d8", background: "#2a1033", padding: "4px 6px", borderRadius: 4, marginBottom: 6 }}>✦ {unit.enhancement.name} (+{unit.enhancement.pts}pts): {unit.enhancement.desc}</div>}
          {unit.ranged?.length > 0 && <WeaponTable weapons={unit.ranged} type="ranged" />}
          {unit.melee?.length > 0 && <WeaponTable weapons={unit.melee} type="melee" />}
          {unit.abilities?.map((a, i) => (
            <div key={i} style={{ fontSize: 11, marginBottom: 4, background: "var(--ability-bg)", padding: "5px 7px", borderRadius: 4, borderLeft: "3px solid #c0392b" }}>
              <span style={{ fontWeight: 700, color: "#e8a040" }}>{a.name}:</span>{" "}
              <span style={{ color: "var(--text-dim)" }}>{a.desc}</span>
            </div>
          ))}
          {unit.keywords?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
              {unit.keywords.map((k, i) => <span key={i} style={{ fontSize: 8, background: "#1a1a30", color: "#7a7a9a", padding: "1px 5px", borderRadius: 2, border: "1px solid #2a2a4a" }}>{k}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StratagemCard({ strat }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "var(--card-bg)", borderRadius: 8, marginBottom: 6, border: `1px solid ${strat.color || "var(--border)"}40`, borderLeft: `4px solid ${strat.color || "#c0392b"}`, overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", padding: "8px 10px", cursor: "pointer", gap: 8 }}>
        <div style={{ background: strat.color || "#8B0000", color: "#fff", fontWeight: 900, fontSize: 12, padding: "3px 7px", borderRadius: 4, minWidth: 36, textAlign: "center" }}>{strat.cp}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text-main)", textTransform: "uppercase", letterSpacing: 0.5 }}>{strat.name}</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{strat.type}{strat.timing ? ` · ${strat.timing}` : ""}</div>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-dim)", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: "0 10px 10px", fontSize: 11 }}>
          <div style={{ marginBottom: 4 }}><span style={{ color: "#e8a040", fontWeight: 700 }}>WHEN:</span> <span style={{ color: "var(--text-dim)" }}>{strat.when}</span></div>
          <div style={{ marginBottom: 4 }}><span style={{ color: "#60b0e0", fontWeight: 700 }}>TARGET:</span> <span style={{ color: "var(--text-dim)" }}>{strat.target}</span></div>
          <div style={{ marginBottom: 4 }}><span style={{ color: "#a5d6a7", fontWeight: 700 }}>EFFECT:</span> <span style={{ color: "var(--text-dim)" }}>{strat.effect}</span></div>
          {strat.restrictions && <div><span style={{ color: "#ef9a9a", fontWeight: 700 }}>RESTRICTIONS:</span> <span style={{ color: "var(--text-dim)" }}>{strat.restrictions}</span></div>}
        </div>
      )}
    </div>
  );
}

function BlessingCard({ b }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "var(--card-bg)", borderRadius: 6, marginBottom: 4, border: "1px solid var(--border)", overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", padding: "6px 10px", cursor: "pointer", gap: 8 }}>
        <div style={{ background: "#5b1a1a", color: "#ff9999", fontWeight: 700, fontSize: 10, padding: "2px 6px", borderRadius: 3, minWidth: 60, textAlign: "center" }}>{b.roll}</div>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 12, color: "var(--text-main)" }}>{b.name}</div>
        <span style={{ fontSize: 11, color: "var(--text-dim)", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && <div style={{ padding: "0 10px 8px", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>{b.effect}</div>}
    </div>
  );
}

// ============ UPLOAD MENU ============
function UploadMenu({ onLoad }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef(null);
  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        const parsed = parseRosterJSON(json);
        if (parsed && parsed.units.length > 0) { onLoad(parsed); setOpen(false); }
        else alert("Errore: JSON non valido o nessuna unità trovata.");
      } catch { alert("Errore nel parsing del JSON."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [onLoad]);

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "1px solid #ffffff30", borderRadius: 6, color: "#fff", fontSize: 18, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}>⋮</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 998 }} />
          <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#1e1e3a", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", zIndex: 999, minWidth: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
            <div onClick={() => fileRef.current?.click()} style={{ padding: "12px 16px", cursor: "pointer", fontSize: 13, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = "#2a2a50"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              📂 Carica nuovo JSON
            </div>
            <div onClick={() => { onLoad(null); setOpen(false); }} style={{ padding: "12px 16px", cursor: "pointer", fontSize: 13, color: "#ef9a9a", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = "#2a2a50"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              🗑️ Reset lista
            </div>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} style={{ display: "none" }} />
    </div>
  );
}

// ============ EMPTY STATE ============
function EmptyState({ onLoad }) {
  const fileRef = useRef(null);
  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        const parsed = parseRosterJSON(json);
        if (parsed && parsed.units.length > 0) onLoad(parsed);
        else alert("Errore: JSON non valido o nessuna unità trovata.");
      } catch { alert("Errore nel parsing del JSON."); }
    };
    reader.readAsText(file);
  }, [onLoad]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🩸</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ff4444", marginBottom: 8, textTransform: "uppercase", letterSpacing: 2 }}>Army Viewer</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 24, maxWidth: 280, lineHeight: 1.5 }}>
        Carica il JSON della tua lista (BattleScribe / NewRecruit) per visualizzarla durante il gioco.
      </div>
      <button onClick={() => fileRef.current?.click()}
        style={{ background: "linear-gradient(135deg, #8B0000, #5b0a0a)", color: "#fff", border: "none", borderRadius: 10, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 16px rgba(139,0,0,0.4)" }}>
        📂 Carica JSON
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} style={{ display: "none" }} />
    </div>
  );
}

// ============ MAIN ============
const tabList = [
  { id: "units", label: "Unità", icon: "⚔" },
  { id: "strats", label: "Stratag.", icon: "📜" },
  { id: "blessings", label: "Bless.", icon: "🩸" },
  { id: "rules", label: "Regole", icon: "📖" },
];

export default function App() {
  const [army, setArmy] = useState(null);
  const [tab, setTab] = useState("units");
  const [search, setSearch] = useState("");

  const filteredUnits = useMemo(() => {
    if (!army) return [];
    if (!search) return army.units;
    const s = search.toLowerCase();
    return army.units.filter(u => u.name.toLowerCase().includes(s) || u.role.toLowerCase().includes(s) || u.keywords?.some(k => k.toLowerCase().includes(s)));
  }, [army, search]);

  const blessings = army?.blessings?.length > 0 ? army.blessings : [];

  return (
    <div style={{ "--card-bg": "#1a1a2e", "--stat-bg": "#16213e", "--border": "#2a2a4a", "--text-main": "#e0e0e0", "--text-dim": "#9a9ab0", "--ability-bg": "#12121f", fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#0f0f1a", minHeight: "100vh", maxWidth: 480, margin: "0 auto", paddingBottom: army ? 70 : 0, color: "var(--text-main)" }}>
      {!army ? <EmptyState onLoad={setArmy} /> : (
        <>
          <div style={{ background: "linear-gradient(135deg, #5b0a0a 0%, #1a0505 100%)", padding: "14px 14px 10px", borderBottom: "2px solid #8B0000", display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "#ff6666", textTransform: "uppercase", letterSpacing: 2, fontWeight: 700 }}>{army.faction} · {army.detachment}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", marginTop: 2 }}>{army.name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, background: "#3d0f0f", color: "#ff9999", padding: "2px 8px", borderRadius: 4 }}>{army.points}/{army.pointsLimit} pts</span>
                <span style={{ fontSize: 11, background: "#1a2a1a", color: "#a5d6a7", padding: "2px 8px", borderRadius: 4 }}>{army.battleSize || "Strike Force"}</span>
                <span style={{ fontSize: 11, background: "#1a1a3d", color: "#9fa8da", padding: "2px 8px", borderRadius: 4 }}>{army.units.length} unità</span>
              </div>
            </div>
            <UploadMenu onLoad={setArmy} />
          </div>

          {tab === "units" && (
            <div style={{ padding: "8px 14px 0" }}>
              <input type="text" placeholder="Cerca unità..." value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-main)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
          )}

          <div style={{ padding: "8px 10px" }}>
            {tab === "units" && filteredUnits.map((u, i) => <UnitCard key={u.id || i} unit={u} />)}
            {tab === "strats" && (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#ff6666", textTransform: "uppercase", letterSpacing: 1, padding: "4px 4px 8px", borderBottom: "1px solid #3d1010", marginBottom: 8 }}>🩸 {army.detachment}</div>
                {detachmentStratagems.map((s, i) => <StratagemCard key={i} strat={s} />)}
                <div style={{ fontSize: 13, fontWeight: 800, color: "#4fc3f7", textTransform: "uppercase", letterSpacing: 1, padding: "12px 4px 8px", borderBottom: "1px solid #1a3a5a", marginBottom: 8 }}>🔷 Core Stratagems</div>
                {coreStratagems.map((s, i) => <StratagemCard key={i} strat={s} />)}
              </>
            )}
            {tab === "blessings" && (
              <>
                <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "4px 4px 10px", lineHeight: 1.4 }}>All'inizio del round, tira 8D6. Usa i dadi per attivare fino a 2 Blessings. Ogni Blessing si attiva solo una volta per round.</div>
                {blessings.map((b, i) => <BlessingCard key={i} b={b} />)}
                {blessings.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 12, textAlign: "center", padding: 20 }}>Nessun Blessing trovato nel JSON.</div>}
              </>
            )}
            {tab === "rules" && (
              <>
                {army.detachmentRule && (
                  <div style={{ background: "var(--card-bg)", borderRadius: 8, padding: 12, marginBottom: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 800, color: "#ff6666", fontSize: 13, marginBottom: 4 }}>DETACHMENT RULE</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{army.detachmentRule}</div>
                  </div>
                )}
                <div style={{ background: "var(--card-bg)", borderRadius: 8, padding: 12, marginBottom: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 800, color: "#e8a040", fontSize: 13, marginBottom: 4 }}>BLESSINGS OF KHORNE</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>All'inizio del battle round, tira 8D6. Puoi usare quei dadi per attivare fino a 2 Blessings of Khorne. I dadi non usati vengono scartati.</div>
                </div>
                <div style={{ background: "var(--card-bg)", borderRadius: 8, padding: 12, marginBottom: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 800, color: "#90caf9", fontSize: 13, marginBottom: 4 }}>LEADER</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>Quando un'unità Bodyguard contiene un Leader, è nota come Attached unit. Gli attacchi usano la Toughness dei Bodyguard. Gli attacchi non possono essere allocati ai Character finché ci sono Bodyguard.</div>
                </div>
                {army.units.filter(u => u.enhancement).length > 0 && (
                  <div style={{ background: "var(--card-bg)", borderRadius: 8, padding: 12, marginBottom: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 800, color: "#ce93d8", fontSize: 13, marginBottom: 6 }}>ENHANCEMENTS</div>
                    {army.units.filter(u => u.enhancement).map((u, i) => (
                      <div key={i} style={{ marginBottom: 6, borderLeft: "3px solid #6a1b9a", paddingLeft: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 11, color: "#ce93d8" }}>{u.enhancement.name} (+{u.enhancement.pts}pts) → {u.name}</div>
                        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{u.enhancement.desc}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: "#0f0f1a", borderTop: "2px solid #8B0000", zIndex: 100 }}>
            {tabList.map(t => (
              <div key={t.id} onClick={() => setTab(t.id)}
                style={{ flex: 1, textAlign: "center", padding: "10px 0 8px", cursor: "pointer", background: tab === t.id ? "#2a0a0a" : "transparent", borderTop: tab === t.id ? "2px solid #ff4444" : "2px solid transparent", transition: "all 0.2s" }}>
                <div style={{ fontSize: 18 }}>{t.icon}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: tab === t.id ? "#ff6666" : "#666", textTransform: "uppercase" }}>{t.label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
