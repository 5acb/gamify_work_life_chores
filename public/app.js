function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:'#5E9C95',l:'CTI',m:'mat-teal'},ECM:{c:'#9b6a9b',l:'ECM',m:'mat-wood'},CSD:{c:'#3b6978',l:'CSD',m:'mat-cobalt'},GRA:{c:'#6b4e71',l:'GRA',m:'mat-purple'},Personal:{c:'#1f3b4d',l:'PER',m:'mat-indigo'}};
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
  document.getElementById('root').innerHTML='<div class="picker" style="padding:100px;text-align:center"><h1>organizer</h1></div>';
  api('GET','/api/users').then(function(d){
    var pk=document.querySelector('.picker');
    d.users.forEach(function(u){
      var c=document.createElement('div');c.className='tile';c.style.cssText='display:inline-block;padding:40px;margin:20px;cursor:pointer;';
      c.innerHTML='<h2>'+esc(u.name)+'</h2><p>@'+esc(u.slug)+'</p>';
      c.onclick=function(){navigate(u.slug)};pk.appendChild(c);
    });
  });
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
        +'<div class="hdr-top">'
          +'<div class="hdr-controls">'
            +'<div class="hdr-date-etched">'+dateStr+'</div>'
            +'<button class="mode-toggle-btn" id="modeToggleBtn">'+(state.mode==='plan'?'◈ PLAN':'▶ EXECUTE')+'</button>'
            +'<div id="viewToggle" class="tile switch-tile">'
              +'<div id="toggleKnob" class="switch-knob '+(state.view==='current'?'active':'archived')+'"></div>'
              +'<span class="switch-label '+(state.view==='current'?'on':'')+'" title="Active">↑</span>'
              +'<span class="switch-label '+(state.view==='archived'?'on':'')+'" title="Archived">↓</span>'
            +'</div>'
            +'<button class="tile hdr-btn" id="addBtn" title="New Stone">+</button>'
            +'<button class="tile ai-btn" id="aiBtn">'+(state.mode==='plan'?'◈ Council':'✦ Oracle')+'</button>'
            +'<button class="tile hdr-btn" id="logoutBtn" title="Sign Out">⏻</button>'
          +'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;margin-top:30px;gap:20px;width:100%">'
          +'<div style="display:flex;justify-content:flex-end">'
            +'<input class="search" id="search" placeholder="Filter sanctuary..." autocomplete="off" style="width:100%;max-width:400px">'
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
    // Re-render header button label
    document.getElementById('modeToggleBtn').textContent = state.mode==='plan'?'◈ PLAN':'▶ EXECUTE';
  });

  document.getElementById('viewToggle').onclick = function(){
    state.view = state.view === 'current' ? 'archived' : 'current';
    loadBoard();
  };

  renderCards();
  updateStatusDots();
  if(state.selectedId) renderTree(state.selectedId);
}

function getTaskHue(t){
  if(t.archived) return '';
  var dp=daysFrom(t.plan_date), dd=daysFrom(t.due_date);
  if(dd <= 1) return 'canyon';
  if(dd <= 3) return 'amber';
  if(dd <= 7 || (dd < 999 && dp < 999 && dd - dp < 3)) return 'marble';
  return '';
}

function updateStatusDots(){
  var container = document.getElementById('statusDots'); if(!container) return;
  var activeTasks = state.tasks.filter(t => !t.archived);
  if(!activeTasks.length) { container.innerHTML = ''; return; }

  var counts = {canyon:0, amber:0, marble:0, dim:0};
  activeTasks.forEach(t => {
    var h = getTaskHue(t);
    if(h) counts[h]++;
    else counts.dim++;
  });

  var total = activeTasks.length;
  var dots = 20;
  var h = '';
  
  // Calculate how many dots for each color
  var types = ['canyon', 'amber', 'marble', 'dim'];
  var dotCounts = types.map(type => Math.round((counts[type]/total) * dots));
  
  // Adjust to exactly 20 dots due to rounding errors
  var currentTotal = dotCounts.reduce((a,b)=>a+b, 0);
  // Distribute difference into the largest group or dim
  if(currentTotal !== dots) {
    var diff = dots - currentTotal;
    dotCounts[3] += diff; // Adjust dim (most common)
  }

  // Build tooltip text
  var tipParts=[];
  if(counts.canyon) tipParts.push(counts.canyon+' canyon');
  if(counts.amber) tipParts.push(counts.amber+' amber');
  if(counts.marble) tipParts.push(counts.marble+' marble');
  if(counts.dim) tipParts.push(counts.dim+' clear');
  var tipText=tipParts.join(' · ')||'all clear';
  h += '<div class="status-tile"><span class="status-tile-tooltip">'+tipText+'</span>';
  types.forEach((type, idx) => {
    for(var i=0; i<dotCounts[idx]; i++) {
        h += '<div class="status-dot dot-'+type+'" title="'+type.toUpperCase()+'"></div>';
    }
  });
  h += '</div>';
  container.innerHTML = h;
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
      +'<button id="ms" class="btn-save" style="background:#ff8888;color:#000">Sign Out</button>'
    +'</div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){ location.href='/logout'; };
}

// ── Cards ─────────────────────────────────────────────────────

function makeCardEl(t, isList){
  var blocked=isBlocked(t), archived=!!t.archived;
  var dp=daysFrom(t.plan_date), dd=daysFrom(t.due_date);
  var dm=DM[t.domain]||{c:'#71717a',l:t.domain,m:''};

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
      : '<button class="cbtn act-archive" data-id="'+t.id+'" title="Archive / Done">×</button>')
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
  updateStatusDots();
}

function bindGlobalActionEvents(){
  var list = document.getElementById('cardList');
  list.onclick = function(e){
    var btn = e.target.closest('.cbtn'); if(!btn) return;
    e.stopPropagation();
    var id = +btn.dataset.id;
    if(id) {
        if(btn.classList.contains('act-edit')) openEdit(id);
        if(btn.classList.contains('act-archive')) api('PATCH','/api/tasks/'+id+'/archive').then(loadBoard);
        if(btn.classList.contains('act-restore')) api('PATCH','/api/tasks/'+id+'/unarchive').then(loadBoard);
    }
  };
}

function renderTree(id){
  var container=document.getElementById('treeContainer');if(!container)return;
  var task=state.taskById[id];if(!task)return;
  container.innerHTML='';

  // 1. Blockers
  var blockers = (task.needs||[]).map(nid => state.taskById[nid]).filter(Boolean);
  if(blockers.length){
    var s1=document.createElement('div'); s1.className='tree-section';
    s1.innerHTML='<div class="tree-label">Blocks this task</div>';
    blockers.forEach(t => s1.appendChild(makeCardEl(t, false)));
    container.appendChild(s1);
  }

  // 2. Focus
  var s2=document.createElement('div'); s2.className='tree-section';
  s2.innerHTML='<div class="tree-label">Active Focus</div>';
  var focusCard = makeCardEl(task, false);
  focusCard.style.transform = 'scale(1.1)';
  s2.appendChild(focusCard);
  container.appendChild(s2);

  // 3. Dependents
  var dependents = state.tasks.filter(t => (t.needs||[]).includes(task.id));
  var subtasks = (task.subs||[]).map(s => ({id:'s'+s.id, name:s.label, domain:task.domain, done:s.done, isSub:true, parentId: task.id}));
  if(dependents.length || subtasks.length){
    var s3=document.createElement('div'); s3.className='tree-section';
    s3.innerHTML='<div class="tree-label">Depends on this task</div>';
    dependents.forEach(t => s3.appendChild(makeCardEl(t, false)));
    subtasks.forEach(t => {
        var el=makeCardEl(t, false);
        el.style.opacity = '0.5';
        s3.appendChild(el);
    });
    container.appendChild(s3);
  }
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

function openAI(){
  var SUGG=['Prioritize my garden','Weekly critical path'];
  var m=document.getElementById('modal');
  m.innerHTML='<h2>✦ Oracle</h2>'
    +'<div class="ai-chips">'+SUGG.map(function(s){return'<span class="ai-chip">'+esc(s)+'</span>'}).join('')+'</div>'
    +'<div class="field"><label>Inquiry</label><textarea id="ai-q" rows="4" placeholder="Seek wisdom..."></textarea></div>'
    +'<div class="modal-actions">'
      +'<button id="mc" class="btn-cancel">Back</button>'
      +'<button class="btn-save" id="ms" style="background:var(--honey);color:#000">Ask Oracle</button>'
    +'</div>'
    +'<div class="ai-response" id="ai-resp" style="display:none"></div>';
  showModal();
  var qa=document.getElementById('ai-q');
  document.querySelectorAll('.ai-chip').forEach(function(c){c.onclick=function(){qa.value=this.textContent;qa.focus()}});
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){
    var q=qa.value.trim();if(!q)return;
    this.disabled=true;
    api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
      var el=document.getElementById('ai-resp');el.textContent=r.answer||r.error;el.style.display='block';
      document.getElementById('ms').disabled=false;
    });
  };
}


// ══════════════════════════════════════════════════
// COUNCIL CHAMBER
// ══════════════════════════════════════════════════
var COUNCIL_AGENTS = [
  { id:'strategist',   icon:'◈', label:'Strategist',    history:[] },
  { id:'risk_scout',   icon:'⚑', label:'Risk Scout',    history:[] },
  { id:'psychologist', icon:'⟡', label:'Psychologist',  history:[] },
  { id:'plan_oracle',  icon:'◎', label:'Plan Oracle',   history:[] }
];
var councilSessionId = null;
var councilTranscript = [];

var DOMAIN_EXPERT_LABELS = {
  CTI:'Threat Intel Analyst', ECM:'Enterprise Security Consultant',
  CSD:'Drone Systems Researcher', GRA:'Academic Research Advisor', Personal:'Life Coach'
};

function openCouncil(){
  // Create or reuse overlay
  var overlay = document.getElementById('councilOverlay');
  if(!overlay){ overlay = buildCouncilOverlay(); document.body.appendChild(overlay); }

  // 4th agent: Domain Expert when card focused, Plan Oracle for full sessions
  var focusTask = state.selectedId ? state.taskById[state.selectedId] : null;
  var fourthAgent = COUNCIL_AGENTS[3];
  if(focusTask){
    fourthAgent.id    = 'domain_expert';
    fourthAgent.icon  = '◉';
    fourthAgent.label = DOMAIN_EXPERT_LABELS[focusTask.domain] || 'Domain Expert';
  } else {
    fourthAgent.id    = 'plan_oracle';
    fourthAgent.icon  = '◎';
    fourthAgent.label = 'Plan Oracle';
  }
  // Update panel DOM to match
  var fourthPanel = overlay.querySelectorAll('.agent-panel')[3];
  if(fourthPanel){
    fourthPanel.dataset.agent = fourthAgent.id;
    fourthPanel.querySelector('.agent-icon').textContent  = fourthAgent.icon;
    fourthPanel.querySelector('.agent-name').textContent  = fourthAgent.label;
    fourthPanel.querySelector('.agent-input').placeholder = 'Reply to ' + fourthAgent.label + '...';
    fourthPanel.querySelector('.agent-send').dataset.agent = fourthAgent.id;
  }

  var ctxEl = overlay.querySelector('.council-context');
  if(ctxEl) ctxEl.textContent = focusTask
    ? ('Focus: ' + focusTask.name + ' · ' + focusTask.domain)
    : ('All Domains · ' + state.tasks.filter(t=>!t.archived).length + ' Active Tasks');

  overlay.classList.add('open');

  // Create plan session
  var sid = 'ps_' + Date.now() + '_' + (focusTask ? focusTask.domain : 'all');
  councilSessionId = sid;
  councilTranscript = [];
  // Reset agent histories
  COUNCIL_AGENTS.forEach(a => { a.history = []; });

  api('POST', '/api/plan-sessions', {
    id: sid,
    triggered: 'manual',
    domain: focusTask ? focusTask.domain : 'all',
    task_ids: focusTask ? [focusTask.id] : state.tasks.filter(t=>!t.archived).map(t=>t.id)
  });

  // Fire all 4 initial briefings in parallel
  var openingMsg = focusTask
    ? ('I am opening a council session focused on: "' + focusTask.name + '" in the ' + focusTask.domain + ' domain. Please give your initial assessment and what you want to flag.')
    : 'I am opening a council session to review my full task state. Please give your initial assessment and the most important thing you want me to consider.';

  COUNCIL_AGENTS.forEach(function(agent){
    var panel = overlay.querySelector('[data-agent="'+agent.id+'"]');
    setAgentThinking(panel, true);
    callAgent(agent.id, openingMsg, focusTask).then(function(resp){
      setAgentThinking(panel, false);
      panel.classList.add('ready');
      appendAgentMsg(panel, resp, 'from-agent');
      agent.history.push({ role:'user', text: openingMsg });
      agent.history.push({ role:'model', text: resp });
      logCouncilEvent(agent.id, 'message', resp);
    }).catch(function(e){
      setAgentThinking(panel, false);
      appendAgentMsg(panel, 'Error: ' + e.message, 'from-agent');
    });
  });
}

function closeCouncil(){
  var overlay = document.getElementById('councilOverlay');
  if(overlay) overlay.classList.remove('open');
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
    +'<div class="council-grid" id="councilGrid"></div>';

  // Build 4 agent panels
  var grid = el.querySelector('#councilGrid');
  COUNCIL_AGENTS.forEach(function(agent){
    var panel = document.createElement('div');
    panel.className = 'agent-panel';
    panel.dataset.agent = agent.id;
    panel.innerHTML =
      '<div class="agent-panel-header">'
        +'<span class="agent-icon">'+agent.icon+'</span>'
        +'<span class="agent-name">'+agent.label+'</span>'
        +'<div class="agent-spinner"></div>'
        +'<div class="agent-ready-dot"></div>'
      +'</div>'
      +'<div class="agent-feed" id="feed_'+agent.id+'"></div>'
      +'<div class="agent-input-row">'
        +'<input class="agent-input" id="inp_'+agent.id+'" placeholder="Reply to '+agent.label+'..." autocomplete="off">'
        +'<button class="agent-send" data-agent="'+agent.id+'">↑</button>'
      +'</div>';
    grid.appendChild(panel);

    // Bind send
    panel.querySelector('.agent-send').onclick = function(){
      sendToAgent(agent.id);
    };
    panel.querySelector('.agent-input').addEventListener('keydown', function(e){
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendToAgent(agent.id); }
    });
  });

  el.querySelector('#councilClose').onclick = closeCouncil;
  el.querySelector('#councilExtract').onclick = extractAndClose;

  return el;
}

function callAgent(agentId, message, focusTask){
  var agent = COUNCIL_AGENTS.find(a => a.id === agentId);
  return api('POST', '/api/council/invoke', {
    agent: agentId,
    message: message,
    history: agent ? agent.history.slice(-6) : [],  // keep last 3 turns
    focusTask: focusTask || (state.selectedId ? state.taskById[state.selectedId] : null)
  }).then(function(r){ return r.response || r.error || ''; });
}

function sendToAgent(agentId){
  var inp = document.getElementById('inp_'+agentId); if(!inp) return;
  var msg = inp.value.trim(); if(!msg) return;
  var agent = COUNCIL_AGENTS.find(a => a.id === agentId);
  var panel = document.querySelector('[data-agent="'+agentId+'"]');
  inp.value='';

  appendAgentMsg(panel, msg, 'from-user');
  logCouncilEvent('user', 'message', msg + ' [to:'+agentId+']');
  setAgentThinking(panel, true);

  callAgent(agentId, msg, null).then(function(resp){
    setAgentThinking(panel, false);
    appendAgentMsg(panel, resp, 'from-agent');
    agent.history.push({ role:'user', text:msg });
    agent.history.push({ role:'model', text:resp });
    logCouncilEvent(agentId, 'message', resp);
  }).catch(function(e){
    setAgentThinking(panel, false);
    appendAgentMsg(panel, 'Error: '+e.message, 'from-agent');
  });
}

function appendAgentMsg(panel, text, cls){
  var feed = panel.querySelector('.agent-feed'); if(!feed) return;
  // Remove typing indicator if present
  var typing = feed.querySelector('.agent-msg-typing');
  if(typing) typing.remove();
  var el = document.createElement('div');
  el.className = 'agent-msg ' + cls;
  el.textContent = text;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

function setAgentThinking(panel, thinking){
  if(!panel) return;
  var feed = panel.querySelector('.agent-feed');
  if(thinking){
    panel.classList.add('thinking');
    panel.classList.remove('ready');
    var typing = document.createElement('div');
    typing.className = 'agent-msg-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    feed.appendChild(typing);
    feed.scrollTop = feed.scrollHeight;
  } else {
    panel.classList.remove('thinking');
    var typing = feed.querySelector('.agent-msg-typing');
    if(typing) typing.remove();
  }
}

function logCouncilEvent(agent, eventType, content){
  if(!councilSessionId) return;
  councilTranscript.push({ agent:agent, type:eventType, content:content, ts:new Date().toISOString() });
  api('POST', '/api/plan-sessions/'+councilSessionId+'/events', {
    agent:agent, event_type:eventType, content:{ text:content }
  });
}

function extractAndClose(){
  var btn = document.getElementById('councilExtract');
  if(btn) btn.disabled = true;
  if(btn) btn.textContent = 'Extracting...';

  var transcript = councilTranscript.map(function(e){
    return '['+e.ts+'] ['+e.agent.toUpperCase()+'] '+e.content;
  }).join('\n');

  api('POST', '/api/council/extract', {
    sessionId: councilSessionId,
    transcript: transcript
  }).then(function(r){
    var overlay = document.getElementById('councilOverlay');
    var grid = document.getElementById('councilGrid');
    var ext = r.extracted || {};

    var resultEl = document.createElement('div');
    resultEl.className = 'extract-result';

    var html = '<div class="extract-section"><div class="extract-label">Session Summary</div>'
      +'<div class="extract-item">'+esc(ext.summary||'No summary generated.')+'</div></div>';

    if(ext.decisions && ext.decisions.length){
      html += '<div class="extract-section"><div class="extract-label">Decisions ('+ext.decisions.length+')</div>';
      ext.decisions.forEach(function(d){
        html += '<div class="extract-item"><strong>'+esc(d.type||'note')+'</strong>'
          +(d.task?' · '+esc(d.task):'')
          +' <span style="opacity:0.4;font-size:10px">['+esc(d.proposedBy||'')+ ']</span>'
          +'<br><span style="opacity:0.6;font-size:11px">'+esc(d.rationale||'')+'</span></div>';
      });
      html += '</div>';
    }

    if(ext.risks && ext.risks.length){
      html += '<div class="extract-section"><div class="extract-label">Risks Flagged</div>';
      ext.risks.forEach(function(r){
        var cls = r.severity==='high' ? 'extract-risk-high' : r.severity==='medium' ? 'extract-risk-medium' : '';
        html += '<div class="extract-item '+cls+'">'+esc(r.task||'')+(r.task?' — ':'')+ esc(r.risk||'')+'</div>';
      });
      html += '</div>';
    }

    if(ext.nextActions && ext.nextActions.length){
      html += '<div class="extract-section"><div class="extract-label">Next Actions</div>';
      ext.nextActions.forEach(function(a){
        html += '<div class="extract-item">→ '+esc(a)+'</div>';
      });
      html += '</div>';
    }

    html += '<div style="margin-top:32px;display:flex;gap:12px">'
      +'<button class="btn-cancel" onclick="document.querySelector(\'.extract-result\').remove();if(document.getElementById(\'councilExtract\')){document.getElementById(\'councilExtract\').disabled=false;document.getElementById(\'councilExtract\').textContent=\'Extract & Close\';}">Back to Council</button>'
      +'<button class="btn-save" onclick="closeCouncil();this.closest(\'.extract-result\').remove()">Done — Close Chamber</button>'
      +'</div>';

    resultEl.innerHTML = html;
    overlay.appendChild(resultEl);
  }).catch(function(e){
    if(btn){ btn.disabled=false; btn.textContent='Extract & Close'; }
    alert('Extraction failed: '+e.message);
  });
}

function showModal(){document.getElementById('modalBg').classList.add('show')}
function closeModal(){document.getElementById('modalBg').classList.remove('show')}
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
route();
