// Design token mirror — keep in sync with :root CSS vars
var PALETTE = {
  strategist: 'var(--clr-strategist)',
  risk:        'var(--clr-risk)',
  psyche:      'var(--clr-psyche)',
  oracle:      'var(--clr-oracle)',
  expert:      'var(--clr-expert)',
  honey:       'var(--honey)',
  lapis:       'var(--lapis)',
  canyon:      'var(--canyon)',
  amber:       'var(--amber)'
};

// Named material system — all domain colour comes from here, nothing hardcoded elsewhere
var MATERIALS = {
  'ink-stone':      { name:'Ink Stone',       gs:'#2C3E50', ge:'#1D2A38', lum:'#EAEFF5', exe:'#202A35', rgb:'44,62,80',    evoke:'Quiet focus of deep study' },
  'granite-bedrock':{ name:'Granite Bedrock', gs:'#4E5055', ge:'#2D2E30', lum:'#D9DCE1', exe:'#38393B', rgb:'78,80,85',    evoke:'Solid foundation for great work' },
  'hearthstone':    { name:'Hearthstone',     gs:'#7A1F2E', ge:'#4A1220', lum:'#FF9EB4', exe:'#5E1825', rgb:'122,31,46',   evoke:'Warm energy of a passion project' },
  'wild-orchid':    { name:'Wild Orchid',     gs:'#A2397B', ge:'#6B2551', lum:'#FFA0E5', exe:'#802D60', rgb:'162,57,123',  evoke:'Vibrant creative energy and joy' },
  'mosswood':       { name:'Mosswood',        gs:'#2A5E4A', ge:'#163828', lum:'#C4E869', exe:'#1E4030', rgb:'42,94,74',    evoke:'Growth and steady wellbeing' },
  'arctic-shore':   { name:'Arctic Shore',    gs:'#58707D', ge:'#3A4952', lum:'#E0F4FF', exe:'#43555F', rgb:'88,112,125',  evoke:'Calm clarity of vast open space' },
  'sun-baked-clay': { name:'Sun-baked Clay',  gs:'#A15A38', ge:'#6B3B24', lum:'#FFCBA4', exe:'#7A4429', rgb:'161,90,56',   evoke:'Warmth of home and human connection' },
  'aged-mahogany':  { name:'Aged Mahogany',   gs:'#712D3A', ge:'#4A1D25', lum:'#F2B8B3', exe:'#59242E', rgb:'113,45,58',   evoke:'Legacy and depth of family history' },
  'cyberspace-grid':{ name:'Cyberspace Grid', gs:'#005F6B', ge:'#003C43', lum:'#66FBFB', exe:'#004850', rgb:'0,95,107',    evoke:'Precise interconnected logic of tech' },
  'gilded-ore':     { name:'Gilded Ore',      gs:'#796A3D', ge:'#4A3F25', lum:'#C8A96A', exe:'#4A3D26', rgb:'121,106,61',  evoke:'Value and deliberate pursuit of growth' },
  'amethyst-sky':   { name:'Amethyst Sky',    gs:'#6247AA', ge:'#3B2A66', lum:'#D5C6FF', exe:'#493680', rgb:'98,71,170',   evoke:'Introspection and connection to the mystical' },
  'saffron-road':   { name:'Saffron Road',    gs:'#7A3B28', ge:'#4A2218', lum:'#E8C4A0', exe:'#5E2E1C', rgb:'122,59,40',   evoke:'Adventure and richness of knowledge' },
  'nebula':         { name:'Nebula',          gs:'#40469A', ge:'#26295D', lum:'#B3B8FF', exe:'#313678', rgb:'64,70,154',   evoke:'Wonder of the cosmos and ambitious ideas' },
  'first-light':    { name:'First Light',     gs:'#9E4A6A', ge:'#65304A', lum:'#FFB3D4', exe:'#7A3852', rgb:'158,74,106',  evoke:'New beginnings and gentle optimism' },
  'kingfisher':     { name:'Kingfisher',      gs:'#006E90', ge:'#00485E', lum:'#38B6FF', exe:'#005670', rgb:'0,110,144',   evoke:'Swift insight and brilliance in motion' },
};

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
// DM built dynamically from user domains — populated by loadDomains()
var DM = {};
var state_domains = []; // full domain objects

function buildDomainMap(domains) {
  DM = {};
  domains.forEach(function(d) {
    var m = MATERIALS[d.material] || MATERIALS['ink-stone'];
    var entry = { c: m.gs, l: d.slug, m: 'dom-'+d.slug, name: d.name, material: d.material };
    DM[d.slug] = entry;       // canonical key
    DM[d.name] = entry;       // name alias — covers any unmigrated task data
  });
}

function injectDomainStyles(domains) {
  var el = document.getElementById('domain-styles');
  if (!el) { el = document.createElement('style'); el.id = 'domain-styles'; document.head.appendChild(el); }
  var lines = [];
  domains.forEach(function(d) {
    var m = MATERIALS[d.material] || MATERIALS['ink-stone'];
    var sel = '.dom-' + d.slug;
    var grad = 'linear-gradient(135deg,' + m.gs + ' 0%,' + m.ge + ' 100%)';
    lines.push(sel + '::after { background:' + grad + '; }');
    lines.push(sel + ' .tile { background:' + grad + '; }');
    lines.push(sel + ' .tile-name { color:' + m.lum + '; }');
    lines.push(sel + ' .tile-domain { color:' + m.lum + ' !important; background:' + grad + '; }');
    lines.push('body.mode-execute ' + sel + ' .tile-name { color:' + m.exe + '; }');
    // Parse gradient start colour into rgba for light tint background
    var rgb = m.rgb; // already "r,g,b" string
    lines.push('body.mode-execute ' + sel + ' .tile { background:rgba(' + rgb + ',0.14) !important; color:' + m.exe + ' !important; }');
    lines.push('body.mode-execute ' + sel + ' .tile-domain { background:rgba(' + rgb + ',0.14) !important; color:' + m.exe + ' !important; }');
  });
  el.textContent = lines.join(' ');
}
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var DOMAINS=[]; // populated after domain load

var state={slug:null,user:null,tasks:[],taskById:{},view:'current',searchQuery:'',selectedId:null,mode:'plan',compact:false};

function api(m,u,b){
  var o={method:m,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}};
  if(b)o.body=JSON.stringify(b);
  return fetch(u,o).then(function(r){if(r.status===401){location.href='/login';throw new Error('unauthorized')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){console.error('API:',m,u,e);throw e});
}

function daysFrom(ds){if(!ds)return 999;return Math.round((new Date(ds+'T00:00:00')-TODAY)/864e5)}

function tLabel(n){
  if(n>=999) return '---';
  if(n>0)  return 'T-'+n;          // future: T-9 = 9 days until due
  if(n===0) return 'T-0';          // due today
  return 'T+'+Math.abs(n);         // overdue: T+3 = 3 days past due
}

function isBlocked(t){
  if(!t.needs||!t.needs.length) return false;
  for(var k=0;k<t.needs.length;k++){
    var d=state.taskById[t.needs[k]];if(!d)continue;
    if(!d.done && !d.archived)return true;
  }return false;
}

function matchSearch(t){
  if(!state.searchQuery)return true;var q=state.searchQuery.toLowerCase();
  return t.name.toLowerCase().includes(q)||t.domain.toLowerCase().includes(q);
}

function bufferDots(dp,dd){
  var n=Math.max(0,Math.min(5,dd-dp));
  var h='';
  for(var i=0;i<n;i++) h+='·';
  return h;
}

// ── Routing ───────────────────────────────────────────────────

function getSlug(){return location.pathname.replace(/^\//,'').replace(/\/$/,'')||null}
function navigate(s){history.pushState(null,'','/'+s);state.slug=s;loadBoard()}
window.addEventListener('popstate',route);
function route(){state.slug=getSlug();if(!state.slug)showPicker();else loadBoard()}

function showPicker(){
  // No picker — auto-navigate to authenticated user's board
  api('GET','/api/users').then(function(d){
    if(d.users && d.users.length > 0) navigate(d.users[0].slug);
  }).catch(function(){ location.href='/login'; });
}

// Topological sort: dependencies always above dependents in the card stack
// Uses Kahn's algorithm, respecting user's drag order as tiebreaker
function topoSort(tasks) {
  if (!tasks.length) return tasks;
  var byId = {};
  tasks.forEach(function(t) { byId[t.id] = t; });

  // in-degree = number of unresolved prerequisites still in the list
  var inDeg = {}, deps = {};
  tasks.forEach(function(t) { inDeg[t.id] = 0; deps[t.id] = []; });
  tasks.forEach(function(t) {
    (t.needs || []).forEach(function(nid) {
      if (byId[nid]) {          // only count needs that are visible in this view
        inDeg[t.id]++;
        deps[nid].push(t.id);
      }
    });
  });

  // urgencyRank: sort by due date ascending (overdue first, no-date last)
  function urgencyRank(t) {
    var dd = daysFrom(t.due_date);
    return dd >= 999 ? 99999 : dd;
  }

  // Queue starts with all tasks that have no unresolved prerequisites
  var queue = tasks.filter(function(t) { return inDeg[t.id] === 0; });
  queue.sort(function(a, b) { return urgencyRank(a) - urgencyRank(b); });

  var result = [];
  while (queue.length) {
    var t = queue.shift();
    result.push(t);
    deps[t.id].forEach(function(did) {
      inDeg[did]--;
      if (inDeg[did] === 0) {
        queue.push(byId[did]);
        queue.sort(function(a, b) { return urgencyRank(a) - urgencyRank(b); });
      }
    });
  }

  // Append any tasks involved in dependency cycles (defensive)
  tasks.forEach(function(t) { if (result.indexOf(t) < 0) result.push(t); });
  return result;
}

function loadBoard(){
  var vp=state.view==='archived'?'?view=archived':'';
  Promise.all([
    api('GET','/api/users/'+state.slug+'/tasks'+vp),
    api('GET','/api/users/'+state.slug+'/ui-state'),
    api('GET','/api/users/'+state.slug+'/domains')
  ]).then(function(resArr){
    var res=resArr[0], ui=resArr[1], domRes=resArr[2];
    // Domains must be ready before renderApp so cards get correct classes
    state_domains = domRes.domains || [];
    buildDomainMap(state_domains);
    injectDomainStyles(state_domains);
    DOMAINS = state_domains.map(function(d){return d.slug;});

    state.tasks=res.tasks;state.user=res.user;
    if(ui.mode) state.mode=ui.mode;
    if(ui.compact !== undefined) state.compact=ui.compact;

    if(ui.order && ui.order.length){
      var map={}; ui.order.forEach(function(id,idx){map[id]=idx});
      state.tasks.sort(function(a,b){
        var ia=map[a.id], ib=map[b.id];
        if(ia!==undefined && ib!==undefined) return ia-ib;
        if(ia!==undefined) return -1;
        if(ib!==undefined) return 1;
        return 0;
      });
    }

    state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
    state.tasks = topoSort(state.tasks);
    renderApp();
  });
}

// ── Shell ─────────────────────────────────────────────────────

function applyMode(){
  if(state.mode==='execute') document.body.classList.add('mode-execute');
  else document.body.classList.remove('mode-execute');
}

function sendOracleMsg(){
  var inp=document.getElementById('oracleInput'); if(!inp) return;
  var q=inp.value.trim(); if(!q) return;
  var feed=document.getElementById('oracleFeed'); if(!feed) return;
  var userEl=document.createElement('div');userEl.className='oracle-msg from-user';userEl.textContent=q;feed.appendChild(userEl);
  inp.value='';
  api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
    var el=document.createElement('div');el.className='oracle-msg from-oracle';el.textContent=r.answer||r.error||'...';feed.appendChild(el);
    feed.scrollTop=feed.scrollHeight;
  });
}

function renderApp(){
  var root=document.getElementById('root');
  var dateStr=TODAY.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'});
  root.innerHTML=
    '<div class="panel-tree" id="treePanel">'
      +'<button class="mobile-back-btn" id="mobileBackBtn">← Back</button>'
      +'<div class="tree-container" id="treeContainer"></div>'
      +'<div class="user-identity">'
        +'<div style="display:flex; align-items:center; gap:20px">'
          +'<div class="tile identity-tile" id="userName"></div>'
          +'<div id="errorNotify" class="error-notification"></div>'
        +'</div>'
      +'</div>'
    +'</div>'
    +'<div class="panel-list">'
      +'<div class="hdr">'
        +'<div class="hdr-row1">'
          +'<div class="hdr-date-etched">'
            +'<span class="hdr-date-text">'+dateStr+'</span>'
            +'<div id="statusDots" class="status-dots-etched"></div>'
            +'<button class="hdr-logout-btn" id="logoutBtn" title="Sign out">⏻</button>'
          +'</div>'
        +'</div>'
        +'<div class="hdr-row2-icons">'
          +'<div class="hdr-icon-cluster">'
            +'<button class="hdr-icon '+(state.mode==='plan'?'hdr-icon--plan':'hdr-icon--execute')+'" id="modeToggleBtn">'+(state.mode==='plan'?'◈ Plan':'▷ Execute')+'</button>'
            +'<button class="hdr-icon '+(state.view==='current'?'hdr-icon--active':'hdr-icon--archived')+'" id="viewToggleBtn">'+(state.view==='current'?'↑ Active':'↓ Archived')+'</button>'
            +'<button class="hdr-icon hdr-icon--council" id="aiBtn">'+(state.mode==='plan'?'⊛ Council':'✦ Oracle')+'</button>'
            +'<button class="hdr-icon hdr-icon--add" id="addBtn">＋ Add</button>'
            +'<button class="hdr-icon hdr-icon--compact'+(state.compact?' active-compact':'')+'" id="compactBtn">'+(state.compact?'▤ Cards':'⊟ List')+'</button>'
            +'<button class="hdr-icon hdr-icon--domains" id="domainsBtn">⊞ Domains</button>'
          +'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;margin-top:10px;gap:10px;width:100%">'
          +'<div style="display:flex;justify-content:flex-end">'
            +'<input class="search" id="search" placeholder="Filter sanctuary..." autocomplete="off">'
          +'</div>'
        +'</div>'
      +'</div>'
      +'<div class="cards" id="cardScroll"><div class="cards-inner" id="cardList"></div></div>'
    +'</div>';

  // Inject oracle panel
  if(!document.getElementById('oraclePanel')){
    var op=document.createElement('div');op.id='oraclePanel';op.className='oracle-panel';
    op.innerHTML='<div class="oracle-label">▶ Execute Oracle</div>'
      +'<div class="oracle-feed" id="oracleFeed"><div class="oracle-msg from-oracle">Oracle ready. What are you working on?</div></div>'
      +'<div class="oracle-input-row"><input class="oracle-input" id="oracleInput" placeholder="Talk to Execute Oracle..." autocomplete="off"><button class="oracle-send" id="oracleSend">ASK</button></div>';
    document.body.appendChild(op);
    document.getElementById('oracleSend').onclick=sendOracleMsg;
    document.getElementById('oracleInput').addEventListener('keydown',function(e){if(e.key==='Enter')sendOracleMsg()});
  }
  applyMode();
  document.getElementById('cardScroll').classList.toggle('compact-view', state.compact);
  document.getElementById('userName').textContent=state.user?state.user.name.toUpperCase():'';
  var backBtn = document.getElementById('mobileBackBtn');
  if(backBtn) backBtn.onclick = function(){
    document.querySelector('.app').classList.remove('mobile-tree-active');
    state.selectedId = null;
    document.querySelectorAll('.card').forEach(function(c){ c.classList.remove('selected'); });
    renderTree(null);
  };

  document.getElementById('search').addEventListener('input',function(){state.searchQuery=this.value;renderCards()});

  document.getElementById('addBtn').addEventListener('click',openAddTask);
  document.getElementById('domainsBtn').addEventListener('click',openDomainsModal);
  document.getElementById('compactBtn').addEventListener('click',function(){
    state.compact = !state.compact;
    api('PUT','/api/users/'+state.slug+'/ui-state',{compact:state.compact});
    document.getElementById('cardScroll').classList.toggle('compact-view', state.compact);
    renderCards();
    // Update button class
    var btn=document.getElementById('compactBtn');
    if(btn){ btn.classList.toggle('active-compact',state.compact); }
  });
  document.getElementById('aiBtn').addEventListener('click',function(){
    if(state.mode==='plan') openCouncil();
    else openAI();
  });
  document.getElementById('logoutBtn').addEventListener('click',openLogoutConfirm);
  document.getElementById('modeToggleBtn').addEventListener('click',function(){
    state.mode = state.mode==='plan' ? 'execute' : 'plan';
    api('PUT','/api/users/'+state.slug+'/ui-state',{mode:state.mode});
    applyMode();
    // Sync both header buttons without full re-render
    var modeBtn = document.getElementById('modeToggleBtn');
    if(modeBtn){
      modeBtn.textContent = state.mode==='plan' ? '◈ Plan' : '▷ Execute';
      modeBtn.className = 'hdr-icon ' + (state.mode==='plan' ? 'hdr-icon--plan' : 'hdr-icon--execute');
    }
    var aiBtn = document.getElementById('aiBtn');
    if(aiBtn) aiBtn.textContent = state.mode==='plan' ? '⊛ Council' : '✦ Oracle';
  });

  document.getElementById('viewToggleBtn').onclick = function(){
    state.view = state.view === 'current' ? 'archived' : 'current';
    loadBoard();
  };

  renderCards();
  if(state.selectedId) renderTree(state.selectedId);
  updateStatusDots();
  updateDomainLights();
}

function getTaskHue(t){
  if(t.archived) return '';
  var dp=daysFrom(t.plan_date), dd=daysFrom(t.due_date);
  if(dd <= 1) return 'canyon';
  if(dd <= 3) return 'amber';
  if(dd <= 7 || (dd < 999 && dp < 999 && dd - dp < 3)) return 'marble';
  return '';
}



function notifyError(msg){
  var el=document.getElementById('errorNotify'); if(!el) return;
  el.textContent=msg; el.classList.add('show');
  setTimeout(function(){el.classList.remove('show')}, 5000);
}

function openLogoutConfirm(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2>Exit Sanctuary?</h2>'
    +'<p style="text-align:center;opacity:0.6;font-size:14px;margin-bottom:30px">Your session will be ended and you will return to the gateway.</p>'
    +'<div class="modal-actions">'
      +'<button id="mc" class="btn-cancel">Stay Focused</button>'
      +'<button id="ms" class="btn-danger">Sign Out</button>'
    +'</div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){ location.href='/logout'; };
}

// ── Cards ─────────────────────────────────────────────────────

function makeCardCompact(t){
  var dm=DM[t.domain]||{c:'var(--faded)',l:t.domain,m:''};
  var hue=getTaskHue(t);
  var archived=!!t.archived;
  var dd=daysFrom(t.due_date);
  var tDue=dd<999?tLabel(dd):'';
  var tileColour=dd<=0?'var(--canyon)':dd<=3?'var(--amber)':'rgba(var(--ink-rgb),0.4)';
  var speedStr=SPEED_L[t.speed]||'';
  var stakesStr=STAKES_L[t.stakes]||'';
  var stakesCls='tile-stakes-'+(t.stakes||0);

  var el=document.createElement('div');
  el.className='card compact '+dm.m+' '+(hue?'hue-'+hue:'')+(archived?' archived':'')+(state.selectedId===t.id?' selected':'');
  el.dataset.id=t.id;

  var h='';
  // Action column (just the done/restore button)
  h+='<div class="compact-action">';
  h+=(archived||state.view==='archived'
    ?'<button class="cbtn act-restore" data-id="'+t.id+'" title="Restore">↑</button>'
    :'<button class="cbtn act-archive" data-id="'+t.id+'" title="Done" aria-label="Mark as done"></button>');
  h+='</div>';
  // Drag handle (spans both rows, between action and content)
  h+='<div class="act-drag compact-drag" data-id="'+t.id+'" title="Drag to reorder">⠿</div>';
  // Two-row content
  h+='<div class="compact-content">';
  // Row 1: name
  h+='<div class="compact-name">'+esc(t.name)+'</div>';
  // Row 2: urgency dot + T-X + effort + impact
  h+='<div class="compact-tiles">';
  if(hue) h+='<div class="card-hue-indicator dot-'+hue+'" style="width:7px;height:7px;border-radius:50%;flex-shrink:0"></div>';
  if(tDue)      h+='<div class="tile compact-tile" style="color:'+tileColour+'">'+esc(tDue)+'</div>';
  if(speedStr)  h+='<div class="tile compact-tile tile-effort">'+esc(speedStr)+'</div>';
  if(stakesStr) h+='<div class="tile compact-tile '+stakesCls+'">'+esc(stakesStr)+'</div>';
  h+='</div>';
  h+='</div>';

  el.innerHTML=h;
  el.onclick=function(e){
    if(e.target.closest('.cbtn,input'))return;
    e.stopPropagation();
    state.selectedId=(state.selectedId===t.id)?null:t.id;
    document.querySelectorAll('.card').forEach(function(c){c.classList.toggle('selected',+c.dataset.id===state.selectedId);});
    renderTree(state.selectedId);
    if(window.innerWidth<=1024&&state.selectedId) document.querySelector('.app').classList.add('mobile-tree-active');
  };
  return el;
}


function makeCardEl(t, isList){
  if(state.compact && isList !== false) return makeCardCompact(t);
  var blocked=isBlocked(t), archived=!!t.archived;
  var dp=daysFrom(t.plan_date), dd=daysFrom(t.due_date);
  var dm=DM[t.domain]||{c:'var(--faded)',l:t.domain,m:''};

  // DEDUP: archived is the state of completion/done
  var isUrgent = (dd <= 1 && !archived) || blocked;
  var stateCls = isUrgent ? 'state-urgent' : (archived ? 'state-safe' : '');
  
  // Subtle Background Hues
  var hue = getTaskHue(t);
  var hueCls = hue ? 'hue-' + hue : '';

  var el=document.createElement('div');
  var archiveAge=0;
  if(archived && t.archived_at){
    archiveAge=Math.min(7,Math.floor((Date.now()-new Date(t.archived_at).getTime())/(1000*60*60*24)));
  }
  el.className='card '+dm.m+' '+stateCls+' '+hueCls+(archived?' archived':'')+(blocked?' blocked':'')+(state.selectedId===t.id?' selected':'');
  if(archived && archiveAge>0) el.dataset.age=archiveAge;
  el.dataset.id=t.id;

  var h='';
  // Dissolved Action Icons (absolute top left)
  h+='<div class="tile-actions" style="position:absolute; top:10px; left:10px; display:flex; gap:8px; z-index:10; align-items:center">'
    +(archived || state.view === 'archived' 
      ? '<button class="cbtn act-restore" data-id="'+t.id+'" title="Restore">↑</button>' 
      : '<button class="cbtn act-archive" data-id="'+t.id+'" title="Done" aria-label="Mark as done"></button>')
    +'<button class="cbtn act-edit" data-id="'+t.id+'" title="Edit">✎</button>'
    +'<button class="cbtn act-drag" data-id="'+t.id+'" title="Drag to reorder" style="cursor:grab">⠿</button>'
    +(hue ? '<div class="card-hue-indicator dot-'+hue+'" title="Status: '+hue.toUpperCase()+'"></div>' : '')
  +'</div>';

  h+='<div class="card-grid">';
  // Subtiles (TOP RIGHT)
  var dLabel=t.plan_label&&t.due_label&&t.plan_label!==t.due_label?t.plan_label+' → '+t.due_label:t.due_label||t.plan_label||'---';
  h+='<div class="tile tile-date">'+esc(dLabel)+'</div>';
  
  h+='<div class="tile tile-urgency">';
  if(dp<999||dd<999){
    if(dp<999) h+='<span class="u-pill">'+tLabel(dp)+'</span>';
    if(dp<999&&dd<999&&dd>dp) h+='<span class="u-dots">'+bufferDots(dp,dd)+'</span>';
    if(dd<999) h+='<span class="u-pill">'+tLabel(dd)+'</span>';
  } else h+='<span style="opacity:0.2">---</span>';
  h+='</div>';
  // Effort + Impact: right below the time indicators
  h+='<div class="tile tile-meta">';
  if(t.speed!==undefined&&t.speed!==null) h+='<span class="tile-effort">'+esc(SPEED_L[t.speed]||'')+'</span>';
  if(t.speed!==undefined&&t.stakes!==undefined&&t.speed!==null&&t.stakes!==null) h+='<span class="u-dots">·</span>';
  if(t.stakes!==undefined&&t.stakes!==null) h+='<span class="tile-stakes tile-stakes-'+t.stakes+'">'+esc(STAKES_L[t.stakes]||'')+'</span>';
  h+='</div>';
  h+='</div>'; // end card-grid

  // Footer Group (Name + Blocker)
  h+='<div class="card-footer">';
  if(blocked && !t.isSub) h+='<div class="tile tile-blocked">NEEDS: '+esc(getBlockerName(t))+'</div>';
  if(t.isSub) h+='<div class="tile tile-blocked">↳ sub of '+esc(state.taskById[t.parentId]?.name || 'parent')+'</div>';
  h+='<div class="tile-name">'+esc(t.name)+'</div>';
  h+='</div>';

  // Domain Identifier (STRICT BOTTOM RIGHT)

  h+='<div class="tile tile-domain">'+esc(dm.l)+'</div>';

  el.innerHTML=h;

  el.onclick=function(e){
    if(e.target.closest('.cbtn, input')) return;
    if(state.selectedId===t.id && isList) openEdit(t.id);
    else {
      state.selectedId=t.id;
      document.querySelectorAll('.card').forEach(c=>c.classList.toggle('selected',+c.dataset.id===t.id));
      renderTree(t.id);
      // Mobile: swap to tree panel
      if(window.innerWidth <= 1024) document.querySelector('.app').classList.add('mobile-tree-active');
    }
  };

  return el;
}

function renderCards(){
  var list=document.getElementById('cardList');if(!list)return;
  var filtered=state.tasks.filter(matchSearch);
  if(!filtered.length){list.innerHTML='<p style="text-align:center;padding:100px;opacity:0.3">Empty</p>';return}
  list.innerHTML='';
  filtered.forEach(function(t){ list.appendChild(makeCardEl(t, true)) });

  Sortable.create(list, { 
    animation: 300, 
    ghostClass: 'sortable-ghost',
    handle: '.act-drag',
    onEnd: function() {
        var ids = Array.from(list.querySelectorAll('.card')).map(el => +el.dataset.id);
        // Persist local order for UI state
        api('PUT','/api/users/'+state.slug+'/ui-state',{order:ids});
    }
  });
  bindGlobalActionEvents();
}

function updateStatusDots(){
  var container = document.getElementById('statusDots'); if(!container) return;
  var activeTasks = state.tasks.filter(t => !t.archived);
  if(!activeTasks.length) { container.innerHTML = ''; return; }
  var counts = {canyon:0, amber:0, marble:0, dim:0};
  activeTasks.forEach(t => { var h=getTaskHue(t); if(h) counts[h]++; else counts.dim++; });
  var total = activeTasks.length; var dots = 10;
  var types = ['canyon','amber','marble','dim'];
  var dotCounts = types.map(type => Math.round((counts[type]/total)*dots));
  var diff = dots - dotCounts.reduce((a,b)=>a+b,0);
  dotCounts[3] += diff;
  var tipParts=[];
  if(counts.canyon) tipParts.push(counts.canyon+' canyon');
  if(counts.amber) tipParts.push(counts.amber+' amber');
  if(counts.marble) tipParts.push(counts.marble+' marble');
  if(counts.dim) tipParts.push(counts.dim+' clear');
  var tipText=tipParts.join(' · ')||'all clear';
  var h='<div class="status-tile"><span class="status-tile-tooltip">'+tipText+'</span>';
  types.forEach((type,idx)=>{ for(var i=0;i<dotCounts[idx];i++) h+='<div class="status-dot dot-'+type+'"></div>'; });
  h+='</div>';
  container.innerHTML=h;
}
var _cardActionsBound = false;
// Off-canvas light positions — assigned to domains by index
var LIGHT_POSITIONS = [
  {x:'112%',y:'38%'},{x:'-12%',y:'22%'},{x:'92%',y:'80%'},
  {x:'18%',y:'112%'},{x:'52%',y:'-12%'},{x:'108%',y:'72%'},
  {x:'-8%',y:'70%'},{x:'60%',y:'-15%'}
];

function updateDomainLights(){
  var el=document.getElementById('bgLights');
  if(!el){ el=document.createElement('div'); el.id='bgLights'; document.body.insertBefore(el,document.body.firstChild); }
  if(!state_domains.length){ el.style.backgroundImage=''; return; }
  var tasks=state.tasks.filter(function(t){return !t.archived;});
  var total=Math.max(tasks.length,1);
  var grads=state_domains.map(function(d,i){
    var m=MATERIALS[d.material]||MATERIALS['ink-stone'];
    var pos=LIGHT_POSITIONS[i%LIGHT_POSITIONS.length];
    var count=tasks.filter(function(t){return t.domain===d.slug;}).length;
    var pct=count/total;
    var op=(0.07+pct*0.20).toFixed(2);
    var spread=Math.round(38+pct*28);
    return 'radial-gradient(ellipse at '+pos.x+' '+pos.y+',rgba('+m.rgb+','+op+') 0,transparent '+spread+'%)';
  }).join(',');
  el.style.backgroundImage=grads;
}

function bindGlobalActionEvents(){
  if(_cardActionsBound) return;
  _cardActionsBound = true;
  document.addEventListener('click', function(e){
    var btn = e.target.closest('.cbtn'); if(!btn) return;
    e.stopPropagation();
    var id = +btn.dataset.id;
    if(!btn.dataset.id || isNaN(id)) return;
    if(btn.classList.contains('act-edit')) openEdit(id);
    if(btn.classList.contains('act-archive')){
      var rect=btn.getBoundingClientRect();
      var flash=document.createElement('div');
      flash.className='bamboo-flash';
      flash.style.setProperty('--ripple-x',(rect.left+rect.width/2)+'px');
      flash.style.setProperty('--ripple-y',(rect.top+rect.height/2)+'px');
      document.body.appendChild(flash);
      setTimeout(function(){flash.remove();},950);
      api('PATCH','/api/tasks/'+id+'/archive').then(loadBoard);
    }
    if(btn.classList.contains('act-restore')) api('PATCH','/api/tasks/'+id+'/unarchive').then(loadBoard);
  });
}

function renderTree(id){
  var container=document.getElementById('treeContainer');if(!container)return;
  container.innerHTML='';
  if(!id) return;
  var task=state.taskById[id];if(!task)return;
  var isMobile=window.innerWidth<=1024;

  function makeSection(label, cards, opts){
    var s=document.createElement('div');
    s.className='tree-section';
    s.innerHTML='<div class="tree-label">'+label+'</div>';
    cards.forEach(function(t){
      var el=makeCardEl(t,false);
      if(opts&&opts.scale&&!isMobile) el.style.transform='scale(1.1)';
      if(opts&&opts.dim) el.style.opacity='0.5';
      s.appendChild(el);
    });
    container.appendChild(s);
  }

  // 1. Blockers
  var blockers=(task.needs||[]).map(function(nid){return state.taskById[nid]}).filter(Boolean);
  if(blockers.length) makeSection('Blocks this task', blockers);

  // 2. Focus
  makeSection('Active Focus', [task], {scale:true});

  // 3. Dependents + subtasks
  var dependents=state.tasks.filter(function(t){return(t.needs||[]).includes(task.id)});
  var subtasks=(task.subs||[]).map(function(s){return{id:'s'+s.id,name:s.label,domain:task.domain,done:s.done,isSub:true,parentId:task.id}});
  if(dependents.length||subtasks.length)
    makeSection('Depends on this task', dependents.concat(subtasks));
}

function getBlockerName(t){
  var active = (t.needs||[]).map(function(id){return state.taskById[id]}).filter(function(d){return d && !d.done && !d.archived});
  if(!active.length) return '';
  if(active.length === 1) return active[0].name.toUpperCase();
  return active.length + ' PREREQS';
}

function taskForm(t){
  var sel=DOMAINS.map(function(d){return'<option value="'+d+'"'+(t&&d===t.domain?' selected':'')+'>'+d+'</option>'}).join('');
  return '<div class="field-tile"><label>Task Name</label><input id="f-name" value="'+esc(t?t.name:'')+'" placeholder="..."></div>'
    +'<div class="field-tile"><label>Domain</label><select id="f-domain">'+sel+'</select></div>'
    +'<div style="display:flex;gap:12px">'
      +'<div class="field-tile'+(t&&t.due_date&&!t.plan_date?' plan-nudge':'')+'" style="flex:1"><label>Start</label><input id="f-pd" type="date" value="'+esc(t&&t.plan_date?t.plan_date:'')+'"></div>'
      +'<div class="field-tile" style="flex:1"><label>Due</label><input id="f-dd" type="date" value="'+esc(t&&t.due_date?t.due_date:'')+'"></div>'
    +'</div>'
    +'<div class="field-tile"><label>Status</label><select id="f-done"><option value="0">Pending</option><option value="1" '+(t&&t.done?'selected':'')+'>Done</option></select></div>';
}

function reloadDomains(cb){
  api('GET','/api/users/'+state.slug+'/domains').then(function(r){
    state_domains=r.domains||[];
    buildDomainMap(state_domains);
    injectDomainStyles(state_domains);
    DOMAINS=state_domains.map(function(d){return d.slug;});
    if(cb) cb();
  });
}

function matSwatchGrid(container, usedMaterials, currentMat){
  container.innerHTML='';
  container.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px';
  Object.keys(MATERIALS).forEach(function(key){
    var mat=MATERIALS[key];
    var taken=usedMaterials.indexOf(key)>=0 && key!==currentMat;
    var grad='linear-gradient(135deg,'+mat.gs+' 0%,'+mat.ge+' 100%)';
    var sw=document.createElement('div');
    sw.dataset.mat=key;
    sw.title=mat.name+' — '+mat.evoke;
    sw.style.cssText='border-radius:var(--r-sm);overflow:hidden;border:2px solid '
      +(key===currentMat?'var(--honey)':'transparent')+';opacity:'
      +(taken?'0.25':'1')+';cursor:'+(taken?'not-allowed':'pointer')+';transition:border-color 0.15s;';
    sw.innerHTML='<div style="height:30px;background:'+grad+'"></div>'
      +'<div style="padding:3px 5px;font-size:7px;font-weight:800;color:var(--ink);background:var(--glass-inner);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(mat.name)+'</div>';
    if(!taken) sw.onclick=function(){
      container.querySelectorAll('[data-mat]').forEach(function(x){x.style.borderColor='transparent';});
      this.style.borderColor='var(--honey)';
      container.dataset.selected=this.dataset.mat;
    };
    container.appendChild(sw);
  });
  container.dataset.selected=currentMat;
}

function openDomainsModal(){
  var m=document.getElementById('modal');
  m.style.maxWidth='680px';
  m.style.width='90vw';

  function render(expandId){
    var usedMaterials=state_domains.map(function(d){return d.material;});
    m.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
        +'<h2 style="margin:0">⊞ Domains</h2>'
        +'<button id="mc" class="btn-cancel" style="padding:6px 12px">Close</button>'
      +'</div>'
      +'<div id="domainList" style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px"></div>'
      +'<button id="addTriggerBtn" class="btn-cancel" style="width:100%;padding:10px;font-size:11px;letter-spacing:1px">＋ Add Domain</button>'
      +'<div id="addForm" style="display:none;margin-top:12px;padding:12px;background:var(--glass);border-radius:var(--r-md)">'
        +'<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px">'
          +'<div style="flex:2">'
            +'<label style="font-size:9px;font-weight:800;letter-spacing:1px;color:var(--faded)">NAME</label>'
            +'<input id="nd-name" placeholder="e.g. Health" style="display:block;width:100%;background:transparent;border:none;border-bottom:1px solid var(--glass-brd);color:var(--ink);font-size:15px;font-family:inherit;outline:none;padding-bottom:4px;margin-top:4px">'
          +'</div>'
          +'<div style="flex:1">'
            +'<label style="font-size:9px;font-weight:800;letter-spacing:1px;color:var(--faded)">ID</label>'
            +'<input id="nd-slug" maxlength="4" placeholder="HLT" style="display:block;width:100%;background:transparent;border:none;border-bottom:1px solid var(--glass-brd);color:var(--honey);font-size:15px;font-weight:900;font-family:inherit;outline:none;padding-bottom:4px;margin-top:4px;text-transform:uppercase;letter-spacing:3px">'
          +'</div>'
          +'<button id="nd-save" class="btn-save" style="flex-shrink:0;padding:8px 16px;font-size:11px">Add</button>'
        +'</div>'
        +'<label style="font-size:9px;font-weight:800;letter-spacing:1px;color:var(--faded)">MATERIAL</label>'
        +'<div id="nd-picker"></div>'
      +'</div>';

    // Render domain rows
    var list=document.getElementById('domainList');
    state_domains.forEach(function(d){
      var mat=MATERIALS[d.material]||MATERIALS['ink-stone'];
      var grad='linear-gradient(135deg,'+mat.gs+' 0%,'+mat.ge+' 100%)';
      var isOpen=(expandId===d.id);
      var row=document.createElement('div');
      row.style.cssText='border-radius:var(--r-sm);background:var(--glass);overflow:hidden;';

      // Header row
      var hdr=document.createElement('div');
      hdr.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;user-select:none;';
      hdr.innerHTML='<div style="width:28px;height:28px;border-radius:4px;background:'+grad+';flex-shrink:0"></div>'
        +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(d.name)+'</div>'
          +'<div style="font-size:8px;font-weight:900;letter-spacing:2px;color:var(--faded);margin-top:1px">'+esc(d.slug)+' · '+esc(mat.name)+'</div>'
        +'</div>'
        +'<span style="font-size:11px;color:'+(isOpen?'var(--honey)':'var(--faded)')+';transition:color 0.2s">'+(isOpen?'▲':'✎')+'</span>';

      // Edit panel (shown when open)
      var panel=document.createElement('div');
      panel.style.cssText='display:'+(isOpen?'block':'none')+';padding:14px 14px 10px;border-top:1px solid var(--glass-brd);';

      var nameRow=document.createElement('div');
      nameRow.style.cssText='display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;';
      var ni=document.createElement('input');
      ni.value=d.name;
      ni.placeholder='Domain name';
      ni.style.cssText='flex:1;background:transparent;border:none;border-bottom:1px solid var(--glass-brd);color:var(--ink);font-size:15px;font-family:inherit;outline:none;padding-bottom:4px;';
      var slugHint=document.createElement('div');
      slugHint.style.cssText='flex-shrink:0;font-size:9px;font-weight:900;color:var(--honey);letter-spacing:3px;padding-bottom:6px;';
      slugHint.textContent=d.slug;
      var sb=document.createElement('button');
      sb.className='btn-save';
      sb.style.cssText='flex-shrink:0;padding:8px 18px;font-size:11px;';
      sb.textContent='Save';
      nameRow.appendChild(ni);
      nameRow.appendChild(slugHint);
      nameRow.appendChild(sb);

      var matPickerEl=document.createElement('div');
      panel.appendChild(nameRow);
      panel.appendChild(matPickerEl);

      if(isOpen) matSwatchGrid(matPickerEl, usedMaterials, d.material);

      sb.onclick=function(){
        var newName=ni.value.trim();
        var newMat=matPickerEl.dataset.selected||d.material;
        if(!newName) return;
        sb.disabled=true; sb.textContent='Saving…';
        api('PUT','/api/users/'+state.slug+'/domains/'+d.id,{name:newName,material:newMat})
          .then(function(){ reloadDomains(function(){ render(null); loadBoard(); }); })
          .catch(function(e){ sb.disabled=false; sb.textContent='Save'; alert(e.message); });
      };

      hdr.onclick=function(){
        render(isOpen?null:d.id);
      };

      row.appendChild(hdr);
      row.appendChild(panel);
      list.appendChild(row);
    });

    // Wire add form
    var addTrigger=document.getElementById('addTriggerBtn');
    var addForm=document.getElementById('addForm');
    addTrigger.onclick=function(){
      var open=addForm.style.display!=='none';
      addForm.style.display=open?'none':'block';
      addTrigger.textContent=open?'＋ Add Domain':'✕ Cancel';
      if(!open){
        var ndPicker=document.getElementById('nd-picker');
        matSwatchGrid(ndPicker, usedMaterials, '');
      }
    };
    document.getElementById('nd-name').oninput=function(){
      document.getElementById('nd-slug').value=this.value.replace(/[^a-zA-Z]/g,'').toUpperCase().slice(0,4);
    };
    document.getElementById('mc').onclick=function(){ m.style.maxWidth=''; m.style.width=''; closeModal(); };
    document.getElementById('nd-save').onclick=function(){
      var name=document.getElementById('nd-name').value.trim();
      var slug=document.getElementById('nd-slug').value.toUpperCase();
      var mat=document.getElementById('nd-picker').dataset.selected;
      if(!name||!slug||!mat){ alert('Fill in name, ID and pick a material'); return; }
      this.disabled=true; this.textContent='Adding…';
      var btn=this;
      api('POST','/api/users/'+state.slug+'/domains',{name:name,slug:slug,material:mat})
        .then(function(){ reloadDomains(function(){ render(null); loadBoard(); }); })
        .catch(function(e){ btn.disabled=false; btn.textContent='Add'; alert(e.message); });
    };
  }

  render(null);
  showModal();
}

function openEdit(id){
  if(String(id).startsWith('s')){ alert('Subtask editing limited.'); return; }
  var t=state.taskById[id];if(!t)return;
  var m=document.getElementById('modal');
  m.innerHTML='<h2>Edit Stone</h2>'+taskForm(t)
    +'<div class="modal-actions">'
      +'<button id="mdel" class="btn-danger">Shatter</button>'
      +'<button id="mc" class="btn-cancel">Back</button>'
      +'<button class="btn-save" id="ms">Save</button>'
    +'</div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('mdel').onclick=function(){ if(confirm('Shatter this stone?')) api('DELETE','/api/tasks/'+id).then(()=>{closeModal();loadBoard()})};
  document.getElementById('ms').onclick=function(){
    var d={
      name:document.getElementById('f-name').value,
      domain:document.getElementById('f-domain').value,
      plan_date:document.getElementById('f-pd').value||null,
      due_date:document.getElementById('f-dd').value||null,
      done:+document.getElementById('f-done').value
    };
    api('PATCH','/api/tasks/'+id,d).then(function(){closeModal();loadBoard()});
  };
}

function openAddTask(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2>New Task</h2>'+taskForm(null)
    +'<div class="modal-actions">'
      +'<button id="mc" class="btn-cancel">Cancel</button>'
      +'<button class="btn-save" id="ms">Create Stone</button>'
    +'</div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){
    var d={
      name:document.getElementById('f-name').value,
      domain:document.getElementById('f-domain').value,
      plan_date:document.getElementById('f-pd').value||null,
      due_date:document.getElementById('f-dd').value||null,
      done:+document.getElementById('f-done').value
    };
    if(!d.name)return;
    api('POST','/api/users/'+state.slug+'/tasks',d).then(function(){loadBoard();closeModal()});
  };
}

// ── Oracle modal: chat vs deck review choice ──────────────────────────────
function openAI(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2 style="margin-bottom:20px">✦ Oracle</h2>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'
      +'<button id="choiceChat" style="'
        +'background:var(--glass);border:1px solid var(--glass-brd);border-radius:var(--r-md);'
        +'padding:20px 16px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.2s;color:var(--ink)">'
        +'<div style="font-size:18px;margin-bottom:8px">💬</div>'
        +'<div style="font-size:11px;font-weight:800;letter-spacing:1px;margin-bottom:4px">CHAT</div>'
        +'<div style="font-size:10px;opacity:0.5">Ask a question</div>'
      +'</button>'
      +'<button id="choiceDeck" style="'
        +'background:linear-gradient(135deg,rgba(var(--lapis-rgb),0.15),rgba(var(--honey-rgb),0.08));'
        +'border:1px solid var(--honey);border-radius:var(--r-md);'
        +'padding:20px 16px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.2s;color:var(--ink)">'
        +'<div style="font-size:18px;margin-bottom:8px">◈</div>'
        +'<div style="font-size:11px;font-weight:800;letter-spacing:1px;margin-bottom:4px;color:var(--honey)">REVIEW DECK</div>'
        +'<div style="font-size:10px;opacity:0.5">Go through every task</div>'
      +'</button>'
    +'</div>'
    +'<div class="modal-actions"><button id="mc" class="btn-cancel">Close</button></div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('choiceChat').onclick=function(){ closeModal(); openOracleChat(); };
  document.getElementById('choiceDeck').onclick=function(){ closeModal(); openDeckReview(); };
}

// ── Oracle chat (moved from openAI) ──────────────────────────────────────
var _oracleHistory = [];
var _oracleLastQuery = null;

function renderOracleHistory(){
  if(_oracleHistory.length>50) _oracleHistory=_oracleHistory.slice(-50);
  var feed=document.getElementById('oracle-chat-feed');if(!feed)return;
  feed.innerHTML='';
  _oracleHistory.forEach(function(msg){
    var el=document.createElement('div');
    el.className='oracle-chat-msg oracle-chat-msg--'+msg.role;
    el.innerHTML=renderMd(msg.text);
    feed.appendChild(el);
  });
  feed.scrollTop=feed.scrollHeight;
}

function openOracleChat(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2>✦ Oracle</h2>'
    +'<div class="oracle-chat-feed" id="oracle-chat-feed"></div>'
    +'<div class="oracle-chat-row">'
      +'<input class="oracle-chat-input" id="oracle-q" placeholder="Ask the Oracle..." autocomplete="off">'
      +'<button class="oracle-chat-send" id="oracle-send">↑</button>'
    +'</div>'
    +'<div class="modal-actions" style="margin-top:8px">'
      +'<button id="mc" class="btn-cancel">Close</button>'
    +'</div>';
  showModal();
  renderOracleHistory();
  if(_oracleHistory.length===0){
    _oracleHistory.push({role:'oracle',text:'Oracle ready. What are you working on?'});
    renderOracleHistory();
  }
  var input=document.getElementById('oracle-q');
  var send=document.getElementById('oracle-send');
  document.getElementById('mc').onclick=closeModal;
  function submitOracle(){
    var q=input.value.trim();if(!q)return;
    if(q===_oracleLastQuery){input.style.borderColor='var(--amber)';setTimeout(function(){input.style.borderColor='';},800);return;}
    _oracleLastQuery=q; input.value='';
    _oracleHistory.push({role:'user',text:q}); renderOracleHistory();
    send.disabled=true; send.textContent='…';
    api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
      _oracleHistory.push({role:'oracle',text:r.answer||r.error||'Oracle silent.'}); renderOracleHistory();
      send.disabled=false; send.textContent='↑'; _oracleLastQuery=null;
    }).catch(function(){
      _oracleHistory.push({role:'oracle',text:'Oracle unreachable.'}); renderOracleHistory();
      send.disabled=false; send.textContent='↑';
    });
  }
  send.onclick=submitOracle;
  input.addEventListener('keydown',function(e){if(e.key==='Enter')submitOracle();});
  setTimeout(function(){input.focus();},50);
}

// ── Deck Review overlay ───────────────────────────────────────────────────
var deckReviewState = {
  stack: [],        // tasks in topo priority order
  currentIdx: 0,    // which task we're on
  messages: [],     // full conversation history
  executing: false,
  proposals: []
};

function openDeckReview(){
  var overlay = document.getElementById('deckReviewOverlay');
  if(!overlay){ overlay=buildDeckReviewOverlay(); document.body.appendChild(overlay); }
  deckReviewState.stack  = state.tasks.filter(function(t){return !t.archived;});
  deckReviewState.currentIdx = 0;
  deckReviewState.messages   = [];
  deckReviewState.proposals  = [];
  overlay.classList.add('open');
  renderDeckStack();
  startDeckTask();
}

function closeDeckReview(){
  var overlay=document.getElementById('deckReviewOverlay');
  if(overlay) overlay.classList.remove('open');
  loadBoard(); // refresh the board after potential changes
}

function buildDeckReviewOverlay(){
  var el=document.createElement('div');
  el.id='deckReviewOverlay';
  el.className='deck-overlay';
  el.innerHTML=
    '<div class="deck-header">'
      +'<span class="deck-title">◈ DECK REVIEW</span>'
      +'<span class="deck-progress" id="deckProgress"></span>'
      +'<button class="deck-close" id="deckClose">✕ Exit</button>'
    +'</div>'
    +'<div class="deck-body">'
      +'<div class="deck-stack-panel" id="deckStackPanel"></div>'
      +'<div class="deck-agent-panel">'
        +'<div class="deck-task-label" id="deckTaskLabel">Loading…</div>'
        +'<div class="deck-feed" id="deckFeed"></div>'
        +'<div id="deckProposals" class="deck-proposals"></div>'
        +'<div class="deck-input-row">'
          +'<input class="deck-input" id="deckInput" placeholder="Respond to the agent…" autocomplete="off">'
          +'<button class="deck-send" id="deckSend">↑</button>'
        +'</div>'
        +'<div class="deck-nav">'
          +'<button class="deck-nav-btn" id="deckSkip">Skip →</button>'
          +'<button class="deck-nav-btn deck-nav-btn--done" id="deckDone">✓ Done with this task →</button>'
        +'</div>'
      +'</div>'
    +'</div>';

  el.querySelector('#deckClose').onclick=closeDeckReview;
  el.querySelector('#deckSend').onclick=sendDeckMessage;
  el.querySelector('#deckInput').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendDeckMessage();}});
  el.querySelector('#deckSkip').onclick=function(){ advanceDeck(false); };
  el.querySelector('#deckDone').onclick=function(){ advanceDeck(true); };
  return el;
}

function renderDeckStack(){
  var panel=document.getElementById('deckStackPanel'); if(!panel)return;
  var cur=deckReviewState.stack[deckReviewState.currentIdx];
  panel.innerHTML='';
  deckReviewState.stack.forEach(function(t,i){
    var dm=DM[t.domain]||{m:'',l:t.domain};
    var dd=daysFrom(t.due_date);
    var tStr=dd<999?tLabel(dd):'---';
    var row=document.createElement('div');
    var isCur=(i===deckReviewState.currentIdx);
    var isDone=(i<deckReviewState.currentIdx);
    row.className='deck-stack-row'+(isCur?' deck-stack-row--active':'')+(isDone?' deck-stack-row--done':'');
    row.innerHTML='<span class="deck-stack-num">'+(isDone?'✓':(i+1))+'</span>'
      +'<span class="deck-stack-name">'+esc(t.name)+'</span>'
      +'<span class="deck-stack-t">'+esc(tStr)+'</span>';
    row.onclick=function(){ deckReviewState.currentIdx=i; deckReviewState.messages=[]; deckReviewState.proposals=[]; renderDeckStack(); startDeckTask(); };
    panel.appendChild(row);
  });
  var prog=document.getElementById('deckProgress');
  if(prog) prog.textContent=deckReviewState.currentIdx+' / '+deckReviewState.stack.length+' reviewed';
}

function appendDeckMsg(role, text){
  deckReviewState.messages.push({role:role,text:text});
  var feed=document.getElementById('deckFeed'); if(!feed)return;
  var el=document.createElement('div');
  el.className='deck-msg deck-msg--'+role;
  el.innerHTML=renderMd(text);
  feed.appendChild(el);
  feed.scrollTop=feed.scrollHeight;
}

function renderDeckProposals(proposals){
  deckReviewState.proposals=proposals;
  var container=document.getElementById('deckProposals'); if(!container)return;
  container.innerHTML='';
  proposals.forEach(function(p,i){
    var card=document.createElement('div');
    card.className='deck-proposal';
    card.innerHTML='<div class="deck-proposal-desc">'+esc(p.description)+'</div>'
      +'<div class="deck-proposal-actions">'
        +'<button class="deck-proposal-confirm" data-i="'+i+'">✓ Confirm</button>'
        +'<button class="deck-proposal-reject"  data-i="'+i+'">✕ Reject</button>'
      +'</div>';
    card.querySelector('.deck-proposal-confirm').onclick=function(){
      confirmDeckProposal(i);
    };
    card.querySelector('.deck-proposal-reject').onclick=function(){
      card.remove();
    };
    container.appendChild(card);
  });
}

function confirmDeckProposal(i){
  var p=deckReviewState.proposals[i]; if(!p)return;
  api('POST','/api/deck-review/execute',{tool:p.tool,args:p.args}).then(function(r){
    appendDeckMsg('agent','✓ Done: '+r.message);
    var cards=document.querySelectorAll('.deck-proposal');
    if(cards[i]) cards[i].remove();
  }).catch(function(e){ appendDeckMsg('agent','Error: '+e.message); });
}

function startDeckTask(){
  var cur=deckReviewState.stack[deckReviewState.currentIdx];
  if(!cur){ appendDeckMsg('agent','All tasks reviewed. Deck is clear.'); return; }
  var label=document.getElementById('deckTaskLabel');
  if(label) label.textContent='Reviewing: '+cur.name;
  var feed=document.getElementById('deckFeed'); if(feed) feed.innerHTML='';
  var proposals=document.getElementById('deckProposals'); if(proposals) proposals.innerHTML='';
  deckReviewState.messages=[];
  setDeckLoading(true);
  api('POST','/api/deck-review',{messages:[],currentTaskId:cur.id}).then(function(r){
    setDeckLoading(false);
    if(r.text) appendDeckMsg('agent',r.text);
    if(r.proposals&&r.proposals.length) renderDeckProposals(r.proposals);
  }).catch(function(e){ setDeckLoading(false); appendDeckMsg('agent','Error: '+e.message); });
}

function sendDeckMessage(){
  var input=document.getElementById('deckInput'); if(!input)return;
  var q=input.value.trim(); if(!q)return;
  input.value='';
  appendDeckMsg('user',q);
  var cur=deckReviewState.stack[deckReviewState.currentIdx]; if(!cur)return;
  setDeckLoading(true);
  api('POST','/api/deck-review',{messages:deckReviewState.messages,currentTaskId:cur.id}).then(function(r){
    setDeckLoading(false);
    if(r.text) appendDeckMsg('agent',r.text);
    if(r.proposals&&r.proposals.length) renderDeckProposals(r.proposals);
  }).catch(function(e){ setDeckLoading(false); appendDeckMsg('agent','Error: '+e.message); });
}

function setDeckLoading(on){
  var send=document.getElementById('deckSend'); if(send){ send.disabled=on; send.textContent=on?'…':'↑'; }
  var input=document.getElementById('deckInput'); if(input) input.disabled=on;
  deckReviewState.executing=on;
}

function advanceDeck(markDone){
  if(markDone){
    var cur=deckReviewState.stack[deckReviewState.currentIdx];
    var remaining = deckReviewState.stack.length - deckReviewState.currentIdx - 1;
    appendDeckMsg('agent','Moving on. '+remaining+' task'+(remaining===1?'':'s')+' remaining.');
  }
  deckReviewState.currentIdx++;
  if(deckReviewState.currentIdx >= deckReviewState.stack.length){
    appendDeckMsg('agent','Deck review complete. All '+deckReviewState.stack.length+' tasks addressed.');
    document.getElementById('deckProgress').textContent='Complete ✓';
    return;
  }
  renderDeckStack();
  startDeckTask();
}


// ── Minimal markdown renderer ────────────────────────────────
function renderMd(text){
  if(!text) return '';
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:0.92em">$1</code>')
    .replace(/^#{1,3}\s+(.+)$/gm,'<span style="font-weight:900;letter-spacing:1px;text-transform:uppercase;font-size:0.85em;opacity:0.6">$1</span>')
    .replace(/\n/g,'<br>');
}

// ══════════════════════════════════════════════════
// COUNCIL CHAMBER — single chat, 5-agent switcher
// ══════════════════════════════════════════════════

var ALL_COUNCIL_AGENTS = [
  { id:'moderator',    icon:'⊛', label:'Moderator',    color:'var(--honey)' },
  { id:'strategist',   icon:'◈', label:'Strategist',   color:PALETTE.strategist },
  { id:'risk_scout',   icon:'⚑', label:'Risk Scout',   color:PALETTE.risk },
  { id:'psychologist', icon:'⟡', label:'Psychologist', color:PALETTE.psyche },
  { id:'plan_oracle',  icon:'◎', label:'Plan Oracle',  color:PALETTE.oracle }
];

var councilState = {
  sessionId: null,
  activeAgent: 'moderator',
  conversations: {},   // { agentId: [{role,text,ts}] }
  briefings: {},       // { agentId: responseText } — background briefings
  briefingsDone: 0,
  transcript: []
};

function initConversations(){
  councilState.conversations = {};
  councilState.briefings = {};
  councilState.briefingsDone = 0;
  councilState.transcript = [];
  ALL_COUNCIL_AGENTS.forEach(function(a){ councilState.conversations[a.id] = []; });
}

var _councilActive = false;
function openCouncil(){
  if(_councilActive) return;
  _councilActive = true;
  var overlay = document.getElementById('councilOverlay');
  if(!overlay){ overlay = buildCouncilOverlay(); document.body.appendChild(overlay); }

  // Determine 4th agent based on focus
  var focusTask = state.selectedId ? state.taskById[state.selectedId] : null;
  var last = ALL_COUNCIL_AGENTS[4];
  if(focusTask){
    last.id    = 'domain_expert';
    last.icon  = '◉';
    last.label = DOMAIN_EXPERT_LABELS[focusTask.domain] || 'Domain Expert';
    last.color = PALETTE.expert;
  } else {
    last.id    = 'plan_oracle';
    last.icon  = '◎';
    last.label = 'Plan Oracle';
    last.color = PALETTE.oracle;
  }

  // Rebuild symbol row
  rebuildSymbolRow(overlay);

  // Update context label
  var ctxEl = overlay.querySelector('.council-context');
  if(ctxEl) ctxEl.textContent = focusTask
    ? 'Focus: ' + focusTask.name + ' · ' + focusTask.domain
    : 'All Domains · ' + state.tasks.filter(function(t){return !t.archived}).length + ' Active';

  overlay.classList.add('open');
  initConversations();
  switchAgent('moderator', overlay);

  // Create session
  var sid = 'ps_' + Date.now() + '_' + (focusTask ? focusTask.domain : 'all');
  councilState.sessionId = sid;
  api('POST', '/api/plan-sessions', {
    id: sid, triggered: 'manual',
    domain: focusTask ? focusTask.domain : 'all',
    task_ids: focusTask ? [focusTask.id] : state.tasks.filter(function(t){return !t.archived}).map(function(t){return t.id})
  });

  var openingMsg = focusTask
    ? 'Council session opening. Focus task: "' + focusTask.name + '" (' + focusTask.domain + '). Give your initial assessment.'
    : 'Council session opening. Full portfolio review. Give your most important finding and what needs immediate attention.';

  // Brief all 4 background agents in parallel (not moderator)
  var bgAgents = ALL_COUNCIL_AGENTS.slice(1);
  bgAgents.forEach(function(agent){
    setAgentBriefing(overlay, agent.id, true);
    api('POST', '/api/council/invoke', {
      agent: agent.id, message: openingMsg,
      history: [], focusTask: focusTask
    }).then(function(r){
      councilState.briefings[agent.id] = r.response || '';
      councilState.conversations[agent.id].push({ role:'model', text: r.response||'', ts: Date.now() });
      setAgentBriefing(overlay, agent.id, false);
      councilState.briefingsDone++;
      logCouncilEvent(agent.id, 'briefing', r.response||'');
      // Once all 4 briefed, invoke moderator
      if(councilState.briefingsDone === 4) invokeModerator(overlay, openingMsg, focusTask);
    }).catch(function(e){
      councilState.briefings[agent.id] = 'Error: ' + e.message;
      councilState.briefingsDone++;
      if(councilState.briefingsDone === 4) invokeModerator(overlay, openingMsg, focusTask);
    });
  });

  // Show moderator thinking immediately
  showTyping(overlay);
}

function invokeModerator(overlay, openingMsg, focusTask){
  api('POST', '/api/council/invoke', {
    agent: 'moderator',
    message: 'The council has briefed. Please synthesize and guide.',
    history: councilState.conversations['moderator'],
    focusTask: focusTask,
    councilBriefings: councilState.briefings
  }).then(function(r){
    removeTyping(overlay);
    var text = r.response || '';
    appendMsg(overlay, text, 'from-agent');
    councilState.conversations['moderator'].push({ role:'model', text: text, ts: Date.now() });
    logCouncilEvent('moderator', 'synthesis', text);
  }).catch(function(e){
    removeTyping(overlay);
    appendMsg(overlay, 'Moderator error: ' + e.message, 'from-agent');
  });
}

function buildCouncilOverlay(){
  var el = document.createElement('div');
  el.id = 'councilOverlay';
  el.className = 'council-overlay';
  el.innerHTML =
    '<div class="council-header">'
      +'<span class="council-title">◈ Council Chamber</span>'
      +'<span class="council-context"></span>'
      +'<button class="council-extract" id="councilExtract">Extract & Close</button>'
      +'<button class="council-close" id="councilClose">✕ Dismiss</button>'
    +'</div>'
    +'<div class="council-agent-row" id="councilAgentRow"></div>'
    +'<div class="council-chat">'
      +'<div class="council-active-label" id="councilActiveLabel">Moderator</div>'
      +'<div class="council-feed" id="councilFeed"></div>'
      +'<div class="council-input-row">'
        +'<input class="council-input" id="councilInput" placeholder="Message Moderator..." autocomplete="off">'
        +'<button class="council-send" id="councilSend">Send</button>'
      +'</div>'
    +'</div>';

  el.querySelector('#councilClose').onclick = closeCouncil;
  el.querySelector('#councilExtract').onclick = extractAndClose;
  el.querySelector('#councilSend').onclick = sendCouncilMsg;
  el.querySelector('#councilInput').addEventListener('keydown', function(e){
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendCouncilMsg(); }
  });
  return el;
}

function rebuildSymbolRow(overlay){
  var row = overlay.querySelector('#councilAgentRow');
  row.innerHTML = '';
  ALL_COUNCIL_AGENTS.forEach(function(agent){
    var tile = document.createElement('div');
    tile.className = 'council-agent-tile' + (agent.id === councilState.activeAgent ? ' active' : '');
    tile.dataset.agent = agent.id;
    tile.innerHTML = '<span class="cat-icon">'+agent.icon+'</span>'
      +'<span class="cat-label">'+agent.label+'</span>'
      +'<span class="cat-dot"></span>';
    tile.onclick = function(){ switchAgent(agent.id, overlay); };
    row.appendChild(tile);
  });
}

function switchAgent(agentId, overlay){
  if(!overlay) overlay = document.getElementById('councilOverlay');
  councilState.activeAgent = agentId;

  // Update active tile
  overlay.querySelectorAll('.council-agent-tile').forEach(function(t){
    t.classList.toggle('active', t.dataset.agent === agentId);
  });

  // Update label
  var agent = ALL_COUNCIL_AGENTS.find(function(a){ return a.id === agentId; });
  var label = overlay.querySelector('#councilActiveLabel');
  if(label && agent) label.textContent = agent.label;
  if(label && agent) label.style.color = agent.color;

  // Update input placeholder
  var inp = overlay.querySelector('#councilInput');
  if(inp && agent) inp.placeholder = 'Message ' + agent.label + '...';

  // Render this agent's conversation
  renderFeed(overlay, agentId);
}

function renderFeed(overlay, agentId){
  var feed = overlay.querySelector('#councilFeed');
  if(!feed) return;
  feed.innerHTML = '';
  var conv = councilState.conversations[agentId] || [];
  conv.forEach(function(m){
    var el = document.createElement('div');
    var cls = m.role === 'user' ? 'from-user' : 'from-agent';
    el.className = 'agent-msg ' + cls;
    if(cls === 'from-agent') el.innerHTML = renderMd(m.text);
    else el.textContent = m.text;
    feed.appendChild(el);
  });
  feed.scrollTop = feed.scrollHeight;
}

function appendMsg(overlay, text, cls){
  var feed = overlay ? overlay.querySelector('#councilFeed') : document.getElementById('councilFeed');
  if(!feed) return;
  var el = document.createElement('div');
  el.className = 'agent-msg ' + cls;
  if(cls === 'from-agent') el.innerHTML = renderMd(text);
  else el.textContent = text;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

function showTyping(overlay){
  var feed = overlay ? overlay.querySelector('#councilFeed') : document.getElementById('councilFeed');
  if(!feed || feed.querySelector('.agent-msg-typing')) return;
  var t = document.createElement('div');
  t.className = 'agent-msg-typing';
  t.innerHTML = '<span></span><span></span><span></span>';
  feed.appendChild(t);
  feed.scrollTop = feed.scrollHeight;
}

function removeTyping(overlay){
  var feed = overlay ? overlay.querySelector('#councilFeed') : document.getElementById('councilFeed');
  if(!feed) return;
  var t = feed.querySelector('.agent-msg-typing');
  if(t) t.remove();
}

function setAgentBriefing(overlay, agentId, loading){
  var tile = overlay.querySelector('[data-agent="'+agentId+'"]');
  if(!tile) return;
  if(!loading) tile.classList.add('briefed');
}

function sendCouncilMsg(){
  var overlay = document.getElementById('councilOverlay');
  var inp = document.getElementById('councilInput');
  var btn = document.getElementById('councilSend');
  if(!inp || !overlay) return;
  var msg = inp.value.trim(); if(!msg) return;
  inp.value = '';

  var agentId = councilState.activeAgent;
  var focusTask = state.selectedId ? state.taskById[state.selectedId] : null;

  // Add user message to conversation + render
  councilState.conversations[agentId].push({ role:'user', text: msg, ts: Date.now() });
  appendMsg(overlay, msg, 'from-user');
  logCouncilEvent('user', 'message', msg + ' [to:'+agentId+']');

  btn.disabled = true;
  showTyping(overlay);

  var payload = {
    agent: agentId, message: msg, focusTask: focusTask,
    history: councilState.conversations[agentId].slice(-8).map(function(m){
      return { role: m.role === 'user' ? 'user' : 'model', text: m.text };
    })
  };
  if(agentId === 'moderator') payload.councilBriefings = councilState.briefings;

  api('POST', '/api/council/invoke', payload).then(function(r){
    removeTyping(overlay);
    var text = r.response || '';
    councilState.conversations[agentId].push({ role:'model', text: text, ts: Date.now() });
    appendMsg(overlay, text, 'from-agent');
    logCouncilEvent(agentId, 'message', text);
    btn.disabled = false;
  }).catch(function(e){
    removeTyping(overlay);
    appendMsg(overlay, 'Error: ' + e.message, 'from-agent');
    btn.disabled = false;
  });
}

function closeCouncil(){
  _councilActive = false;
  var overlay = document.getElementById('councilOverlay');
  if(overlay) overlay.classList.remove('open');
}

function logCouncilEvent(agent, eventType, content){
  if(!councilState.sessionId) return;
  councilState.transcript.push({ agent:agent, type:eventType, content:content, ts:new Date().toISOString() });
  api('POST', '/api/plan-sessions/'+councilState.sessionId+'/events', {
    agent:agent, event_type:eventType, content:{ text:content }
  });
}

function extractAndClose(){
  var btn = document.getElementById('councilExtract');
  if(btn){ btn.disabled=true; btn.textContent='Extracting...'; }
  var transcript = councilState.transcript.map(function(e){
    return '['+e.ts+'] ['+e.agent.toUpperCase()+'] '+e.content;
  }).join('\n');
  api('POST', '/api/council/extract', {
    sessionId: councilState.sessionId, transcript: transcript
  }).then(function(r){
    var overlay = document.getElementById('councilOverlay');
    var ext = r.extracted || {};
    var resultEl = document.createElement('div');
    resultEl.className = 'extract-result';
    var html = '<div class="extract-section"><div class="extract-label">Session Summary</div>'
      +'<div class="extract-item">'+esc(ext.summary||'No summary.')+'</div></div>';
    if(ext.decisions&&ext.decisions.length){
      html+='<div class="extract-section"><div class="extract-label">Decisions ('+ext.decisions.length+')</div>';
      ext.decisions.forEach(function(d){
        html+='<div class="extract-item"><strong>'+esc(d.type||'note')+'</strong>'+(d.task?' · '+esc(d.task):'')+' <span style="opacity:0.4;font-size:10px">['+esc(d.proposedBy||'')+']</span><br><span style="opacity:0.6;font-size:11px">'+esc(d.rationale||'')+'</span></div>';
      });
      html+='</div>';
    }
    if(ext.risks&&ext.risks.length){
      html+='<div class="extract-section"><div class="extract-label">Risks</div>';
      ext.risks.forEach(function(r){
        var cls=r.severity==='high'?'extract-risk-high':r.severity==='medium'?'extract-risk-medium':'';
        html+='<div class="extract-item '+cls+'">'+esc(r.task||'')+(r.task?' — ':'')+esc(r.risk||'')+'</div>';
      });
      html+='</div>';
    }
    if(ext.nextActions&&ext.nextActions.length){
      html+='<div class="extract-section"><div class="extract-label">Next Actions</div>';
      ext.nextActions.forEach(function(a){ html+='<div class="extract-item">→ '+esc(a)+'</div>'; });
      html+='</div>';
    }
    html+='<div style="margin-top:32px;display:flex;gap:12px">'
      +'<button class="btn-cancel" id="backToCouncil">Back to Council</button>'
      +'<button class="btn-save" id="doneCouncil">Done — Close</button>'
      +'</div>';
    resultEl.innerHTML=html;
    overlay.appendChild(resultEl);
    resultEl.querySelector('#backToCouncil').onclick=function(){ resultEl.remove(); if(btn){btn.disabled=false;btn.textContent='Extract & Close';} };
    resultEl.querySelector('#doneCouncil').onclick=function(){ closeCouncil(); resultEl.remove(); };
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='Extract & Close';}
    alert('Extraction failed: '+e.message);
  });
}

function showModal(){document.getElementById('modalBg').classList.add('show')}
function closeModal(){document.getElementById('modalBg').classList.remove('show')}
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
route();
