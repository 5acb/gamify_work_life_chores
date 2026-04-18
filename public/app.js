function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:'#5E9C95',l:'CTI',m:'mat-teal'},ECM:{c:'#9b6a9b',l:'ECM',m:'mat-wood'},CSD:{c:'#3b6978',l:'CSD',m:'mat-cobalt'},GRA:{c:'#6b4e71',l:'GRA',m:'mat-purple'},Personal:{c:'#1f3b4d',l:'PER',m:'mat-indigo'}};
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var DOMAINS=Object.keys(DM);

var state={slug:null,user:null,tasks:[],taskById:{},view:'current',searchQuery:'',selectedId:null};

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

function renderApp(){
  var root=document.getElementById('root');
  var dateStr=TODAY.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'});
  root.innerHTML=
    '<div class="panel-tree" id="treePanel">'
      +'<div class="tree-container" id="treeContainer"></div>'
      +'<div class="user-identity">'
        +'<div class="tile identity-tile" id="userName"></div>'
      +'</div>'
    +'</div>'
    +'<div class="panel-list">'
      +'<div class="hdr">'
        +'<div class="hdr-top">'
          +'<div class="hdr-controls">'
            +'<div class="tile hdr-date-tile">'+dateStr+'</div>'
            +'<div id="viewToggle" class="tile switch-tile">'
              +'<div id="toggleKnob" class="switch-knob '+(state.view==='current'?'active':'archived')+'"></div>'
              +'<span class="switch-label '+(state.view==='current'?'on':'')+'" title="Active">↑</span>'
              +'<span class="switch-label '+(state.view==='archived'?'on':'')+'" title="Archived">↓</span>'
            +'</div>'
            +'<button class="tile hdr-btn" id="addBtn" title="New Stone">+</button>'
            +'<button class="tile ai-btn" id="aiBtn">✦ Oracle</button>'
            +'<button class="tile hdr-btn" id="logoutBtn" title="Sign Out">⏻</button>'
          +'</div>'
        +'</div>'
        +'<div style="display:flex;justify-content:flex-end;margin-top:15px;align-items:center;gap:12px">'
          +'<input class="search" id="search" placeholder="Filter sanctuary..." autocomplete="off" style="max-width:200px">'
          +'<div id="statusDots"></div>'
        +'</div>'
      +'</div>'
      +'<div class="cards" id="cardScroll"><div class="cards-inner" id="cardList"></div></div>'
    +'</div>';

  document.getElementById('userName').textContent=state.user?state.user.name.toUpperCase():'';
  document.getElementById('search').addEventListener('input',function(){state.searchQuery=this.value;renderCards()});
  document.getElementById('addBtn').addEventListener('click',openAddTask);
  document.getElementById('aiBtn').addEventListener('click',openAI);
  document.getElementById('logoutBtn').addEventListener('click',openLogoutConfirm);

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

  var counts = {canyon:0, amber:0, marble:0, bamboo:0};
  activeTasks.forEach(t => {
    var h = getTaskHue(t);
    if(h) counts[h]++;
  });

  var total = activeTasks.length;
  var dots = 20;
  var h = '';
  
  // Calculate how many dots for each color
  var types = ['canyon', 'amber', 'marble', 'bamboo'];
  var dotCounts = types.map(type => Math.round((counts[type]/total) * dots));
  
  // Adjust to exactly 20 dots due to rounding errors
  var currentTotal = dotCounts.reduce((a,b)=>a+b, 0);
  // Distribute difference into the largest group or bamboo
  if(currentTotal !== dots) {
    var diff = dots - currentTotal;
    dotCounts[3] += diff; // Adjust bamboo (most common)
  }

  h += '<div class="status-tile">';
  types.forEach((type, idx) => {
    for(var i=0; i<dotCounts[idx]; i++) {
        h += '<div class="status-dot dot-'+type+'" title="'+type.toUpperCase()+'"></div>';
    }
  });
  h += '</div>';
  container.innerHTML = h;
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
  el.className='card '+dm.m+' '+stateCls+' '+hueCls+(archived?' archived':'')+(blocked?' blocked':'')+(state.selectedId===t.id?' selected':'');
  el.dataset.id=t.id;

  var h='';
  // Dissolved Action Icons (absolute top left)
  h+='<div class="tile-actions" style="position:absolute; top:5px; left:5px; display:flex; gap:6px; z-index:10; align-items:center">'
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

  // Inline Date
  el.querySelector('.tile-date').onclick=function(e){
    e.stopPropagation();
    var tile=this;
    var current=t.due_date||new Date().toISOString().split('T')[0];
    tile.innerHTML='<input type="date" class="inline-edit" value="'+current+'">';
    var inp=tile.querySelector('input');
    inp.focus();
    inp.onchange=function(){ api('PATCH','/api/tasks/'+t.id,{due_date:this.value}).then(loadBoard); };
    inp.onblur=function(){ if(!this.value) loadBoard(); };
  };

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
      +'<div class="field-tile" style="flex:1"><label>Start</label><input id="f-pd" type="date" value="'+esc(t&&t.plan_date?t.plan_date:'')+'"></div>'
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
      +'<button id="mdel" class="btn-cancel" style="color:#ff8888">Shatter</button>'
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
    +'<div class="field"><label>Inquiry</label><textarea id="ai-q" rows="3" style="width:100%;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:15px;outline:none"></textarea></div>'
    +'<div class="modal-actions" style="display:flex;gap:15px"><button id="mc" class="btn-cancel" style="flex:1">Back</button><button class="ai-btn" id="ms" style="flex:1;background:var(--honey);color:#000">Ask</button></div>'
    +'<div class="ai-response" id="ai-resp" style="margin-top:20px;padding:20px;background:rgba(255,255,255,0.02);display:none;font-size:14px;line-height:1.6"></div>';
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

function showModal(){document.getElementById('modalBg').classList.add('show')}
function closeModal(){document.getElementById('modalBg').classList.remove('show')}
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
route();
