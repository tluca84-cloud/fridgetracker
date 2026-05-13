import { useState, useEffect } from "react";

const STORAGE_KEY = "fridgetracker_v1";

const CATEGORIES = {
  frigo: ["Latticini","Carne & Pesce","Verdure","Frutta","Avanzi","Bevande","Altro"],
  freezer: ["Carne & Pesce","Verdure","Pane & Pasta","Gelati","Piatti Pronti","Altro"],
  dispensa: ["Pasta & Riso","Conserve","Snack","Oli & Condimenti","Spezie","Bevande","Altro"]
};

const CATEGORY_ICONS = {
  "Latticini":"🧀","Carne & Pesce":"🥩","Verdure":"🥦","Frutta":"🍎","Avanzi":"🍱","Bevande":"🥤","Altro":"📦",
  "Pasta & Riso":"🍝","Conserve":"🥫","Snack":"🍿","Oli & Condimenti":"🫙","Spezie":"🧂"
};

const defaultData = { frigo: [], freezer: [], dispensa: [] };

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : defaultData;
  } catch { return defaultData; }
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function daysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function expiryColor(days) {
  if (days === null) return "#888";
  if (days <= 0) return "#e53935";
  if (days <= 3) return "#e67e00";
  return "#2e7d32";
}

function expiryLabel(days) {
  if (days === null) return "";
  if (days <= 0) return "Scaduto";
  if (days === 1) return "Scade domani";
  return `${days}gg`;
}

const unitOptions = ["pz","g","kg","ml","L","conf","busta","lattina"];

let idCounter = Date.now();
function uid() { return ++idCounter; }

async function callClaude(prompt, system) {
  try {
    const res = await fetch("/.netlify/functions/claude", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 1000,
    system: system || "Sei un assistente utile per la gestione della cucina. Rispondi sempre in italiano.",
    messages: [{ role: "user", content: prompt }]
  })
});
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Risposta grezza:", text);
    const d = JSON.parse(text);
    return d.content?.map(b => b.text || "").join("") || "";
  } catch(e) {
    console.error("Errore:", e.message);
    return "";
  }
}

async function callClaudeWithImage(base64, mediaType) {
  const res = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      system: "Sei un estrattore di dati da scontrini. Rispondi SOLO con JSON valido, nessun altro testo.",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 }
          },
          {
            type: "text",
            text: "Questo è uno scontrino della spesa. Estrai tutti gli articoli alimentari. Restituisci SOLO un array JSON con oggetti: {name, qty (numero), unit (tra: pz,g,kg,ml,L,conf,busta,lattina), category (tra: Latticini,Carne & Pesce,Verdure,Frutta,Avanzi,Bevande,Pasta & Riso,Conserve,Snack,Oli & Condimenti,Spezie,Altro), location (frigo o dispensa)}. Solo JSON grezzo."
          }
        ]
      }]
    })
  });
  const d = await res.json();
  return d.content?.map(b => b.text || "").join("") || "";
}



export default function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("frigo");
  const [view, setView] = useState("inventory");
  const [filterCat, setFilterCat] = useState("Tutti");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name:"", category: CATEGORIES.frigo[0], qty:1, unit:"pz", expiry:"", location:"frigo" });
  const [scanText, setScanText] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipes, setRecipes] = useState(null);
  const [shopping, setShopping] = useState([]);
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [shoppingChecked, setShoppingChecked] = useState({});
  const [toast, setToast] = useState(null);
  const [scanMode, setScanMode] = useState("photo");
  const [scanImage, setScanImage] = useState(null);

  useEffect(() => { saveData(data); }, [data]);

  function showToast(msg, type="success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  function addItem(item) {
    const loc = item.location || tab;
    const newItem = { ...item, id: uid(), addedAt: new Date().toISOString() };
    setData(d => ({ ...d, [loc]: [...d[loc], newItem] }));
  }

  function removeItem(loc, id) {
    setData(d => ({ ...d, [loc]: d[loc].filter(i => i.id !== id) }));
  }

  function updateItem(loc, id, changes) {
    setData(d => ({ ...d, [loc]: d[loc].map(i => i.id === id ? { ...i, ...changes } : i) }));
  }

  const allItems = [...data.frigo, ...data.dispensa];

  const filtered = data[tab].filter(i => {
    const matchCat = filterCat === "Tutti" || i.category === filterCat;
    const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const expiringSoon = allItems.filter(i => {
    const d = daysUntilExpiry(i.expiry);
    return d !== null && d <= 3 && d >= 0;
  }).length;

  const expired = allItems.filter(i => {
    const d = daysUntilExpiry(i.expiry);
    return d !== null && d < 0;
  }).length;

  async function handleScan() {
    if (!scanText.trim()) return;
    setScanLoading(true);
    setScanResult(null);
    try {
      const txt = await callClaude(
        `Ecco il testo di uno scontrino della spesa:\n\n${scanText}\n\nEstrai tutti gli articoli alimentari. Per ciascuno restituisci SOLO un array JSON con oggetti con campi: name (stringa), qty (numero), unit (stringa tra: pz,g,kg,ml,L,conf,busta,lattina), category (scegli tra: Latticini,Carne & Pesce,Verdure,Frutta,Avanzi,Bevande,Pasta & Riso,Conserve,Snack,Oli & Condimenti,Spezie,Altro), location (frigo o dispensa). Rispondi SOLO con il JSON grezzo senza markdown.`,
        "Sei un estrattore di dati da scontrini. Rispondi SOLO con JSON valido, nessun altro testo."
      );
      const clean = txt.replace(/```json|```/g, "").trim();
      const items = JSON.parse(clean);
      setScanResult(items);
    } catch {
      showToast("Errore nel riconoscimento. Riprova.", "error");
    }
    setScanLoading(false);
  }

  function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSize = 1024;
      let w = img.width;
      let h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = (h / w) * maxSize; w = maxSize; }
        else { w = (w / h) * maxSize; h = maxSize; }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = dataUrl;
  });
}
  
  
  
  async function handleScanPhoto() {
  if (!scanImage) return;
  setScanLoading(true);
  setScanResult(null);
  try {
    // Ridimensiona l'immagine prima di inviarla
    const compressed = await compressImage(scanImage);
    const base64 = compressed.split(",")[1];
    const mediaType = compressed.split(";")[0].split(":")[1];
    const txt = await callClaudeWithImage(base64, mediaType);
    const clean = txt.replace(/```json|```/g, "").trim();
    const items = JSON.parse(clean);
    setScanResult(items);
  } catch {
    showToast("Errore nel riconoscimento. Riprova.", "error");
  }
  setScanLoading(false);
}

  function confirmScan() {
    if (!scanResult) return;
    scanResult.forEach(i => addItem(i));
    showToast(`${scanResult.length} articoli aggiunti!`);
    setScanResult(null);
    setScanText("");
    setView("inventory");
  }

  async function handleRecipes() {
    setRecipeLoading(true);
    setRecipes(null);
    setView("recipe");
    const itemList = allItems.map(i => `${i.name} (${i.qty} ${i.unit}${i.expiry ? ", scade: "+i.expiry : ""})`).join(", ");
    try {
      const txt = await callClaude(
        `Ho in frigo e dispensa questi ingredienti: ${itemList}.\n\nSuggerisci 3 ricette che posso preparare con quello che ho. Priorità agli ingredienti in scadenza. Per ogni ricetta: nome, tempo (minuti), difficoltà (Facile/Media/Difficile), ingredienti usati, e una breve descrizione. Rispondi SOLO con JSON array con oggetti: {name, time, difficulty, ingredients: [], description}. Nessun markdown.`,
        "Sei uno chef. Rispondi SOLO con JSON valido."
      );
      const clean = txt.replace(/```json|```/g, "").trim();
      setRecipes(JSON.parse(clean));
    } catch {
      showToast("Errore nel suggerire ricette.", "error");
    }
    setRecipeLoading(false);
  }

  async function handleShopping() {
    setShoppingLoading(true);
    setShopping([]);
    setView("shopping");
    const itemList = allItems.map(i => `${i.name}: ${i.qty} ${i.unit}`).join(", ");
    try {
      const txt = await callClaude(
        `Il mio inventario attuale: ${itemList || "vuoto"}.\nGenera una lista della spesa intelligente con gli articoli da comprare (scorte basse o mancanti). Aggiungi anche articoli base da non dimenticare. Rispondi SOLO con JSON array di oggetti: {name, qty, unit, category, priority (alta/media/bassa)}. Nessun markdown.`,
        "Sei un assistente per la spesa. Rispondi SOLO con JSON valido."
      );
      const clean = txt.replace(/```json|```/g, "").trim();
      setShopping(JSON.parse(clean));
    } catch {
      showToast("Errore nel generare la lista.", "error");
    }
    setShoppingLoading(false);
  }

  function addShoppingToInventory() {
    const toAdd = shopping.filter(i => shoppingChecked[i.name]);
    toAdd.forEach(i => addItem({ ...i, location: i.location || "dispensa" }));
    showToast(`${toAdd.length} articoli aggiunti all'inventario!`);
    setShoppingChecked({});
    setView("inventory");
  }

  const priorityColor = { alta: "#e53935", media: "#e67e00", bassa: "#2e7d32" };

  const s = {
    app: { fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto", padding: "1rem" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" },
    badge: (bg, color) => ({ fontSize: 12, background: bg, color, borderRadius: 8, padding: "3px 10px", border: `1px solid ${color}` }),
    nav: { display: "flex", gap: 6, marginBottom: "1rem", flexWrap: "wrap" },
    navBtn: (active) => ({ fontSize: 13, padding: "6px 14px", borderRadius: 8, background: active ? "#f0f0f0" : "transparent", border: `1px solid ${active ? "#aaa" : "#ddd"}`, cursor: "pointer", fontWeight: active ? 500 : 400 }),
    tabRow: { display: "flex", marginBottom: "1rem", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", width: "fit-content" },
    tabBtn: (active) => ({ padding: "7px 20px", fontSize: 14, background: active ? "#f0f0f0" : "transparent", border: "none", borderRight: "1px solid #ddd", cursor: "pointer", fontWeight: active ? 500 : 400 }),
    card: { background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: "12px 14px" },
    input: { width: "100%", fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", boxSizing: "border-box" },
    btn: (variant) => ({
      padding: variant === "primary" ? "10px 0" : "9px 20px",
      width: variant === "primary" ? "100%" : "auto",
      fontSize: 14, fontWeight: 500, cursor: "pointer", borderRadius: 8,
      background: "#f5f5f5", border: "1px solid #ccc", marginTop: variant === "primary" ? 0 : 10
    }),
    toast: (type) => ({
      position: "fixed", top: 16, right: 16, zIndex: 9999,
      background: type === "error" ? "#fdecea" : "#e8f5e9",
      color: type === "error" ? "#c62828" : "#1b5e20",
      border: `1px solid ${type === "error" ? "#ef9a9a" : "#a5d6a7"}`,
      borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 500
    })
  };

  return (
    <div style={s.app}>
      {toast && <div style={s.toast(toast.type)}>{toast.msg}</div>}

      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🧊</span>
          <span style={{ fontSize: 18, fontWeight: 500 }}>FridgeTracker</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {expiringSoon > 0 && <span style={s.badge("#fff8e1","#e67e00")}>⏱ {expiringSoon} in scadenza</span>}
          {expired > 0 && <span style={s.badge("#fdecea","#c62828")}>⚠ {expired} scaduti</span>}
        </div>
      </div>

      <div style={s.nav}>
        {[
          { id:"inventory", label:"Inventario" },
          { id:"add", label:"+ Aggiungi" },
          { id:"scan", label:"📄 Scontrino" },
          { id:"recipe", label:"🍳 Ricette AI" },
          { id:"shopping", label:"🛒 Lista spesa" },
        ].map(n => (
          <button key={n.id} style={s.navBtn(view===n.id)} onClick={() => {
            setView(n.id);
            if (n.id === "recipe") handleRecipes();
            if (n.id === "shopping") handleShopping();
          }}>{n.label}</button>
        ))}
      </div>

      {view === "inventory" && (
        <div>
          <div style={s.tabRow}>
            {["frigo","freezer","dispensa"].map(t => (
            <button key={t} style={s.tabBtn(tab===t)} onClick={() => { setTab(t); setFilterCat("Tutti"); }}>
            {t === "frigo" ? "🧊 Frigo" : t === "freezer" ? "❄️ Freezer" : "🗄 Dispensa"}
           </button>
          ))}
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:"1rem", flexWrap:"wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca..." style={{ ...s.input, flex:1, minWidth:140 }} />
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ fontSize:13, borderRadius:8, border:"1px solid #ddd", padding:"6px 10px" }}>
              <option>Tutti</option>
              {CATEGORIES[tab].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {filtered.length === 0
            ? <div style={{ textAlign:"center", padding:"2rem", color:"#888", fontSize:14 }}>Nessun articolo. Aggiungi qualcosa o scansiona uno scontrino.</div>
            : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px,1fr))", gap:10 }}>
                {filtered.map(item => {
                  const days = daysUntilExpiry(item.expiry);
                  return (
                    <div key={item.id} style={s.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12, color:"#888", marginBottom:2 }}>{CATEGORY_ICONS[item.category]||"📦"} {item.category}</div>
                          <div style={{ fontWeight:500, fontSize:15, marginBottom:4 }}>{item.name}</div>
                          <div style={{ fontSize:13, color:"#666" }}>{item.qty} {item.unit}</div>
                          {item.expiry && <div style={{ fontSize:12, color:expiryColor(days), marginTop:4, fontWeight:500 }}>{expiryLabel(days)}</div>}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4, marginLeft:8 }}>
                          <button onClick={() => updateItem(tab, item.id, { qty: Math.max(0, item.qty-1) })} style={{ width:26, height:26, fontSize:14, cursor:"pointer", border:"1px solid #ddd", borderRadius:6, background:"transparent" }}>−</button>
                          <button onClick={() => updateItem(tab, item.id, { qty: item.qty+1 })} style={{ width:26, height:26, fontSize:14, cursor:"pointer", border:"1px solid #ddd", borderRadius:6, background:"transparent" }}>+</button>
                          <button onClick={() => removeItem(tab, item.id)} style={{ width:26, height:26, fontSize:12, cursor:"pointer", border:"1px solid #ffcdd2", borderRadius:6, background:"transparent", color:"#c62828" }}>✕</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      )}

      {view === "add" && (
        <div style={{ maxWidth:480 }}>
          <p style={{ fontSize:14, color:"#888", marginBottom:"1rem" }}>Aggiungi manualmente un articolo.</p>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div>
              <label style={{ fontSize:13, color:"#666", display:"block", marginBottom:4 }}>Posizione</label>
              <select value={form.location} onChange={e => setForm(f => ({ ...f, location:e.target.value, category:CATEGORIES[e.target.value][0] }))} style={s.input}>
                <option value="frigo">🧊 Frigo</option>
                <option value="freezer">❄️ Freezer</option>
                <option value="dispensa">🗄 Dispensa</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, color:"#666", display:"block", marginBottom:4 }}>Nome *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} placeholder="es. Latte intero" style={s.input} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div>
                <label style={{ fontSize:13, color:"#666", display:"block", marginBottom:4 }}>Quantità</label>
                <input type="number" min="0" step="0.5" value={form.qty} onChange={e => setForm(f => ({ ...f, qty:parseFloat(e.target.value)||0 }))} style={s.input} />
              </div>
              <div>
                <label style={{ fontSize:13, color:"#666", display:"block", marginBottom:4 }}>Unità</label>
                <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit:e.target.value }))} style={s.input}>
                  {unitOptions.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize:13, color:"#666", display:"block", marginBottom:4 }}>Categoria</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category:e.target.value }))} style={s.input}>
                {CATEGORIES[form.location].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, color:"#666", display:"block", marginBottom:4 }}>Scadenza</label>
              <input type="date" value={form.expiry} onChange={e => setForm(f => ({ ...f, expiry:e.target.value }))} style={s.input} />
            </div>
            <button style={s.btn("primary")} onClick={() => {
              if (!form.name.trim()) { showToast("Inserisci un nome.", "error"); return; }
              addItem(form);
              showToast(`${form.name} aggiunto!`);
              setForm({ name:"", category:CATEGORIES[form.location][0], qty:1, unit:"pz", expiry:"", location:form.location });
              setView("inventory");
            }}>Aggiungi articolo</button>
          </div>
        </div>
      )}

      {view === "scan" && (
        <div style={{ maxWidth: 520 }}>
          <p style={{ fontSize: 14, color: "#888", marginBottom: "1rem" }}>
            Scatta una foto allo scontrino oppure incolla il testo. L'AI riconosce automaticamente i prodotti.
          </p>

          {/* Pulsanti modalità */}
          <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
            <button
              onClick={() => setScanMode("photo")}
              style={{ ...s.navBtn(scanMode === "photo"), flex: 1 }}>
              📷 Foto scontrino
            </button>
            <button
              onClick={() => setScanMode("text")}
              style={{ ...s.navBtn(scanMode === "text"), flex: 1 }}>
              ✏️ Testo manuale
            </button>
          </div>

          {/* Modalità foto */}
          {scanMode === "photo" && (
            <div>
              <input
                type="file"
                accept="image/*"
                id="scanPhoto"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    setScanImage(ev.target.result);
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <label htmlFor="scanPhoto" style={{
                display: "block", textAlign: "center", padding: "2rem",
                border: "2px dashed #ddd", borderRadius: 12, cursor: "pointer",
                color: "#888", fontSize: 14, marginBottom: "1rem"
              }}>
                {scanImage
                  ? <img src={scanImage} alt="scontrino" style={{ maxWidth: "100%", borderRadius: 8 }} />
                  : <span>📷 Tocca per scattare o scegliere una foto</span>
                }
              </label>
              {scanImage && (
                <button style={s.btn()} onClick={handleScanPhoto} disabled={scanLoading}>
                  {scanLoading ? "Analizzo..." : "Analizza foto"}
                </button>
              )}
            </div>
          )}

          {/* Modalità testo */}
          {scanMode === "text" && (
            <div>
              <textarea
                value={scanText}
                onChange={e => setScanText(e.target.value)}
                placeholder={"Es:\nLatte UHT 1L x2  €1.80\nPetto di pollo 500g  €4.20\n..."}
                style={{
                  width: "100%", minHeight: 150, fontSize: 13, boxSizing: "border-box",
                  borderRadius: 8, border: "1px solid #ddd", padding: 10,
                  resize: "vertical", fontFamily: "monospace"
                }}
              />
              <button style={s.btn()} onClick={handleScan} disabled={scanLoading || !scanText.trim()}>
                {scanLoading ? "Analizzo..." : "Analizza testo"}
              </button>
            </div>
          )}

          {/* Risultati */}
          {scanResult && (
            <div style={{ marginTop: "1.5rem" }}>
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
                Trovati {scanResult.length} articoli:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {scanResult.map((i, idx) => (
                  <div key={idx} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    ...s.card, padding: "8px 12px"
                  }}>
                    <div>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{CATEGORY_ICONS[i.category] || "📦"} {i.name}</span>
                      <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{i.qty} {i.unit} · {i.category} · {i.location}</span>
                    </div>
                    <button onClick={() => setScanResult(r => r.filter((_, j) => j !== idx))}
                      style={{ fontSize: 12, color: "#c62828", border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
                  </div>
                ))}
              </div>
              <button style={s.btn()} onClick={confirmScan}>
                Aggiungi tutti all'inventario
              </button>
            </div>
          )}
        </div>
      )}

      {view === "recipe" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
            <p style={{ fontSize:14, color:"#888" }}>Ricette in base a ciò che hai.</p>
            <button style={s.btn()} onClick={handleRecipes}>Aggiorna</button>
          </div>
          {recipeLoading && <div style={{ textAlign:"center", padding:"2rem", color:"#888", fontSize:14 }}>Cerco ricette...</div>}
          {!recipeLoading && allItems.length === 0 && <div style={{ textAlign:"center", padding:"2rem", color:"#888", fontSize:14 }}>Aggiungi prima qualche articolo.</div>}
          {recipes && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {recipes.map((r,i) => (
                <div key={i} style={s.card}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                    <div style={{ fontWeight:500, fontSize:16 }}>{r.name}</div>
                    <div style={{ display:"flex", gap:8 }}>
                      <span style={{ fontSize:12, background:"#f5f5f5", borderRadius:6, padding:"2px 8px", color:"#666" }}>⏱ {r.time} min</span>
                      <span style={{ fontSize:12, background:"#f5f5f5", borderRadius:6, padding:"2px 8px", color:"#666" }}>{r.difficulty}</span>
                    </div>
                  </div>
                  <p style={{ fontSize:13, color:"#666", marginBottom:8 }}>{r.description}</p>
                  <div style={{ fontSize:12, color:"#888" }}>Ingredienti: {(r.ingredients||[]).join(", ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "shopping" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
            <p style={{ fontSize:14, color:"#888" }}>Lista generata dall'AI in base alle tue scorte.</p>
            <button style={s.btn()} onClick={handleShopping}>Rigenera</button>
          </div>
          {shoppingLoading && <div style={{ textAlign:"center", padding:"2rem", color:"#888", fontSize:14 }}>Genero la lista...</div>}
          {!shoppingLoading && shopping.length > 0 && (
            <>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {shopping.map((i,idx) => (
                  <div key={idx} style={{ display:"flex", alignItems:"center", gap:12, ...s.card, padding:"10px 14px" }}>
                    <input type="checkbox" checked={!!shoppingChecked[i.name]} onChange={e => setShoppingChecked(s => ({ ...s, [i.name]:e.target.checked }))} style={{ width:16, height:16, cursor:"pointer" }} />
                    <div style={{ flex:1 }}>
                      <span style={{ fontWeight:500, fontSize:14 }}>{CATEGORY_ICONS[i.category]||"📦"} {i.name}</span>
                      <span style={{ fontSize:12, color:"#888", marginLeft:8 }}>{i.qty} {i.unit}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:500, color:priorityColor[i.priority]||"#888" }}>{i.priority}</span>
                  </div>
                ))}
              </div>
              {Object.values(shoppingChecked).some(Boolean) && (
                <button style={s.btn()} onClick={addShoppingToInventory}>Aggiungi selezionati all'inventario</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}