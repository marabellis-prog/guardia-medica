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

document.addEventListener('DOMContentLoaded',function(){

  initEls();
  setupTableDelegation();
  loadPost();

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

  // Ricerca live con debounce 350ms (solo srchQuery)
  var searchDebounceTimer=null;
  var sq=document.getElementById('srchQuery');
  if(sq){
    sq.addEventListener('input',function(){
      if(searchDebounceTimer)clearTimeout(searchDebounceTimer);
      var v=this.value.trim();
      if(v.length===0||v.length>=2){
        searchDebounceTimer=setTimeout(function(){doSearch();},350);
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

  document.addEventListener('click',function(e){
    document.querySelectorAll('.post-dropdown.open').forEach(function(dd){
      if(!dd.parentElement.contains(e.target)){
        dd.classList.remove('open');
        var tr=dd.closest('tr');if(tr)tr.classList.remove('has-open-dd');
      }
    });
    if(!warnOpen&&getDirtyCount()>0){
      var tgt=e.target;
      if(tgt&&tgt.nodeType===3)tgt=tgt.parentElement;
      if(!tgt||!tgt.closest)return;
      var twrap=document.querySelector('.twrap');
      var inTable=twrap&&twrap.contains(tgt);
      var inModal=tgt.closest('.mbox');
      var inForm=tgt.closest('.fc');
      var inSrch=tgt.closest('.srch-panel');
      var inDel=tgt.closest('.idel');
      if(!inTable&&!inModal&&!inForm&&!inSrch&&!inDel){
        triggerDirtyWarning();
      }
    }
  });
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

function doSearch(){
  var query=document.getElementById('srchQuery').value.trim();
  var dateFrom=document.getElementById('srchDateFrom').value;
  var dateTo=document.getElementById('srchDateTo').value;
  var post=document.getElementById('srchPost').value;
  if(!query&&!dateFrom&&!dateTo&&!post){fb(false,'Attenzione','Inserisci almeno un criterio di ricerca.');return;}
  var btn=document.getElementById('btnDoSearch');
  btn.disabled=true;btn.innerHTML='<div class="spin"></div> Ricerca…';
  currentFilters={query:query,dateFrom:dateFrom,dateTo:dateTo,postazione:post};
  searchChiamate(currentFilters).then(function(r){
    btn.disabled=false;btn.innerHTML=svgSearch()+' Cerca';
    document.getElementById('srchPanel').classList.remove('open');
    document.getElementById('btnSearch').classList.remove('act');
    drawRows(r.records,query);
    var inf=r.total+' risultat'+(r.total===1?'o':'i');
    document.getElementById('linfo').innerHTML=inf+' &nbsp;<span class="srch-active">Filtro attivo<svg onclick="clearSearch()" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>';
    document.getElementById('pgn').innerHTML='';
  }).catch(function(err){
    if(err&&err.name==='AbortError')return; // richiesta superata
    btn.disabled=false;btn.innerHTML=svgSearch()+' Cerca';
    fb(false,'Errore','Server non raggiungibile.');
  });
}

var searchAbortController=null;

function searchChiamate(filters){
  // Annulla la richiesta di ricerca precedente se ancora in corso
  if(searchAbortController)searchAbortController.abort();
  searchAbortController=new AbortController();
  var sig=searchAbortController.signal;

  var params='chiamate?select=*';
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
  var params='chiamate?select=*';
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
    var descHtml=highlightQuery?highlight(r.descrizione||'',highlightQuery):esc(r.descrizione||'');
    var noteHtml=highlightQuery?highlight(r.note||'',highlightQuery):esc(r.note||'');
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
// EVENT DELEGATION sul <tbody>: 1 listener per tipo, valido per
// qualsiasi riga (presente o futura). Sostituisce le 6 forEach
// che giravano in drawRows ad ogni redraw.
// ───────────────────────────────────────────────────────────
function setupTableDelegation(){
  var tbody=document.getElementById('tbody');
  if(!tbody||tbody._delegated)return;
  tbody._delegated=true;

  tbody.addEventListener('click',function(e){
    var t=e.target;
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

  // FOCUSIN su date/time → seleziona tutto
  tbody.addEventListener('focusin',function(e){
    var el=e.target;
    if(!el.classList)return;
    if(el.classList.contains('dt-date')||el.classList.contains('dt-time')){
      var range=document.createRange();range.selectNodeContents(el);
      var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
    }
  });

  // FOCUSOUT su date/time → autoformatta + valida
  tbody.addEventListener('focusout',function(e){
    var el=e.target;
    if(!el.classList)return;
    var isDate=el.classList.contains('dt-date');
    var isTime=el.classList.contains('dt-time');
    if(!isDate&&!isTime)return;
    var raw=(el.innerText||'').trim();if(!raw)return;
    var fmt=isDate?autoformatDate(raw):autoformatTime(raw);
    if(fmt){el.innerText=fmt;setFieldError(el,false);}
    else{setFieldError(el,isDate?!isValidDate(raw):!isValidTime(raw));}
    var tr=el.closest('tr');if(tr)markDirty(tr);
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
  sbFetch('chiamate?id=eq.'+ri,{method:'PATCH',body:body,prefer:'return=minimal'}).then(function(res){
    if(floppyEl){floppyEl.classList.remove('saving');floppyEl.innerHTML=svgFloppy();}
    if(res.ok){
      delete dirtyMap[String(ri)];
      tr.dataset.originalTs=tsNow;
      if(floppyEl)floppyEl.style.display='none';
      if(po)localStorage.setItem('lastPostazione',po);
      fb(true,'Salvata','Chiamata aggiornata.');
    } else {
      fb(false,'Errore','Salvataggio fallito.');
    }
    if(onDone)onDone(res.ok,false);
  }).catch(function(){
    if(floppyEl){floppyEl.classList.remove('saving');floppyEl.innerHTML=svgFloppy();}
    fb(false,'Errore','Server non raggiungibile.');
    if(onDone)onDone(false,false);
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
  msgEl.textContent='Stai per eliminare definitivamente questa chiamata:\n\n"'+(desc||'—')+'"';
  apri('mdel');
}

function confDelete(){
  chiudi('mdel');if(!DROW)return;
  var ri=DROW;DROW=null;
  var iconEl=DELEL;DELEL=null;
  if(iconEl){
    iconEl.style.pointerEvents='none';
    iconEl.innerHTML='<div class="spin" style="width:13px;height:13px;border-width:2px;border-color:rgba(255,80,80,.25);border-top-color:var(--er,#c0392b);flex-shrink:0"></div>';
  }
  sbFetch('chiamate?id=eq.'+ri,{method:'DELETE'}).then(function(res){
    if(res.ok){
      fb(true,'Eliminata','Record rimosso.');
      loadRows(PAGE);
    } else {
      if(iconEl){iconEl.style.pointerEvents='';iconEl.innerHTML=svgTrash();}
      fb(false,'Errore','Eliminazione fallita.');
    }
  }).catch(function(){
    if(iconEl){iconEl.style.pointerEvents='';iconEl.innerHTML=svgTrash();}
    fb(false,'Errore','Server non raggiungibile.');
  });
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

  // STEP 1 — verifica postazioni eliminate non in uso (parallelo)
  return Promise.all(trulyDeleted.map(function(nome){
    return sbFetch('chiamate?postazione=eq.'+encodeURIComponent(nome)+'&select=id&limit=1')
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
