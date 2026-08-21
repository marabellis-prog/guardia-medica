// ═══════════════════════════════════════════════════════════════════
// BANCO DI PROVA — non fa parte dell'app, non viene caricato da index.html.
// Si carica a mano dalla console per mettere sotto torchio il giro
// «scrivo offline → torna la linea → tutto arriva al posto giusto».
//
// Sostituisce rete, database e Google Drive con dei sostituti governabili:
// si puo staccare la linea, far fallire Drive, far fallire il database,
// impedire la produzione del PDF, e verificare che non resti mai nulla
// di sospeso, orfano o scollegato.
// ═══════════════════════════════════════════════════════════════════
(function(){
'use strict';

var B = window.Banco = {};

// ── Stato del mondo finto ──────────────────────────────────────────
B.stato = null;

function nuovoStato(){
  return {
    linea: true,                 // c'e connessione?
    drive: {},                   // id -> {id, nome, dimensione, cestinato}
    driveSeq: 0,
    driveRompe: 0,               // quanti prossimi caricamenti devono fallire
    dbRompe: 0,                  // quante prossime scritture devono fallire
    pdfRompe: false,             // la produzione del documento fallisce
    pdfLento: false,             // ...oppure non risponde mai
    db: { chiamate: [], allegati: [], moduli: [] },
    idChiamata: 1000,
    idAllegato: 5000,
    chiamateAlServer: [],        // traccia delle scritture ricevute
    log: []
  };
}

function traccia(x){ B.stato.log.push(x); }

// ── Sostituti ──────────────────────────────────────────────────────
var vero = {};

function installa(){
  var S = B.stato;

  vero.fetch = window.fetch;
  vero.sbFetch = window.sbFetch;
  vero.isOnline = window.isOnline;
  vero.driveUpload = window.driveUpload;
  vero.driveDelete = window.driveDelete;
  vero.driveFetch = window.driveFetch;
  vero.ensureDriveFolder = window.ensureDriveFolder;
  vero.getDriveToken = window.getDriveToken;
  vero.driveConfigured = window.driveConfigured;
  vero.ensureFreshToken = window.ensureFreshToken;
  vero.fb = window.fb;
  vero.loadRows = window.loadRows;
  vero.hideLoader = window.hideLoader;
  vero.getVisibleCallIds = window.getVisibleCallIds;
  vero.modmGeneraPdf = window.modmGeneraPdf;

  window.isOnline = function(){ return S.linea; };
  window.driveConfigured = function(){ return true; };
  window.ensureFreshToken = function(){ return Promise.resolve(S.linea); };
  window.ensureDriveFolder = function(){ return S.linea ? Promise.resolve('cartella') : Promise.reject(new TypeError('offline')); };
  window.getDriveToken = function(){ return S.linea ? Promise.resolve('tok') : Promise.reject(new Error('no_token')); };
  window.fb = function(ok,t,m){ traccia('avviso: '+t); };
  window.hideLoader = function(){};
  window.loadRows = function(){ return Promise.resolve(); };
  window.getVisibleCallIds = function(){
    var o=[];
    document.querySelectorAll('#tbody tr[data-row]').forEach(function(t){ o.push(t.dataset.row); });
    document.querySelectorAll('#tbody tr.local-pending').forEach(function(t){ o.push('local_'+t.dataset.uuid); });
    return o;
  };

  // ── Google Drive finto ──
  window.driveUpload = function(file){
    if(!S.linea) return Promise.reject(new TypeError('offline'));
    if(S.driveRompe > 0){ S.driveRompe--; return Promise.reject(new Error('upload_500')); }
    S.driveSeq++;
    var id = 'drv' + S.driveSeq;
    S.drive[id] = { id:id, nome:file.name, dimensione:file.size||0, cestinato:false };
    traccia('drive+ ' + id + ' ' + file.name);
    return Promise.resolve({ id:id, name:file.name });
  };
  window.driveDelete = function(id){
    if(!S.linea) return Promise.reject(new TypeError('offline'));
    if(!S.drive[id]) return Promise.resolve(true);   // gia sparito: va bene
    delete S.drive[id];
    traccia('drive- ' + id);
    return Promise.resolve(true);
  };
  window.driveFetch = function(url, opt){
    if(!S.linea) return Promise.reject(new TypeError('offline'));
    var u = String(url);
    if(u.indexOf('drive/v3/files?q=') !== -1){
      var elenco = Object.keys(S.drive).filter(function(k){ return !S.drive[k].cestinato; }).map(function(k){
        return { id:k, name:S.drive[k].nome, createdTime:'2026-01-01T00:00:00Z', size:String(S.drive[k].dimensione) };
      });
      return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({ files:elenco }); } });
    }
    var m = u.match(/files\/([^?]+)/);
    if(m && opt && opt.method === 'PATCH'){
      if(S.drive[m[1]]) S.drive[m[1]].cestinato = true;
      traccia('drive~ ' + m[1] + ' (cestinato)');
      return Promise.resolve({ ok:true, status:200 });
    }
    return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({}); } });
  };

  // ── Database finto (PostgREST) ──
  window.sbFetch = function(path, opt){
    opt = opt || {};
    var met = (opt.method || 'GET').toUpperCase();
    if(!S.linea) return Promise.reject(new TypeError('offline'));
    if(met !== 'GET' && S.dbRompe > 0){ S.dbRompe--; return risposta({ message:'errore' }, 500); }
    return instrada(path, met, opt.body);
  };

  function risposta(corpo, stato){
    stato = stato || 200;
    return Promise.resolve({
      ok: stato < 400, status: stato,
      json: function(){ return Promise.resolve(corpo); },
      headers: { get: function(h){ return h.toLowerCase()==='content-range' ? ('0-0/'+S.db.chiamate.length) : null; } }
    });
  }

  function instrada(path, met, body){
    var S = B.stato;

    // ── chiamate ──
    if(path.indexOf('chiamate') === 0){
      if(met === 'POST'){
        var gia = S.db.chiamate.filter(function(c){ return c.client_uuid === body.client_uuid; })[0];
        if(gia) return risposta([], 409);
        var r = {}; for(var k in body) r[k] = body[k];
        r.id = S.idChiamata++; r.deleted_at = null;
        S.db.chiamate.push(r);
        S.chiamateAlServer.push(r.id);
        traccia('db+ chiamata ' + r.id);
        return risposta([{ id:r.id }], 201);
      }
      if(met === 'PATCH'){
        var mi = path.match(/id=eq\.(\d+)/);
        if(mi) S.db.chiamate.forEach(function(c){ if(String(c.id)===mi[1]) for(var k in body) c[k]=body[k]; });
        return risposta([], 204);
      }
      if(met === 'DELETE'){
        if(path.indexOf('deleted_at=not.is.null') !== -1){
          var via = S.db.chiamate.filter(function(c){ return c.deleted_at; }).map(function(c){ return c.id; });
          S.db.chiamate = S.db.chiamate.filter(function(c){ return !c.deleted_at; });
          // a cascata, come nel database vero
          S.db.allegati = S.db.allegati.filter(function(a){ return via.indexOf(a.chiamata_id) === -1; });
          S.db.moduli = S.db.moduli.filter(function(m){ return via.indexOf(m.chiamata_id) === -1; });
          traccia('db- cestino svuotato (' + via.length + ')');
          return risposta([], 204);
        }
        var md = path.match(/id=eq\.(\d+)/);
        if(md){
          var idv = parseInt(md[1], 10);
          S.db.chiamate = S.db.chiamate.filter(function(c){ return c.id !== idv; });
          S.db.allegati = S.db.allegati.filter(function(a){ return a.chiamata_id !== idv; });
          S.db.moduli = S.db.moduli.filter(function(m){ return m.chiamata_id !== idv; });
        }
        return risposta([], 204);
      }
      // GET
      var mu = path.match(/client_uuid=eq\.([^&]+)/);
      if(mu){
        var u = decodeURIComponent(mu[1]);
        var t = S.db.chiamate.filter(function(c){ return c.client_uuid === u; })[0];
        return risposta(t ? [{ id:t.id }] : []);
      }
      if(path.indexOf('deleted_at=not.is.null') !== -1)
        return risposta(S.db.chiamate.filter(function(c){ return c.deleted_at; }).map(function(c){ return { id:c.id }; }));
      return risposta(S.db.chiamate.filter(function(c){ return !c.deleted_at; }));
    }

    // ── allegati ──
    if(path.indexOf('allegati') === 0){
      if(met === 'POST'){
        var a = {}; for(var k2 in body) a[k2] = body[k2];
        a.id = S.idAllegato++;
        S.db.allegati.push(a);
        traccia('db+ allegato ' + a.id + ' -> ' + a.drive_file_id);
        return risposta([{ id:a.id }], 201);
      }
      if(met === 'DELETE'){
        var ma = path.match(/id=eq\.(\d+)/);
        if(ma) S.db.allegati = S.db.allegati.filter(function(x){ return String(x.id) !== ma[1]; });
        var mo = path.match(/or=\(([^)]*)\)/);
        if(mo) mo[1].split(',').forEach(function(f){
          var p1 = f.match(/^id\.eq\.(\d+)$/);
          if(p1) S.db.allegati = S.db.allegati.filter(function(x){ return String(x.id) !== p1[1]; });
          var p2 = f.match(/^drive_file_id\.eq\.(.+)$/);
          if(p2){ var d = decodeURIComponent(p2[1]); S.db.allegati = S.db.allegati.filter(function(x){ return x.drive_file_id !== d; }); }
        });
        return risposta([], 204);
      }
      var mi2 = path.match(/chiamata_id=in\.\(([^)]*)\)/);
      if(mi2){
        var ids = mi2[1].split(',');
        return risposta(S.db.allegati.filter(function(x){ return ids.indexOf(String(x.chiamata_id)) !== -1; }));
      }
      return risposta(S.db.allegati.slice());
    }

    // ── moduli_m ──
    if(path.indexOf('moduli_m') === 0){
      if(met === 'POST'){
        var m1 = {}; for(var k3 in body) m1[k3] = body[k3];
        S.db.moduli.push(m1);
        traccia('db+ modulo ' + m1.chiamata_id + (m1.drive_file_id ? (' -> ' + m1.drive_file_id) : ' (senza documento)'));
        return risposta([], 201);
      }
      if(met === 'PATCH'){
        var mc = path.match(/chiamata_id=eq\.([^&]+)/);
        if(mc){
          var cid = decodeURIComponent(mc[1]);
          S.db.moduli.forEach(function(m){ if(String(m.chiamata_id) === cid) for(var k4 in body) m[k4] = body[k4]; });
        }
        return risposta([], 204);
      }
      if(met === 'DELETE'){
        var mdd = path.match(/chiamata_id=eq\.([^&]+)/);
        if(mdd){ var c2 = decodeURIComponent(mdd[1]); S.db.moduli = S.db.moduli.filter(function(m){ return String(m.chiamata_id) !== c2; }); }
        var mo2 = path.match(/or=\(([^)]*)\)/);
        if(mo2) mo2[1].split(',').forEach(function(f){
          var q1 = f.match(/^allegato_id\.eq\.(\d+)$/);
          if(q1) S.db.moduli = S.db.moduli.filter(function(x){ return String(x.allegato_id) !== q1[1]; });
          var q2 = f.match(/^drive_file_id\.eq\.(.+)$/);
          if(q2){ var d2 = decodeURIComponent(q2[1]); S.db.moduli = S.db.moduli.filter(function(x){ return x.drive_file_id !== d2; }); }
        });
        return risposta([], 204);
      }
      var mi3 = path.match(/chiamata_id=in\.\(([^)]*)\)/);
      if(mi3){
        var ids3 = mi3[1].split(',');
        return risposta(S.db.moduli.filter(function(x){ return ids3.indexOf(String(x.chiamata_id)) !== -1; }));
      }
      return risposta(S.db.moduli.slice());
    }

    if(path.indexOf('postazioni') === 0) return risposta([{ id:1, nome:'PALOMBARA', comuni:'Palombara Sabina', colore:'#2e7d5e' }]);
    if(path.indexOf('girate') === 0) return risposta([]);
    return risposta([]);
  }

  // fetch grezzo (usato da loadRows)
  window.fetch = function(url, opt){
    var u = String(url);
    if(u.indexOf('/rest/v1/') !== -1){
      if(!S.linea) return Promise.reject(new TypeError('offline'));
      var path = u.split('/rest/v1/')[1];
      return instrada(path, (opt && opt.method || 'GET').toUpperCase(), null);
    }
    if(u.indexOf('rete=') !== -1) return Promise.resolve({ ok:S.linea, status:S.linea?200:0 });
    if(u.indexOf('/functions/v1/') !== -1)
      return Promise.resolve({ status:404, json:function(){ return Promise.resolve({ errore:'non_autorizzata' }); } });
    return vero.fetch.apply(window, arguments);
  };

  // produzione del documento
  window.modmGeneraPdf = function(){
    if(S.pdfLento) return new Promise(function(){});
    if(S.pdfRompe) return Promise.reject(new Error('pdf_rotto'));
    return Promise.resolve(new Blob([new Uint8Array(120000)], { type:'application/pdf' }));
  };
}

function disinstalla(){
  Object.keys(vero).forEach(function(k){ if(vero[k] !== undefined) window[k] = vero[k]; });
}

// ── Comandi ────────────────────────────────────────────────────────
B.avvia = function(){
  B.stato = nuovoStato();
  installa();
  var ov = document.getElementById('authOverlay'); if(ov) ov.style.display = 'none';
  var pl = document.getElementById('page-loader'); if(pl) pl.remove();
  document.body.classList.remove('auth-pending');
  window.currentUser = { id:'u1', full_name:'Stefano Marabelli', role:'admin' };
  window.currentJwt = 'jwt-collaudo';
  window.CURRENT_PAGE_SIZE = 15;
  window.currentFilters = null;
  window.showIncompleteOnly = false;
  window.pendingGirate = { incoming:[], outgoing:[] };
  window.markOwnWrite = function(){};
  if(typeof applyPostazioniData === 'function')
    applyPostazioniData([{ id:1, nome:'PALOMBARA', comuni:'Palombara Sabina', colore:'#2e7d5e' }]);
  return B.pulisciTutto();
};

B.pulisciTutto = function(){
  ['syncQueue_v1','newCallDraft_v1','chiamateCache_v1','gm_profilo_v1','postCache_v1',
   'driveTok_v1','ultimaPuliziaDrive_v1','lastTrashPurge_v1'].forEach(function(k){ localStorage.removeItem(k); });
  window.moduliMByCall = {}; window.moduliMLocali = {}; window.allegatiLocali = {}; window.attachmentsByCall = {};
  window.dirtyMap = {};
  var tb = document.getElementById('tbody'); if(tb) tb.innerHTML = '';
  return Promise.all([modmCodaLeggi(), allegCodaLeggi()]).then(function(r){
    return Promise.all(
      r[0].map(function(x){ return modmCodaCancella(x.chiamata_id); })
        .concat(r[1].map(function(x){ return allegCodaCancella(x.id); }))
    );
  }).then(function(){
    return Promise.all([modmCaricaCodaInMappa(), allegCaricaCodaInMappa()]);
  }).then(function(){ try{ syncRenderBadge(); }catch(_){} });
};

B.chiudi = function(){ disinstalla(); };
B.offline = function(){ B.stato.linea = false; try{ window.dispatchEvent(new Event('offline')); }catch(_){} };
B.online  = function(){ B.stato.linea = true;  try{ window.dispatchEvent(new Event('online')); }catch(_){} };

B.attesa = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

// Aspetta che non ci sia piu nulla in sospeso (o scade il tempo)
B.attendiQuiete = function(maxMs){
  maxMs = maxMs || 20000;
  var t0 = Date.now();
  return new Promise(function(risolvi){
    var giro = function(){
      var pendente = false;
      try{ pendente = cosePendenti(); }catch(_){}
      if(!pendente || Date.now() - t0 > maxMs){ risolvi(Date.now() - t0); return; }
      drenaTuttoSubito();
      setTimeout(giro, 400);
    };
    giro();
  });
};

// ── Azioni «come farebbe il medico» ────────────────────────────────
B.scriviChiamata = function(testo, note){
  var dtx = document.getElementById('dtxt');
  var d = new Date(), p = function(x){ return String(x).padStart(2,'0'); };
  if(dtx) dtx.innerText = p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
  var txd = document.getElementById('txd'); if(txd) txd.value = testo || 'PAZIENTE PROVA 50\nvia Test 1\n3331112223\nsintomo';
  var txn = document.getElementById('txn'); if(txn) txn.value = note || '';
  var sp = document.getElementById('selPost'); if(sp) sp.value = 'PALOMBARA';
  salva();
  return B.attesa(700);
};

B.rigaUltima = function(){
  return document.querySelector('#tbody tr.local-pending') || document.querySelector('#tbody tr[data-row]');
};
B.idUltima = function(){
  var tr = B.rigaUltima();
  if(!tr) return null;
  return tr.dataset.row || (tr.dataset.uuid ? 'local_'+tr.dataset.uuid : null);
};

B.allega = function(callId, nomi){
  nomi = nomi || ['foto.jpg'];
  var dt = new DataTransfer();
  nomi.forEach(function(n){
    var tipo = /\.pdf$/i.test(n) ? 'application/pdf' : (/\.png$/i.test(n) ? 'image/png' : 'image/jpeg');
    dt.items.add(new File([new Uint8Array(20000)], n, { type:tipo }));
  });
  window.attachModalCallId = callId;
  var inp = document.getElementById('attachFileInput');
  if(inp) inp.files = dt.files;
  return Promise.resolve(doAttachUpload()).then(function(){ return B.attesa(600); });
};

B.compilaModulo = function(callId, conFirma, valori){
  modmApri(callId);
  return B.attesa(500).then(function(){
    valori = valori || { cv_polso:'72' };
    Object.keys(valori).forEach(function(k){
      var el = document.querySelector('#modmFoglio [data-f="'+k+'"]') || document.querySelector('#modmSezCorpo [data-f="'+k+'"]');
      if(el){ if(el.type==='checkbox') el.checked = !!valori[k]; else el.value = valori[k]; }
    });
    if(conFirma){
      // scarabocchio: tratti relativi, come li produrrebbe un dito
      modmFirmaStrokes = [
        [{x:0.05,y:0.7},{x:0.2,y:0.3},{x:0.35,y:0.75},{x:0.5,y:0.25},{x:0.7,y:0.7},{x:0.9,y:0.4}],
        [{x:0.3,y:0.85},{x:0.75,y:0.85}]
      ];
      modmFirmaTratti = true;
      modmFirma = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      modmMostraFirma(); modmAggiornaStato();
    }
    return modmSalva(true);
  }).then(function(){ return B.attesa(900); });
};

// ── Verifica delle regole che non devono MAI essere violate ────────
B.invarianti = function(){
  var S = B.stato, guai = [];
  // 1. Ogni file su Drive deve appartenere a qualcosa
  Object.keys(S.drive).forEach(function(id){
    if(S.drive[id].cestinato) return;
    var usatoA = S.db.allegati.some(function(a){ return a.drive_file_id === id; });
    var usatoM = S.db.moduli.some(function(m){ return m.drive_file_id === id; });
    if(!usatoA && !usatoM) guai.push('file su Drive senza padrone: ' + S.drive[id].nome + ' (' + id + ')');
  });
  // 2. Ogni riferimento nel database deve puntare a un file esistente
  S.db.allegati.forEach(function(a){
    if(a.drive_file_id && !S.drive[a.drive_file_id]) guai.push('allegato ' + a.id + ' punta a un file che non c’e: ' + a.drive_file_id);
  });
  S.db.moduli.forEach(function(m){
    if(m.drive_file_id && !S.drive[m.drive_file_id]) guai.push('modulo della chiamata ' + m.chiamata_id + ' punta a un file che non c’e');
  });
  // 3. Nessun allegato o modulo deve pendere da una chiamata inesistente
  var vive = {}; S.db.chiamate.forEach(function(c){ vive[c.id] = 1; });
  S.db.allegati.forEach(function(a){ if(!vive[a.chiamata_id]) guai.push('allegato ' + a.id + ' su chiamata inesistente ' + a.chiamata_id); });
  S.db.moduli.forEach(function(m){ if(!vive[m.chiamata_id]) guai.push('modulo su chiamata inesistente ' + m.chiamata_id); });
  // 4. Nessun doppione di file per lo stesso allegato
  var visti = {};
  S.db.allegati.forEach(function(a){
    var k = a.chiamata_id + '|' + a.file_name;
    if(visti[k]) guai.push('allegato in doppio: ' + a.file_name + ' sulla chiamata ' + a.chiamata_id);
    visti[k] = 1;
  });
  // 5. Nessuna chiamata in doppio per impronta
  var impronte = {};
  S.db.chiamate.forEach(function(c){
    if(!c.client_uuid) return;
    if(impronte[c.client_uuid]) guai.push('chiamata in doppio per impronta ' + c.client_uuid);
    impronte[c.client_uuid] = 1;
  });
  return guai;
};

B.foto = function(){
  var S = B.stato;
  return {
    linea: S.linea,
    chiamate: S.db.chiamate.length,
    allegati: S.db.allegati.length,
    moduli: S.db.moduli.length,
    fileDrive: Object.keys(S.drive).filter(function(k){ return !S.drive[k].cestinato; }).length,
    codaChiamate: (function(){ try{ return syncLoadQueue().length; }catch(_){ return -1; } })(),
    codaModuli: Object.keys(window.moduliMLocali || {}).length,
    codaAllegati: (function(){ var n=0; Object.keys(window.allegatiLocali||{}).forEach(function(k){ n += (allegatiLocali[k]||[]).length; }); return n; })()
  };
};

B.righeOrfaneInPagina = function(){
  var n = 0;
  document.querySelectorAll('#tbody tr.attach-row').forEach(function(ar){
    var per = ar.getAttribute('data-for') || '';
    var riga = document.querySelector('#tbody tr[data-row="'+per+'"]')
            || (per.indexOf('local_')===0 ? document.querySelector('#tbody tr[data-uuid="'+per.slice(6)+'"]') : null);
    if(!riga) n++;
  });
  return n;
};

console.log('Banco di prova pronto. Banco.avvia() per cominciare.');
})();
