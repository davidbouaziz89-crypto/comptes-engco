/* Chat interne "gestion" — widget partagé, inclus dans toutes les apps.
   Autonome : crée son propre client Supabase, réutilise la session partagée.
   1:1 + groupes, présence, non-lus, "Vu", toast+son, pièces jointes, push. */
(function () {
  "use strict";
  const SUPA_URL = "https://lrslisyydbiejqzpsoxc.supabase.co";
  const SUPA_KEY = "sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP";
  const FN = SUPA_URL + "/functions/v1/";
  const MAX_FILE = 25 * 1024 * 1024;

  if (window.__egcChatLoaded) return; window.__egcChatLoaded = true;

  let sb, me, S;

  if (window.supabase && window.supabase.createClient) boot();
  else { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = boot; s.onerror = () => {}; document.head.appendChild(s); }

  async function boot() {
    if (window.egc && window.egc.sb) return;
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { // pas connecté : on attend une éventuelle connexion in-app
      sb.auth.onAuthStateChange((ev, s) => { if (s && (ev === "SIGNED_IN" || ev === "INITIAL_SESSION")) { window.__egcChatLoaded = false; boot(); } });
      return;
    }
    me = { id: session.user.id, email: session.user.email || "" };
    try { sb.realtime.setAuth(session.access_token); } catch (_) {}
    S = { dir: [], dirById: {}, convs: [], convById: {}, online: new Set(), openId: null, rendered: new Set(), view: "list" };
    window.egc = { sb, me, S, openConversation, startDirect };
    injectCSS(); buildShell();
    await Promise.all([loadDirectory(), loadConvs()]);
    setupPresence(); setupRealtime();
    renderList(); refreshBadge();
    // Ouverture directe depuis une notification (?egcchat=<id>)
    const m = /[?&]egcchat=([0-9a-f-]{36})/.exec(location.search);
    if (m) { openPanel(true); openConversation(m[1]); }
  }

  /* ---------- Utils ---------- */
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function el(id) { return document.getElementById(id); }
  function hash(s) { s = String(s || "x"); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function nameFromEmail(e) { const n = (e || "").split("@")[0].replace(/[._\-+]+/g, " ").trim(); return n ? n.replace(/\b\w/g, c => c.toUpperCase()) : (e || "—"); }
  function initials(e) { const n = (e || "?").split("@")[0].replace(/[._\-+]+/g, " ").trim().split(" ").filter(Boolean); return (((n[0] || "?")[0] || "?") + (n[1] ? n[1][0] : ((n[0] || "")[1] || ""))).toUpperCase(); }
  function hhmm(d) { const t = new Date(d); return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0"); }
  function dayLabel(d) { const t = new Date(d), n = new Date(); const s = t.toDateString(); if (s === n.toDateString()) return "Aujourd'hui"; const y = new Date(n.getTime() - 86400000); if (s === y.toDateString()) return "Hier"; return t.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }
  function avatarHTML(userId, email, genre) {
    const g = (genre || "").toLowerCase(); const online = S.online.has(userId);
    let inner;
    if (g === "homme" || g === "femme") { const n = ((hash(email) ^ (hash(email) >>> 7)) >>> 0) % 12 + 1; inner = `<img src="assets/avatars/${g}_${String(n).padStart(2, "0")}.png" alt="" onerror="this.remove()">`; }
    else { const h = hash(email) % 360; inner = `<span style="background:linear-gradient(135deg,hsl(${h} 60% 55%),hsl(${(h + 40) % 360} 60% 45%));position:absolute;inset:0;display:grid;place-items:center">${esc(initials(email))}</span>`; }
    return `<div class="egc-av">${inner}<span class="egc-pdot${online ? " on" : ""}"></span></div>`;
  }
  function soundOn() { return localStorage.getItem("egc-sound") !== "off"; }
  function beep() { if (!soundOn()) return; try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 660; g.gain.value = .05; o.start(); o.frequency.exponentialRampToValueAtTime(880, a.currentTime + .12); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .3); o.stop(a.currentTime + .3); } catch (_) {} }

  /* ---------- Shell ---------- */
  function injectCSS() { if (!el("egc-css")) { const l = document.createElement("link"); l.id = "egc-css"; l.rel = "stylesheet"; l.href = "./chat.css"; document.head.appendChild(l); } }
  function buildShell() {
    const root = document.createElement("div"); root.id = "egc-chat";
    root.innerHTML = `<button class="egc-bubble" id="egc-bubble" title="Messages">💬<span class="egc-badge" id="egc-badge" hidden>0</span></button>
      <div class="egc-panel" id="egc-panel" hidden></div>`;
    document.body.appendChild(root);
    el("egc-bubble").onclick = () => { const p = el("egc-panel"); p.hidden ? openPanel() : (p.hidden = true); };
  }
  function openPanel(force) { const p = el("egc-panel"); p.hidden = false; if (S.view === "conv" && S.openId) renderConversation(S.openId); else renderList(); }

  /* ---------- Données ---------- */
  async function loadDirectory() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(FN + "chat-directory", { method: "POST", headers: { Authorization: "Bearer " + session.access_token, apikey: SUPA_KEY } });
      const j = await r.json(); S.dir = j.users || []; S.dirById = {}; S.dir.forEach(u => S.dirById[u.user_id] = u);
    } catch (_) { S.dir = []; }
  }
  async function loadConvs() {
    const { data: convs } = await sb.from("chat_conversations").select("*").order("last_message_at", { ascending: false });
    const list = convs || []; const ids = list.map(c => c.id);
    let members = [], msgs = [];
    if (ids.length) {
      members = (await sb.from("chat_members").select("*").in("conversation_id", ids)).data || [];
      msgs = (await sb.from("chat_messages").select("conversation_id,body,created_at,sender_id,sender_email").in("conversation_id", ids).order("created_at", { ascending: true })).data || [];
    }
    const memByConv = {}, myMem = {};
    members.forEach(m => { (memByConv[m.conversation_id] = memByConv[m.conversation_id] || []).push(m); if (m.user_id === me.id) myMem[m.conversation_id] = m; });
    const lastByConv = {}, unread = {};
    msgs.forEach(m => { lastByConv[m.conversation_id] = m; });
    list.forEach(c => {
      const lr = myMem[c.id] ? new Date(myMem[c.id].last_read_at).getTime() : 0;
      unread[c.id] = msgs.filter(x => x.conversation_id === c.id && x.sender_id !== me.id && new Date(x.created_at).getTime() > lr).length;
    });
    S.convs = list.map(c => {
      const mem = memByConv[c.id] || []; const other = mem.find(m => m.user_id !== me.id);
      const last = lastByConv[c.id];
      return { id: c.id, type: c.type, title: c.title, members: mem, myMem: myMem[c.id], other,
        last_body: last ? (last.body || "📎 Pièce jointe") : "", last_at: last ? last.created_at : c.last_message_at,
        last_sender: last ? last.sender_id : null, unread: unread[c.id] || 0 };
    });
    S.convById = {}; S.convs.forEach(c => S.convById[c.id] = c);
  }
  // Nom affiché d'un utilisateur (Prénom Nom via l'annuaire, sinon déduit de l'email).
  function dispUser(userId, emailFb) { if (userId && me && userId === me.id) return "Moi"; const d = S.dirById[userId]; return (d && d.display_name) || nameFromEmail(emailFb || ""); }
  function groupNames(c) { return (c.members || []).filter(m => m.user_id !== me.id).map(m => dispUser(m.user_id, m.email)).join(", "); }
  function convName(c) { if (c.type === "group") return c.title || groupNames(c) || "Groupe"; const o = c.other; const d = o && S.dirById[o.user_id]; return d ? d.display_name : (o ? nameFromEmail(o.email) : "Discussion"); }
  function convAvatar(c) { if (c.type === "group") return `<div class="egc-av"><span style="position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#6366f1)">👥</span></div>`; const o = c.other; const d = o && S.dirById[o.user_id]; return avatarHTML(o ? o.user_id : "", o ? o.email : "", d ? d.genre : null); }

  /* ---------- Presence ---------- */
  function setupPresence() {
    const ch = sb.channel("presence:gestion", { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => { S.online = new Set(Object.keys(ch.presenceState())); if (!el("egc-panel").hidden) { if (S.view === "list") renderList(); else if (S.openId) renderConvHeaderStatus(); } });
    ch.subscribe(async st => { if (st === "SUBSCRIBED") await ch.track({ user_id: me.id, email: me.email, at: Date.now() }); });
    S.presence = ch;
  }

  /* ---------- Realtime BDD ---------- */
  function setupRealtime() {
    const ch = sb.channel("egc-db");
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, p => onNewMessage(p.new));
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_members" }, p => onMemberUpd(p.new));
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_members" }, p => { if (p.new.user_id === me.id) loadConvs().then(() => { if (!el("egc-panel").hidden && S.view === "list") renderList(); refreshBadge(); }); });
    ch.subscribe();
    S.db = ch;
    window.addEventListener("focus", () => { loadConvs().then(() => { if (!el("egc-panel").hidden && S.view === "list") renderList(); refreshBadge(); }); });
  }
  async function onNewMessage(row) {
    let c = S.convById[row.conversation_id];
    if (!c) { await loadConvs(); c = S.convById[row.conversation_id]; if (!c) return; if (!el("egc-panel").hidden && S.view === "list") renderList(); }
    // maj méta liste
    c.last_body = row.body || "📎 Pièce jointe"; c.last_at = row.created_at; c.last_sender = row.sender_id;
    if (S.openId === row.conversation_id && !el("egc-panel").hidden) {
      if (!S.rendered.has(row.id)) { appendMessage(row); S.rendered.add(row.id); }
      markRead(row.conversation_id);
    } else if (row.sender_id !== me.id) {
      c.unread = (c.unread || 0) + 1; toast(c, row); beep();
    }
    if (!el("egc-panel").hidden && S.view === "list") renderList();
    refreshBadge();
  }
  function onMemberUpd(row) {
    const c = S.convById[row.conversation_id]; if (c) { const mm = (c.members || []).find(m => m.id === row.id); if (mm) mm.last_read_at = row.last_read_at; if (row.user_id === me.id && c.myMem) c.myMem.last_read_at = row.last_read_at; }
    if (S.openId === row.conversation_id && !el("egc-panel").hidden) renderSeen();
    refreshBadge();
  }

  /* ---------- Badge / toast ---------- */
  function totalUnread() { return S.convs.reduce((n, c) => n + (c.unread || 0), 0); }
  function refreshBadge() { const b = el("egc-badge"); if (!b) return; const n = totalUnread(); b.textContent = n > 99 ? "99+" : n; b.hidden = n === 0; }
  function toast(c, row) {
    const old = el("egc-toast"); if (old) old.remove();
    const t = document.createElement("div"); t.className = "egc-toast"; t.id = "egc-toast";
    t.innerHTML = `${convAvatar(c)}<div style="flex:1;min-width:0"><div class="egc-tt">${esc(convName(c))}</div><div class="egc-tb">${esc((row.body || "📎 Pièce jointe")).slice(0, 60)}</div></div>`;
    t.onclick = () => { t.remove(); openPanel(); openConversation(c.id); };
    document.getElementById("egc-chat").appendChild(t);
    setTimeout(() => { if (el("egc-toast") === t) t.remove(); }, 6000);
  }

  /* ---------- Vue liste ---------- */
  function renderList() {
    S.view = "list"; const p = el("egc-panel"); if (!p) return;
    const onlineCount = S.online.size;
    p.innerHTML = `<div class="egc-head">
        <h3>Messages</h3><span class="egc-sub"><span class="egc-online-dot"></span>${onlineCount} en ligne</span>
        <button class="egc-ico" id="egc-snd" title="Son">${soundOn() ? "🔔" : "🔕"}</button>
        <button class="egc-ico" id="egc-new" title="Nouvelle discussion">✏️</button>
      </div>
      <div class="egc-search"><input id="egc-q" placeholder="Rechercher…"></div>
      <div class="egc-body" id="egc-list"></div>`;
    el("egc-snd").onclick = () => { localStorage.setItem("egc-sound", soundOn() ? "off" : "on"); renderList(); };
    el("egc-new").onclick = renderNew;
    el("egc-q").oninput = renderRows; renderRows();
  }
  function renderRows() {
    const q = (el("egc-q") ? el("egc-q").value : "").toLowerCase().trim();
    const box = el("egc-list"); if (!box) return;
    const convs = S.convs.filter(c => !q || convName(c).toLowerCase().includes(q));
    let html = "";
    if (convs.length) html += convs.map(rowConv).join("");
    // Annuaire (collègues sans conversation encore)
    const withConv = new Set(S.convs.filter(c => c.type === "direct" && c.other).map(c => c.other.user_id));
    const others = S.dir.filter(u => !withConv.has(u.user_id) && (!q || (u.display_name || u.email || "").toLowerCase().includes(q)));
    if (others.length) html += `<div class="egc-sechead">Contacts</div>` + others.map(rowDir).join("");
    box.innerHTML = html || `<div class="egc-empty">Aucun contact.</div>`;
    box.querySelectorAll("[data-conv]").forEach(b => b.onclick = () => openConversation(b.dataset.conv));
    box.querySelectorAll("[data-dir]").forEach(b => b.onclick = () => startDirect(b.dataset.dir));
  }
  function rowConv(c) {
    return `<button class="egc-row" data-conv="${c.id}">${convAvatar(c)}
      <div class="egc-rmid"><div class="egc-rname">${esc(convName(c))}</div><div class="egc-rlast">${esc(c.last_body).slice(0, 40)}</div></div>
      <div class="egc-rmeta"><span class="egc-rtime">${c.last_at ? hhmm(c.last_at) : ""}</span>${c.unread ? `<span class="egc-unread">${c.unread}</span>` : ""}</div></button>`;
  }
  function rowDir(u) {
    return `<button class="egc-row" data-dir="${u.user_id}">${avatarHTML(u.user_id, u.email, u.genre)}
      <div class="egc-rmid"><div class="egc-rname">${esc(u.display_name || nameFromEmail(u.email))}</div><div class="egc-rlast">${S.online.has(u.user_id) ? "En ligne" : "Hors ligne"}</div></div></button>`;
  }

  /* ---------- Nouvelle discussion / groupe ---------- */
  function renderNew() {
    S.view = "new"; const p = el("egc-panel");
    p.innerHTML = `<div class="egc-head"><button class="egc-ico" id="egc-back">←</button><h3>Nouvelle discussion</h3></div>
      <div class="egc-search"><input id="egc-nq" placeholder="Rechercher un collègue…"></div>
      <div class="egc-body" id="egc-dirlist"></div>
      <div class="egc-newbar" id="egc-groupbar" hidden><input id="egc-gname" placeholder="Nom du groupe"><button class="egc-btn" id="egc-gcreate">Créer</button></div>`;
    el("egc-back").onclick = renderList;
    const sel = new Set();
    const draw = () => {
      const q = (el("egc-nq").value || "").toLowerCase().trim();
      el("egc-dirlist").innerHTML = S.dir.filter(u => !q || (u.display_name || u.email || "").toLowerCase().includes(q)).map(u =>
        `<button class="egc-row" data-u="${u.user_id}">${avatarHTML(u.user_id, u.email, u.genre)}
          <div class="egc-rmid"><div class="egc-rname">${esc(u.display_name || nameFromEmail(u.email))}</div><div class="egc-rlast">${S.online.has(u.user_id) ? "En ligne" : "Hors ligne"}</div></div>
          <input type="checkbox" class="egc-chk" ${sel.has(u.user_id) ? "checked" : ""}></button>`).join("") || `<div class="egc-empty">Aucun collègue.</div>`;
      el("egc-dirlist").querySelectorAll("[data-u]").forEach(b => b.onclick = e => {
        const id = b.dataset.u;
        if (e.target.tagName === "INPUT") { e.target.checked ? sel.add(id) : sel.delete(id); }
        else { if (sel.size === 0) return startDirect(id); sel.has(id) ? sel.delete(id) : sel.add(id); }
        el("egc-groupbar").hidden = sel.size < 2; draw();
      });
    };
    el("egc-nq").oninput = draw; draw();
    el("egc-gcreate").onclick = async () => {
      const title = el("egc-gname").value.trim(); const members = [...sel];
      const { data, error } = await sb.rpc("chat_create_group", { p_title: title, p_members: members });
      if (error) return; await loadConvs(); openConversation(data);
    };
  }

  /* ---------- Conversation ---------- */
  async function startDirect(userId) {
    const { data, error } = await sb.rpc("chat_get_or_create_direct", { other: userId });
    if (error) return; await loadConvs(); openConversation(data);
  }
  async function openConversation(id) {
    if (el("egc-panel").hidden) el("egc-panel").hidden = false;
    S.view = "conv"; S.openId = id; S.rendered = new Set();
    if (!S.convById[id]) await loadConvs();
    renderConversation(id);
    const c = S.convById[id];
    const { data: msgs } = await sb.from("chat_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true });
    const list = msgs || []; const mids = list.map(m => m.id);
    let atts = [];
    if (mids.length) atts = (await sb.from("chat_attachments").select("*").in("message_id", mids)).data || [];
    S.attByMsg = {}; for (const a of atts) (S.attByMsg[a.message_id] = S.attByMsg[a.message_id] || []).push(a);
    const box = el("egc-msgs"); if (!box) return; box.innerHTML = "";
    let lastDay = "";
    for (const m of list) { const d = new Date(m.created_at).toDateString(); if (d !== lastDay) { lastDay = d; box.insertAdjacentHTML("beforeend", `<div class="egc-day">${esc(dayLabel(m.created_at))}</div>`); } appendMessage(m, true); S.rendered.add(m.id); }
    box.scrollTop = box.scrollHeight; renderSeen();
    markRead(id); if (c) { c.unread = 0; refreshBadge(); }
  }
  function renderConversation(id) {
    const c = S.convById[id] || { id, type: "direct", members: [], title: null }; const p = el("egc-panel");
    p.innerHTML = `<div class="egc-head"><button class="egc-ico" id="egc-back">←</button>${convAvatar(c)}
        <div style="flex:1;min-width:0"><h3 style="font-size:14px">${esc(convName(c))}</h3><span class="egc-sub" id="egc-status"></span></div></div>
      <div class="egc-body egc-msgs" id="egc-msgs"></div>
      <div class="egc-inbar"><button class="egc-clip" id="egc-clip" title="Pièce jointe">📎</button>
        <input type="file" id="egc-file" hidden>
        <input class="egc-txt" id="egc-input" placeholder="Écrire un message…">
        <button class="egc-send" id="egc-sendbtn" title="Envoyer">➤</button></div>`;
    el("egc-back").onclick = () => { S.openId = null; renderList(); };
    el("egc-clip").onclick = () => el("egc-file").click();
    el("egc-file").onchange = e => { const f = e.target.files[0]; if (f) sendMessage(id, "", f); e.target.value = ""; };
    const send = () => { const inp = el("egc-input"); const v = inp.value.trim(); if (!v) return; inp.value = ""; sendMessage(id, v, null); };
    el("egc-sendbtn").onclick = send;
    el("egc-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    renderConvHeaderStatus();
  }
  function renderConvHeaderStatus() {
    const st = el("egc-status"); if (!st) return; const c = S.convById[S.openId]; if (!c) return;
    if (c.type === "group") { const on = (c.members || []).filter(m => S.online.has(m.user_id)).length; const names = groupNames(c); st.textContent = (names || `${(c.members || []).length} membres`) + (on ? ` · ${on} en ligne` : ""); }
    else { st.innerHTML = c.other && S.online.has(c.other.user_id) ? `<span class="egc-online-dot"></span>En ligne` : "Hors ligne"; }
  }
  function appendMessage(m, noScroll) {
    const box = el("egc-msgs"); if (!box) return; const c = S.convById[m.conversation_id];
    const mine = m.sender_id === me.id;
    const who = (!mine && c && c.type === "group") ? `<div class="egc-who">${esc(dispUser(m.sender_id, m.sender_email))}</div>` : "";
    const atts = (S.attByMsg && S.attByMsg[m.id]) || [];
    let attHtml = "";
    for (const a of atts) attHtml += renderAttachment(a);
    const body = m.body ? esc(m.body) : "";
    box.insertAdjacentHTML("beforeend", `<div class="egc-msg ${mine ? "me" : "them"}" data-mid="${m.id}" data-at="${new Date(m.created_at).getTime()}">${who}${body}${attHtml}</div>`);
    if (attHtml) hydrateAttachments(box.lastElementChild);
    if (!noScroll) box.scrollTop = box.scrollHeight;
  }
  function renderAttachment(a) {
    const isImg = (a.mime || "").indexOf("image/") === 0;
    if (isImg) return `<img class="egc-att" data-path="${esc(a.path)}" alt="${esc(a.name || "")}">`;
    return `<a class="egc-file" data-path="${esc(a.path)}" data-name="${esc(a.name || "fichier")}" target="_blank" rel="noopener">📄 ${esc(a.name || "fichier")}</a>`;
  }
  async function hydrateAttachments(scope) {
    for (const node of scope.querySelectorAll("[data-path]")) {
      const { data } = await sb.storage.from("chat-files").createSignedUrl(node.dataset.path, 3600);
      if (data && data.signedUrl) { if (node.tagName === "IMG") { node.src = data.signedUrl; node.onclick = () => window.open(data.signedUrl, "_blank"); } else node.href = data.signedUrl; }
    }
  }
  function renderSeen() {
    const box = el("egc-msgs"); if (!box) return; const old = box.querySelector(".egc-seen"); if (old) old.remove();
    const c = S.convById[S.openId]; if (!c) return;
    const myMsgs = box.querySelectorAll(".egc-msg.me"); if (!myMsgs.length) return;
    const lastMine = [...box.querySelectorAll(".egc-msg.me")].pop();
    const lastTime = parseInt(lastMine.dataset.at, 10) || 0; // heure du dernier message que j'ai envoyé
    const others = (c.members || []).filter(m => m.user_id !== me.id);
    const seenBy = others.filter(m => new Date(m.last_read_at).getTime() >= lastTime);
    let txt;
    if (c.type === "group") txt = seenBy.length ? `Vu par ${seenBy.length}` : "Envoyé";
    else txt = seenBy.length ? `Vu ${hhmm(seenBy[0].last_read_at)}` : "Envoyé";
    lastMine.insertAdjacentHTML("afterend", `<div class="egc-seen">${esc(txt)}</div>`);
  }
  async function markRead(id) { try { await sb.rpc("chat_mark_read", { conv: id }); const c = S.convById[id]; if (c && c.myMem) c.myMem.last_read_at = new Date().toISOString(); } catch (_) {} }

  async function sendMessage(convId, body, file) {
    const { data: msg, error } = await sb.from("chat_messages").insert({ conversation_id: convId, sender_id: me.id, sender_email: me.email, body: body || null }).select().single();
    if (error || !msg) return;
    if (S.openId === convId && !S.rendered.has(msg.id)) { S.attByMsg = S.attByMsg || {}; appendMessage(msg); S.rendered.add(msg.id); }
    if (file) {
      if (file.size > MAX_FILE) { alert("Fichier trop volumineux (max 25 Mo)."); }
      else {
        const safe = (file.name || "fichier").replace(/[^\w.\-]+/g, "_");
        const path = convId + "/" + msg.id + "/" + safe;
        const up = await sb.storage.from("chat-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (!up.error) { await sb.from("chat_attachments").insert({ message_id: msg.id, path, name: file.name, mime: file.type, size: file.size });
          S.attByMsg = S.attByMsg || {}; S.attByMsg[msg.id] = [{ path, name: file.name, mime: file.type, size: file.size }];
          if (S.openId === convId) { const node = el("egc-msgs") && el("egc-msgs").querySelector(`[data-mid="${msg.id}"]`); if (node) { node.insertAdjacentHTML("beforeend", renderAttachment({ path, name: file.name, mime: file.type })); hydrateAttachments(node); } } }
      }
    }
    await sb.from("chat_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
    try { const { data: { session } } = await sb.auth.getSession(); fetch(FN + "chat-notify", { method: "POST", headers: { Authorization: "Bearer " + session.access_token, apikey: SUPA_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: convId, message_id: msg.id }) }).catch(() => {}); } catch (_) {}
    markRead(convId); renderSeen();
    const c = S.convById[convId]; if (c) { c.last_body = body || "📎 Pièce jointe"; c.last_at = new Date().toISOString(); c.last_sender = me.id; }
  }
})();
