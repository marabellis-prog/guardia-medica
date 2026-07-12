// ─── BUILD VERSION + SHA (auto-aggiornati dal workflow) ───
// NON modificare manualmente: il workflow li riscrive ad ogni deploy
var BUILD_VERSION = '1778341017866';
var BUILD_SHA = 'dev';

var POST=[],PAGE=1,PROW=null,DROW=null,DELEL=null;
var dirtyMap={};
var warnOpen=false;
var currentFilters=null;
var CURRENT_PAGE_SIZE=15;
var showIncompleteOnly=false;
window._postRowToDelete=null;

// Cache nodi DOM (popolata al DOMContentLoaded)
var els={};
function initEls(){
  ['tbody','selPost','selPageSize','linfo','pgn','btnSave','txd','txn','dtxt','errd','cbdgs','srchPost','srchQuery','srchPanel','srchDateFrom','srchDateTo','btnSearch','btnDoSearch']
    .forEach(function(id){els[id]=document.getElementById(id);});
}


// ═══════════════════════════════════════════════════════════════════
// SUPABASE API HELPER
// ═══════════════════════════════════════════════════════════════════

// JWT corrente per richieste autenticate. Popolato da setupAuth dopo login.
// Le RLS richiedono authenticated → senza JWT le query tornano vuote.
var currentJwt = null;

function sbFetch(path,opts){
  opts=opts||{};
  var token = currentJwt || SUPABASE_ANON_KEY;
  var headers={
    'apikey':SUPABASE_ANON_KEY,
    'Authorization':'Bearer '+token,
    'Content-Type':'application/json'
  };
  if(opts.prefer)headers['Prefer']=opts.prefer;
  var fetchOpts={
    method:opts.method||'GET',
    headers:headers,
    body:opts.body!==undefined?JSON.stringify(opts.body):undefined
  };
  if(opts.signal)fetchOpts.signal=opts.signal;
  return fetch(SUPABASE_URL+'/rest/v1/'+path,fetchOpts);
}

// Helper per i fetch raw (non via sbFetch) che hanno bisogno di JWT
function authHeaders(){
  var token = currentJwt || SUPABASE_ANON_KEY;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
}

// Rinnovo proattivo del JWT. getSession() rinnova automaticamente il token se
// scaduto/prossimo alla scadenza (se c'è un refresh token valido). Serve dopo
// lunghe inattività: quando il tab è in background o il device in sospensione,
// i timer di auto-refresh del browser vengono congelati e al risveglio il JWT
// può essere già scaduto → le query tornerebbero 401 con "JWT expired".
var _tokenRefreshInFlight = null;
function ensureFreshToken(){
  if(_tokenRefreshInFlight) return _tokenRefreshInFlight;
  _tokenRefreshInFlight = getSupabaseClient().then(function(client){
    return client.auth.getSession();
  }).then(function(res){
    var s = res && res.data && res.data.session;
    if(s && s.access_token){ currentJwt = s.access_token; }
    _tokenRefreshInFlight = null;
    return !!(s && s.access_token);
  }).catch(function(){
    _tokenRefreshInFlight = null;
    return false;
  });
  return _tokenRefreshInFlight;
}


// ═══════════════════════════════════════════════════════════════════
// CONVERSIONE TIMESTAMP
// ═══════════════════════════════════════════════════════════════════

function formatTSFromISO(iso){
  if(!iso)return '';
  var d=new Date(iso);
  if(isNaN(d.getTime()))return '';
  var p=function(n){return String(n).padStart(2,'0');};
  return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
}

function italianToISO(str){
  if(!str)return null;
  var m=String(str).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if(!m)return null;
  var d=new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5]);
  return isNaN(d.getTime())?null:d.toISOString();
}


// ═══════════════════════════════════════════════════════════════════
// LOADER
// ═══════════════════════════════════════════════════════════════════

function setLoaderMsg(msg){
  var el=document.getElementById('pl-msg');
  if(el)el.textContent=msg||'Caricamento in corso…';
}

function hideLoader(){
  var el=document.getElementById('page-loader');
  if(!el)return;
  el.classList.add('fade-out');
  setTimeout(function(){if(el.parentNode)el.remove();},450);
}


// ═══════════════════════════════════════════════════════════════════
// TEMA
// ═══════════════════════════════════════════════════════════════════

(function(){
  var t=document.querySelector('[data-theme-toggle]'),r=document.documentElement;
  var d='dark';
  r.setAttribute('data-theme',d);
  if(t)t.addEventListener('click',function(){
    d=d==='dark'?'light':'dark';
    r.setAttribute('data-theme',d);
    t.innerHTML=d==='dark'
      ?'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
      :'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  });
})();


// ═══════════════════════════════════════════════════════════════════
// DOM READY
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────
// AUTH: login Google + whitelist + admin panel
// - All'avvio: check sessione + check whitelist
// - Se non autenticato: login screen
// - Se autenticato ma non in whitelist: logout + msg
// - Se autenticato e in whitelist: carica app + memorizza role
// ───────────────────────────────────────────────────────────
var currentUser = null; // { id, email, full_name, role }
// Flag per impedire il reload automatico in onAuthStateChange dopo SIGNED_OUT
// causato da un check whitelist fallito (così l'utente vede il messaggio di errore)
var authRejectInProgress = false;

function authShowOverlay(errorMsg, allowHtml){
  var ov = document.getElementById('authOverlay');
  var loader = document.getElementById('page-loader');
  var er = document.getElementById('authError');
  if(loader) loader.style.display = 'none';
  if(ov) ov.style.display = 'flex';
  if(er){
    if(errorMsg){
      if(allowHtml) er.innerHTML = errorMsg;
      else er.textContent = errorMsg;
      er.style.display = 'block';
    } else {
      er.style.display = 'none';
      er.textContent = '';
    }
  }
  // Riabilita il pulsante "Accedi con Google" (se era in stato "Apertura Google…")
  var btn = document.getElementById('btnAuthGoogle');
  if(btn){
    btn.disabled = false;
    var span = btn.querySelector('span');
    if(span) span.textContent = 'Accedi con Google';
  }
  // Nasconde l'app
  document.body.classList.add('auth-pending');
}

function authHideOverlay(){
  var ov = document.getElementById('authOverlay');
  if(ov) ov.style.display = 'none';
  document.body.classList.remove('auth-pending');
}

async function checkWhitelist(client, email){
  var emailLower = String(email||'').toLowerCase();
  if(!emailLower) return null;
  var res = await client.from('users_whitelist').select('id,email,full_name,role,protected').ilike('email', emailLower).limit(1);
  if(res.error){
    try{console.error('checkWhitelist error:', JSON.stringify(res.error));}catch(_){}
    var msg = res.error.message || 'errore sconosciuto';
    if(res.error.code) msg += ' (code: '+res.error.code+')';
    throw new Error(msg);
  }
  if(!res.data || !res.data.length) return null;
  return res.data[0];
}

async function setupAuth(){
  authShowOverlay(); // mostra subito login screen
  var client;
  try {
    client = await getSupabaseClient();
  } catch(e) {
    authShowOverlay('Errore caricamento client autenticazione. Ricarica la pagina.');
    return;
  }

  // Listener cambi auth (utile per logout, refresh token)
  client.auth.onAuthStateChange(function(event, session){
    if(event === 'SIGNED_OUT'){
      currentUser = null;
      currentJwt = null;
      // Se il signOut è stato causato da un check whitelist fallito,
      // NON ricaricare: l'utente deve poter leggere il messaggio di errore.
      if(authRejectInProgress) return;
      authShowOverlay();
      setTimeout(function(){ window.location.reload(); }, 200);
    } else if(event === 'TOKEN_REFRESHED' && session){
      // Aggiorna JWT su refresh per non perdere autenticazione
      currentJwt = session.access_token;
    }
  });

  // Verifica sessione esistente
  var sessRes = await client.auth.getSession();
  var session = sessRes.data && sessRes.data.session;
  if(!session){
    authShowOverlay();
    return;
  }

  // Popola subito il JWT per le query autenticate
  currentJwt = session.access_token;

  var email = session.user && session.user.email;
  if(!email){
    authRejectInProgress = true;
    try { await client.auth.signOut(); } catch(_){}
    setTimeout(function(){ authRejectInProgress = false; }, 1500);
    authShowOverlay('Login senza email valida. Riprova.', true);
    return;
  }

  // Whitelist check
  var entry;
  try { entry = await checkWhitelist(client, email); }
  catch(e){
    authShowOverlay('Errore verifica autorizzazioni: '+(e.message||e), false);
    return;
  }
  if(!entry){
    authRejectInProgress = true;
    try { await client.auth.signOut(); } catch(_){}
    setTimeout(function(){ authRejectInProgress = false; }, 1500);
    authShowOverlay(
      'L\'account Google <b>'+esc(email)+'</b> non è in whitelist.<br><br>'
      + 'Se ti aspettavi di poter entrare, controlla con l\'amministratore che '
      + 'questa sia l\'email registrata. Potresti anche aver effettuato login con un account Google diverso da quello previsto: clicca "Usa un altro account Google" per riprovare.',
      true
    );
    return;
  }

  // Tutto ok: setta currentUser e prosegui boot app
  currentUser = {
    id: session.user.id,
    email: entry.email,
    full_name: entry.full_name,
    role: entry.role,
    protected: entry.protected
  };

  authHideOverlay();
  renderUserMenu();
  if(currentUser.role === 'admin') renderAdminBadge();

  // Boot app (continua il flusso normale)
  loadPost();
  setupAutoRefresh();
  setupVersionWatcher();
  // Operazioni autenticate (post-JWT)
  syncProcess();
  autoPurgeOld();
  refreshTrashBadge();
  // GIRA CHIAMATA: carica pending + attiva realtime sul canale girate
  setupGirate();
  // Recupera eventuale bozza di nuova chiamata non ancora salvata
  restoreDraft();
}

async function authSignInWithGoogle(forceAccountChoice){
  var btn = document.getElementById('btnAuthGoogle');
  if(btn){ btn.disabled = true; btn.querySelector('span').textContent = 'Apertura Google…'; }
  try {
    var client = await getSupabaseClient();
    var opts = {
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    };
    // Se richiesto, forza la schermata di scelta account Google
    // (utile quando il browser è loggato con account sbagliato e tenta auto-login)
    if(forceAccountChoice){
      opts.options.queryParams = { prompt: 'select_account' };
    }
    await client.auth.signInWithOAuth(opts);
  } catch(e){
    if(btn){ btn.disabled = false; btn.querySelector('span').textContent = 'Accedi con Google'; }
    authShowOverlay('Errore apertura Google: '+(e&&e.message||e));
  }
}

async function authSignOut(){
  try {
    var client = await getSupabaseClient();
    await client.auth.signOut();
  } catch(_){}
  currentUser = null;
  // onAuthStateChange triggera il reload
}

// User menu rendering
function renderUserMenu(){
  if(!currentUser) return;
  var menu = document.getElementById('userMenu');
  if(!menu) return;
  menu.style.display = '';
  var initial = (currentUser.full_name||currentUser.email||'?').charAt(0).toUpperCase();
  document.getElementById('userMenuAvatar').textContent = initial;
  document.getElementById('userMenuName').textContent = currentUser.full_name || currentUser.email;
  document.getElementById('userMenuFullname').textContent = currentUser.full_name;
  document.getElementById('userMenuEmail').textContent = currentUser.email;
  var rolePill = document.getElementById('userMenuRole');
  rolePill.textContent = currentUser.role==='admin'?'Admin':'Utente';
  rolePill.className = 'user-menu-role'+(currentUser.role==='admin'?' role-admin':'');
}

function renderAdminBadge(){
  var b = document.getElementById('btnAdminOpen');
  if(b) b.style.display = '';
  // Anche la gestione postazioni è admin-only (postazioni sono condivise)
  var bp = document.getElementById('btnGestPost');
  if(bp) bp.style.display = '';
}

// ───────────────────────────────────────────────────────────
// ADMIN PANEL: CRUD su users_whitelist
// ───────────────────────────────────────────────────────────
var adminUserToDelete = null; // { id, email, full_name }

async function adminLoadUsers(){
  var wrap = document.getElementById('adminUserList');
  if(!wrap) return;
  wrap.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spin" style="margin:0 auto;border-color:rgba(46,125,94,.25);border-top-color:var(--pr);width:24px;height:24px"></div></div>';
  try {
    var client = await getSupabaseClient();
    // Uso RPC SECURITY DEFINER (bypassa RLS, niente ricorsione possibile)
    var res = await client.rpc('admin_list_users');
    if(res.error) throw res.error;
    var users = res.data || [];
    if(!users.length){
      wrap.innerHTML = '<div class="emp" style="padding:2rem"><h3>Nessun utente</h3><p>Aggiungi il primo utente.</p></div>';
      return;
    }
    wrap.innerHTML = users.map(function(u){
      var roleClass = u.role==='admin'?'role-admin':'';
      var roleLabel = u.role==='admin'?'Admin':'Utente';
      var actions = u.protected
        ? '<span class="admin-user-protected" title="Account base, non eliminabile"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Protetto</span>'
        : '<button type="button" class="admin-user-del" data-id="'+u.id+'" data-email="'+esc(u.email)+'" data-name="'+esc(u.full_name)+'">Elimina</button>';
      return '<div class="admin-user-row" data-id="'+u.id+'">'
        +'<div class="admin-user-info">'
          +'<div class="admin-user-name">'+esc(u.full_name)+'</div>'
          +'<div class="admin-user-email">'+esc(u.email)+'</div>'
          +'<span class="admin-user-role '+roleClass+'">'+roleLabel+'</span>'
        +'</div>'
        +actions
      +'</div>';
    }).join('');
  } catch(e){
    wrap.innerHTML = '<div class="emp" style="padding:2rem"><h3>Errore</h3><p>'+esc(e.message||'Impossibile caricare utenti.')+'</p></div>';
  }
}

function adminOpenPanel(){ apri('madmin'); adminLoadUsers(); }
function adminOpenAddForm(){
  document.getElementById('addUserName').value='';
  document.getElementById('addUserEmail').value='';
  document.querySelector('input[name="addUserRole"][value="user"]').checked = true;
  document.getElementById('addUserErr').style.display='none';
  apri('madminAdd');
}

async function adminConfirmAddUser(){
  var name = (document.getElementById('addUserName').value||'').trim();
  var email = (document.getElementById('addUserEmail').value||'').trim().toLowerCase();
  var role = document.querySelector('input[name="addUserRole"]:checked').value;
  var er = document.getElementById('addUserErr');
  function showErr(m){ er.textContent = m; er.style.display='block'; }
  if(!name || name.length<2){ showErr('Inserisci un nome valido.'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showErr('Email non valida.'); return; }

  var btn = document.getElementById('btnAdminAddConfirm');
  btn.disabled = true; btn.textContent = 'Aggiungo…';
  try {
    var client = await getSupabaseClient();
    var res = await client.rpc('admin_add_user', { p_email: email, p_full_name: name, p_role: role });
    btn.disabled = false; btn.textContent = 'Aggiungi';
    if(res.error){
      if((res.error.message||'').indexOf('duplicate')!==-1||res.error.code==='23505')
        showErr('Esiste già un utente con questa email.');
      else showErr('Errore: '+res.error.message);
      return;
    }
    chiudi('madminAdd');
    fb(true,'Aggiunto', name+' può ora accedere all\'app.');
    adminLoadUsers();
  } catch(e){
    btn.disabled = false; btn.textContent = 'Aggiungi';
    showErr('Errore: '+(e.message||e));
  }
}

function adminPromptDelete(userId, userEmail, userName){
  adminUserToDelete = { id: userId, email: userEmail, full_name: userName };
  var msg = 'Stai per eliminare <b>'+esc(userName)+'</b> ('+esc(userEmail)+')<br><br>'
    + 'Verranno cancellate <b>tutte le sue chiamate</b> (anche quelle nel cestino) e l\'account verrà rimosso.'
    + '<br><br><b style="color:var(--er)">Operazione irreversibile.</b>';
  document.getElementById('madminDelMsg').innerHTML = msg;
  document.getElementById('adminDelConfirmInput').value = '';
  var bc = document.getElementById('btnAdminDelConfirm');
  bc.disabled = true; bc.style.opacity='.5';
  apri('madminDel');
  setTimeout(function(){ document.getElementById('adminDelConfirmInput').focus(); }, 200);
}

async function adminConfirmDelete(){
  if(!adminUserToDelete) return;
  var u = adminUserToDelete;
  var btn = document.getElementById('btnAdminDelConfirm');
  btn.disabled = true; btn.textContent = 'Elimino…';
  try {
    var client = await getSupabaseClient();
    var res = await client.rpc('admin_delete_user', { p_id: u.id });
    btn.disabled = false; btn.textContent = 'Elimina';
    if(res.error){
      var m = res.error.message || '';
      if(m.indexOf('protected_user')!==-1) fb(false,'Errore','Utente protetto, non eliminabile.');
      else if(m.indexOf('not_admin')!==-1) fb(false,'Errore','Solo gli admin possono eliminare utenti.');
      else fb(false,'Errore', m);
      return;
    }
    chiudi('madminDel');
    fb(true,'Eliminato', u.full_name+' e tutti i suoi dati sono stati rimossi.');
    adminUserToDelete = null;
    adminLoadUsers();
  } catch(e){
    btn.disabled = false; btn.textContent = 'Elimina';
    fb(false,'Errore', e.message||String(e));
  }
}

// ───────────────────────────────────────────────────────────
// AUTO-REFRESH: real-time multi-device sync
// - PRIMARY: Supabase Realtime (WebSocket push, sub-secondo)
// - FALLBACK: polling 60s su max(updated_at) se Realtime fallisce
// - Visibility change: refresh immediato al ritorno sul tab
// - Banner non intrusivo se utente impegnato
// ───────────────────────────────────────────────────────────
var REFRESH_POLL_MS=60000;
var lastKnownUpdate=0;
var refreshPollTimer=null;
var realtimeChannel=null;
var realtimeDebounceTimer=null;
var REALTIME_DEBOUNCE_MS=500;
// Soppressione "echo": ignora gli eventi realtime nei 3s successivi
// a una nostra scrittura (POST/PATCH/DELETE) per non auto-notificarci
var lastOwnWriteAt=0;
var OWN_WRITE_SUPPRESSION_MS=3000;
function markOwnWrite(){lastOwnWriteAt=Date.now();}
function isWithinOwnWriteWindow(){return (Date.now()-lastOwnWriteAt)<OWN_WRITE_SUPPRESSION_MS;}

function fetchLatestUpdate(){
  return fetch(SUPABASE_URL+'/rest/v1/chiamate?select=updated_at&order=updated_at.desc&limit=1',{
    headers:authHeaders()
  }).then(function(r){return r.json();}).then(function(data){
    if(!data||!data.length||!data[0].updated_at)return 0;
    return new Date(data[0].updated_at).getTime();
  }).catch(function(){return 0;});
}

function isAnyModalOpen(){
  return !!document.querySelector('.mov.open');
}

function isUserBusy(){
  if(Object.keys(dirtyMap).length>0)return true;
  if(isAnyModalOpen())return true;
  // Se l'utente sta scrivendo nel form
  var ae=document.activeElement;
  if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.isContentEditable))return true;
  return false;
}

function checkForRemoteChanges(){
  if(document.hidden)return;
  fetchLatestUpdate().then(function(ts){
    if(!ts)return;
    if(!lastKnownUpdate){lastKnownUpdate=ts;return;}
    if(ts>lastKnownUpdate){
      handleRemoteChanges();
    }
  });
}

function handleRemoteChanges(){
  if(isUserBusy()){
    showRefreshAvailableBanner();
    return;
  }
  // Auto-refresh silenzioso
  refreshAndUpdateMark();
}

function refreshAndUpdateMark(){
  loadRows(PAGE);
  // Aggiorna mark dopo che la query è andata a buon fine
  fetchLatestUpdate().then(function(ts){if(ts)lastKnownUpdate=ts;});
}

function showRefreshAvailableBanner(){
  if(document.getElementById('refreshBanner'))return;
  var b=document.createElement('div');
  b.id='refreshBanner';
  b.className='refresh-banner';
  b.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
    +'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
    +'</svg><span>Nuovi dati disponibili</span><button type="button">Aggiorna</button>';
  b.querySelector('button').addEventListener('click',function(){
    b.remove();
    // Salva eventuali dirty in coda prima di ricaricare per non perderle
    if(Object.keys(dirtyMap).length>0){
      saveAllDirtySilent(function(){refreshAndUpdateMark();});
    } else {
      refreshAndUpdateMark();
    }
  });
  // Anche click su X dello SVG = aggiorna; tap intera barra
  b.addEventListener('click',function(e){
    if(e.target.tagName==='BUTTON')return; // gestito sopra
  });
  document.body.appendChild(b);
}

function startPolling(){
  if(refreshPollTimer)return;
  refreshPollTimer=setInterval(checkForRemoteChanges,REFRESH_POLL_MS);
}
function stopPolling(){
  if(refreshPollTimer){clearInterval(refreshPollTimer);refreshPollTimer=null;}
}

// Debounced trigger comune sia per Realtime che per polling
function scheduleRefreshFromRemote(){
  if(realtimeDebounceTimer)clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer=setTimeout(function(){
    handleRemoteChanges();
  },REALTIME_DEBOUNCE_MS);
}

// Client Supabase condiviso (lazy, una sola istanza per tutta la pagina)
var supabaseClientPromise=null;
function getSupabaseClient(){
  if(supabaseClientPromise)return supabaseClientPromise;
  supabaseClientPromise=loadScriptOnce('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')
    .then(function(){
      if(!window.supabase||!window.supabase.createClient){
        throw new Error('Supabase JS client non disponibile');
      }
      return window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
        realtime:{params:{eventsPerSecond:10}}
      });
    });
  return supabaseClientPromise;
}

function setupRealtime(){
  getSupabaseClient()
    .then(function(client){
      // Filter user_id: ricevi solo eventi delle tue chiamate (le altrui sono già escluse da RLS)
      var rtFilter = {event:'*',schema:'public',table:'chiamate'};
      if(currentUser&&currentUser.id) rtFilter.filter = 'user_id=eq.'+currentUser.id;
      realtimeChannel=client.channel('chiamate-realtime')
        .on('postgres_changes',rtFilter,function(payload){
          // Skip "echo": eventi causati dalle nostre stesse scritture
          if(isWithinOwnWriteWindow())return;
          // Push event ricevuto → trigger refresh con debounce
          scheduleRefreshFromRemote();
        })
        .subscribe(function(status){
          if(status==='SUBSCRIBED'){
            // Realtime attivo: ferma il polling fallback
            stopPolling();
          } else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
            // Realtime caduto: attiva polling fallback
            startPolling();
          }
        });
    })
    .catch(function(){
      // Errore caricamento lib: usa polling
      startPolling();
    });
}

// ───────────────────────────────────────────────────────────
// VERSION WATCHER: notifica quando esce un nuovo deploy
// - Si appoggia al canale Supabase Realtime su tabella app_version
// - Quando il ts cambia → polling sul fresh script.js
// - Confronto BUILD_VERSION corrente vs quella nel file fresco
// - Quando matcha → mostra badge in NavBar
// - Click badge → cleanup completo + reload con cache buster
// ───────────────────────────────────────────────────────────
var versionPollHandle=null;

function checkFreshAvailable(){
  // Fetch dello script.js con cache buster (URL diverso → SW cache miss)
  // ⚠️ Importante: cache:'reload' bypassa anche la HTTP cache locale
  return fetch('./script.js?_check='+Date.now(),{
    cache:'reload',
    credentials:'same-origin',
    headers:{'Cache-Control':'no-cache, no-store'}
  }).then(function(r){
    if(!r.ok)return null;
    return r.text();
  }).then(function(text){
    if(!text)return false;
    // Estrai BUILD_VERSION dal file fresco
    var m=text.match(/var\s+BUILD_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if(!m)return false;
    var freshVersion=m[1];
    // Se diverso dalla versione che sto running → c'è una nuova versione
    return freshVersion!==BUILD_VERSION;
  }).catch(function(){return false;});
}

function startVersionPolling(){
  if(versionPollHandle!==null)return;
  var tries=0;
  var tick=function(){
    tries++;
    checkFreshAvailable().then(function(isFresh){
      if(isFresh){
        clearInterval(versionPollHandle);versionPollHandle=null;
        showUpdateBadge();
        return;
      }
      // Safety net: dopo 60 tentativi (10 min) mostra comunque
      // (l'utente cliccando farà fetch con ?_r=… che forza fresh dall'origin)
      if(tries>=60){
        clearInterval(versionPollHandle);versionPollHandle=null;
        showUpdateBadge();
      }
    });
  };
  tick();
  versionPollHandle=setInterval(tick,10000);
}

function setupVersionWatcher(){
  getSupabaseClient().then(function(client){
    var lastSeenTs=null;

    // Registra punto di partenza
    client.from('app_version').select('ts').eq('id',1).single()
      .then(function(res){
        if(res&&res.data)lastSeenTs=String(res.data.ts);
      });

    // Sottoscrivi al canale dedicato
    client.channel('app-version-watch')
      .on('postgres_changes',{
        event:'UPDATE',schema:'public',table:'app_version',filter:'id=eq.1'
      },function(payload){
        var newTs=String(payload.new.ts);
        if(lastSeenTs&&newTs!==lastSeenTs)startVersionPolling();
        lastSeenTs=newTs;
      })
      .subscribe();

    // Anche su visibility change controlla (ricopre il caso "tab in background")
    document.addEventListener('visibilitychange',function(){
      if(document.hidden)return;
      client.from('app_version').select('ts').eq('id',1).single()
        .then(function(res){
          if(!res||!res.data)return;
          var remoteTs=String(res.data.ts);
          if(lastSeenTs&&remoteTs!==lastSeenTs)startVersionPolling();
          lastSeenTs=remoteTs;
        });
    });
  }).catch(function(){
    // Senza Supabase JS niente notifiche real-time, ma il SW continuerà
    // a aggiornare la cache in background. Niente di rotto.
  });
}

function showUpdateBadge(){
  if(document.getElementById('updateBadge'))return;
  // Rimuovi banner SW vecchio se presente
  var old=document.getElementById('updateBanner');if(old)old.remove();

  var badge=document.createElement('button');
  badge.id='updateBadge';
  badge.type='button';
  badge.className='update-badge';
  badge.title='Clicca per ricaricare con la versione aggiornata';
  badge.innerHTML=
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="update-badge-spin">'
      +'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>'
      +'<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
    +'</svg>'
    +'<span>Aggiornamento disponibile</span>';
  badge.addEventListener('click',applyVersionUpdate);

  // Inserisci nella NavBar prima delle azioni esistenti
  var hactions=document.querySelector('.hactions');
  if(hactions)hactions.insertBefore(badge,hactions.firstChild);
  else document.body.appendChild(badge);
}

function applyVersionUpdate(){
  // 1. Cleanup di TUTTE le caches (SW + HTTP cache via API)
  var cleanupPromises=[];
  if(window.caches){
    cleanupPromises.push(
      caches.keys().then(function(keys){
        return Promise.all(keys.map(function(k){return caches.delete(k);}));
      }).catch(function(){})
    );
  }
  // 2. Unregister di TUTTI i service worker
  if('serviceWorker' in navigator){
    cleanupPromises.push(
      navigator.serviceWorker.getRegistrations().then(function(regs){
        return Promise.all(regs.map(function(r){return r.unregister();}));
      }).catch(function(){})
    );
  }
  // Salva eventuali dirty edits prima di ricaricare
  if(typeof saveAllDirtySilent==='function'&&Object.keys(dirtyMap||{}).length>0){
    cleanupPromises.push(new Promise(function(resolve){saveAllDirtySilent(resolve);}));
  }

  Promise.all(cleanupPromises).then(function(){
    var reloadUrl=window.location.pathname+'?_r='+Date.now()+window.location.hash;
    // Pre-fetch di TUTTI gli asset con cache:'reload': bypassa la disk cache
    // E sovrascrive ogni entry con il fresh dall'origin. Senza questo,
    // la HTML reloadata referenzia URL "nude" che restano cacheate stale.
    var nudeAssets=['./script.js','./style.css','./config.js','./manifest.json','./sw.js','./index.html'];
    var allFetches=[reloadUrl].concat(nudeAssets);
    Promise.all(allFetches.map(function(url){
      return fetch(url,{
        cache:'reload',
        credentials:'same-origin',
        headers:{'Cache-Control':'no-cache, no-store, must-revalidate'}
      }).then(function(r){return r.text();}).catch(function(){});
    })).then(function(){
      window.location.replace(reloadUrl);
    });
  });
}

function setupAutoRefresh(){
  // Init: registra il punto di partenza per le query updated_at
  fetchLatestUpdate().then(function(ts){lastKnownUpdate=ts;});

  // Prova Realtime; se fallisce parte polling
  setupRealtime();

  // Tab focus → rinnova token, drena la coda, poi refresh immediato.
  // Il rinnovo token PRIMA del refresh risolve il bug "Errore server" dopo
  // lunga inattività (JWT scaduto mentre il device era sospeso).
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    var ex=document.getElementById('refreshBanner');
    if(ex)ex.remove();
    ensureFreshToken().then(function(){
      syncProcess(); // invia eventuali chiamate/modifiche accumulate offline
      if(isUserBusy()){
        checkForRemoteChanges();
        return;
      }
      refreshAndUpdateMark();
    });
  });
}

// ───────────────────────────────────────────────────────────
// SERVICE WORKER + SHORTCUT URL HANDLER
// ───────────────────────────────────────────────────────────
function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  // Differisce la registrazione: non bloccare il primo render
  // Nota: la notifica di nuova versione è gestita dal version watcher
  // (più affidabile, push esplicito vs lifecycle SW)
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){/* SW non critico */});
  });
}

// Gestisce ?action=new / ?action=trash dai shortcut PWA
function handleShortcutAction(){
  try{
    var params=new URLSearchParams(window.location.search);
    var action=params.get('action');
    if(!action)return;
    setTimeout(function(){
      if(action==='new'){
        var btn=document.getElementById('btnAdd');if(btn)btn.click();
        var txd=document.getElementById('txd');if(txd)txd.focus();
      } else if(action==='trash'){
        var btn=document.getElementById('btnTrashOpen');if(btn)btn.click();
      }
    },350);
    // Pulisci la URL così un refresh non riapre lo shortcut
    if(window.history&&window.history.replaceState){
      window.history.replaceState({},'',window.location.pathname);
    }
  }catch(e){}
}

// ───────────────────────────────────────────────────────────
// LINK ESTERNI rapidi (Tessera Sanitaria, Prescrittori Lazio)
// Riutilizza la finestra/tab esistente se ancora aperta,
// così non ricarica la sessione di login.
// ───────────────────────────────────────────────────────────
var externalWindows={};

function openExternalLink(url,name){
  // 1. Reference in memoria (se ancora valido e non chiuso)
  var w=externalWindows[name];
  if(w&&!w.closed){
    try{w.focus();return;}catch(_){/* fallback: riapri */}
  }
  // 2. Named-window discovery: chiedi al browser SE c'è già una tab con quel name.
  //    window.open('', name) ritorna il reference SENZA navigarla se esiste.
  //    Se non esiste, ne crea una vuota (about:blank) → la navighiamo noi.
  w=window.open('',name);
  if(!w){return;} // popup bloccato
  var needsNavigate=false;
  try{
    var href=w.location.href;
    needsNavigate=(!href||href==='about:blank');
  }catch(_){
    // SecurityError = cross-origin (la tab è già su un'altra origin, es. tessera sanitaria)
    // → NON navigarla, solo focus per non perdere la sessione/dove era arrivato l'utente
    needsNavigate=false;
  }
  if(needsNavigate){
    w.location.href=url;
  }
  try{w.focus();}catch(_){}
  externalWindows[name]=w;
}

function setupQuickLinks(){
  document.querySelectorAll('.hquick-link').forEach(function(link){
    link.addEventListener('click',function(e){
      e.preventDefault();
      var url=this.dataset.extUrl;
      var name=this.dataset.extName||'_blank';
      if(url)openExternalLink(url,name);
    });
  });
}

document.addEventListener('DOMContentLoaded',function(){

  initEls();
  // Collapse "Nuova Chiamata" su mobile (solo su mobile è interactive, su desktop il chevron è hidden via CSS)
  (function setupNewCallCollapse(){
    var card=document.getElementById('newCallCard');
    var header=document.getElementById('newCallHeader');
    if(!card||!header)return;
    var KEY='newCallCollapsed';
    // Restore stato salvato (solo se mobile)
    if(window.matchMedia&&window.matchMedia('(max-width:640px)').matches){
      if(localStorage.getItem(KEY)==='1'){
        card.classList.add('collapsed');
        header.setAttribute('aria-expanded','false');
      }
    }
    header.addEventListener('click',function(){
      // Su desktop il chevron è hidden via CSS, ma il click è ancora attivo;
      // limito il toggle al mobile per coerenza UX
      if(!window.matchMedia('(max-width:640px)').matches)return;
      var nowCollapsed=card.classList.toggle('collapsed');
      header.setAttribute('aria-expanded',nowCollapsed?'false':'true');
      try{localStorage.setItem(KEY,nowCollapsed?'1':'0');}catch(_){}
    });
  })();

  // Mostra il SHA del deploy nel sottotitolo (per debug visivo)
  var hsub=document.querySelector('.hsub');
  if(hsub)hsub.innerHTML='Registro Chiamate. <span class="hsub-ver" title="Build '+esc(BUILD_VERSION)+'">v'+esc(BUILD_SHA)+'</span>';
  setupTableDelegation();
  setupQuickLinks();
  registerServiceWorker();
  handleShortcutAction();
  // setupAuth gestisce il check sessione e, SE ok, fa partire loadPost+setupAutoRefresh+setupVersionWatcher
  setupAuth();

  var btnAdd=document.getElementById('btnAdd');
  var btnSave=document.getElementById('btnSave');
  var selPost=document.getElementById('selPost');
  var btnNo=document.getElementById('btnNo');
  var btnSi=document.getElementById('btnSi');
  var btnSearch=document.getElementById('btnSearch');
  var btnDoSearch=document.getElementById('btnDoSearch');
  var btnResetSearch=document.getElementById('btnResetSearch');
  var selPageSize=document.getElementById('selPageSize');

  if(btnAdd)btnAdd.addEventListener('click',initForm);
  if(btnSave)btnSave.addEventListener('click',salva);
  if(selPost)selPost.addEventListener('change',function(){
    if(this.value)this.style.outline='';
    showComuni();
  });
  if(btnNo)btnNo.addEventListener('click',function(){chiudi('mcnf');});
  if(btnSi)btnSi.addEventListener('click',confCompleta);

  if(btnSearch){
    btnSearch.addEventListener('click',function(){
      var p=document.getElementById('srchPanel');
      var btn=document.getElementById('btnSearch');
      if(p)p.classList.toggle('open');
      if(btn)btn.classList.toggle('act');
    });
  }

  if(btnDoSearch)btnDoSearch.addEventListener('click',doSearch);

  ['srchQuery','srchDateFrom','srchDateTo'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter')doSearch();});
  });

  // Chip filtri rapidi
  document.querySelectorAll('.qchip').forEach(function(chip){
    chip.addEventListener('click',function(){
      var active=this.classList.contains('act');
      document.querySelectorAll('.qchip').forEach(function(c){c.classList.remove('act');});
      if(active){
        // toggle off → reset filtri data
        document.getElementById('srchDateFrom').value='';
        document.getElementById('srchDateTo').value='';
        doSearch({live:true});
        return;
      }
      this.classList.add('act');
      var range=this.dataset.range;
      var now=new Date();
      var from=new Date(now),to=new Date(now);
      to.setHours(23,59,59,999);
      if(range==='today'){from.setHours(0,0,0,0);}
      else if(range==='7d'){from.setDate(now.getDate()-6);from.setHours(0,0,0,0);}
      else if(range==='30d'){from.setDate(now.getDate()-29);from.setHours(0,0,0,0);}
      else if(range==='thisMonth'){from=new Date(now.getFullYear(),now.getMonth(),1,0,0,0);}
      else if(range==='thisYear'){from=new Date(now.getFullYear(),0,1,0,0,0);}
      var fmt=function(d){var p=function(n){return String(n).padStart(2,'0');};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
      document.getElementById('srchDateFrom').value=fmt(from);
      document.getElementById('srchDateTo').value=fmt(to);
      doSearch({live:true});
    });
  });

  // Ricerca live con debounce 350ms (solo srchQuery, NON chiude il pannello)
  var searchDebounceTimer=null;
  var sq=document.getElementById('srchQuery');
  if(sq){
    sq.addEventListener('input',function(){
      if(searchDebounceTimer)clearTimeout(searchDebounceTimer);
      var v=this.value.trim();
      if(v.length===0||v.length>=2){
        searchDebounceTimer=setTimeout(function(){doSearch({live:true});},350);
      }
    });
  }

  if(btnResetSearch){
    btnResetSearch.addEventListener('click',function(){
      resetSearchUI();
      currentFilters=null;
      loadRows(1);
    });
  }

  if(selPageSize){
    selPageSize.addEventListener('change',function(){
      CURRENT_PAGE_SIZE=parseInt(this.value,10)||15;
      localStorage.setItem('pageSizePref',String(CURRENT_PAGE_SIZE));
      loadRows(1);
    });
  }

  // Filtro incompleti
  var btnInc=document.getElementById('btnIncomplete');
  if(btnInc){
    btnInc.addEventListener('click',function(){
      showIncompleteOnly=!showIncompleteOnly;
      this.classList.toggle('act',showIncompleteOnly);
      currentFilters=null;
      resetSearchUI();
      loadRows(1);
    });
  }

  // Gestione postazioni
  var btnGestPost=document.getElementById('btnGestPost');
  var btnPostClose=document.getElementById('btnPostClose');
  var btnPostCancel=document.getElementById('btnPostCancel');
  var btnPostAdd=document.getElementById('btnPostAdd');
  var btnPostSave=document.getElementById('btnPostSave');
  var btnPostDelCancel=document.getElementById('btnPostDelCancel');
  var btnPostDelConfirm=document.getElementById('btnPostDelConfirm');

  if(btnGestPost)btnGestPost.addEventListener('click',apriGestPost);
  if(btnPostClose)btnPostClose.addEventListener('click',function(){chiudi('mpost');});
  if(btnPostCancel)btnPostCancel.addEventListener('click',function(){chiudi('mpost');});
  if(btnPostAdd)btnPostAdd.addEventListener('click',aggiungiRigaPost);
  if(btnPostSave)btnPostSave.addEventListener('click',salvaPostazioni);
  if(btnPostDelCancel)btnPostDelCancel.addEventListener('click',function(){chiudi('mpostDel');});
  if(btnPostDelConfirm)btnPostDelConfirm.addEventListener('click',confermaEliminaPostazione);

  // Export
  var btnExport=document.getElementById('btnExport');
  var btnExportCancel=document.getElementById('btnExportCancel');
  var btnExportGo=document.getElementById('btnExportGo');
  if(btnExport)btnExport.addEventListener('click',openExportModal);
  if(btnExportCancel)btnExportCancel.addEventListener('click',function(){chiudi('mexport');});
  if(btnExportGo)btnExportGo.addEventListener('click',runExport);

  // Auth: login Google + user menu + logout
  var btnAuthGoogle = document.getElementById('btnAuthGoogle');
  if(btnAuthGoogle) btnAuthGoogle.addEventListener('click', function(){ authSignInWithGoogle(false); });
  var lnkOther = document.getElementById('lnkAuthOtherAccount');
  if(lnkOther) lnkOther.addEventListener('click', function(e){
    e.preventDefault();
    authSignInWithGoogle(true);  // force account picker
  });

  var userMenuBtn = document.getElementById('userMenuBtn');
  if(userMenuBtn) userMenuBtn.addEventListener('click', function(e){
    e.stopPropagation();
    document.getElementById('userMenu').classList.toggle('open');
  });
  document.addEventListener('click', function(e){
    var um = document.getElementById('userMenu');
    if(um && um.classList.contains('open') && !um.contains(e.target)){
      um.classList.remove('open');
    }
  });
  var btnSignOut = document.getElementById('btnSignOut');
  if(btnSignOut) btnSignOut.addEventListener('click', authSignOut);

  // Admin panel
  var btnAdminOpen = document.getElementById('btnAdminOpen');
  var btnAdminClose = document.getElementById('btnAdminClose');
  var btnAdminAddUser = document.getElementById('btnAdminAddUser');
  var btnAdminAddCancel = document.getElementById('btnAdminAddCancel');
  var btnAdminAddConfirm = document.getElementById('btnAdminAddConfirm');
  var btnAdminDelCancel = document.getElementById('btnAdminDelCancel');
  var btnAdminDelConfirm = document.getElementById('btnAdminDelConfirm');
  if(btnAdminOpen) btnAdminOpen.addEventListener('click', adminOpenPanel);
  if(btnAdminClose) btnAdminClose.addEventListener('click', function(){chiudi('madmin');});
  if(btnAdminAddUser) btnAdminAddUser.addEventListener('click', adminOpenAddForm);
  if(btnAdminAddCancel) btnAdminAddCancel.addEventListener('click', function(){chiudi('madminAdd');});
  if(btnAdminAddConfirm) btnAdminAddConfirm.addEventListener('click', adminConfirmAddUser);
  if(btnAdminDelCancel) btnAdminDelCancel.addEventListener('click', function(){chiudi('madminDel');adminUserToDelete=null;});
  if(btnAdminDelConfirm) btnAdminDelConfirm.addEventListener('click', adminConfirmDelete);

  // Click delegato su "Elimina" nelle righe utente
  var adminUserList = document.getElementById('adminUserList');
  if(adminUserList){
    adminUserList.addEventListener('click', function(e){
      var del = e.target.closest('.admin-user-del');
      if(del) adminPromptDelete(del.dataset.id, del.dataset.email, del.dataset.name);
    });
  }

  // Input doppia conferma elimina (digita "ELIMINA")
  var delConfirmInput = document.getElementById('adminDelConfirmInput');
  if(delConfirmInput){
    delConfirmInput.addEventListener('input', function(){
      var ok = this.value.trim() === 'ELIMINA';
      var bc = document.getElementById('btnAdminDelConfirm');
      bc.disabled = !ok;
      bc.style.opacity = ok ? '1' : '.5';
    });
  }

  // Cestino chiamate
  var btnTrashOpen=document.getElementById('btnTrashOpen');
  var btnTrashClose=document.getElementById('btnTrashClose');
  var btnTrashCancel=document.getElementById('btnTrashCancel');
  var btnTrashEmpty=document.getElementById('btnTrashEmpty');
  var btnTrashEmptyCancel=document.getElementById('btnTrashEmptyCancel');
  var btnTrashEmptyConfirm=document.getElementById('btnTrashEmptyConfirm');

  if(btnTrashOpen)btnTrashOpen.addEventListener('click',openTrash);
  if(btnTrashClose)btnTrashClose.addEventListener('click',function(){chiudi('mtrash');});
  if(btnTrashCancel)btnTrashCancel.addEventListener('click',function(){chiudi('mtrash');});
  if(btnTrashEmpty)btnTrashEmpty.addEventListener('click',function(){apri('mtrashEmpty');});
  if(btnTrashEmptyCancel)btnTrashEmptyCancel.addEventListener('click',function(){chiudi('mtrashEmpty');});
  if(btnTrashEmptyConfirm)btnTrashEmptyConfirm.addEventListener('click',trashEmptyAll);

  // Click delegato dentro la lista cestino
  var trashList=document.getElementById('trashList');
  if(trashList){
    trashList.addEventListener('click',function(e){
      var rest=e.target.closest('.trash-btn-restore');
      if(rest){
        var rowEl=rest.closest('.trash-row');
        trashRestoreOne(rest.dataset.id,rowEl);
        return;
      }
      var del=e.target.closest('.trash-btn-delete');
      if(del){
        var rowEl2=del.closest('.trash-row');
        trashHardDeleteOne(del.dataset.id,rowEl2);
        return;
      }
    });
  }

  // Modal chiamata
  var btnPhoneCancel=document.getElementById('btnPhoneCancel');
  var btnPhoneClear=document.getElementById('btnPhoneClear');
  var btnPhoneAnon=document.getElementById('btnPhoneAnon');
  var btnPhoneEdit=document.getElementById('btnPhoneEdit');

  if(btnPhoneCancel)btnPhoneCancel.addEventListener('click',function(){closePhoneModal();});

  if(btnPhoneEdit)btnPhoneEdit.addEventListener('click',function(){
    if(!phoneEditMode){
      setPhoneEditMode();
    } else {
      // Conferma → committa, se ok chiudi modal
      var d=commitPhoneEdit();
      if(d!==null)closePhoneModal();
    }
  });

  if(btnPhoneClear)btnPhoneClear.addEventListener('click',function(){
    var num=phoneModalNumber;
    if(phoneEditMode){var d=commitPhoneEdit();if(d===null)return;num=d;}
    closePhoneModal();
    window.location.href='tel:'+num;
  });

  if(btnPhoneAnon)btnPhoneAnon.addEventListener('click',function(){
    var num=phoneModalNumber;
    if(phoneEditMode){var d=commitPhoneEdit();if(d===null)return;num=d;}
    closePhoneModal();
    window.location.href='tel:%2331%23'+num;
  });

  var btnPhoneCopy=document.getElementById('btnPhoneCopy');
  if(btnPhoneCopy)btnPhoneCopy.addEventListener('click',function(){
    var num=phoneModalNumber;
    if(phoneEditMode){var d=commitPhoneEdit();if(d===null)return;num=d;}
    // Copia SOLO cifre (no spazi, +, trattini): phoneModalNumber è già digits
    var digitsOnly=String(num||'').replace(/\D/g,'');
    if(!digitsOnly){return;}
    copyToClipboard(digitsOnly).then(function(ok){
      var lbl=document.getElementById('phoneCopyLabel');
      var ico=document.getElementById('phoneCopyIco');
      if(ok && lbl && ico){
        var origLbl=lbl.textContent;
        var origIcoHtml=ico.innerHTML;
        lbl.textContent='Copiato!';
        ico.innerHTML='<polyline points="20 6 9 17 4 12"/>';
        btnPhoneCopy.style.color='var(--ok)';
        btnPhoneCopy.style.borderColor='var(--ok)';
        setTimeout(function(){
          lbl.textContent=origLbl;
          ico.innerHTML=origIcoHtml;
          btnPhoneCopy.style.color='';
          btnPhoneCopy.style.borderColor='';
        },1500);
      } else if(!ok){
        fb(false,'Copia fallita','Il browser ha bloccato la copia automatica.');
      }
    });
  });

  // Modal indirizzo
  var btnAddrCancel=document.getElementById('btnAddrCancel');
  var btnAddrEdit=document.getElementById('btnAddrEdit');
  var btnAddrMaps=document.getElementById('btnAddrMaps');
  if(btnAddrCancel)btnAddrCancel.addEventListener('click',closeAddrModal);
  if(btnAddrEdit)btnAddrEdit.addEventListener('click',function(){
    if(!addrEditMode){setAddrEditMode();}
    else{var d=commitAddrEdit();if(d!==null)closeAddrModal();}
  });
  if(btnAddrMaps)btnAddrMaps.addEventListener('click',function(){
    var q=addrModalQuery;
    if(addrEditMode){var d=commitAddrEdit();if(d===null)return;q=d;}
    closeAddrModal();
    // Mobile: schema geo:/maps: → l'OS chiede quale app usare (Android picker, iOS Apple Maps)
    // Desktop: Google Maps in finestra dedicata
    if(isMobileDevice()){
      openInDeviceNavigator(q);
    } else {
      openInGoogleMaps(q);
    }
  });
  var maddrInput=document.getElementById('maddrInput');
  if(maddrInput){
    maddrInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();var d=commitAddrEdit();if(d!==null)closeAddrModal();}
      else if(e.key==='Escape'){e.preventDefault();setAddrViewMode();}
    });
    maddrInput.addEventListener('input',function(){
      var er=document.getElementById('maddrErr');
      if(er&&er.style.display!=='none')er.style.display='none';
    });
  }

  // Enter dentro l'input = Conferma
  var mphoneInput=document.getElementById('mphoneInput');
  if(mphoneInput){
    mphoneInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();var d=commitPhoneEdit();if(d!==null)closePhoneModal();}
      else if(e.key==='Escape'){e.preventDefault();setPhoneViewMode();}
    });
    mphoneInput.addEventListener('input',function(){
      // Nascondi errore se l'utente sta correggendo
      var er=document.getElementById('mphoneErr');
      if(er&&er.style.display!=='none')er.style.display='none';
    });
  }

  // Delete chiamata
  var btnDelCancel=document.getElementById('btnDelCancel');
  var btnDelConfirm=document.getElementById('btnDelConfirm');
  if(btnDelCancel){
    btnDelCancel.addEventListener('click',function(){
      chiudi('mdel');DROW=null;DELEL=null;
    });
  }
  if(btnDelConfirm)btnDelConfirm.addEventListener('click',confDelete);

  ['txd','txn'].forEach(function(id){
    var el=document.getElementById(id);
    if(el){ attachPlainTextArea(el); el.addEventListener('input',saveDraftDebounced); }
  });

  // Unsaved 1
  var btn1Discard=document.getElementById('btn1Discard');
  var btn1Save=document.getElementById('btn1Save');
  if(btn1Discard){
    btn1Discard.addEventListener('click',function(){chiudi('munsav1');warnOpen=false;});
  }
  if(btn1Save){
    btn1Save.addEventListener('click',function(){
      chiudi('munsav1');warnOpen=false;
      var keys=Object.keys(dirtyMap);
      if(keys.length)saveEdit(dirtyMap[keys[0]],null,null);
    });
  }

  // Unsaved N
  var btnNDiscard=document.getElementById('btnNDiscard');
  var btnNSaveOne=document.getElementById('btnNSaveOne');
  var btnNSaveAll=document.getElementById('btnNSaveAll');
  if(btnNDiscard){
    btnNDiscard.addEventListener('click',function(){chiudi('munsavN');warnOpen=false;});
  }
  if(btnNSaveOne){
    btnNSaveOne.addEventListener('click',function(){
      chiudi('munsavN');warnOpen=false;
      var keys=Object.keys(dirtyMap);
      if(keys.length)saveEdit(dirtyMap[keys[0]],null,null);
    });
  }
  if(btnNSaveAll){
    btnNSaveAll.addEventListener('click',function(){
      chiudi('munsavN');warnOpen=false;
      saveAllDirty(function(salvati,falliti){
        if(falliti===0){
          fb(true,'Salvato',salvati+' '+(salvati===1?'chiamata salvata':'chiamate salvate')+'.');
        } else {
          fb(false,'Attenzione',salvati+' salvate, '+falliti+' con errore.');
        }
        loadRows(PAGE);
      });
    });
  }

  // Click fuori → chiude solo i dropdown postazione
  // (Il vecchio warning "modifiche non salvate" non serve più: l'autosave + coda offline lo gestiscono)
  document.addEventListener('click',function(e){
    document.querySelectorAll('.post-dropdown.open').forEach(function(dd){
      if(!dd.parentElement.contains(e.target)){
        dd.classList.remove('open');
        var tr=dd.closest('tr');if(tr)tr.classList.remove('has-open-dd');
      }
    });
  });

  // Prima di chiudere la tab/finestra: salva tutto il dirtyMap nella coda offline
  // (così le modifiche degli ultimi 1.5s che non sono ancora state autosalvate non si perdono)
  window.addEventListener('beforeunload',function(){
    var keys=Object.keys(dirtyMap);
    keys.forEach(function(k){
      var info=dirtyMap[k];if(!info||!info.tr)return;
      if(!document.body.contains(info.tr))return;
      var body=buildPatchBodyFromRow(info.tr);
      if(body)syncEnqueue(k,body);
    });
    // Flush immediato delle modifiche alle righe locali (in attesa), per non
    // perdere l'ultimo carattere digitato se si chiude prima del debounce.
    var lp=document.querySelectorAll('tr.local-pending');
    for(var i=0;i<lp.length;i++){ try{ saveLocalRowNow(lp[i]); }catch(_e){} }
  });

  // Badge "in coda di sync" è basato su localStorage, non richiede auth
  syncRenderBadge();

  // GIRA CHIAMATA: wiring dei modali e del banner (delegation)
  setupGirateBannerDelegation();
  setupGirateModalsDelegation();

  // Le altre operazioni (syncProcess, autoPurgeOld, refreshTrashBadge)
  // richiedono JWT e vengono lanciate dentro setupAuth dopo il login.
});


// ═══════════════════════════════════════════════════════════════════
// SANITIZZAZIONE
// ═══════════════════════════════════════════════════════════════════

function sanitizeText(str){
  if(!str)return '';
  str=String(str);
  str=str.replace(/<[^>]*>/g,'');
  str=str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'');
  str=str.replace(/^[\s]*([=+\-@|`])/g,"'$1");
  return str.trim();
}

function attachPlainTextControls(el){
  if(el._plainTextAttached)return;
  el._plainTextAttached=true;
  el.addEventListener('paste',function(e){
    e.preventDefault();
    var text=(e.clipboardData||window.clipboardData).getData('text/plain')||'';
    text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return;
    sel.deleteFromDocument();
    var range=sel.getRangeAt(0);
    var lines=text.split('\n');
    var frag=document.createDocumentFragment();
    lines.forEach(function(line,i){
      if(i>0)frag.appendChild(document.createElement('br'));
      if(line)frag.appendChild(document.createTextNode(line));
    });
    range.insertNode(frag);
    range.collapse(false);
    sel.removeAllRanges();sel.addRange(range);
    var tr=el.closest('tr');if(tr)markDirty(tr);
  });
  el.addEventListener('keydown',function(e){
    if((e.ctrlKey||e.metaKey)&&['b','i','u','B','I','U'].indexOf(e.key)!==-1)e.preventDefault();
  });
  el.addEventListener('drop',function(e){
    e.preventDefault();
    var text=e.dataTransfer.getData('text/plain')||'';
    if(text){
      var sel=window.getSelection();
      if(sel&&sel.rangeCount){
        var range=sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
    }
  });
}

function attachPlainTextArea(el){
  if(el._plainTextAttached)return;
  el._plainTextAttached=true;
  el.addEventListener('paste',function(e){
    e.preventDefault();
    var text=(e.clipboardData||window.clipboardData).getData('text/plain')||'';
    text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var s=el.selectionStart,end=el.selectionEnd;
    el.value=el.value.substring(0,s)+text+el.value.substring(end);
    el.selectionStart=el.selectionEnd=s+text.length;
  });
}


// ═══════════════════════════════════════════════════════════════════
// SORT BADGE (semplificato — Supabase ordina automaticamente)
// ═══════════════════════════════════════════════════════════════════

function eseguiSortLite(cb){
  if(cb)cb({success:true,message:'Ok.'});
}

function showSortBadge(ok,msg){
  var ex=document.getElementById('sortBadge');if(ex)ex.remove();
  var now=new Date();
  var orario=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
  var b=document.createElement('div');
  b.id='sortBadge';
  b.style.cssText='position:fixed;top:70px;right:16px;z-index:9999;padding:8px 14px;border-radius:8px;font-size:.8rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;align-items:center;gap:8px;transition:opacity .4s ease;opacity:1;background:'+(ok?'var(--okbg,#d4f7e8)':'var(--erbg,#fde8e8)')+';color:'+(ok?'var(--ok,#1a6640)':'var(--er,#a12c2c)')+';';
  var ico=ok
    ?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    :'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  b.innerHTML=ico+'<span>'+orario+' — '+msg+'</span>';
  document.body.appendChild(b);
  setTimeout(function(){b.style.opacity='0';setTimeout(function(){if(b.parentNode)b.remove();},500);},4000);
}


// ═══════════════════════════════════════════════════════════════════
// RICERCA
// ═══════════════════════════════════════════════════════════════════

function doSearch(opts){
  opts=opts||{};
  var live=!!opts.live; // se true, è chiamata da live-search (non chiude il pannello)
  var query=document.getElementById('srchQuery').value.trim();
  var dateFrom=document.getElementById('srchDateFrom').value;
  var dateTo=document.getElementById('srchDateTo').value;
  var post=document.getElementById('srchPost').value;
  if(!query&&!dateFrom&&!dateTo&&!post){
    // In live-search vuoto: reset filtri ma TIENI APERTO il pannello
    if(live){
      if(currentFilters){
        currentFilters=null;
        (els.linfo||document.getElementById('linfo')).textContent='';
        loadRows(1);
      }
      return;
    }
    fb(false,'Attenzione','Inserisci almeno un criterio di ricerca.');
    return;
  }
  var btn=document.getElementById('btnDoSearch');
  if(!live){btn.disabled=true;btn.innerHTML='<div class="spin"></div> Ricerca…';}
  currentFilters={query:query,dateFrom:dateFrom,dateTo:dateTo,postazione:post};
  searchChiamate(currentFilters).then(function(r){
    if(!live){
      btn.disabled=false;btn.innerHTML=svgSearch()+' Cerca';
      document.getElementById('srchPanel').classList.remove('open');
      document.getElementById('btnSearch').classList.remove('act');
    }
    drawRows(r.records,query);
    var inf=r.total+' risultat'+(r.total===1?'o':'i');
    (els.linfo||document.getElementById('linfo')).innerHTML=inf+' &nbsp;<span class="srch-active">Filtro attivo<svg onclick="clearSearch()" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>';
    (els.pgn||document.getElementById('pgn')).innerHTML='';
  }).catch(function(err){
    if(err&&err.name==='AbortError')return; // richiesta superata
    if(!live){btn.disabled=false;btn.innerHTML=svgSearch()+' Cerca';}
    if(!live)fb(false,'Errore','Server non raggiungibile.');
  });
}

var searchAbortController=null;

function searchChiamate(filters){
  // Annulla la richiesta di ricerca precedente se ancora in corso
  if(searchAbortController)searchAbortController.abort();
  searchAbortController=new AbortController();
  var sig=searchAbortController.signal;

  var params='chiamate?select=*&deleted_at=is.null';
  if(filters.dateFrom){
    var df=new Date(filters.dateFrom);df.setHours(0,0,0,0);
    params+='&timestamp_chiamata=gte.'+df.toISOString();
  }
  if(filters.dateTo){
    var dt=new Date(filters.dateTo);dt.setHours(23,59,59,999);
    params+='&timestamp_chiamata=lte.'+dt.toISOString();
  }
  if(filters.postazione&&filters.postazione.trim()){
    params+='&postazione=eq.'+encodeURIComponent(filters.postazione.trim());
  }
  // RICERCA SERVER-SIDE: una `or=(descrizione.ilike.*X*,note.ilike.*X*)` per ogni parola, in AND
  if(filters.query&&filters.query.trim()){
    var words=filters.query.trim().split(/\s+/).filter(Boolean);
    words.forEach(function(w){
      var enc=encodeURIComponent('*'+w.replace(/[(),*]/g,'')+'*');
      params+='&or=(descrizione.ilike.'+enc+',note.ilike.'+enc+')';
    });
  }
  params+='&order=timestamp_chiamata.desc&limit=500';

  var srchHeaders = authHeaders(); srchHeaders['Prefer'] = 'count=exact';
  return fetch(SUPABASE_URL+'/rest/v1/'+params,{
    method:'GET',
    headers:srchHeaders,
    signal:sig
  }).then(function(res){
    var cr=res.headers.get('content-range')||'';
    var total=parseInt((cr.split('/')[1]||'0'),10)||0;
    return res.json().then(function(data){return {data:data,total:total};});
  }).then(function(result){
    var records=result.data.map(function(r){
      return {
        id:r.id,rowIndex:r.id,
        tsFormatted:formatTSFromISO(r.timestamp_chiamata),
        postazione:r.postazione||'',descrizione:r.descrizione||'',note:r.note||'',completato:!!r.completato,
        girata_a_user_id:r.girata_a_user_id||null,
        girata_a_nome:r.girata_a_nome||'',
        girata_a_at:r.girata_a_at||null,
        girata_da_user_id:r.girata_da_user_id||null,
        girata_da_nome:r.girata_da_nome||'',
        girata_da_at:r.girata_da_at||null
      };
    });
    return {records:records,total:result.total};
  });
}

function clearSearch(){currentFilters=null;resetSearchUI();loadRows(1);}

function resetSearchUI(){
  document.getElementById('srchQuery').value='';
  document.getElementById('srchDateFrom').value='';
  document.getElementById('srchDateTo').value='';
  document.getElementById('srchPost').value='';
  document.getElementById('srchPanel').classList.remove('open');
  document.getElementById('btnSearch').classList.remove('act');
  document.querySelectorAll('.qchip.act').forEach(function(c){c.classList.remove('act');});
}


// ═══════════════════════════════════════════════════════════════════
// INIT / CARICAMENTO
// ═══════════════════════════════════════════════════════════════════

var POST_CACHE_KEY='postCache_v1';
var POST_CACHE_TTL=60*60*1000; // 1 ora

function loadPostFromCache(){
  try{
    var raw=localStorage.getItem(POST_CACHE_KEY);
    if(!raw)return null;
    var obj=JSON.parse(raw);
    if(!obj||!obj.ts||!obj.data)return null;
    if(Date.now()-obj.ts>POST_CACHE_TTL)return null;
    return obj.data;
  }catch(e){return null;}
}

function savePostToCache(data){
  try{localStorage.setItem(POST_CACHE_KEY,JSON.stringify({ts:Date.now(),data:data}));}catch(e){}
}

function applyPostazioniData(data){
  POST=data.map(function(p){
    return {id:p.id,nome:p.nome||'',comuni:p.comuni?p.comuni.split(',').map(function(c){return c.trim();}).filter(Boolean):[],colore:p.colore||'#2e7d5e'};
  });
  var ss=document.getElementById('srchPost');
  if(ss){
    ss.innerHTML='<option value="">Tutte le postazioni</option>';
    POST.forEach(function(p){
      var o=document.createElement('option');o.value=p.nome;o.textContent=p.nome;ss.appendChild(o);
    });
  }
  var lastPost=localStorage.getItem('lastPostazione')||'';
  buildSelPost(lastPost);
}

function loadPost(){
  setLoaderMsg('Connessione al server…');
  var pageSizePref=parseInt(localStorage.getItem('pageSizePref')||'0')||15;
  CURRENT_PAGE_SIZE=pageSizePref;
  var sel=document.getElementById('selPageSize');
  if(sel)sel.value=String(pageSizePref);

  // Cache hit: usa dati locali subito, poi rinfresca in background
  var cached=loadPostFromCache();
  if(cached){
    applyPostazioniData(cached);
    setLoaderMsg('Caricamento chiamate…');
    loadRows(1);
    // Refresh in background, silenzioso
    sbFetch('postazioni?select=*&order=id.asc').then(function(res){return res.json();}).then(function(data){
      savePostToCache(data);
      applyPostazioniData(data);
    }).catch(function(){});
    return;
  }

  setLoaderMsg('Caricamento postazioni…');
  sbFetch('postazioni?select=*&order=id.asc').then(function(res){
    return res.json();
  }).then(function(data){
    savePostToCache(data);
    applyPostazioniData(data);
    setLoaderMsg('Caricamento chiamate…');
    loadRows(1);
  }).catch(function(){hideLoader();loadRows(1);});
}

function invalidatePostCache(){try{localStorage.removeItem(POST_CACHE_KEY);}catch(e){}}

function buildSelPost(firstPost){
  var s=document.getElementById('selPost');
  if(!s)return;
  s.innerHTML='<option value="">— Postazione —</option>';
  var names=POST.map(function(p){return p.nome;});
  if(firstPost)names=[firstPost].concat(names.filter(function(n){return n!==firstPost;}));
  names.forEach(function(n){
    var o=document.createElement('option');o.value=n;o.textContent=n;s.appendChild(o);
  });
  if(firstPost)s.value=firstPost;
  showComuni();
}

function showComuni(){
  var sel=document.getElementById('selPost');
  var w=document.getElementById('cbdgs');
  if(!sel||!w)return;
  var n=sel.value;w.innerHTML='';if(!n)return;
  var p=POST.find(function(x){return x.nome===n;});if(!p)return;
  var lbl=document.createElement('span');
  lbl.style.cssText='font-size:.8rem;font-weight:600;color:var(--txm);text-transform:uppercase;letter-spacing:.05em;margin-right:4px';
  lbl.textContent='Comuni:';w.appendChild(lbl);
  (p.comuni||[]).forEach(function(c){
    var b=document.createElement('span');b.className='cbdg';b.style.background=p.colore||'var(--pr)';b.textContent=c;w.appendChild(b);
  });
}


// ═══════════════════════════════════════════════════════════════════
// FORM NUOVA CHIAMATA
// ═══════════════════════════════════════════════════════════════════

function initForm(){
  var now=new Date();
  var el=document.getElementById('dtxt');
  el.textContent=now.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+now.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  attachFormDateListeners();
  document.getElementById('txd').focus();
}

function attachFormDateListeners(){
  var el=document.getElementById('dtxt');
  if(!el||el._dtListened)return;
  el._dtListened=true;
  el.contentEditable='true';el.spellcheck=false;
  attachPlainTextControls(el);
  el.addEventListener('focus',function(){
    var range=document.createRange();range.selectNodeContents(this);
    var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  });
  el.addEventListener('blur',function(){
    var raw=(this.innerText||'').trim();if(!raw)return;
    var parts=raw.split(/\s+/);
    var fmtD=autoformatDate(parts[0]||'')||parts[0]||'';
    var fmtT=autoformatTime(parts[1]||'')||parts[1]||'';
    var dok=isValidDate(fmtD),tok=isValidTime(fmtT);
    this.innerText=fmtD+' '+fmtT;setFieldError(this,!dok||!tok);
  });
  el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();this.blur();}});
}

function salva(){
  var d=sanitizeText(document.getElementById('txd').value.trim());
  var n=sanitizeText(document.getElementById('txn').value.trim());
  var p=document.getElementById('selPost').value;
  var ee=document.getElementById('errd'),te=document.getElementById('txd');
  var sp=document.getElementById('selPost');
  if(!d){ee.style.display='block';te.classList.add('err');te.focus();return;}
  ee.style.display='none';te.classList.remove('err');
  if(!p){sp.style.outline='2px solid var(--er)';sp.focus();fb(false,'Campo obbligatorio','Seleziona una postazione prima di salvare.');return;}
  sp.style.outline='';

  var dtxt=document.getElementById('dtxt');
  var dtParts=(dtxt.innerText||'').trim().split(/\s+/);
  var fmtD=autoformatDate(dtParts[0]||'')||dtParts[0]||'';
  var fmtT=autoformatTime(dtParts[1]||'')||dtParts[1]||'';
  dtxt.innerText=fmtD+' '+fmtT;
  var dok=isValidDate(fmtD),tok=isValidTime(fmtT);
  setFieldError(dtxt,!dok||!tok);
  if(!dok||!tok){fb(false,'Formato non valido','Correggi data e ora. Formato atteso: GG/MM/AAAA HH:MM');return;}
  setFieldError(dtxt,false);

  var btn=document.getElementById('btnSave');
  btn.disabled=true;btn.innerHTML='<div class="spin"></div> Salvataggio…';

  var tsISO=italianToISO(fmtD+' '+fmtT)||new Date().toISOString();
  var clientUuid=newClientUuid();
  var body={
    timestamp_chiamata:tsISO, postazione:p||'', descrizione:d, note:n||'',
    completato:false, user_id:currentUser?currentUser.id:null, client_uuid:clientUuid
  };

  // ── LOCAL-FIRST ──────────────────────────────────────────────────
  // 1. Scrivi SUBITO in coda locale (localStorage, durabile). Da questo
  //    momento la chiamata NON si perde più: sopravvive a chiusura/ricarica.
  var persisted=syncEnqueueInsert(clientUuid, body);
  if(!persisted){
    // localStorage non disponibile (modalità privata/incognito o memoria piena):
    // NON pulire il form, così i dati restano visibili e recuperabili a mano.
    btn.disabled=false;btn.innerHTML=svgSave()+' Salva';
    fb(false,'Salvataggio locale non riuscito','La memoria del browser non è disponibile (forse navigazione privata o piena). I dati NON sono stati salvati: non chiudere la pagina, controlla di non essere in incognito e riprova. In alternativa copia il testo altrove.');
    return;
  }

  // 2. Pulisci il form + la bozza (i dati sono ormai al sicuro in coda).
  document.getElementById('txd').value='';
  document.getElementById('txn').value='';
  var dtEl=document.getElementById('dtxt');
  dtEl.textContent='—';setFieldError(dtEl,false);
  if(p){buildSelPost(p);localStorage.setItem('lastPostazione',p);}
  clearDraft();
  currentFilters=null;resetSearchUI();

  var finalize=function(sent){
    btn.disabled=false;btn.innerHTML=svgSave()+' Salva';
    if(sent){
      fb(true,'Salvata','Chiamata salvata sul server.');
    } else {
      fb(true,'Salvata in locale','Connessione assente: la chiamata è al sicuro sul dispositivo e verrà inviata automaticamente appena torna la linea. Puoi anche chiudere l\'app: NON perderai i dati.');
    }
    loadRows(1);
  };

  // 3. Salva prima eventuali modifiche in sospeso su altre righe, poi tenta l'invio.
  saveAllDirtySilent(function(){
    if(typeof navigator!=='undefined' && navigator.onLine===false){ finalize(false); return; }
    syncOneInsert(clientUuid, body).then(function(ok){ finalize(ok); });
  });
}


// ═══════════════════════════════════════════════════════════════════
// ELENCO CHIAMATE
// ═══════════════════════════════════════════════════════════════════

function loadRows(pg){
  PAGE=pg;dirtyMap={};
  var tb=els.tbody||document.getElementById('tbody');
  tb.innerHTML='<tr><td><div class="sk" style="width:30px;height:30px;margin:0 auto;border-radius:6px"></div></td><td><div class="sk" style="width:24px;height:12px"></div></td><td><div class="sk" style="width:100px;height:12px"></div></td><td><div class="sk" style="width:85%;height:12px"></div></td><td><div class="sk" style="width:75%;height:12px"></div></td></tr>'.repeat(3);

  var offset=(pg-1)*CURRENT_PAGE_SIZE;
  var params='chiamate?select=*&deleted_at=is.null';
  if(showIncompleteOnly){
    params+='&completato=eq.false&order=timestamp_chiamata.desc';
  } else {
    params+='&order=completato.asc,timestamp_chiamata.desc';
  }
  params+='&limit='+CURRENT_PAGE_SIZE+'&offset='+offset;

  var doFetch=function(){
    var loadHeaders = authHeaders(); loadHeaders['Prefer'] = 'count=exact';
    return fetch(SUPABASE_URL+'/rest/v1/'+params,{method:'GET',headers:loadHeaders});
  };

  doFetch().then(function(res){
    // JWT scaduto (tipico dopo lunga inattività) → rinnova e riprova UNA volta
    if(res.status===401){
      return ensureFreshToken().then(function(ok){
        if(!ok) throw {kind:'auth'};
        return doFetch();
      });
    }
    return res;
  }).then(function(res){
    var cr=res.headers.get('content-range')||'';
    var total=parseInt((cr.split('/')[1]||'0'),10)||0;
    return res.json().then(function(data){
      // Se non è un array è un oggetto errore PostgREST (es. JWT expired): trattalo come errore
      if(!Array.isArray(data)) throw {kind:'postgrest', data:data, status:res.status};
      return {data:data,total:total};
    });
  }).then(function(result){
    hideLoader();
    var records=result.data.map(mapServerRow);
    // Cache dell'elenco (solo pagina 1 senza filtri) per apertura offline
    if(pg===1 && !showIncompleteOnly && !currentFilters) cacheServerRows(records, result.total);
    renderListWithPending(records, result.total, pg);
  }).catch(function(e){
    hideLoader();
    renderOfflineFallback(pg, e);
  });
}

// Mappa una riga server nel formato usato da drawRows
function mapServerRow(r){
  return {
    id:r.id,rowIndex:r.id,
    tsFormatted:formatTSFromISO(r.timestamp_chiamata),
    postazione:r.postazione||'',descrizione:r.descrizione||'',note:r.note||'',completato:!!r.completato,
    girata_a_user_id:r.girata_a_user_id||null,
    girata_a_nome:r.girata_a_nome||'',
    girata_a_at:r.girata_a_at||null,
    girata_da_user_id:r.girata_da_user_id||null,
    girata_da_nome:r.girata_da_nome||'',
    girata_da_at:r.girata_da_at||null
  };
}

// Converte una voce "insert" della coda in un record renderizzabile (riga "in attesa")
function pendingInsertToRecord(e){
  var b=e.body||{};
  return {
    id:'local_'+e.client_uuid, client_uuid:e.client_uuid, localPending:true,
    tsFormatted:formatTSFromISO(b.timestamp_chiamata),
    postazione:b.postazione||'', descrizione:b.descrizione||'', note:b.note||'', completato:false
  };
}

// Renderizza server rows + eventuali chiamate locali in attesa (in cima, solo pag.1 senza filtri)
function renderListWithPending(records,total,pg){
  var merged=records;
  var pendingCount=0;
  if(pg===1 && !currentFilters && !showIncompleteOnly){
    var inserts=loadPendingInserts().map(pendingInsertToRecord);
    pendingCount=inserts.length;
    merged=inserts.concat(records);
  }
  drawRows(merged,null);
  drawPgn(total,pg,CURRENT_PAGE_SIZE);
  var inf=total>0?total+' chiamat'+(total===1?'a':'e')+' in totale':'';
  if(showIncompleteOnly&&total>0)inf='⏳ '+total+' in attesa';
  if(pendingCount>0) inf=(inf?inf+' · ':'')+'📋 '+pendingCount+' in invio';
  (els.linfo||document.getElementById('linfo')).textContent=inf;
  // Marca le righe (update) che hanno un sync in coda
  var pendingIds=syncLoadQueue().filter(function(e){return e.type!=='insert';}).map(function(e){return String(e.id);});
  pendingIds.forEach(function(id){
    var tr=document.querySelector('tr[data-row="'+id+'"]');
    if(tr)tr.classList.add('pending-sync');
  });
}

// Fallback quando il caricamento fallisce (offline / rete): mostra cache + pending,
// MAI "Errore server" con JSON grezzo, MAI perdita delle chiamate locali.
function renderOfflineFallback(pg, e){
  var inserts=loadPendingInserts().map(pendingInsertToRecord);
  var cached=loadCachedRows();
  var serverRecs=(pg===1 && cached && cached.records)?cached.records.slice():[];

  // Applica le modifiche ancora in coda (update) sui record in cache: così un
  // reload OFFLINE mostra comunque le correzioni fatte (già salvate in coda).
  var updates=syncLoadQueue().filter(function(x){return x.type!=='insert';});
  if(updates.length && serverRecs.length){
    var byId={};
    updates.forEach(function(u){ byId[String(u.id)]=u.body||{}; });
    serverRecs=serverRecs.map(function(r){
      var b=byId[String(r.id)]; if(!b) return r;
      var m={}; for(var k in r){ if(r.hasOwnProperty(k)) m[k]=r[k]; }
      if('descrizione' in b) m.descrizione=b.descrizione;
      if('note' in b) m.note=b.note;
      if('postazione' in b) m.postazione=b.postazione;
      if(b.timestamp_chiamata) m.tsFormatted=formatTSFromISO(b.timestamp_chiamata);
      m._pendingEdit=true;
      return m;
    });
  }

  var merged=(pg===1)?inserts.concat(serverRecs):serverRecs;

  if(merged.length===0){
    (els.tbody||document.getElementById('tbody')).innerHTML=
      '<tr><td colspan="5"><div class="emp">'
      +'<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>'
      +'<h3>Nessuna connessione</h3><p>Riprova appena torni online. Le chiamate che registri adesso vengono salvate in locale e inviate automaticamente al ritorno della linea.</p></div></td></tr>';
    drawPgn(0,1,CURRENT_PAGE_SIZE);
    (els.linfo||document.getElementById('linfo')).textContent='Offline';
    return;
  }
  drawRows(merged,null);
  drawPgn(0,1,CURRENT_PAGE_SIZE);
  // Marca le righe con modifica in coda
  var updIds=updates.map(function(u){return String(u.id);});
  updIds.forEach(function(id){
    var tr=document.querySelector('tr[data-row="'+id+'"]');
    if(tr)tr.classList.add('pending-sync');
  });
  var parts=[];
  if(inserts.length) parts.push('📋 '+inserts.length+' in invio');
  if(updIds.length) parts.push('✏️ '+updIds.length+' modific'+(updIds.length===1?'a':'he')+' in coda');
  parts.push('offline · elenco in cache');
  (els.linfo||document.getElementById('linfo')).textContent=parts.join(' · ');
}

function drawRows(recs,highlightQuery){
  var tb=els.tbody||document.getElementById('tbody');
  if(!recs||!recs.length){
    tb.innerHTML='<tr><td colspan="5"><div class="emp"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>'+(currentFilters?'Nessun risultato':'Nessuna chiamata')+'</h3><p>'+(currentFilters?'Prova a modificare i criteri di ricerca.':'Premi «+» per registrare la prima chiamata.')+'</p></div></td></tr>';
    return;
  }
  // Pre-calcola pendingGirate map per chiamata_origine_id (outgoing pending)
  var outgoingPendingMap = {};
  (pendingGirate.outgoing||[]).forEach(function(g){
    if(g.chiamata_origine_id) outgoingPendingMap[g.chiamata_origine_id] = g;
  });

  tb.innerHTML=recs.map(function(r){
    // Riga chiamata salvata solo in locale (in attesa di invio al server)
    if(r.localPending) return renderPendingInsertRow(r);
    var tsf=r.tsFormatted||'';
    var parts=tsf.split(' ');
    var ds=parts[0]||'',ts=parts[1]||'';
    var pc=getColor(r.postazione);
    var ddOpts=POST.map(function(p){
      return '<div class="post-opt" data-nome="'+esc(p.nome)+'" data-colore="'+esc(p.colore||'#2e7d5e')+'">'
        +'<span class="post-dot" style="background:'+esc(p.colore||'#2e7d5e')+'"></span>'+esc(p.nome)+'</div>';
    }).join('');

    // Badge "Girata a/da"
    var girataBadge = '';
    if(r.girata_a_nome){
      // Sono il mittente, già accettata dal collega
      girataBadge = '<span class="girata-badge" contenteditable="false" title="Girata accettata">'
        +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
        +'Girata a '+esc(r.girata_a_nome)+(r.girata_a_at?' · '+esc(formatTSFromISO(r.girata_a_at)):'')
      +'</span>';
    } else if(r.girata_da_nome){
      // Sono il destinatario: chiamata accettata da me
      girataBadge = '<span class="girata-badge from" contenteditable="false" title="Ricevuta da collega">'
        +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
        +'Da '+esc(r.girata_da_nome)+(r.girata_da_at?' · '+esc(formatTSFromISO(r.girata_da_at)):'')
      +'</span>';
    } else if(outgoingPendingMap[r.id]){
      // Girata in corso (pending) — io sono il mittente
      var p = outgoingPendingMap[r.id];
      girataBadge = '<span class="girata-badge pending" contenteditable="false" title="In attesa di accettazione">'
        +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
        +'In attesa: '+esc(p.to_user_nome||'collega')
      +'</span>';
    }

    var descHtml=linkifyAddresses(linkifyPhones(highlightQuery?highlight(r.descrizione||'',highlightQuery):esc(r.descrizione||'')));
    var noteHtml=linkifyAddresses(linkifyPhones(highlightQuery?highlight(r.note||'',highlightQuery):esc(r.note||'')));
    var si=r.completato
      ?'<div class="ich"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>'
      :'<div class="iho" data-row="'+r.id+'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></div>';

    // Bottone Gira: solo per chiamate non completate, non già girate (accettate), non in pending
    var giraBtn = '';
    var canGirare = !r.completato && !r.girata_a_user_id && !outgoingPendingMap[r.id];
    if(canGirare){
      giraBtn = '<div class="iho-gira" data-row="'+r.id+'" data-desc="'+esc((r.descrizione||'').substring(0,140))+'" title="Gira la chiamata a un collega">'
        + svgGira()
      + '</div>';
    }

    var cestino='<div class="idel" data-row="'+r.id+'" data-desc="'+esc((r.descrizione||'').substring(0,50))+'" title="Click per eliminare">'
      +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
      +'</div>';
    return '<tr class="'+(r.completato?'done':'pending')+'" data-row="'+r.id+'" data-original-ts="'+esc(tsf)+'">'
      +'<td class="tds"><div class="sc">'+si+'<div class="isv" data-row="'+r.id+'" style="display:none">'+svgFloppy()+'</div>'+giraBtn+cestino+'</div></td>'
      +'<td class="tid">'+r.id+'</td>'
      +'<td class="tdt"><div class="dt-wrap">'
        +'<span class="dt-date" contenteditable="true" data-field="dt-date" spellcheck="false">'+esc(ds)+'</span>'
        +'<span class="dt-time" contenteditable="true" data-field="dt-time" spellcheck="false">'+esc(ts)+'</span>'
        +'<span class="ptag" data-field="postazione" data-nome="'+esc(r.postazione||'')+'" style="background:'+pc+'">'
          +esc(r.postazione||'—')
          +'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>'
          +'<div class="post-dropdown">'+ddOpts+'</div>'
        +'</span>'
      +'</div></td>'
      +'<td data-field="descrizione" contenteditable="true" spellcheck="false" style="white-space:pre-wrap;min-width:180px">'+girataBadge+(girataBadge?'<br>':'')+descHtml+'</td>'
      +'<td data-field="note" contenteditable="true" spellcheck="false" style="white-space:pre-wrap">'+noteHtml+'</td>'
      +'</tr>';
  }).join('');

  // Listener attaccati una sola volta al boot via setupTableDelegation()
}

// Riga di una chiamata registrata offline, non ancora inviata al server.
// È MODIFICABILE inline (descrizione, note, postazione, data/ora): le modifiche
// vengono scritte nella voce di coda (per client_uuid), così quando torna la
// linea parte la versione corretta. Si può anche eliminare (rimuove dalla coda).
function renderPendingInsertRow(r){
  var tsf=r.tsFormatted||'';
  var parts=tsf.split(' ');
  var ds=parts[0]||'', ts=parts[1]||'';
  var pc=getColor(r.postazione);
  var ddOpts=POST.map(function(p){
    return '<div class="post-opt" data-nome="'+esc(p.nome)+'" data-colore="'+esc(p.colore||'#2e7d5e')+'">'
      +'<span class="post-dot" style="background:'+esc(p.colore||'#2e7d5e')+'"></span>'+esc(p.nome)+'</div>';
  }).join('');
  var descHtml=linkifyAddresses(linkifyPhones(esc(r.descrizione||'')));
  var noteHtml=linkifyAddresses(linkifyPhones(esc(r.note||'')));
  var badge='<span class="girata-badge pending" contenteditable="false" title="Salvata sul dispositivo, in attesa di invio al server">'
    +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
    +'Solo in locale — in attesa di invio</span>';
  var clock='<div class="iho-localwait" title="In attesa di invio al server"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>';
  var delBtn='<div class="idel-local" data-uuid="'+esc(r.client_uuid)+'" title="Elimina questa chiamata locale (non ancora inviata)">'
    +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>';
  return '<tr class="local-pending" data-uuid="'+esc(r.client_uuid)+'" data-original-ts="'+esc(tsf)+'">'
    +'<td class="tds"><div class="sc">'+clock+delBtn+'</div></td>'
    +'<td class="tid">—</td>'
    +'<td class="tdt"><div class="dt-wrap">'
      +'<span class="dt-date" contenteditable="true" data-field="dt-date" spellcheck="false">'+esc(ds)+'</span>'
      +'<span class="dt-time" contenteditable="true" data-field="dt-time" spellcheck="false">'+esc(ts)+'</span>'
      +'<span class="ptag" data-field="postazione" data-nome="'+esc(r.postazione||'')+'" style="background:'+pc+'">'
        +esc(r.postazione||'—')
        +'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>'
        +'<div class="post-dropdown">'+ddOpts+'</div>'
      +'</span>'
    +'</div></td>'
    +'<td data-field="descrizione" contenteditable="true" spellcheck="false" style="white-space:pre-wrap;min-width:180px">'+badge+'<br>'+descHtml+'</td>'
    +'<td data-field="note" contenteditable="true" spellcheck="false" style="white-space:pre-wrap">'+noteHtml+'</td>'
  +'</tr>';
}

// ── AUTOSAVE riga LOCALE: scrive le modifiche nella voce di coda (client_uuid),
//    non sul server (la chiamata non è ancora stata inviata). ────────────────
var localAutosaveTimers={};
function scheduleLocalAutosave(tr){
  var uuid=tr&&tr.dataset&&tr.dataset.uuid; if(!uuid)return;
  if(localAutosaveTimers[uuid])clearTimeout(localAutosaveTimers[uuid]);
  localAutosaveTimers[uuid]=setTimeout(function(){
    delete localAutosaveTimers[uuid];
    if(document.body.contains(tr)) saveLocalRowNow(tr);
  },700);
}
function saveLocalRowNow(tr){
  var uuid=tr&&tr.dataset&&tr.dataset.uuid; if(!uuid)return;
  if(localAutosaveTimers[uuid]){clearTimeout(localAutosaveTimers[uuid]);delete localAutosaveTimers[uuid];}
  var q=syncLoadQueue();
  var idx=-1;
  for(var i=0;i<q.length;i++){ if(q[i].type==='insert' && q[i].client_uuid===uuid){ idx=i; break; } }
  if(idx===-1)return; // già sincronizzata/rimossa dalla coda: niente da aggiornare
  var po=tr.querySelector('[data-field="postazione"]')?(tr.querySelector('[data-field="postazione"]').dataset.nome||''):'';
  var de=sanitizeText(getCellTextNoBadge(tr,'descrizione'));
  var no=sanitizeText(getCellTextNoBadge(tr,'note'));
  var tsNow=getFormattedTs(tr);
  var b=q[idx].body||{};
  b.postazione=po; b.descrizione=de; b.note=no;
  var tsISO=italianToISO(tsNow); if(tsISO){ b.timestamp_chiamata=tsISO; tr.dataset.originalTs=tsNow; }
  q[idx].body=b;
  var ok=syncSaveQueue(q);
  if(ok){
    tr.classList.add('saved-pulse');
    setTimeout(function(){tr.classList.remove('saved-pulse');},900);
    relinkifyRow(tr);
  }
}

// ───────────────────────────────────────────────────────────
// CODA SINCRONIZZAZIONE OFFLINE
// Persiste in localStorage le modifiche non riuscite.
// Riprova automaticamente: ogni 30s, su evento "online", al boot.
// ───────────────────────────────────────────────────────────
var SYNC_QUEUE_KEY='syncQueue_v1';

function syncLoadQueue(){
  try{var raw=localStorage.getItem(SYNC_QUEUE_KEY);return raw?JSON.parse(raw):[];}catch(e){return [];}
}
function syncSaveQueue(q){
  try{localStorage.setItem(SYNC_QUEUE_KEY,JSON.stringify(q));return true;}catch(e){return false;}
}
function syncEnqueue(rowId,body){
  var q=syncLoadQueue();
  // Dedup: tieni solo l'ultima versione per riga
  q=q.filter(function(e){return String(e.id)!==String(rowId);});
  q.push({id:rowId,body:body,ts:Date.now(),attempts:0});
  syncSaveQueue(q);
  syncRenderBadge();
}
function syncDequeue(rowId){
  var q=syncLoadQueue().filter(function(e){return String(e.id)!==String(rowId);});
  syncSaveQueue(q);
  syncRenderBadge();
}

// ───────────────────────────────────────────────────────────
// OUTBOX INSERT: nuove chiamate registrate offline (o con invio fallito).
// Le voci "insert" hanno forma {type:'insert', client_uuid, body, ts, attempts}.
// Le voci "update" (modifiche a righe esistenti) restano {id, body, ts, attempts}.
// client_uuid rende l'inserimento IDEMPOTENTE: se la stessa chiamata viene
// inviata due volte (rete ballerina), l'indice unico su chiamate.client_uuid
// impedisce il duplicato (il secondo POST torna 409 → trattato come successo).
// ───────────────────────────────────────────────────────────
function newClientUuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(_){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
    var r=Math.random()*16|0, v=(c==='x')?r:((r&0x3)|0x8); return v.toString(16);
  });
}
function syncEnqueueInsert(clientUuid, body){
  var q=syncLoadQueue();
  q=q.filter(function(e){return !(e.type==='insert' && e.client_uuid===clientUuid);});
  q.push({type:'insert', client_uuid:clientUuid, body:body, ts:Date.now(), attempts:0});
  var ok=syncSaveQueue(q);
  syncRenderBadge();
  return ok; // false = localStorage non disponibile (modalità privata / memoria piena)
}
function syncDequeueInsert(clientUuid){
  var q=syncLoadQueue().filter(function(e){return !(e.type==='insert' && e.client_uuid===clientUuid);});
  syncSaveQueue(q);
  syncRenderBadge();
}
function loadPendingInserts(){
  return syncLoadQueue().filter(function(e){return e.type==='insert';});
}

// Invio singolo di una insert (con rinnovo JWT + retry e gestione 409 idempotente).
// Ritorna Promise<bool>: true = salvata sul server (o già presente), false = resta in coda.
function syncOneInsert(clientUuid, body){
  markOwnWrite();
  var post=function(){
    return sbFetch('chiamate',{method:'POST',body:body,prefer:'return=minimal'});
  };
  return post().then(function(res){
    if(res.ok || res.status===409){ syncDequeueInsert(clientUuid); return true; }
    if(res.status===401){
      return ensureFreshToken().then(function(){
        return post().then(function(r2){
          if(r2.ok || r2.status===409){ syncDequeueInsert(clientUuid); return true; }
          return false;
        });
      });
    }
    return false;
  }).catch(function(){ return false; });
}

// ───────────────────────────────────────────────────────────
// CACHE ultima lista server: consente di aprire l'app OFFLINE e vedere
// comunque l'ultimo elenco noto (invece di "Errore server").
// ───────────────────────────────────────────────────────────
var CHIAMATE_CACHE_KEY='chiamateCache_v1';
function cacheServerRows(records,total){
  try{ localStorage.setItem(CHIAMATE_CACHE_KEY, JSON.stringify({ts:Date.now(),records:records,total:total})); }catch(_){}
}
function loadCachedRows(){
  try{ var raw=localStorage.getItem(CHIAMATE_CACHE_KEY); return raw?JSON.parse(raw):null; }catch(_){ return null; }
}

// ───────────────────────────────────────────────────────────
// BOZZA form nuova chiamata: salva in continuo ciò che stai scrivendo,
// così un crash / ricarica PRIMA di premere Salva non perde nulla.
// ───────────────────────────────────────────────────────────
var DRAFT_KEY='newCallDraft_v1';
var _draftTimer=null;
function saveDraftDebounced(){
  if(_draftTimer)clearTimeout(_draftTimer);
  _draftTimer=setTimeout(saveDraftNow,400);
}
function saveDraftNow(){
  try{
    var d=(document.getElementById('txd')||{}).value||'';
    var n=(document.getElementById('txn')||{}).value||'';
    var dtEl=document.getElementById('dtxt');
    var dt=dtEl?(dtEl.innerText||''):'';
    if(!d.trim() && !n.trim()){ localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({d:d,n:n,dt:dt,ts:Date.now()}));
  }catch(_){}
}
function clearDraft(){ try{ localStorage.removeItem(DRAFT_KEY); }catch(_){} }
function restoreDraft(){
  try{
    var raw=localStorage.getItem(DRAFT_KEY); if(!raw)return;
    var o=JSON.parse(raw); if(!o || (!o.d && !o.n))return;
    var txd=document.getElementById('txd'); if(txd && !txd.value) txd.value=o.d||'';
    var txn=document.getElementById('txn'); if(txn && !txn.value) txn.value=o.n||'';
    var dtx=document.getElementById('dtxt');
    if(dtx && o.dt && o.dt.trim() && (dtx.textContent==='—' || !dtx.textContent.trim())){
      dtx.textContent=o.dt; attachFormDateListeners();
    }
    if(o.d || o.n){
      fb(true,'Bozza recuperata','Ho ripristinato la chiamata che stavi scrivendo. Controlla i dati e premi Salva.');
    }
  }catch(_){}
}

function syncProcess(){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
  var q=syncLoadQueue();
  if(!q.length)return;
  // Rinnova il token PRIMA di drenare la coda (evita 401 su token scaduto)
  ensureFreshToken().then(function(){
    var q2=syncLoadQueue();
    if(!q2.length)return;
    markOwnWrite();
    Promise.all(q2.map(function(entry){
      entry.attempts=(entry.attempts||0)+1;
      if(entry.type==='insert'){
        var key='ins:'+entry.client_uuid;
        return sbFetch('chiamate',{method:'POST',body:entry.body,prefer:'return=minimal'})
          .then(function(res){ return {ok:(res.ok||res.status===409), key:key}; })
          .catch(function(){ return {ok:false, key:key}; });
      } else {
        var ukey='upd:'+entry.id;
        return sbFetch('chiamate?id=eq.'+entry.id,{method:'PATCH',body:entry.body,prefer:'return=minimal'})
          .then(function(res){ return {ok:res.ok, key:ukey}; })
          .catch(function(){ return {ok:false, key:ukey}; });
      }
    })).then(function(results){
      var okKeys={};
      results.forEach(function(r){ if(r.ok) okKeys[r.key]=true; });
      var newQ=syncLoadQueue().filter(function(e){
        var k = (e.type==='insert') ? ('ins:'+e.client_uuid) : ('upd:'+e.id);
        return !okKeys[k];
      });
      syncSaveQueue(newQ);
      syncRenderBadge();
      var anyOk=results.some(function(r){return r.ok;});
      if(anyOk) loadRows(PAGE); // refresh elenco se almeno una è andata a buon fine
    });
  });
}

function syncRenderBadge(){
  var q=syncLoadQueue();
  var existing=document.getElementById('syncBadge');
  if(q.length===0){if(existing)existing.remove();return;}
  if(!existing){
    existing=document.createElement('div');
    existing.id='syncBadge';
    existing.title='Clicca per riprovare adesso';
    existing.addEventListener('click',function(){syncProcess();});
    document.body.appendChild(existing);
  }
  var offline=(typeof navigator!=='undefined'&&navigator.onLine===false);
  var inserts=q.filter(function(e){return e.type==='insert';}).length;
  var updates=q.length-inserts;
  var label;
  if(inserts>0 && updates>0){
    label=inserts+' chiamat'+(inserts===1?'a':'e')+' + '+updates+' modific'+(updates===1?'a':'he')+' da inviare';
  } else if(inserts>0){
    label=inserts+' chiamat'+(inserts===1?'a nuova':'e nuove')+' da inviare';
  } else {
    label=updates+' modific'+(updates===1?'a':'he')+' in attesa';
  }
  existing.className='sync-badge'+(offline?' offline':'');
  existing.innerHTML=
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
      +(offline
        ?'<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'
        :'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>')
    +'</svg>'
    +'<span>'+(offline?'Offline · ':'')+label+'</span>';
}

// Innesco automatico: quando torna la connessione + ogni 30s + al boot
if(typeof window!=='undefined'){
  window.addEventListener('online',function(){syncRenderBadge();syncProcess();});
  window.addEventListener('offline',function(){syncRenderBadge();});
  setInterval(syncProcess,30000);
}

// ───────────────────────────────────────────────────────────
// AUTOSAVE: timer per riga, parte 1.5s dopo che il focus
// lascia la riga. Cancellato se l'utente torna sulla riga.
// ───────────────────────────────────────────────────────────
var autosaveTimers={};
var AUTOSAVE_DELAY=1500;

function scheduleAutosave(tr){
  if(!tr||!tr.dataset)return;
  var rowId=tr.dataset.row;
  if(!rowId)return;
  if(autosaveTimers[rowId])clearTimeout(autosaveTimers[rowId]);
  autosaveTimers[rowId]=setTimeout(function(){
    delete autosaveTimers[rowId];
    if(!document.body.contains(tr))return;
    if(!dirtyMap[rowId])return;
    if(tr.contains(document.activeElement))return; // utente è tornato
    silentAutoSave(tr,rowId);
  },AUTOSAVE_DELAY);
}

function cancelAutosave(rowId){
  if(autosaveTimers[rowId]){clearTimeout(autosaveTimers[rowId]);delete autosaveTimers[rowId];}
}

function silentAutoSave(tr,rowId){
  if(!validateDateTimeFields(tr))return; // se data/ora invalida, già mostra warning
  var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
  var de=sanitizeText(getCellTextNoBadge(tr,'descrizione'));
  var no=sanitizeText(getCellTextNoBadge(tr,'note'));
  var tsNow=getFormattedTs(tr);
  var body={postazione:po,descrizione:de,note:no};
  var tsISO=italianToISO(tsNow);if(tsISO)body.timestamp_chiamata=tsISO;
  var floppy=tr.querySelector('.isv');
  if(floppy){floppy.style.display='flex';floppy.classList.add('saving');floppy.innerHTML='<div class="spin-dark"></div>';}

  var onSuccess=function(){
    if(floppy){floppy.classList.remove('saving');floppy.innerHTML=svgFloppy();}
    delete dirtyMap[rowId];
    syncDequeue(rowId);
    tr.dataset.originalTs=tsNow;
    if(floppy)floppy.style.display='none';
    tr.classList.add('saved-pulse');
    setTimeout(function(){tr.classList.remove('saved-pulse');},900);
    // Ri-rileva eventuali numeri nuovi inseriti nella cella
    relinkifyRow(tr);
    // Aggiorna lastKnownUpdate per non triggerare banner per modifiche nostre
    fetchLatestUpdate().then(function(ts){if(ts)lastKnownUpdate=ts;});
  };
  var onFailure=function(){
    // Salvataggio fallito → metti in coda per riprovare quando c'è linea
    syncEnqueue(rowId,body);
    if(floppy){floppy.classList.remove('saving');floppy.innerHTML=svgFloppy();floppy.style.display='none';}
    delete dirtyMap[rowId]; // rimosso da dirtyMap perché ora è in syncQueue
    tr.dataset.originalTs=tsNow;
    // Indicatore visivo "in attesa di sync" sulla riga
    tr.classList.add('pending-sync');
  };

  // Se offline, accoda subito senza tentare
  if(typeof navigator!=='undefined'&&navigator.onLine===false){onFailure();return;}

  markOwnWrite();
  sbFetch('chiamate?id=eq.'+rowId,{method:'PATCH',body:body,prefer:'return=minimal'})
    .then(function(res){if(res.ok)onSuccess();else onFailure();})
    .catch(function(){onFailure();});
}

// Costruisce il body PATCH per una riga (riusato da beforeunload)
function buildPatchBodyFromRow(tr){
  if(!tr)return null;
  var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
  var de=sanitizeText(getCellTextNoBadge(tr,'descrizione'));
  var no=sanitizeText(getCellTextNoBadge(tr,'note'));
  var tsNow=getFormattedTs(tr);
  var body={postazione:po,descrizione:de,note:no};
  var tsISO=italianToISO(tsNow);if(tsISO)body.timestamp_chiamata=tsISO;
  return body;
}

// ───────────────────────────────────────────────────────────
// EVENT DELEGATION sul <tbody>: 1 listener per tipo, valido per
// qualsiasi riga (presente o futura). Sostituisce le 6 forEach
// che giravano in drawRows ad ogni redraw.
// ───────────────────────────────────────────────────────────
function setupTableDelegation(){
  var tbody=document.getElementById('tbody');
  if(!tbody||tbody._delegated)return;
  tbody._delegated=true;

  // Mobile: previene il focus sul contenteditable padre quando si tocca un .ph-link / .addr-link
  // (altrimenti la tastiera si apre prima del modal)
  var phPreventFocus=function(e){
    if(!e.target||!e.target.closest)return;
    if(e.target.closest('.ph-link')||e.target.closest('.addr-link'))e.preventDefault();
  };
  tbody.addEventListener('pointerdown',phPreventFocus);
  tbody.addEventListener('mousedown',phPreventFocus);

  tbody.addEventListener('click',function(e){
    var t=e.target;
    var ph=t.closest('.ph-link');
    if(ph){
      e.stopPropagation();e.preventDefault();
      if(document.activeElement&&typeof document.activeElement.blur==='function'){
        try{document.activeElement.blur();}catch(_e){}
      }
      openPhoneModal(ph.dataset.phone,ph);
      return;
    }
    var addr=t.closest('.addr-link');
    if(addr){
      e.stopPropagation();e.preventDefault();
      if(document.activeElement&&typeof document.activeElement.blur==='function'){
        try{document.activeElement.blur();}catch(_e){}
      }
      openAddrModal(addr.dataset.addr||addr.textContent,addr);
      return;
    }
    var giraEl=t.closest('.iho-gira');
    if(giraEl){
      e.stopPropagation();
      var rowId=parseInt(giraEl.dataset.row);
      var trGira=giraEl.closest('tr');
      // Costruisci preview testuale (data · postazione · descrizione breve)
      var when='', post='', desc='';
      if(trGira){
        var origTs = trGira.dataset.originalTs || '';
        when = origTs;
        var ptg = trGira.querySelector('.ptag');
        post = ptg ? (ptg.dataset.nome||'') : '';
        desc = getCellTextNoBadge(trGira, 'descrizione').substring(0,200);
      }
      var preview = (when?when+' · ':'')+(post?post+'\n':'')+desc;
      openGiraModal(rowId, preview);
      return;
    }

    var iho=t.closest('.iho');
    if(iho){startCompleta(iho.closest('tr'),parseInt(iho.dataset.row));return;}

    var opt=t.closest('.post-opt');
    if(opt){
      e.stopPropagation();
      var trO=opt.closest('tr');
      var nome=opt.dataset.nome,colore=opt.dataset.colore;
      var ptag=trO.querySelector('.ptag');
      ptag.dataset.nome=nome;ptag.style.background=colore;
      ptag.childNodes[0].textContent=nome;
      ptag.querySelector('.post-dropdown').classList.remove('open');
      trO.classList.remove('has-open-dd');
      if(trO.classList.contains('local-pending')){ saveLocalRowNow(trO); }
      else { markDirty(trO); }
      return;
    }

    var ptg=t.closest('.ptag');
    if(ptg){
      e.stopPropagation();
      var dd=ptg.querySelector('.post-dropdown');
      document.querySelectorAll('.post-dropdown.open').forEach(function(x){
        if(x===dd)return;
        x.classList.remove('open');
        var tr=x.closest('tr');if(tr)tr.classList.remove('has-open-dd');
      });
      var isOpen=dd.classList.toggle('open');
      var trP=ptg.closest('tr');
      if(trP)trP.classList.toggle('has-open-dd',isOpen);
      return;
    }

    var isv=t.closest('.isv');
    if(isv){
      var trS=isv.closest('tr');
      saveEdit({rowIndex:parseInt(isv.dataset.row),tr:trS},isv,null);
      return;
    }

    var idel=t.closest('.idel');
    if(idel){
      e.stopPropagation();
      startDelete(parseInt(idel.dataset.row),idel.dataset.desc,idel);
      return;
    }

    var idelLocal=t.closest('.idel-local');
    if(idelLocal){
      e.stopPropagation();
      var uuid=idelLocal.dataset.uuid;
      if(window.confirm('Eliminare questa chiamata salvata in locale?\n\nNon è ancora stata inviata al server: verrà eliminata definitivamente e NON sarà recuperabile.')){
        syncDequeueInsert(uuid);
        loadRows(PAGE);
      }
      return;
    }
  });

  // INPUT su [contenteditable] → markDirty (righe server) / autosave locale (righe in attesa)
  tbody.addEventListener('input',function(e){
    if(!e.target.hasAttribute||!e.target.hasAttribute('contenteditable'))return;
    var tr=e.target.closest('tr');if(!tr)return;
    if(tr.classList.contains('local-pending')){ scheduleLocalAutosave(tr); return; }
    markDirty(tr);
  });

  // PASTE → solo testo plain
  tbody.addEventListener('paste',function(e){
    var el=e.target;
    if(!el.matches||!el.matches('[contenteditable]'))return;
    e.preventDefault();
    var text=(e.clipboardData||window.clipboardData).getData('text/plain')||'';
    text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return;
    sel.deleteFromDocument();
    var range=sel.getRangeAt(0);
    var lines=text.split('\n');
    var frag=document.createDocumentFragment();
    lines.forEach(function(line,i){
      if(i>0)frag.appendChild(document.createElement('br'));
      if(line)frag.appendChild(document.createTextNode(line));
    });
    range.insertNode(frag);
    range.collapse(false);
    sel.removeAllRanges();sel.addRange(range);
    var tr=el.closest('tr');
    if(tr){ if(tr.classList.contains('local-pending'))scheduleLocalAutosave(tr); else markDirty(tr); }
  });

  // DROP → solo testo plain
  tbody.addEventListener('drop',function(e){
    if(!e.target.matches||!e.target.matches('[contenteditable]'))return;
    e.preventDefault();
    var text=e.dataTransfer.getData('text/plain')||'';
    if(!text)return;
    var sel=window.getSelection();
    if(sel&&sel.rangeCount){
      var range=sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    }
  });

  // KEYDOWN: Enter su date/time → blur ; Ctrl+B/I/U bloccati su contenteditable
  tbody.addEventListener('keydown',function(e){
    var el=e.target;
    if(!el.classList)return;
    if((el.classList.contains('dt-date')||el.classList.contains('dt-time'))&&e.key==='Enter'){
      e.preventDefault();el.blur();return;
    }
    if(el.matches&&el.matches('[contenteditable]')&&(e.ctrlKey||e.metaKey)){
      if(['b','i','u','B','I','U'].indexOf(e.key)!==-1)e.preventDefault();
    }
  });

  // FOCUSIN su date/time → seleziona tutto + cancella autosave pending
  tbody.addEventListener('focusin',function(e){
    var el=e.target;
    if(!el.classList)return;
    var tr=el.closest('tr');
    if(tr&&tr.dataset.row)cancelAutosave(tr.dataset.row);
    if(el.classList.contains('dt-date')||el.classList.contains('dt-time')){
      var range=document.createRange();range.selectNodeContents(el);
      var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
    }
  });

  // FOCUSOUT: 1) autoformatta date/time se necessario, 2) pianifica autosave
  tbody.addEventListener('focusout',function(e){
    var el=e.target;
    if(!el.classList)return;
    var tr=el.closest('tr');
    var isDate=el.classList.contains('dt-date');
    var isTime=el.classList.contains('dt-time');
    var isLocal=tr&&tr.classList.contains('local-pending');
    if(isDate||isTime){
      var raw=(el.innerText||'').trim();
      if(raw){
        var fmt=isDate?autoformatDate(raw):autoformatTime(raw);
        if(fmt){el.innerText=fmt;setFieldError(el,false);}
        else{setFieldError(el,isDate?!isValidDate(raw):!isValidTime(raw));}
        if(tr&&!isLocal)markDirty(tr);
      }
    }
    // Righe in attesa (locali): salva subito nella coda al blur di qualsiasi campo
    if(isLocal){ saveLocalRowNow(tr); return; }
    // Pianifica autosave se la riga (server) è dirty
    if(tr&&tr.dataset.row&&dirtyMap[tr.dataset.row])scheduleAutosave(tr);
  });
}

function markDirty(tr){
  var ri=tr.dataset.row;
  if(!ri)return; // righe "in attesa" (solo locali) non hanno data-row: non tracciarle
  dirtyMap[ri]={rowIndex:parseInt(ri),tr:tr};
  var isv=tr.querySelector('.isv');if(isv)isv.style.display='flex';
}

function getDirtyCount(){return Object.keys(dirtyMap).length;}

function triggerDirtyWarning(){
  warnOpen=true;
  var n=getDirtyCount();
  if(n===1){apri('munsav1');}
  else{
    document.getElementById('munsavNmsg').textContent='Hai modificato '+n+' chiamate senza salvare. Cosa vuoi fare?';
    apri('munsavN');
  }
}


// ═══════════════════════════════════════════════════════════════════
// TIMESTAMP FORM
// ═══════════════════════════════════════════════════════════════════

// Restituisce innerText della cella escludendo eventuali .girata-badge
// (così il badge "Girata a/da X" non finisce nel testo salvato su DB)
function getCellTextNoBadge(tr, field){
  if(!tr) return '';
  var cell = tr.querySelector('[data-field="'+field+'"]');
  if(!cell) return '';
  var clone = cell.cloneNode(true);
  var badges = clone.querySelectorAll('.girata-badge');
  badges.forEach(function(b){
    var nx = b.nextSibling;
    if(nx && nx.nodeType===1 && nx.tagName==='BR') nx.parentNode.removeChild(nx);
    b.parentNode.removeChild(b);
  });
  // innerText restituisce i ritorni a capo (<br>/<div> inseriti premendo Invio)
  // SOLO se l'elemento è renderizzato: su un nodo staccato si comporta come
  // textContent e li perde. Quindi attacco il clone fuori schermo, leggo, stacco.
  clone.style.position='absolute';
  clone.style.left='-99999px';
  clone.style.top='0';
  clone.style.whiteSpace='pre-wrap';
  document.body.appendChild(clone);
  var txt = clone.innerText || '';
  if(clone.parentNode) clone.parentNode.removeChild(clone);
  return txt.trim();
}

function getFormattedTs(tr){
  var dateEl=tr.querySelector('[data-field="dt-date"]');
  var timeEl=tr.querySelector('[data-field="dt-time"]');
  var ds=dateEl?(dateEl.innerText||'').trim():'';
  var ts=timeEl?(timeEl.innerText||'').trim():'';
  if(ds||ts){
    var orig=(tr.dataset.originalTs||'').trim();
    var origParts=orig.split(/\s+/);
    var origDate=origParts[0]||'';
    var origTime=origParts[1]||'00:00';
    if(ds&&!ts)ts=origTime;
    if(!ds&&ts)ds=origDate;
  }
  if(ds&&ts)return ds+' '+ts;
  return (tr.dataset.originalTs||'').trim();
}


// ═══════════════════════════════════════════════════════════════════
// SAVE EDIT / SAVE ALL
// ═══════════════════════════════════════════════════════════════════

function saveEdit(info,floppyEl,onDone){
  var tr=info.tr,ri=info.rowIndex;
  if(!floppyEl)floppyEl=tr.querySelector('.isv');
  var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
  var de=sanitizeText(getCellTextNoBadge(tr,'descrizione'));
  var no=sanitizeText(getCellTextNoBadge(tr,'note'));
  var tsNow=getFormattedTs(tr);
  if(!validateDateTimeFields(tr))return;
  if(floppyEl){floppyEl.style.display='flex';floppyEl.classList.add('saving');floppyEl.innerHTML='<div class="spin-dark"></div>';}
  var body={postazione:po,descrizione:de,note:no};
  var tsISO=italianToISO(tsNow);if(tsISO)body.timestamp_chiamata=tsISO;

  var queueAndConfirm=function(){
    syncEnqueue(String(ri),body);
    if(floppyEl){floppyEl.classList.remove('saving');floppyEl.innerHTML=svgFloppy();floppyEl.style.display='none';}
    delete dirtyMap[String(ri)];
    tr.dataset.originalTs=tsNow;
    tr.classList.add('pending-sync');
    if(po)localStorage.setItem('lastPostazione',po);
    fb(true,'In coda','Sei offline. La modifica verrà inviata appena torni online.');
    if(onDone)onDone(true,true);
  };

  if(typeof navigator!=='undefined'&&navigator.onLine===false){queueAndConfirm();return;}

  markOwnWrite();
  sbFetch('chiamate?id=eq.'+ri,{method:'PATCH',body:body,prefer:'return=minimal'}).then(function(res){
    if(floppyEl){floppyEl.classList.remove('saving');floppyEl.innerHTML=svgFloppy();}
    if(res.ok){
      delete dirtyMap[String(ri)];
      syncDequeue(String(ri));
      tr.dataset.originalTs=tsNow;
      if(floppyEl)floppyEl.style.display='none';
      tr.classList.remove('pending-sync');
      if(po)localStorage.setItem('lastPostazione',po);
      relinkifyRow(tr);
      fetchLatestUpdate().then(function(ts){if(ts)lastKnownUpdate=ts;});
      fb(true,'Salvata','Chiamata aggiornata.');
    } else {
      // Errore HTTP → metti in coda
      queueAndConfirm();
      return;
    }
    if(onDone)onDone(res.ok,false);
  }).catch(function(){
    // Errore di rete → metti in coda
    queueAndConfirm();
  });
}

function saveAllDirty(cb,opts){
  opts=opts||{};
  var silent=!!opts.silent;
  var keys=Object.keys(dirtyMap);
  if(!keys.length){if(cb)silent?cb():cb(0,0);return;}
  markOwnWrite();
  var promises=keys.map(function(k){
    var info=dirtyMap[k],tr=info.tr,ri=info.rowIndex;
    var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
    var de=sanitizeText(getCellTextNoBadge(tr,'descrizione'));
    var no=sanitizeText(getCellTextNoBadge(tr,'note'));
    var tsNow=getFormattedTs(tr);
    var floppyEl=silent?null:tr.querySelector('.isv');
    if(floppyEl){floppyEl.classList.add('saving');floppyEl.innerHTML='<div class="spin-dark"></div>';}
    var body={postazione:po,descrizione:de,note:no};
    var tsISO=italianToISO(tsNow);if(tsISO)body.timestamp_chiamata=tsISO;
    return sbFetch('chiamate?id=eq.'+ri,{method:'PATCH',body:body,prefer:'return=minimal'}).then(function(res){
      if(floppyEl){floppyEl.classList.remove('saving');floppyEl.innerHTML=svgFloppy();}
      if(res.ok){delete dirtyMap[String(ri)];tr.dataset.originalTs=tsNow;if(floppyEl)floppyEl.style.display='none';return true;}
      return false;
    }).catch(function(){
      if(floppyEl){floppyEl.classList.remove('saving');floppyEl.innerHTML=svgFloppy();}
      return false;
    });
  });
  Promise.all(promises).then(function(results){
    if(!cb)return;
    if(silent)cb();
    else{var salvati=results.filter(Boolean).length;cb(salvati,results.length-salvati);}
  });
}

function saveAllDirtySilent(cb){return saveAllDirty(cb,{silent:true});}


// ═══════════════════════════════════════════════════════════════════
// COMPLETA
// ═══════════════════════════════════════════════════════════════════

function startCompleta(tr,ri){PROW={rowIndex:ri,tr:tr};apri('mcnf');}

function confCompleta(){
  chiudi('mcnf');if(!PROW)return;
  var tr=PROW.tr,ri=PROW.rowIndex;
  var hg=tr.querySelector('.iho');
  if(hg){hg.classList.add('loading');hg.innerHTML='<div class="spin-dark"></div>';}
  var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
  var de=sanitizeText(getCellTextNoBadge(tr,'descrizione'));
  var no=sanitizeText(getCellTextNoBadge(tr,'note'));
  var tsNow=getFormattedTs(tr);
  if(!validateDateTimeFields(tr))return;
  var body={postazione:po,descrizione:de,note:no,completato:true};
  var tsISO=italianToISO(tsNow);if(tsISO)body.timestamp_chiamata=tsISO;
  markOwnWrite();
  sbFetch('chiamate?id=eq.'+ri,{method:'PATCH',body:body,prefer:'return=minimal'}).then(function(res){
    PROW=null;
    if(res.ok){
      delete dirtyMap[String(ri)];
      fb(true,'Completata!','Chiamata completata e salvata.');
      loadRows(PAGE);
    } else {
      fb(false,'Errore','Aggiornamento fallito.');
      if(hg){hg.classList.remove('loading');hg.innerHTML=svgHourglass();}
    }
  }).catch(function(){
    PROW=null;fb(false,'Errore','Server non raggiungibile.');
    if(hg){hg.classList.remove('loading');hg.innerHTML=svgHourglass();}
  });
}


// ═══════════════════════════════════════════════════════════════════
// ELIMINA
// ═══════════════════════════════════════════════════════════════════

function startDelete(rowIndex,desc,iconEl){
  var msgEl=document.getElementById('mdelMsg');
  var modalEl=document.getElementById('mdel');
  if(!msgEl||!modalEl)return;
  DROW=rowIndex;DELEL=iconEl||null;
  msgEl.textContent='La chiamata verrà spostata nel cestino e rimossa definitivamente dopo 30 giorni:\n\n"'+(desc||'—')+'"\n\nPotrai ripristinarla in qualsiasi momento dal cestino in alto a destra.';
  apri('mdel');
}

function confDelete(){
  chiudi('mdel');if(!DROW)return;
  var ri=DROW;DROW=null;
  DELEL=null;
  var deletedAtISO=new Date().toISOString();
  var body={deleted_at:deletedAtISO};

  // UI ottimistica: nascondi subito la riga
  var trEl=document.querySelector('tr[data-row="'+ri+'"]');
  if(trEl)trEl.style.display='none';

  // Aggiorna conteggio nell'info bar al volo
  var li=els.linfo||document.getElementById('linfo');
  if(li){
    var m=(li.textContent||'').match(/^(\d+)/);
    if(m){var n=parseInt(m[1],10)-1;if(n<0)n=0;li.textContent=li.textContent.replace(/^\d+/,String(n));}
  }

  // Banner Annulla per 7 secondi
  showUndoBanner(ri);

  // Se offline, accoda
  if(typeof navigator!=='undefined'&&navigator.onLine===false){
    syncEnqueue(String(ri),body);
    return;
  }

  markOwnWrite();
  sbFetch('chiamate?id=eq.'+ri,{method:'PATCH',body:body,prefer:'return=minimal'}).then(function(res){
    if(!res.ok)syncEnqueue(String(ri),body);
    else refreshTrashBadge();
  }).catch(function(){syncEnqueue(String(ri),body);});
}

// ───────────────────────────────────────────────────────────
// CESTINO: gestione chiamate soft-deleted
// ───────────────────────────────────────────────────────────
var TRASH_RETENTION_DAYS=30;

function fmtDeletedAgo(iso){
  var d=new Date(iso);
  var ms=Date.now()-d.getTime();
  var mins=Math.floor(ms/60000);
  var hours=Math.floor(ms/3600000);
  var days=Math.floor(ms/86400000);
  if(mins<1)return 'pochi secondi fa';
  if(hours<1)return mins+' min fa';
  if(days<1)return hours+'h fa';
  if(days===1)return 'ieri';
  return days+' giorni fa';
}

function trashFetch(){
  return sbFetch('chiamate?deleted_at=not.is.null&order=deleted_at.desc&select=*&limit=500')
    .then(function(res){return res.json();});
}

function trashCount(){
  // HEAD via Prefer count=exact
  var trashHeaders = authHeaders(); trashHeaders['Prefer'] = 'count=exact';
  return fetch(SUPABASE_URL+'/rest/v1/chiamate?deleted_at=not.is.null&select=id&limit=1',{
    headers:trashHeaders
  }).then(function(res){
    var cr=res.headers.get('content-range')||'';
    return parseInt((cr.split('/')[1]||'0'),10)||0;
  }).catch(function(){return 0;});
}

function refreshTrashBadge(){
  var badge=document.getElementById('trashBadge');
  if(!badge)return;
  trashCount().then(function(n){
    if(n>0){badge.textContent=n;badge.style.display='inline-flex';}
    else badge.style.display='none';
  });
}

function openTrash(){
  apri('mtrash');
  renderTrashList();
}

function renderTrashList(){
  var wrap=document.getElementById('trashList');
  if(!wrap)return;
  wrap.innerHTML='<div style="padding:2.5rem;text-align:center"><div class="spin" style="margin:0 auto;border-color:rgba(46,125,94,.25);border-top-color:var(--pr);width:24px;height:24px"></div></div>';
  var emptyBtn=document.getElementById('btnTrashEmpty');

  trashFetch().then(function(records){
    if(!records||!records.length){
      wrap.innerHTML='<div class="emp" style="padding:2.5rem 1rem"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg><h3>Cestino vuoto</h3><p>Nessuna chiamata eliminata.</p></div>';
      if(emptyBtn)emptyBtn.disabled=true;
      return;
    }
    if(emptyBtn)emptyBtn.disabled=false;

    wrap.innerHTML=records.map(function(r){
      var pc=getColor(r.postazione);
      var deletedAt=new Date(r.deleted_at);
      var daysAgo=Math.floor((Date.now()-deletedAt.getTime())/86400000);
      var daysLeft=Math.max(0,TRASH_RETENTION_DAYS-daysAgo);
      var leftLabel=daysLeft===0?'a breve rimossa':(daysLeft+' g rimanenti');
      var leftClass=daysLeft<=3?'trash-warn':'';
      var descShort=esc((r.descrizione||'').substring(0,140))+(r.descrizione&&r.descrizione.length>140?'…':'');
      return '<div class="trash-row" data-id="'+r.id+'">'
        +'<div class="trash-row-head">'
          +'<span class="trash-ts">'+esc(formatTSFromISO(r.timestamp_chiamata))+'</span>'
          +'<span class="ptag" style="background:'+pc+';cursor:default;pointer-events:none">'+esc(r.postazione||'—')+'</span>'
          +'<span class="trash-days '+leftClass+'" title="Eliminata '+esc(fmtDeletedAgo(r.deleted_at))+'">'+leftLabel+'</span>'
        +'</div>'
        +'<div class="trash-desc">'+descShort+'</div>'
        +'<div class="trash-actions">'
          +'<button type="button" class="trash-btn-restore" data-id="'+r.id+'">'
            +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>'
            +' Ripristina'
          +'</button>'
          +'<button type="button" class="trash-btn-delete" data-id="'+r.id+'">'
            +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
            +' Elimina'
          +'</button>'
        +'</div>'
      +'</div>';
    }).join('');
  }).catch(function(){
    wrap.innerHTML='<div class="emp" style="padding:2rem"><h3>Errore</h3><p>Impossibile caricare il cestino.</p></div>';
  });
}

function trashRestoreOne(id,rowEl){
  if(typeof navigator!=='undefined'&&navigator.onLine===false){
    fb(false,'Offline','Impossibile ripristinare ora. Riprova quando hai connessione.');
    return;
  }
  rowEl.style.opacity='.5';rowEl.style.pointerEvents='none';
  markOwnWrite();
  sbFetch('chiamate?id=eq.'+id,{method:'PATCH',body:{deleted_at:null},prefer:'return=minimal'}).then(function(res){
    if(res.ok){
      rowEl.style.transition='opacity .25s,transform .25s';
      rowEl.style.opacity='0';rowEl.style.transform='translateX(-20px)';
      setTimeout(function(){
        if(rowEl.parentNode)rowEl.remove();
        var remaining=document.querySelectorAll('#trashList .trash-row').length;
        if(remaining===0)renderTrashList();
        refreshTrashBadge();
      },280);
      loadRows(PAGE);
      fb(true,'Ripristinata','Chiamata ripristinata.');
    } else {
      rowEl.style.opacity='';rowEl.style.pointerEvents='';
      fb(false,'Errore','Ripristino fallito.');
    }
  }).catch(function(){
    rowEl.style.opacity='';rowEl.style.pointerEvents='';
    fb(false,'Errore','Server non raggiungibile.');
  });
}

function trashHardDeleteOne(id,rowEl){
  if(typeof navigator!=='undefined'&&navigator.onLine===false){
    fb(false,'Offline','Impossibile eliminare ora. Riprova quando hai connessione.');
    return;
  }
  rowEl.style.opacity='.5';rowEl.style.pointerEvents='none';
  markOwnWrite();
  sbFetch('chiamate?id=eq.'+id,{method:'DELETE'}).then(function(res){
    if(res.ok){
      rowEl.style.transition='opacity .25s,transform .25s';
      rowEl.style.opacity='0';rowEl.style.transform='scale(.95)';
      setTimeout(function(){
        if(rowEl.parentNode)rowEl.remove();
        var remaining=document.querySelectorAll('#trashList .trash-row').length;
        if(remaining===0)renderTrashList();
        refreshTrashBadge();
      },280);
    } else {
      rowEl.style.opacity='';rowEl.style.pointerEvents='';
      fb(false,'Errore','Eliminazione fallita.');
    }
  }).catch(function(){
    rowEl.style.opacity='';rowEl.style.pointerEvents='';
    fb(false,'Errore','Server non raggiungibile.');
  });
}

function trashEmptyAll(){
  if(typeof navigator!=='undefined'&&navigator.onLine===false){
    fb(false,'Offline','Impossibile svuotare ora.');
    return;
  }
  var btn=document.getElementById('btnTrashEmptyConfirm');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spin"></div> Svuoto…';}
  markOwnWrite();
  sbFetch('chiamate?deleted_at=not.is.null',{method:'DELETE'}).then(function(res){
    chiudi('mtrashEmpty');
    if(btn){btn.disabled=false;btn.innerHTML='Svuota';}
    if(res.ok){
      fb(true,'Cestino svuotato','Tutte le chiamate sono state eliminate definitivamente.');
      renderTrashList();
      refreshTrashBadge();
    } else {
      fb(false,'Errore','Svuotamento fallito.');
    }
  }).catch(function(){
    chiudi('mtrashEmpty');
    if(btn){btn.disabled=false;btn.innerHTML='Svuota';}
    fb(false,'Errore','Server non raggiungibile.');
  });
}

// Auto-purge: elimina record con deleted_at più vecchio di 30 giorni
// Esegue al massimo una volta ogni 12 ore (debounce via localStorage)
function autoPurgeOld(){
  var lastKey='lastTrashPurge_v1';
  var last=parseInt(localStorage.getItem(lastKey)||'0',10);
  var now=Date.now();
  if(now-last<12*3600*1000)return;
  localStorage.setItem(lastKey,String(now));
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
  var cutoff=new Date(now-TRASH_RETENTION_DAYS*86400000).toISOString();
  markOwnWrite();
  sbFetch('chiamate?deleted_at=lt.'+cutoff,{method:'DELETE'}).then(function(){}).catch(function(){});
}

function showUndoBanner(rowId){
  var existing=document.getElementById('undoBanner');
  if(existing)existing.remove();

  var banner=document.createElement('div');
  banner.id='undoBanner';
  banner.className='undo-banner';
  banner.innerHTML=
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      +'<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'
    +'</svg>'
    +'<span class="undo-msg">Spostata nel cestino</span>'
    +'<button type="button" class="undo-btn">Annulla</button>'
    +'<div class="undo-progress"></div>';
  document.body.appendChild(banner);

  var dismissed=false;
  var btn=banner.querySelector('.undo-btn');

  btn.addEventListener('click',function(){
    dismissed=true;
    // Rimuovi eventuale entry in coda (se l'eliminazione era stata accodata)
    syncDequeue(String(rowId));
    // Ripristina: deleted_at = NULL
    var restoreBody={deleted_at:null};
    if(typeof navigator!=='undefined'&&navigator.onLine===false){
      syncEnqueue(String(rowId),restoreBody);
      banner.remove();
      fb(true,'Ripristinata (offline)','Verrà ripristinata appena online.');
      loadRows(PAGE);
      return;
    }
    markOwnWrite();
    sbFetch('chiamate?id=eq.'+rowId,{method:'PATCH',body:restoreBody,prefer:'return=minimal'}).then(function(res){
      if(res.ok){fb(true,'Ripristinata','Chiamata ripristinata.');loadRows(PAGE);}
      else{syncEnqueue(String(rowId),restoreBody);loadRows(PAGE);}
    }).catch(function(){
      syncEnqueue(String(rowId),restoreBody);loadRows(PAGE);
    });
    banner.remove();
  });

  // Auto-dismiss dopo 7 secondi
  setTimeout(function(){
    if(dismissed)return;
    banner.classList.add('fade-out');
    setTimeout(function(){if(banner.parentNode)banner.remove();},300);
  },7000);
}


// ═══════════════════════════════════════════════════════════════════
// PAGINAZIONE / UTILITY
// ═══════════════════════════════════════════════════════════════════

function drawPgn(tot,pg,sz){
  var pages=Math.ceil(tot/sz),w=document.getElementById('pgn');
  if(pages<=1){w.innerHTML='';return;}
  // Sliding window: max 5 numeri di pagina visibili intorno alla corrente
  var WINDOW=5;
  var half=Math.floor(WINDOW/2);
  var start=Math.max(1,pg-half);
  var end=Math.min(pages,start+WINDOW-1);
  if(end-start+1<WINDOW)start=Math.max(1,end-WINDOW+1);
  var h='';
  // Prima pagina (<<)
  h+='<button class="bp"'+(pg===1?' disabled':'')+' onclick="loadRows(1)" title="Prima pagina">&laquo;</button>';
  // Pagina precedente (<)
  h+='<button class="bp"'+(pg===1?' disabled':'')+' onclick="loadRows('+(pg-1)+')" title="Pagina precedente">&lsaquo;</button>';
  // Pagine numerate (window)
  for(var i=start;i<=end;i++){
    h+='<button class="bp'+(i===pg?' act':'')+'" onclick="loadRows('+i+')">'+i+'</button>';
  }
  // Pagina successiva (>)
  h+='<button class="bp"'+(pg===pages?' disabled':'')+' onclick="loadRows('+(pg+1)+')" title="Pagina successiva">&rsaquo;</button>';
  // Ultima pagina (>>)
  h+='<button class="bp"'+(pg===pages?' disabled':'')+' onclick="loadRows('+pages+')" title="Ultima pagina">&raquo;</button>';
  w.innerHTML=h;
}

function apri(id){var el=document.getElementById(id);if(el)el.classList.add('open');}
function chiudi(id){var el=document.getElementById(id);if(el)el.classList.remove('open');}


// ═══════════════════════════════════════════════════════════════════
// GESTIONE POSTAZIONI
// ═══════════════════════════════════════════════════════════════════

function mpostErrShow(msg){
  var el=document.getElementById('mpostErr');
  var sp=document.getElementById('mpostErrMsg');
  if(!el||!sp)return;
  sp.textContent=msg;
  el.style.display='flex';
}

function mpostErrHide(){
  var el=document.getElementById('mpostErr');
  if(el)el.style.display='none';
}

function apriGestPost(){
  var wrap=document.getElementById('postListWrap');
  if(!wrap){fb(false,'Errore','Contenitore postazioni non trovato.');return;}
  mpostErrHide();
  wrap.innerHTML='';
  if(Array.isArray(POST)&&POST.length){
    POST.forEach(function(p){
      var comuni=Array.isArray(p.comuni)?p.comuni.join(', '):(p.comuni||'');
      var row=creaRigaPost(p.nome||'',comuni,p.colore||'#2e7d5e',p.nome||'');
      row.dataset.originalNome=sanitizeText((p.nome||'').trim().toUpperCase());
      wrap.appendChild(row);
    });
  } else {
    var rowVuota=creaRigaPost('','','#2e7d5e','');
    rowVuota.dataset.originalNome='';
    wrap.appendChild(rowVuota);
  }
  apri('mpost');
}

function aggiungiRigaPost(){
  var wrap=document.getElementById('postListWrap');if(!wrap)return;
  var palette=['#2e7d5e','#1565c0','#6a1b9a','#c62828','#ef6c00','#00838f','#4e342e','#37474f'];
  var idx=wrap.querySelectorAll('.post-row').length%palette.length;
  var row=creaRigaPost('','',palette[idx],'new_'+Date.now());
  row.dataset.originalNome='';
  wrap.appendChild(row);
  var nomeEl=row.querySelector('.post-edit-nome');
  if(nomeEl)nomeEl.focus();
}

function creaRigaPost(nome,comuni,colore,id){
  nome=nome||'';comuni=comuni||'';colore=colore||'#2e7d5e';id=id||('post_'+Date.now());
  var palette=['#2e7d5e','#1565c0','#6a1b9a','#c62828','#ef6c00','#00838f','#4e342e','#37474f'];
  var row=document.createElement('div');
  row.className='post-row';row.dataset.id=id;
  row.innerHTML=
    '<div class="post-row-main" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">'
      +'<div class="post-row-left" style="flex:1 1 220px;min-width:220px;">'
        +'<input type="text" class="inp post-edit-nome" placeholder="Nome postazione" value="'+escAttr(nome)+'">'
      +'</div>'
      +'<div class="post-row-mid" style="flex:2 1 320px;min-width:260px;">'
        +'<input type="text" class="inp post-edit-comuni" placeholder="Comune 1, Comune 2, Comune 3" value="'+escAttr(comuni)+'">'
      +'</div>'
      +'<div class="post-row-right" style="display:flex;align-items:center;gap:8px;margin-left:auto;">'
        +'<button type="button" class="post-color-badge" data-colore="'+escAttr(colore)+'" title="Cambia colore" style="width:38px;height:38px;border:none;border-radius:10px;background:'+escAttr(colore)+';box-shadow:inset 0 0 0 1px rgba(255,255,255,.18), 0 1px 4px rgba(0,0,0,.12);cursor:pointer;flex:0 0 auto;"></button>'
        +'<button type="button" class="ibtn post-row-del" title="Elimina postazione" style="color:var(--er,#c0392b);">'
          +'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>'
        +'</button>'
      +'</div>'
    +'</div>';

  var nomeEl=row.querySelector('.post-edit-nome');
  var comuniEl=row.querySelector('.post-edit-comuni');
  var colorBtn=row.querySelector('.post-color-badge');
  var delBtn=row.querySelector('.post-row-del');

  if(nomeEl){
    nomeEl.addEventListener('input',function(){this.value=this.value.toUpperCase();});
    nomeEl.addEventListener('blur',function(){this.value=sanitizeText(this.value).toUpperCase();});
  }
  if(comuniEl){
    comuniEl.addEventListener('blur',function(){this.value=sanitizeText(this.value);});
  }
  if(colorBtn){
    colorBtn.addEventListener('click',function(){
      var curr=(this.dataset.colore||colore||'').toLowerCase();
      var idx=palette.map(function(c){return c.toLowerCase();}).indexOf(curr);
      var next=palette[(idx+1)%palette.length];
      this.style.background=next;
      this.dataset.colore=next;
    });
  }
  if(delBtn){
    delBtn.addEventListener('click',function(){window._postRowToDelete=row;apri('mpostDel');});
  }
  return row;
}

function salvaPostazioni(){
  var wrap=document.getElementById('postListWrap');if(!wrap)return;
  var rows=Array.prototype.slice.call(wrap.querySelectorAll('.post-row'));
  var dati=[],ok=true,nomi={};
  rows.forEach(function(row){
    if(!ok)return;
    var nomeEl=row.querySelector('.post-edit-nome');
    var comuniEl=row.querySelector('.post-edit-comuni');
    var colorEl=row.querySelector('.post-color-badge');
    var originalNome=sanitizeText((row.dataset.originalNome||'').trim().toUpperCase());
    var nome=sanitizeText((nomeEl?nomeEl.value:'').trim().toUpperCase());
    var comuniRaw=sanitizeText((comuniEl?comuniEl.value:'').trim());
    var colore=colorEl?(colorEl.dataset.colore||''):'';
    if(!nome){ok=false;fb(false,'Attenzione','Il nome della postazione è obbligatorio.');if(nomeEl)nomeEl.focus();return;}
    if(nomi[nome]){ok=false;fb(false,'Attenzione','Ci sono due postazioni con lo stesso nome: '+nome+'.');if(nomeEl)nomeEl.focus();return;}
    nomi[nome]=true;
    dati.push({originalNome:originalNome,nome:nome,comuni:comuniRaw,colore:colore});
  });
  if(!ok)return;

  var btn=document.getElementById('btnPostSave');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spin"></div> Salvataggio…';}

  doSalvaPostazioni(dati).then(function(r){
    if(btn){
      btn.disabled=false;
      btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Salva postazioni';
    }
    if(r&&r.success){
      mpostErrHide();
      chiudi('mpost');
      fb(true,'Salvate',r.message||'Postazioni aggiornate.');
      invalidatePostCache();
      loadPost();loadRows(1);
    } else {
      mpostErrShow(r&&r.message?r.message:'Errore durante il salvataggio.');
    }
  }).catch(function(){
    if(btn){btn.disabled=false;btn.innerHTML='Salva postazioni';}
    fb(false,'Errore','Server non raggiungibile.');
  });
}

function doSalvaPostazioni(dati){
  var oldMap={};
  POST.forEach(function(p){oldMap[p.nome.toUpperCase()]=p;});

  var puliti=[],nomiNuovi={},renameMap={};
  for(var i=0;i<dati.length;i++){
    var r=dati[i];
    var originalNome=sanitizeText(r.originalNome||'').toUpperCase().trim();
    var nome=sanitizeText(r.nome||'').toUpperCase().trim();
    var comuni=sanitizeText(r.comuni||'').trim();
    var colore=sanitizeText(r.colore||'').trim()||'#2e7d5e';
    if(!nome)return Promise.resolve({success:false,message:'Nome obbligatorio.'});
    if(nomiNuovi[nome])return Promise.resolve({success:false,message:'Nome duplicato: "'+nome+'".'});
    nomiNuovi[nome]=true;
    if(originalNome&&originalNome!==nome)renameMap[originalNome]=nome;
    var existing=oldMap[originalNome]||oldMap[nome];
    puliti.push({id:existing?existing.id:null,nome:nome,comuni:comuni,colore:colore});
  }

  var trulyDeleted=Object.keys(oldMap).filter(function(n){return !nomiNuovi[n]&&!renameMap[n];});

  // STEP 1 — verifica postazioni eliminate non in uso (parallelo, solo chiamate non soft-deleted)
  return Promise.all(trulyDeleted.map(function(nome){
    return sbFetch('chiamate?postazione=eq.'+encodeURIComponent(nome)+'&deleted_at=is.null&select=id&limit=1')
      .then(function(res){return res.json();})
      .then(function(data){
        if(data.length>0)throw new Error('Non puoi eliminare "'+nome+'": usata in chiamate.');
      });
  })).then(function(){
    // STEP 2 — rinomina + elimina + upsert TUTTI in parallelo
    if(Object.keys(renameMap).length>0||trulyDeleted.length>0)markOwnWrite();
    var ops=[];
    Object.keys(renameMap).forEach(function(oldN){
      ops.push(sbFetch('chiamate?postazione=eq.'+encodeURIComponent(oldN),{
        method:'PATCH',body:{postazione:renameMap[oldN]},prefer:'return=minimal'
      }));
    });
    trulyDeleted.forEach(function(nome){
      var p=oldMap[nome];
      if(p)ops.push(sbFetch('postazioni?id=eq.'+p.id,{method:'DELETE'}));
    });
    puliti.forEach(function(pu){
      if(pu.id){
        ops.push(sbFetch('postazioni?id=eq.'+pu.id,{
          method:'PATCH',body:{nome:pu.nome,comuni:pu.comuni,colore:pu.colore},prefer:'return=minimal'
        }));
      } else {
        ops.push(sbFetch('postazioni',{
          method:'POST',body:{nome:pu.nome,comuni:pu.comuni,colore:pu.colore},prefer:'return=minimal'
        }));
      }
    });
    return Promise.all(ops);
  }).then(function(){
    var lastPost=localStorage.getItem('lastPostazione')||'';
    if(lastPost){
      var lastUp=lastPost.toUpperCase();
      if(renameMap[lastUp])localStorage.setItem('lastPostazione',renameMap[lastUp]);
      else if(!nomiNuovi[lastUp])localStorage.removeItem('lastPostazione');
    }
    return {success:true,message:puliti.length+' postazioni salvate correttamente.'};
  }).catch(function(e){
    return {success:false,message:e.message||'Errore.'};
  });
}

function confermaEliminaPostazione(){
  chiudi('mpostDel');
  var row=window._postRowToDelete;window._postRowToDelete=null;
  if(!row)return;
  row.remove();
  fb(true,'Eliminata','La postazione verrà rimossa al prossimo salvataggio.');
}

function escAttr(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


// ═══════════════════════════════════════════════════════════════════
// MODAL CLICK OVERLAY
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('click',function(e){
  if(e.target===document.getElementById('mfb'))chiudi('mfb');
  if(e.target===document.getElementById('mcnf'))chiudi('mcnf');
  if(e.target===document.getElementById('munsav1'))chiudi('munsav1');
  if(e.target===document.getElementById('munsavN'))chiudi('munsavN');
  if(e.target===document.getElementById('mdel'))chiudi('mdel');
  if(e.target===document.getElementById('mpost'))chiudi('mpost');
  if(e.target===document.getElementById('mpostDel'))chiudi('mpostDel');
  if(e.target===document.getElementById('mphone')){closePhoneModal();}
  if(e.target===document.getElementById('maddr')){closeAddrModal();}
  if(e.target===document.getElementById('mtrash'))chiudi('mtrash');
  if(e.target===document.getElementById('mtrashEmpty'))chiudi('mtrashEmpty');
  if(e.target===document.getElementById('mexport'))chiudi('mexport');
  if(e.target===document.getElementById('madmin'))chiudi('madmin');
  if(e.target===document.getElementById('madminAdd'))chiudi('madminAdd');
  if(e.target===document.getElementById('madminDel')){chiudi('madminDel');adminUserToDelete=null;}
  if(e.target===document.getElementById('mgira'))closeGiraModal();
  if(e.target===document.getElementById('mgiraConf')){chiudi('mgiraConf');pendingGiraToUser=null;}
});


// ═══════════════════════════════════════════════════════════════════
// FEEDBACK / COLORI / HIGHLIGHT
// ═══════════════════════════════════════════════════════════════════

function fb(ok,tit,msg){
  var ic=document.getElementById('mfbic'),pb=document.getElementById('mpbi');
  ic.className='mic '+(ok?'ok':'er');
  ic.innerHTML=ok?'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  document.getElementById('mfbt').textContent=tit;
  document.getElementById('mfbm').textContent=msg;
  pb.style.transition='none';pb.style.width='100%';
  apri('mfb');
  requestAnimationFrame(function(){requestAnimationFrame(function(){pb.style.transition='width 2200ms linear';pb.style.width='0%';});});
  setTimeout(function(){chiudi('mfb');},2200);
}

function getColor(nome){
  var p=POST.find(function(x){return x.nome===nome;});
  return p?(p.colore||'#2e7d5e'):'#2e7d5e';
}

function highlight(text,query){
  if(!query)return esc(text);
  var escaped=esc(text);
  var words=query.trim().split(/\s+/).filter(Boolean);
  words.forEach(function(w){
    var re=new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
    escaped=escaped.replace(re,'<mark>$1</mark>');
  });
  return escaped;
}


// ═══════════════════════════════════════════════════════════════════
// DATE / TIME
// ═══════════════════════════════════════════════════════════════════

function autoformatDate(raw){
  var s=raw.replace(/\D/g,'');
  if(s.length===6)s=s.slice(0,2)+s.slice(2,4)+'20'+s.slice(4,6);
  if(s.length===8)return s.slice(0,2)+'/'+s.slice(2,4)+'/'+s.slice(4,8);
  return null;
}

function autoformatTime(raw){
  var s=raw.replace(/\D/g,'');
  if(s.length===3)s='0'+s;
  if(s.length===4)return s.slice(0,2)+':'+s.slice(2,4);
  return null;
}

function isValidDate(s){
  var m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)return false;
  var d=parseInt(m[1],10),mo=parseInt(m[2],10),y=parseInt(m[3],10);
  if(mo<1||mo>12)return false;
  return d>=1&&d<=new Date(y,mo,0).getDate();
}

function isValidTime(s){
  var m=s.match(/^(\d{2}):(\d{2})$/);
  if(!m)return false;
  return parseInt(m[1],10)<24&&parseInt(m[2],10)<60;
}

function setFieldError(el,hasError){
  el.style.boxShadow=hasError?'0 0 0 2px var(--er)':'';
  el.style.background=hasError?'var(--erbg)':'';
}

function validateDateTimeFields(tr){
  var dateEl=tr.querySelector('.dt-date');
  var timeEl=tr.querySelector('.dt-time');
  var dv=dateEl?(dateEl.innerText||'').trim():'';
  var tv=timeEl?(timeEl.innerText||'').trim():'';
  if(dv&&!tv){
    var orig=(tr.dataset.originalTs||'').trim().split(/\s+/);
    tv=orig[1]||'00:00';if(timeEl)timeEl.innerText=tv;
  }
  var dok=isValidDate(dv),tok=isValidTime(tv);
  if(dateEl)setFieldError(dateEl,!dok);
  if(timeEl)setFieldError(timeEl,!tok);
  if(!dok||!tok){fb(false,'Formato non valido','Correggi data ('+dv+') o ora ('+tv+'). Formato atteso: GG/MM/AAAA e HH:MM');return false;}
  return true;
}


// ═══════════════════════════════════════════════════════════════════
// SVG HELPERS
// ═══════════════════════════════════════════════════════════════════

function svgSave(){return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';}
function svgFloppy(){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';}
function svgHourglass(){return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>';}
function svgSearch(){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';}
function svgTrash(){return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ───────────────────────────────────────────────────────────
// EXPORT: CSV / Excel (XLSX, lazy) / PDF (via stampa nativa)
// ───────────────────────────────────────────────────────────
function dateStamp(){
  var d=new Date();
  var p=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());
}

function downloadFile(content,filename,mime){
  var blob=content instanceof Blob?content:new Blob([content],{type:mime});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

function loadScriptOnce(src){
  return new Promise(function(resolve,reject){
    if(document.querySelector('script[src="'+src+'"]')){resolve();return;}
    var s=document.createElement('script');
    s.src=src;s.async=true;
    s.onload=function(){resolve();};
    s.onerror=function(){reject(new Error('Load failed: '+src));};
    document.head.appendChild(s);
  });
}

function fetchAllForExport(filters){
  var batchSize=1000;
  var offset=0;
  var all=[];
  function fetchBatch(){
    var params='chiamate?select=*&deleted_at=is.null';
    if(filters.dateFrom){
      var df=new Date(filters.dateFrom);df.setHours(0,0,0,0);
      params+='&timestamp_chiamata=gte.'+df.toISOString();
    }
    if(filters.dateTo){
      var dt=new Date(filters.dateTo);dt.setHours(23,59,59,999);
      params+='&timestamp_chiamata=lte.'+dt.toISOString();
    }
    if(filters.postazione){
      params+='&postazione=eq.'+encodeURIComponent(filters.postazione);
    }
    params+='&order=timestamp_chiamata.desc&limit='+batchSize+'&offset='+offset;
    return sbFetch(params).then(function(res){return res.json();}).then(function(data){
      all=all.concat(data);
      if(data.length===batchSize){offset+=batchSize;return fetchBatch();}
      return all;
    });
  }
  return fetchBatch();
}

function exportCSV(records){
  var sep=';'; // separatore standard per Excel italiano
  var header=['ID','Data/Ora','Postazione','Descrizione','Note','Stato'].join(sep);
  var quote=function(s){return '"'+String(s==null?'':s).replace(/"/g,'""').replace(/\r\n/g,'\n').replace(/\r/g,'\n')+'"';};
  var rows=records.map(function(r){
    return [
      r.id,
      formatTSFromISO(r.timestamp_chiamata),
      r.postazione||'',
      r.descrizione||'',
      r.note||'',
      r.completato?'Completata':'In attesa'
    ].map(quote).join(sep);
  });
  // BOM ﻿ per UTF-8 corretto in Excel
  var csv='﻿'+header+'\r\n'+rows.join('\r\n');
  downloadFile(csv,'chiamate_'+dateStamp()+'.csv','text/csv;charset=utf-8;');
}

function exportXLSX(records){
  return loadScriptOnce('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js').then(function(){
    if(!window.XLSX)throw new Error('XLSX non caricato');
    var data=[['ID','Data/Ora','Postazione','Descrizione','Note','Stato']];
    records.forEach(function(r){
      data.push([
        r.id,
        formatTSFromISO(r.timestamp_chiamata),
        r.postazione||'',
        r.descrizione||'',
        r.note||'',
        r.completato?'Completata':'In attesa'
      ]);
    });
    var ws=window.XLSX.utils.aoa_to_sheet(data);
    ws['!cols']=[{wch:6},{wch:18},{wch:14},{wch:60},{wch:40},{wch:12}];
    // Freeze prima riga
    ws['!freeze']={ySplit:1};
    var wb=window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb,ws,'Chiamate');
    window.XLSX.writeFile(wb,'chiamate_'+dateStamp()+'.xlsx');
  });
}

function exportPDF(records){
  // Approccio: nuova finestra con HTML formattato, l'utente sceglie "Salva come PDF" dal dialog di stampa.
  // Niente librerie, supporto UTF-8 perfetto, output professionale.
  var html=
    '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Registro Chiamate · '+dateStamp()+'</title>'
    +'<style>'
    +'@page{size:A4 landscape;margin:12mm}'
    +'*{box-sizing:border-box}'
    +'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:#222;padding:8px;font-size:11px;line-height:1.4}'
    +'h1{color:#2e7d5e;margin:0 0 4px;font-size:18px}'
    +'.meta{color:#666;font-size:10px;margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap}'
    +'.meta b{color:#222}'
    +'table{width:100%;border-collapse:collapse;font-size:9.5px}'
    +'thead{background:#2e7d5e;color:#fff}'
    +'thead tr{break-inside:avoid}'
    +'th{padding:6px 8px;text-align:left;font-weight:600;font-size:10px;letter-spacing:.3px;text-transform:uppercase}'
    +'td{padding:5px 8px;border-bottom:1px solid #e3e0d2;vertical-align:top;white-space:pre-wrap;word-break:break-word}'
    +'tbody tr:nth-child(even){background:#f8f6ee}'
    +'tbody tr.done td{color:#5a5a5a}'
    +'tr{break-inside:avoid;page-break-inside:avoid}'
    +'.num{font-variant-numeric:tabular-nums}'
    +'.tag{display:inline-block;padding:1px 8px;border-radius:99px;background:#e0ebe5;color:#2e7d5e;font-size:9px;font-weight:600}'
    +'.st-ok{color:#2e7d5e;font-weight:600}'
    +'.st-pend{color:#b07a00;font-weight:600}'
    +'.foot{margin-top:14px;font-size:9px;color:#999;text-align:right}'
    +'@media print{body{padding:0}thead{display:table-header-group}}'
    +'</style></head><body>';
  html+='<h1>Registro Chiamate Guardia Medica</h1>';
  html+='<div class="meta">'
    +'<span><b>Esportato il</b> '+esc(new Date().toLocaleString('it-IT'))+'</span>'
    +'<span><b>Totale</b> '+records.length+' chiamat'+(records.length===1?'a':'e')+'</span>'
    +'</div>';
  html+='<table><thead><tr>'
    +'<th style="width:30px">#</th>'
    +'<th style="width:90px">Data / Ora</th>'
    +'<th style="width:80px">Postazione</th>'
    +'<th>Descrizione</th>'
    +'<th style="width:30%">Note</th>'
    +'<th style="width:60px">Stato</th>'
    +'</tr></thead><tbody>';
  records.forEach(function(r){
    var stCls=r.completato?'st-ok':'st-pend';
    var stTxt=r.completato?'✓ Completata':'⏳ In attesa';
    html+='<tr'+(r.completato?' class="done"':'')+'>'
      +'<td class="num">'+r.id+'</td>'
      +'<td class="num">'+esc(formatTSFromISO(r.timestamp_chiamata))+'</td>'
      +'<td><span class="tag">'+esc(r.postazione||'—')+'</span></td>'
      +'<td>'+esc(r.descrizione||'')+'</td>'
      +'<td>'+esc(r.note||'')+'</td>'
      +'<td class="'+stCls+'">'+stTxt+'</td>'
      +'</tr>';
  });
  html+='</tbody></table>';
  html+='<div class="foot">Generato da Guardia Medica · '+window.location.host+'</div>';
  html+='</body></html>';

  var w=window.open('','_blank');
  if(!w){alert('Il browser ha bloccato la finestra di stampa. Abilita i popup per questo sito.');return Promise.reject();}
  w.document.write(html);
  w.document.close();
  // Attendi il rendering, poi chiama print
  return new Promise(function(resolve){
    w.onload=function(){
      setTimeout(function(){
        try{w.focus();w.print();}catch(e){}
        resolve();
      },200);
    };
    // Fallback se onload non scatta (pagine già caricate)
    setTimeout(function(){try{w.focus();w.print();}catch(e){}resolve();},800);
  });
}

function openExportModal(){
  // Pre-popola data range se c'è un filtro attivo
  var df=document.getElementById('exportDateFrom');
  var dt=document.getElementById('exportDateTo');
  var ep=document.getElementById('exportPost');
  if(df)df.value=(currentFilters&&currentFilters.dateFrom)||'';
  if(dt)dt.value=(currentFilters&&currentFilters.dateTo)||'';
  // Popola dropdown postazioni
  if(ep){
    ep.innerHTML='<option value="">Tutte le postazioni</option>';
    POST.forEach(function(p){
      var o=document.createElement('option');o.value=p.nome;o.textContent=p.nome;ep.appendChild(o);
    });
    ep.value=(currentFilters&&currentFilters.postazione)||'';
  }
  var info=document.getElementById('exportInfo');
  if(info){info.style.display='none';info.textContent='';}
  apri('mexport');
}

function runExport(){
  var dateFrom=document.getElementById('exportDateFrom').value;
  var dateTo=document.getElementById('exportDateTo').value;
  var post=document.getElementById('exportPost').value;
  var fmt=document.querySelector('input[name="exportFmt"]:checked').value;
  var btn=document.getElementById('btnExportGo');
  var info=document.getElementById('exportInfo');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spin"></div> Caricamento dati…';}
  if(info){info.style.display='block';info.textContent='Recupero le chiamate…';}

  fetchAllForExport({dateFrom:dateFrom,dateTo:dateTo,postazione:post}).then(function(records){
    if(info)info.textContent=records.length+' chiamat'+(records.length===1?'a trovata':'e trovate')+'. Generazione '+fmt.toUpperCase()+'…';
    if(records.length===0){
      if(btn){btn.disabled=false;btn.innerHTML=svgExport()+' Esporta';}
      fb(false,'Nessun dato','Nessuna chiamata trovata con questi filtri.');
      if(info){info.style.display='none';}
      return;
    }
    var p;
    if(fmt==='csv'){exportCSV(records);p=Promise.resolve();}
    else if(fmt==='xlsx')p=exportXLSX(records);
    else if(fmt==='pdf')p=exportPDF(records);
    else p=Promise.reject(new Error('Formato sconosciuto'));

    p.then(function(){
      if(btn){btn.disabled=false;btn.innerHTML=svgExport()+' Esporta';}
      chiudi('mexport');
      fb(true,'Esportate',records.length+' chiamat'+(records.length===1?'a esportata':'e esportate')+' in formato '+fmt.toUpperCase()+'.');
    }).catch(function(e){
      if(btn){btn.disabled=false;btn.innerHTML=svgExport()+' Esporta';}
      if(info){info.style.display='none';}
      fb(false,'Errore export',e&&e.message?e.message:'Esportazione fallita.');
    });
  }).catch(function(){
    if(btn){btn.disabled=false;btn.innerHTML=svgExport()+' Esporta';}
    if(info){info.style.display='none';}
    fb(false,'Errore','Impossibile scaricare i dati. Controlla la connessione.');
  });
}

function svgExport(){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';}

// Copia testo negli appunti: usa Clipboard API moderna, fallback su execCommand per browser legacy/contesti non-secure
function copyToClipboard(text){
  if(navigator.clipboard && window.isSecureContext){
    return navigator.clipboard.writeText(String(text)).then(function(){return true;}).catch(function(){return fallbackCopy(text);});
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text){
  try{
    var ta=document.createElement('textarea');
    ta.value=String(text);
    ta.style.cssText='position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok=false;
    try{ok=document.execCommand('copy');}catch(_){ok=false;}
    document.body.removeChild(ta);
    return ok;
  }catch(_){return false;}
}

// ───────────────────────────────────────────────────────────
// CLICK-TO-CALL: trasforma numeri di telefono in link
// Pattern italiano stretto:
//   - Mobile: 3xx + 7 cifre (10 totali), un solo separatore opzionale tra i due gruppi
//   - Fisso : 0xx + 6-8 cifre, un solo separatore opzionale
//   - Prefisso +39 opzionale, separato solo da spazio/tab/punto/trattino
// Newline (\n) NON è separatore: spezza il match → un numero a cavallo di righe
// non viene riconosciuto. (?<!\d) e (?!\d) impediscono di fondere CAP+telefono.
// Separatore interno: SOLO uno tra spazio orizzontale, tab, punto, trattino, slash
// (non virgole, non newline, non più di uno tra i due gruppi).
// ───────────────────────────────────────────────────────────
function linkifyPhones(html){
  // SEP = un solo separatore "in linea" (no \n) o niente
  // Mobile: 3 + 2 cifre + (SEP)? + 7 cifre
  // Fisso : 0 + 1-3 cifre + (SEP)? + 6-8 cifre
  var re = /(?<!\d)(?:\+?39[ \t.\-]?)?(?:3\d{2}[ \t.\-\/]?\d{7}|0\d{1,3}[ \t.\-\/]?\d{6,8})(?!\d)/g;
  return html.replace(re, function(match){
    var digits = match.replace(/\D/g,'');
    // Validazione semantica:
    //   Mobile: 10 cifre (3xxxxxxxxx) o 12 con prefisso 39
    //   Fisso : 8-11 cifre (0xx...) o 10-13 con prefisso 39
    var isMobile = /^(?:39)?3\d{9}$/.test(digits);
    var isFisso  = /^(?:39)?0\d{7,10}$/.test(digits);
    if(!isMobile && !isFisso) return match;
    return '<span class="ph-link" contenteditable="false" data-phone="'+digits+'" title="Tocca per chiamare">'+match+'</span>';
  });
}

function fmtPhoneDisplay(digits){
  if(digits.length===10)return digits.substring(0,3)+' '+digits.substring(3,6)+' '+digits.substring(6);
  if(digits.length===12&&digits.indexOf('39')===0)return '+39 '+digits.substring(2,5)+' '+digits.substring(5,8)+' '+digits.substring(8);
  return digits;
}

var phoneModalNumber='';     // cifre correnti (per dialing)
var phoneModalSpan=null;     // span .ph-link cliccato
var phoneEditMode=false;

// ───────────────────────────────────────────────────────────
// CLICK-TO-MAP: trasforma indirizzi italiani in link
// Lista completa toponomastica italiana (Treccani + Wikipedia)
// ───────────────────────────────────────────────────────────
var ADDR_TOPONIMI = '(?:via|viale|v\\.?le|vl\\.?|piazza|p\\.?zza|p\\.?za|pza|piazzale|p\\.?le|p\\.?zle|piazzetta|corso|c\\.?so|cso|largo|l\\.?go|lgo|vicolo|v\\.?lo|vlo|vicoletto|vico|salita|sal\\.?|strada|str\\.?|s\\.?da|stradella|stradello|stradina|traversa|trav\\.?|loc\\.?|localit[aà]|loc\\.?t[aà]|lungomare|lungolago|lungoargine|lungofiume|lungo(?=tevere|po|adige)|circonvallazione|circ\\.?ne|circondario|contrada|c\\.?da|contr[aà]|chiasso|campiello|calle|campo|carraia|carrarone|frazione|fraz\\.?|giardino|maso|parallela|passeggiata|pass\\.?ta|rotonda|vietta|viottolo|viuzza|viuzzo|discesa|disc\\.?|diga|borgo|borg\\.?|rione|prato|prati|riviera|spianata|terrazza|via\\.?le|cosentina|panoramica)';

// Stop words: parole che indicano "non è città/frazione, è descrizione medica"
// Se compaiono come prima parola dopo virgola in minuscolo → tronca
var ADDR_STOP_WORDS = /^(?:paziente|pazienti|paz|anzian[oaie]|cosciente|incosciente|bambin[oaie]|figli[oaie]|signor[ae]?|signora|problema|problemi|richiesta|richiede|prescrizione|prescriv[ei]|prescritt[oa]|ricetta|ricette|recente|visita|visit[ei]|febbre|febbrile|dolore|dolori|nausea|sintom[oi]|crisi|accesso|consulenz[ae]|terapia|terapie|farmac[oi]|emergenz[ae]|urgenz[ae]|ricontatt[ai]|richiam[ai]|ricovero|ospedale|118|cf|tel|cellulare|cell|email|mail|np|prognosi|allerg[ie]|sospett[oa]|tampon[ei]|prelievo|esami|esame|certificato|cert|continuazione|terapista|fisioterap|infermier[ei]|caregiver|badante|trattamento|farmaco)\b/i;

// Determina dove finisce l'indirizzo nel match. Logica:
//   - Cifra dopo virgola (civico/CAP) → include
//   - Maiuscola dopo virgola (città capitalizzata) → include
//   - Minuscola dopo virgola → include MA SOLO se NON è stop word medica
//     e il chunk post-virgola è breve (≤30 chars, ≤3 parole)
//   - Tronca prima di parole rumore (interno, scala, ...) o fine frase (". X")
function computeAddressEnd(text){
  var len=text.length, idx=0;
  while(true){
    var c=text.indexOf(',', idx);
    if(c===-1){idx=len;break;}
    var after=text.substring(c+1).replace(/^\s+/,'');
    if(!after){idx=c;break;}
    var fc=after.charAt(0);
    if(/[\dA-ZÀ-Ü]/.test(fc)){
      idx=c+1;
    } else if(/[a-zà-ÿ]/.test(fc)){
      // Minuscola: includi SOLO se non sembra descrizione medica
      var firstWord=after.match(/^[\wà-ÿ]+/);
      var chunk=after.match(/^[^,;\n]*/)[0];
      if(firstWord && !ADDR_STOP_WORDS.test(firstWord[0]) && chunk.length<=30){
        var words=chunk.trim().split(/\s+/);
        if(words.length<=3){idx=c+1;continue;}
      }
      idx=c;break;
    } else {
      idx=c;break;
    }
  }
  // Tronca a parole rumore post-indirizzo (interno, scala, ecc.)
  var noiseRe=/\s+(?:int(?:erno|\.)?|sc(?:ala|\.)?|pal(?:azzo|\.)?|piano|edif(?:icio|\.)?|cit(?:ofono|\.)?|civ(?:ico|\.)?|tel(?:efono|\.)?|ingresso|portone|cell(?:ulare|\.)?|presso|c\/o)\b/i;
  var noise=text.substring(0,idx).match(noiseRe);
  if(noise&&noise.index>5)idx=noise.index;
  // Tronca a fine frase (". X" con X maiuscola)
  var sub=text.substring(0,idx);
  var sent=sub.search(/\.\s+[A-ZÀ-Ü]/);
  if(sent>5)idx=sent;
  return idx;
}

function linkifyAddresses(html){
  // Match generoso: include virgole; il parser computeAddressEnd taglia dopo
  var re=new RegExp('\\b'+ADDR_TOPONIMI+'\\.?[\\s.]+\\w[^;\\n<]{0,200}', 'gi');
  return html.replace(re,function(match){
    var stopIdx=computeAddressEnd(match);
    var clean=match.substring(0,stopIdx).replace(/[\s.]+$/,'').trim();
    if(clean.length<6)return match;
    var rest=match.substring(clean.length);
    var query=clean.replace(/"/g,'&quot;');
    return '<span class="addr-link" contenteditable="false" data-addr="'+query+'" title="Tocca per aprire mappa">'+clean+'</span>'+rest;
  });
}


// ═══════════════════════════════════════════════════════════════════
// GIRA CHIAMATA: forward call to a colleague
// - SELECT su girate (RLS: vedo solo le mie, in entrambe le direzioni)
// - Mutazioni via RPC SECURITY DEFINER (gira/accetta/rifiuta/annulla)
// - Realtime su INSERT/UPDATE girate filtrato per to_user_id e from_user_id
// - Audio + vibrazione su nuova richiesta in arrivo (non al boot)
// ═══════════════════════════════════════════════════════════════════

var pendingGirate = { incoming: [], outgoing: [], decided: [] };
// decided[]: girate concluse non ancora "ack" dall'utente.
// Persistono in DB (acknowledged_at IS NULL) finché l'utente clicca OK.
var colleghiCache = null;
var girateChannel1 = null, girateChannel2 = null;
var girateInitialLoadDone = false; // dopo il boot iniziale, gli INSERT triggerano audio
var pendingGiraCallId = null;       // chiamata selezionata in attesa di scelta collega
var pendingGiraToUser = null;       // collega selezionato in attesa di conferma
var giratePollFallbackTimer = null; // polling 60s di fallback se realtime fallisce

function setupGirate(){
  // Dopo login: carica girate pending, attiva realtime, polling fallback
  fetchPendingGirate().then(function(){
    girateInitialLoadDone = true;
  });
  setupGirateRealtime();
  // Polling fallback ogni 60s (se realtime cade silenziosamente, l'UI si auto-corregge)
  if(giratePollFallbackTimer) clearInterval(giratePollFallbackTimer);
  giratePollFallbackTimer = setInterval(function(){
    if(document.hidden) return; // non sprecare richieste in background
    fetchPendingGirate();
  }, 60000);
  // Refresh immediato al ritorno sul tab (caso: realtime perso in background)
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) return;
    fetchPendingGirate();
  });
}

function fetchPendingGirate(){
  if(!currentUser || !currentUser.id) return Promise.resolve();
  // Carica TUTTE le girate in cui sono coinvolto e che non sono ancora "ack":
  //  - status=pending (banner pending)
  //  - status=rejected/accepted/cancelled con acknowledged_at IS NULL (banner decided)
  // RLS filtra automaticamente: vedo solo from_user=me o to_user=me
  var url = 'girate?select=*&acknowledged_at=is.null&order=created_at.desc';
  return sbFetch(url).then(function(res){return res.json();}).then(function(data){
    if(!Array.isArray(data)){
      pendingGirate = {incoming:[], outgoing:[], decided:[]};
      renderGirateBanner();
      return;
    }
    var inc = [], out = [], dec = [];
    var meId = currentUser.id;
    data.forEach(function(g){
      if(g.status === 'pending'){
        if(g.to_user_id === meId) inc.push(g);
        else if(g.from_user_id === meId) out.push(g);
      } else if(g.status === 'rejected' || g.status === 'accepted'){
        // Notifica al MITTENTE: il collega ha deciso sulla mia girata
        if(g.from_user_id === meId){
          dec.push({ girata:g, kind:g.status, direction:'outgoing' });
        }
      } else if(g.status === 'cancelled'){
        // Notifica al DESTINATARIO: il mittente ha annullato la richiesta
        if(g.to_user_id === meId){
          dec.push({ girata:g, kind:'cancelled', direction:'incoming' });
        }
      }
    });
    pendingGirate.incoming = inc;
    pendingGirate.outgoing = out;
    pendingGirate.decided = dec;
    renderGirateBanner();
  }).catch(function(){
    // Non azzero in caso di errore di rete: meglio mostrare stato stale che vuoto
    renderGirateBanner();
  });
}

// Ack di una girata "decisa" — chiama RPC + rimuove localmente + re-render
function ackGirata(girataId, btnEl){
  if(btnEl){ btnEl.disabled = true; btnEl.innerHTML = '<div class="spin-dark"></div>'; }
  getSupabaseClient().then(function(client){
    return client.rpc('ack_girata', { p_girata_id: girataId });
  }).then(function(res){
    if(res.error){
      if(btnEl){ btnEl.disabled = false; btnEl.innerHTML = 'OK'; }
      // Anche su errore, refresh per allineare UI
      fetchPendingGirate();
      return;
    }
    // Rimuovi subito localmente (UX reattiva)
    pendingGirate.decided = (pendingGirate.decided||[]).filter(function(d){return d.girata.id !== girataId;});
    renderGirateBanner();
  }).catch(function(){
    if(btnEl){ btnEl.disabled = false; btnEl.innerHTML = 'OK'; }
    fetchPendingGirate();
  });
}

function renderGirateBanner(){
  var b = document.getElementById('girateBanner');
  if(!b) return;
  var inc = pendingGirate.incoming || [];
  var out = pendingGirate.outgoing || [];
  var dec = pendingGirate.decided || [];

  if(!inc.length && !out.length && !dec.length){ b.style.display='none'; b.innerHTML=''; return; }
  var html = '';

  // Sezione "decisi" — persistente fino ad ack utente
  if(dec.length){
    html += '<div class="girate-banner-section">';
    dec.forEach(function(d){
      var g = d.girata;
      var kind = d.kind; // rejected | cancelled | accepted
      var direction = d.direction; // outgoing | incoming
      var icon, msg, who, cardClass, sectionTitle;
      if(direction === 'outgoing' && kind === 'rejected'){
        icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        sectionTitle = 'Chiamata rifiutata';
        who = (g.to_user_nome||'Il collega');
        msg = '<b>'+esc(who)+'</b> ha rifiutato la chiamata';
        cardClass = 'rejected';
      } else if(direction === 'outgoing' && kind === 'accepted'){
        icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        sectionTitle = 'Chiamata accettata';
        who = (g.to_user_nome||'Il collega');
        msg = '<b>'+esc(who)+'</b> ha accettato la chiamata';
        cardClass = 'accepted';
      } else if(direction === 'incoming' && kind === 'cancelled'){
        icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
        sectionTitle = 'Richiesta annullata';
        who = (g.from_user_nome||'Il mittente');
        msg = '<b>'+esc(who)+'</b> ha annullato la richiesta';
        cardClass = 'cancelled';
      } else {
        return; // skip: caso non rilevante per UX
      }
      var when = formatTSFromISO(g.snapshot_ts) || '';
      var post = esc(g.snapshot_postazione || '—');
      var decidedAt = formatTSFromISO(g.decided_at) || '';
      var desc = esc((g.snapshot_descrizione || '').substring(0,140))
               + ((g.snapshot_descrizione||'').length>140?'…':'');
      html += '<div class="girate-card '+cardClass+'" data-decided-id="'+esc(g.id)+'">'
        + '<div class="girate-card-info">'
        +   '<div class="girate-decided-title">'+icon+' '+sectionTitle+'</div>'
        +   '<div class="girate-card-meta">'+msg+(decidedAt?' · '+esc(decidedAt):'')+'</div>'
        +   '<div class="girate-card-meta" style="font-weight:500">Chiamata del '+esc(when)+' · '+post+'</div>'
        +   '<div class="girate-card-desc">'+desc+'</div>'
        + '</div>'
        + '<div class="girate-card-actions">'
        +   '<button type="button" class="girate-btn ack" data-action="ack" data-id="'+esc(g.id)+'" title="Conferma di averlo letto">'
        +     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        +     'OK, letto'
        +   '</button>'
        + '</div>'
      + '</div>';
    });
    html += '</div>';
  }

  if(inc.length){
    html += '<div class="girate-banner-section">';
    html += '<div class="girate-banner-title">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
      + (inc.length===1?'1 chiamata in arrivo':inc.length+' chiamate in arrivo')
      + '</div>';
    inc.forEach(function(g){
      var when = formatTSFromISO(g.snapshot_ts) || '';
      var post = esc(g.snapshot_postazione || '—');
      var fromName = esc(g.from_user_nome || 'Collega');
      var sentAt = formatTSFromISO(g.created_at) || '';
      var desc = esc((g.snapshot_descrizione || '').substring(0,200))
               + ((g.snapshot_descrizione||'').length>200?'…':'');
      html += '<div class="girate-card">'
        + '<div class="girate-card-info">'
        +   '<div class="girate-card-meta">Da <b>'+fromName+'</b> · inviata '+esc(sentAt)+'</div>'
        +   '<div class="girate-card-meta" style="font-weight:500">Chiamata del '+esc(when)+' · '+post+'</div>'
        +   '<div class="girate-card-desc">'+desc+'</div>'
        + '</div>'
        + '<div class="girate-card-actions">'
        +   '<button type="button" class="girate-btn reject" data-action="reject" data-id="'+esc(g.id)+'">'
        +     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        +     'Rifiuta'
        +   '</button>'
        +   '<button type="button" class="girate-btn accept" data-action="accept" data-id="'+esc(g.id)+'">'
        +     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        +     'Accetta'
        +   '</button>'
        + '</div>'
      + '</div>';
    });
    html += '</div>';
  }

  if(out.length){
    html += '<div class="girate-banner-section">';
    html += '<div class="girate-banner-title">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
      + (out.length===1?'1 girata in attesa di accettazione':out.length+' girate in attesa di accettazione')
      + '</div>';
    out.forEach(function(g){
      var when = formatTSFromISO(g.snapshot_ts) || '';
      var post = esc(g.snapshot_postazione || '—');
      var toName = esc(g.to_user_nome || 'Collega');
      var sentAt = formatTSFromISO(g.created_at) || '';
      var desc = esc((g.snapshot_descrizione || '').substring(0,200))
               + ((g.snapshot_descrizione||'').length>200?'…':'');
      html += '<div class="girate-card">'
        + '<div class="girate-card-info">'
        +   '<div class="girate-card-meta">A <b>'+toName+'</b> · inviata '+esc(sentAt)+'</div>'
        +   '<div class="girate-card-meta" style="font-weight:500">Chiamata del '+esc(when)+' · '+post+'</div>'
        +   '<div class="girate-card-desc">'+desc+'</div>'
        + '</div>'
        + '<div class="girate-card-actions">'
        +   '<span class="girate-pending-tag">'
        +     '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
        +     'In attesa'
        +   '</span>'
        +   '<button type="button" class="girate-btn cancel" data-action="cancel" data-id="'+esc(g.id)+'">'
        +     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
        +     'Annulla invio'
        +   '</button>'
        + '</div>'
      + '</div>';
    });
    html += '</div>';
  }

  b.innerHTML = html;
  b.style.display = '';
}

function setupGirateRealtime(){
  if(!currentUser || !currentUser.id) return;
  getSupabaseClient().then(function(client){
    // Canale 1: incoming (to_user_id = me) — INSERT triggera audio
    girateChannel1 = client.channel('girate-incoming-'+currentUser.id)
      .on('postgres_changes', {
        event:'*', schema:'public', table:'girate',
        filter:'to_user_id=eq.'+currentUser.id
      }, function(payload){
        handleGirateRealtimeEvent(payload, 'incoming');
      })
      .subscribe();

    // Canale 2: outgoing (from_user_id = me) — UPDATE triggera refresh banner (accept/reject del collega)
    girateChannel2 = client.channel('girate-outgoing-'+currentUser.id)
      .on('postgres_changes', {
        event:'*', schema:'public', table:'girate',
        filter:'from_user_id=eq.'+currentUser.id
      }, function(payload){
        handleGirateRealtimeEvent(payload, 'outgoing');
      })
      .subscribe();
  }).catch(function(){/* niente realtime, ma fetchPendingGirate continuerà su poll? Per ora skip */});
}

function handleGirateRealtimeEvent(payload, direction){
  var ev = payload.eventType || payload.event;
  var newRow = payload.new || {};
  // Refresh il banner: fetchPendingGirate carica pending + decided non-ack,
  // quindi qualsiasi cambio di stato finisce nel banner finché l'utente non ack.
  fetchPendingGirate();

  // Audio + vibrazione SOLO per nuove richieste in arrivo (incoming INSERT pending)
  if(direction === 'incoming' && ev === 'INSERT' && newRow.status === 'pending' && girateInitialLoadDone){
    playGirataSound();
    vibrateGirata();
    fb(true, 'Nuova chiamata', 'Hai ricevuto una chiamata da '+(newRow.from_user_nome||'un collega'));
  }

  // Beep diverso (più breve/positivo) anche per accept/reject ricevuti dal mittente
  if(direction === 'outgoing' && ev === 'UPDATE' && girateInitialLoadDone &&
     (newRow.status === 'accepted' || newRow.status === 'rejected')){
    playGirataSound();
  }

  // Outgoing accettato dal collega → ricarica lista per mostrare il badge "Girata a X"
  if(direction === 'outgoing' && ev === 'UPDATE' && newRow.status === 'accepted'){
    loadRows(PAGE);
  }

  // Incoming accettato (da me, in altro device) → ricarica per vedere la nuova chiamata
  if(direction === 'incoming' && ev === 'UPDATE' && newRow.status === 'accepted'){
    loadRows(PAGE);
  }
}

function playGirataSound(){
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.18);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.36);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.start();osc.stop(ctx.currentTime + 0.6);
    setTimeout(function(){try{ctx.close();}catch(_){}}, 800);
  } catch(_){}
}

function vibrateGirata(){
  try{ if(navigator.vibrate) navigator.vibrate([180, 80, 180]); }catch(_){}
}

// Apre il modal selezione collega
function openGiraModal(callId, callPreviewText){
  pendingGiraCallId = callId;
  var prev = document.getElementById('giraCallPreview');
  if(prev) prev.textContent = callPreviewText || '';
  var list = document.getElementById('giraColleghiList');
  if(list) list.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spin" style="margin:0 auto;border-color:rgba(46,125,94,.25);border-top-color:var(--pr);width:24px;height:24px"></div></div>';
  apri('mgira');

  // Fresh fetch ad ogni apertura: la lista colleghi può cambiare (nuovi utenti,
  // primo accesso di un utente già in whitelist) e una cache lunga creerebbe confusione.
  var promise = getSupabaseClient().then(function(client){
    return client.rpc('list_colleghi');
  }).then(function(res){
    if(res.error) throw res.error;
    return res.data || [];
  });
  promise.then(function(colleghi){
    if(!colleghi || !colleghi.length){
      list.innerHTML = '<div class="emp" style="padding:2rem"><h3>Nessun collega disponibile</h3><p>Non ci sono altri utenti nella whitelist.</p></div>';
      return;
    }
    list.innerHTML = colleghi.map(function(c){
      var initial = (c.full_name||'?').charAt(0).toUpperCase();
      var hasAcc = c.has_account !== false; // se manca, default true (backward compat)
      var rowClass = 'collega-row' + (hasAcc ? '' : ' disabled');
      var title = hasAcc
        ? ''
        : 'L\'utente non ha ancora effettuato il primo accesso — non è possibile girargli chiamate finché non si autentica almeno una volta.';
      var subline = hasAcc
        ? ''
        : '<div class="collega-sub">Non ancora attivo</div>';
      var trailing = hasAcc
        ? '<svg class="collega-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
        : '<svg class="collega-lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      return '<div class="'+rowClass+'" data-uid="'+esc(c.user_id||'')+'" data-name="'+esc(c.full_name)+'" data-has-account="'+(hasAcc?'1':'0')+'" title="'+esc(title)+'">'
        + '<div class="collega-avatar">'+esc(initial)+'</div>'
        + '<div class="collega-name-wrap"><div class="collega-name">'+esc(c.full_name)+'</div>'+subline+'</div>'
        + trailing
      + '</div>';
    }).join('');
  }).catch(function(e){
    list.innerHTML = '<div class="emp" style="padding:2rem"><h3>Errore</h3><p>'+esc((e&&e.message)||'Impossibile caricare i colleghi.')+'</p></div>';
  });
}

function closeGiraModal(){
  chiudi('mgira');
  pendingGiraCallId = null;
}

// Click su un collega → apri conferma
function onCollegaClick(uid, name){
  pendingGiraToUser = { uid:uid, name:name };
  var msg = 'Sei sicuro di voler girare questa chiamata a <b>'+esc(name)+'</b>?<br><br>Riceverà una notifica e potrà accettare o rifiutare.';
  document.getElementById('mgiraConfMsg').innerHTML = msg;
  apri('mgiraConf');
}

function confirmGiraSend(){
  if(!pendingGiraCallId || !pendingGiraToUser){ chiudi('mgiraConf'); return; }
  var btn = document.getElementById('btnGiraConfOk');
  var origHtml = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<div class="spin"></div> Invio…';
  var callId = pendingGiraCallId;
  var to = pendingGiraToUser;
  getSupabaseClient().then(function(client){
    return client.rpc('gira_chiamata', { p_chiamata_id: callId, p_to_user_id: to.uid });
  }).then(function(res){
    btn.disabled = false; btn.innerHTML = origHtml;
    if(res.error){
      var m = res.error.message || '';
      if(m.indexOf('already_pending') !== -1){ fb(false,'Già girata','Questa chiamata ha già una girata in corso.'); }
      else if(m.indexOf('chiamata_completata') !== -1){ fb(false,'Completata','Non puoi girare una chiamata già completata.'); }
      else if(m.indexOf('not_owner') !== -1){ fb(false,'Errore','Non sei il proprietario di questa chiamata.'); }
      else if(m.indexOf('cannot_send_to_self') !== -1){ fb(false,'Errore','Non puoi girare a te stesso.'); }
      else if(m.indexOf('to_user_not_in_whitelist') !== -1){ fb(false,'Errore','Il destinatario non è in whitelist.'); }
      else fb(false, 'Errore', m || 'Invio fallito.');
      return;
    }
    chiudi('mgiraConf');
    chiudi('mgira');
    pendingGiraCallId = null; pendingGiraToUser = null;
    fb(true, 'Inviata', 'Chiamata girata a '+to.name+'. In attesa di accettazione.');
    fetchPendingGirate();
    loadRows(PAGE);
  }).catch(function(e){
    btn.disabled = false; btn.innerHTML = origHtml;
    fb(false,'Errore', (e&&e.message)||'Server non raggiungibile.');
  });
}

function acceptGirata(girataId, btnEl){
  if(btnEl){ btnEl.disabled = true; btnEl.innerHTML = '<div class="spin-dark"></div>'; }
  getSupabaseClient().then(function(client){
    return client.rpc('accetta_girata', { p_girata_id: girataId });
  }).then(function(res){
    if(res.error){
      if(btnEl){ btnEl.disabled = false; }
      var m = res.error.message || '';
      if(m.indexOf('already_decided') !== -1){ fb(false,'Già decisa','Questa girata è già stata gestita.'); fetchPendingGirate(); }
      else fb(false,'Errore', m || 'Accettazione fallita.');
      return;
    }
    fb(true, 'Accettata', 'Chiamata aggiunta al tuo elenco.');
    fetchPendingGirate();
    loadRows(PAGE);
  }).catch(function(e){
    if(btnEl){ btnEl.disabled = false; }
    fb(false,'Errore', (e&&e.message)||'Server non raggiungibile.');
  });
}

function rejectGirata(girataId, btnEl){
  // Trova il record in pendingGirate.incoming per dopo
  var found = (pendingGirate.incoming||[]).find(function(g){return g.id === girataId;});
  if(btnEl){ btnEl.disabled = true; btnEl.innerHTML = '<div class="spin-dark"></div>'; }
  getSupabaseClient().then(function(client){
    return client.rpc('rifiuta_girata', { p_girata_id: girataId });
  }).then(function(res){
    if(res.error){
      if(btnEl){ btnEl.disabled = false; }
      var m = res.error.message || '';
      if(m.indexOf('already_decided') !== -1){ fb(false,'Già decisa','Questa girata è già stata gestita.'); fetchPendingGirate(); }
      else fb(false,'Errore', m || 'Rifiuto fallito.');
      return;
    }
    fb(true, 'Rifiutata', 'Il mittente è stato avvisato.');
    fetchPendingGirate();
    // (Nessuna card "decided" lato destinatario: la girata sparisce semplicemente.)
  }).catch(function(e){
    if(btnEl){ btnEl.disabled = false; }
    fb(false,'Errore', (e&&e.message)||'Server non raggiungibile.');
  });
}

function cancelGirata(girataId, btnEl){
  if(btnEl){ btnEl.disabled = true; btnEl.innerHTML = '<div class="spin-dark"></div>'; }
  getSupabaseClient().then(function(client){
    return client.rpc('annulla_girata', { p_girata_id: girataId });
  }).then(function(res){
    if(res.error){
      if(btnEl){ btnEl.disabled = false; }
      var m = res.error.message || '';
      if(m.indexOf('too_late') !== -1){
        fb(false, 'Troppo tardi', 'Il collega ha già accettato la girata. Non puoi più annullare.');
        fetchPendingGirate(); loadRows(PAGE);
      } else fb(false,'Errore', m || 'Annullamento fallito.');
      return;
    }
    fb(true, 'Annullata', 'La richiesta di girata è stata annullata.');
    fetchPendingGirate();
    loadRows(PAGE);
  }).catch(function(e){
    if(btnEl){ btnEl.disabled = false; }
    fb(false,'Errore', (e&&e.message)||'Server non raggiungibile.');
  });
}

// SVG bottone Gira nelle azioni della riga
function svgGira(){
  // Aeroplanino di carta (Feather Icons "send")
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
}

// Setup wiring del banner girate (delegation)
function setupGirateBannerDelegation(){
  var b = document.getElementById('girateBanner');
  if(!b || b._delegated) return;
  b._delegated = true;
  b.addEventListener('click', function(e){
    var btn = e.target.closest('.girate-btn');
    if(!btn) return;
    var action = btn.dataset.action;
    var id = btn.dataset.id;
    if(!id) return;
    if(action === 'accept') acceptGirata(id, btn);
    else if(action === 'reject') rejectGirata(id, btn);
    else if(action === 'cancel') cancelGirata(id, btn);
    else if(action === 'ack') ackGirata(id, btn);
  });
}

// Setup wiring dei modali girate
function setupGirateModalsDelegation(){
  var lst = document.getElementById('giraColleghiList');
  if(lst && !lst._delegated){
    lst._delegated = true;
    lst.addEventListener('click', function(e){
      var row = e.target.closest('.collega-row');
      if(!row) return;
      if(row.dataset.hasAccount === '0' || row.classList.contains('disabled')){
        fb(false, 'Utente non attivo', (row.dataset.name||'Il collega')+' non ha ancora fatto il primo accesso. Non puoi girargli chiamate finché non si autentica almeno una volta.');
        return;
      }
      onCollegaClick(row.dataset.uid, row.dataset.name);
    });
  }
  var bClose = document.getElementById('btnGiraClose');
  if(bClose) bClose.addEventListener('click', closeGiraModal);
  var bCancel = document.getElementById('btnGiraCancel');
  if(bCancel) bCancel.addEventListener('click', closeGiraModal);

  var bcCancel = document.getElementById('btnGiraConfCancel');
  if(bcCancel) bcCancel.addEventListener('click', function(){ chiudi('mgiraConf'); pendingGiraToUser = null; });
  var bcOk = document.getElementById('btnGiraConfOk');
  if(bcOk) bcOk.addEventListener('click', confirmGiraSend);
}

var addrModalQuery='';        // testo indirizzo corrente
var addrModalSpan=null;       // span .addr-link cliccato
var addrEditMode=false;

function isMobileDevice(){
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
}

function openAddrModal(query,spanEl){
  if(document.activeElement&&document.activeElement.blur){try{document.activeElement.blur();}catch(_){}}
  addrModalQuery=query;
  addrModalSpan=spanEl||null;
  setAddrViewMode();
  var view=document.getElementById('maddrText');
  var inp=document.getElementById('maddrInput');
  if(view)view.textContent=query;
  if(inp)inp.value=query;
  apri('maddr');
}

function setAddrViewMode(){
  addrEditMode=false;
  var v=document.getElementById('maddrText');
  var i=document.getElementById('maddrInput');
  var er=document.getElementById('maddrErr');
  var t=document.getElementById('maddrTitle');
  var lbl=document.getElementById('addrEditLabel');
  var ico=document.getElementById('addrEditIco');
  if(v)v.style.display='';
  if(i)i.style.display='none';
  if(er)er.style.display='none';
  if(t)t.textContent='Indirizzo';
  if(lbl)lbl.textContent='Modifica';
  if(ico)ico.innerHTML='<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
}

function setAddrEditMode(){
  addrEditMode=true;
  var v=document.getElementById('maddrText');
  var i=document.getElementById('maddrInput');
  var er=document.getElementById('maddrErr');
  var t=document.getElementById('maddrTitle');
  var lbl=document.getElementById('addrEditLabel');
  var ico=document.getElementById('addrEditIco');
  if(v)v.style.display='none';
  if(er)er.style.display='none';
  if(t)t.textContent='Modifica indirizzo';
  if(lbl)lbl.textContent='Conferma';
  if(ico)ico.innerHTML='<polyline points="20 6 9 17 4 12"/>';
  if(i){
    i.style.display='';
    setTimeout(function(){
      i.focus();
      try{i.setSelectionRange(i.value.length,i.value.length);}catch(_){}
    },50);
  }
}

function commitAddrEdit(){
  var inp=document.getElementById('maddrInput');
  var er=document.getElementById('maddrErr');
  if(!inp)return null;
  var raw=(inp.value||'').trim();
  if(raw.length<3){
    if(er){er.textContent='Indirizzo troppo breve';er.style.display='block';}
    return null;
  }
  if(er)er.style.display='none';
  if(addrModalSpan&&addrModalSpan.parentNode){
    addrModalSpan.textContent=raw;
    addrModalSpan.dataset.addr=raw;
    var tr=addrModalSpan.closest('tr');
    if(tr){ if(tr.classList.contains('local-pending'))saveLocalRowNow(tr); else markDirty(tr); }
  }
  addrModalQuery=raw;
  var view=document.getElementById('maddrText');
  if(view)view.textContent=raw;
  return raw;
}

function closeAddrModal(){
  chiudi('maddr');
  setAddrViewMode();
  addrModalSpan=null;
}

function openInGoogleMaps(query){
  var url='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(query);
  // Riusa la finestra "guardia-medica-maps" se aperta
  openExternalLink(url,'guardia-medica-maps');
}

function openInDeviceNavigator(query){
  // Su iOS: maps:?q= apre Apple Maps. Android: geo:0,0?q= apre il navigator default
  var enc=encodeURIComponent(query);
  if(/iphone|ipad|ipod/i.test(navigator.userAgent||'')){
    window.location.href='maps://?q='+enc;
  } else {
    window.location.href='geo:0,0?q='+enc;
  }
}

function openPhoneModal(num,spanEl){
  // Forza blur dell'elemento attivo per chiudere la tastiera mobile
  if(document.activeElement&&typeof document.activeElement.blur==='function'){
    try{document.activeElement.blur();}catch(e){}
  }
  phoneModalNumber=num;
  phoneModalSpan=spanEl||null;
  setPhoneViewMode();
  var view=document.getElementById('mphoneNum');
  var inp=document.getElementById('mphoneInput');
  if(view)view.textContent=fmtPhoneDisplay(num);
  if(inp)inp.value=fmtPhoneDisplay(num);
  apri('mphone');
}

function setPhoneViewMode(){
  phoneEditMode=false;
  var v=document.getElementById('mphoneNum');
  var i=document.getElementById('mphoneInput');
  var er=document.getElementById('mphoneErr');
  var t=document.getElementById('mphoneTitle');
  var lbl=document.getElementById('phoneEditLabel');
  var ico=document.getElementById('phoneEditIco');
  if(v)v.style.display='';
  if(i)i.style.display='none';
  if(er)er.style.display='none';
  if(t)t.textContent='Come vuoi chiamare?';
  if(lbl)lbl.textContent='Modifica';
  if(ico)ico.innerHTML='<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
}

function setPhoneEditMode(){
  phoneEditMode=true;
  var v=document.getElementById('mphoneNum');
  var i=document.getElementById('mphoneInput');
  var er=document.getElementById('mphoneErr');
  var t=document.getElementById('mphoneTitle');
  var lbl=document.getElementById('phoneEditLabel');
  var ico=document.getElementById('phoneEditIco');
  if(v)v.style.display='none';
  if(er)er.style.display='none';
  if(t)t.textContent='Modifica numero';
  if(lbl)lbl.textContent='Conferma';
  // Icona check al posto della matita
  if(ico)ico.innerHTML='<polyline points="20 6 9 17 4 12"/>';
  if(i){
    i.style.display='';
    setTimeout(function(){
      i.focus();
      try{i.setSelectionRange(i.value.length,i.value.length);}catch(_e){}
    },50);
  }
}

// Valida + commita l'edit. Ritorna le cifre se ok, null se invalido.
function commitPhoneEdit(){
  var inp=document.getElementById('mphoneInput');
  var er=document.getElementById('mphoneErr');
  if(!inp)return null;
  var raw=(inp.value||'').trim();
  var digits=raw.replace(/\D/g,'');
  if(digits.length<3){
    if(er){er.textContent='Numero troppo breve';er.style.display='block';}
    return null;
  }
  if(er)er.style.display='none';
  // Aggiorna lo span nel cell se esiste
  if(phoneModalSpan&&phoneModalSpan.parentNode){
    phoneModalSpan.textContent=raw;
    phoneModalSpan.dataset.phone=digits;
    var tr=phoneModalSpan.closest('tr');
    if(tr){ if(tr.classList.contains('local-pending'))saveLocalRowNow(tr); else markDirty(tr); }
  }
  // Aggiorna stato modal
  phoneModalNumber=digits;
  var view=document.getElementById('mphoneNum');
  if(view)view.textContent=raw;
  return digits;
}

function closePhoneModal(){
  chiudi('mphone');
  setPhoneViewMode();
  phoneModalSpan=null;
}

// Riapplica linkifyPhones a descrizione/note di una riga, senza disturbare
// celle attualmente in editing dall'utente
function relinkifyRow(tr){
  if(!tr)return;
  ['[data-field="descrizione"]','[data-field="note"]'].forEach(function(sel){
    var cell=tr.querySelector(sel);
    if(!cell)return;
    if(document.activeElement===cell)return; // l'utente sta editando, non toccare
    // Preserva eventuale badge girata + <br> all'inizio della cella (solo descrizione)
    var preservedPrefix='';
    var firstBadge=cell.querySelector(':scope > .girata-badge');
    if(firstBadge){
      preservedPrefix=firstBadge.outerHTML;
      // Eventuale <br> immediatamente successivo
      var next=firstBadge.nextSibling;
      if(next && next.nodeType===1 && next.tagName==='BR'){
        preservedPrefix+='<br>';
      }
    }
    // Per ricavare il raw senza il badge, clono e tolgo il badge
    var clone=cell.cloneNode(true);
    var b2=clone.querySelector(':scope > .girata-badge');
    if(b2){
      var nx=b2.nextSibling;
      if(nx && nx.nodeType===1 && nx.tagName==='BR') nx.parentNode.removeChild(nx);
      b2.parentNode.removeChild(b2);
    }
    var raw=clone.innerText||'';
    var newBody=linkifyAddresses(linkifyPhones(esc(raw)));
    var newHtml=preservedPrefix+newBody;
    if(newHtml!==cell.innerHTML)cell.innerHTML=newHtml;
  });
}
