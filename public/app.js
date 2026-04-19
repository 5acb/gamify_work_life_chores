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
  amber:       'var(--amber)',
  teal:        '#5E9C95',
  cobalt:      '#3b6978',
  indigo:      '#1f3b4d',
  wood:        '#9b6a9b',
  purple:      '#6b4e71'
};

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:PALETTE.teal,l:'CTI',m:'mat-teal'},ECM:{c:PALETTE.wood,l:'ECM',m:'mat-wood'},CSD:{c:PALETTE.cobalt,l:'CSD',m:'mat-cobalt'},GRA:{c:PALETTE.purple,l:'GRA',m:'mat-purple'},Personal:{c:PALETTE.indigo,l:'PER',m:'mat-indigo'}};
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var DOMAINS=Object.keys(DM);

var state={slug:null,user:null,tasks:[],taskById:{},view:'current',searchQuery:'',selectedId:null,mode:'plan'};

function api(m,u,b){
  var o={method:m,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}};
  if(b)o.body=JSON.stringify(b);
  return fetch(u,o).then(function(r){if(r.status===401){location.href='/login';throw new Error('unauthorized')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){console.error('API:',m,u,e);throw e});
}

function daysFrom(ds){if(!ds)return 999;return Math.round((new Date(ds+'T00:00:00')-TODAY)/864e5)}

function tLabel(n){
  if(n===999) return '---';
  if(n<0) return 'T+'+Math.abs(n);
  return 'T-'+n;
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

function loadBoard(){
  var vp=state.view==='archived'?'?view=archived':'';
  Promise.all([
    api('GET','/api/users/'+state.slug+'/tasks'+vp),
    api('GET','/api/users/'+state.slug+'/ui-state')
  ]).then(function(resArr){
    var res=resArr[0], ui=resArr[1];
    state.tasks=res.tasks;state.user=res.user;
    if(ui.mode) state.mode=ui.mode;
    
    // Apply custom sort order if present
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
            +'<button class="hdr-logout-btn" id="logoutBtn" title="Sign out">⏻</button>'
          +'</div>'
        +'</div>'
        +'<div class="hdr-row2-icons">'
          +'<div class="hdr-icon-cluster">'
            +'<button class="hdr-icon '+(state.mode==='plan'?'hdr-icon--plan':'hdr-icon--execute')+'" id="modeToggleBtn">'+(state.mode==='plan'?'◈ Plan':'▷ Execute')+'</button>'
            +'<button class="hdr-icon '+(state.view==='current'?'hdr-icon--active':'hdr-icon--archived')+'" id="viewToggleBtn">'+(state.view==='current'?'↑ Active':'↓ Archived')+'</button>'
            +'<button class="hdr-icon hdr-icon--council" id="aiBtn">'+(state.mode==='plan'?'⊛ Council':'✦ Oracle')+'</button>'
            +'<button class="hdr-icon hdr-icon--add" id="addBtn">＋ Add</button>'
          +'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;margin-top:10px;gap:10px;width:100%">'
          +'<div style="display:flex;justify-content:flex-end">'
            +'<input class="search" id="search" placeholder="Filter sanctuary..." autocomplete="off">'
          +'</div>'
          +'<div id="statusDots" style="width:100%"></div>'
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

function makeCardEl(t, isList){
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
  var total = activeTasks.length; var dots = 20;
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
function updateDomainLights(){
  var el=document.getElementById('bgLights');
  if(!el){
    el=document.createElement('div');
    el.id='bgLights';
    document.body.insertBefore(el,document.body.firstChild);
  }
  var tasks=state.tasks.filter(function(t){return !t.archived;});
  var total=Math.max(tasks.length,1);

  // Off-canvas light positions + domain rgb (mat-* gradient starts)
  var lights=[
    {domain:'CTI',      rgb:'94,156,149',  x:'112%', y:'38%'},   // teal — right
    {domain:'CSD',      rgb:'59,105,120',  x:'-12%', y:'22%'},   // cobalt — left
    {domain:'GRA',      rgb:'107,78,113',  x:'92%',  y:'80%'},   // purple — bottom-right
    {domain:'ECM',      rgb:'155,106,155', x:'18%',  y:'112%'},  // warm — bottom
    {domain:'Personal', rgb:'31,59,77',    x:'52%',  y:'-12%'},  // indigo — top
  ];

  var grads=lights.map(function(l){
    var count=tasks.filter(function(t){return t.domain===l.domain;}).length;
    var pct=count/total;
    var op=(0.07+pct*0.20).toFixed(2);
    var spread=Math.round(38+pct*28);
    return 'radial-gradient(ellipse at '+l.x+' '+l.y+',rgba('+l.rgb+','+op+') 0,transparent '+spread+'%)';
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

function openAI(){
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
    // Dedup: reject if same as last query
    if(q===_oracleLastQuery){
      input.style.borderColor='var(--amber)';
      setTimeout(function(){input.style.borderColor='';},800);
      return;
    }
    _oracleLastQuery=q;
    input.value='';
    _oracleHistory.push({role:'user',text:q});
    renderOracleHistory();
    send.disabled=true; send.textContent='…';
    api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
      _oracleHistory.push({role:'oracle',text:r.answer||r.error||'Oracle silent.'});
      renderOracleHistory();
      send.disabled=false; send.textContent='↑';
      _oracleLastQuery=null; // allow re-ask after response
    }).catch(function(){
      _oracleHistory.push({role:'oracle',text:'Oracle unreachable.'});
      renderOracleHistory();
      send.disabled=false; send.textContent='↑';
    });
  }
  send.onclick=submitOracle;
  input.addEventListener('keydown',function(e){if(e.key==='Enter')submitOracle();});
  setTimeout(function(){input.focus();},50);
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
