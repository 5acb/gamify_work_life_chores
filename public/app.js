function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:'#60a5fa',l:'CTI'},ECM:{c:'#c084fc',l:'ECM'},CSD:{c:'#5eead4',l:'CSD'},GRA:{c:'#7dd3fc',l:'GRA'},Personal:{c:'#a5b4fc',l:'Per'}};
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var URGENCY_C={hot:'#dc2626',warn:'#c2610f',notice:'#92400e',ok:'#3f3f46'};
var DOMAINS=Object.keys(DM);

var state={
  slug:null,user:null,tasks:[],taskById:{},expanded:new Set(),
  view:'current',searchQuery:'',selectedId:null,
};

function api(m,u,b){
  var o={method:m,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}};
  if(b)o.body=JSON.stringify(b);
  return fetch(u,o).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){console.error('API error:',m,u,e);throw e});
}

function daysFrom(ds){if(!ds)return 999;return Math.max(0,Math.round((new Date(ds+'T00:00:00')-TODAY)/864e5))}

function isBlocked(t){
  if(!t.needs||!t.needs.length)return false;
  for(var k=0;k<t.needs.length;k++){
    var dep=state.taskById[t.needs[k]];if(!dep)continue;
    if(dep.subs&&dep.subs.length){if(!dep.subs.every(function(s){return s.done}))return true}
    else{if(!dep.done)return true}
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
  if(!t.needs||!t.needs.length)return'';
  for(var k=0;k<t.needs.length;k++){
    var dep=state.taskById[t.needs[k]];if(!dep)continue;
    if(dep.subs&&dep.subs.length){if(!dep.subs.every(function(s){return s.done}))return dep.name}
    else{if(!dep.done)return dep.name}
  }return'';
}
function matchSearch(t){
  if(!state.searchQuery)return true;var q=state.searchQuery.toLowerCase();
  return t.name.toLowerCase().includes(q)||t.domain.toLowerCase().includes(q)||(t.subs&&t.subs.some(function(s){return s.label.toLowerCase().includes(q)}));
}
function urgencyColor(days){
  if(days<=0)return URGENCY_C.hot;if(days<=2)return URGENCY_C.warn;if(days<=5)return URGENCY_C.notice;return URGENCY_C.ok;
}
function bufferDots(dp,dd){var n=Math.max(0,Math.min(7,dd-dp));var d='';for(var i=0;i<n;i++)d+='·';return d}
function saveExpanded(){api('PUT','/api/users/'+state.slug+'/ui-state',{expanded:Array.from(state.expanded)})}

// ── Routing ────────────────────────────────────────────────────

function getSlug(){var p=location.pathname.replace(/^\//,'').replace(/\/$/,'');return p||null}
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

// ── App shell ──────────────────────────────────────────────────

function renderApp(){
  var root=document.getElementById('root');
  var dateStr=TODAY.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'});
  root.innerHTML=
    '<div class="panel-list">'
      +'<div class="hdr">'
        +'<div class="hdr-top">'
          +'<a class="hdr-back" href="/" onclick="event.preventDefault();history.pushState(null,\'\',\'/\');route()">←</a>'
          +'<h1 id="appUserName"></h1>'
          +'<div class="hdr-nav">'
            +'<a class="hdr-btn hdr-link" href="/timeline.html">◫ Timeline</a>'
            +'<button class="ai-btn" id="askAiBtn">✦ AI</button>'
          +'</div>'
        +'</div>'
        +'<p class="hdr-date">'+dateStr+'</p>'
        +'<div class="toggle-wrap">'
          +'<button class="toggle-btn'+(state.view==='current'?' active':'')+'" data-view="current">current</button>'
          +'<button class="toggle-btn'+(state.view==='archived'?' active':'')+'" data-view="archived">archived</button>'
        +'</div>'
        +'<input class="search" id="searchInput" placeholder="Search tasks..." autocomplete="off">'
      +'</div>'
      +'<div class="cards" id="cardScroll"><div class="cards-inner" id="cardList"></div></div>'
    +'</div>'
    +'<button class="fab" id="fabAdd">+</button>';

  document.getElementById('appUserName').textContent=state.user?state.user.name:'';
  document.getElementById('searchInput').addEventListener('input',function(){state.searchQuery=this.value;renderCards()});
  document.getElementById('fabAdd').addEventListener('click',openAddTask);
  document.getElementById('askAiBtn').addEventListener('click',openAIModal);

  document.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){
    var v=this.getAttribute('data-view');if(v===state.view)return;
    state.view=v;
    document.querySelectorAll('.toggle-btn').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-view')===v)});
    state.searchQuery='';var si=document.getElementById('searchInput');if(si)si.value='';
    api('GET','/api/users/'+state.slug+'/tasks'+(v==='archived'?'?view=archived':'')).then(function(res){
      state.tasks=res.tasks;state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
      renderCards();
    });
  })});

  renderCards();
}

// ── Cards ──────────────────────────────────────────────────────

function renderCards(){
  var list=document.getElementById('cardList');if(!list)return;
  var filtered=state.tasks.filter(matchSearch);
  if(!filtered.length){list.innerHTML='<p class="empty">'+(state.searchQuery?'No matches.':'No tasks yet.')+'</p>';return}
  list.innerHTML='';
  filtered.forEach(function(t,idx){
    var dm=DM[t.domain]||{c:'#71717a',l:t.domain};
    var col=dm.c,label=dm.l;
    var blocked=isBlocked(t),done=taskDone(t),prog=taskProgress(t);
    var dp=daysFrom(t.plan_date),dd=daysFrom(t.due_date);
    var hasSubs=t.subs&&t.subs.length>0,isOpen=state.expanded.has(t.id);

    var el=document.createElement('div');
    el.className='card'+(done?' alldone':'')+(state.selectedId===t.id?' selected':'');
    el.setAttribute('data-cardid',t.id);

    var html='<div class="card-accent" style="background:'+col+'"></div>';
    html+='<div class="card-content">';

    // Domain tag
    html+='<span class="card-tag" style="color:'+col+'">'+esc(label)+'</span>';

    // Name + blocked badge
    html+='<div class="card-name-row">'
      +'<div class="card-name">'+esc(t.name)+'</div>'
      +(blocked?'<span class="card-blocked-badge">blocked</span>':'')
    +'</div>';

    // Attrs: speed, stakes, date label
    var dLabel=t.plan_label&&t.due_label&&t.plan_label!==t.due_label?t.plan_label+' → '+t.due_label:t.due_label||t.plan_label||'';
    html+='<div class="card-attrs">'
      +'<span class="attr attr-speed">'+SPEED_L[t.speed]+'</span>'
      +'<span class="attr attr-stakes-'+t.stakes+'">'+STAKES_L[t.stakes]+'</span>'
      +(dLabel?'<span class="attr attr-date">'+esc(dLabel)+'</span>':'')
    +'</div>';

    // Urgency pills
    var hasUrgency=dp<999||dd<999;
    if(hasUrgency){
      html+='<div class="card-urgency">';
      if(dp<999)html+='<span class="urgency-pill" style="background:'+urgencyColor(dp)+'">T-'+dp+'</span>';
      if(dp<999&&dd<999&&dd>dp){var dots=bufferDots(dp,dd);if(dots)html+='<span class="urgency-dots">'+dots+'</span>'}
      if(dd<999)html+='<span class="urgency-pill" style="background:'+urgencyColor(dd)+'">T-'+dd+'</span>';
      html+='</div>';
    }

    // Blocker message
    if(blocked)html+='<div class="card-blocker-msg">⬡ needs: '+esc(getBlockerName(t))+'</div>';

    // Progress bar
    if(hasSubs)html+='<div class="card-progress"><div class="card-progress-fill" style="width:'+Math.round(prog*100)+'%;background:'+col+'"></div></div>';

    // Actions
    html+='<div class="card-actions">'
      +'<button class="card-btn" data-edit="'+t.id+'">edit</button>';
    if(!hasSubs)html+='<button class="card-btn" data-addfirstsub="'+t.id+'">+ subtask</button>';
    if(t.archived)html+='<button class="card-btn card-btn--restore" data-unarchive="'+t.id+'">restore</button>';
    else if(done)html+='<button class="card-btn card-btn--archive" data-archive="'+t.id+'">archive</button>';
    html+='</div>';

    // Subtasks (expanded)
    if(hasSubs&&isOpen){
      html+='<div class="card-subs">';
      t.subs.forEach(function(s){
        html+='<div class="c-sub'+(s.done?' subdone':'')+'" data-sid="'+s.id+'">'
          +'<div class="c-scheck'+(s.done?' on':'')+'"></div>'
          +'<span class="c-slabel">'+esc(s.label)+'</span>'
          +'<span class="c-sub-del" data-delsub="'+s.id+'">✕</span>'
        +'</div>';
      });
      html+='<div class="c-add-sub"><input placeholder="Add subtask..." data-addsub="'+t.id+'"><button data-addbtn="'+t.id+'">+</button></div>';
      html+='</div>';
    }

    html+='</div>'; // .card-content
    el.innerHTML=html;
    list.appendChild(el);
  });
  bindCardEvents();
}

function selectTask(id){
  state.selectedId=id;
  document.querySelectorAll('.card').forEach(function(c){c.classList.toggle('selected',parseInt(c.getAttribute('data-cardid'))===id)});
}

function bindCardEvents(){
  document.querySelectorAll('.card').forEach(function(el){el.addEventListener('click',function(e){
    if(e.target.closest('[data-sid]')||e.target.closest('[data-edit]')||e.target.closest('[data-archive]')||e.target.closest('[data-unarchive]')||e.target.closest('[data-delsub]')||e.target.closest('[data-addbtn]')||e.target.closest('[data-addfirstsub]')||e.target.closest('[data-addsub]'))return;
    var tid=parseInt(this.getAttribute('data-cardid')),t=state.taskById[tid];
    selectTask(tid);
    if(t.subs&&t.subs.length){
      state.expanded.has(tid)?state.expanded.delete(tid):state.expanded.add(tid);
      saveExpanded();renderCards();selectTask(tid);
    } else {
      api('PATCH','/api/tasks/'+tid+'/toggle').then(function(r){t.done=r.done?1:0;renderCards()});
    }
  })});
  document.querySelectorAll('[data-sid]').forEach(function(el){el.addEventListener('click',function(e){
    e.stopPropagation();var sid=parseInt(this.getAttribute('data-sid'));
    api('PATCH','/api/subtasks/'+sid+'/toggle').then(function(r){
      for(var i=0;i<state.tasks.length;i++){var subs=state.tasks[i].subs;if(!subs)continue;
        for(var j=0;j<subs.length;j++){if(subs[j].id===sid){subs[j].done=r.done?1:0;renderCards();return}}}
    });
  })});
  document.querySelectorAll('[data-edit]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();openEdit(parseInt(this.getAttribute('data-edit')))})});
  document.querySelectorAll('[data-archive]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('PATCH','/api/tasks/'+this.getAttribute('data-archive')+'/archive').then(function(){loadBoard()})})});
  document.querySelectorAll('[data-unarchive]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('PATCH','/api/tasks/'+this.getAttribute('data-unarchive')+'/unarchive').then(function(){loadBoard()})})});
  document.querySelectorAll('[data-delsub]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('DELETE','/api/subtasks/'+this.getAttribute('data-delsub')).then(function(){loadBoard()})})});
  document.querySelectorAll('[data-addbtn]').forEach(function(b){b.addEventListener('click',function(e){
    e.stopPropagation();var tid=this.getAttribute('data-addbtn'),inp=document.querySelector('[data-addsub="'+tid+'"]');
    if(!inp||!inp.value.trim())return;api('POST','/api/tasks/'+tid+'/subtasks',{label:inp.value.trim()}).then(function(){loadBoard()});
  })});
  document.querySelectorAll('[data-addsub]').forEach(function(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var b=document.querySelector('[data-addbtn="'+this.getAttribute('data-addsub')+'"]');if(b)b.click()}})});
  document.querySelectorAll('[data-addfirstsub]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();state.expanded.add(parseInt(this.getAttribute('data-addfirstsub')));renderCards()})});
}

// ── Modals ──────────────────────────────────────────────────────

function openEdit(id){
  var t=state.taskById[id];if(!t)return;var m=document.getElementById('modal');
  m.innerHTML='<h2>Edit task</h2>'
    +'<div class="field"><label>Name</label><input id="e-name"></div>'
    +'<div class="field"><label>Domain</label><select id="e-domain"></select></div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Plan date</label><input id="e-pdate" type="date"></div>'
      +'<div class="field" style="flex:1"><label>Due date</label><input id="e-ddate" type="date"></div>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Plan label</label><input id="e-plabel"></div>'
      +'<div class="field" style="flex:1"><label>Due label</label><input id="e-dlabel"></div>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Speed</label><select id="e-speed">'+SPEED_L.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div>'
      +'<div class="field" style="flex:1"><label>Stakes</label><select id="e-stakes">'+STAKES_L.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div>'
    +'</div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="e-cancel">Cancel</button><button class="btn-save" id="e-save">Save</button></div>';
  var sel=document.getElementById('e-domain');
  DOMAINS.forEach(function(d){var opt=document.createElement('option');opt.textContent=d;if(d===t.domain)opt.selected=true;sel.appendChild(opt)});
  document.getElementById('e-name').value=t.name;
  document.getElementById('e-pdate').value=t.plan_date||'';
  document.getElementById('e-ddate').value=t.due_date||'';
  document.getElementById('e-plabel').value=t.plan_label||'';
  document.getElementById('e-dlabel').value=t.due_label||'';
  document.getElementById('e-speed').value=t.speed;
  document.getElementById('e-stakes').value=t.stakes;
  document.getElementById('modalBg').classList.add('show');
  document.getElementById('e-cancel').onclick=closeModal;
  document.getElementById('e-save').onclick=function(){
    api('PATCH','/api/tasks/'+id,{name:document.getElementById('e-name').value,domain:document.getElementById('e-domain').value,plan_date:document.getElementById('e-pdate').value||null,due_date:document.getElementById('e-ddate').value||null,plan_label:document.getElementById('e-plabel').value,due_label:document.getElementById('e-dlabel').value,speed:parseInt(document.getElementById('e-speed').value),stakes:parseInt(document.getElementById('e-stakes').value)}).then(function(){closeModal();loadBoard()});
  };
}

function openAddTask(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2>New task</h2>'
    +'<div class="field"><label>Name</label><input id="e-name" placeholder="Task name..."></div>'
    +'<div class="field"><label>Domain</label><select id="e-domain"></select></div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Plan date</label><input id="e-pdate" type="date"></div>'
      +'<div class="field" style="flex:1"><label>Due date</label><input id="e-ddate" type="date"></div>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Plan label</label><input id="e-plabel" placeholder="e.g. Wed Apr 9"></div>'
      +'<div class="field" style="flex:1"><label>Due label</label><input id="e-dlabel" placeholder="e.g. Fri Apr 11"></div>'
    +'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<div class="field" style="flex:1"><label>Speed</label><select id="e-speed">'+SPEED_L.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div>'
      +'<div class="field" style="flex:1"><label>Stakes</label><select id="e-stakes">'+STAKES_L.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div>'
    +'</div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="e-cancel">Cancel</button><button class="btn-save" id="e-save">Create</button></div>';
  var sel=document.getElementById('e-domain');
  DOMAINS.forEach(function(d){var opt=document.createElement('option');opt.textContent=d;sel.appendChild(opt)});
  document.getElementById('modalBg').classList.add('show');
  document.getElementById('e-cancel').onclick=closeModal;
  document.getElementById('e-save').onclick=function(){
    var name=document.getElementById('e-name').value.trim();if(!name)return;
    api('POST','/api/users/'+state.slug+'/tasks',{name:name,domain:document.getElementById('e-domain').value,plan_date:document.getElementById('e-pdate').value||null,due_date:document.getElementById('e-ddate').value||null,plan_label:document.getElementById('e-plabel').value,due_label:document.getElementById('e-dlabel').value,speed:parseInt(document.getElementById('e-speed').value),stakes:parseInt(document.getElementById('e-stakes').value)}).then(function(){closeModal();loadBoard()});
  };
}

function openAIModal(){
  var SUGGESTIONS=['What should I work on first today?','What is blocking my most critical tasks?','What is the critical path this week?','Which tasks are overdue or at risk?','Summarize my workload by domain'];
  var m=document.getElementById('modal');
  m.innerHTML='<h2>✦ Ask Gemini</h2>'
    +'<div class="ai-chips">'+SUGGESTIONS.map(function(s){return'<span class="ai-chip">'+esc(s)+'</span>'}).join('')+'</div>'
    +'<div class="field"><label>Question</label><textarea id="ai-q" rows="3" placeholder="Ask anything about your tasks..."></textarea></div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="ai-cancel">Cancel</button><button class="btn-save" id="ai-submit">Ask</button></div>'
    +'<div class="ai-loading" id="ai-loading"><div class="ai-spinner"></div><span>Asking Gemini…</span></div>'
    +'<div class="ai-response" id="ai-response"></div>'
    +'<div class="ai-meta" id="ai-meta"></div>';
  document.getElementById('modalBg').classList.add('show');
  var qa=document.getElementById('ai-q');
  document.querySelectorAll('.ai-chip').forEach(function(chip){chip.addEventListener('click',function(){qa.value=this.textContent;qa.focus()})});
  document.getElementById('ai-cancel').onclick=closeModal;
  document.getElementById('ai-submit').addEventListener('click',function(){
    var q=(qa.value||'').trim();if(!q)return;
    this.disabled=true;
    document.getElementById('ai-loading').classList.add('show');
    document.getElementById('ai-response').classList.remove('show');
    document.getElementById('ai-meta').textContent='';
    api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
      document.getElementById('ai-loading').classList.remove('show');
      var resp=document.getElementById('ai-response');resp.textContent=r.answer||r.error||'No response';resp.classList.add('show');
      if(r.model)document.getElementById('ai-meta').textContent='via '+r.model;
      document.getElementById('ai-submit').disabled=false;
    }).catch(function(e){
      document.getElementById('ai-loading').classList.remove('show');
      var resp=document.getElementById('ai-response');resp.textContent='Error: '+e.message;resp.classList.add('show');
      document.getElementById('ai-submit').disabled=false;
    });
  });
}

function closeModal(){document.getElementById('modalBg').classList.remove('show')}
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
route();
