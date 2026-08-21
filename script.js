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
  var spedisci=function(){
    fetchOpts.headers['Authorization']='Bearer '+(currentJwt || SUPABASE_ANON_KEY);
    return fetch(SUPABASE_URL+'/rest/v1/'+path,fetchOpts);
  };
  // Gettone scaduto (lunga inattivita): rinnovo e UNA riprova, in silenzio
  return spedisci().then(function(res){
    if(res.status!==401) return res;
    return ensureFreshToken().then(function(ok){
      return ok ? spedisci() : res;
    });
  });
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
    var senzaLinea = !isOnline();
    btn.disabled = senzaLinea;
    var span = btn.querySelector('span');
    if(span) span.textContent = senzaLinea ? 'Senza connessione' : 'Accedi con Google';
    // Niente fuoco automatico: mentre si scrive, un invio di troppo
    // lo farebbe partire da solo.
    try{ btn.blur(); }catch(_){}
    if(!btn.dataset.vigila){
      btn.dataset.vigila='1';
      window.addEventListener('online', function(){
        btn.disabled=false;
        var sp=btn.querySelector('span'); if(sp) sp.textContent='Accedi con Google';
      });
      window.addEventListener('offline', function(){
        btn.disabled=true;
        var sp=btn.querySelector('span'); if(sp) sp.textContent='Senza connessione';
      });
    }
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

// ── Avvio senza rete ────────────────────────────────────────────────
// In campagna la linea spesso non c'e: il login vero e impossibile, ma chi
// era gia entrato ha il profilo salvato a bordo. Con quello l'app si apre,
// mostra l'ultimo elenco noto e accetta nuove chiamate (in coda). Appena
// torna la linea si riaggancia da sola: sessione rinnovata, coda spedita.
var PROFILO_OFFLINE_KEY='gm_profilo_v1';
function salvaProfiloOffline(u){
  if(!u || !u.id) return;
  try{ localStorage.setItem(PROFILO_OFFLINE_KEY, JSON.stringify(u)); }catch(_){}
}
function profiloOffline(){
  try{ return JSON.parse(localStorage.getItem(PROFILO_OFFLINE_KEY)||'null'); }catch(_){ return null; }
}
var avvioSenzaRete=false;
var uscitaVoluta=false;      // vero solo quando premi tu «Esci»

// C'e ancora qualcosa che deve partire da questo dispositivo?
function cosePendenti(){
  try{
    if(syncLoadQueue().length) return true;
    var mm=Object.keys(moduliMLocali||{});
    for(var i=0;i<mm.length;i++){ if(!(moduliMLocali[mm[i]]||{}).soloDocumento) return true; }
    if(Object.keys(allegatiLocali||{}).length) return true;
    if(localStorage.getItem(DRAFT_KEY)) return true;
  }catch(_){}
  return false;
}

function avvioOffline(){
  var p=profiloOffline();
  if(!p || !p.id) return false;
  avvioSenzaRete=true;
  currentUser=p; currentJwt=null;
  authHideOverlay();
  renderUserMenu();
  if(currentUser.role==='admin') renderAdminBadge();
  loadPost();
  setupAutoRefresh();
  setupVersionWatcher();
  restoreDraft();
  syncRenderBadge();
  mostraAvvisoOffline();
  modmCaricaCodaInMappa();
  allegCaricaCodaInMappa();
  return true;
}
function mostraAvvisoOffline(){
  if(document.getElementById('offlineBanner')) return;
  var b=document.createElement('div');
  b.id='offlineBanner';
  b.className='offline-banner';
  b.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>'
    +'<span>Sei offline: le chiamate si salvano sul dispositivo e partiranno da sole al ritorno della linea.</span>';
  document.body.appendChild(b);
}
function rimuoviAvvisoOffline(){
  var b=document.getElementById('offlineBanner');
  if(b) b.remove();
}
// Ritorno della linea: rinnova la sessione, spedisce la coda, rilegge.
function riaggancioRete(){
  rimuoviAvvisoOffline();
  if(!currentUser) return;
  ensureFreshToken().then(function(ok){
    if(!ok) return;              // sessione non recuperabile: al riavvio si rifara il login
    avvioSenzaRete=false;
    aggiornaIndicatoreRete();
    syncProcess();
    modmCodaDrena();
    allegCodaDrena();
    safeReloadRows();
    driveWarmup();
    scaldaLibreriePdf();     // chi era partito offline non le aveva ancora
  });
}
// ── Vigilanza della linea ───────────────────────────────────────────
// Gli avvisi del browser sul ritorno della connessione arrivano tardi, o non
// arrivano affatto (e «collegato» puo voler dire wifi senza internet). Finche
// c'e qualcosa da inviare si tasta il polso da soli, ogni pochi secondi.
// Il controllo va sulla PAGINA DELL'APP, non sul database: nessun consumo
// di traffico sul database. E quando non c'e nulla in coda, non parte affatto.
var _vigileRete=null, _reteViva=null, _pingInCorso=false;
function pingRete(){
  if(_pingInCorso) return Promise.resolve(null);
  _pingInCorso=true;
  return fetch('./favicon.png?rete='+Date.now(), {method:'HEAD', cache:'no-store'})
    .then(function(r){ _pingInCorso=false; return !!(r && (r.ok || r.status===0)); })
    .catch(function(){ _pingInCorso=false; return false; });
}
function controllaRete(){
  if(!cosePendenti()){ fermaVigilanzaRete(); return; }
  pingRete().then(function(viva){
    if(viva===null) return;
    if(viva && _reteViva!==true){
      _reteViva=true;
      rimuoviAvvisoOffline();
      try{ aggiornaIndicatoreRete(); }catch(_){}
      riaggancioRete();
      drenaTuttoSubito();
    } else if(!viva){
      _reteViva=false;
    }
  });
}
function avviaVigilanzaRete(){
  if(_vigileRete) return;
  if(!cosePendenti()) return;
  _vigileRete=setInterval(controllaRete, 5000);
  controllaRete();
}
function fermaVigilanzaRete(){
  if(_vigileRete){ clearInterval(_vigileRete); _vigileRete=null; }
}
// Tutto quel che deve partire, subito e insieme
function drenaTuttoSubito(forza){
  try{ syncProcess(); }catch(_){}
  try{ modmCodaDrena(forza); }catch(_){}
  try{ allegCodaDrena(forza); }catch(_){}
  try{ driveOpsDrena(forza); }catch(_){}
}

if(typeof window!=='undefined'){
  window.addEventListener('online', function(){ _reteViva=true; riaggancioRete(); drenaTuttoSubito(true); });
  window.addEventListener('offline', function(){
    _reteViva=false;
    if(currentUser) mostraAvvisoOffline();
    avviaVigilanzaRete();
  });
  // Tornando sull'app dopo averla lasciata: si controlla subito
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) return;
    if(cosePendenti()){ avviaVigilanzaRete(); controllaRete(); }
  });
}

async function setupAuth(){
  authShowOverlay(); // mostra subito login screen
  var client;
  try {
    client = await getSupabaseClient();
  } catch(e) {
    if(avvioOffline()) return;   // niente rete ma profilo noto: si lavora lo stesso
    authShowOverlay('Errore caricamento client autenticazione. Ricarica la pagina.');
    return;
  }

  // Listener cambi auth (utile per logout, refresh token)
  client.auth.onAuthStateChange(function(event, session){
    if(event === 'SIGNED_OUT'){
      currentJwt = null;
      // Se il signOut è stato causato da un check whitelist fallito,
      // NON ricaricare: l'utente deve poter leggere il messaggio di errore.
      if(authRejectInProgress) return;

      // Non l'hai chiesto tu: e la linea che manca. Si continua a lavorare
      // col profilo di bordo, senza coprire nulla e senza ricaricare.
      if(!uscitaVoluta && profiloOffline() && (!isOnline() || cosePendenti() || isUserBusy())){
        currentUser = currentUser || profiloOffline();
        avvioSenzaRete = true;
        try{ aggiornaIndicatoreRete(); mostraAvvisoOffline(); }catch(_){}
        return;
      }

      currentUser = null;
      metti_al_sicuro_tutto();          // qualunque cosa succeda, prima si salva
      authShowOverlay();
      setTimeout(function(){ window.location.reload(); }, 400);
    } else if(event === 'TOKEN_REFRESHED' && session){
      // Aggiorna JWT su refresh per non perdere autenticazione
      currentJwt = session.access_token;
    }
  });

  // Verifica sessione esistente
  var sessRes = null, erroreDiRete = false;
  try{ sessRes = await client.auth.getSession(); }catch(_e){ erroreDiRete = true; }
  var session = sessRes && sessRes.data && sessRes.data.session;
  if(!session){
    // Senza linea la sessione non si puo verificare, e la libreria puo averla
    // gia cancellata: fa fede il profilo di bordo. Se invece la linea c'e ed
    // e davvero uscito, allora si chiede l'accesso.
    if((erroreDiRete || !isOnline() || cosePendenti()) && avvioOffline()) return;
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
    if(avvioOffline()) return;   // la verifica richiede rete: senza, profilo di bordo
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
  // CAP mancanti nell'archivio storico: passata unica con la tabella locale
  setTimeout(capBackfillArchive, 4000);
  // Autorizzazione Drive: controllo silenzioso in parallelo (invito solo se serve)
  setTimeout(function(){ driveWarmup(true); }, 900);
  // Librerie del PDF in cache: il Modulo M si firma anche senza linea
  setTimeout(scaldaLibreriePdf, 2500);
  // Una volta al giorno: via i documenti rimasti senza chiamata (nel cestino
  // di Drive, recuperabili). In silenzio, senza mai chiedere permessi.
  setTimeout(function(){ try{ puliziaDriveAutomatica(); }catch(_){} }, 30000);
  // Moduli M rimasti in tasca dall'ultima uscita: si recuperano e si spediscono
  modmCaricaCodaInMappa().then(function(){ setTimeout(modmCodaDrena, 3000); });
  allegCaricaCodaInMappa().then(function(){ setTimeout(allegCodaDrena, 4000); });
  // Se e rimasto qualcosa in sospeso, si tiene d'occhio la linea
  setTimeout(function(){ try{ avviaVigilanzaRete(); }catch(_){} }, 5000);
  // Il profilo resta a bordo: e la chiave per aprire l'app anche senza rete
  salvaProfiloOffline(currentUser);
}

async function authSignInWithGoogle(forceAccountChoice){
  var btn = document.getElementById('btnAuthGoogle');
  // Senza linea la pagina di Google non si carica: si resterebbe davanti a
  // uno schermo nero, fuori dall'app e col lavoro interrotto.
  if(!isOnline()){
    authShowOverlay('Sei senza connessione: l\u2019accesso a Google non \u00e8 possibile adesso. '
      +'Riprova appena torna la linea: quello che avevi scritto \u00e8 al sicuro sul dispositivo.', false);
    return;
  }
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
  // Se c'e ancora roba da inviare, uscire significherebbe perderla
  if(cosePendenti()){
    var quante=syncLoadQueue().length;
    var ok=window.confirm('Ci sono ancora dati da inviare'+(quante?(' ('+quante+')'):'')
      +'. Uscendo restano sul dispositivo e partiranno al prossimo accesso con questo stesso account.\n\nVuoi uscire lo stesso?');
    if(!ok) return;
  }
  uscitaVoluta=true;
  metti_al_sicuro_tutto();
  try{ localStorage.removeItem(PROFILO_OFFLINE_KEY); }catch(_){}
  try {
    var client = await getSupabaseClient();
    await client.auth.signOut();
  } catch(_){}
  currentUser = null;
  // onAuthStateChange porta al ricaricamento
}

// ── Indicatore di rete nell'intestazione ───────────────────────────
// Un'occhiata e sai se stai lavorando online o col taccuino di bordo.
function creaIndicatoreRete(){
  if(document.getElementById('netDot')) return;
  var menu=document.getElementById('userMenu');
  if(!menu || !menu.parentNode) return;
  var d=document.createElement('div');
  d.id='netDot';
  menu.parentNode.insertBefore(d, menu);
  aggiornaIndicatoreRete();
}
function aggiornaIndicatoreRete(){
  var d=document.getElementById('netDot');
  if(!d) return;
  var online = isOnline() && !avvioSenzaRete;
  d.className='net-dot '+(online?'net-on':'net-off');
  d.title = online
    ? 'Online: tutto si salva direttamente sul server'
    : 'Offline: le chiamate si salvano sul dispositivo e partiranno da sole al ritorno della linea';
  d.innerHTML = online
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
}
if(typeof window!=='undefined'){
  window.addEventListener('online', aggiornaIndicatoreRete);
  window.addEventListener('offline', aggiornaIndicatoreRete);
}

// User menu rendering
function renderUserMenu(){
  if(!currentUser) return;
  var menu = document.getElementById('userMenu');
  if(!menu) return;
  creaIndicatoreRete();
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
  loadRows(PAGE, {silenzioso:true});
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
    driveWarmup();
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
  // Postazione e data/ora fanno parte della bozza quanto il testo
  var selPostBozza=document.getElementById('selPost');
  if(selPostBozza) selPostBozza.addEventListener('change', saveDraftNow);
  var dtxtBozza=document.getElementById('dtxt');
  if(dtxtBozza) dtxtBozza.addEventListener('input', saveDraftDebounced);

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
  window.addEventListener('beforeunload', metti_al_sicuro_tutto);

  // Badge "in coda di sync" è basato su localStorage, non richiede auth
  syncRenderBadge();

  // GIRA CHIAMATA: wiring dei modali e del banner (delegation)
  setupGirateBannerDelegation();
  setupGirateModalsDelegation();
  // ALLEGATI: wiring modali upload/elimina
  setupAttachWiring();
  // MAIL: wiring modal invio al paziente
  setupMailWiring();
  // CAP: wiring modal conferma CAP discordante
  setupCapWiring();
  // MODULO M: wiring modulo, uscita e eliminazione
  setupModmWiring();

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
  str=str.replace(/\u200B/g,''); // toglie gli spazi invisibili usati per il cursore su iOS
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
  }).catch(function(){
    // Rete assente: meglio le postazioni dell'ultima volta che nessuna
    try{
      var raw=localStorage.getItem(POST_CACHE_KEY);
      var o=raw?JSON.parse(raw):null;
      if(o && o.data) applyPostazioniData(o.data);
    }catch(_){}
    hideLoader();loadRows(1);
  });
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
  // CAP dei comuni serviti: inserito subito, senza rete (vedi CAP_COMUNI)
  d=addCapsLocalSync(d);
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
      // CAP non risolvibili dalla tabella (es. vie di Roma): ricerca online in background
      enrichNewCallCap(clientUuid, d);
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

function loadRows(pg, opz){
  opz=opz||{};
  PAGE=pg;
  var tb=els.tbody||document.getElementById('tbody');
  // Silenzioso: si scarica senza togliere nulla dallo schermo. Le chiamate
  // restano leggibili anche se la linea ci mette dieci secondi.
  var giaPiena = tb.querySelector('tr[data-row], tr.local-pending');
  var silenzioso = !!opz.silenzioso && !!giaPiena;
  if(!silenzioso){
    dirtyMap={};
    tb.innerHTML='<tr><td><div class="sk" style="width:30px;height:30px;margin:0 auto;border-radius:6px"></div></td><td><div class="sk" style="width:24px;height:12px"></div></td><td><div class="sk" style="width:100px;height:12px"></div></td><td><div class="sk" style="width:85%;height:12px"></div></td><td><div class="sk" style="width:75%;height:12px"></div></td></tr>'.repeat(3);
  }

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
    renderListWithPending(records, result.total, pg, silenzioso);
    // Allegati: carica e inietta le righe "Allegati" (non blocca il render principale)
    var attIds=records.map(function(r){return r.id;});
    loadAttachmentsForCalls(attIds).then(injectAttachRows);
    // Moduli M gia compilati: innesto mirato, senza ridisegnare (un redraw
    // mentre si scrive farebbe perdere le modifiche non ancora salvate)
    caricaModuliM(attIds).then(function(){ modmApplicaLocali(); injectModmUi(); });
    // CAP: completa quelli mancanti nelle chiamate visibili
    enrichVisibleCallsCap(records);
  }).catch(function(e){
    hideLoader();
    // In silenzio: se la lettura fallisce si tiene quel che c'e gia a schermo
    if(silenzioso) return;
    renderOfflineFallback(pg, e);
  });
}

// Mappa una riga server nel formato usato da drawRows
function mapServerRow(r){
  return {
    id:r.id,rowIndex:r.id,
    client_uuid:r.client_uuid||null,
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
// Una copia locale la cui chiamata e gia sul server e solo un doppione:
// si toglie dalla coda e si porta con se il Modulo M eventualmente compilato.
function scartaLocaliGiaArrivate(inserts, records){
  var suServer={};
  (records||[]).forEach(function(r){ if(r && r.client_uuid) suServer[r.client_uuid]=r.id; });
  var vive=[];
  (inserts||[]).forEach(function(e){
    var idVero=suServer[e.client_uuid];
    if(idVero!==undefined && idVero!==null){
      syncDequeueInsert(e.client_uuid);
      modmRimappaLocale(e.client_uuid, idVero);
    } else {
      vive.push(e);
    }
  });
  return vive;
}

// Impronta dei dati che si vedono in una riga: se non cambia, la riga non
// va toccata. Cosi un aggiornamento non fa sfarfallare tutto l'elenco.
function firmaRiga(r){
  return [r.id, r.client_uuid||'', r.tsFormatted||'', r.postazione||'',
          r.descrizione||'', r.note||'', r.completato?1:0,
          r.girata_a_user_id||'', r.girata_a_nome||'', r.girata_a_at||'',
          r.girata_da_user_id||'', r.girata_da_nome||'', r.girata_da_at||''].join('\u0001');
}

// Una riga e «in uso» se ci stai scrivendo, se ha modifiche non ancora
// salvate o se un salvataggio e gia in programma: non si tocca, punto.
function rigaInUso(tr){
  if(!tr) return false;
  var id=tr.dataset.row;
  if(id && dirtyMap[id]) return true;
  if(id && autosaveTimers && autosaveTimers[id]) return true;
  if(document.activeElement && tr.contains(document.activeElement)) return true;
  if(tr.querySelector('.post-dropdown.open, .post-dropdown[style*="block"]')) return true;
  return false;
}

// Sostituisce/aggiunge/toglie SOLO quel che e cambiato davvero.
function aggiornaElencoInPlace(nuovi){
  var tb=els.tbody||document.getElementById('tbody');
  if(!tb) return false;
  var esistenti={};
  tb.querySelectorAll('tr[data-row], tr.local-pending').forEach(function(tr){
    var k=tr.dataset.row || (tr.dataset.uuid ? 'local_'+tr.dataset.uuid : '');
    if(k) esistenti[k]=tr;
  });

  var contenitore=document.createElement('tbody');
  var precedente=null, cambiate=0;
  nuovi.forEach(function(r){
    var chiave = r.localPending ? ('local_'+r.client_uuid) : String(r.id);
    var vecchia = esistenti[chiave];
    var firma = r.localPending ? ('L'+firmaRiga(r)) : firmaRiga(r);
    if(vecchia){
      delete esistenti[chiave];
      if(vecchia.dataset.firma!==firma && !rigaInUso(vecchia)){
        contenitore.innerHTML = r.localPending ? renderPendingInsertRow(r) : drawRows([r], null, true);
        var fresca=contenitore.firstElementChild;
        if(fresca){
          fresca.dataset.firma=firma;
          vecchia.parentNode.replaceChild(fresca, vecchia);
          vecchia=fresca; cambiate++;
        }
      }
      // ordine: se e fuori posto la si rimette al suo posto
      var attesa = precedente ? precedente.nextElementSibling : tb.firstElementChild;
      if(attesa!==vecchia) tb.insertBefore(vecchia, attesa);
      precedente=vecchia;
    } else {
      contenitore.innerHTML = r.localPending ? renderPendingInsertRow(r) : drawRows([r], null, true);
      var nuova=contenitore.firstElementChild;
      if(nuova){
        nuova.dataset.firma=firma;
        tb.insertBefore(nuova, precedente ? precedente.nextElementSibling : tb.firstElementChild);
        precedente=nuova; cambiate++;
      }
    }
  });
  // Chiamate sparite (cestinate altrove): via, se non le stai usando
  Object.keys(esistenti).forEach(function(k){
    var tr=esistenti[k];
    if(rigaInUso(tr)) return;
    var acc=tr.nextElementSibling;
    if(acc && acc.classList.contains('attach-row')) acc.remove();
    tr.remove(); cambiate++;
  });
  // Barrette di caricamento e righe vuote residue
  tb.querySelectorAll('tr').forEach(function(tr){
    if(!tr.dataset.row && !tr.classList.contains('local-pending') && !tr.classList.contains('attach-row')) tr.remove();
  });
  return cambiate;
}

function renderListWithPending(records,total,pg,silenzioso){
  var merged=records;
  var pendingCount=0;
  if(pg===1 && !currentFilters && !showIncompleteOnly){
    var inserts=scartaLocaliGiaArrivate(loadPendingInserts(), records).map(pendingInsertToRecord);
    pendingCount=inserts.length;
    merged=inserts.concat(records);
  }
  if(silenzioso){
    merged.forEach(function(r){ if(!r.localPending) ricordaBaseRiga(r); });
    aggiornaElencoInPlace(merged);
    // Le righe allegati seguono l'elenco: mai orfane, mai mancanti
    try{ injectAttachRows(); }catch(_){}
  } else {
    drawRows(merged,null);
    // Impronte anche al disegno completo: senza, il primo aggiornamento
    // silenzioso troverebbe «tutto cambiato» e rifarebbe l'intero elenco.
    var tbF=els.tbody||document.getElementById('tbody');
    if(tbF) merged.forEach(function(r){
      var chiave = r.localPending ? ('local_'+r.client_uuid) : String(r.id);
      var el = r.localPending ? tbF.querySelector('tr[data-uuid="'+r.client_uuid+'"]')
                              : tbF.querySelector('tr[data-row="'+r.id+'"]');
      if(el) el.dataset.firma = (r.localPending?'L':'')+firmaRiga(r);
    });
  }
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
  var cached=loadCachedRows();
  var serverRecs=(pg===1 && cached && cached.records)?cached.records.slice():[];
  // Anche l'elenco in cache puo gia contenere la chiamata: niente doppioni
  var inserts=scartaLocaliGiaArrivate(loadPendingInserts(), serverRecs).map(pendingInsertToRecord);

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
  // Anche senza linea le icone ci sono: Modulo M e allegati si compilano lo stesso
  try{ modmApplicaLocali(); injectModmUi(); injectAttachRows(); }catch(_){}
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

function drawRows(recs,highlightQuery,soloHtml){
  var tb=els.tbody||document.getElementById('tbody');
  if(soloHtml) tb=null;
  if(!recs||!recs.length){
    if(soloHtml) return '';
    tb.innerHTML='<tr><td colspan="5"><div class="emp"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>'+(currentFilters?'Nessun risultato':'Nessuna chiamata')+'</h3><p>'+(currentFilters?'Prova a modificare i criteri di ricerca.':'Premi «+» per registrare la prima chiamata.')+'</p></div></td></tr>';
    return;
  }
  // Pre-calcola pendingGirate map per chiamata_origine_id (outgoing pending)
  var outgoingPendingMap = {};
  (pendingGirate.outgoing||[]).forEach(function(g){
    if(g.chiamata_origine_id) outgoingPendingMap[g.chiamata_origine_id] = g;
  });

  var html=recs.map(function(r){
    // Riga chiamata salvata solo in locale (in attesa di invio al server)
    if(r.localPending) return renderPendingInsertRow(r);
    ricordaBaseRiga(r);
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

    var descHtml=linkifyAll(highlightQuery?highlight(r.descrizione||'',highlightQuery):esc(r.descrizione||''));
    var noteHtml=linkifyAll(highlightQuery?highlight(r.note||'',highlightQuery):esc(r.note||''));
    var si=r.completato
      ?'<div class="ich"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>'
      :'<div class="iho" data-row="'+r.id+'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></div>';

    // Bottone Modulo M: solo se non ne esiste gia uno salvato per questa chiamata
    var modmSalvato = moduliMByCall[String(r.id)];
    var modmBtn = modmSalvato ? '' :
      '<div class="iho-modm" data-row="'+r.id+'" title="Compila il Modulo M (Relazione Medica)">'+svgModuloM()+'</div>';

    // Bottone Allega: su tutte le chiamate già sul server (non sulle locali in attesa)
    var attachBtn = '<div class="iho-attach" data-row="'+r.id+'" title="Allega file">'+svgAttach()+'</div>';

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
      +'<td class="tds"><div class="sc">'+si+'<div class="isv" data-row="'+r.id+'" style="display:none">'+svgFloppy()+'</div>'+modmBtn+attachBtn+giraBtn+cestino+'</div></td>'
      +'<td class="tid">'+r.id+'</td>'
      +'<td class="tdt"><div class="dt-wrap">'
        +'<span class="dt-date" contenteditable="true" data-field="dt-date" spellcheck="false">'+esc(ds)+'</span>'
        +'<span class="dt-time" contenteditable="true" data-field="dt-time" spellcheck="false">'+esc(ts)+'</span>'
        +'<span class="ptag" data-field="postazione" data-nome="'+esc(r.postazione||'')+'" style="background:'+pc+'">'
          +esc(r.postazione||'—')
          +'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>'
          +'<div class="post-dropdown">'+ddOpts+'</div>'
        +'</span>'
        +(modmSalvato
          ? '<div class="modm-link-wrap">'
              +'<span class="modm-link" data-row="'+r.id+'" title="Apri il Modulo M compilato">'
                +svgModuloM()+'Visualizza modulo M'
              +'</span>'
              +'<span class="modm-del" data-row="'+r.id+'" title="Elimina il Modulo M">'
                +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
              +'</span>'
            +'</div>'
          : '')
      +'</div></td>'
      +'<td data-field="descrizione" contenteditable="true" spellcheck="false" style="white-space:pre-wrap;min-width:180px">'+girataBadge+(girataBadge?'<br>':'')+descHtml+'</td>'
      +'<td data-field="note" contenteditable="true" spellcheck="false" style="white-space:pre-wrap">'+noteHtml+'</td>'
      +'</tr>';
  }).join('');
  if(soloHtml) return html;
  tb.innerHTML=html;

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
  var descHtml=linkifyAll(esc(r.descrizione||''));
  var noteHtml=linkifyAll(esc(r.note||''));
  var badge='<span class="girata-badge pending" contenteditable="false" title="Salvata sul dispositivo, in attesa di invio al server">'
    +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
    +'Solo in locale — in attesa di invio</span>';
  var clock='<div class="iho-localwait" title="In attesa di invio al server"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>';
  var attachBtnLoc='<div class="iho-attach" data-row="local_'+esc(r.client_uuid)+'" title="Allega file (foto di documenti, referti\u2026)">'+svgAttach()+'</div>';
  var delBtn='<div class="idel-local" data-uuid="'+esc(r.client_uuid)+'" title="Elimina questa chiamata locale (non ancora inviata)">'
    +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>';
  return '<tr class="local-pending" data-uuid="'+esc(r.client_uuid)+'" data-original-ts="'+esc(tsf)+'">'
    +'<td class="tds"><div class="sc">'+clock+attachBtnLoc+delBtn+'</div></td>'
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
  if(!body || !Object.keys(body).length) return;    // differenza vuota: nulla da spedire
  var q=syncLoadQueue();
  // Una sola voce per riga: le differenze si FONDONO (campi diversi convivono)
  var vecchia=null;
  q=q.filter(function(e){
    if(!e.type && String(e.id)===String(rowId)){ vecchia=e; return false; }
    return true;
  });
  var unito = vecchia ? Object.assign({}, vecchia.body||{}, body) : body;
  q.push({id:rowId,body:unito,ts:Date.now(),attempts:0});
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
  try{ avviaVigilanzaRete(); }catch(_){}
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
// Recupera il numero assegnato dal server a una chiamata appena inviata,
// cosi il Modulo M compilato offline puo agganciarsi a quella vera.
function agganciaNumeroVero(clientUuid){
  return sbFetch('chiamate?client_uuid=eq.'+encodeURIComponent(clientUuid)+'&select=id')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      var id=(Array.isArray(rows)&&rows[0])?rows[0].id:null;
      if(id==null) return false;
      return modmRimappaLocale(clientUuid, id).then(function(spostato){
        if(spostato) modmCodaDrena();
        return true;
      });
    }).catch(function(){ return false; });
}

function syncOneInsert(clientUuid, body){
  markOwnWrite();
  var post=function(){
    return sbFetch('chiamate',{method:'POST',body:body,prefer:'return=minimal'});
  };
  return post().then(function(res){
    if(res.ok || res.status===409){ syncDequeueInsert(clientUuid); agganciaNumeroVero(clientUuid); return true; }
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
  _draftTimer=setTimeout(saveDraftNow,250);
}
function saveDraftNow(){
  try{
    if(_draftTimer){ clearTimeout(_draftTimer); _draftTimer=null; }
    var d=(document.getElementById('txd')||{}).value||'';
    var n=(document.getElementById('txn')||{}).value||'';
    var dtEl=document.getElementById('dtxt');
    var dt=dtEl?(dtEl.innerText||''):'';
    var selP=document.getElementById('selPost');
    var p=selP?(selP.value||''):'';
    if(!d.trim() && !n.trim()){ localStorage.removeItem(DRAFT_KEY); return; }
    // La postazione va conservata: senza, alla riapertura il salvataggio
    // verrebbe rifiutato e bisognerebbe ricordarsela a mente.
    localStorage.setItem(DRAFT_KEY, JSON.stringify({d:d,n:n,dt:dt,p:p,ts:Date.now()}));
  }catch(_){}
}
function clearDraft(){
  try{ localStorage.removeItem(DRAFT_KEY); }catch(_){}
  var b=document.getElementById('draftBanner'); if(b) b.remove();
}
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
    var selP=document.getElementById('selPost');
    if(selP && o.p && !selP.value){
      // la lista postazioni potrebbe non essere ancora pronta: si riprova
      var metti=function(giro){
        if(selP.querySelector('option[value="'+String(o.p).replace(/"/g,'\\"')+'"]')){ selP.value=o.p; showComuni(); return; }
        if(giro<10) setTimeout(function(){ metti(giro+1); }, 300);
      };
      metti(0);
    }
    mostraBozzaRecuperata(o);
  }catch(_){}
}

// Avviso che RESTA finche non decidi: una bozza recuperata non deve
// scomparire dopo due secondi come un messaggio qualsiasi.
function mostraBozzaRecuperata(o){
  if(document.getElementById('draftBanner')) return;
  var quando='';
  try{
    if(o && o.ts){
      var d=new Date(o.ts), pd=function(x){return String(x).padStart(2,'0');};
      quando=' del '+pd(d.getDate())+'/'+pd(d.getMonth()+1)+' alle '+pd(d.getHours())+':'+pd(d.getMinutes());
    }
  }catch(_){}
  var b=document.createElement('div');
  b.id='draftBanner';
  b.className='draft-banner';
  b.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v6h6"/><path d="M3.5 9a9 9 0 1 0 2.1-3.4L3 9"/></svg>'
    +'<span><b>Chiamata recuperata</b>'+esc(quando)+' &mdash; era rimasta a met&agrave;.</span>'
    +'<button type="button" class="draft-b draft-ok" id="btnDraftSalva">Salva ora</button>'
    +'<button type="button" class="draft-b draft-no" id="btnDraftScarta">Scarta</button>';
  document.body.appendChild(b);
  var salvaOra=document.getElementById('btnDraftSalva');
  if(salvaOra) salvaOra.addEventListener('click', function(){
    var f=document.getElementById('txd');
    if(f) f.scrollIntoView({block:'center'});
    salva();      // se manca qualcosa, e salva() stessa a segnalarlo
  });
  var scarta=document.getElementById('btnDraftScarta');
  if(scarta) scarta.addEventListener('click', function(){
    ['txd','txn'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
    clearDraft();
  });
}

// ── Tutto al sicuro, adesso ──────────────────────────────────────────
// Chiamata quando l'app sta per sparire (schermo bloccato, cambio app,
// browser chiuso dal sistema): mette in cassaforte la bozza, le modifiche
// alle righe e le chiamate locali ancora in attesa.
function metti_al_sicuro_tutto(){
  try{ saveDraftNow(); }catch(_){}
  try{
    Object.keys(dirtyMap||{}).forEach(function(k){
      var info=dirtyMap[k]; if(!info||!info.tr) return;
      if(!document.body.contains(info.tr)) return;
      var body=buildPatchBodyFromRow(info.tr);
      if(body && Object.keys(body).length) syncEnqueue(k, body);
    });
  }catch(_){}
  try{
    var lp=document.querySelectorAll('tr.local-pending');
    for(var i=0;i<lp.length;i++){ try{ saveLocalRowNow(lp[i]); }catch(_e){} }
  }catch(_){}
}
if(typeof window!=='undefined'){
  // Su iPhone e iPad `beforeunload` spesso NON scatta (schermo bloccato,
  // app chiusa dal sistema). pagehide e visibilitychange invece si.
  window.addEventListener('pagehide', metti_al_sicuro_tutto);
  window.addEventListener('freeze', metti_al_sicuro_tutto);
  window.addEventListener('blur', metti_al_sicuro_tutto);
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) metti_al_sicuro_tutto();
  });
}

function syncProcess(){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
  var q=syncLoadQueue();
  if(!q.length)return;
  // Rinnova il token PRIMA di drenare la coda (evita 401 su token scaduto)
  ensureFreshToken().then(function(){
    var q2=syncLoadQueue();
    if(!q2.length)return;
    segnalaInvio(q2.length===1?'la chiamata':'le chiamate', 0, q2.length);
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
      fineInvio();
      // Le chiamate appena registrate portano con se il loro Modulo M
      q2.forEach(function(e){
        if(e.type==='insert' && okKeys['ins:'+e.client_uuid]) agganciaNumeroVero(e.client_uuid);
      });
      syncRenderBadge();
      var anyOk=results.some(function(r){return r.ok;});
      // safeReloadRows: mai ridisegnare se ci sono modifiche non ancora salvate
      if(anyOk) safeReloadRows();
    });
  });
}

// Che cosa sta partendo in questo momento: serve a farlo vedere.
var invioInCorso={attivo:false, cosa:'', fatti:0, totale:0};
var _invioDa=0, _fineRimandata=null;
function segnalaInvio(cosa, fatti, totale){
  if(!invioInCorso.attivo) _invioDa=Date.now();
  if(_fineRimandata){ clearTimeout(_fineRimandata); _fineRimandata=null; }
  invioInCorso={attivo:true, cosa:cosa, fatti:fatti, totale:totale};
  syncRenderBadge();
}
// Se l'invio dura un istante l'avviso farebbe solo un lampo: lo si tiene
// visibile un momento, quel tanto che basta per accorgersene.
function fineInvio(){
  if(!invioInCorso.attivo) return;
  var restano=700-(Date.now()-_invioDa);
  var spegni=function(){
    _fineRimandata=null;
    invioInCorso={attivo:false, cosa:'', fatti:0, totale:0};
    syncRenderBadge();
  };
  if(restano>0){
    if(_fineRimandata) clearTimeout(_fineRimandata);
    _fineRimandata=setTimeout(spegni, restano);
  } else spegni();
}
function plur(n, uno, molti){ return n+' '+(n===1?uno:molti); }

function syncRenderBadge(){
  var q=syncLoadQueue();
  var inserts=q.filter(function(e){return e.type==='insert';}).length;
  var updates=q.length-inserts;
  // I moduli gia sul server, a cui manca solo il documento, NON si contano:
  // sarebbe un numero che allarma senza motivo.
  var moduli=0;
  try{
    Object.keys(moduliMLocali||{}).forEach(function(k){
      if(!(moduliMLocali[k]||{}).soloDocumento) moduli++;
    });
  }catch(_){}
  var alleg=0;
  try{ Object.keys(allegatiLocali||{}).forEach(function(k){ alleg+=(allegatiLocali[k]||[]).length; }); }catch(_){}
  var totale=inserts+updates+moduli+alleg;

  var existing=document.getElementById('syncBadge');
  if(totale===0 && !invioInCorso.attivo){ if(existing)existing.remove(); return; }
  if(!existing){
    existing=document.createElement('div');
    existing.id='syncBadge';
    existing.title='Tocca per vedere che cosa deve ancora partire';
    existing.addEventListener('click', apriElencoCoda);
    document.body.appendChild(existing);
  }
  var offline=!isOnline();

  // ── Invio in corso: si vede la rotellina e a che punto siamo ──
  if(invioInCorso.attivo){
    var avanz = invioInCorso.totale>1 ? (' ('+Math.min(invioInCorso.fatti+1,invioInCorso.totale)+' di '+invioInCorso.totale+')') : '';
    existing.className='sync-badge in-corso';
    existing.innerHTML='<span class="sync-rotella"></span>'
      +'<span>Invio '+esc(invioInCorso.cosa)+avanz+'\u2026</span>';
    return;
  }

  var pezzi=[];
  if(inserts) pezzi.push(plur(inserts,'chiamata','chiamate'));
  if(updates) pezzi.push(plur(updates,'modifica','modifiche'));
  if(moduli)  pezzi.push(plur(moduli,'Modulo M','Moduli M'));
  if(alleg)   pezzi.push(plur(alleg,'allegato','allegati'));
  var label=pezzi.join(' + ')+' da inviare';

  existing.className='sync-badge'+(offline?' offline':'');
  existing.innerHTML=
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
      +(offline
        ?'<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'
        :'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>')
    +'</svg>'
    +'<span>'+(offline?'Offline · ':'')+label+'</span>';
}

// ── Che cosa deve ancora partire ────────────────────────────────────
function apriElencoCoda(){
  apri('mcoda');
  disegnaElencoCoda();
}
function disegnaElencoCoda(){
  var box=document.getElementById('codaElenco');
  if(!box) return;
  box.innerHTML='<div class="coda-vuota">Controllo\u2026</div>';
  Promise.all([modmCodaLeggi(), allegCodaLeggi()]).then(function(r){
    var moduli=r[0]||[], alleg=r[1]||[];
    var q=syncLoadQueue();
    var righe=[];

    q.filter(function(e){ return e.type==='insert'; }).forEach(function(e){
      var d=((e.body&&e.body.descrizione)||'').split('\n')[0]||'senza descrizione';
      righe.push(voceCoda('chiamata','Chiamata nuova', d, 'ins:'+e.client_uuid));
    });
    q.filter(function(e){ return e.type!=='insert'; }).forEach(function(e){
      righe.push(voceCoda('modifica','Modifica alla chiamata '+e.id,
        Object.keys(e.body||{}).join(', ')||'\u2014', 'upd:'+e.id));
    });
    moduli.forEach(function(m){
      var dove=String(m.chiamata_id).indexOf('local_')===0 ? 'chiamata non ancora registrata' : ('chiamata '+m.chiamata_id);
      var titolo = m.soloDocumento
        ? 'Modulo M \u2014 gi\u00e0 salvato, manca il documento'
        : ('Modulo M ('+(m.firmato?'firmato':'bozza')+')');
      righe.push(voceCoda('modulo', titolo, dove, 'modm:'+m.chiamata_id));
    });
    alleg.forEach(function(a){
      var dove=String(a.chiamata_id).indexOf('local_')===0 ? 'chiamata non ancora registrata' : ('chiamata '+a.chiamata_id);
      righe.push(voceCoda('allegato', a.nome||'allegato', dove, 'all:'+a.id));
    });

    if(!righe.length){
      box.innerHTML='<div class="coda-vuota">Non c\u2019\u00e8 nulla in attesa: tutto \u00e8 gi\u00e0 sul server.</div>';
      return;
    }
    box.innerHTML=righe.join('');
  }).catch(function(){
    box.innerHTML='<div class="coda-vuota">Non riesco a leggere la memoria del dispositivo.</div>';
  });
}
function voceCoda(tipo, titolo, sotto, chiave){
  var icone={
    chiamata:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    modifica:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    modulo:'<rect x="3" y="2.5" width="18" height="19" rx="2.5"/><path d="M7.5 16.5V8.5l4.5 5 4.5-5v8"/>',
    allegato:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'
  };
  return '<div class="coda-riga" data-chiave="'+esc(chiave)+'">'
    +'<svg class="coda-ic coda-ic-'+tipo+'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+icone[tipo]+'</svg>'
    +'<span class="coda-testo"><b>'+esc(titolo)+'</b><span class="coda-sotto">'+esc(sotto)+'</span></span>'
    +'<button type="button" class="coda-del" title="Togli dalla coda: non verr\u00e0 inviato">'
      +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
    +'</button></div>';
}
function togliDallaCoda(chiave){
  var p=chiave.indexOf(':');
  var tipo=chiave.slice(0,p), id=chiave.slice(p+1);
  var lavoro;
  if(tipo==='ins') lavoro=Promise.resolve(syncDequeueInsert(id));
  else if(tipo==='upd') lavoro=Promise.resolve(syncDequeue(id));
  else if(tipo==='modm'){ delete moduliMLocali[id]; delete moduliMByCall[id]; lavoro=modmCodaCancella(id); }
  else if(tipo==='all') lavoro=allegCodaCancella(id);
  else lavoro=Promise.resolve();
  return Promise.resolve(lavoro).then(function(){
    return Promise.all([modmCaricaCodaInMappa(), allegCaricaCodaInMappa()]);
  }).then(function(){
    syncRenderBadge();
    disegnaElencoCoda();
    try{ injectModmUi(); injectAttachRows(); }catch(_){}
  });
}
if(typeof document!=='undefined'){
  document.addEventListener('click', function(e){
    if(!e.target || !e.target.closest) return;
    var del=e.target.closest('#codaElenco .coda-del');
    if(del){
      var riga=del.closest('.coda-riga');
      if(riga && window.confirm('Togliere questa voce dalla coda?\n\nNon verr\u00e0 inviata al server e i suoi dati andranno persi.')){
        togliDallaCoda(riga.dataset.chiave);
      }
      return;
    }
    if(e.target===document.getElementById('mcoda')) chiudi('mcoda');
    if(e.target.closest && e.target.closest('#btnCodaClose,#btnCodaChiudi2')) chiudi('mcoda');
    if(e.target.closest && e.target.closest('#btnCodaInvia')){
      drenaTuttoSubito(true);          // le pause per i fallimenti si azzerano
      setTimeout(disegnaElencoCoda, 1500);
    }
  });
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
  // Cattura SUBITO i dati: se la tabella venisse ridisegnata nel frattempo,
  // il salvataggio parte comunque da questi valori (nessuna perdita).
  var snapshot=null;
  try{ snapshot=buildPatchBodyFromRow(tr); }catch(_){}
  if(autosaveTimers[rowId])clearTimeout(autosaveTimers[rowId]);
  autosaveTimers[rowId]=setTimeout(function(){
    delete autosaveTimers[rowId];
    if(!dirtyMap[rowId])return;                       // già salvata altrove
    if(!document.body.contains(tr)){
      // Riga ridisegnata: salva dallo snapshot invece di perdere la modifica
      if(snapshot){ syncEnqueue(rowId,snapshot); syncProcess(); }
      delete dirtyMap[rowId];
      return;
    }
    if(tr.contains(document.activeElement)){
      // L'utente è ancora dentro la riga: RIPROVA più tardi (prima si arrendeva
      // e la modifica restava non salvata finché non usciva di nuovo dal campo)
      scheduleAutosave(tr);
      return;
    }
    silentAutoSave(tr,rowId);
  },AUTOSAVE_DELAY);
}

// Rete di sicurezza: ogni 8s salva le righe modificate che non sono in uso.
// Garantisce il salvataggio anche se l'evento di uscita dal campo non arriva.
function autosaveWatchdog(){
  var keys=Object.keys(dirtyMap);
  if(!keys.length)return;
  keys.forEach(function(rowId){
    var info=dirtyMap[rowId]; if(!info||!info.tr)return;
    var tr=info.tr;
    if(!document.body.contains(tr)){
      var body=null; try{ body=buildPatchBodyFromRow(tr); }catch(_){}
      if(body){ syncEnqueue(rowId,body); syncProcess(); }
      delete dirtyMap[rowId];
      return;
    }
    if(tr.contains(document.activeElement))return;  // ci sta scrivendo ora
    if(autosaveTimers[rowId])return;                // c'è già un salvataggio programmato
    silentAutoSave(tr,rowId);
  });
}
if(typeof window!=='undefined'){
  setInterval(autosaveWatchdog,8000);
  // Salva subito se l'app va in background (cambio app / schermo spento)
  document.addEventListener('visibilitychange',function(){
    if(document.hidden) autosaveWatchdog();
  });
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
  var patch=diffPatchBody(rowId, body, tsNow);
  var floppy=tr.querySelector('.isv');
  if(floppy){floppy.style.display='flex';floppy.classList.add('saving');floppy.innerHTML='<div class="spin-dark"></div>';}

  var onSuccess=function(){
    if(floppy){floppy.classList.remove('saving');floppy.innerHTML=svgFloppy();}
    delete dirtyMap[rowId];
    syncDequeue(rowId);
    tr.dataset.originalTs=tsNow;
    rowBase[String(rowId)]={postazione:po,descrizione:de,note:no,ts:tsNow};
    if(floppy)floppy.style.display='none';
    tr.classList.add('saved-pulse');
    setTimeout(function(){tr.classList.remove('saved-pulse');},900);
    // Ri-rileva eventuali numeri nuovi inseriti nella cella
    relinkifyRow(tr);
    // Indirizzo modificato: ricontrolla il CAP (aggiunge se manca, chiede se diverso)
    checkCapAfterEdit(rowId, de);
    // Aggiorna lastKnownUpdate per non triggerare banner per modifiche nostre
    fetchLatestUpdate().then(function(ts){if(ts)lastKnownUpdate=ts;});
  };
  var onFailure=function(){
    // Salvataggio fallito → metti in coda per riprovare quando c'è linea
    syncEnqueue(rowId,patch);
    if(floppy){floppy.classList.remove('saving');floppy.innerHTML=svgFloppy();floppy.style.display='none';}
    delete dirtyMap[rowId]; // rimosso da dirtyMap perché ora è in syncQueue
    tr.dataset.originalTs=tsNow;
    // Indicatore visivo "in attesa di sync" sulla riga
    tr.classList.add('pending-sync');
  };

  // Niente di cambiato rispetto alla base: nessun viaggio inutile
  if(!Object.keys(patch).length){
    if(floppy){floppy.classList.remove('saving');floppy.innerHTML=svgFloppy();floppy.style.display='none';}
    delete dirtyMap[rowId];
    tr.dataset.originalTs=tsNow;
    return;
  }

  // Se offline, accoda subito senza tentare
  if(typeof navigator!=='undefined'&&navigator.onLine===false){onFailure();return;}

  markOwnWrite();
  sbFetch('chiamate?id=eq.'+rowId,{method:'PATCH',body:patch,prefer:'return=minimal'})
    .then(function(res){if(res.ok)onSuccess();else onFailure();})
    .catch(function(){onFailure();});
}

// ── Base di confronto per riga ──────────────────────────────────────
// Quel che il server sapeva quando la riga e stata disegnata. Confrontando
// con la base, ogni salvataggio spedisce SOLO i campi davvero toccati: cosi
// cellulare e iPad che ritoccano campi diversi della stessa chiamata si
// fondono invece di sovrascriversi (l'ultimo vince solo sul campo suo).
var rowBase={};
function ricordaBaseRiga(r){
  if(!r || r.id==null) return;
  rowBase[String(r.id)]={
    postazione:r.postazione||'', descrizione:r.descrizione||'',
    note:r.note||'', ts:r.tsFormatted||''
  };
}
function diffPatchBody(rowId, body, tsNow){
  var base=rowBase[String(rowId)];
  if(!base) return body;                       // base ignota: tutto, come prima
  var out={};
  if(body.postazione!==base.postazione) out.postazione=body.postazione;
  if(body.descrizione!==base.descrizione) out.descrizione=body.descrizione;
  if(body.note!==base.note) out.note=body.note;
  if(body.timestamp_chiamata && tsNow!==base.ts) out.timestamp_chiamata=body.timestamp_chiamata;
  return out;
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
  var rowId=tr.dataset?tr.dataset.row:null;
  return rowId ? diffPatchBody(rowId, body, tsNow) : body;
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
    if(e.target.closest('.ph-link')||e.target.closest('.addr-link')||e.target.closest('.mail-link'))e.preventDefault();
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

    var mailEl=t.closest('.mail-link');
    if(mailEl){
      e.stopPropagation();e.preventDefault();
      if(document.activeElement&&typeof document.activeElement.blur==='function'){
        try{document.activeElement.blur();}catch(_e){}
      }
      var trMail=mailEl.closest('tr');
      var mailCallId=(trMail&&trMail.dataset.row)?parseInt(trMail.dataset.row):null;
      openMailChoice(mailEl.dataset.mail||mailEl.textContent, mailCallId);
      return;
    }
    // Le chiamate non ancora inviate hanno un'etichetta «local_…»: va tenuta
    // com'e, trasformarla in numero la renderebbe inservibile.
    var idModulo=function(el){
      var v=el.dataset.row||'';
      return (v.indexOf('local_')===0) ? v : parseInt(v,10);
    };
    var modmBtn2=t.closest('.iho-modm');
    if(modmBtn2){ e.stopPropagation(); modmApri(idModulo(modmBtn2)); return; }
    var modmLink=t.closest('.modm-link');
    if(modmLink){ e.stopPropagation(); modmApri(idModulo(modmLink)); return; }
    var modmDel=t.closest('.modm-del');
    if(modmDel){ e.stopPropagation(); modmPromptDelete(idModulo(modmDel)); return; }

    var attBtn=t.closest('.iho-attach');
    if(attBtn){
      e.stopPropagation();
      openAttachModal(idModulo(attBtn));
      return;
    }
    var attName=t.closest('.attach-name');
    if(attName){
      e.stopPropagation();e.preventDefault();
      var itDown=attName.closest('.attach-item');
      startAttachDownload(itDown.dataset.drive, itDown.dataset.name);
      return;
    }
    var attDel=t.closest('.attach-del');
    if(attDel){
      e.stopPropagation();e.preventDefault();
      var itDel=attDel.closest('.attach-item');
      promptAttachDelete(itDel.dataset.id, itDel.dataset.drive, itDel.dataset.name);
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
      var chiave='local_'+uuid;
      var quantiAll=(allegatiLocali[chiave]||[]).length;
      var haModulo=!!moduliMLocali[chiave];
      var extra='';
      if(quantiAll||haModulo){
        extra='\n\nVerranno eliminati anche '
          +(quantiAll?(quantiAll+' allegat'+(quantiAll===1?'o':'i')):'')
          +((quantiAll&&haModulo)?' e ':'')
          +(haModulo?'il Modulo M':'')+' in attesa di invio.';
      }
      if(window.confirm('Eliminare questa chiamata salvata in locale?\n\nNon è ancora stata inviata al server: verrà eliminata definitivamente e NON sarà recuperabile.'+extra)){
        syncDequeueInsert(uuid);
        // Via anche allegati e Modulo M che aspettavano questa chiamata,
        // altrimenti resterebbero in cassaforte senza piu un padrone.
        var puliz=[];
        (allegatiLocali[chiave]||[]).forEach(function(r){ puliz.push(allegCodaCancella(r.id)); });
        if(haModulo) puliz.push(modmCodaCancella(chiave));
        delete allegatiLocali[chiave];
        delete moduliMLocali[chiave];
        delete moduliMByCall[chiave];
        Promise.all(puliz).then(function(){
          return Promise.all([allegCaricaCodaInMappa(), modmCaricaCodaInMappa()]);
        }).then(function(){ loadRows(PAGE); syncRenderBadge(); });
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
  var txt = (clone.innerText || '').replace(/\u200B/g,'');
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
      checkCapAfterEdit(ri, de);
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

  // UI ottimistica: nascondi subito la riga E la sua riga allegati
  // (lasciarla orfana in cima all'elenco era il difetto dello screenshot)
  var trEl=document.querySelector('tr[data-row="'+ri+'"]');
  if(trEl){
    trEl.style.display='none';
    var acc=trEl.nextElementSibling;
    if(acc && acc.classList.contains('attach-row')) acc.style.display='none';
  }
  var accAltra=document.querySelector('tr.attach-row[data-for="'+ri+'"]');
  if(accAltra) accAltra.style.display='none';

  // I file su Drive seguono la chiamata nel cestino (e tornano col ripristino)
  drivePerChiamata('trash', ri);

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
  // I file su Drive tornano insieme alla chiamata (solo se si procede davvero)
  drivePerChiamata('untrash', id);
  if(rowEl){ rowEl.style.opacity='.5'; rowEl.style.pointerEvents='none'; }
  markOwnWrite();
  sbFetch('chiamate?id=eq.'+id,{method:'PATCH',body:{deleted_at:null},prefer:'return=minimal'}).then(function(res){
    if(res.ok){
      if(rowEl){
        rowEl.style.transition='opacity .25s,transform .25s';
        rowEl.style.opacity='0';rowEl.style.transform='translateX(-20px)';
        setTimeout(function(){
          if(rowEl.parentNode)rowEl.remove();
          var remaining=document.querySelectorAll('#trashList .trash-row').length;
          if(remaining===0)renderTrashList();
          refreshTrashBadge();
        },280);
      } else {
        renderTrashList(); refreshTrashBadge();
      }
      loadRows(PAGE);
      fb(true,'Ripristinata','Chiamata ripristinata.');
    } else {
      if(rowEl){ rowEl.style.opacity='';rowEl.style.pointerEvents=''; }
      fb(false,'Errore','Ripristino fallito.');
    }
  }).catch(function(){
    if(rowEl){ rowEl.style.opacity='';rowEl.style.pointerEvents=''; }
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
  // PRIMA i documenti su Drive: cancellate le righe non si saprebbe piu
  // quali file erano, e resterebbero abbandonati per sempre.
  var idsCestino=[];
  sbFetch('chiamate?deleted_at=not.is.null&select=id').then(function(r){ return r.json(); })
   .then(function(righe){
     if(Array.isArray(righe)) idsCestino=righe.map(function(x){ return x.id; });
     if(!idsCestino.length) return 0;
     if(btn) btn.innerHTML='<div class="spin"></div> Elimino i documenti…';
     return ripuliscDriveDiChiamate('chiamata_id=in.('+idsCestino.join(',')+')');
   })
   .catch(function(){ return 0; })
   .then(function(){
     if(btn) btn.innerHTML='<div class="spin"></div> Svuoto…';
     return sbFetch('chiamate?deleted_at=not.is.null',{method:'DELETE'});
   }).then(function(res){
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
  // Anche la pulizia automatica deve portarsi via i documenti su Drive
  sbFetch('chiamate?deleted_at=lt.'+cutoff+'&select=id').then(function(r){ return r.json(); })
   .then(function(righe){
     var ids=(Array.isArray(righe)?righe:[]).map(function(x){ return x.id; });
     if(!ids.length) return 0;
     return inSfondoDrive(function(){ return ripuliscDriveDiChiamate('chiamata_id=in.('+ids.join(',')+')'); });
   })
   .catch(function(){ return 0; })
   .then(function(){
     return sbFetch('chiamate?deleted_at=lt.'+cutoff,{method:'DELETE'});
   }).then(function(){}).catch(function(){});
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
    // La riga (e la sua riga allegati) tornano visibili subito
    var trV=document.querySelector('tr[data-row="'+rowId+'"]');
    if(trV){
      trV.style.display='';
      var accV=trV.nextElementSibling;
      if(accV && accV.classList.contains('attach-row')) accV.style.display='';
    }
    // E i file su Drive escono dal cestino
    drivePerChiamata('untrash', rowId);
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

// ── Con una finestra aperta la pagina dietro resta ferma ────────────
// Si conserva il punto in cui eravamo e lo si ripristina alla chiusura.
// Serve il blocco «duro» (pagina inchiodata) perche su iPhone e iPad il
// semplice overflow non basta a fermare il tiro verso il basso, che
// ricaricherebbe la pagina facendo perdere il lavoro in corso.
var _puntoPagina=0, _paginaFerma=false;
function aggiornaBloccoPagina(){
  var qualcunoAperto = !!document.querySelector('.mov.open');
  if(qualcunoAperto && !_paginaFerma){
    _puntoPagina = window.scrollY || window.pageYOffset || 0;
    document.body.style.position='fixed';
    document.body.style.top=(-_puntoPagina)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
    document.body.classList.add('pagina-ferma');
    _paginaFerma=true;
  } else if(!qualcunoAperto && _paginaFerma){
    document.body.classList.remove('pagina-ferma');
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    document.body.style.width='';
    _paginaFerma=false;
    window.scrollTo(0, _puntoPagina);
  }
}
function apri(id){
  var el=document.getElementById(id);
  if(!el) return;
  el.classList.add('open');
  aggiornaBloccoPagina();
}
function chiudi(id){
  var el=document.getElementById(id);
  if(!el) return;
  el.classList.remove('open');
  aggiornaBloccoPagina();
}


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

// Il "click sullo sfondo" chiude il modal SOLO se il gesto inizia e finisce
// davvero sullo sfondo. Senza questo controllo, selezionando del testo dentro al
// modal e rilasciando il mouse appena fuori, il browser genera comunque un click
// sullo sfondo e la finestra si chiudeva a sorpresa.
var _pressStart=null, _pressEnd=null;
document.addEventListener('pointerdown',function(e){ _pressStart=e.target; },true);
document.addEventListener('pointerup',  function(e){ _pressEnd=e.target;   },true);
document.addEventListener('mousedown',  function(e){ _pressStart=e.target; },true);
document.addEventListener('mouseup',    function(e){ _pressEnd=e.target;   },true);
function chiusuraDaSfondoValida(overlay){
  if(!overlay)return false;
  if(_pressStart && _pressStart!==overlay) return false;  // gesto iniziato DENTRO
  if(_pressEnd   && _pressEnd  !==overlay) return false;  // gesto finito DENTRO
  return true;
}

document.addEventListener('click',function(e){
  // Ignora i click "trascinati" da dentro il modal verso l'esterno
  if(e.target && e.target.classList && e.target.classList.contains('mov')
     && !chiusuraDaSfondoValida(e.target)) return;
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
  if(e.target===document.getElementById('mattach'))chiudi('mattach');
  if(e.target===document.getElementById('mattachDel')){chiudi('mattachDel');attachToDelete=null;}
  if(e.target===document.getElementById('mmail'))chiudi('mmail');
  if(e.target===document.getElementById('mmailChoice'))chiudi('mmailChoice');
  if(e.target===document.getElementById('mcap'))closeCapMismatch(); // = Mantieni
  if(e.target===document.getElementById('mmodm'))modmChiudi(false);
  if(e.target===document.getElementById('mmodmDel')){chiudi('mmodmDel');modmToDelete=null;}
  if(e.target===document.getElementById('mmodmSez'))modmChiudiSezione();
  if(e.target===document.getElementById('mmodmFirma'))modmFirmaConferma();
  if(e.target===document.getElementById('mmodmFirmaWarn'))chiudi('mmodmFirmaWarn');
  if(e.target===document.getElementById('mmodmSalva'))chiudi('mmodmSalva');
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

// Caricamento di una libreria esterna, una volta sola.
// Con un limite di tempo: senza, una rete che si impunta lasciava lo spinner
// a girare per sempre (ne onload ne onerror arrivano mai). Se e indicato il
// nome del globale, si controlla che sia davvero comparso.
var _scriptPromesse={};
var SCRIPT_ATTESA_MAX=20000;
function scriptGlobalePronto(nome){
  if(!nome) return true;
  var v=window;
  var parti=nome.split('.');
  for(var i=0;i<parti.length;i++){
    if(v==null) return false;
    v=v[parti[i]];
  }
  return v!==undefined && v!==null;
}
function loadScriptOnce(src, globale){
  if(scriptGlobalePronto(globale) && document.querySelector('script[src="'+src+'"]')) return Promise.resolve();
  if(_scriptPromesse[src]) return _scriptPromesse[src];
  var p=new Promise(function(resolve,reject){
    var vecchio=document.querySelector('script[src="'+src+'"]');
    if(vecchio){ try{ vecchio.parentNode.removeChild(vecchio); }catch(_){} }
    var s=document.createElement('script');
    s.src=src; s.async=true;
    var chiuso=false;
    var scadenza=setTimeout(function(){
      if(chiuso) return; chiuso=true;
      try{ s.parentNode.removeChild(s); }catch(_){}
      reject(new Error('script_lento'));
    }, SCRIPT_ATTESA_MAX);
    s.onload=function(){
      if(chiuso) return; chiuso=true; clearTimeout(scadenza);
      if(scriptGlobalePronto(globale)) resolve();
      else reject(new Error('script_incompleto'));
    };
    s.onerror=function(){
      if(chiuso) return; chiuso=true; clearTimeout(scadenza);
      try{ s.parentNode.removeChild(s); }catch(_){}
      reject(new Error('script_non_raggiungibile'));
    };
    document.head.appendChild(s);
  });
  _scriptPromesse[src]=p;
  p.catch(function(){ delete _scriptPromesse[src]; });   // fallita: si potra riprovare
  return p;
}

// Le librerie del PDF servono anche in campagna: le porto in cache appena
// l'app e in piedi, cosi il giorno che non c'e linea sono gia a bordo.
var PDF_LIB_H2C='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
var PDF_LIB_JSPDF='https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
function scaldaLibreriePdf(){
  if(!isOnline()) return;
  [PDF_LIB_H2C, PDF_LIB_JSPDF].forEach(function(u){
    try{ fetch(u,{cache:'force-cache'}).catch(function(){}); }catch(_){}
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
    return '\u200B<span class="ph-link" contenteditable="false" data-phone="'+digits+'" title="Tocca per chiamare">'+match+'</span>\u200B';
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
  // Tronca prima di un eventuale indirizzo email: non fa parte della via
  var mailAt=text.substring(0,idx).search(/\s\S*@\S+\.\S/);
  if(mailAt>5)idx=mailAt;
  // Tronca a fine frase (". X" con X maiuscola)
  var sub=text.substring(0,idx);
  var sent=sub.search(/\.\s+[A-ZÀ-Ü]/);
  if(sent>5)idx=sent;
  return idx;
}

// ═══════════════════════════════════════════════════════════════════
// CAP AUTOMATICO
// Livello 1 — tabella locale dei comuni serviti (CAP UNICO per comune,
//   verificato su fonte postale): certezza assoluta, istantaneo, offline.
// Livello 2 — ricerca su OpenStreetMap per gli altri comuni (es. Roma, dove
//   il CAP cambia via per via). Scrive SOLO se:
//     a) la ricerca è vincolata all'area operativa (niente omonimie lontane)
//     b) tutti i risultati concordano sullo stesso CAP
//     c) la via trovata corrisponde davvero a quella scritta
//   Se anche una sola condizione non regge → non scrive nulla.
// NB: per i piccoli comuni della Sabina OSM restituisce CAP errati
//     (es. Sant'Angelo Romano→00018 invece di 00010): per questo la
//     tabella locale ha SEMPRE la precedenza.
// ═══════════════════════════════════════════════════════════════════
var CAP_COMUNI={
  // Guidonia Montecelio e sue frazioni
  'guidonia montecelio':'00012','guidonia':'00012','montecelio':'00012',
  'villalba':'00012','villanova':'00012','setteville':'00012',
  'colleverde':'00012','colle verde':'00012','albuccione':'00012','la botte':'00012',
  // Comuni della Sabina serviti dalla postazione di Palombara
  'palombara sabina':'00018','palombara':'00018',
  'marcellina':'00010','monteflavio':'00010','montelibretti':'00010',
  'montorio romano':'00010','moricone':'00010',
  "sant'angelo romano":'00010','sant angelo romano':'00010','santangelo romano':'00010',
  'nerola':'00017',
  // Comuni limitrofi frequenti
  'mentana':'00013','fonte nuova':'00013'
};
// Riquadro dell'area operativa (lon1,lat1,lon2,lat2): Roma + Sabina
var CAP_VIEWBOX='12.20,41.60,13.20,42.30';
var CAP_CACHE_KEY='capCache_v1';

function hasCap(s){ return /\b\d{5}\b/.test(s||''); }

// Individua gli indirizzi nel testo GREZZO (stessa logica dei link)
function findAddressesInText(text){
  var re=new RegExp('\\b'+ADDR_TOPONIMI+'\\.?[\\s.]+\\w[^;\\n]{0,200}','gi');
  var out=[],m;
  while((m=re.exec(text))!==null){
    var end=computeAddressEnd(m[0]);
    var clean=m[0].substring(0,end).replace(/[\s.]+$/,'').trim();
    if(clean.length>=6) out.push({start:m.index, end:m.index+clean.length, text:clean});
  }
  return out;
}

// Livello 1: comune riconosciuto in tabella (vince il nome più lungo, così
// "villanova di guidonia" non viene scambiato per "guidonia")
function capFromTable(addrText){
  var t=' '+String(addrText||'').toLowerCase()+' ';
  var best=null,bestLen=0;
  for(var k in CAP_COMUNI){
    if(!CAP_COMUNI.hasOwnProperty(k))continue;
    if(t.indexOf(k)!==-1 && k.length>bestLen){ best=CAP_COMUNI[k]; bestLen=k.length; }
  }
  return best;
}

// Normalizza un nome di via per il confronto (toglie toponimo, accenti, punteggiatura)
function normRoad(s){
  return String(s||'').toLowerCase()
    .replace(/[àáâä]/g,'a').replace(/[èéêë]/g,'e').replace(/[ìíîï]/g,'i')
    .replace(/[òóôö]/g,'o').replace(/[ùúûü]/g,'u')
    .replace(new RegExp('^\\s*'+ADDR_TOPONIMI+'\\.?\\s+','i'),'')
    .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
// La via trovata deve corrispondere a quella scritta (evita falsi positivi:
// es. cercando "via Roma, Nerola" OSM propone "Strada Statale 4 Via Salaria")
function roadMatches(typed,found){
  var a=normRoad(typed.replace(/\d+.*$/,'')), b=normRoad(found);
  if(!a||!b)return false;
  if(a.indexOf(b)!==-1||b.indexOf(a)!==-1)return true;
  var ta=a.split(' ').filter(function(w){return w.length>3;});
  if(!ta.length)return false;
  return ta.every(function(w){ return b.indexOf(w)!==-1; });
}

function capCacheGet(key){
  try{
    var c=JSON.parse(localStorage.getItem(CAP_CACHE_KEY)||'{}');
    var e=c[key];
    if(e && (Date.now()-e.ts)<90*86400000) return e.v; // 90 giorni
  }catch(_){}
  return undefined;
}
function capCacheSet(key,val){
  try{
    var c=JSON.parse(localStorage.getItem(CAP_CACHE_KEY)||'{}');
    c[key]={v:val,ts:Date.now()};
    var keys=Object.keys(c);
    if(keys.length>300){ delete c[keys[0]]; }
    localStorage.setItem(CAP_CACHE_KEY,JSON.stringify(c));
  }catch(_){}
}

// Livello 2: ricerca online vincolata + tripla verifica
function capFromOnline(addrText){
  var key=String(addrText||'').toLowerCase().replace(/\s+/g,' ').trim();
  var cached=capCacheGet(key);
  if(cached!==undefined) return Promise.resolve(cached);
  if(!isOnline()) return Promise.resolve(null);
  var url='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=it&limit=5'
        + '&viewbox='+CAP_VIEWBOX+'&bounded=1&q='+encodeURIComponent(addrText);
  return fetch(url,{headers:{'Accept':'application/json'}})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(list){
      var val=null;
      if(Array.isArray(list)&&list.length){
        var pcs=[];
        list.forEach(function(x){
          var pc=x&&x.address&&x.address.postcode;
          if(pc&&pcs.indexOf(pc)===-1)pcs.push(pc);
        });
        // (b) tutti i risultati devono concordare
        if(pcs.length===1){
          var low=' '+String(addrText).toLowerCase()+' ';
          var okRoad=false, okCity=false;
          list.forEach(function(x){
            var ad=x&&x.address; if(!ad)return;
            // (c) la via trovata deve corrispondere a quella scritta
            if(roadMatches(addrText, ad.road)) okRoad=true;
            // (d) il comune trovato deve essere SCRITTO nell'indirizzo: senza comune
            //     non c'è modo di distinguere vie omonime in paesi diversi
            var com=ad.city||ad.town||ad.village||ad.municipality||'';
            if(com && low.indexOf(com.toLowerCase())!==-1) okCity=true;
          });
          if(okRoad&&okCity) val=pcs[0];
        }
      }
      capCacheSet(key,val);
      return val;
    }).catch(function(){ return null; });
}

// Aggiunge i CAP mancanti nel testo. Ritorna Promise<{text, changed}>.
// onlineAllowed=false → usa solo la tabella locale (istantaneo, offline)
function addMissingCaps(text, onlineAllowed){
  var addrs=findAddressesInText(text||'');
  if(!addrs.length) return Promise.resolve({text:text, changed:false});
  var todo=addrs.filter(function(a){ return !hasCap(a.text); });
  if(!todo.length) return Promise.resolve({text:text, changed:false});

  return Promise.all(todo.map(function(a){
    var local=capFromTable(a.text);
    if(local) return Promise.resolve({a:a, cap:local});
    if(!onlineAllowed) return Promise.resolve({a:a, cap:null});
    return capFromOnline(a.text).then(function(cap){ return {a:a, cap:cap}; });
  })).then(function(res){
    var found=res.filter(function(x){ return !!x.cap; });
    if(!found.length) return {text:text, changed:false};
    // Inserisce dal fondo all'inizio per non invalidare le posizioni
    found.sort(function(x,y){ return y.a.end - x.a.end; });
    var out=text;
    found.forEach(function(x){
      out = out.slice(0, x.a.end) + ' ' + x.cap + out.slice(x.a.end);
    });
    return {text:out, changed:true};
  });
}

// Variante SINCRONA solo-tabella: nessuna rete, usabile prima del salvataggio
// (così il CAP dei comuni serviti c'è subito, anche senza linea)
function addCapsLocalSync(text){
  var addrs=findAddressesInText(text||'');
  var found=[];
  addrs.forEach(function(a){
    if(hasCap(a.text))return;
    var cap=capFromTable(a.text);
    if(cap)found.push({a:a,cap:cap});
  });
  if(!found.length)return text;
  found.sort(function(x,y){ return y.a.end - x.a.end; });
  var out=text;
  found.forEach(function(x){ out = out.slice(0,x.a.end)+' '+x.cap+out.slice(x.a.end); });
  return out;
}

// Completa via rete i CAP di una chiamata appena salvata (identificata dal client_uuid)
function enrichNewCallCap(clientUuid, text){
  if(!isOnline())return;
  var rimasti=findAddressesInText(text||'').filter(function(a){ return !hasCap(a.text); });
  if(!rimasti.length)return;
  sbFetch('chiamate?client_uuid=eq.'+encodeURIComponent(clientUuid)+'&select=id,descrizione')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      if(!Array.isArray(rows)||!rows.length)return;
      enrichCallCapAsync(rows[0].id, rows[0].descrizione||text);
    }).catch(function(){});
}

// ── CAP sulle chiamate GIÀ IN ARCHIVIO ──────────────────────────────
var capEnrichDone={};   // id già valutati in questa sessione (evita ripassaggi)

// Ridisegna l'elenco SOLO se non c'è nulla in sospeso: un redraw mentre l'utente
// sta scrivendo azzera dirtyMap e stacca la riga → la modifica andrebbe persa.
// Ricarica di servizio: silenziosa, e comunque mai mentre stai scrivendo
function safeReloadRows(){
  if(Object.keys(dirtyMap).length>0)return;
  if(isUserBusy())return;
  loadRows(PAGE, {silenzioso:true});
}

// Riscrive la cella descrizione senza ricaricare tutto (niente sfarfallio/loop)
function updateRowDescInPlace(id,text){
  var tr=document.querySelector('tr[data-row="'+id+'"]');
  if(!tr)return;
  var cell=tr.querySelector('[data-field="descrizione"]');
  if(!cell)return;
  if(document.activeElement===cell)return;      // l'utente ci sta scrivendo: non toccare
  if(dirtyMap[String(id)])return;               // modifiche non ancora salvate: non toccare
  var badge=cell.querySelector(':scope > .girata-badge');
  var prefix=badge?(badge.outerHTML+'<br>'):'';
  cell.innerHTML=prefix+linkifyAll(esc(text));
}

function patchCapOnCall(id,text){
  capEnrichDone[id]=true;
  markOwnWrite();
  return sbFetch('chiamate?id=eq.'+id,{method:'PATCH',body:{descrizione:text},prefer:'return=minimal'})
    .then(function(res){ if(res.ok) updateRowDescInPlace(id,text); })
    .catch(function(){});
}

// Coda online throttlata (il servizio mappe consente ~1 richiesta al secondo)
function processOnlineCapQueue(list){
  if(!list||!list.length||!isOnline())return;
  var i=0;
  var step=function(){
    if(i>=list.length)return;
    var item=list[i++];
    addMissingCaps(item.text,true).then(function(r){
      if(r.changed&&r.text!==item.text) patchCapOnCall(item.id,r.text);
      else capEnrichDone[item.id]=true;
      setTimeout(step,1300);
    }).catch(function(){ capEnrichDone[item.id]=true; setTimeout(step,1300); });
  };
  step();
}

// Completa i CAP delle chiamate visibili nella pagina corrente
function enrichVisibleCallsCap(records){
  if(!records||!records.length)return;
  var online=[];
  records.forEach(function(r){
    if(!r.id||String(r.id).indexOf('local_')===0)return;
    if(capEnrichDone[r.id])return;
    if(dirtyMap[String(r.id)])return;     // modifiche in corso: non interferire
    var txt=r.descrizione||'';
    if(!txt)return;
    var senzaCap=findAddressesInText(txt).filter(function(a){ return !hasCap(a.text); });
    if(!senzaCap.length){ capEnrichDone[r.id]=true; return; }
    var conTabella=addCapsLocalSync(txt);
    if(conTabella!==txt) patchCapOnCall(r.id,conTabella);   // certo e immediato
    else online.push({id:r.id,text:txt});                   // serve la ricerca online
  });
  processOnlineCapQueue(online.slice(0,6)); // max 6 ricerche online per pagina
}

// Passata unica sull'intero archivio con la SOLA tabella locale (certa e senza
// rete): completa in un colpo tutte le chiamate dei comuni serviti.
function capBackfillArchive(){
  var KEY='capBackfill_v1';
  try{ if(localStorage.getItem(KEY)==='done')return; }catch(_){}
  sbFetch('chiamate?deleted_at=is.null&select=id,descrizione&limit=1000')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      if(!Array.isArray(rows)){ return; }
      var updates=[];
      rows.forEach(function(r){
        var t=r.descrizione||'';
        if(!t)return;
        var n=addCapsLocalSync(t);
        if(n!==t) updates.push({id:r.id,text:n});
      });
      if(!updates.length){ try{localStorage.setItem(KEY,'done');}catch(_){} return; }
      var i=0;
      var next=function(){
        if(i>=updates.length){
          try{localStorage.setItem(KEY,'done');}catch(_){}
          safeReloadRows();
          fb(true,'CAP completati',updates.length+' chiamat'+(updates.length===1?'a aggiornata':'e aggiornate')+' con il CAP mancante.');
          return;
        }
        var chunk=updates.slice(i,i+10); i+=10;
        markOwnWrite();
        Promise.all(chunk.map(function(u){
          capEnrichDone[u.id]=true;
          return sbFetch('chiamate?id=eq.'+u.id,{method:'PATCH',body:{descrizione:u.text},prefer:'return=minimal'}).catch(function(){});
        })).then(function(){ setTimeout(next,200); });
      };
      next();
    }).catch(function(){});
}

// ── CONTROLLO CAP DOPO UNA MODIFICA DELL'INDIRIZZO ──────────────────
// Se manca → lo aggiunge da solo. Se c'è ma risulta diverso → chiede conferma.
var capMismatchAsked={};     // già proposto in questa sessione: non insistere
var capMismatchQueue=[];
var capMismatchCurrent=null;

function checkCapAfterEdit(callId, text){
  if(!callId||!text)return;
  if(String(callId).indexOf('local_')===0)return;
  var addrs=findAddressesInText(text);
  if(!addrs.length)return;

  Promise.all(addrs.map(function(a){
    var m=a.text.match(/\b(\d{5})\b/);
    var attuale=m?m[1]:null;
    var locale=capFromTable(a.text);
    if(locale) return Promise.resolve({a:a, atteso:locale, attuale:attuale});
    if(!isOnline()) return Promise.resolve(null);
    return capFromOnline(a.text).then(function(c){ return c?{a:a, atteso:c, attuale:attuale}:null; });
  })).then(function(res){
    var items=res.filter(Boolean);
    if(!items.length)return;

    // 1) CAP mancante → inserimento automatico
    var mancanti=items.filter(function(x){ return !x.attuale; });
    if(mancanti.length){
      var out=text;
      mancanti.sort(function(x,y){ return y.a.end-x.a.end; });
      mancanti.forEach(function(x){ out=out.slice(0,x.a.end)+' '+x.atteso+out.slice(x.a.end); });
      if(out!==text) patchCapOnCall(callId,out);
    }

    // 2) CAP presente ma diverso → chiedi conferma
    items.filter(function(x){ return x.attuale && x.attuale!==x.atteso; })
         .forEach(function(x){
      var key=callId+'|'+x.a.text+'|'+x.atteso;
      if(capMismatchAsked[key])return;
      capMismatchAsked[key]=true;
      capMismatchQueue.push({callId:callId, addr:x.a.text, attuale:x.attuale, atteso:x.atteso});
    });
    showNextCapMismatch();
  }).catch(function(){});
}

function showNextCapMismatch(){
  if(capMismatchCurrent)return;                       // una alla volta
  if(!capMismatchQueue.length)return;
  if(document.querySelector('.mov.open'))return;       // non accavallarsi ad altri modali
  capMismatchCurrent=capMismatchQueue.shift();
  var it=capMismatchCurrent;
  var msg=document.getElementById('mcapMsg');
  if(msg){
    msg.innerHTML='Per questo indirizzo:<div class="cap-addr">'+esc(it.addr)+'</div>'
      +'risulta il CAP <b>'+esc(it.atteso)+'</b>, ma nella chiamata è scritto <b>'+esc(it.attuale)+'</b>.'
      +'<br><br>Vuoi correggerlo?';
  }
  var k=document.getElementById('capKeepVal'); if(k)k.textContent=it.attuale;
  var f=document.getElementById('capFixVal');  if(f)f.textContent=it.atteso;
  apri('mcap');
}

function closeCapMismatch(){
  chiudi('mcap');
  capMismatchCurrent=null;
  setTimeout(showNextCapMismatch,350);   // eventuale successivo in coda
}

// Sostituisce il CAP SOLO dentro quell'indirizzo (non altrove nel testo)
function applyCapCorrection(){
  var it=capMismatchCurrent;
  if(!it){ closeCapMismatch(); return; }
  sbFetch('chiamate?id=eq.'+it.callId+'&select=descrizione')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      var t=(rows&&rows[0]&&rows[0].descrizione)||'';
      var idx=t.indexOf(it.addr);
      if(idx===-1){ closeCapMismatch(); return; }
      var seg=t.slice(idx, idx+it.addr.length);
      var segNew=seg.replace(new RegExp('\\b'+it.attuale+'\\b'), it.atteso);
      if(segNew===seg){ closeCapMismatch(); return; }
      var out=t.slice(0,idx)+segNew+t.slice(idx+it.addr.length);
      return patchCapOnCall(it.callId,out).then(function(){
        fb(true,'CAP corretto','Aggiornato in '+it.atteso+'.');
      });
    })
    .catch(function(){})
    .then(function(){ closeCapMismatch(); });
}

function setupCapWiring(){
  var keep=document.getElementById('btnCapKeep');
  if(keep) keep.addEventListener('click', closeCapMismatch);
  var fix=document.getElementById('btnCapFix');
  if(fix) fix.addEventListener('click', applyCapCorrection);
}

// Dopo il salvataggio: completa i CAP che richiedono la ricerca online
function enrichCallCapAsync(callId, text){
  if(!callId || !isOnline()) return;
  addMissingCaps(text, true).then(function(r){
    if(!r.changed || r.text===text) return;
    markOwnWrite();
    sbFetch('chiamate?id=eq.'+callId,{method:'PATCH',body:{descrizione:r.text},prefer:'return=minimal'})
      .then(function(res){ if(res.ok) safeReloadRows(); })
      .catch(function(){});
  });
}

// ───────────────────────────────────────────────────────────
// CLICK-TO-MAIL: trasforma gli indirizzi email in link cliccabili
// ───────────────────────────────────────────────────────────
// Applica una regex SOLO al testo fuori dai tag HTML: così non tocca mai
// gli attributi (data-phone, data-addr, class, title…) già generati.
function replaceOutsideTags(html, re, fn){
  var out='', last=0, tagRe=/<[^>]*>/g, m;
  while((m=tagRe.exec(html))!==null){
    out += html.slice(last, m.index).replace(re, fn);
    out += m[0];
    last = tagRe.lastIndex;
  }
  out += html.slice(last).replace(re, fn);
  return out;
}

var EMAIL_RE=/(?<![\w.%+\-@])[A-Za-z0-9._%+\-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?![\w\-@])/g;

function linkifyEmails(html){
  return replaceOutsideTags(html, EMAIL_RE, function(match){
    var addr=match.toLowerCase();
    return '\u200B<span class="mail-link" contenteditable="false" data-mail="'+escAttr(addr)+'" title="Tocca per inviare una mail">'+match+'</span>\u200B';
  });
}

// Pipeline unica: telefoni → indirizzi → email (le email per ultime, così i
// pattern precedenti non possono spezzarle e viceversa)
function linkifyAll(html){
  return linkifyEmails(linkifyAddresses(linkifyPhones(html)));
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
    return '\u200B<span class="addr-link" contenteditable="false" data-addr="'+query+'" title="Tocca per aprire mappa">'+clean+'</span>\u200B'+rest;
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
    // innerText preserva gli a-capo (<br>/<div>) solo se il nodo è renderizzato:
    // attacco il clone fuori schermo, leggo, stacco.
    clone.style.position='absolute';clone.style.left='-99999px';clone.style.top='0';clone.style.whiteSpace='pre-wrap';
    document.body.appendChild(clone);
    var raw=(clone.innerText||'').replace(/\u200B/g,'');
    if(clone.parentNode)clone.parentNode.removeChild(clone);
    var newBody=linkifyAll(esc(raw));
    var newHtml=preservedPrefix+newBody;
    if(newHtml!==cell.innerHTML)cell.innerHTML=newHtml;
  });
}


// ═══════════════════════════════════════════════════════════════════
// ALLEGATI: upload/download/delete file su Google Drive (scope drive.file)
// - Token via Google Identity Services (GIS), client-side, nessun secret
// - Cartella "allegati CA" creata/riusata nel Drive dell'utente collegato
// - Metadati in tabella `allegati` (chiamata_id → drive_file_id, nome, ...)
// ═══════════════════════════════════════════════════════════════════
var DRIVE_FOLDER_NAME='allegati CA';
var driveTokenClient=null;
var driveAccessToken=null;
var driveTokenExpiry=0;
var driveFolderId=null;
var attachmentsByCall={};       // { chiamata_id(str): [ {id, drive_file_id, file_name, ...} ] }
var attachModalCallId=null;     // chiamata target del modal upload
var attachToDelete=null;        // { id, drive_file_id, file_name }

function driveConfigured(){
  return typeof GOOGLE_OAUTH_CLIENT_ID==='string' && GOOGLE_OAUTH_CLIENT_ID.indexOf('.apps.googleusercontent.com')!==-1;
}
function isOnline(){ return !(typeof navigator!=='undefined' && navigator.onLine===false); }

function loadGisLibrary(){ return loadScriptOnce('https://accounts.google.com/gsi/client'); }

function initDriveTokenClient(){
  return loadGisLibrary().then(function(){
    if(!window.google || !google.accounts || !google.accounts.oauth2) throw new Error('GIS non disponibile');
    if(!driveTokenClient){
      driveTokenClient=google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: function(){}
      });
    }
  });
}

// Ottiene un access token Drive.
// - Cache in memoria + localStorage: il token (valido ~1h) viene RIUSATO tra ricariche
//   e riaperture dell'app → niente più richiesta di accesso "ogni volta".
// - requestAccessToken() SENZA override prompt: Google mostra il consenso solo quando
//   serve davvero (token mancante/scaduto), non ad ogni operazione. (NB: prompt:'' con
//   GIS fallisce senza UI se non c'è già un consenso → per questo non si usa.)
var DRIVE_TOK_KEY='driveTok_v1';

function ricordaToken(tok, durataSec){
  driveAccessToken=tok;
  driveTokenExpiry=Date.now()+((durataSec||3600)*1000);
  try{ localStorage.setItem(DRIVE_TOK_KEY, JSON.stringify({t:driveAccessToken, exp:driveTokenExpiry})); }catch(_){}
  driveNascondiInvito();
  return driveAccessToken;
}

// ── La cassaforte: il permesso duraturo sta sul server, mai nel browser ──
// Autorizzata una volta, da qui in poi ogni dispositivo chiede il proprio
// lasciapassare e lo riceve senza alcuna finestra.
var _cassafortePromessa=null;
var cassaforteVuota=false;      // sappiamo gia che nessuno ha ancora autorizzato
function tokenDaCassaforte(){
  if(cassaforteVuota) return Promise.reject(new Error('cassaforte_vuota'));
  if(_cassafortePromessa) return _cassafortePromessa;
  _cassafortePromessa=fetch(SUPABASE_URL+'/functions/v1/google-token',{
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,
             'Authorization':'Bearer '+(currentJwt||SUPABASE_ANON_KEY)},
    body:JSON.stringify({azione:'token'})
  }).then(function(r){ return r.json().then(function(j){ return {stato:r.status, dati:j}; }); })
    .then(function(x){
      _cassafortePromessa=null;
      if(x.stato===404 || (x.dati && x.dati.errore==='non_autorizzata')){
        cassaforteVuota=true;                       // serve la prima autorizzazione
        throw new Error('cassaforte_vuota');
      }
      if(!x.dati || !x.dati.access_token) throw new Error('cassaforte_ko');
      return ricordaToken(x.dati.access_token, x.dati.expires_in);
    }).catch(function(e){ _cassafortePromessa=null; throw e; });
  return _cassafortePromessa;
}

// Chiede il permesso a Google dentro il browser.
// silenzioso = nessuna finestra: riesce se il consenso e gia stato dato.
function tokenDaBrowser(silenzioso){
  if(!driveConfigured()) return Promise.reject(new Error('drive_not_configured'));
  return initDriveTokenClient().then(function(){
    return new Promise(function(resolve,reject){
      var chiuso=false;
      var scadenza=setTimeout(function(){
        if(chiuso) return; chiuso=true; reject(new Error('token_lento'));
      }, silenzioso ? 8000 : 120000);
      driveTokenClient.callback=function(resp){
        if(chiuso) return; chiuso=true; clearTimeout(scadenza);
        if(resp && resp.access_token) resolve(ricordaToken(resp.access_token, resp.expires_in));
        else reject(new Error((resp&&resp.error)||'no_token'));
      };
      driveTokenClient.error_callback=function(err){
        if(chiuso) return; chiuso=true; clearTimeout(scadenza);
        reject(new Error((err&&err.type)||'popup_error'));
      };
      try{
        // prompt vuoto = «rinnova senza disturbare»; Google apre la finestra
        // solo se il consenso manca davvero.
        driveTokenClient.requestAccessToken(silenzioso ? {prompt:''} : {});
      }catch(e){ if(!chiuso){ chiuso=true; clearTimeout(scadenza); reject(e); } }
    });
  });
}

// Quante operazioni di sfondo sono in corso: finche e maggiore di zero
// nessuna finestra di Google puo aprirsi.
var driveInSfondo=0;
function inSfondoDrive(lavoro){
  driveInSfondo++;
  var giu=function(v){ driveInSfondo=Math.max(0,driveInSfondo-1); return v; };
  // Accetta sia una funzione (protetta fin dal primo istante) sia una
  // promessa gia avviata: la forma con funzione e la piu sicura.
  var p = (typeof lavoro==='function') ? Promise.resolve().then(lavoro) : Promise.resolve(lavoro);
  return p.then(giu, function(e){ giu(); throw e; });
}
// Distinguere «sto scrivendo» da «ho appena toccato un comando»: nel primo
// caso nessuna finestra puo aprirsi, nel secondo e l'utente che l'ha chiesta.
var _ultimoTasto=0, _ultimoTocco=0;
if(typeof document!=='undefined'){
  document.addEventListener('keydown', function(){ _ultimoTasto=Date.now(); }, true);
  document.addEventListener('pointerdown', function(){ _ultimoTocco=Date.now(); }, true);
  document.addEventListener('mousedown', function(){ _ultimoTocco=Date.now(); }, true);
}
function staScrivendo(){
  // Un tocco piu recente dell'ultimo tasto: e un comando dato adesso, si passa
  if(_ultimoTocco > _ultimoTasto && (Date.now()-_ultimoTocco) < 3000) return false;
  return (Date.now()-_ultimoTasto) < 4000;
}

// interattivo=false → non aprire MAI finestre (controlli di sfondo)
function getDriveToken(interattivo){
  if(interattivo===undefined) interattivo=true;
  // Nessuna finestra a sorpresa: né durante un invio automatico, né mentre
  // stai scrivendo. In quei casi si accende l'invito e si riprova dopo.
  if(interattivo && (driveInSfondo>0 || staScrivendo())) interattivo=false;
  if(driveAccessToken && Date.now() < driveTokenExpiry-60000) return Promise.resolve(driveAccessToken);
  try{
    var cached=JSON.parse(localStorage.getItem(DRIVE_TOK_KEY)||'null');
    if(cached && cached.t && Date.now() < cached.exp-60000){
      driveAccessToken=cached.t; driveTokenExpiry=cached.exp;
      return Promise.resolve(driveAccessToken);
    }
  }catch(_){}
  // 1) la cassaforte: nessuna finestra, funziona su ogni dispositivo
  return tokenDaCassaforte()
    .catch(function(){ return tokenDaBrowser(true); })    // 2) rinnovo silenzioso
    .catch(function(e){
      if(interattivo) return tokenDaBrowser(false);       // 3) solo ora si chiede
      driveMostraInvito();
      throw e;
    });
}

// Prima autorizzazione, quella che si fa UNA VOLTA SOLA: si chiede a Google un
// permesso duraturo e lo si consegna alla cassaforte sul server.
function autorizzaDrivePerSempre(){
  if(!driveConfigured()) return Promise.reject(new Error('drive_not_configured'));
  return loadGisLibrary().then(function(){
    return new Promise(function(resolve,reject){
      var cliente=google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        ux_mode: 'popup',
        select_account: false,
        callback: function(resp){
          if(resp && resp.code) resolve(resp.code);
          else reject(new Error((resp&&resp.error)||'no_code'));
        },
        error_callback: function(err){ reject(new Error((err&&err.type)||'popup_error')); }
      });
      try{ cliente.requestCode(); }catch(e){ reject(e); }
    });
  }).then(function(code){
    return fetch(SUPABASE_URL+'/functions/v1/google-token',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,
               'Authorization':'Bearer '+(currentJwt||SUPABASE_ANON_KEY)},
      body:JSON.stringify({azione:'autorizza', code:code})
    });
  }).then(function(r){ return r.json(); }).then(function(j){
    if(j && j.errore==='serve_riautorizzazione'){
      // Google non ha dato il permesso duraturo perche l'accesso era gia
      // concesso: lo si revoca e si riautorizza. Succede una volta sola.
      throw Object.assign(new Error('serve_riautorizzazione'), {token:j.access_token});
    }
    if(!j || !j.access_token) throw new Error((j&&j.errore)||'cassaforte_ko');
    cassaforteVuota=false;
    return ricordaToken(j.access_token, j.expires_in);
  });
}

// Revoca l'accesso attuale e riautorizza da zero: serve quando Google
// riconosce un consenso vecchio e non rilascia il permesso duraturo.
function riautorizzaDriveDaZero(tokenDaRevocare){
  return new Promise(function(resolve){
    try{
      if(tokenDaRevocare && window.google && google.accounts && google.accounts.oauth2){
        google.accounts.oauth2.revoke(tokenDaRevocare, function(){ resolve(); });
        setTimeout(resolve, 2500);
      } else resolve();
    }catch(_){ resolve(); }
  }).then(function(){
    clearDriveToken();
    return autorizzaDrivePerSempre();
  });
}
// ── Controllo autorizzazione all'avvio ──────────────────────────────
// Verifica il token in parallelo al caricamento, senza disturbare. Se serve
// una nuova autorizzazione mostra l'invito: il consenso Google puo aprirsi
// solo da un tocco dell'utente (i browser bloccano le finestre "a freddo").
var driveWarmupUltimo=0;
function driveTokenValidoOra(){
  if(driveAccessToken && Date.now()<driveTokenExpiry-60000) return true;
  try{
    var c=JSON.parse(localStorage.getItem(DRIVE_TOK_KEY)||'null');
    return !!(c && c.t && Date.now()<c.exp-60000);
  }catch(_){ return false; }
}
function driveWarmup(forza){
  if(!driveConfigured() || !isOnline() || !currentUser) return;
  if(!forza && Date.now()-driveWarmupUltimo<5*60000) return;   // max una volta ogni 5 minuti
  driveWarmupUltimo=Date.now();
  if(!driveTokenValidoOra()){
    // Prima di disturbare: cassaforte e rinnovo silenzioso, senza finestre
    getDriveToken(false).then(function(){ driveNascondiInvito(); }).catch(function(){ driveMostraInvito(); });
    return;
  }
  // Il token sembra buono: verifica vera con una chiamata leggerissima
  inSfondoDrive(getDriveToken(false).then(function(tok){
    return fetch('https://www.googleapis.com/drive/v3/about?fields=user',{headers:{'Authorization':'Bearer '+tok}});
  }).then(function(r){
    if(r.status===401 || r.status===403){ clearDriveToken(); driveMostraInvito(); }
    else if(r.ok){ driveNascondiInvito(); }
  })).catch(function(){ /* rete instabile: non disturbare */ });
}
function driveMostraInvito(){
  if(document.getElementById('driveBanner')) return;
  var b=document.createElement('div');
  b.id='driveBanner';
  b.className='drive-banner';
  b.setAttribute('role','button');
  b.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M8.5 3.5h7L22 15l-3.5 6h-13L2 15z" opacity="0"/><path d="M9 3.5L2.5 15 6 21h12l3.5-6L15 3.5z" opacity="0"/><path d="M9 3.5h6L21.5 15H15z"/><path d="M9 3.5L2.5 15l3 5.5L12 9z"/><path d="M6.5 20.5h11l3-5.5H9.5z"/></svg>'
    +'<span><b>Google Drive da attivare</b> &mdash; tocca qui per allegati e Moduli M</span>';
  b.addEventListener('click',function(){
    if(b.classList.contains('busy')) return;
    b.classList.add('busy');
    clearDriveToken();
    // Si autorizza UNA volta sola: il permesso duraturo va in cassaforte sul
    // server e da li in poi vale per questo e per ogni altro dispositivo.
    autorizzaDrivePerSempre().catch(function(e){
      // Consenso vecchio in mezzo: si revoca e si rifa, una volta sola
      if(e && e.message==='serve_riautorizzazione') return riautorizzaDriveDaZero(e.token);
      throw e;
    }).then(function(){
      driveNascondiInvito();
      fb(true,'Google Drive autorizzato','Fatto una volta sola: da ora vale su questo e su ogni altro dispositivo, senza piu richieste.');
    }).catch(function(e){
      // Se la cassaforte non e disponibile si ripiega sul permesso di un'ora
      return getDriveToken(true).then(function(){
        driveNascondiInvito();
        fb(true,'Google Drive attivo','Allegati e Moduli M sono pronti.');
      });
    }).catch(function(){
      b.classList.remove('busy');
      fb(false,'Autorizzazione non riuscita','Tocca di nuovo l\'avviso per riprovare.');
    });
  });
  document.body.appendChild(b);
}
function driveNascondiInvito(){
  var b=document.getElementById('driveBanner');
  if(b) b.remove();
}

// Invalida il token in cache (usato su 401 dal server Drive)
function clearDriveToken(){
  driveAccessToken=null; driveTokenExpiry=0;
  try{ localStorage.removeItem(DRIVE_TOK_KEY); }catch(_){}
}

function driveFetch(url,opts){
  opts=opts||{};
  var doIt=function(token){
    var headers={};
    if(opts.headers){ for(var k in opts.headers){ if(opts.headers.hasOwnProperty(k)) headers[k]=opts.headers[k]; } }
    headers['Authorization']='Bearer '+token;
    return fetch(url,{method:opts.method||'GET',headers:headers,body:opts.body});
  };
  // Se chi chiama sta lavorando di sfondo, nessuna finestra: al massimo
  // l'operazione fallisce e si riprova al giro dopo.
  var puoChiedere = (opts.automatico===true) ? false : true;
  return getDriveToken(puoChiedere).then(doIt).then(function(r){
    // Permesso scaduto o revocato → si butta la copia e si riprova UNA volta
    if(r.status===401){
      clearDriveToken();
      cassaforteVuota=false;      // si ritenta anche la cassaforte
      return getDriveToken(puoChiedere).then(doIt);
    }
    return r;
  });
}

// Trova o crea la cartella "allegati CA" (con drive.file vede solo i propri file)
function ensureDriveFolder(){
  if(driveFolderId) return Promise.resolve(driveFolderId);
  var q=encodeURIComponent("name='"+DRIVE_FOLDER_NAME+"' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  return driveFetch('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name)&spaces=drive')
    .then(function(r){return r.json();})
    .then(function(data){
      if(data && data.files && data.files.length){ driveFolderId=data.files[0].id; return driveFolderId; }
      return driveFetch('https://www.googleapis.com/drive/v3/files?fields=id',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({name:DRIVE_FOLDER_NAME, mimeType:'application/vnd.google-apps.folder'})
      }).then(function(r){return r.json();}).then(function(f){ driveFolderId=f.id; return driveFolderId; });
    });
}

// Sul Drive ogni file va con un nome UNIVOCO (suffisso data+caso), cosi dieci
// "print.pdf" convivono senza sovrascritture ne ambiguita. L'utente non se ne
// accorge: in app si mostra sempre il nome originale, e l'apertura avviene
// per identificativo, mai per nome.
function driveNomeUnivoco(nome){
  nome=String(nome||'documento');
  var punto=nome.lastIndexOf('.');
  var base=(punto>0)?nome.slice(0,punto):nome;
  var ext=(punto>0)?nome.slice(punto):'';
  var d=new Date();
  var pd=function(x){return String(x).padStart(2,'0');};
  var stampo=pd(d.getDate())+pd(d.getMonth()+1)+String(d.getFullYear()).slice(-2)
    +'-'+pd(d.getHours())+pd(d.getMinutes())+pd(d.getSeconds());
  var caso=Math.random().toString(36).slice(2,6);
  return base+' ['+stampo+'-'+caso+']'+ext;
}

// Upload multipart di un File → {id, name, mimeType, size}
function driveUpload(file){
  return ensureDriveFolder().then(function(folderId){
    var metadata={name:driveNomeUnivoco(file.name), parents:[folderId]};
    var boundary='gmca'+String(Date.now())+String(Math.floor(Math.random()*1e6));
    var body=new Blob([
      '--'+boundary+'\r\n',
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata)+'\r\n',
      '--'+boundary+'\r\n',
      'Content-Type: '+(file.type||'application/octet-stream')+'\r\n\r\n',
      file,
      '\r\n--'+boundary+'--'
    ], {type:'multipart/related; boundary='+boundary});
    return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size',{
      method:'POST', headers:{'Content-Type':'multipart/related; boundary='+boundary}, body:body
    }).then(function(r){ if(!r.ok) throw new Error('upload_'+r.status); return r.json(); });
  });
}

function driveDelete(fileId){
  return driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId),{method:'DELETE'})
    .then(function(r){ if(!r.ok && r.status!==404) throw new Error('delete_'+r.status); return true; });
}

function driveGetBlob(fileId){
  return driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media')
    .then(function(r){ if(!r.ok) throw new Error('download_'+r.status); return r.blob(); });
}

// ═══════════════════════════════════════════════════════════════════
// CODA LOCALE DEGLI ALLEGATI — le foto dei documenti si allegano subito,
// anche in campagna. Restano al sicuro sul dispositivo (IndexedDB, che
// regge i file interi) e salgono su Drive quando la linea torna. Il file
// temporaneo si cancella SOLO dopo la conferma che tutto e arrivato.
// ═══════════════════════════════════════════════════════════════════
var ALLEG_DB='gm_allegati', ALLEG_STORE='coda';
var _allegDb=null;
var allegatiLocali={};      // chiamata_id -> [voci in attesa]

function allegDb(){
  if(_allegDb) return Promise.resolve(_allegDb);
  return new Promise(function(res,rej){
    if(!window.indexedDB){ rej(new Error('no_idb')); return; }
    var r=indexedDB.open(ALLEG_DB,1);
    r.onupgradeneeded=function(e){
      var db=e.target.result;
      if(!db.objectStoreNames.contains(ALLEG_STORE)) db.createObjectStore(ALLEG_STORE,{keyPath:'id'});
    };
    r.onsuccess=function(){ _allegDb=r.result; res(_allegDb); };
    r.onerror=function(){ rej(r.error||new Error('idb')); };
  });
}
function allegCodaScrivi(rec){
  return allegDb().then(function(db){
    return new Promise(function(res,rej){
      var t=db.transaction(ALLEG_STORE,'readwrite');
      t.objectStore(ALLEG_STORE).put(rec);
      t.oncomplete=function(){ res(true); };
      t.onerror=function(){ rej(t.error); };
    });
  }).catch(function(){ return false; });
}
function allegCodaCancella(id){
  return allegDb().then(function(db){
    return new Promise(function(res){
      var t=db.transaction(ALLEG_STORE,'readwrite');
      t.objectStore(ALLEG_STORE).delete(id);
      t.oncomplete=function(){ res(true); };
      t.onerror=function(){ res(false); };
    });
  }).catch(function(){ return false; });
}
function allegCodaLeggi(){
  return allegDb().then(function(db){
    return new Promise(function(res){
      var t=db.transaction(ALLEG_STORE,'readonly');
      var q=t.objectStore(ALLEG_STORE).getAll();
      q.onsuccess=function(){ res(q.result||[]); };
      q.onerror=function(){ res([]); };
    });
  }).catch(function(){ return []; });
}
function allegCaricaCodaInMappa(){
  return allegCodaLeggi().then(function(righe){
    allegatiLocali={};
    righe.forEach(function(r){
      var k=String(r.chiamata_id);
      (allegatiLocali[k]=allegatiLocali[k]||[]).push(r);
    });
    try{ syncRenderBadge(); }catch(_){}
    return allegatiLocali;
  });
}

// Svuotamento: un file per volta, con prudenza.
var _allegDrenaggio=false;
var _allegDaRifare=false;   // e arrivata una richiesta mentre eravamo occupati
// Gli invii automatici non devono MAI aprire finestre: se manca il permesso
// si accende l'invito in alto e si riprova al giro successivo.
var allegInCorso=null;      // quale allegato sta salendo proprio adesso
function allegCodaDrena(){
  // Occupato? La richiesta non si butta via: si rifa appena finito. Senza
  // questo, un allegato rimappato mentre era in corso un invio doveva
  // aspettare il giro periodico - anche minuti.
  if(_allegDrenaggio){ _allegDaRifare=true; return Promise.resolve(); }
  if(!isOnline() || !currentUser) return Promise.resolve();
  _allegDrenaggio=true;
  var forza=arguments.length>0 && arguments[0]===true;
  return inSfondoDrive(risolviEtichetteProvvisorie().then(allegCodaLeggi).then(function(righe){
    var adesso=Date.now();
    var utili=righe.filter(function(r){
      if(String(r.chiamata_id).indexOf('local_')===0) return false;
      if(!forza && r.dopo && r.dopo>adesso) return false;   // in pausa dopo un fallimento
      return true;
    });
    // Niente da inviare: si esce SENZA interrogare il database
    if(!utili.length) return false;
    return ensureFreshToken().then(function(){
      var catena=Promise.resolve(), fatti=0;
      utili.forEach(function(r){
        catena=catena.then(function(){
          segnalaInvio(utili.length===1?'l\u2019allegato':'gli allegati', fatti, utili.length);
          allegInCorso=r.id; injectAttachRows();
          return allegInvia(r).then(function(esito){
            fatti++; allegInCorso=null;
            return esito;
          });
        });
      });
      return catena.then(function(){ return true; });
    });
  }).then(function(cerano){
    _allegDrenaggio=false; allegInCorso=null; fineInvio();
    if(!cerano){
      if(_allegDaRifare){ _allegDaRifare=false; return allegCodaDrena(); }
      return;
    }
    return allegCaricaCodaInMappa().then(function(){
      if(typeof getVisibleCallIds==='function'){
        return loadAttachmentsForCalls(getVisibleCallIds()).then(injectAttachRows);
      }
    }).then(function(){
      if(_allegDaRifare){ _allegDaRifare=false; return allegCodaDrena(); }
    });
  }).catch(function(){
    _allegDrenaggio=false; allegInCorso=null; fineInvio();
    if(_allegDaRifare){ _allegDaRifare=false; allegCodaDrena(); }
  }));
}

// Invio di UN allegato. Il file locale si cancella solo quando la riga negli
// allegati esiste davvero: se qualcosa va storto, resta e si riprova.
// Un fallimento annota tentativi e prossimo orario: niente martellamento.
function allegSegnaFallimento(rec, err){
  rec.tentativi=(rec.tentativi||0)+1;
  rec.dopo=Date.now()+prossimaPausa(rec.tentativi);
  if(erroreDiAutorizzazione(err)){
    rec.dopo=Date.now()+5*60000;      // senza permesso ritentare non serve
    try{ driveMostraInvito(); }catch(_){}
  }
  return allegCodaScrivi(rec).catch(function(){}).then(function(){ return false; });
}
function allegInvia(rec){
  var caricamento;
  if(rec.drive_file_id){
    // gia salito su Drive in un tentativo precedente: non si ricarica
    caricamento=Promise.resolve({id:rec.drive_file_id, name:rec.nome});
  } else {
    var file=new File([rec.blob], rec.nome, {type:rec.tipo||'application/octet-stream'});
    caricamento=driveUpload(file).then(function(f){
      // si annota subito, cosi un errore successivo non fa un doppione
      rec.drive_file_id=f.id;
      return allegCodaScrivi(rec).then(function(){ return f; });
    });
  }
  return caricamento.then(function(f){
    return sbFetch('allegati',{method:'POST',prefer:'return=minimal',body:{
      chiamata_id: rec.chiamata_id, drive_file_id: f.id, file_name: rec.nome,
      mime_type: rec.tipo||null, size_bytes: rec.dimensione||null,
      user_id: currentUser?currentUser.id:null
    }}).then(function(res){
      if(!res.ok) throw new Error('db_'+res.status);
      // Solo ORA il file temporaneo puo sparire
      return allegCodaCancella(rec.id).then(function(){ return true; });
    });
  }).catch(function(err){ return allegSegnaFallimento(rec, err); });
}

if(typeof window!=='undefined'){
  window.addEventListener('online', function(){ setTimeout(allegCodaDrena, 1500); });
  setInterval(function(){ allegCodaDrena(); }, 20000);
}

// ═══════════════════════════════════════════════════════════════════
// PULIZIA DI GOOGLE DRIVE
// Un documento clinico che resta su Drive senza piu una chiamata a cui
// appartenere e un problema, non un dettaglio: ogni eliminazione deve
// portarsi via anche il file.
// ═══════════════════════════════════════════════════════════════════

// Tutti i file (allegati + PDF dei Moduli M) delle chiamate indicate
function fileSuDriveDi(filtroChiamate){
  var elenco=[];
  return sbFetch('allegati?'+filtroChiamate+'&select=drive_file_id')
    .then(function(r){ return r.json(); })
    .then(function(righe){
      if(Array.isArray(righe)) righe.forEach(function(a){ if(a.drive_file_id) elenco.push(a.drive_file_id); });
      return sbFetch('moduli_m?'+filtroChiamate+'&select=drive_file_id');
    })
    .then(function(r){ return r.json(); })
    .then(function(righe){
      if(Array.isArray(righe)) righe.forEach(function(m){ if(m.drive_file_id) elenco.push(m.drive_file_id); });
      // niente doppioni
      var visti={}, unici=[];
      elenco.forEach(function(id){ if(!visti[id]){ visti[id]=1; unici.push(id); } });
      return unici;
    })
    .catch(function(){ return []; });
}

// Mette un file nel cestino di Drive: sparisce dalla cartella ma resta
// recuperabile per 30 giorni. Per dei documenti clinici e la scelta giusta.
function cestinaSuDrive(fileId){
  return driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id',{
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({trashed:true})
  }).then(function(r){ if(!r.ok && r.status!==404) throw new Error('cestina_'+r.status); return true; });
}
function cestinaListaDaDrive(ids){
  if(!ids || !ids.length) return Promise.resolve(0);
  var fatti=0, catena=Promise.resolve();
  ids.forEach(function(id){
    catena=catena.then(function(){ return cestinaSuDrive(id).then(function(){ fatti++; }).catch(function(){}); });
  });
  return catena.then(function(){ return fatti; });
}

// Cancella una lista di file da Drive, uno per volta, senza fermarsi ai buchi
function cancellaDaDrive(ids){
  if(!ids || !ids.length) return Promise.resolve(0);
  var fatti=0;
  var catena=Promise.resolve();
  ids.forEach(function(id){
    catena=catena.then(function(){
      return driveDelete(id).then(function(){ fatti++; }).catch(function(){});
    });
  });
  return catena.then(function(){ return fatti; });
}

// Prima di eliminare per sempre delle chiamate: via anche i loro documenti
function ripuliscDriveDiChiamate(filtroChiamate){
  if(!driveConfigured() || !isOnline()) return Promise.resolve(0);
  return fileSuDriveDi(filtroChiamate).then(cancellaDaDrive).catch(function(){ return 0; });
}

// ── Caccia agli orfani: file rimasti su Drive senza piu una chiamata ──
// Con il permesso «drive.file» l'app vede SOLO i file che ha creato lei,
// quindi non puo toccare nient'altro del tuo Drive.
function cercaFileOrfani(){
  return ensureDriveFolder().then(function(cartella){
    var q=encodeURIComponent("'"+cartella+"' in parents and trashed=false");
    var tutti=[];
    var pagina=function(token){
      var url='https://www.googleapis.com/drive/v3/files?q='+q
        +'&fields=nextPageToken,files(id,name,createdTime,size)&pageSize=200&spaces=drive'
        +(token?('&pageToken='+encodeURIComponent(token)):'');
      return driveFetch(url).then(function(r){ return r.json(); }).then(function(d){
        if(d && d.files) tutti=tutti.concat(d.files);
        if(d && d.nextPageToken) return pagina(d.nextPageToken);
        return tutti;
      });
    };
    return pagina(null);
  }).then(function(suDrive){
    // Quali sono ancora collegati a qualcosa?
    return sbFetch('allegati?select=drive_file_id')
      .then(function(r){ return r.json(); })
      .then(function(a){
        var usati={};
        if(Array.isArray(a)) a.forEach(function(x){ if(x.drive_file_id) usati[x.drive_file_id]=1; });
        return sbFetch('moduli_m?select=drive_file_id').then(function(r){ return r.json(); }).then(function(m){
          if(Array.isArray(m)) m.forEach(function(x){ if(x.drive_file_id) usati[x.drive_file_id]=1; });
          return suDrive.filter(function(f){ return !usati[f.id]; });
        });
      });
  });
}

// ═══════════════════════════════════════════════════════════════════
// CODA DELLE OPERAZIONI SU DRIVE — quando una chiamata va nel cestino o
// ne esce, i suoi file su Drive devono seguirla. Se in quel momento manca
// la linea (o Drive non risponde), l'operazione si annota qui e viene
// eseguita appena possibile. Si annota la CHIAMATA, non i singoli file:
// quali siano lo si chiede al database al momento buono.
// ═══════════════════════════════════════════════════════════════════
var DRIVE_OPS_KEY='driveOps_v1';
function driveOpsLeggi(){
  try{ return JSON.parse(localStorage.getItem(DRIVE_OPS_KEY)||'[]'); }catch(_){ return []; }
}
function driveOpsSalva(q){
  try{ localStorage.setItem(DRIVE_OPS_KEY, JSON.stringify(q)); }catch(_){}
}
function driveOpsAccoda(op, chiamataId){
  var q=driveOpsLeggi();
  // Un cestina e un ripristina sulla stessa chiamata si annullano a vicenda:
  // resta solo l'ultima volonta espressa.
  q=q.filter(function(e){ return String(e.chiamata)!==String(chiamataId); });
  q.push({op:op, chiamata:chiamataId, ts:Date.now(), tentativi:0, dopo:0});
  driveOpsSalva(q);
}
// I file (allegati + Modulo M) di una chiamata, letti dal database
function fileDiChiamata(chiamataId){
  var elenco=[];
  return sbFetch('allegati?chiamata_id=eq.'+chiamataId+'&select=drive_file_id')
    .then(function(r){ return r.json(); })
    .then(function(a){
      if(Array.isArray(a)) a.forEach(function(x){ if(x.drive_file_id) elenco.push(x.drive_file_id); });
      return sbFetch('moduli_m?chiamata_id=eq.'+chiamataId+'&select=drive_file_id');
    })
    .then(function(r){ return r.json(); })
    .then(function(m){
      if(Array.isArray(m)) m.forEach(function(x){ if(x.drive_file_id) elenco.push(x.drive_file_id); });
      return elenco;
    });
}
function ripristinaSuDrive(fileId){
  return driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id',{
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({trashed:false}), automatico:true
  }).then(function(r){ if(!r.ok && r.status!==404) throw new Error('untrash_'+r.status); return true; });
}
function cestinaSuDriveAuto(fileId){
  return driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id',{
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({trashed:true}), automatico:true
  }).then(function(r){ if(!r.ok && r.status!==404) throw new Error('trash_'+r.status); return true; });
}
// Esegue una singola annotazione: trova i file della chiamata e li sposta
function driveOpsEsegui(e){
  return fileDiChiamata(e.chiamata).then(function(ids){
    if(!ids.length) return true;
    var catena=Promise.resolve();
    ids.forEach(function(id){
      catena=catena.then(function(){
        return (e.op==='untrash' ? ripristinaSuDrive(id) : cestinaSuDriveAuto(id));
      });
    });
    return catena.then(function(){ return true; });
  });
}
var _driveOpsInCorso=false;
function driveOpsDrena(forza){
  if(_driveOpsInCorso || !isOnline() || !currentUser) return Promise.resolve();
  var q=driveOpsLeggi();
  if(!q.length) return Promise.resolve();
  _driveOpsInCorso=true;
  var adesso=Date.now();
  var catena=Promise.resolve();
  q.forEach(function(e){
    catena=catena.then(function(){
      if(!forza && e.dopo && e.dopo>adesso) return;      // non e ancora il momento
      return inSfondoDrive(function(){ return driveOpsEsegui(e); }).then(function(){
        var resto=driveOpsLeggi().filter(function(x){ return !(x.op===e.op && String(x.chiamata)===String(e.chiamata)); });
        driveOpsSalva(resto);
      }).catch(function(err){
        // resta in coda, con una pausa che cresce a ogni tentativo
        var resto=driveOpsLeggi();
        resto.forEach(function(x){
          if(x.op===e.op && String(x.chiamata)===String(e.chiamata)){
            x.tentativi=(x.tentativi||0)+1;
            x.dopo=Date.now()+Math.min(10*60000, 30000*Math.pow(2, x.tentativi-1));
          }
        });
        driveOpsSalva(resto);
        var msg=String((err&&err.message)||'');
        if(msg.indexOf('token')!==-1||msg.indexOf('popup')!==-1||msg.indexOf('401')!==-1) driveMostraInvito();
      });
    });
  });
  return catena.then(function(){ _driveOpsInCorso=false; })
    .catch(function(){ _driveOpsInCorso=false; });
}
if(typeof window!=='undefined'){
  setInterval(function(){ driveOpsDrena(); }, 45000);
}
// La chiamata segue il suo destino su Drive: subito se possibile, in coda se no
function drivePerChiamata(op, chiamataId){
  driveOpsAccoda(op, chiamataId);
  if(isOnline()) setTimeout(function(){ driveOpsDrena(); }, 200);
}

// Passata automatica: una volta al giorno, in silenzio.
var ORFANI_KEY='ultimaPuliziaDrive_v1';
var ORFANI_ETA_MIN=6*3600*1000;     // si risparmiano i file delle ultime 6 ore
var ORFANI_MAX_GIRO=10;             // mai piu di dieci per volta
function puliziaDriveAutomatica(){
  if(!driveConfigured() || !isOnline() || !currentUser) return Promise.resolve(0);
  var ultima=parseInt(localStorage.getItem(ORFANI_KEY)||'0',10);
  if(Date.now()-ultima < 24*3600*1000) return Promise.resolve(0);
  if(!driveTokenValidoOra()) return Promise.resolve(0);   // niente permesso: si riprova domani
  localStorage.setItem(ORFANI_KEY, String(Date.now()));

  return inSfondoDrive(function(){
    return cercaFileOrfaniSicuro().then(function(esito){
      if(!esito.affidabile || !esito.orfani.length) return 0;
      var maturi=esito.orfani.filter(function(f){
        var t=Date.parse(f.createdTime||'');
        return isNaN(t) ? false : (Date.now()-t > ORFANI_ETA_MIN);
      }).slice(0, ORFANI_MAX_GIRO);
      if(!maturi.length) return 0;
      return cestinaListaDaDrive(maturi.map(function(f){ return f.id; }));
    });
  }).catch(function(){ return 0; });
}

// Come cercaFileOrfani, ma dice anche se il confronto e ATTENDIBILE.
// Senza questa cautela una lettura fallita del database farebbe sembrare
// orfano ogni file, e si cancellerebbe tutto.
function cercaFileOrfaniSicuro(){
  var suDrive=[], usati={}, letturaOk=true, quantiRegistrati=0;
  return ensureDriveFolder().then(function(cartella){
    var q=encodeURIComponent("'"+cartella+"' in parents and trashed=false");
    var pagina=function(token){
      var url='https://www.googleapis.com/drive/v3/files?q='+q
        +'&fields=nextPageToken,files(id,name,createdTime,size)&pageSize=200&spaces=drive'
        +(token?('&pageToken='+encodeURIComponent(token)):'');
      return driveFetch(url).then(function(r){ return r.json(); }).then(function(d){
        if(d && d.files) suDrive=suDrive.concat(d.files);
        if(d && d.nextPageToken) return pagina(d.nextPageToken);
        return suDrive;
      });
    };
    return pagina(null);
  }).then(function(){
    return sbFetch('allegati?select=drive_file_id').then(function(r){ return r.json(); });
  }).then(function(a){
    if(!Array.isArray(a)){ letturaOk=false; return null; }
    a.forEach(function(x){ if(x.drive_file_id){ usati[x.drive_file_id]=1; quantiRegistrati++; } });
    return sbFetch('moduli_m?select=drive_file_id').then(function(r){ return r.json(); });
  }).then(function(m){
    if(m && !Array.isArray(m)) letturaOk=false;
    if(Array.isArray(m)) m.forEach(function(x){ if(x.drive_file_id){ usati[x.drive_file_id]=1; quantiRegistrati++; } });
    var orfani=suDrive.filter(function(f){ return !usati[f.id]; });
    // Se il database non riporta NIENTE ma su Drive c'e roba, e piu probabile
    // una lettura andata storta che un archivio interamente abbandonato.
    var affidabile = letturaOk && !(quantiRegistrati===0 && suDrive.length>0);
    return {affidabile:affidabile, orfani:orfani, suDrive:suDrive.length, registrati:quantiRegistrati};
  }).catch(function(){
    return {affidabile:false, orfani:[], suDrive:0, registrati:0};
  });
}

// ── Metadati allegati (Supabase) ─────────────────────────────────────
function loadAttachmentsForCalls(callIds){
  var ids=(callIds||[]).filter(function(x){return x && String(x).indexOf('local_')!==0;});
  if(!ids.length){ attachmentsByCall={}; return Promise.resolve({}); }
  return sbFetch('allegati?chiamata_id=in.('+ids.join(',')+')&order=created_at.asc&select=*')
    .then(function(r){return r.json();})
    .then(function(rows){
      if(!Array.isArray(rows)) return attachmentsByCall;   // risposta d'errore: si tiene la mappa nota
      var nuova={};
      rows.forEach(function(a){
        var k=String(a.chiamata_id);
        (nuova[k]=nuova[k]||[]).push(a);
      });
      attachmentsByCall=nuova;
      return attachmentsByCall;
    }).catch(function(){ return attachmentsByCall; });     // rete assente: idem
}

// Inietta le righe "Allegati" sotto ogni chiamata che ne ha (post-render)
function injectAttachRows(){
  var tb=els.tbody||document.getElementById('tbody');
  if(!tb)return;
  // Pulisci righe allegati + flag precedenti
  var old=tb.querySelectorAll('tr.attach-row');
  for(var i=0;i<old.length;i++){ old[i].parentNode.removeChild(old[i]); }
  var prev=tb.querySelectorAll('tr.has-attachments');
  for(var j=0;j<prev.length;j++){ prev[j].classList.remove('has-attachments'); }
  // Uniti: quelli gia sul server e quelli ancora in attesa sul dispositivo
  var tutti={};
  Object.keys(attachmentsByCall).forEach(function(k){ tutti[k]=(attachmentsByCall[k]||[]).slice(); });
  Object.keys(allegatiLocali).forEach(function(k){
    (allegatiLocali[k]||[]).forEach(function(r){
      (tutti[k]=tutti[k]||[]).push({id:r.id, drive_file_id:'', file_name:r.nome, inAttesa:true});
    });
  });
  Object.keys(tutti).forEach(function(cid){
    var list=tutti[cid]; if(!list||!list.length)return;
    var row=tb.querySelector('tr[data-row="'+cid+'"]')
         || (String(cid).indexOf('local_')===0 ? tb.querySelector('tr[data-uuid="'+String(cid).slice(6)+'"]') : null);
    if(!row)return;
    if(row.style.display==='none')return;    // chiamata appena cestinata: niente riga allegati
    var ar=document.createElement('tr');
    // Stesso sfondo della chiamata (pending giallo / done bianco): fa parte della stessa chiamata
    var stateClass=row.classList.contains('done')?'attach-done':'attach-pending';
    ar.className='attach-row '+stateClass;
    ar.setAttribute('data-for',cid);
    ar.innerHTML=
      '<td colspan="3" class="attach-label">Allegati:</td>'
     +'<td colspan="2" class="attach-list">'+list.map(attachItemHtml).join('')+'</td>';
    row.classList.add('has-attachments'); // toglie il bordo inferiore → si fonde con la riga allegati
    if(row.nextSibling) row.parentNode.insertBefore(ar,row.nextSibling);
    else row.parentNode.appendChild(ar);
  });
}
function attachItemHtml(a){
  if(a.inAttesa){
    var sale = (typeof allegInCorso!=='undefined' && allegInCorso===a.id);
    // Ancora sul dispositivo: si mostra ma non si puo aprire ne cancellare
    return '<span class="attach-item attach-attesa'+(sale?' attach-sale':'')+'" data-locale="'+esc(a.id)+'" title="'
      +(sale?'Sta salendo su Google Drive\u2026':'Al sicuro sul dispositivo: salira su Drive appena torna la linea')+'">'
      +(sale ? '<span class="sync-rotella piccola"></span>'
             : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>')
      +'<span class="attach-fname">'+esc(a.file_name)+'</span>'
      +'<span class="attach-attesa-tag">'+(sale?'invio\u2026':'da inviare')+'</span>'
    +'</span>';
  }
  return '<span class="attach-item" data-id="'+a.id+'" data-drive="'+esc(a.drive_file_id)+'" data-name="'+esc(a.file_name)+'">'
    +'<span class="attach-name" title="Scarica '+esc(a.file_name)+'">'
      +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
      +'<span class="attach-fname">'+esc(a.file_name)+'</span>'
    +'</span>'
    +'<span class="attach-del" title="Elimina allegato">'
      +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
    +'</span>'
  +'</span>';
}

// Velo di attesa su un modal qualsiasi: mostra lo stato in modo evidente e
// blocca i pulsanti, così non si chiude la finestra a metà operazione.
function setModalBusy(modalId, attivo, testo){
  var m=document.getElementById(modalId); if(!m)return;
  var ov=m.querySelector('.mbox-loading');
  var tx=m.querySelector('.mbox-loading-text');
  if(tx&&testo) tx.textContent=testo;
  if(ov) ov.style.display = attivo ? 'flex' : 'none';
  m.querySelectorAll('button').forEach(function(b){ b.disabled=attivo; });
}

// ── Modal upload ─────────────────────────────────────────────────────
function openAttachModal(callId){
  // Si allega anche senza linea: i file restano al sicuro sul dispositivo
  // e salgono su Drive appena la connessione torna.
  if(!driveConfigured()){ fb(false,'Drive non configurato','Manca il Client ID di Google. Contatta l\'amministratore.'); return; }
  var avviso=document.getElementById('attachAvvisoOffline');
  if(avviso) avviso.style.display = isOnline() ? 'none' : '';
  attachModalCallId=callId;
  var inp=document.getElementById('attachFileInput'); if(inp)inp.value='';
  var sel=document.getElementById('attachSelectedList'); if(sel)sel.innerHTML='';
  setModalBusy('mattach', false);                       // ripristina stato pulito
  var btn=document.getElementById('btnAttachUpload'); if(btn){btn.disabled=true;} // finché non scegli i file
  apri('mattach');
}
function renderAttachSelected(){
  var inp=document.getElementById('attachFileInput');
  var sel=document.getElementById('attachSelectedList');
  var btn=document.getElementById('btnAttachUpload');
  if(!inp||!sel)return;
  var files=inp.files?Array.prototype.slice.call(inp.files):[];
  if(!files.length){ sel.innerHTML=''; if(btn)btn.disabled=true; return; }
  sel.innerHTML=files.map(function(f){
    return '<div class="attach-sel-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
      +'<span class="attach-sel-name">'+esc(f.name)+'</span><span class="attach-sel-size">'+fmtBytes(f.size)+'</span></div>';
  }).join('');
  if(btn)btn.disabled=false;
}
function fmtBytes(n){
  n=n||0; if(n<1024)return n+' B';
  if(n<1048576)return (n/1024).toFixed(0)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}
function doAttachUpload(){
  var inp=document.getElementById('attachFileInput');
  var files=inp&&inp.files?Array.prototype.slice.call(inp.files):[];
  if(!files.length){ return; }
  var callId=attachModalCallId;

  // I file vanno SEMPRE prima in cassaforte sul dispositivo: da quel momento
  // non si perdono, ne se cade la linea ne se si chiude l'app.
  setModalBusy('mattach', true, files.length===1?'Metto al sicuro il file\u2026':('Metto al sicuro '+files.length+' file\u2026'));
  var messi=0;
  var salvataggio=Promise.resolve();
  files.forEach(function(file){
    salvataggio=salvataggio.then(function(){
      return allegCodaScrivi({
        id:newClientUuid(), chiamata_id:callId, nome:file.name,
        tipo:file.type||'application/octet-stream', dimensione:file.size,
        blob:file, ts:Date.now()
      }).then(function(ok){ if(ok) messi++; });
    });
  });
  return salvataggio.then(function(){
    if(!messi){
      setModalBusy('mattach', false);
      fb(false,'Non riuscito','La memoria del dispositivo non e disponibile: i file non sono stati salvati.');
      return;
    }
    return allegCaricaCodaInMappa().then(function(){
      if(inp) inp.value='';
      setModalBusy('mattach', false);
      chiudi('mattach');
      injectAttachRows();
      if(!isOnline()){
        fb(true,'Al sicuro sul dispositivo', messi+(messi===1?' file allegato':' file allegati')+': saliranno su Drive da soli appena torna la linea.');
        return;
      }
      fb(true,'Allegato', messi+(messi===1?' file allegato':' file allegati')+'. Caricamento su Drive in corso\u2026');
      return allegCodaDrena();
    });
  });
}

// Vecchio percorso diretto, non piu usato: resta per riferimento storico
function doAttachUploadDiretto(){
  var inp=document.getElementById('attachFileInput');
  var files=inp&&inp.files?Array.prototype.slice.call(inp.files):[];
  if(!files.length){ return; }
  if(!isOnline()){ fb(false,'Serve connessione','Impossibile caricare offline.'); return; }
  var callId=attachModalCallId;
  var done=0, failed=0;
  var setProg=function(){
    setModalBusy('mattach', true,
      'Caricamento '+(done+failed+1>files.length?files.length:done+failed+1)+' di '+files.length+'…'
      +(failed?('\n'+failed+' non riuscit'+(failed===1?'o':'i')):''));
  };
  setModalBusy('mattach', true, files.length===1?'Caricamento del file…':('Caricamento di '+files.length+' file…'));

  // Sequenziale (un file per volta) per non saturare + progresso chiaro
  var chain=Promise.resolve();
  files.forEach(function(file){
    chain=chain.then(function(){
      return driveUpload(file).then(function(f){
        return sbFetch('allegati',{method:'POST',prefer:'return=minimal',body:{
          chiamata_id:callId, drive_file_id:f.id, file_name:file.name,
          mime_type:f.mimeType||file.type||null, size_bytes:f.size?parseInt(f.size,10):(file.size||null),
          user_id: currentUser?currentUser.id:null
        }}).then(function(res){
          if(!res.ok) throw new Error('db_'+res.status);
          done++; setProg();
        });
      }).catch(function(e){
        failed++; setProg();
        // se il DB fallisce ma il file è su Drive, non lo perdiamo (resta in Drive);
        // l'utente può riprovare. Non blocchiamo gli altri file.
      });
    });
  });
  chain.then(function(){
    setModalBusy('mattach', false);
    if(failed===0){
      chiudi('mattach');
      fb(true,'Caricato', done+(done===1?' file allegato':' file allegati')+' con successo.');
    } else {
      fb(false,'Attenzione', done+' ok, '+failed+' non caricati. Riprova quelli mancanti.');
    }
    // Ricarica gli allegati delle chiamate visibili e reinietta le righe
    loadAttachmentsForCalls(getVisibleCallIds()).then(injectAttachRows);
  });
}
function getVisibleCallIds(){
  var tb=els.tbody||document.getElementById('tbody'); if(!tb)return [];
  var out=[]; tb.querySelectorAll('tr[data-row]').forEach(function(tr){ if(tr.dataset.row)out.push(tr.dataset.row); });
  return out;
}

// ── Apri allegato in una NUOVA finestra (scaricato da Drive e visualizzato) ──
function startAttachDownload(driveId,fileName){
  if(!isOnline()){ fb(false,'Serve connessione','L\'apertura dell\'allegato richiede internet.'); return; }
  // Apro SUBITO la finestra dentro il gesto del click (evita il blocco popup);
  // la riempirò col file appena scaricato da Drive.
  var win=window.open('','_blank');
  if(win){
    try{ win.document.write('<!doctype html><meta charset="utf-8"><title>'+esc(fileName||'Allegato')+'</title><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;color:#666">Apertura di '+esc(fileName||'allegato')+'…</body>'); }catch(_){}
  }
  driveGetBlob(driveId).then(function(blob){
    var url=URL.createObjectURL(blob);
    if(win){ try{ win.location.href=url; }catch(_){ window.open(url,'_blank'); } }
    else { window.open(url,'_blank'); } // fallback se il popup iniziale è stato bloccato
    setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(_){} }, 120000);
  }).catch(function(e){
    if(win){ try{ win.close(); }catch(_){} }
    var em=(e&&e.message)||'';
    var msg='Apertura non riuscita. Riprova.';
    if(em.indexOf('404')!==-1) msg='File non trovato su Drive (forse spostato o eliminato dalla cartella "allegati CA").';
    else if(em.indexOf('403')!==-1) msg='Google Drive ha negato l\'accesso al file. Riprova ad autorizzare Drive.';
    else if(em.indexOf('popup')!==-1||em.indexOf('token')!==-1||em.indexOf('no_token')!==-1){ msg='Non sono riuscito ad autorizzare Google Drive. Tocca l\'avviso blu in alto per attivarlo.'; driveMostraInvito(); }
    fb(false,'Errore', msg);
  });
}

// ── Delete (con conferma) ────────────────────────────────────────────
// Il PDF del Modulo M sta negli allegati ma non e un allegato qualsiasi:
// e il documento della chiamata. Cancellarlo da qui deve cancellarlo ovunque.
function moduloMDaAllegato(id, driveId){
  var trovato=null;
  Object.keys(moduliMByCall).forEach(function(k){
    var m=moduliMByCall[k]; if(!m || trovato) return;
    if((m.allegato_id!=null && String(m.allegato_id)===String(id))
       || (m.drive_file_id && driveId && m.drive_file_id===driveId)) trovato=m;
  });
  return trovato;
}
function promptAttachDelete(id,driveId,fileName){
  var modulo=moduloMDaAllegato(id,driveId);
  attachToDelete={ id:id, drive_file_id:driveId, file_name:fileName, modulo:modulo };
  var msg=document.getElementById('mattachDelMsg');
  if(msg)msg.innerHTML = modulo
    ? 'Stai per eliminare <b>'+esc(fileName)+'</b>.<br><br>&Egrave; il <b>Modulo M</b> di questa chiamata: sparir&agrave; da Google Drive, dagli allegati e dalla chiamata (via anche la scritta &laquo;Visualizza modulo M&raquo;). Operazione irreversibile.'
    : 'Stai per eliminare <b>'+esc(fileName)+'</b>.<br><br>Verr&agrave; rimosso sia da Google Drive sia dall\'elenco. Operazione irreversibile.';
  setModalBusy('mattachDel', false);   // ripristina stato pulito
  apri('mattachDel');
}
function doAttachDelete(){
  if(!attachToDelete)return;
  if(!isOnline()){ fb(false,'Serve connessione','Impossibile eliminare offline.'); return; }
  var a=attachToDelete;
  setModalBusy('mattachDel', true, 'Elimino da Google Drive…');
  driveDelete(a.drive_file_id).then(function(){
    setModalBusy('mattachDel', true, 'Aggiorno l\'elenco allegati…');
    return sbFetch('allegati?id=eq.'+a.id,{method:'DELETE'}).then(function(res){
      if(!res.ok) throw new Error('db_'+res.status);
    });
  }).then(function(){
    // Se il file era il Modulo M, va tolto anche il modulo: altrimenti resterebbe
    // la scritta sotto la postazione a puntare a un documento che non c'e piu.
    if(!a.modulo) return null;
    setModalBusy('mattachDel', true, 'Rimuovo il Modulo M dalla chiamata…');
    var filtri=['allegato_id.eq.'+a.id];
    if(a.drive_file_id) filtri.push('drive_file_id.eq.'+encodeURIComponent(a.drive_file_id));
    return sbFetch('moduli_m?or=('+filtri.join(',')+')',{method:'DELETE'}).catch(function(){});
  }).then(function(){
    setModalBusy('mattachDel', false);
    chiudi('mattachDel');
    var eraModulo=!!(a && a.modulo);
    attachToDelete=null;
    fb(true,'Eliminato', eraModulo ? 'Modulo M rimosso dalla chiamata, dagli allegati e da Google Drive.' : 'Allegato rimosso.');
    return caricaModuliM(getVisibleCallIds()).then(function(){
      return loadAttachmentsForCalls(getVisibleCallIds()).then(injectAttachRows);
    }).then(function(){ injectModmUi(); });
  }).catch(function(){
    setModalBusy('mattachDel', false);
    fb(false,'Errore','Eliminazione non riuscita. Riprova.');
  });
}

function svgAttach(){
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
}

// ═══════════════════════════════════════════════════════════════════
// INVIO MAIL AL PAZIENTE
// - Mittente: casella no-reply dedicata (configurata nella Edge Function)
// - Invio via Edge Function Supabase `send-mail` (la chiave del servizio
//   di posta resta lato server, mai nel browser)
// - Allegati: inviati per mail E salvati tra gli allegati della chiamata
// - Dopo l'invio: traccia automatica nelle note della chiamata
// ═══════════════════════════════════════════════════════════════════
var MAIL_MAX_TOTAL_BYTES=9*1024*1024; // limite prudenziale allegati mail (~9 MB)
var mailModalCallId=null;
var lastMailRemaining=null;   // invii ancora disponibili oggi (dal servizio di posta)
var mailChoiceAddr='', mailChoiceCallId=null;

// Click su un'email → prima si sceglie: copia negli appunti oppure invia mail
function openMailChoice(email, callId){
  mailChoiceAddr=(email||'').trim();
  mailChoiceCallId=callId||null;
  var v=document.getElementById('mailChoiceAddr');
  if(v)v.textContent=mailChoiceAddr;
  // Ripristina il bottone Copia (se era rimasto su "Copiato!")
  var lbl=document.getElementById('mailCopyLabel');
  var btn=document.getElementById('btnMailChoiceCopy');
  if(lbl)lbl.textContent='Copia indirizzo';
  if(btn){ btn.style.color=''; btn.style.borderColor=''; }
  apri('mmailChoice');
}

function copyMailAddress(){
  var addr=mailChoiceAddr;
  if(!addr)return;
  copyToClipboard(addr).then(function(ok){
    var lbl=document.getElementById('mailCopyLabel');
    var ico=document.getElementById('mailCopyIco');
    var btn=document.getElementById('btnMailChoiceCopy');
    if(ok && lbl && ico){
      var origIco=ico.innerHTML;
      lbl.textContent='Copiato!';
      ico.innerHTML='<polyline points="20 6 9 17 4 12"/>';
      if(btn){ btn.style.color='var(--ok)'; btn.style.borderColor='var(--ok)'; }
      setTimeout(function(){
        chiudi('mmailChoice');
        lbl.textContent='Copia indirizzo';
        ico.innerHTML=origIco;
        if(btn){ btn.style.color=''; btn.style.borderColor=''; }
      },900);
    } else if(!ok){
      // Fallback manuale: seleziono l'indirizzo così basta un tocco prolungato → Copia
      try{
        var v=document.getElementById('mailChoiceAddr');
        if(v){
          var rg=document.createRange(); rg.selectNodeContents(v);
          var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
        }
      }catch(_){}
      fb(false,'Copia automatica bloccata','Ho selezionato l\'indirizzo: tienilo premuto e scegli "Copia".');
    }
  });
}

function openMailModal(email, callId){
  mailModalCallId=callId||null;
  var to=document.getElementById('mailTo');       if(to)to.value=email||'';
  var su=document.getElementById('mailSubject');  if(su)su.value='';
  var bo=document.getElementById('mailBody');     if(bo)bo.value='';
  var fi=document.getElementById('mailFileInput');if(fi)fi.value='';
  var sl=document.getElementById('mailSelectedList'); if(sl)sl.innerHTML='';
  var er=document.getElementById('mailErr');      if(er){er.style.display='none';er.textContent='';}
  setModalBusy('mmail', false);   // ripristina: velo nascosto, pulsanti attivi
  renderMailExisting(callId);     // allegati già in archivio per questa chiamata
  var nb=document.getElementById('mailNoCallNote');
  if(nb) nb.style.display = callId ? 'none' : 'block';
  apri('mmail');
  setTimeout(function(){ var s=document.getElementById('mailSubject'); if(s)s.focus(); },250);
}

// Elenca gli allegati già caricati su questa chiamata, con casella di spunta
// per rispedirli senza doverli ricaricare da capo.
function renderMailExisting(callId){
  var wrap=document.getElementById('mailExistingWrap');
  var list=document.getElementById('mailExistingList');
  if(!wrap||!list)return;
  var att=(callId!=null)?(attachmentsByCall[String(callId)]||[]):[];
  if(!att.length){ wrap.style.display='none'; list.innerHTML=''; return; }
  list.innerHTML=att.map(function(a){
    return '<label class="mail-exist-item">'
      +'<input type="checkbox" class="mail-exist-cb" data-drive="'+escAttr(a.drive_file_id)+'"'
        +' data-name="'+escAttr(a.file_name)+'" data-size="'+(a.size_bytes||0)+'">'
      +'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
      +'<span class="mail-exist-name">'+esc(a.file_name)+'</span>'
      +'<span class="mail-exist-size">'+fmtBytes(a.size_bytes||0)+'</span>'
    +'</label>';
  }).join('');
  wrap.style.display='';
  list.querySelectorAll('.mail-exist-cb').forEach(function(cb){
    cb.addEventListener('change', renderMailSelected);   // aggiorna il peso totale
  });
}

// Allegati già presenti che l'utente ha spuntato
function mailCheckedExisting(){
  var out=[];
  document.querySelectorAll('#mailExistingList .mail-exist-cb').forEach(function(cb){
    if(cb.checked) out.push({drive:cb.dataset.drive, name:cb.dataset.name, size:parseInt(cb.dataset.size,10)||0});
  });
  return out;
}

function renderMailSelected(){
  var inp=document.getElementById('mailFileInput');
  var sel=document.getElementById('mailSelectedList');
  if(!inp||!sel)return;
  var files=inp.files?Array.prototype.slice.call(inp.files):[];
  var esistenti=mailCheckedExisting();
  var tot=0;
  files.forEach(function(f){ tot+=f.size||0; });
  esistenti.forEach(function(e){ tot+=e.size||0; });
  if(!files.length){
    // nessun file nuovo: mostra solo l'eventuale avviso di peso
    sel.innerHTML=(tot>MAIL_MAX_TOTAL_BYTES)
      ? '<div class="mail-warn">Totale '+fmtBytes(tot)+': troppo pesante per una mail (max '+fmtBytes(MAIL_MAX_TOTAL_BYTES)+'). Togli qualche allegato.</div>'
      : '';
    return;
  }
  sel.innerHTML=files.map(function(f){
    return '<div class="attach-sel-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
      +'<span class="attach-sel-name">'+esc(f.name)+'</span><span class="attach-sel-size">'+fmtBytes(f.size)+'</span></div>';
  }).join('')
   + (tot>MAIL_MAX_TOTAL_BYTES
      ? '<div class="mail-warn">Totale '+fmtBytes(tot)+': troppo pesante per una mail (max '+fmtBytes(MAIL_MAX_TOTAL_BYTES)+'). Togli qualche file.</div>'
      : '');
}

function fileToBase64(file){
  return new Promise(function(resolve,reject){
    var r=new FileReader();
    r.onload=function(){ var s=String(r.result||''); resolve(s.slice(s.indexOf(',')+1)); };
    r.onerror=function(){ reject(new Error('read_error')); };
    r.readAsDataURL(file);
  });
}

function mailShowErr(msg){
  var er=document.getElementById('mailErr');
  if(er){ er.textContent=msg; er.style.display='block'; }
}


function doSendMail(){
  var to=(document.getElementById('mailTo').value||'').trim();
  var subject=(document.getElementById('mailSubject').value||'').trim();
  var body=(document.getElementById('mailBody').value||'').trim();
  var inp=document.getElementById('mailFileInput');
  var files=inp&&inp.files?Array.prototype.slice.call(inp.files):[];

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){ mailShowErr('Indirizzo destinatario non valido.'); return; }
  if(!subject){ mailShowErr('Inserisci l\'oggetto della mail.'); return; }
  if(!body){ mailShowErr('Scrivi il messaggio.'); return; }
  if(!isOnline()){ mailShowErr('Serve la connessione per inviare la mail.'); return; }
  var esistenti=mailCheckedExisting();   // allegati gia in archivio, spuntati
  var tot=0;
  files.forEach(function(f){ tot+=f.size||0; });
  esistenti.forEach(function(e){ tot+=e.size||0; });
  if(tot>MAIL_MAX_TOTAL_BYTES){ mailShowErr('Allegati troppo pesanti ('+fmtBytes(tot)+'). Massimo '+fmtBytes(MAIL_MAX_TOTAL_BYTES)+'.'); return; }

  var er=document.getElementById('mailErr'); if(er)er.style.display='none';
  // Velo di attesa sul modal: molto più visibile dello spinner nel pulsante
  var setBusy=function(attivo,testo){ setModalBusy('mmail', attivo, testo); };
  var totAllegati=files.length+esistenti.length;
  setBusy(true, totAllegati?('Preparo '+totAllegati+(totAllegati===1?' allegato…':' allegati…')):'Invio in corso…');

  // 1a. File nuovi scelti dal dispositivo
  var pNuovi=Promise.all(files.map(function(f){
    return fileToBase64(f).then(function(b64){ return {name:f.name, content:b64, _file:f}; });
  }));
  // 1b. Allegati gia presenti: riscaricati da Drive per essere rispediti
  var pEsistenti=esistenti.length
    ? esistenti.reduce(function(chain,e){
        return chain.then(function(acc){
          setBusy(true,'Recupero "'+e.name+'" da Drive…');
          return driveGetBlob(e.drive)
            .then(fileToBase64)
            .then(function(b64){ acc.push({name:e.name, content:b64, _file:null}); return acc; })
            .catch(function(){ throw new Error('allegato_non_recuperato:'+e.name); });
        });
      }, Promise.resolve([]))
    : Promise.resolve([]);

  Promise.all([pNuovi,pEsistenti]).then(function(gruppi){
    return gruppi[0].concat(gruppi[1]);
  }).then(function(atts){
    setBusy(true,'Invio della mail in corso…');
    // 2. Invia tramite Edge Function (la chiave del servizio resta lato server)
    return fetch(SUPABASE_URL+'/functions/v1/send-mail',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':SUPABASE_ANON_KEY,
        'Authorization':'Bearer '+(currentJwt||SUPABASE_ANON_KEY)
      },
      body:JSON.stringify({
        to:to, subject:subject, text:body,
        attachments:atts.map(function(a){ return {name:a.name, content:a.content}; })
      })
    }).then(function(res){
      return res.json().catch(function(){return {};}).then(function(data){
        if(!res.ok) throw new Error((data&&(data.error||data.message))||('http_'+res.status));
        lastMailRemaining=(data&&typeof data.remaining==='number')?data.remaining:null;
        return atts;
      });
    });
  }).then(function(atts){
    // 3. Mail partita: salva gli allegati anche su Drive/chiamata (best effort)
    var daSalvare=atts.filter(function(a){ return !!a._file; });   // solo i file nuovi
    if(!daSalvare.length || !mailModalCallId) return null;
    setBusy(true,'Mail inviata. Salvo gli allegati nella chiamata…');
    var chain=Promise.resolve();
    daSalvare.forEach(function(a){
      chain=chain.then(function(){
        return driveUpload(a._file).then(function(f){
          return sbFetch('allegati',{method:'POST',prefer:'return=minimal',body:{
            chiamata_id:mailModalCallId, drive_file_id:f.id, file_name:a.name,
            mime_type:f.mimeType||a._file.type||null,
            size_bytes:f.size?parseInt(f.size,10):(a._file.size||null),
            user_id:currentUser?currentUser.id:null
          }});
        }).catch(function(){ /* un allegato non salvato non invalida la mail già inviata */ });
      });
    });
    return chain;
  }).then(function(){
    setBusy(false);
    chiudi('mmail');
    var quota='';
    if(lastMailRemaining!==null){
      if(lastMailRemaining<=0)      quota=' · Hai esaurito gli invii di oggi: riprova domani.';
      else if(lastMailRemaining===1)quota=' · Resta 1 solo invio per oggi.';
      else                          quota=' · Restano '+lastMailRemaining+' invii oggi.';
    }
    var nAll=files.length+esistenti.length;
    fb(true,'Mail inviata','Messaggio inviato a '+to+(nAll?(' con '+nAll+(nAll===1?' allegato':' allegati')):'')+'.'+quota);
    loadRows(PAGE);
  }).catch(function(e){
    setBusy(false);
    var em=String((e&&e.message)||'');
    var msg='Invio non riuscito. Riprova.';
    if(em.indexOf('not_configured')!==-1) msg='Il servizio di posta non è ancora configurato. Contatta l\'amministratore.';
    else if(em.indexOf('http_401')!==-1||em.indexOf('http_403')!==-1) msg='Sessione scaduta. Ricarica la pagina e riprova.';
    else if(em.indexOf('http_413')!==-1||em.indexOf('too_large')!==-1) msg='Allegati troppo pesanti per l\'invio.';
    else if(em.indexOf('invalid_recipient')!==-1) msg='Indirizzo destinatario rifiutato dal servizio di posta.';
    else if(em.indexOf('allegato_non_recuperato:')!==-1) msg='Non sono riuscito a recuperare da Drive un allegato ('+em.split(':')[1]+'). La mail NON è stata inviata: togli la spunta a quel file e riprova.';
    else if(em) msg='Invio non riuscito ('+em+').';
    mailShowErr(msg);
  });
}


function setupMailWiring(){
  // Modal di scelta (copia / invia)
  var cCan=document.getElementById('btnMailChoiceCancel');
  if(cCan) cCan.addEventListener('click', function(){ chiudi('mmailChoice'); });
  var cCopy=document.getElementById('btnMailChoiceCopy');
  if(cCopy) cCopy.addEventListener('click', copyMailAddress);
  var cSend=document.getElementById('btnMailChoiceSend');
  if(cSend) cSend.addEventListener('click', function(){
    chiudi('mmailChoice');
    openMailModal(mailChoiceAddr, mailChoiceCallId);
  });

  var fi=document.getElementById('mailFileInput');
  if(fi) fi.addEventListener('change', renderMailSelected);
  var send=document.getElementById('btnMailSend');
  if(send) send.addEventListener('click', doSendMail);
  var can=document.getElementById('btnMailCancel');
  if(can) can.addEventListener('click', function(){ chiudi('mmail'); });
  var cl=document.getElementById('btnMailClose');
  if(cl) cl.addEventListener('click', function(){ chiudi('mmail'); });
}

// Wiring modali allegati (chiamato al boot)
function setupAttachWiring(){
  var inp=document.getElementById('attachFileInput');
  if(inp) inp.addEventListener('change', renderAttachSelected);
  var up=document.getElementById('btnAttachUpload');
  if(up) up.addEventListener('click', doAttachUpload);
  var can=document.getElementById('btnAttachCancel');
  if(can) can.addEventListener('click', function(){ chiudi('mattach'); });
  var dCan=document.getElementById('btnAttachDelCancel');
  if(dCan) dCan.addEventListener('click', function(){ chiudi('mattachDel'); attachToDelete=null; });
  var dOk=document.getElementById('btnAttachDelConfirm');
  if(dOk) dOk.addEventListener('click', doAttachDelete);
}


// ═══════════════════════════════════════════════════════════════════
// MODULO M — Relazione Medica
// Il modulo si compila a schermo, i dati restano in `moduli_m` (così è
// riapribile e correggibile) e alla prima riuscita viene generato un PDF
// caricato su Drive e registrato fra gli allegati della chiamata.
// ═══════════════════════════════════════════════════════════════════
var moduliMByCall={};        // chiamata_id -> record del modulo salvato
var modmCallId=null;         // chiamata su cui si sta lavorando
var modmSnapshot='';         // fotografia dei dati all'apertura (per rilevare modifiche)
var modmSegni=[];            // segni disegnati sulla figura: {t:tipo, x:%, y:%}
var modmSegnoAttivo=null;    // segno selezionato dalla legenda
var modmToDelete=null;
var modmFirma='';            // firma dell'assistito, immagine PNG in formato dati
var modmFirmaTratti=false;   // e stato disegnato qualcosa sulla lavagna della firma
var modmFirmaVigile=null;    // controllo periodico delle misure della lavagna
var modmFirmaStrokes=[];     // tratti in coordinate relative (0..1): la rotazione non li deforma
var modmFirmaInTratto=false; // penna appoggiata: mentre si scrive non si ridimensiona
var modmSezAperta=null;      // sezione attualmente aperta in dettaglio
var modmSalvaPoiChiudi=false;
var MODM_FS_BASE=12;         // corpo del testo sul foglio
var MODM_FS_MIN=8;           // sotto questa misura non si scende: resterebbe illeggibile

// Simboli della legenda, come sul modulo cartaceo
var MODM_SIMBOLI={
  contusione:'≠', ferita:'//', ustione:'Ø',
  frattura_esposta:'⚡', frattura_chiusa:'O'
};

// Sagome (fronte/retro) disegnate come SVG: nessun file esterno da caricare
function modmFiguraSvg(){
  var corpo=function(x){
    return '<g transform="translate('+x+',0)" fill="none" stroke="#2a3550" stroke-width="2.2" stroke-linejoin="round">'
      +'<ellipse cx="60" cy="26" rx="20" ry="24"/>'
      +'<path d="M60 50 L60 62"/>'
      +'<path d="M28 78 C34 66 46 62 60 62 C74 62 86 66 92 78 L96 128 L86 132 L84 100 L84 168 L72 250 L60 250 L60 168"/>'
      +'<path d="M60 168 L60 250 L48 250 L36 168 L36 100 L34 132 L24 128 L28 78 Z"/>'
      +'<path d="M96 128 L102 172 L96 176 L88 136"/>'
      +'<path d="M24 128 L18 172 L24 176 L32 136"/>'
      +'</g>';
  };
  return '<svg viewBox="0 0 300 270" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">'
    + corpo(10) + corpo(160) + '</svg>';
}

function modmCampi(){
  // Una sezione in compilazione e temporaneamente fuori dal foglio: va letta lo stesso
  var a=Array.prototype.slice.call(document.querySelectorAll('#modmFoglio [data-f]'));
  var b=Array.prototype.slice.call(document.querySelectorAll('#modmSezCorpo [data-f]'));
  return a.concat(b);
}

function modmLeggiDati(){
  var d={};
  var campi=modmCampi().sort(function(a,b){
    return a.dataset.f<b.dataset.f ? -1 : (a.dataset.f>b.dataset.f ? 1 : 0);
  });
  campi.forEach(function(el){
    var k=el.dataset.f;
    d[k] = (el.type==='checkbox') ? !!el.checked : (el.value||'');
  });
  d._segni = modmSegni.slice();
  d._firma = modmFirma || '';
  return d;
}

function modmScriviDati(d){
  d=d||{};
  modmCampi().forEach(function(el){
    var k=el.dataset.f;
    if(el.type==='checkbox') el.checked = !!d[k];
    else el.value = (d[k]!=null) ? d[k] : '';
  });
  modmSegni = Array.isArray(d._segni) ? d._segni.slice() : [];
  modmDisegnaSegni();
  modmFirma = d._firma || '';
  modmMostraFirma();
  modmCampi().forEach(function(el){ if(el.type!=='checkbox') el.dataset.prec=el.value||''; });
}

function modmDisegnaSegni(){
  var c=document.getElementById('modmFig');
  if(!c)return;
  Array.prototype.slice.call(c.querySelectorAll('.mm-segno')).forEach(function(n){ n.remove(); });
  modmSegni.forEach(function(s,i){
    var el=document.createElement('span');
    el.className='mm-segno';
    el.dataset.i=i;
    el.style.left=s.x+'%';
    el.style.top=s.y+'%';
    el.textContent=MODM_SIMBOLI[s.t]||'?';
    el.title='Tocca per rimuovere';
    c.appendChild(el);
  });
}

// Precompilazione dai dati della chiamata
// La riga di una chiamata: per quelle gia registrate si cerca per numero,
// per quelle ancora da inviare per impronta.
function modmTrovaRiga(callId){
  var s=String(callId||'');
  if(s.indexOf('local_')===0) return document.querySelector('tr[data-uuid="'+s.slice(6)+'"]');
  return document.querySelector('tr[data-row="'+s+'"]');
}

function modmPrecompila(callId){
  var tr=modmTrovaRiga(callId);
  var d={};
  var oggi=new Date();
  var p=function(n){return String(n).padStart(2,'0');};

  var tsf=tr?(tr.dataset.originalTs||''):'';
  var parts=tsf.split(/\s+/);
  d.data = parts[0] ? parts[0].slice(0,5) : (p(oggi.getDate())+'/'+p(oggi.getMonth()+1));
  d.anno = parts[0] ? parts[0].slice(-2) : String(oggi.getFullYear()).slice(-2);
  d.ora  = parts[1] || '';
  d.arrivo_ore = parts[1] || '';

  d.medico = currentUser ? (currentUser.full_name||'') : '';
  d.esito_firma = d.medico;
  d.regione = 'Lazio';

  var post = tr ? (tr.querySelector('.ptag') ? (tr.querySelector('.ptag').dataset.nome||'') : '') : '';
  d.sede = post;
  d.tipo_domiciliare = true;

  // Dalla descrizione: indirizzo, telefono a parte, nome ed età se riconoscibili
  var testo = tr ? getCellTextNoBadge(tr,'descrizione') : '';
  var righe = testo.split('\n').map(function(r){return r.trim();}).filter(Boolean);
  var indir = findAddressesInText(testo);
  if(indir.length){
    d.localita = indir[0].text;
    d.ass_indirizzo = indir[0].text;
    var cap = indir[0].text.match(/\b(\d{5})\b/);
    if(cap) d.ass_cap = cap[1];
    var com = capFromTable(indir[0].text);
    if(com){
      for(var k in CAP_COMUNI){
        if(CAP_COMUNI.hasOwnProperty(k) && CAP_COMUNI[k]===com && indir[0].text.toLowerCase().indexOf(k)!==-1){
          d.ass_comune = k.replace(/(^|\s)\S/g,function(t){return t.toUpperCase();});
          break;
        }
      }
    }
  }
  // Riga con nome ed età: es. "MARIO ROSSI 50AA" oppure "Mario Rossi 71"
  for(var i=0;i<righe.length;i++){
    var m=righe[i].match(/^([A-Za-zÀ-ÿ'\.\s]{5,50}?)[\s,\.]+(\d{1,3})\s*(?:aa|anni)?\b/i);
    if(m && !/^(via|viale|piazza|corso|largo|vicolo|strada|tel|cf|mail)/i.test(righe[i])){
      d.ass_nome = m[1].trim();
      d.ass_eta  = m[2];
      break;
    }
  }
  if(!d.ass_nome && righe.length>1) d.ass_nome='';
  d.motivi = righe.length ? righe[0] : '';
  return d;
}

function modmApri(callId){
  // Se il foglio era stato prestato alla fotografia, lo si riprende subito:
  // senza questo la finestra si aprirebbe grigia e vuota.
  if(fotografiaInCorso) fotografiaAnnullata=true;
  try{ modmModalitaStampa(false); }catch(_){}
  var f0=document.getElementById('modmFoglio');
  var palco=document.getElementById('modmPalco');
  if(f0 && palco && f0.parentNode!==palco){ try{ palco.appendChild(f0); }catch(_){} }

  modmCallId=callId;
  var salvato = moduliMByCall[String(callId)];
  modmSegnoAttivo=null;
  document.querySelectorAll('#modmLegenda .mm-lg').forEach(function(b){ b.classList.remove('att'); });

  var fig=document.getElementById('modmFig');
  if(fig && !fig.dataset.pronta){
    fig.innerHTML=modmFiguraSvg();
    fig.dataset.pronta='1';
  }

  modmScriviDati(salvato ? (salvato.dati||{}) : modmPrecompila(callId));

  // Il foglio a schermo non si compila: si guarda e si aprono le sezioni.
  // Se e gia stato firmato, e congelato: nemmeno le sezioni si aprono.
  var congelato = !!(salvato && salvato.firmato);
  var foglio=document.getElementById('modmFoglio');
  if(foglio){
    foglio.classList.add('mm-sola-lettura');
    foglio.classList.toggle('mm-congelato', congelato);
  }
  var bf=document.getElementById('btnModmFirma'), bs=document.getElementById('btnModmSave');
  if(bf) bf.style.display = congelato ? 'none' : '';
  if(bs) bs.style.display = congelato ? 'none' : '';

  modmSnapshot=JSON.stringify(modmLeggiDati());
  setModalBusy('mmodm', false);
  apri('mmodm');
  modmMisuraCampi();
  modmAdattaTutti();
  modmAdattaScala();
  modmAggiornaStato();
}

// Etichetta di stato nella barra: bozza modificabile oppure documento firmato
function modmAggiornaStato(){
  var e=document.getElementById('modmStato'); if(!e)return;
  var salvato=moduliMByCall[String(modmCallId)];
  var congelato=!!(salvato && salvato.firmato);
  e.className='modm-stato '+(congelato?'firmato':'bozza');
  e.textContent = congelato ? 'Firmato' : (modmFirma ? 'Firma apposta' : 'Bozza');
}

// ── Il foglio intero deve stare a schermo: lo rimpicciolisco quel tanto che basta ──
function modmAdattaScala(){
  var palco=document.getElementById('modmPalco');
  var foglio=document.getElementById('modmFoglio');
  var barra=document.querySelector('#mmodm .modm-toolbar');
  if(!palco || !foglio) return;
  foglio.style.transform='none';
  var w=foglio.offsetWidth, h=foglio.offsetHeight;
  if(!w || !h) return;
  var box=document.querySelector('#mmodm .modm-box');
  var largDisp = Math.min(window.innerWidth*0.98, window.innerWidth-10);

  // La barra dei comandi va misurata a finestra larga. Misurarla a finestra
  // stretta innescava una rincorsa: la barra andava a capo, rubava altezza,
  // il foglio si rimpiccioliva, la finestra si stringeva ancora - e cosi via,
  // fino a ridurre il modulo a un francobollo sul telefono girato.
  if(box){
    box.classList.remove('modm-compatta');
    box.style.setProperty('--modm-w', Math.round(largDisp)+'px');
  }
  var altDisp = window.innerHeight*0.98 - (barra?barra.offsetHeight:48) - 8;
  var k = Math.min(largDisp/w, altDisp/h, 1);

  // Se la finestra viene molto stretta (telefono girato) la barra si fa
  // compatta e resta su una riga: cosi l'altezza e nota e il foglio respira.
  if(box && w*k < 330){
    box.classList.add('modm-compatta');
    altDisp = window.innerHeight*0.98 - 40 - 8;      // la barra compatta e alta 40 fissi
    k = Math.min(largDisp/w, altDisp/h, 1);
  }

  var applica=function(scala){
    foglio.style.transform='scale('+scala+')';
    if(box) box.style.setProperty('--modm-w', Math.round(w*scala)+'px');
    palco.style.width  = Math.round(w*scala)+'px';
    palco.style.height = Math.round(h*scala)+'px';
  };
  applica(k);

  // Controllo sul risultato vero: se alla larghezza finale la barra e andata a
  // capo sforando lo schermo, la rendo compatta e rifaccio il conto una volta sola.
  if(box && !box.classList.contains('modm-compatta') && box.scrollHeight > window.innerHeight){
    box.classList.add('modm-compatta');
    applica(Math.min(largDisp/w, (window.innerHeight*0.98 - 40 - 8)/h, 1));
  }
}

// ── Campi a misura fissa: il testo rimpicciolisce fino a un minimo, poi si ferma ──
var _modmCtx=null;
function modmCtx(){
  if(!_modmCtx) _modmCtx=document.createElement('canvas').getContext('2d');
  return _modmCtx;
}
// Larghezza (e righe) che ogni campo ha sulla carta: misurate una volta sola,
// cosi restano il vincolo anche quando il campo e ingrandito in dettaglio.
function modmMisuraCampi(){
  var f=document.getElementById('modmFoglio'); if(!f)return;
  f.querySelectorAll('input[data-f]').forEach(function(el){
    if(el.type==='checkbox' || el.dataset.wpaper) return;
    var cs=getComputedStyle(el);
    var w=el.clientWidth - (parseFloat(cs.paddingLeft)||0) - (parseFloat(cs.paddingRight)||0);
    if(w>4) el.dataset.wpaper=String(Math.floor(w));
  });
  f.querySelectorAll('textarea[data-f]').forEach(function(el){
    if(el.dataset.wpaper) return;
    var cs=getComputedStyle(el);
    var w=el.clientWidth - (parseFloat(cs.paddingLeft)||0) - (parseFloat(cs.paddingRight)||0);
    var passo=parseFloat(cs.lineHeight)||20;
    var righe=Math.max(1, Math.floor(el.clientHeight/passo));
    if(w>4){ el.dataset.wpaper=String(Math.floor(w)); el.dataset.righe=String(righe); }
  });
}
// Quante righe occuperebbe il testo, alla larghezza della carta e a quel corpo
function modmRigheTesto(testo,largh,fs){
  var c=modmCtx(); c.font='400 '+fs+'px Arial, Helvetica, sans-serif';
  var tot=0;
  testo.split('\n').forEach(function(par){
    if(!par){ tot+=1; return; }
    var parole=par.split(/\s+/), riga='', righe=1;
    for(var i=0;i<parole.length;i++){
      var prova = riga ? riga+' '+parole[i] : parole[i];
      if(!riga || c.measureText(prova).width<=largh){ riga=prova; }
      else { righe++; riga=parole[i]; }
    }
    tot+=righe;
  });
  return tot;
}
// Ritorna false se il testo non ci sta nemmeno al corpo minimo
function modmAdattaCampo(el){
  if(!el || el.type==='checkbox' || !el.dataset || !el.dataset.f) return true;
  var largh=parseFloat(el.dataset.wpaper||0);
  if(!largh) return true;
  var testo=el.value||'';
  // In dettaglio il campo e ingrandito per comodita: il vincolo resta quello
  // della carta, ma il corpo del testo lo decide il foglio di stile.
  var inDettaglio = !!(el.closest && el.closest('#modmSezCorpo'));
  var fs, ok=false;
  if(el.tagName==='TEXTAREA'){
    var maxRighe=parseInt(el.dataset.righe||'4',10);
    for(fs=MODM_FS_BASE; fs>=MODM_FS_MIN; fs-=0.5){
      if(modmRigheTesto(testo,largh,fs)<=maxRighe){ ok=true; break; }
    }
  } else {
    var c=modmCtx();
    for(fs=MODM_FS_BASE; fs>=MODM_FS_MIN; fs-=0.5){
      c.font='400 '+fs+'px Arial, Helvetica, sans-serif';
      if(c.measureText(testo).width<=largh){ ok=true; break; }
    }
  }
  if(!ok){
    if(!inDettaglio) el.style.fontSize=MODM_FS_MIN+'px';   // almeno il massimo leggibile
    return false;
  }
  if(inDettaglio) el.style.fontSize='';
  else el.style.fontSize=fs+'px';
  return true;
}
function modmAdattaTutti(){ modmCampi().forEach(modmAdattaCampo); }

// Digitando: se si supera lo spazio disponibile sulla carta, il testo non entra
function modmGuardiaInput(el){
  if(!el || !el.dataset || !el.dataset.f || el.type==='checkbox') return;
  if(modmAdattaCampo(el)){ el.dataset.prec = el.value; return; }
  el.value = (el.dataset.prec!=null) ? el.dataset.prec : '';
  modmAdattaCampo(el);
  el.classList.add('mm-pieno');
  setTimeout(function(){ el.classList.remove('mm-pieno'); }, 450);
}

// ── Compilazione per sezioni ──
function modmApriSezione(nodo){
  if(!nodo || modmSezAperta) return;
  var corpo=document.getElementById('modmSezCorpo'); if(!corpo) return;
  // Un segnaposto delle stesse misure tiene ferma l'impaginazione del foglio
  var seg=document.createElement('div');
  seg.className='mm-segnaposto';
  seg.style.width=nodo.offsetWidth+'px';
  seg.style.height=nodo.offsetHeight+'px';
  seg.style.flex='0 0 auto';
  modmSezAperta={nodo:nodo, padre:nodo.parentNode, seg:seg};
  nodo.parentNode.insertBefore(seg, nodo);
  corpo.innerHTML='';
  corpo.appendChild(nodo);
  nodo.classList.add('mm-dettaglio');
  // Sul foglio il testo e rimpicciolito per stare nei puntini: qui si legge in grande
  nodo.querySelectorAll('[data-f]').forEach(function(el){ el.style.fontSize=''; });
  var t=document.getElementById('modmSezTit');
  if(t) t.textContent = nodo.dataset.sezTit || 'Sezione';
  apri('mmodmSez');
}
function modmChiudiSezione(){
  var x=modmSezAperta; if(!x) return;
  modmSezAperta=null;
  x.nodo.classList.remove('mm-dettaglio');
  try{ x.padre.insertBefore(x.nodo, x.seg); }catch(_){ try{ x.padre.appendChild(x.nodo); }catch(__){} }
  if(x.seg.parentNode) x.seg.parentNode.removeChild(x.seg);
  chiudi('mmodmSez');
  modmAdattaTutti();
  modmAdattaScala();
  modmAggiornaStato();
}

// ── Firma dell'assistito ──
function modmMostraFirma(){
  var box=document.getElementById('modmFirmaBox'), img=document.getElementById('modmFirmaImg');
  if(!box || !img) return;
  if(modmFirma){ img.src=modmFirma; box.classList.add('ha-firma'); }
  else { img.removeAttribute('src'); box.classList.remove('ha-firma'); }
}
function modmFirmaApri(){
  if(modmFirma){ apri('mmodmFirmaWarn'); return; }   // rifarla cancella quella attuale
  modmFirmaAvvia();
}
function modmFirmaAvvia(){
  apri('mmodmFirma');
  setTimeout(modmFirmaPulisci, 40);                  // serve il modale gia disegnato
  setTimeout(modmFirmaAdatta, 400);                  // e se era nascosta, appena compare
  clearInterval(modmFirmaVigile);
  modmFirmaVigile=setInterval(modmFirmaVigilanza, 400);
}
// Tiene d'occhio le misure finche la finestra della firma e aperta, poi si spegne.
// La verifica costa nulla: se e gia tutto a posto, modmFirmaAdatta esce subito.
function modmFirmaVigilanza(){
  var ov=document.getElementById('mmodmFirma');
  if(!ov || !ov.classList.contains('open')){
    clearInterval(modmFirmaVigile); modmFirmaVigile=null; return;
  }
  modmFirmaAdatta();
}
function modmFirmaPulisci(){
  modmFirmaStrokes=[];
  modmFirmaTratti=false;
  modmFirmaSync(true);
}
// La lavagna prende le proporzioni esatte dello spazio che la firma avra sul
// modulo: quello che si disegna e quello che si vedra stampato, senza schiacciature.
function modmMisureLavagna(){
  var slot=document.getElementById('modmFirmaSlot');
  var guscio=document.querySelector('#mmodmFirma .modm-firma-guscio');
  if(!slot || !guscio) return null;
  // Guscio nascosto (schermo in piedi) o stretto in modo implausibile:
  // niente misure inventate. E il non-inventare che evita la lavagna 80x12.
  if(!guscio.offsetWidth || guscio.clientWidth<160) return null;
  var rapporto = (slot.offsetWidth && slot.offsetHeight) ? (slot.offsetWidth/slot.offsetHeight) : 6.7;
  var cs=getComputedStyle(guscio);
  var largh = guscio.clientWidth - (parseFloat(cs.paddingLeft)||0) - (parseFloat(cs.paddingRight)||0) - 4;
  if(largh<160) return null;
  var alt = largh/rapporto;
  // Non deve sfondare l'altezza disponibile nella finestra
  var altMax = Math.max(90, window.innerHeight*0.52);
  if(alt>altMax){ alt=altMax; largh=alt*rapporto; }
  return { largh:Math.round(largh), alt:Math.round(alt) };
}

// Un'unica funzione rimette tutto in squadra: misura lo spazio, dimensiona la
// lavagna, allinea il disegno interno a quel che si vede e ridisegna i tratti.
// I tratti sono conservati in coordinate relative: qualunque giravolta del
// telefono li ridisegna al posto giusto, mai sfalsati.
function modmFirmaSync(forza){
  var ov=document.getElementById('mmodmFirma');
  if(!ov || !ov.classList.contains('open')) return false;
  if(modmFirmaInTratto && !forza) return true;       // penna appoggiata: non adesso
  var cv=document.getElementById('modmFirmaCanvas');
  var area=document.getElementById('modmFirmaArea');
  if(!cv || !area || !area.offsetWidth) return false; // nascosta (schermo in piedi)
  var m=modmMisureLavagna();
  if(m){
    if(cv.style.width !== m.largh+'px') cv.style.width=m.largh+'px';
    if(cv.style.height !== m.alt+'px')  cv.style.height=m.alt+'px';
  }
  var r=cv.getBoundingClientRect();
  if(!r.width || !r.height) return false;
  var dpr=window.devicePixelRatio||1;
  var W=Math.round(r.width*dpr), H=Math.round(r.height*dpr);
  if(!forza && cv.width===W && cv.height===H) return true;   // gia in squadra
  cv.width=W; cv.height=H;                                    // azzera bitmap e stato
  var ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#12203f';
  modmFirmaStrokes.forEach(function(tr){
    if(!tr.length) return;
    ctx.beginPath();
    ctx.moveTo(tr[0].x*r.width, tr[0].y*r.height);
    if(tr.length===1) ctx.lineTo(tr[0].x*r.width+0.1, tr[0].y*r.height);
    for(var i=1;i<tr.length;i++) ctx.lineTo(tr[i].x*r.width, tr[i].y*r.height);
    ctx.stroke();
  });
  var haFirma=modmFirmaStrokes.length>0;
  modmFirmaTratti=haFirma;
  area.classList.toggle('ha-firma', haFirma);
  var hint=document.getElementById('modmFirmaHint');
  if(hint) hint.style.visibility = haFirma ? 'hidden' : '';
  return true;
}
function modmFirmaAdatta(){ modmFirmaSync(false); }

// Ritaglio attorno all'inchiostro: cosi la firma riempie bene il suo spazio sul foglio
function modmRitagliaFirma(){
  var cv=document.getElementById('modmFirmaCanvas');
  if(!cv || !cv.width) return '';
  var ctx=cv.getContext('2d');
  var dati=ctx.getImageData(0,0,cv.width,cv.height).data;
  var x0=cv.width, y0=cv.height, x1=-1, y1=-1;
  for(var y=0;y<cv.height;y++){
    for(var x=0;x<cv.width;x++){
      if(dati[(y*cv.width+x)*4+3]>12){
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
      }
    }
  }
  if(x1<0) return '';
  var m=Math.round(6*(window.devicePixelRatio||1));
  x0=Math.max(0,x0-m); y0=Math.max(0,y0-m);
  x1=Math.min(cv.width-1,x1+m); y1=Math.min(cv.height-1,y1+m);
  var w=x1-x0+1, h=y1-y0+1;
  var out=document.createElement('canvas'); out.width=w; out.height=h;
  out.getContext('2d').drawImage(cv,x0,y0,w,h,0,0,w,h);
  return out.toDataURL('image/png');
}
function modmFirmaConferma(){
  modmFirma = modmFirmaTratti ? modmRitagliaFirma() : '';
  modmMostraFirma();
  chiudi('mmodmFirma');
  modmAggiornaStato();
}

function modmModificato(){
  return JSON.stringify(modmLeggiDati())!==modmSnapshot;
}

// Uscita: se ci sono modifiche non salvate, chiede conferma
function modmChiudi(forza){
  if(modmSezAperta){ modmChiudiSezione(); return; }
  var salvato=moduliMByCall[String(modmCallId)];
  var congelato=!!(salvato && salvato.firmato);
  if(!forza && !congelato && modmModificato()){ apri('mmodmExit'); return; }
  chiudi('mmodm');
  modmCallId=null;
}

// Prima di fotografare il foglio: le caselle disegnate via CSS e le aree di
// testo non vengono catturate in modo affidabile, quindi le sostituisco
// temporaneamente con elementi semplici e poi ripristino tutto.
// Per la fotografia il foglio viene tolto dal contenitore con scorrimento e
// appoggiato su un fondo bianco fuori schermo: cosi nessun antenato lo taglia
// ne gli lascia dietro bande grigie.
var modmFoglioPosto=null;
function modmSollevaFoglio(foglio){
  if(modmFoglioPosto) return;
  modmFoglioPosto={padre:foglio.parentNode, prima:foglio.nextSibling,
                   trasf:foglio.style.transform, posiz:foglio.style.position};
  foglio.style.transform='none';        // si fotografa a grandezza naturale
  foglio.style.position='static';
  var w=document.getElementById('modmCapture');
  if(!w){
    w=document.createElement('div');
    w.id='modmCapture';
    document.body.appendChild(w);
  }
  w.setAttribute('style','position:absolute;top:0;left:-20000px;width:964px;background:#fff;padding:0;margin:0;z-index:0;pointer-events:none');
  w.appendChild(foglio);
}
function modmRiponiFoglio(foglio){
  if(!modmFoglioPosto) return;
  var p=modmFoglioPosto; modmFoglioPosto=null;
  foglio.style.transform=p.trasf||'';
  foglio.style.position=p.posiz||'';
  try{ p.padre.insertBefore(foglio, p.prima); }catch(_){ try{ p.padre.appendChild(foglio); }catch(__){} }
  var w=document.getElementById('modmCapture');
  if(w && w.parentNode) w.parentNode.removeChild(w);
}
function modmModalitaStampa(attiva){
  var foglio=document.getElementById('modmFoglio');
  if(!foglio)return;
  var scroll=document.querySelector('.modm-scroll');
  // Pulizia preventiva: evita doppioni se la modalita era rimasta attiva
  foglio.querySelectorAll('.mm-print-ck,.mm-print-ta,.mm-print-in').forEach(function(n){ n.remove(); });
  foglio.querySelectorAll('input,textarea').forEach(function(n){ n.style.display=''; });
  modmRiponiFoglio(foglio);
  if(attiva){
    foglio.classList.add('mm-stampa');
    if(scroll) scroll.style.background='#fff';      // niente bande grigie nella cattura
    modmSollevaFoglio(foglio);
    foglio.querySelectorAll('input[type="checkbox"]').forEach(function(cb){
      var s=document.createElement('span');
      s.className='mm-print-ck';
      s.textContent = cb.checked ? '✓' : '';
      cb.style.display='none';
      cb.parentNode.insertBefore(s, cb.nextSibling);
    });
    foglio.querySelectorAll('textarea').forEach(function(ta){
      var d=document.createElement('div');
      d.className='mm-print-ta';
      d.textContent=ta.value||'';
      d.style.minHeight=ta.offsetHeight+'px';
      ta.style.display='none';
      ta.parentNode.insertBefore(d, ta.nextSibling);
    });
    foglio.querySelectorAll('input:not([type="checkbox"])').forEach(function(i){
      var d=document.createElement('span');
      d.className='mm-print-in';
      d.textContent=i.value||'';
      d.style.width=i.offsetWidth+'px';
      if(i.classList.contains('mm-grow')||i.classList.contains('mm-in-line')) d.style.flex=i.style.flex||'';
      i.style.display='none';
      i.parentNode.insertBefore(d, i.nextSibling);
    });
  } else {
    foglio.classList.remove('mm-stampa');
    if(scroll) scroll.style.background='';
    foglio.querySelectorAll('.mm-print-ck,.mm-print-ta,.mm-print-in').forEach(function(n){ n.remove(); });
    foglio.querySelectorAll('input,textarea').forEach(function(n){ n.style.display=''; });
  }
}

// ── Salvataggio: dati nel database + PDF su Drive fra gli allegati ──
// Tetto di tempo: il generatore di immagini, su alcuni dispositivi, puo non
// rispondere mai. Senza un limite lo spinner girava all'infinito e il Modulo M
// non entrava nemmeno in coda: restava nel nulla.
var PDF_ATTESA_MAX=30000;
// Il foglio e uno solo: mentre viene fotografato non puo essere anche
// dentro la finestra. Questo dice se e impegnato e permette di annullare.
var fotografiaInCorso=false, fotografiaAnnullata=false;
function modmGeneraPdf(){
  fotografiaInCorso=true; fotografiaAnnullata=false;
  return new Promise(function(risolvi, rifiuta){
    var chiuso=false;
    var scadenza=setTimeout(function(){
      if(chiuso) return; chiuso=true;
      fotografiaInCorso=false;
      try{ modmModalitaStampa(false); }catch(_){}
      rifiuta(new Error('pdf_lento'));
    }, PDF_ATTESA_MAX);
    modmGeneraPdfInterno().then(function(b){
      if(chiuso) return; chiuso=true; clearTimeout(scadenza);
      fotografiaInCorso=false;
      if(fotografiaAnnullata){ rifiuta(new Error('pdf_annullato')); return; }
      risolvi(b);
    }).catch(function(e){
      if(chiuso) return; chiuso=true; clearTimeout(scadenza);
      fotografiaInCorso=false;
      rifiuta(e);
    });
  });
}
function modmGeneraPdfInterno(){
  var foglio=document.getElementById('modmFoglio');
  return loadScriptOnce(PDF_LIB_H2C,'html2canvas')
    .then(function(){ return loadScriptOnce(PDF_LIB_JSPDF,'jspdf.jsPDF'); })
    .then(function(){
      if(!window.html2canvas) throw new Error('pdf_lib');
      modmModalitaStampa(true);
      return window.html2canvas(foglio,{
        scale:2, backgroundColor:'#ffffff', logging:false, useCORS:true, removeContainer:true
      })
        .then(function(c){ modmModalitaStampa(false); return c; })
        .catch(function(err){ modmModalitaStampa(false); throw err; });
    })
    .then(function(canvas){
      var jsPDFctor = (window.jspdf&&window.jspdf.jsPDF) || window.jsPDF;
      if(!jsPDFctor) throw new Error('pdf_lib');
      var img=canvas.toDataURL('image/jpeg',0.86);
      var pdf=new jsPDFctor({orientation:'portrait',unit:'mm',format:'a4'});
      var pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
      var margine=6;
      var maxW=pw-margine*2, maxH=ph-margine*2;
      var r=Math.min(maxW/canvas.width, maxH/canvas.height);
      var w=canvas.width*r, h=canvas.height*r;
      pdf.addImage(img,'JPEG',(pw-w)/2,margine,w,h);
      return pdf.output('blob');
    });
}

// ═══════════════════════════════════════════════════════════════════
// CODA LOCALE DEI MODULI M — il modulo si compila e si firma anche in
// campagna. Qui restano dati, firma e (se generato) il PDF, finche la
// linea non torna. IndexedDB regge i file; se manca, si ripiega su
// localStorage coi soli dati e il PDF si rigenera al momento dell'invio.
// ═══════════════════════════════════════════════════════════════════
var MODM_DB='gm_moduli_m', MODM_STORE='coda', MODM_LS='moduliMCoda_v1';
var _modmDb=null;
function modmDb(){
  if(_modmDb) return Promise.resolve(_modmDb);
  return new Promise(function(res,rej){
    if(!window.indexedDB){ rej(new Error('no_idb')); return; }
    var r=indexedDB.open(MODM_DB,1);
    r.onupgradeneeded=function(e){
      var db=e.target.result;
      if(!db.objectStoreNames.contains(MODM_STORE)) db.createObjectStore(MODM_STORE,{keyPath:'chiamata_id'});
    };
    r.onsuccess=function(){ _modmDb=r.result; res(_modmDb); };
    r.onerror=function(){ rej(r.error||new Error('idb')); };
  });
}
function modmCodaScrivi(rec){
  return modmDb().then(function(db){
    return new Promise(function(res,rej){
      var t=db.transaction(MODM_STORE,'readwrite');
      t.objectStore(MODM_STORE).put(rec);
      t.oncomplete=function(){ res(true); };
      t.onerror=function(){ rej(t.error); };
    });
  }).catch(function(){
    // Ripiego: senza IndexedDB si tiene tutto tranne il PDF (si rifara)
    try{
      var q=JSON.parse(localStorage.getItem(MODM_LS)||'{}');
      q[String(rec.chiamata_id)]={chiamata_id:rec.chiamata_id, dati:rec.dati, firmato:rec.firmato, nome:rec.nome, ts:rec.ts};
      localStorage.setItem(MODM_LS, JSON.stringify(q));
      return true;
    }catch(_){ return false; }
  });
}
function modmCodaCancella(callId){
  return modmDb().then(function(db){
    return new Promise(function(res){
      var t=db.transaction(MODM_STORE,'readwrite');
      var st=t.objectStore(MODM_STORE);
      // La chiamata puo essere stata salvata come numero (357) o come testo
      // ("357", "local_..."): si prova in entrambe le forme, altrimenti la
      // voce resterebbe in coda anche dopo averla tolta.
      st.delete(callId);
      var alt = (typeof callId==='number') ? String(callId)
              : (/^\d+$/.test(String(callId)) ? parseInt(callId,10) : null);
      if(alt!==null) st.delete(alt);
      t.oncomplete=function(){ res(true); };
      t.onerror=function(){ res(false); };
    });
  }).catch(function(){ return true; }).then(function(){
    try{
      var q=JSON.parse(localStorage.getItem(MODM_LS)||'{}');
      delete q[String(callId)];
      localStorage.setItem(MODM_LS, JSON.stringify(q));
    }catch(_){}
    return true;
  });
}
function modmCodaLeggi(){
  return modmDb().then(function(db){
    return new Promise(function(res){
      var t=db.transaction(MODM_STORE,'readonly');
      var q=t.objectStore(MODM_STORE).getAll();
      q.onsuccess=function(){ res(q.result||[]); };
      q.onerror=function(){ res([]); };
    });
  }).catch(function(){
    try{
      var o=JSON.parse(localStorage.getItem(MODM_LS)||'{}');
      return Object.keys(o).map(function(k){ return o[k]; });
    }catch(_){ return []; }
  });
}

// I moduli in coda si vedono subito in elenco, come se fossero gia salvati
var moduliMLocali={};
function modmCaricaCodaInMappa(){
  return modmCodaLeggi().then(function(righe){
    moduliMLocali={};
    righe.forEach(function(r){ moduliMLocali[String(r.chiamata_id)]=r; });
    try{ syncRenderBadge(); }catch(_){}
    return moduliMLocali;
  });
}
function modmApplicaLocali(){
  Object.keys(moduliMLocali).forEach(function(k){
    var r=moduliMLocali[k];
    // Se manca solo il documento, il modulo e gia sul server: non va
    // segnalato come «da inviare», sarebbe un falso allarme.
    if(r.soloDocumento && moduliMByCall[k]) return;
    moduliMByCall[k]={ chiamata_id:r.chiamata_id, dati:r.dati, firmato:!!r.firmato,
                       drive_file_id:null, allegato_id:null, file_name:r.nome||null,
                       inCoda:!r.soloDocumento };
  });
}

// ── Svuotamento della coda: appena c'e linea ──
// Pausa crescente fra i tentativi: 30s, 1m, 2m, 4m... mai oltre 10 minuti.
function prossimaPausa(tentativi){
  return Math.min(10*60000, 30000*Math.pow(2, Math.max(0,(tentativi||1)-1)));
}
function erroreDiAutorizzazione(err){
  var m=String((err&&err.message)||err||'');
  return m.indexOf('token')!==-1 || m.indexOf('popup')!==-1 || m.indexOf('401')!==-1
      || m.indexOf('no_session')!==-1 || m.indexOf('drive_not_configured')!==-1;
}

// Un modulo o un allegato agganciati a una chiamata «non ancora registrata»
// restano fermi finche non si scopre il numero vero. Questo lo chiede al
// server e rifa il collegamento: senza, dopo un riavvio dell'app resterebbero
// bloccati per sempre.
function risolviEtichetteProvvisorie(){
  return Promise.all([modmCodaLeggi(), allegCodaLeggi()]).then(function(r){
    var uuid={};
    (r[0]||[]).forEach(function(x){ var k=String(x.chiamata_id); if(k.indexOf('local_')===0) uuid[k.slice(6)]=1; });
    (r[1]||[]).forEach(function(x){ var k=String(x.chiamata_id); if(k.indexOf('local_')===0) uuid[k.slice(6)]=1; });
    var elenco=Object.keys(uuid);
    if(!elenco.length) return false;
    var catena=Promise.resolve(), risolti=0;
    elenco.forEach(function(u){
      catena=catena.then(function(){
        // Se la chiamata e ancora in coda, il collegamento lo fara l'invio
        var inCoda=syncLoadQueue().some(function(e){ return e.type==='insert' && e.client_uuid===u; });
        if(inCoda) return null;
        return sbFetch('chiamate?client_uuid=eq.'+encodeURIComponent(u)+'&select=id')
          .then(function(res){ return res.json(); })
          .then(function(righe){
            var id=(Array.isArray(righe)&&righe[0])?righe[0].id:null;
            if(id==null) return null;
            risolti++;
            return modmRimappaLocale(u, id);
          }).catch(function(){ return null; });
      });
    });
    return catena.then(function(){ return risolti>0; });
  }).catch(function(){ return false; });
}

var _modmDrenaggio=false;
var _modmDaRifare=false;
function modmCodaDrena(){
  if(_modmDrenaggio){ _modmDaRifare=true; return Promise.resolve(); }
  if(!isOnline() || !currentUser) return Promise.resolve();
  _modmDrenaggio=true;
  var forza=arguments.length>0 && arguments[0]===true;
  return inSfondoDrive(risolviEtichetteProvvisorie().then(modmCodaLeggi).then(function(righeTutte){
    var adesso=Date.now();
    var righe=righeTutte.filter(function(r){ return forza || !r.dopo || r.dopo<=adesso; });
    // Coda vuota: si esce SENZA interrogare il database (niente traffico sprecato)
    if(!righe.length) return false;
    return ensureFreshToken().then(function(){
      var catena=Promise.resolve(), fatti=0;
      righe.forEach(function(r){
        catena=catena.then(function(){
          segnalaInvio(righe.length===1?'il Modulo M':'i Moduli M', fatti, righe.length);
          return modmInvia(r).then(function(e){ fatti++; return e; });
        });
      });
      return catena.then(function(){ return true; });
    });
  }).then(function(cerano){
    _modmDrenaggio=false; fineInvio();
    if(!cerano){
      if(_modmDaRifare){ _modmDaRifare=false; return modmCodaDrena(); }
      return;
    }
    return modmCaricaCodaInMappa().then(function(){
      if(typeof getVisibleCallIds==='function'){
        return caricaModuliM(getVisibleCallIds()).then(function(){ modmApplicaLocali(); injectModmUi(); });
      }
    }).then(function(){
      if(_modmDaRifare){ _modmDaRifare=false; return modmCodaDrena(); }
    });
  }).catch(function(){
    _modmDrenaggio=false; fineInvio();
    if(_modmDaRifare){ _modmDaRifare=false; modmCodaDrena(); }
  }));
}

// Invio di UN modulo dalla coda al server (e a Drive, se firmato)
function modmInvia(rec){
  var callId=rec.chiamata_id;
  if(String(callId).indexOf('local_')===0) return Promise.resolve(false);  // la chiamata non e ancora sul server
  var esistente=moduliMByCall[String(callId)];
  if(esistente && esistente.inCoda) esistente=null;

  var passo;
  if(rec.firmato){
    var pdf=rec.pdf;
    // Se il documento non si riesce a produrre, NON si rinuncia all'invio:
    // dati e firma vanno sul server lo stesso (sono loro che contano) e il
    // documento verra aggiunto a un tentativo successivo.
    passo=(pdf ? Promise.resolve(pdf) : modmRigeneraPdf(rec)).then(function(blob){
      if(!blob) return null;
      // Il nome si ricalcola ora: se il modulo era stato compilato prima che
      // la chiamata avesse un numero, porterebbe ancora l'etichetta provvisoria.
      var nome='Modulo M - chiamata '+callId+'.pdf';
      var file=new File([blob], nome, {type:'application/pdf'});
      return driveUpload(file).then(function(f){
        var vecchio=esistente && esistente.drive_file_id;
        var pulizia=(vecchio && vecchio!==f.id) ? driveDelete(vecchio).catch(function(){}) : Promise.resolve();
        return pulizia.then(function(){ return {f:f, nome:nome, size:blob.size}; });
      });
    }).then(function(up){
      // Documento non prodotto: si prosegue lo stesso, i dati contano di piu
      if(!up) return null;
      var vecchioAll=esistente && esistente.allegato_id;
      return sbFetch('allegati?select=id',{
        method:'POST', prefer:'return=representation',
        body:{ chiamata_id:callId, drive_file_id:up.f.id, file_name:up.nome,
               mime_type:'application/pdf', size_bytes:up.size,
               user_id: currentUser?currentUser.id:null }
      }).then(function(r){ return r.json(); }).then(function(rows){
        var allegatoId=(Array.isArray(rows)&&rows[0])?rows[0].id:null;
        if(vecchioAll){
          return sbFetch('allegati?id=eq.'+vecchioAll,{method:'DELETE'}).catch(function(){})
            .then(function(){ return {allegatoId:allegatoId, up:up}; });
        }
        return {allegatoId:allegatoId, up:up};
      });
    });
  } else {
    passo=Promise.resolve(null);
  }

  return passo.then(function(x){
    var corpo={ chiamata_id:callId, dati:rec.dati, firmato:!!rec.firmato,
                user_id: currentUser?currentUser.id:null };
    if(x){ corpo.drive_file_id=x.up.f.id; corpo.file_name=x.up.nome; corpo.allegato_id=x.allegatoId; }
    var req = esistente
      ? sbFetch('moduli_m?chiamata_id=eq.'+callId,{method:'PATCH',prefer:'return=minimal',body:corpo})
      : sbFetch('moduli_m',{method:'POST',prefer:'return=minimal',body:corpo});
    return req.then(function(res){
      if(!res.ok && res.status!==409) throw new Error('db_'+res.status);
      if(rec.firmato && !x){
        // Salvato senza documento: si tiene in coda solo il compito di
        // produrlo, non tutto il modulo (che ormai e al sicuro sul server).
        rec.soloDocumento=true;
        return modmCodaScrivi(rec).then(function(){ return true; });
      }
      return modmCodaCancella(callId).then(function(){ return true; });
    });
  }).catch(function(err){
    // Resta in coda, ma con una pausa che cresce: niente martellamento
    rec.tentativi=(rec.tentativi||0)+1;
    rec.dopo=Date.now()+prossimaPausa(rec.tentativi);
    if(erroreDiAutorizzazione(err)){
      rec.dopo=Date.now()+5*60000;
      try{ driveMostraInvito(); }catch(_){}
    }
    return modmCodaScrivi(rec).catch(function(){}).then(function(){ return false; });
  });
}

// Se il PDF non era stato generato (librerie non disponibili in campagna),
// lo si costruisce ora riusando il foglio, ma solo se nessuno lo sta usando.
function modmRigeneraPdf(rec){
  if(modmCallId!=null) return Promise.resolve(null);   // c'e un modulo aperto: non tocco il foglio
  var foglio=document.getElementById('modmFoglio');
  if(!foglio) return Promise.resolve(null);
  var salvaCorrente=modmLeggiDati();
  return Promise.resolve().then(function(){
    modmScriviDati(rec.dati||{});
    modmMisureCampi_sicuro();
    return modmGeneraPdf();
  }).then(function(blob){
    modmScriviDati(salvaCorrente);
    return blob;
  }).catch(function(){
    try{ modmScriviDati(salvaCorrente); }catch(_){}
    return null;
  });
}
function modmMisureCampi_sicuro(){ try{ modmMisuraCampi(); modmAdattaTutti(); }catch(_){} }

if(typeof window!=='undefined'){
  window.addEventListener('online', function(){ setTimeout(modmCodaDrena, 1200); });
  setInterval(function(){ modmCodaDrena(); }, 20000);
}

// Una chiamata scritta offline non ha ancora un numero: il Modulo M compilato
// sopra vive sotto l'etichetta provvisoria «local_…». Appena la chiamata viene
// registrata, il modulo trasloca sul numero vero e parte con gli altri.
function modmRimappaLocale(clientUuid, idVero){
  if(!clientUuid || idVero==null) return Promise.resolve(false);
  var chiaveVecchia='local_'+clientUuid;
  var vecchio=moduliMLocali[chiaveVecchia];
  var applica=function(rec){
    if(!rec) return false;
    var nuovo={};
    Object.keys(rec).forEach(function(k){ nuovo[k]=rec[k]; });
    nuovo.chiamata_id=idVero;
    nuovo.nome='Modulo M - chiamata '+idVero+'.pdf';
    delete moduliMLocali[chiaveVecchia];
    delete moduliMByCall[chiaveVecchia];
    moduliMLocali[String(idVero)]=nuovo;
    return modmCodaScrivi(nuovo).then(function(){
      return modmCodaCancella(chiaveVecchia);
    }).then(function(){ modmApplicaLocali(); return true; });
  };
  // Gli allegati in attesa seguono la chiamata al suo numero vero
  allegCodaLeggi().then(function(righe){
    var miei=righe.filter(function(x){ return String(x.chiamata_id)===chiaveVecchia; });
    if(!miei.length) return null;
    var catena=Promise.resolve();
    miei.forEach(function(r){
      catena=catena.then(function(){ r.chiamata_id=idVero; return allegCodaScrivi(r); });
    });
    return catena.then(allegCaricaCodaInMappa).then(function(){ allegCodaDrena(); });
  }).catch(function(){});

  if(vecchio) return Promise.resolve(applica(vecchio));
  // potrebbe essere solo su disco (app riaperta): lo cerco li
  return modmCodaLeggi().then(function(righe){
    var r=righe.filter(function(x){ return String(x.chiamata_id)===chiaveVecchia; })[0];
    return r ? applica(r) : false;
  }).catch(function(){ return false; });
}

// Chiede conferma spiegando che cosa comporta il salvataggio: senza firma
// il modulo resta una bozza correggibile, con la firma si chiude per sempre.
function modmChiediSalva(poiChiudi){
  if(!modmCallId) return;
  modmSalvaPoiChiudi=!!poiChiudi;
  var conFirma=!!modmFirma;
  var t=document.getElementById('mmodmSalvaTit');
  var m=document.getElementById('mmodmSalvaMsg');
  var b=document.getElementById('btnModmSalvaSi');
  if(t) t.textContent = conFirma ? 'Chiudere il modulo con la firma?' : 'Salvare la bozza?';
  if(m) m.innerHTML = conFirma
    ? 'C&rsquo;&egrave; la firma dell&rsquo;assistito: il modulo verr&agrave; <b>chiuso e non sar&agrave; pi&ugrave; modificabile</b>. Viene generato il PDF e caricato su Google Drive fra gli allegati della chiamata.'
    : 'Il modulo viene salvato come bozza e <b>resta modificabile</b> finch&eacute; non apporrai la firma dell&rsquo;assistito. Il PDF su Google Drive verr&agrave; creato solo al momento della firma.';
  if(b) b.textContent = conFirma ? 'Firma e chiudi' : 'Salva bozza';
  apri('mmodmSalva');
}

function modmSalva(poiChiudi){
  if(!modmCallId){ return Promise.resolve(false); }
  var callId=modmCallId;
  var dati=modmLeggiDati();
  var conFirma=!!modmFirma;
  var nomeFile='Modulo M - chiamata '+callId+'.pdf';

  // ── PRIMA DI TUTTO: al sicuro sul dispositivo ──────────────────────
  // Dati e firma vengono scritti subito. Nessuna rete, nessun generatore
  // di documenti: e istantaneo e non puo fallire per colpa della linea.
  // Il PDF si costruisce dopo, quando il modulo parte davvero.
  setModalBusy('mmodm', true, 'Salvo sul dispositivo\u2026');

  return modmCodaScrivi({
    chiamata_id:callId, dati:dati, firmato:conFirma,
    pdf:null, nome:nomeFile, ts:Date.now()
  }).then(function(ok){
    setModalBusy('mmodm', false);
    if(!ok){
      // Nemmeno la memoria del dispositivo e disponibile: non si chiude nulla
      fb(false,'Salvataggio non riuscito','La memoria del dispositivo non \u00e8 disponibile. Non chiudere il modulo: copia altrove i dati importanti e riprova.');
      return false;
    }

    // Da questo momento il modulo NON si perde piu, qualunque cosa accada.
    modmSnapshot=JSON.stringify(dati);
    moduliMLocali[String(callId)]={chiamata_id:callId, dati:dati, firmato:conFirma, nome:nomeFile};
    modmApplicaLocali();
    try{ syncRenderBadge(); }catch(_){}
    if(poiChiudi || conFirma){ chiudi('mmodm'); modmCallId=null; }
    injectModmUi();

    var chiamataLocale=String(callId).indexOf('local_')===0;
    if(!isOnline()){
      fb(true, conFirma ? 'Modulo M firmato e al sicuro' : 'Bozza salvata sul dispositivo',
         (conFirma ? 'Firma e dati sono salvi qui. ' : 'Resta modificabile. ')
         +(chiamataLocale ? 'Partir\u00e0 insieme alla chiamata, appena questa viene registrata.'
                          : 'Partir\u00e0 da solo appena torna la linea.'));
      return true;
    }

    // ── POI, senza far aspettare nessuno: documento e invio ──
    fb(true, conFirma ? 'Modulo M firmato' : 'Bozza salvata',
       conFirma ? 'Al sicuro sul dispositivo. Preparo il documento e lo carico su Google Drive\u2026'
                : 'Resta modificabile finch\u00e9 non apporrai la firma dell\u2019assistito.');
    setTimeout(function(){ try{ modmCodaDrena(); }catch(_){} }, 150);
    return true;
  }).catch(function(e){
    setModalBusy('mmodm', false);
    fb(false,'Salvataggio non riuscito','Errore imprevisto ('+String((e&&e.message)||'')+'). I dati restano nel modulo: riprova.');
    return false;
  });
}

// ── Elenco moduli esistenti (per sapere dove mostrare la M) ──
function caricaModuliM(callIds){
  var ids=(callIds||[]).filter(function(x){ return x && String(x).indexOf('local_')!==0; });
  if(!ids.length){ moduliMByCall={}; return Promise.resolve({}); }
  return sbFetch('moduli_m?chiamata_id=in.('+ids.join(',')+')&select=*')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      if(!Array.isArray(rows)) return moduliMByCall;       // errore: si tiene la mappa nota
      var nuova={};
      rows.forEach(function(m){ nuova[String(m.chiamata_id)]=m; });
      moduliMByCall=nuova;
      return moduliMByCall;
    }).catch(function(){ return moduliMByCall; });
}

// ── Eliminazione ──
function modmPromptDelete(callId){
  modmToDelete=callId;
  setModalBusy('mmodmDel', false);
  apri('mmodmDel');
}
function modmElimina(){
  var callId=modmToDelete;
  var m=moduliMByCall[String(callId)];
  if(!m){ chiudi('mmodmDel'); return; }
  // Via anche dalla coda locale, altrimenti tornerebbe da sola col prossimo invio
  delete moduliMLocali[String(callId)];
  modmCodaCancella(callId);
  if(!isOnline()){ fb(false,'Serve connessione','Impossibile eliminare offline.'); return; }
  setModalBusy('mmodmDel', true, 'Elimino il PDF da Drive…');
  var p = m.drive_file_id ? driveDelete(m.drive_file_id).catch(function(){}) : Promise.resolve();
  p.then(function(){
    setModalBusy('mmodmDel', true, 'Aggiorno gli allegati…');
    // Per sicurezza cerco la riga anche dal file su Drive: se il collegamento
    // diretto mancasse, l'allegato resterebbe orfano nell'elenco.
    var filtri=[];
    if(m.allegato_id) filtri.push('id.eq.'+m.allegato_id);
    if(m.drive_file_id) filtri.push('drive_file_id.eq.'+encodeURIComponent(m.drive_file_id));
    if(!filtri.length) return null;
    return sbFetch('allegati?or=('+filtri.join(',')+')',{method:'DELETE'}).catch(function(){});
  }).then(function(){
    return sbFetch('moduli_m?chiamata_id=eq.'+callId,{method:'DELETE'});
  }).then(function(){
    setModalBusy('mmodmDel', false);
    chiudi('mmodmDel');
    modmToDelete=null;
    fb(true,'Modulo M eliminato','Rimosso dalla chiamata e da Google Drive.');
    return caricaModuliM(getVisibleCallIds()).then(function(){
      return loadAttachmentsForCalls(getVisibleCallIds()).then(injectAttachRows);
    }).then(function(){ loadRows(PAGE); });
  }).catch(function(){
    setModalBusy('mmodmDel', false);
    fb(false,'Errore','Eliminazione non riuscita. Riprova.');
  });
}

// Aggiorna il pulsante M e il link "Visualizza modulo M" nelle righe già a video,
// senza ridisegnare la tabella (così non si perdono modifiche in corso).
function injectModmUi(){
  var tb=els.tbody||document.getElementById('tbody');
  if(!tb)return;
  tb.querySelectorAll('tr[data-row], tr.local-pending').forEach(function(tr){
    // Le chiamate non ancora inviate non hanno un numero: si usa l'impronta
    var id=tr.dataset.row || (tr.dataset.uuid ? 'local_'+tr.dataset.uuid : '');
    if(!id)return;
    var salvato=moduliMByCall[String(id)];
    var azioni=tr.querySelector('.sc');
    var btn=tr.querySelector('.iho-modm');
    var wrap=tr.querySelector('.modm-link-wrap');

    if(salvato){
      if(btn) btn.remove();                       // esiste il modulo: via il pulsante M
      // Se lo stato bozza/firmato e cambiato, il blocchetto va rifatto
      var stato=(salvato.firmato?'1':'0')+(salvato.inCoda?'c':'s');
      if(wrap && wrap.dataset.firmato !== stato){ wrap.remove(); wrap=null; }
      if(!wrap){
        var dt=tr.querySelector('.dt-wrap');
        if(dt){
          var w=document.createElement('div');
          w.className='modm-link-wrap';
          w.dataset.firmato = (salvato.firmato?'1':'0')+(salvato.inCoda?'c':'s');
          var firmato=!!salvato.firmato;
          var inCoda=!!salvato.inCoda;
          w.innerHTML='<span class="modm-link" data-row="'+id+'" title="'
            +(inCoda?'Salvato sul dispositivo: partira appena torna la linea'
                   :(firmato?'Apri il Modulo M firmato (sola lettura)':'Riprendi la compilazione del Modulo M'))+'">'
            +svgModuloM()+'Visualizza modulo M</span>'
            +(inCoda?'<span class="modm-attesa">da inviare</span>':(firmato?'':'<span class="modm-bozza">bozza</span>'))
            +'<span class="modm-del" data-row="'+id+'" title="Elimina il Modulo M">'
            +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
            +'</span>';
          dt.appendChild(w);
        }
      }
    } else {
      if(wrap) wrap.remove();                     // niente modulo: via il link
      if(!btn && azioni){
        var b=document.createElement('div');
        b.className='iho-modm';
        b.dataset.row=id;
        b.title='Compila il Modulo M (Relazione Medica)';
        b.innerHTML=svgModuloM();
        var att=azioni.querySelector('.iho-attach') || azioni.querySelector('.idel-local');
        if(att) azioni.insertBefore(b,att); else azioni.appendChild(b);
      }
    }
  });
}

function svgModuloM(){
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
    +'<rect x="3" y="2.5" width="18" height="19" rx="2.5"/>'
    +'<path d="M7.5 16.5V8.5l4.5 5 4.5-5v8" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>'
    +'</svg>';
}

// La lavagna della firma accetta indifferentemente dito, pennino o mouse
function modmFirmaWiring(){
  var cv=document.getElementById('modmFirmaCanvas');
  if(!cv || cv.dataset.pronta) return;
  cv.dataset.pronta='1';
  var tratto=null, rl=0, rt=0, rw=0, rh=0;
  cv.addEventListener('pointerdown', function(e){
    e.preventDefault();
    modmFirmaSync(false);       // telefono appena girato? prima ci si rimette in squadra
    var r=cv.getBoundingClientRect();
    if(!r.width || !r.height) return;
    rl=r.left; rt=r.top; rw=r.width; rh=r.height;
    modmFirmaInTratto=true;
    try{ cv.setPointerCapture(e.pointerId); }catch(_){}
    var x=e.clientX-rl, y=e.clientY-rt;
    tratto=[{x:x/rw, y:y/rh}];
    modmFirmaStrokes.push(tratto);
    modmFirmaTratti=true;
    var ctx=cv.getContext('2d');
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+0.1,y); ctx.stroke();
    var area=document.getElementById('modmFirmaArea');
    if(area) area.classList.add('ha-firma');
    var hint=document.getElementById('modmFirmaHint');
    if(hint) hint.style.visibility='hidden';
  });
  cv.addEventListener('pointermove', function(e){
    if(!modmFirmaInTratto || !tratto) return;
    e.preventDefault();
    var x=e.clientX-rl, y=e.clientY-rt;
    tratto.push({x:x/rw, y:y/rh});
    var ctx=cv.getContext('2d');
    ctx.lineTo(x,y); ctx.stroke();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    cv.addEventListener(ev, function(){
      if(!modmFirmaInTratto) return;
      modmFirmaInTratto=false; tratto=null;
      modmFirmaSync(false);     // se durante il tratto e cambiato qualcosa, riallinea ora
    });
  });

  // Girando il telefono, o quando la lavagna passa da nascosta a visibile,
  // le misure cambiano: me ne accorgo guardando l'elemento, non aspettando eventi.
  var area=document.getElementById('modmFirmaArea');
  if(area && window.ResizeObserver){
    var attesa=null;
    new ResizeObserver(function(){
      clearTimeout(attesa);
      attesa=setTimeout(modmFirmaAdatta, 80);
    }).observe(area);
  }
}

// ── Collegamenti dei comandi ──
function setupModmWiring(){
  var cl=document.getElementById('btnModmClose');
  if(cl) cl.addEventListener('click', function(){ modmChiudi(false); });
  var sv=document.getElementById('btnModmSave');
  if(sv) sv.addEventListener('click', function(){ modmChiediSalva(false); });

  var sno=document.getElementById('btnModmSalvaNo');
  if(sno) sno.addEventListener('click', function(){ chiudi('mmodmSalva'); });
  var ssi=document.getElementById('btnModmSalvaSi');
  if(ssi) ssi.addEventListener('click', function(){ chiudi('mmodmSalva'); modmSalva(modmSalvaPoiChiudi); });

  // ── Sezioni: dal foglio in sola lettura al dettaglio dove si compila ──
  var foglio=document.getElementById('modmFoglio');
  if(foglio) foglio.addEventListener('click', function(e){
    if(!foglio.classList.contains('mm-sola-lettura')) return;
    if(foglio.classList.contains('mm-congelato')) return;
    var sez=e.target.closest('[data-sez]');
    if(sez) modmApriSezione(sez);
  });
  var back=document.getElementById('btnModmSezBack');
  if(back) back.addEventListener('click', modmChiudiSezione);

  // ── Firma ──
  var bfi=document.getElementById('btnModmFirma');
  if(bfi) bfi.addEventListener('click', modmFirmaApri);
  var fpul=document.getElementById('btnModmFirmaPulisci');
  if(fpul) fpul.addEventListener('click', modmFirmaPulisci);
  var fback=document.getElementById('btnModmFirmaBack');
  if(fback) fback.addEventListener('click', modmFirmaConferma);
  var fwno=document.getElementById('btnModmFirmaWarnNo');
  if(fwno) fwno.addEventListener('click', function(){ chiudi('mmodmFirmaWarn'); });
  var fwsi=document.getElementById('btnModmFirmaWarnSi');
  if(fwsi) fwsi.addEventListener('click', function(){
    chiudi('mmodmFirmaWarn');
    modmFirma=''; modmMostraFirma(); modmAggiornaStato();
    modmFirmaAvvia();
  });
  modmFirmaWiring();

  // ── Limite di scrittura: il testo non puo uscire dallo spazio della carta ──
  document.addEventListener('input', function(e){
    var el=e.target;
    if(!el || !el.closest) return;
    if(!el.closest('#modmFoglio, #modmSezCorpo')) return;
    modmGuardiaInput(el);
  }, true);

  // Il foglio deve restare interamente a schermo anche cambiando finestra o rotazione
  var ridisegna=function(){
    if(!document.getElementById('mmodm').classList.contains('open')) return;
    modmAdattaScala();
  };
  window.addEventListener('resize', function(){ ridisegna(); modmFirmaAdatta(); });
  window.addEventListener('orientationchange', function(){
    setTimeout(function(){ ridisegna(); modmFirmaAdatta(); }, 250);
    setTimeout(modmFirmaAdatta, 650);        // alcuni telefoni assestano le misure con calma
  });

  var stay=document.getElementById('btnModmExitStay');
  if(stay) stay.addEventListener('click', function(){ chiudi('mmodmExit'); });
  var disc=document.getElementById('btnModmExitDiscard');
  if(disc) disc.addEventListener('click', function(){ chiudi('mmodmExit'); modmChiudi(true); });
  var svx=document.getElementById('btnModmExitSave');
  if(svx) svx.addEventListener('click', function(){ chiudi('mmodmExit'); modmSalva(true); });

  // ── Documenti abbandonati su Drive ──
  var orfaniTrovati=[];
  var bCerca=document.getElementById('btnOrfaniCerca');
  var bElim=document.getElementById('btnOrfaniElimina');
  var esito=document.getElementById('orfaniEsito');
  var scriviEsito=function(html){ if(esito) esito.innerHTML=html; };

  if(bCerca) bCerca.addEventListener('click', function(){
    if(!isOnline()){ scriviEsito('<b>Serve la connessione</b> per controllare Google Drive.'); return; }
    bCerca.disabled=true; bCerca.innerHTML='<div class="spin"></div> Controllo\u2026';
    if(bElim) bElim.style.display='none';
    scriviEsito('');
    cercaFileOrfaniSicuro().then(function(esito){
      orfaniTrovati=(esito&&esito.orfani)||[];
      bCerca.disabled=false; bCerca.textContent='Cerca documenti abbandonati';
      if(esito && !esito.affidabile){
        orfaniTrovati=[];
        scriviEsito('<b>Controllo non attendibile.</b> L\u2019elenco dal server non \u00e8 arrivato per intero: '
          +'per prudenza non viene indicato nulla. Riprova fra poco.');
        return;
      }
      if(!orfaniTrovati.length){
        scriviEsito('<b>Tutto in ordine:</b> nessun documento abbandonato. Ogni file su Drive appartiene a una chiamata.');
        return;
      }
      var righe=orfaniTrovati.map(function(f){
        var quando='';
        try{
          var d=new Date(f.createdTime), pd=function(x){return String(x).padStart(2,'0');};
          quando=pd(d.getDate())+'/'+pd(d.getMonth()+1)+'/'+d.getFullYear();
        }catch(_){}
        return '<div class="orfani-riga"><span class="orfani-nome">'+esc(f.name||'senza nome')+'</span>'
             +'<span class="orfani-data">'+esc(quando)+'</span></div>';
      }).join('');
      scriviEsito('<b>'+orfaniTrovati.length+' document'+(orfaniTrovati.length===1?'o abbandonato':'i abbandonati')+'</b>'
        +' su '+esito.suDrive+' presenti nella cartella ('+esito.registrati+' risultano collegati a una chiamata):'
        +'<div class="orfani-elenco">'+righe+'</div>');
      if(bElim) bElim.style.display='';
    }).catch(function(e){
      bCerca.disabled=false; bCerca.textContent='Cerca documenti abbandonati';
      var m=String((e&&e.message)||'');
      scriviEsito('<b>Controllo non riuscito.</b> '+(m.indexOf('token')!==-1||m.indexOf('popup')!==-1
        ? 'Autorizza prima Google Drive (l\u2019avviso blu in alto).' : 'Riprova fra poco.'));
    });
  });

  if(bElim) bElim.addEventListener('click', function(){
    if(!orfaniTrovati.length) return;
    if(!window.confirm('Spostare nel cestino di Google Drive '+orfaniTrovati.length+' document'
      +(orfaniTrovati.length===1?'o':'i')+'?\n\nSono file che non appartengono pi\u00f9 ad alcuna chiamata. '
      +'Restano recuperabili dal cestino di Drive per 30 giorni.')) return;
    bElim.disabled=true; bElim.innerHTML='<div class="spin"></div> Elimino\u2026';
    cestinaListaDaDrive(orfaniTrovati.map(function(f){ return f.id; })).then(function(fatti){
      bElim.disabled=false; bElim.textContent='Elimina definitivamente';
      bElim.style.display='none';
      var restano=orfaniTrovati.length-fatti;
      orfaniTrovati=[];
      scriviEsito('<b>'+fatti+' document'+(fatti===1?'o spostato':'i spostati')+' nel cestino di Google Drive.</b>'
        +' Recuperabil'+(fatti===1?'e':'i')+' da l\u00ec per 30 giorni.'
        +(restano>0?(' '+restano+' non '+(restano===1?'\u00e8 stato rimosso':'sono stati rimossi')+': riprova.'):''));
    }).catch(function(){
      bElim.disabled=false; bElim.textContent='Elimina definitivamente';
      scriviEsito('<b>Eliminazione non riuscita.</b> Riprova fra poco.');
    });
  });

  var dc=document.getElementById('btnModmDelCancel');
  if(dc) dc.addEventListener('click', function(){ chiudi('mmodmDel'); modmToDelete=null; });
  var dk=document.getElementById('btnModmDelConfirm');
  if(dk) dk.addEventListener('click', modmElimina);

  // Legenda: scelta del segno da apporre
  var leg=document.getElementById('modmLegenda');
  if(leg) leg.addEventListener('click', function(e){
    var b=e.target.closest('.mm-lg'); if(!b)return;
    var s=b.dataset.segno;
    var giaAttivo=b.classList.contains('att');
    leg.querySelectorAll('.mm-lg').forEach(function(x){ x.classList.remove('att'); });
    if(giaAttivo){ modmSegnoAttivo=null; return; }
    b.classList.add('att');
    modmSegnoAttivo=s;
  });

  // Figura: apporre o rimuovere un segno
  var fig=document.getElementById('modmFig');
  if(fig) fig.addEventListener('click', function(e){
    var esistente=e.target.closest('.mm-segno');
    if(esistente){
      modmSegni.splice(parseInt(esistente.dataset.i,10),1);
      modmDisegnaSegni();
      return;
    }
    if(!modmSegnoAttivo || modmSegnoAttivo==='cancella') return;
    var r=fig.getBoundingClientRect();
    modmSegni.push({
      t: modmSegnoAttivo,
      x: +(((e.clientX-r.left)/r.width)*100).toFixed(2),
      y: +(((e.clientY-r.top)/r.height)*100).toFixed(2)
    });
    modmDisegnaSegni();
  });
}
