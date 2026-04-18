function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:'#8e9aaf',l:'CTI'},ECM:{c:'#cbc0d3',l:'ECM'},CSD:{c:'#efd3d7',l:'CSD'},GRA:{c:'#feeafa',l:'GRA'},Personal:{c:'#dee2ff',l:'Per'}};
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var DOMAINS=Object.keys(DM);

var state={slug:null,user:null,tasks:[],taskById:{},view:'current',searchQuery:'',selectedId:null};

function api(m,u,b){
  var o={method:m,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}};
  if(b)o.body=JSON.stringify(b);
  return fetch(u,o).then(function(r){if(r.status===401){location.href='/login';throw new Error('unauthorized')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){console.error('API:',m,u,e);throw e});
}

function daysFrom(ds){if(!ds)return 999;return Math.max(0,Math.round((new Date(ds+'T00:00:00')-TODAY)/864e5))}

function isBlocked(t){
  if(!t.needs||!t.needs.length)return false;
  for(var k=0;k<t.needs.length;k++){
    var d=state.taskById[t.needs[k]];if(!d)continue;
    if(!d.done)return true;
  }return false;
}

function matchSearch(t){
  if(!state.searchQuery)return true;var q=state.searchQuery.toLowerCase();
  return t.name.toLowerCase().includes(q)||t.domain.toLowerCase().includes(q);
}

function bufferDots(dp,dd){
  var n=Math.max(0,Math.min(5,dd-dp));
  return '·'.repeat(n);
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
      var c=document.createElement('div');c.style.cssText='display:inline-block;padding:40px;background:rgba(255,255,255,0.4);backdrop-filter:blur(20px);margin:20px;border-radius:32px;cursor:pointer;border:1px solid rgba(255,255,255,0.6)';
      c.innerHTML='<h2>'+esc(u.name)+'</h2><p>@'+esc(u.slug)+'</p>';
      c.onclick=function(){navigate(u.slug)};pk.appendChild(c);
    });
  });
}

function loadBoard(){
  var vp=state.view==='archived'?'?view=archived':'';
  api('GET','/api/users/'+state.slug+'/tasks'+vp).then(function(res){
    state.tasks=res.tasks;state.user=res.user;
    state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
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
            +'<button class="ai-btn" id="aiBtn">✦ Oracle</button>'
            +'<a class="hdr-btn" href="/logout">sign out</a>'
          +'</div>'
        +'</div>'
        +'<p class="hdr-date">'+dateStr+'</p>'
        +'<div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div class="toggle-wrap">'
            +'<button class="toggle-btn'+(state.view==='current'?' active':'')+'" data-view="current">active</button>'
            +'<button class="toggle-btn'+(state.view==='archived'?' active':'')+'" data-view="archived">archived</button>'
          +'</div>'
          +'<input class="search" id="search" placeholder="Search tasks..." autocomplete="off">'
        +'</div>'
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
    loadBoard();
  })});

  renderCards();
}

// ── Cards ─────────────────────────────────────────────────────

function makeCardEl(t, index){
  var blocked=isBlocked(t), done=!!t.done;
  var dp=daysFrom(t.plan_date), dd=daysFrom(t.due_date);

  var el=document.createElement('div');
  el.className='card'+(done?' done':'')+(blocked?' blocked':'')+(state.selectedId===t.id?' selected':'');
  el.dataset.id=t.id;

  var h='<div class="card-bar dm-'+t.domain+'"></div>';
  h+='<div class="card-index">'+(index<10?'0':'')+index+'</div>';
  h+='<div class="card-body">';
  
  h+='<div class="card-r1">';
  h+='<span class="card-domain">'+esc(t.domain)+'</span>';
  if(dp<999||dd<999){
    h+='<div class="card-urgency">';
    if(dp<999) h+='<span class="u-pill">T−'+dp+'</span>';
    if(dp<999&&dd<999&&dd>dp) h+='<span class="u-dots">'+bufferDots(dp,dd)+'</span>';
    if(dd<999) h+='<span class="u-pill">T−'+dd+'</span>';
    h+='</div>';
  }
  h+='</div>';

  h+='<div class="card-name">'+esc(t.name)+'</div>';

  if(t.isSub) h+='<div class="card-blocked" style="background:rgba(0,0,0,0.03);color:var(--faded);border:none">↳ subtask of '+esc(state.taskById[t.parentId]?.name || 'parent')+'</div>';
  else if(blocked) h+='<div class="card-blocked">needs: '+esc(getBlockerName(t))+'</div>';

  var dLabel=t.plan_label&&t.due_label&&t.plan_label!==t.due_label?t.plan_label+' → '+t.due_label:t.due_label||t.plan_label||'';
  if(dLabel) h+='<div class="card-date">'+esc(dLabel)+'</div>';
  
  h+='<div class="card-r-actions">'
    +'<button class="cbtn" data-edit="'+t.id+'">edit</button>'
    +'<button class="cbtn" data-archive="'+t.id+'">archive</button>'
  +'</div>';

  h+='</div>'; // card-body
  el.innerHTML=h;

  el.onclick=function(e){
    if(e.target.closest('button')) return;
    if(state.selectedId===t.id) openEdit(t.id);
    else {
      state.selectedId=t.id;
      document.querySelectorAll('.card').forEach(c=>c.classList.toggle('selected',c.dataset.id===String(t.id)));
    }
  };

  return el;
}

function getBlockerName(t){
  for(var k=0;k<(t.needs||[]).length;k++){
    var d=state.taskById[t.needs[k]];if(d&&!d.done)return d.name;
  }return'';
}

function renderCards(){
  var list=document.getElementById('cardList');if(!list)return;
  
  var flat=[];
  state.tasks.forEach(function(t){
    if(!matchSearch(t)) return;
    flat.push(t);
    if(t.subs&&t.subs.length){
      t.subs.forEach(function(s){
        flat.push({
          id: 's'+s.id,
          name: s.label,
          domain: t.domain,
          done: s.done,
          isSub: true,
          parentId: t.id
        });
      });
    }
  });

  if(!flat.length){list.innerHTML='<p style="text-align:center;padding:100px;opacity:0.5">Sanctuary is Empty</p>';return}
  list.innerHTML='';

  flat.forEach(function(t, i){
    list.appendChild(makeCardEl(t, i+1));
  });

  Sortable.create(list, {
    animation: 300,
    ghostClass: 'sortable-ghost',
    onEnd: function(){
      document.querySelectorAll('.card-index').forEach((el, idx)=>{
        var n = idx + 1;
        el.textContent = (n<10?'0':'') + n;
      });
    }
  });

  bindActionEvents();
}

function bindEvents(){ /* deprecated - using el.onclick */ }

function bindActionEvents(){
  document.querySelectorAll('[data-edit]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();openEdit(this.dataset.edit)})});
  document.querySelectorAll('[data-archive]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();api('PATCH','/api/tasks/'+this.dataset.archive+'/archive').then(loadBoard)})});
}

// ── Modals ────────────────────────────────────────────────────

function taskForm(t){
  var sel=DOMAINS.map(function(d){return'<option value="'+d+'"'+(t&&d===t.domain?' selected':'')+'>'+d+'</option>'}).join('');
  return '<div class="field"><label>Name</label><input id="f-name" value="'+esc(t?t.name:'')+'"></div>'
    +'<div class="field"><label>Domain</label><select id="f-domain">'+sel+'</select></div>'
    +'<div style="display:flex;gap:15px">'
      +'<div class="field" style="flex:1"><label>Start</label><input id="f-pd" type="date" value="'+esc(t&&t.plan_date?t.plan_date:'')+'"></div>'
      +'<div class="field" style="flex:1"><label>Due</label><input id="f-dd" type="date" value="'+esc(t&&t.due_date?t.due_date:'')+'"></div>'
    +'</div>'
    +'<div class="field"><label>Status</label><select id="f-done"><option value="0">Active</option><option value="1" '+(t&&t.done?'selected':'')+'>Done</option></select></div>';
}

function openEdit(id){
  if(String(id).startsWith('s')){ alert('Subtask editing simplified: promote to task to edit fully.'); return; }
  var t=state.taskById[id];if(!t)return;
  var m=document.getElementById('modal');
  m.innerHTML='<h2 style="margin-bottom:30px">Edit Task</h2>'+taskForm(t)
    +'<div class="modal-actions" style="display:flex;gap:15px;margin-top:30px"><button id="mc" class="cbtn" style="flex:1">Cancel</button><button class="ai-btn" id="ms" style="flex:1;background:var(--charcoal);color:#fff">Save</button></div>';
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
    api('PATCH','/api/tasks/'+id,d).then(function(){closeModal();loadBoard()});
  };
}

function openAddTask(){
  var m=document.getElementById('modal');
  m.innerHTML='<h2 style="margin-bottom:30px">New Task</h2>'+taskForm(null)
    +'<div class="modal-actions" style="display:flex;gap:15px;margin-top:30px"><button id="mc" class="cbtn" style="flex:1">Cancel</button><button class="ai-btn" id="ms" style="flex:1;background:var(--charcoal);color:#fff">Create</button></div>';
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
    api('POST','/api/users/'+state.slug+'/tasks',d).then(function(){closeModal();loadBoard()});
  };
}

function openAI(){
  var SUGG=['Prioritize my day','What is blocking me?','Weekly critical path'];
  var m=document.getElementById('modal');
  m.innerHTML='<h2>✦ Oracle</h2>'
    +'<div class="ai-chips">'+SUGG.map(function(s){return'<span class="ai-chip">'+esc(s)+'</span>'}).join('')+'</div>'
    +'<div class="field"><label>Question</label><textarea id="ai-q" rows="3" style="width:100%;border-radius:12px;padding:12px;border:1px solid rgba(0,0,0,0.1)"></textarea></div>'
    +'<div class="modal-actions" style="display:flex;gap:15px"><button id="mc" class="cbtn" style="flex:1">Back</button><button class="ai-btn" id="ms" style="flex:1;background:var(--charcoal);color:#fff">Ask</button></div>'
    +'<div class="ai-response" id="ai-resp" style="margin-top:20px;padding:20px;background:rgba(0,0,0,0.02);border-radius:16px;display:none;font-size:14px;line-height:1.6"></div>';
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
