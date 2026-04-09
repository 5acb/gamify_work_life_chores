function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DM={CTI:{c:'#60a5fa',l:'CTI'},ECM:{c:'#c084fc',l:'ECM'},CSD:{c:'#5eead4',l:'CSD'},GRA:{c:'#7dd3fc',l:'GRA'},Personal:{c:'#a5b4fc',l:'Per'}};
var SPEED_L=['snap','sesh','grind'],STAKES_L=['low','high','crit'];
var URGENCY_C={hot:'#dc2626',warn:'#c2610f',notice:'#92400e',ok:'#3f3f46'};
var DOMAINS=Object.keys(DM);

var state={
  slug:null,user:null,tasks:[],taskById:{},expanded:new Set(),
  view:'current',searchQuery:'',selectedId:null,
  showTree:false,
  mobileTab:'list',
  treePos:null,
  tree:{x:0,y:0,scale:1,dragging:false,didDrag:false,dragStart:{x:0,y:0},pinchDist:null,pinchScale:1,pinchMid:{x:0,y:0}}
};

function isMobile(){return window.innerWidth<=768}

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
  if(isBlocked(t))return false;
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

// ── Tree overlay ───────────────────────────────────────────────

function openTree(){
  state.showTree=true;state.treePos=null;
  var o=document.getElementById('treeOverlay');if(o)o.classList.add('show');
  requestAnimationFrame(function(){setTimeout(renderTree,40)});
  if(isMobile()){state.mobileTab='tree';updateMobileTabs()}
}
function closeTree(){
  state.showTree=false;
  var o=document.getElementById('treeOverlay');if(o)o.classList.remove('show');
  if(isMobile()){state.mobileTab='list';updateMobileTabs()}
}
function updateMobileTabs(){
  document.querySelectorAll('.m-tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===state.mobileTab)});
}

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
    state.treePos=null;
    renderApp();
  });
}

// ── App shell ──────────────────────────────────────────────────

function renderApp(){
  var root=document.getElementById('root');
  var dateStr=TODAY.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'});
  root.innerHTML=
    '<div class="panel-list" id="panelList">'
      +'<div class="hdr">'
        +'<div class="hdr-top">'
          +'<a class="hdr-back" href="/" onclick="event.preventDefault();history.pushState(null,\'\',\'/\');route()">←</a>'
          +'<h1 id="appUserName"></h1>'
          +'<div class="hdr-nav">'
            +'<button class="hdr-btn" id="treeToggleBtn">◈ Tree</button>'
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

    // Tree overlay (shared between desktop and mobile)
    +'<div class="tree-overlay'+(state.showTree?' show':'')+'" id="treeOverlay">'
      +'<div class="tree-overlay-bar">'
        +'<h2>Dependency Tree</h2>'
        +'<button class="tree-overlay-close" id="treeCloseBtn">✕ Close</button>'
      +'</div>'
      +'<div class="panel-tree" id="treePanel"></div>'
    +'</div>'

    // Tooltip
    +'<div id="tooltip"></div>'

    // FAB
    +'<button class="fab" id="fabAdd">+</button>'

    // Mobile tabs (Tasks | Tree)
    +'<div class="m-tabs" id="mTabs">'
      +'<button class="m-tab'+(state.mobileTab==='list'?' active':'')+'" data-tab="list">☰ Tasks</button>'
      +'<button class="m-tab'+(state.mobileTab==='tree'?' active':'')+'" data-tab="tree">◈ Tree</button>'
    +'</div>';

  // Bind header controls
  var userNameEl=document.getElementById('appUserName');if(userNameEl&&state.user)userNameEl.textContent=state.user.name;
  document.getElementById('searchInput').addEventListener('input',function(){state.searchQuery=this.value;renderCards()});
  document.getElementById('fabAdd').addEventListener('click',openAddTask);
  document.getElementById('treeToggleBtn').addEventListener('click',openTree);
  document.getElementById('treeCloseBtn').addEventListener('click',closeTree);
  document.getElementById('askAiBtn').addEventListener('click',openAIModal);

  // View toggle
  document.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){
    var v=this.getAttribute('data-view');if(v===state.view)return;
    state.view=v;
    document.querySelectorAll('.toggle-btn').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-view')===v)});
    state.searchQuery='';var si=document.getElementById('searchInput');if(si)si.value='';
    api('GET','/api/users/'+state.slug+'/tasks'+(v==='archived'?'?view=archived':'')).then(function(res){
      state.tasks=res.tasks;state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
      state.treePos=null;renderCards();
      if(state.showTree){state.treePos=null;renderTree()}
    });
  })});

  // Mobile tabs
  document.querySelectorAll('.m-tab').forEach(function(b){b.addEventListener('click',function(){
    var tab=this.dataset.tab;state.mobileTab=tab;updateMobileTabs();
    if(tab==='tree')openTree();else closeTree();
  })});

  bindTreePanZoom(document.getElementById('treePanel'));
  renderCards();
  if(state.showTree)requestAnimationFrame(function(){setTimeout(renderTree,50)});
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
    el.className='card'+(done?' alldone':'')+(blocked?' blocked-card':'')+(state.selectedId===t.id?' selected':'');
    el.setAttribute('data-cardid',t.id);

    // — Accent stripe
    var html='<div class="card-accent" style="background:'+col+'"></div>';

    // — Content
    html+='<div class="card-content">';

    // Row 1: title
    html+='<div class="card-top">'
      +'<span class="card-num">'+(idx+1)+'</span>'
      +'<div class="card-title-block">'
        +'<span class="card-tag" style="color:'+col+'">'+esc(label)+'</span>'
        +'<div class="card-name">'+esc(t.name)+'</div>'
      +'</div>'
      +(blocked?'<span class="card-blocked-badge">blocked</span>':'')
    +'</div>';

    // Row 2: attrs
    html+='<div class="card-attrs">'
      +'<span class="attr attr-speed">'+SPEED_L[t.speed]+'</span>'
      +'<span class="attr attr-stakes-'+t.stakes+'">'+STAKES_L[t.stakes]+'</span>';
    var dLabel=t.plan_label&&t.due_label&&t.plan_label!==t.due_label?t.plan_label+' → '+t.due_label:t.due_label||t.plan_label||'';
    if(dLabel)html+='<span class="attr attr-date">'+esc(dLabel)+'</span>';
    html+='</div>';

    // Row 3: urgency pills
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

    // Subtasks (when expanded)
    if(hasSubs&&isOpen){
      html+='<div class="card-subs">';
      t.subs.forEach(function(s){
        html+='<div class="c-sub'+(s.done?' subdone':'')+'" data-sid="'+s.id+'">'
          +'<div class="c-scheck'+(s.done?' on':'')+'"></div>'
          +'<span class="c-slabel">'+esc(s.label)+'</span>'
          +'<span class="c-sub-del" data-delsub="'+s.id+'">&#10005;</span>'
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
  document.querySelectorAll('.tree-node').forEach(function(n){n.querySelector('.node-ring').style.strokeWidth=parseInt(n.getAttribute('data-nid'))===id?'3.5':'1.5'});
  var card=document.querySelector('[data-cardid="'+id+'"]');
  if(card)card.scrollIntoView({behavior:'smooth',block:'nearest'});
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
      api('PATCH','/api/tasks/'+tid+'/toggle').then(function(r){t.done=r.done?1:0;renderCards();if(state.showTree)renderTree()});
    }
  })});
  document.querySelectorAll('[data-sid]').forEach(function(el){el.addEventListener('click',function(e){
    e.stopPropagation();var sid=parseInt(this.getAttribute('data-sid'));
    api('PATCH','/api/subtasks/'+sid+'/toggle').then(function(r){
      for(var i=0;i<state.tasks.length;i++){var subs=state.tasks[i].subs;if(!subs)continue;
        for(var j=0;j<subs.length;j++){if(subs[j].id===sid){subs[j].done=r.done?1:0;renderCards();if(state.showTree)renderTree();return}}}
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

// ── Force layout ───────────────────────────────────────────────

function forceLayout(tasks,W,H){
  if(!tasks.length)return{};
  var cx=W/2,cy=H/2,pos={},vel={};
  var grouped={};DOMAINS.forEach(function(d){grouped[d]=[]});
  tasks.forEach(function(t){if(grouped[t.domain])grouped[t.domain].push(t)});
  var active=DOMAINS.filter(function(d){return grouped[d].length>0});
  var anchors={};
  active.forEach(function(d,i){
    var a=(i/active.length)*Math.PI*2-Math.PI/2,r=Math.min(W,H)*0.22;
    anchors[d]={x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};
  });
  tasks.forEach(function(t){
    var anc=anchors[t.domain]||{x:cx,y:cy},seed=(t.id*2654435761)&0xFFFFFF;
    pos[t.id]={x:anc.x+((seed&0xFF)-128)*0.6,y:anc.y+(((seed>>8)&0xFF)-128)*0.6};
    vel[t.id]={x:0,y:0};
  });
  var edges=[];
  tasks.forEach(function(t){if(!t.needs)return;t.needs.forEach(function(bid){if(pos[bid]!==undefined)edges.push([bid,t.id])})});
  var K_REP=3800,K_SPR=0.042,L=85,DAMP=0.72,GRAV=0.018,CLU=0.028,margin=55;
  for(var iter=0;iter<300;iter++){
    var fx={},fy={};tasks.forEach(function(t){fx[t.id]=0;fy[t.id]=0});
    for(var a=0;a<tasks.length;a++){for(var b=a+1;b<tasks.length;b++){
      var ta=tasks[a],tb=tasks[b],dx=pos[ta.id].x-pos[tb.id].x,dy=pos[ta.id].y-pos[tb.id].y;
      var d2=dx*dx+dy*dy+1,d=Math.sqrt(d2),f=K_REP/d2,nx=dx/d*f,ny=dy/d*f;
      fx[ta.id]+=nx;fy[ta.id]+=ny;fx[tb.id]-=nx;fy[tb.id]-=ny;
    }}
    edges.forEach(function(e){
      var pa=pos[e[0]],pb=pos[e[1]];if(!pa||!pb)return;
      var dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.sqrt(dx*dx+dy*dy)||1;
      var f=(d-L)*K_SPR,nx=dx/d*f,ny=dy/d*f;
      fx[e[0]]+=nx;fy[e[0]]+=ny;fx[e[1]]-=nx;fy[e[1]]-=ny;
    });
    tasks.forEach(function(t){
      fx[t.id]+=(cx-pos[t.id].x)*GRAV;fy[t.id]+=(cy-pos[t.id].y)*GRAV;
      var anc=anchors[t.domain];
      if(anc){fx[t.id]+=(anc.x-pos[t.id].x)*CLU;fy[t.id]+=(anc.y-pos[t.id].y)*CLU}
      vel[t.id].x=(vel[t.id].x+fx[t.id])*DAMP;vel[t.id].y=(vel[t.id].y+fy[t.id])*DAMP;
      pos[t.id].x=Math.max(margin,Math.min(W-margin,pos[t.id].x+vel[t.id].x));
      pos[t.id].y=Math.max(margin,Math.min(H-margin,pos[t.id].y+vel[t.id].y));
    });
  }
  return pos;
}

// ── Pan/zoom ───────────────────────────────────────────────────

function applyTreeTransform(){
  var vp=document.getElementById('tree-vp');
  if(vp)vp.setAttribute('transform','translate('+state.tree.x+','+state.tree.y+') scale('+state.tree.scale+')');
}

function bindTreePanZoom(panel){
  if(!panel)return;
  panel.addEventListener('wheel',function(e){
    e.preventDefault();
    var rect=panel.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var delta=e.deltaY>0?0.9:1.1,ns=Math.max(0.2,Math.min(5,state.tree.scale*delta));
    state.tree.x=mx-(mx-state.tree.x)*(ns/state.tree.scale);
    state.tree.y=my-(my-state.tree.y)*(ns/state.tree.scale);
    state.tree.scale=ns;applyTreeTransform();
  },{passive:false});
  panel.addEventListener('mousedown',function(e){state.tree.dragging=true;state.tree.didDrag=false;state.tree.dragStart={x:e.clientX-state.tree.x,y:e.clientY-state.tree.y}});
  panel.addEventListener('mousemove',function(e){
    if(!state.tree.dragging)return;
    var dx=e.clientX-(state.tree.dragStart.x+state.tree.x),dy=e.clientY-(state.tree.dragStart.y+state.tree.y);
    if(Math.abs(dx)+Math.abs(dy)>4)state.tree.didDrag=true;
    if(!state.tree.didDrag)return;
    state.tree.x=e.clientX-state.tree.dragStart.x;state.tree.y=e.clientY-state.tree.dragStart.y;
    applyTreeTransform();panel.classList.add('grabbing');
  });
  panel.addEventListener('mouseup',function(){state.tree.dragging=false;panel.classList.remove('grabbing')});
  panel.addEventListener('mouseleave',function(){state.tree.dragging=false;panel.classList.remove('grabbing')});
  panel.addEventListener('touchstart',function(e){
    state.tree.didDrag=false;
    if(e.touches.length===1){state.tree.dragging=true;state.tree.dragStart={x:e.touches[0].clientX-state.tree.x,y:e.touches[0].clientY-state.tree.y}}
    else if(e.touches.length===2){
      state.tree.dragging=false;
      state.tree.pinchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      state.tree.pinchScale=state.tree.scale;
      var rect=panel.getBoundingClientRect();
      state.tree.pinchMid={x:(e.touches[0].clientX+e.touches[1].clientX)/2-rect.left,y:(e.touches[0].clientY+e.touches[1].clientY)/2-rect.top};
    }
  },{passive:true});
  panel.addEventListener('touchmove',function(e){
    e.preventDefault();
    if(e.touches.length===1&&state.tree.dragging){
      var dx=e.touches[0].clientX-(state.tree.dragStart.x+state.tree.x),dy=e.touches[0].clientY-(state.tree.dragStart.y+state.tree.y);
      if(Math.abs(dx)+Math.abs(dy)>6)state.tree.didDrag=true;
      if(!state.tree.didDrag)return;
      state.tree.x=e.touches[0].clientX-state.tree.dragStart.x;state.tree.y=e.touches[0].clientY-state.tree.dragStart.y;
      applyTreeTransform();
    } else if(e.touches.length===2&&state.tree.pinchDist){
      var dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      var ns=Math.max(0.2,Math.min(5,state.tree.pinchScale*(dist/state.tree.pinchDist)));
      var mx=state.tree.pinchMid.x,my=state.tree.pinchMid.y;
      state.tree.x=mx-(mx-state.tree.x)*(ns/state.tree.scale);state.tree.y=my-(my-state.tree.y)*(ns/state.tree.scale);
      state.tree.scale=ns;applyTreeTransform();
    }
  },{passive:false});
  panel.addEventListener('touchend',function(e){
    if(e.touches.length===0){state.tree.dragging=false;state.tree.pinchDist=null}
    else if(e.touches.length===1){state.tree.pinchDist=null}
  },{passive:true});
}

// ── Skill tree ─────────────────────────────────────────────────

function renderTree(){
  var panel=document.getElementById('treePanel');if(!panel)return;
  var W=panel.clientWidth,H=panel.clientHeight;if(W<10||H<10)return;
  if(!state.treePos)state.treePos=forceLayout(state.tasks,W,H);
  var pos=state.treePos,mob=isMobile(),R=mob?14:11;
  var s='<svg class="tree-svg" id="tree-svg" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg"><defs>';
  DOMAINS.forEach(function(d){var c=DM[d].c;s+='<filter id="g-'+d+'" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feFlood flood-color="'+c+'" flood-opacity="0.55"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>'});
  s+='<filter id="g-dim" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" result="b"/><feFlood flood-color="#fff" flood-opacity="0.1"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  s+='<filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  for(var gi=0;gi<W;gi+=40)s+='<line x1="'+gi+'" y1="0" x2="'+gi+'" y2="'+H+'" stroke="rgba(255,255,255,0.015)" stroke-width="0.5"/>';
  for(var gj=0;gj<H;gj+=40)s+='<line x1="0" y1="'+gj+'" x2="'+W+'" y2="'+gj+'" stroke="rgba(255,255,255,0.015)" stroke-width="0.5"/>';
  s+='<g id="tree-vp" transform="translate('+state.tree.x+','+state.tree.y+') scale('+state.tree.scale+')">';
  state.tasks.forEach(function(t){
    if(!t.needs)return;
    t.needs.forEach(function(bid){
      var f=pos[bid],to=pos[t.id];if(!f||!to)return;
      var srcT=state.taskById[bid],srcDone=srcT?taskDone(srcT):false;
      var col=srcDone?(DM[srcT.domain]||{c:'#333'}).c:'#2c2c38',op=srcDone?0.85:0.45,w=srcDone?2.5:1.5;
      var mx=(f.x+to.x)/2,my=(f.y+to.y)/2;
      s+='<line x1="'+f.x+'" y1="'+f.y+'" x2="'+to.x+'" y2="'+to.y+'" stroke="'+col+'" stroke-width="'+w+'" opacity="'+op+'" filter="url(#edge-glow)"/>';
      s+='<circle cx="'+mx+'" cy="'+my+'" r="1.5" fill="'+col+'" opacity="'+op+'"/>';
    });
  });
  state.tasks.forEach(function(t,idx){
    var p=pos[t.id];if(!p)return;
    var col=(DM[t.domain]||{c:'#71717a'}).c,done=taskDone(t),blocked=isBlocked(t),active=!done&&!blocked;
    var prog=taskProgress(t),selected=state.selectedId===t.id,hasSubs=t.subs&&t.subs.length>0;
    var filter=done||active?'filter="url(#g-'+t.domain+')"':'filter="url(#g-dim)"';
    var nodeOp=done?0.4:blocked?0.5:1,fillOp=done?0.85:blocked?0.08:0.16,strokeOp=done?1:blocked?0.3:0.9,sw=selected?3.5:1.5;
    s+='<g class="tree-node" data-nid="'+t.id+'" '+filter+' opacity="'+nodeOp+'">';
    if(active){var begin=((idx*0.41)%2.8).toFixed(2);s+='<circle cx="'+p.x+'" cy="'+p.y+'" r="'+R+'" fill="none" stroke="'+col+'" stroke-width="1.5" opacity="0"><animate attributeName="r" values="'+R+';'+(R+10)+';'+R+'" dur="2.8s" begin="'+begin+'s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0;0.7" dur="2.8s" begin="'+begin+'s" repeatCount="indefinite"/></circle>'}
    s+='<circle class="node-ring" cx="'+p.x+'" cy="'+p.y+'" r="'+R+'" fill="'+col+'" fill-opacity="'+fillOp+'" stroke="'+col+'" stroke-width="'+sw+'" stroke-opacity="'+strokeOp+'"/>';
    if(prog>0&&prog<1&&!done){var sa=-Math.PI/2,ea=sa+prog*Math.PI*2,ir=R+4;var ax1=p.x+Math.cos(sa)*ir,ay1=p.y+Math.sin(sa)*ir,ax2=p.x+Math.cos(ea)*ir,ay2=p.y+Math.sin(ea)*ir,lrg=prog>0.5?1:0;s+='<path d="M '+ax1+' '+ay1+' A '+ir+' '+ir+' 0 '+lrg+' 1 '+ax2+' '+ay2+'" fill="none" stroke="'+col+'" stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>'}
    if(done)s+='<text x="'+p.x+'" y="'+(p.y+1)+'" fill="#fff" font-size="'+(mob?12:10)+'" text-anchor="middle" dominant-baseline="central" font-weight="700">✓</text>';
    var lbl=t.name.length>14?t.name.substring(0,13)+'…':t.name;
    s+='<text x="'+p.x+'" y="'+(p.y+R+13)+'" fill="'+(done?col:'#aaa')+'" font-size="'+(mob?9:8)+'" font-weight="600" text-anchor="middle" opacity="'+(done?0.45:blocked?0.5:0.9)+'">'+esc(lbl)+'</text>';
    if(active&&!hasSubs){var br=mob?10:6.5,bx=p.x+R*0.7,by=p.y-R*0.7;s+='<g class="tree-node-check" data-checkid="'+t.id+'" opacity="'+(mob?0.7:0.55)+'" style="cursor:pointer"><circle cx="'+bx+'" cy="'+by+'" r="'+br+'" fill="#16161e" stroke="'+col+'" stroke-width="1.5"/><text x="'+bx+'" y="'+(by+1)+'" fill="'+col+'" font-size="'+(mob?11:8)+'" font-weight="800" text-anchor="middle" dominant-baseline="central">✓</text></g>'}
    s+='</g>';
  });
  s+='</g></svg>';
  var activeDomains=DOMAINS.filter(function(d){return state.tasks.some(function(t){return t.domain===d})});
  panel.innerHTML=s+'<div class="tree-legend"></div><button class="tree-reset" id="treeReset">⊙ reset</button>';
  var leg=panel.querySelector('.tree-legend');
  activeDomains.forEach(function(d){
    var item=document.createElement('div');item.className='tree-legend-item';
    var dot=document.createElement('span');dot.className='tree-legend-dot';dot.style.background=DM[d].c;
    item.appendChild(dot);item.appendChild(document.createTextNode(d));leg.appendChild(item);
  });
  applyTreeTransform();
  document.getElementById('treeReset').addEventListener('click',function(e){e.stopPropagation();state.tree.x=0;state.tree.y=0;state.tree.scale=1;applyTreeTransform()});
  document.querySelectorAll('.tree-node').forEach(function(n){
    n.addEventListener('click',function(){
      if(state.tree.didDrag)return;
      var id=parseInt(this.getAttribute('data-nid'));selectTask(id);
      var t=state.taskById[id];if(t&&t.subs&&t.subs.length){state.expanded.add(id);saveExpanded()}
      if(isMobile())closeTree();
    });
    n.addEventListener('mouseenter',function(e){
      if(isMobile())return;
      var id=parseInt(this.getAttribute('data-nid')),t=state.taskById[id];if(!t)return;
      var tip=document.getElementById('tooltip'),done=taskDone(t),blocked=isBlocked(t),prog=taskProgress(t);
      var status=done?'✓ Complete':blocked?'🔒 Blocked':'● Active';if(prog>0&&prog<1)status+=' — '+Math.round(prog*100)+'%';
      var hint=(!done&&!blocked&&(!t.subs||!t.subs.length))?' · click ✓ to complete':'';
      tip.innerHTML='<div class="tt-domain" style="color:'+(DM[t.domain]||{c:'#999'}).c+'">'+esc(t.domain)+'</div><div class="tt-name">'+esc(t.name)+'</div><div class="tt-status">'+esc(status+hint)+'</div>';
      tip.classList.add('show');tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-12)+'px';
    });
    n.addEventListener('mousemove',function(e){var tip=document.getElementById('tooltip');if(isMobile())return;tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-12)+'px'});
    n.addEventListener('mouseleave',function(){var tip=document.getElementById('tooltip');if(tip)tip.classList.remove('show')});
  });
  document.querySelectorAll('.tree-node-check').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();if(state.tree.didDrag)return;
      var id=parseInt(this.getAttribute('data-checkid')),t=state.taskById[id];if(!t)return;
      api('PATCH','/api/tasks/'+id+'/toggle').then(function(r){t.done=r.done?1:0;renderCards();renderTree()});
    });
    if(!isMobile()){btn.addEventListener('mouseenter',function(){this.style.opacity='1'});btn.addEventListener('mouseleave',function(){this.style.opacity='0.55'})}
  });
}

// ── Resize ─────────────────────────────────────────────────────

window.addEventListener('resize',function(){
  if(!state.slug)return;
  if(state.showTree){state.treePos=null;renderTree()}
});

// ── Modals ──────────────────────────────────────────────────────

function openEdit(id){
  var t=state.taskById[id];if(!t)return;var m=document.getElementById('modal');
  m.innerHTML='<h2>Edit task</h2>'
    +'<div class="field"><label>Name</label><input id="e-name"></div>'
    +'<div class="field"><label>Domain</label><select id="e-domain"></select></div>'
    +'<div style="display:flex;gap:8px">'
      +'<div class="field" style="flex:1"><label>Plan date</label><input id="e-pdate" type="date"></div>'
      +'<div class="field" style="flex:1"><label>Due date</label><input id="e-ddate" type="date"></div>'
    +'</div>'
    +'<div style="display:flex;gap:8px">'
      +'<div class="field" style="flex:1"><label>Plan label</label><input id="e-plabel"></div>'
      +'<div class="field" style="flex:1"><label>Due label</label><input id="e-dlabel"></div>'
    +'</div>'
    +'<div style="display:flex;gap:8px">'
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
    +'<div style="display:flex;gap:8px">'
      +'<div class="field" style="flex:1"><label>Plan date</label><input id="e-pdate" type="date"></div>'
      +'<div class="field" style="flex:1"><label>Due date</label><input id="e-ddate" type="date"></div>'
    +'</div>'
    +'<div style="display:flex;gap:8px">'
      +'<div class="field" style="flex:1"><label>Plan label</label><input id="e-plabel" placeholder="e.g. Wed Apr 9"></div>'
      +'<div class="field" style="flex:1"><label>Due label</label><input id="e-dlabel" placeholder="e.g. Fri Apr 11"></div>'
    +'</div>'
    +'<div style="display:flex;gap:8px">'
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
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeModal();closeTree()}});
route();
