/* ProFormationPlus — notifications push (client). Inclure APRÈS supabase-js.
   Config par app : window.PFP_PUSH_APP = { icon, url, label } avant le chargement. */
(function () {
  var PFP_URL = 'https://lrslisyydbiejqzpsoxc.supabase.co';
  var PFP_KEY = 'sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP';
  var VAPID_PUBLIC = 'BAA87xX2YnIW93CPOXzOML_TWMjf0UTt1dj-nVb3HaMd8yANWp0agfvehGWk1UCeTmnb-b1sZ7DJBb3rLVVCyI0';
  var CFG = window.PFP_PUSH_APP || {};
  var _db = null;
  function db() { if (!_db) _db = window.supabase.createClient(PFP_URL, PFP_KEY, { auth: { persistSession: true, autoRefreshToken: false } }); return _db; }
  function supported() { return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); }
  function b64ToU8(b64) { var pad = '='.repeat((4 - b64.length % 4) % 4); var s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/'); var raw = atob(s); var u = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i); return u; }
  async function session() { try { var r = await db().auth.getSession(); return r.data.session || null; } catch (e) { return null; } }

  async function enable() {
    if (!supported()) { alert("Cet appareil ne supporte pas les notifications.\n\nSur iPhone : ouvre l'app depuis son icône sur l'écran d'accueil (pas dans Safari), iOS 16.4 minimum."); return { ok: false }; }
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert("Notifications refusées. Tu peux les réautoriser dans les réglages de ton téléphone."); return { ok: false }; }
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) });
    var j = sub.toJSON();
    var s = await session();
    if (!s || !s.user) { alert("Connecte-toi d'abord pour activer les notifications."); return { ok: false }; }
    var res = await db().from('push_subscriptions').upsert({ user_id: s.user.id, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent }, { onConflict: 'endpoint' });
    if (res.error) { alert('Erreur enregistrement : ' + res.error.message); return { ok: false }; }
    return { ok: true };
  }

  async function test(opts) {
    opts = opts || {};
    var r = await db().functions.invoke('send-push', { body: { action: 'test', title: opts.title || (CFG.label || 'ProFormationPlus'), body: opts.body || '🔔 Notification de test — tout fonctionne !', url: opts.url || CFG.url || location.pathname, icon: opts.icon || CFG.icon } });
    if (r.error) { alert('Erreur envoi : ' + r.error.message); return { ok: false }; }
    return r.data;
  }

  async function disable() {
    try { var reg = await navigator.serviceWorker.ready; var sub = await reg.pushManager.getSubscription(); if (sub) { await db().from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); } } catch (e) { }
    return { ok: true };
  }

  async function state() {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try { var reg = await navigator.serviceWorker.ready; var sub = await reg.pushManager.getSubscription(); return sub ? 'on' : 'off'; } catch (e) { return 'off'; }
  }

  window.pfpPush = { enable: enable, test: test, disable: disable, state: state, supported: supported };

  /* ---- petit bouton flottant 🔔 (rendu seulement si connecté) ---- */
  function injectUI() {
    if (document.getElementById('pfp-bell')) return;
    var wrap = document.createElement('div');
    wrap.id = 'pfp-bell';
    wrap.style.cssText = 'position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:99999;font-family:-apple-system,Segoe UI,Roboto,sans-serif';
    wrap.innerHTML =
      '<button id="pfp-bell-btn" title="Notifications" style="width:52px;height:52px;border-radius:50%;border:none;background:#3b74f2;color:#fff;font-size:22px;box-shadow:0 8px 22px -6px rgba(0,0,0,.5);cursor:pointer">🔔</button>' +
      '<div id="pfp-bell-menu" style="display:none;position:absolute;right:0;bottom:60px;background:#fff;color:#111;border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.28);padding:10px;min-width:210px">' +
      '<div id="pfp-bell-state" style="font-size:12px;color:#555;padding:4px 8px 8px">…</div>' +
      '<button data-a="enable" style="display:block;width:100%;text-align:left;border:none;background:#f2f5fb;border-radius:9px;padding:10px 12px;margin:4px 0;font-size:14px;cursor:pointer">🔔 Activer les notifications</button>' +
      '<button data-a="test" style="display:block;width:100%;text-align:left;border:none;background:#f2f5fb;border-radius:9px;padding:10px 12px;margin:4px 0;font-size:14px;cursor:pointer">📨 M\'envoyer un test</button>' +
      '<button data-a="disable" style="display:block;width:100%;text-align:left;border:none;background:#fdecec;color:#b42318;border-radius:9px;padding:10px 12px;margin:4px 0;font-size:14px;cursor:pointer">🔕 Désactiver</button>' +
      '</div>';
    document.body.appendChild(wrap);
    var menu = wrap.querySelector('#pfp-bell-menu');
    var lbl = wrap.querySelector('#pfp-bell-state');
    async function refresh() { var st = await state(); lbl.textContent = st === 'on' ? '✅ Notifications activées' : st === 'denied' ? '⛔ Bloquées (réglages du tel)' : st === 'unsupported' ? '⚠️ Non supporté (installe l\'app)' : '⚪ Désactivées'; }
    wrap.querySelector('#pfp-bell-btn').onclick = function () { var open = menu.style.display === 'block'; menu.style.display = open ? 'none' : 'block'; if (!open) refresh(); };
    menu.addEventListener('click', async function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      e.target.disabled = true; var old = e.target.textContent; e.target.textContent = '…';
      try {
        if (a === 'enable') { var r = await enable(); if (r.ok) alert('✅ Notifications activées ! Teste avec « M\'envoyer un test ».'); }
        else if (a === 'test') { var d = await test({}); if (d && d.ok) alert(d.sent > 0 ? '📨 Test envoyé — regarde ta notification.' : 'Aucun appareil abonné. Clique d\'abord « Activer ».'); }
        else if (a === 'disable') { await disable(); alert('🔕 Notifications désactivées sur cet appareil.'); }
      } finally { e.target.disabled = false; e.target.textContent = old; refresh(); }
    });
  }
  async function maybeUI() { var s = await session(); if (s && s.user) injectUI(); }
  if (document.readyState !== 'loading') maybeUI(); else document.addEventListener('DOMContentLoaded', maybeUI);
  // réagir à la connexion
  try { db().auth.onAuthStateChange(function (_e, s) { if (s && s.user) injectUI(); }); } catch (e) { }
})();
