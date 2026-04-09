function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:'#60a5fa',l:'CTI'},ECM:{c:'#c084fc',l:'ECM'},CSD:{c:'#5eead4',l:'CSD'},GRA:{c:'#7dd3fc',l:'GRA'},Personal:{c:'#a5b4fc',l:'Per'}};
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var DOMAINS=Object.keys(DM);

var state={slug:null,user:null,tasks:[],taskById:{},expanded:new Set(),view:'current',searchQuery:'',selectedId:null};

function api(m,u,b){
  var o={method:m,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}};
  if(b)o.body=JSON.stringify(b);
  return fetch(u,o).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){console.error('API:',m,u,e);throw e});
}

function daysFrom(ds){if(!ds)return 999;return Math.max(0,Math.round((new Date(ds+'T00:00:00')-TODAY)/864e5))}

function isBlocked(t){
  if(!t.needs||!t.needs.length)return false;
  for(var k=0;k<t.needs.length;k++){
    var d=state.taskById[t.needs[k]];if(!d)continue;
    if(d.subs&&d.subs.length){if(!d.subs.every(function(s){return s.done}))return true}
    else if(!d.done)return true;
  }return false;
}
function taskDone(t){
  if(t.subs&&t.subs.length)return t.subs.every(function(s){return s.done});
  return!!t.done;
}
function taskProgress(t){
  if(!t.subs||!t.subs.length)return t.done?1:0;
  return t.subs.filter(function(s){return s.done}).length/t.subs.length;
}
function getBlockerName(t){
  for(var k=0;k<(t.needs||[]).length;k++){
    var d=state.taskById[t.needs[k]];if(!d)continue;
    if(d.subs&&d.subs.length){if(!d.subs.every(function(s){return s.done}))return d.name}
    else if(!d.done)return d.name;
  }return'';
}
function matchSearch(t){
  if(!state.searchQuery)return true;var q=state.searchQuery.toLowerCase();
  return t.name.toLowerCase().includes(q)||t.domain.toLowerCase().includes(q)||(t.subs&&t.subs.some(function(s){return s.label.toLowerCase().includes(q)}));
}
function urgencyColor(d){
  if(d<=0)return'#b91c1c';if(d<=2)return'#c2410c';if(d<=5)return'#78350f';return'#27272a';
}
function bufferDots(dp,dd){var n=Math.max(0,Math.min(5,dd-dp));return'·'.repeat(n)}
function saveExpanded(){api('PUT','/api/users/'+state.slug+'/ui-state',{expanded:Array.from(state.expanded)})}

// ── Routing ───────────────────────────────────────────────────

function getSlug(){return location.pathname.replace(/^\//,'').replace(/\/$/,'')||null}
function navigate(s){history.pushState(null,'','/'+s);state.slug=s;loadBoard()}
window.addEventListener('popstate',route);
function route(){state.slug=getSlug();if(!state.slug)showPicker();else loadBoard()}

function showPicker(){
  document.getElementById('root').innerHTML='<div class="picker"><h1>organizer</h1></div>';
  api('GET','/api/users').then(function(d){
    var pk=document.querySelector('.picker');
    d.users.forEach(function(u){
      var c=document.createElement('div');c.className='picker-card';
      c.innerHTML='<h2></h2><p></p>';c.querySelector('h2').textContent=u.name;c.querySelector('p').textContent='@'+u.slug;
      c.onclick=function(){navigate(u.slug)};pk.appendChild(c);
    });
  });
}

function loadBoard(){
  var vp=state.view==='archived'?'?view=archived':'';
  Promise.all([api('GET','/api/users/'+state.slug+'/tasks'+vp),api('GET','/api/users/'+state.slug+'/ui-state')]).then(function(res){
    state.tasks=res[0].tasks;state.user=res[0].user;
    state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
    state.expanded=new Set();
    if(res[1].expanded)res[1].expanded.forEach(function(i){state.expanded.add(i)});
    renderApp();
  });
}

// ── Shell ─────────────────────────────────────────────────────

function renderApp(){
  var root=document.getElementById('root');
  var dateStr=TODAY.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'});
  root.innerHTML=
    '<div class="panel-list">'
      +'<div class="hdr">'
        +'<div class="hdr-top">'
          +'<a class="hdr-back" href="/" onclick="event.preventDefault();history.pushState(null,\'\',\'/\');route()">←</a>'
          +'<h1 id="hdrName"></h1>'
          +'<div class="hdr-nav">'
            +'<a class="hdr-btn" href="/timeline.html">Timeline</a>'
            +'<button class="ai-btn" id="aiBtn">✦ AI</button>'
          +'</div>'
        +'</div>'
        +'<p class="hdr-date">'+dateStr+'</p>'
        +'<div class="toggle-wrap">'
          +'<button class="toggle-btn'+(state.view==='current'?' active':'')+'" data-view="current">current</button>'
          +'<button class="toggle-btn'+(state.view==='archived'?' active':'')+'" data-view="archived">archived</button>'
        +'</div>'
        +'<input class="search" id="search" placeholder="Search..." autocomplete="off">'
      +'</div>'
      +'<div class="cards" id="cardScroll"><div class="cards-inner" id="cardList"></div></div>'
    +'</div>'
    +'<button class="fab" id="fab">+</button>';

  document.getElementById('hdrName').textContent=state.user?state.user.name:'';
  document.getElementById('search').addEventListener('input',function(){state.searchQuery=this.value;renderCards()});
  document.getElementById('fab').addEventListener('click',openAddTask);
  document.getElementById('aiBtn').addEventListener('click',openAI);

  document.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){
    var v=this.dataset.view;if(v===state.view)return;
    state.view=v;
    document.querySelectorAll('.toggle-btn').forEach(function(x){x.classList.toggle('active',x.dataset.view===v)});
    state.searchQuery='';document.getElementById('search').value='';
    api('GET','/api/users/'+state.slug+'/tasks'+(v==='archived'?'?view=archived':'')).then(function(r){
      state.tasks=r.tasks;state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
      renderCards();
    });
  })});

  renderCards();
}

// ── Cards ─────────────────────────────────────────────────────

function renderCards(){
  var list=document.getElementById('cardList');if(!list)return;
  var filtered=state.tasks.filter(matchSearch);
  if(!filtered.length){list.innerHTML='<p class="empty">'+(state.searchQuery?'No matches':'No tasks')+'</p>';return}
  list.innerHTML='';

  filtered.forEach(function(t){
    var dm=DM[t.domain]||{c:'#71717a',l:t.domain};
    var col=dm.c;
    var blocked=isBlocked(t),done=taskDone(t),prog=taskProgress(t);
    var dp=daysFrom(t.plan_date),dd=daysFrom(t.due_date);
    var hasSubs=!!(t.subs&&t.subs.length),isOpen=state.expanded.has(t.id);
    var dLabel=t.plan_label&&t.due_label&&t.plan_label!==t.due_label?t.plan_label+' → '+t.due_label:t.due_label||t.plan_label||'';

    var el=document.createElement('div');
    el.className='card'+(done?' done':'')+(state.selectedId===t.id?' selected':'');
    el.dataset.id=t.id;

    var h='';
    // Accent bar
    h+='<div class="card-bar" style="background:'+col+'"></div>';
    h+='<div class="card-body">';

    // R1: domain ←→ urgency pills (only shown if there's urgency info)
    var hasUrgency=dp<999||dd<999;
    h+='<div class="card-r1">';
    h+='<span class="card-domain" style="color:'+col+'">'+esc(dm.l)+'</span>';
    if(hasUrgency){
      h+='<div class="card-urgency">';
      if(dp<999)h+='<span class="u-pill" style="background:'+urgencyColor(dp)+'">T−'+dp+'</span>';
      if(dp<999&&dd<999&&dd>dp){var dots=bufferDots(dp,dd);if(dots)h+='<span class="u-dots">'+dots+'</span>'}
      if(dd<999)h+='<span class="u-pill" style="background:'+urgencyColor(dd)+'">T−'+dd+'</span>';
      h+='</div>';
    } else h+='<span></span>';
    h+='</div>';

    // Name
    h+='<div class="card-name">'+esc(t.name)+'</div>';

    // R3: attrs ←→ date label
    h+='<div class="card-r3">';
    h+='<div class="card-attrs">'
      +'<span class="attr attr-speed">'+SPEED_L[t.speed]+'</span>'
      +'<span class="attr attr-s'+t.stakes+'">'+STAKES_L[t.stakes]+'</span>'
      +(blocked?'<span class="attr" style="background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.2)">blocked</span>':'')
    +'</div>';
    h+='<span class="card-date">'+esc(dLabel)+'</span>';
    h+='</div>';

    // Blocker detail
    if(blocked)h+='<div class="card-blocked">needs: '+esc(getBlockerName(t))+'</div>';

    // Progress bar — only if in progress (0 < prog < 1)
    if(hasSubs&&prog>0&&prog<1)
      h+='<div class="card-progress"><div class="card-progress-fill" style="width:'+Math.round(prog*100)+'%;background:'+col+'"></div></div>';

    // Actions: edit + subtask (left) ←→ archive/restore (right)
    h+='<div class="card-r-actions"><div class="card-actions-l">'
      +'<button class="cbtn" data-edit="'+t.id+'">edit</button>'
      +(!hasSubs?'<button class="cbtn" data-addfirstsub="'+t.id+'">+ subtask</button>':'')
    +'</div>';
    if(t.archived)h+='<button class="cbtn cbtn-restore" data-unarchive="'+t.id+'">restore</button>';
    h+='<button class="cbtn cbtn-archive" data-archive="'+t.id+'">archive</button>';
    h+='</div>';

    // Subtasks (expanded)
    if(hasSubs&&isOpen){
      h+='<div class="card-subs">';
      t.subs.forEach(function(s){
        h+='<div class="sub'+(s.done?' done':'')+'" data-sid="'+s.id+'">'
          +'<div class="sub-check'+(s.done?' on':'')+'"></div>'
          +'<span class="sub-label">'+esc(s.label)+'</span>'
          +'<span class="sub-del" data-delsub="'+s.id+'">✕</span>'
        +'</div>';
      });
      h+='<div class="sub-add"><input placeholder="Add subtask..." data-addsub="'+t.id+'"><button data-addbtn="'+t.id+'">+</button></div>';
      h+='</div>';
    }

    h+='</div>'; // card-body
    el.innerHTML=h;
    list.appendChild(el);
  });

  bindEvents();
}

function selectTask(id){
  state.selectedId=id;
  document.querySelectorAll('.card').forEach(function(c){c.classList.toggle('selected',+c.dataset.id===id)});
}

function bindEvents(){
  document.querySelectorAll('.card').forEach(function(el){
    el.addEventListener('click',function(e){
      if(e.target.closest('[data-edit],[data-archive],[data-unarchive],[data-delsub],[data-addbtn],[data-addfirstsub],[data-sid],[data-addsub]'))return;
      var tid=+this.dataset.id,t=state.taskById[tid];
      selectTask(tid);
      if(t.subs&&t.subs.length){
        state.expanded.has(tid)?state.expanded.delete(tid):state.expanded.add(tid);
        saveExpanded();renderCards();selectTask(tid);
      } else {
        api('PATCH','/api/tasks/'+tid+'/toggle').then(function(r){t.done=r.done?1:0;renderCards()});
      }
    });
  });
  document.querySelectorAll('[data-sid]').forEach(function(el){
    el.addEventListener('click',function(e){
      e.stopPropagation();var sid=+this.dataset.sid;
      api('PATCH','/api/subtasks/'+sid+'/toggle').then(function(r){
        state.tasks.forEach(function(t){(t.subs||[]).forEach(function(s){if(s.id===sid)s.done=r.done?1:0})});
        renderCards();
      });
    });
  });
  document.querySelectorAll('[data-edit]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();openEdit(+this.dataset.edit)})});
  document.querySelectorAll('[data-archive]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('PATCH','/api/tasks/'+this.dataset.archive+'/archive').then(loadBoard)})});
  document.querySelectorAll('[data-unarchive]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('PATCH','/api/tasks/'+this.dataset.unarchive+'/unarchive').then(loadBoard)})});
  document.querySelectorAll('[data-delsub]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('DELETE','/api/subtasks/'+this.dataset.delsub).then(loadBoard)})});
  document.querySelectorAll('[data-addfirstsub]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();state.expanded.add(+this.dataset.addfirstsub);renderCards()})});
  document.querySelectorAll('[data-addbtn]').forEach(function(b){
    b.addEventListener('click',function(e){
      e.stopPropagation();var tid=this.dataset.addbtn,inp=document.querySelector('[data-addsub="'+tid+'"]');
      if(!inp||!inp.value.trim())return;
      api('POST','/api/tasks/'+tid+'/subtasks',{label:inp.value.trim()}).then(loadBoard);
    });
  });
  document.querySelectorAll('[data-addsub]').forEach(function(inp){
    inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();document.querySelector('[data-addbtn="'+this.dataset.addsub+'"]')?.click()}});
    inp.addEventListener('click',function(e){e.stopPropagation()});
  });
}

// ── Modals ────────────────────────────────────────────────────

function taskForm(t){
  var sel=DOMAINS.map(function(d){return'<option value="'+d+'"'+(t&&d===t.domain?' selected':'')+'>'+d+'</option>'}).join('');
  var spd=SPEED_L.map(function(s,i){return'<option value="'+i+'"'+(t&&i===t.speed?' selected':'')+'>'+s+'</option>'}).join('');
  var stk=STAKES_L.map(function(s,i){return'<option value="'+i+'"'+(t&&i===t.stakes?' selected':'')+'>'+s+'</option>'}).join('');
  return '<div class="field"><label>Name</label><input id="f-name" value="'+esc(t?t.name:'')+'" placeholder="Task name..."></div>'
    +'<div class="field"><label>Domain</label><select id="f-domain">'+sel+'</select></div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Plan date</label><input id="f-pd" type="date" value="'+esc(t&&t.plan_date?t.plan_date:'')+'"></div>'
      +'<div class="field" style="flex:1"><label>Due date</label><input id="f-dd" type="date" value="'+esc(t&&t.due_date?t.due_date:'')+'"></div>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Plan label</label><input id="f-pl" value="'+esc(t&&t.plan_label?t.plan_label:'')+'"></div>'
      +'<div class="field" style="flex:1"><label>Due label</label><input id="f-dl" value="'+esc(t&&t.due_label?t.due_label:'')+'"></div>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Speed</label><select id="f-spd">'+spd+'</select></div>'
      +'<div class="field" style="flex:1"><label>Stakes</label><select id="f-stk">'+stk+'</select></div>'
    +'</div>';
}
function formData(){
  return{name:document.getElementById('f-name').value.trim(),domain:document.getElementById('f-domain').value,
    plan_date:document.getElementById('f-pd').value||null,due_date:document.getElementById('f-dd').value||null,
    plan_label:document.getElementById('f-pl').value,due_label:document.getElementById('f-dl').value,
    speed:+document.getElementById('f-spd').value,stakes:+document.getElementById('f-stk').value};
}

function openEdit(id){
  var t=state.taskById[id];if(!t)return;
  var m=document.getElementById('modal');
  m.innerHTML='<h2>Edit</h2>'+taskForm(t)
    +'<div class="modal-actions"><button class="btn-cancel" id="mc">Cancel</button><button class="btn-save" id="ms">Save</button></div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){api('PATCH','/api/tasks/'+id,formData()).then(function(){closeModal();loadBoard()})};
}

function openAddTask(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2>New task</h2>'+taskForm(null)
    +'<div class="modal-actions"><button class="btn-cancel" id="mc">Cancel</button><button class="btn-save" id="ms">Create</button></div>';
  showModal();
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){
    var d=formData();if(!d.name)return;
    api('POST','/api/users/'+state.slug+'/tasks',d).then(function(){closeModal();loadBoard()});
  };
}

function openAI(){
  var SUGG=['What should I work on first today?','What is blocking my most critical tasks?','What is the critical path this week?','Which tasks are overdue or at risk?','Summarize my workload by domain'];
  var m=document.getElementById('modal');
  m.innerHTML='<h2>✦ Ask Gemini</h2>'
    +'<div class="ai-chips">'+SUGG.map(function(s){return'<span class="ai-chip">'+esc(s)+'</span>'}).join('')+'</div>'
    +'<div class="field"><label>Question</label><textarea id="ai-q" rows="3" placeholder="Ask anything about your tasks..."></textarea></div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="mc">Cancel</button><button class="btn-save" id="ms">Ask</button></div>'
    +'<div class="ai-loading" id="ai-load"><div class="ai-spinner"></div><span>Asking Gemini…</span></div>'
    +'<div class="ai-response" id="ai-resp"></div>'
    +'<div class="ai-meta" id="ai-meta"></div>';
  showModal();
  var qa=document.getElementById('ai-q');
  document.querySelectorAll('.ai-chip').forEach(function(c){c.onclick=function(){qa.value=this.textContent;qa.focus()}});
  document.getElementById('mc').onclick=closeModal;
  document.getElementById('ms').onclick=function(){
    var q=qa.value.trim();if(!q)return;
    this.disabled=true;
    document.getElementById('ai-load').classList.add('show');
    document.getElementById('ai-resp').classList.remove('show');
    document.getElementById('ai-meta').textContent='';
    api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
      document.getElementById('ai-load').classList.remove('show');
      var el=document.getElementById('ai-resp');el.textContent=r.answer||r.error||'No response';el.classList.add('show');
      if(r.model)document.getElementById('ai-meta').textContent='via '+r.model;
      document.getElementById('ms').disabled=false;
    }).catch(function(e){
      document.getElementById('ai-load').classList.remove('show');
      var el=document.getElementById('ai-resp');el.textContent='Error: '+e.message;el.classList.add('show');
      document.getElementById('ms').disabled=false;
    });
  };
}

function showModal(){document.getElementById('modalBg').classList.add('show')}
function closeModal(){document.getElementById('modalBg').classList.remove('show')}
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
route();
