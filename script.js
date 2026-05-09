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

function sbFetch(path,opts){
  opts=opts||{};
  var headers={
    'apikey':SUPABASE_ANON_KEY,
    'Authorization':'Bearer '+SUPABASE_ANON_KEY,
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
// AUTO-REFRESH: real-time multi-device sync
// - Visibility change: ricarica all'attivazione del tab
// - Polling 30s: rileva max(updated_at); se cambiato → banner
// - Banner non intrusivo se ci sono modifiche dirty/modal aperto
// ───────────────────────────────────────────────────────────
var REFRESH_POLL_MS=30000;
var lastKnownUpdate=0;
var refreshPollTimer=null;

function fetchLatestUpdate(){
  return fetch(SUPABASE_URL+'/rest/v1/chiamate?select=updated_at&order=updated_at.desc&limit=1',{
    headers:{
      'apikey':SUPABASE_ANON_KEY,
      'Authorization':'Bearer '+SUPABASE_ANON_KEY
    }
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

function setupAutoRefresh(){
  // Init: registra il punto di partenza
  fetchLatestUpdate().then(function(ts){lastKnownUpdate=ts;});

  // Polling
  if(refreshPollTimer)clearInterval(refreshPollTimer);
  refreshPollTimer=setInterval(checkForRemoteChanges,REFRESH_POLL_MS);

  // Tab focus → ricarica subito (caso classico multi-device)
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    // Cancella eventuale banner precedente
    var ex=document.getElementById('refreshBanner');
    if(ex)ex.remove();
    // Se l'utente è impegnato, aspetta che finisca
    if(isUserBusy()){
      // Solo in caso di cambiamenti remoti mostra banner
      checkForRemoteChanges();
      return;
    }
    refreshAndUpdateMark();
  });
}

// ───────────────────────────────────────────────────────────
// SERVICE WORKER + SHORTCUT URL HANDLER
// ───────────────────────────────────────────────────────────
function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  // Differisce la registrazione: non bloccare il primo render
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./sw.js').then(function(reg){
      // Quando il SW viene aggiornato, mostra un piccolo banner
      if(reg.waiting){showUpdateAvailable(reg);return;}
      reg.addEventListener('updatefound',function(){
        var nw=reg.installing;
        if(!nw)return;
        nw.addEventListener('statechange',function(){
          if(nw.state==='installed'&&navigator.serviceWorker.controller){
            showUpdateAvailable(reg);
          }
        });
      });
    }).catch(function(){/* SW non critico, l'app funziona comunque */});
  });
}

function showUpdateAvailable(reg){
  if(document.getElementById('updateBanner'))return;
  var b=document.createElement('div');
  b.id='updateBanner';
  b.className='update-banner';
  b.innerHTML='<span>Nuova versione disponibile</span><button type="button">Aggiorna</button>';
  b.querySelector('button').addEventListener('click',function(){
    if(reg&&reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
    setTimeout(function(){window.location.reload();},150);
  });
  document.body.appendChild(b);
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
  var w=externalWindows[name];
  if(w&&!w.closed){
    try{w.focus();return;}catch(e){/* fallback: riapri */}
  }
  // window.open con name come identificatore: se già aperto altrove con lo stesso name
  // il browser lo riutilizza. Diversamente apre nuova finestra/tab.
  externalWindows[name]=window.open(url,name);
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
  setupTableDelegation();
  setupQuickLinks();
  registerServiceWorker();
  handleShortcutAction();
  loadPost();
  setupAutoRefresh();

  var btnAdd=document.getElementById('btnAdd');
  var btnSave=document.getElementById('btnSave');
  var selPost=document.getElementById('selPost');
  var btnNo=document.getElementById('btnNo');
  var btnSi=document.getElementById('btnSi');
  var btnRefresh=document.getElementById('btnRefresh');
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

  if(btnRefresh){
    btnRefresh.addEventListener('click',function(){
      currentFilters=null;
      resetSearchUI();
      loadRows(1);
    });
  }

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

  // Sort — con Supabase il sort è automatico, i pulsanti fanno refresh
  var btnSort=document.getElementById('btnSort');
  var btnSortLite=document.getElementById('btnSortLite');
  var btnSortFull=document.getElementById('btnSortFull');
  var btnSortCancel=document.getElementById('btnSortCancel');

  if(btnSort)btnSort.addEventListener('click',function(){apri('msort');});
  if(btnSortLite){
    btnSortLite.addEventListener('click',function(){
      chiudi('msort');
      showSortBadge(true,'Dati aggiornati.');
      loadRows(PAGE);
    });
  }
  if(btnSortFull){
    btnSortFull.addEventListener('click',function(){
      chiudi('msort');
      showSortBadge(true,'Dati aggiornati.');
      loadRows(1);
    });
  }
  if(btnSortCancel)btnSortCancel.addEventListener('click',function(){chiudi('msort');});

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
    if(el)attachPlainTextArea(el);
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
  });

  // Al boot: prova subito a smaltire la coda + mostra badge se necessario
  syncRenderBadge();
  syncProcess();

  // Auto-purge cestino > 30gg + aggiorna badge cestino
  autoPurgeOld();
  refreshTrashBadge();
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

  return fetch(SUPABASE_URL+'/rest/v1/'+params,{
    method:'GET',
    headers:{
      'apikey':SUPABASE_ANON_KEY,
      'Authorization':'Bearer '+SUPABASE_ANON_KEY,
      'Content-Type':'application/json',
      'Prefer':'count=exact'
    },
    signal:sig
  }).then(function(res){
    var cr=res.headers.get('content-range')||'';
    var total=parseInt((cr.split('/')[1]||'0'),10)||0;
    return res.json().then(function(data){return {data:data,total:total};});
  }).then(function(result){
    var records=result.data.map(function(r){
      return {id:r.id,rowIndex:r.id,tsFormatted:formatTSFromISO(r.timestamp_chiamata),postazione:r.postazione||'',descrizione:r.descrizione||'',note:r.note||'',completato:!!r.completato};
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

  saveAllDirtySilent(function(){
    var tsISO=italianToISO(fmtD+' '+fmtT)||new Date().toISOString();
    sbFetch('chiamate',{
      method:'POST',
      body:{timestamp_chiamata:tsISO,postazione:p||'',descrizione:d,note:n||'',completato:false},
      prefer:'return=minimal'
    }).then(function(res){
      btn.disabled=false;btn.innerHTML=svgSave()+' Salva';
      if(res.ok){
        document.getElementById('txd').value='';
        document.getElementById('txn').value='';
        var dtEl=document.getElementById('dtxt');
        dtEl.textContent='—';setFieldError(dtEl,false);
        if(p){buildSelPost(p);localStorage.setItem('lastPostazione',p);}
        currentFilters=null;resetSearchUI();
        fb(true,'Salvata','Chiamata salvata con successo.');
        loadRows(1);
      } else {
        fb(false,'Errore','Errore nel salvataggio.');
      }
    }).catch(function(){
      btn.disabled=false;btn.innerHTML=svgSave()+' Salva';
      fb(false,'Errore','Server non raggiungibile.');
    });
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

  fetch(SUPABASE_URL+'/rest/v1/'+params,{
    method:'GET',
    headers:{
      'apikey':SUPABASE_ANON_KEY,
      'Authorization':'Bearer '+SUPABASE_ANON_KEY,
      'Content-Type':'application/json',
      'Prefer':'count=exact'
    }
  }).then(function(res){
    var cr=res.headers.get('content-range')||'';
    var total=parseInt((cr.split('/')[1]||'0'),10)||0;
    return res.json().then(function(data){return {data:data,total:total};});
  }).then(function(result){
    hideLoader();
    var records=result.data.map(function(r){
      return {id:r.id,rowIndex:r.id,tsFormatted:formatTSFromISO(r.timestamp_chiamata),postazione:r.postazione||'',descrizione:r.descrizione||'',note:r.note||'',completato:!!r.completato};
    });
    drawRows(records,null);
    drawPgn(result.total,pg,CURRENT_PAGE_SIZE);
    var inf=result.total>0?result.total+' chiamat'+(result.total===1?'a':'e')+' in totale':'';
    if(showIncompleteOnly&&result.total>0)inf='⏳ '+result.total+' in attesa';
    (els.linfo||document.getElementById('linfo')).textContent=inf;
    // Marca le righe che hanno un sync in coda
    var pendingIds=syncLoadQueue().map(function(e){return String(e.id);});
    if(pendingIds.length){
      pendingIds.forEach(function(id){
        var tr=document.querySelector('tr[data-row="'+id+'"]');
        if(tr)tr.classList.add('pending-sync');
      });
    }
  }).catch(function(e){
    hideLoader();
    (els.tbody||document.getElementById('tbody')).innerHTML='<tr><td colspan="5"><div class="emp"><h3>Errore server</h3><p>'+(e&&e.message?e.message:'Controlla la connessione.')+'</p></div></td></tr>';
  });
}

function drawRows(recs,highlightQuery){
  var tb=els.tbody||document.getElementById('tbody');
  if(!recs||!recs.length){
    tb.innerHTML='<tr><td colspan="5"><div class="emp"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>'+(currentFilters?'Nessun risultato':'Nessuna chiamata')+'</h3><p>'+(currentFilters?'Prova a modificare i criteri di ricerca.':'Premi «+» per registrare la prima chiamata.')+'</p></div></td></tr>';
    return;
  }
  tb.innerHTML=recs.map(function(r){
    var tsf=r.tsFormatted||'';
    var parts=tsf.split(' ');
    var ds=parts[0]||'',ts=parts[1]||'';
    var pc=getColor(r.postazione);
    var ddOpts=POST.map(function(p){
      return '<div class="post-opt" data-nome="'+esc(p.nome)+'" data-colore="'+esc(p.colore||'#2e7d5e')+'">'
        +'<span class="post-dot" style="background:'+esc(p.colore||'#2e7d5e')+'"></span>'+esc(p.nome)+'</div>';
    }).join('');
    var descHtml=linkifyPhones(highlightQuery?highlight(r.descrizione||'',highlightQuery):esc(r.descrizione||''));
    var noteHtml=linkifyPhones(highlightQuery?highlight(r.note||'',highlightQuery):esc(r.note||''));
    var si=r.completato
      ?'<div class="ich"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>'
      :'<div class="iho" data-row="'+r.id+'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></div>';
    var cestino='<div class="idel" data-row="'+r.id+'" data-desc="'+esc((r.descrizione||'').substring(0,50))+'" title="Click per eliminare">'
      +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
      +'</div>';
    return '<tr class="'+(r.completato?'done':'pending')+'" data-row="'+r.id+'" data-original-ts="'+esc(tsf)+'">'
      +'<td class="tds"><div class="sc">'+si+'<div class="isv" data-row="'+r.id+'" style="display:none">'+svgFloppy()+'</div>'+cestino+'</div></td>'
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
      +'<td data-field="descrizione" contenteditable="true" spellcheck="false" style="white-space:pre-wrap;min-width:180px">'+descHtml+'</td>'
      +'<td data-field="note" contenteditable="true" spellcheck="false" style="white-space:pre-wrap">'+noteHtml+'</td>'
      +'</tr>';
  }).join('');

  // Listener attaccati una sola volta al boot via setupTableDelegation()
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
  try{localStorage.setItem(SYNC_QUEUE_KEY,JSON.stringify(q));}catch(e){}
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

function syncProcess(){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
  var q=syncLoadQueue();
  if(!q.length)return;
  // Processa in parallelo
  Promise.all(q.map(function(entry){
    entry.attempts=(entry.attempts||0)+1;
    return sbFetch('chiamate?id=eq.'+entry.id,{
      method:'PATCH',body:entry.body,prefer:'return=minimal'
    }).then(function(res){
      return res.ok?{ok:true,id:entry.id}:{ok:false,id:entry.id};
    }).catch(function(){return {ok:false,id:entry.id};});
  })).then(function(results){
    var failed=results.filter(function(r){return !r.ok;}).map(function(r){return String(r.id);});
    var newQ=syncLoadQueue().filter(function(e){return failed.indexOf(String(e.id))!==-1;});
    syncSaveQueue(newQ);
    syncRenderBadge();
    var ok=results.length-failed.length;
    if(ok>0&&failed.length===0)loadRows(PAGE); // refresh elenco se tutto sincronizzato
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
  existing.className='sync-badge'+(offline?' offline':'');
  existing.innerHTML=
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
      +(offline
        ?'<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'
        :'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>')
    +'</svg>'
    +'<span>'+(offline?'Offline · ':'')+q.length+' modific'+(q.length===1?'a':'he')+' in attesa</span>';
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
  var de=sanitizeText((tr.querySelector('[data-field="descrizione"]')||{innerText:''}).innerText.trim());
  var no=sanitizeText((tr.querySelector('[data-field="note"]')||{innerText:''}).innerText.trim());
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

  sbFetch('chiamate?id=eq.'+rowId,{method:'PATCH',body:body,prefer:'return=minimal'})
    .then(function(res){if(res.ok)onSuccess();else onFailure();})
    .catch(function(){onFailure();});
}

// Costruisce il body PATCH per una riga (riusato da beforeunload)
function buildPatchBodyFromRow(tr){
  if(!tr)return null;
  var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
  var de=sanitizeText((tr.querySelector('[data-field="descrizione"]')||{innerText:''}).innerText.trim());
  var no=sanitizeText((tr.querySelector('[data-field="note"]')||{innerText:''}).innerText.trim());
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

  // Mobile: previene il focus sul contenteditable padre quando si tocca un .ph-link
  // (altrimenti la tastiera si apre prima del modal)
  var phPreventFocus=function(e){
    if(e.target&&e.target.closest&&e.target.closest('.ph-link'))e.preventDefault();
  };
  tbody.addEventListener('pointerdown',phPreventFocus);
  tbody.addEventListener('mousedown',phPreventFocus);

  tbody.addEventListener('click',function(e){
    var t=e.target;
    var ph=t.closest('.ph-link');
    if(ph){
      e.stopPropagation();e.preventDefault();
      // Doppio scudo: blur subito qualunque cosa sia focalizzata
      if(document.activeElement&&typeof document.activeElement.blur==='function'){
        try{document.activeElement.blur();}catch(_e){}
      }
      openPhoneModal(ph.dataset.phone,ph);
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
      markDirty(trO);
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
  });

  // INPUT su [contenteditable] → markDirty
  tbody.addEventListener('input',function(e){
    if(!e.target.hasAttribute||!e.target.hasAttribute('contenteditable'))return;
    var tr=e.target.closest('tr');if(tr)markDirty(tr);
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
    var tr=el.closest('tr');if(tr)markDirty(tr);
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
    if(isDate||isTime){
      var raw=(el.innerText||'').trim();
      if(raw){
        var fmt=isDate?autoformatDate(raw):autoformatTime(raw);
        if(fmt){el.innerText=fmt;setFieldError(el,false);}
        else{setFieldError(el,isDate?!isValidDate(raw):!isValidTime(raw));}
        if(tr)markDirty(tr);
      }
    }
    // Pianifica autosave se la riga è dirty
    if(tr&&tr.dataset.row&&dirtyMap[tr.dataset.row])scheduleAutosave(tr);
  });
}

function markDirty(tr){
  var ri=tr.dataset.row;
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
  var de=sanitizeText((tr.querySelector('[data-field="descrizione"]')||{innerText:''}).innerText.trim());
  var no=sanitizeText((tr.querySelector('[data-field="note"]')||{innerText:''}).innerText.trim());
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
  var promises=keys.map(function(k){
    var info=dirtyMap[k],tr=info.tr,ri=info.rowIndex;
    var po=tr.querySelector('[data-field="postazione"]')?tr.querySelector('[data-field="postazione"]').dataset.nome||'':'';
    var de=sanitizeText((tr.querySelector('[data-field="descrizione"]')||{innerText:''}).innerText.trim());
    var no=sanitizeText((tr.querySelector('[data-field="note"]')||{innerText:''}).innerText.trim());
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
  var de=sanitizeText((tr.querySelector('[data-field="descrizione"]')||{innerText:''}).innerText.trim());
  var no=sanitizeText((tr.querySelector('[data-field="note"]')||{innerText:''}).innerText.trim());
  var tsNow=getFormattedTs(tr);
  if(!validateDateTimeFields(tr))return;
  var body={postazione:po,descrizione:de,note:no,completato:true};
  var tsISO=italianToISO(tsNow);if(tsISO)body.timestamp_chiamata=tsISO;
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
  return fetch(SUPABASE_URL+'/rest/v1/chiamate?deleted_at=not.is.null&select=id&limit=1',{
    headers:{
      'apikey':SUPABASE_ANON_KEY,
      'Authorization':'Bearer '+SUPABASE_ANON_KEY,
      'Prefer':'count=exact'
    }
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
  var h='<button class="bp"'+(pg===1?' disabled':'')+' onclick="loadRows('+(pg-1)+')">&#8249;</button>';
  for(var i=1;i<=pages;i++)h+='<button class="bp'+(i===pg?' act':'')+'" onclick="loadRows('+i+')">'+i+'</button>';
  h+='<button class="bp"'+(pg===pages?' disabled':'')+' onclick="loadRows('+(pg+1)+')">&#8250;</button>';
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
  if(e.target===document.getElementById('msort'))chiudi('msort');
  if(e.target===document.getElementById('mdel'))chiudi('mdel');
  if(e.target===document.getElementById('mpost'))chiudi('mpost');
  if(e.target===document.getElementById('mpostDel'))chiudi('mpostDel');
  if(e.target===document.getElementById('mphone')){closePhoneModal();}
  if(e.target===document.getElementById('mtrash'))chiudi('mtrash');
  if(e.target===document.getElementById('mtrashEmpty'))chiudi('mtrashEmpty');
  if(e.target===document.getElementById('mexport'))chiudi('mexport');
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

// ───────────────────────────────────────────────────────────
// CLICK-TO-CALL: trasforma numeri di telefono in link
// Riconosce mobile (3xx) e fissi (0xx), opz. con prefisso +39
// ───────────────────────────────────────────────────────────
function linkifyPhones(html){
  var re=/(\+?39[\s.\-]?)?(\d[\d\s.\-]{7,14}\d)/g;
  return html.replace(re,function(match){
    var digits=match.replace(/\D/g,'');
    if(digits.length<9||digits.length>12)return match;
    if(!/^(39)?[03]/.test(digits))return match;
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
    if(tr)markDirty(tr);
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
    var raw=cell.innerText||'';
    var newHtml=linkifyPhones(esc(raw));
    if(newHtml!==cell.innerHTML)cell.innerHTML=newHtml;
  });
}
