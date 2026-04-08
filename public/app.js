function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
var TODAY=new Date();TODAY.setHours(0,0,0,0);
var DAYJSTODAY=dayjs().startOf('day');
var DM={CTI:{c:"#60a5fa",l:"CTI"},ECM:{c:"#c084fc",l:"ECM"},CSD:{c:"#5eead4",l:"CSD"},GRA:{c:"#7dd3fc",l:"GRA"},Personal:{c:"#a5b4fc",l:"PER"}};
var TL=["snap","sesh","grind"],SL=["low","high","crit"];
var SC=[{bg:"var(--bg3)",fg:"var(--tx3)"},{bg:"#C9652A",fg:"#fff"},{bg:"#D92B2B",fg:"#fff"}];
var DOMAINS=Object.keys(DM);
var TL_PX_DAY=58,TL_CARD_MIN=172,TL_CARD_H=82,TL_ROW_GAP=10,TL_LANE_PAD=12,TL_AXIS_H=52,TL_LABEL_W=110;

var state={
  slug:null,user:null,tasks:[],taskById:{},expanded:new Set(),
  view:'current',searchQuery:'',selectedId:null,
  layout:'split',  // desktop: 'split' | 'timeline'
  mobileTab:'list', // mobile: 'list' | 'tree' | 'timeline'
  treePos:null,
  tree:{x:0,y:0,scale:1,dragging:false,didDrag:false,dragStart:{x:0,y:0},pinchDist:null,pinchScale:1,pinchMid:{x:0,y:0}},
  tlLines:[]
};

function isMobile(){return window.innerWidth<=768}
function api(m,u,b){var o={method:m,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}};if(b)o.body=JSON.stringify(b);return fetch(u,o).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){console.error('API error:',m,u,e);throw e})}
function df(ds){if(!ds)return 999;return Math.max(0,Math.round((new Date(ds+'T00:00:00')-TODAY)/864e5))}
function isBlocked(t){
  if(!t.needs||!t.needs.length)return false;
  for(var k=0;k<t.needs.length;k++){var dep=state.taskById[t.needs[k]];if(!dep)continue;
    if(dep.subs&&dep.subs.length){if(!dep.subs.every(function(s){return s.done}))return true}
    else{if(!dep.done)return true}}return false;
}
function taskDone(t){var a;if(t.subs&&t.subs.length)a=t.subs.every(function(s){return s.done});else a=!!t.done;return a&&!isBlocked(t)}
function taskProgress(t){if(!t.subs||!t.subs.length)return t.done?1:0;return t.subs.filter(function(s){return s.done}).length/t.subs.length}
function matchSearch(t){
  if(!state.searchQuery)return true;var q=state.searchQuery.toLowerCase();
  return t.name.toLowerCase().includes(q)||t.domain.toLowerCase().includes(q)||(t.subs&&t.subs.some(function(s){return s.label.toLowerCase().includes(q)}));
}
function saveExpanded(){api('PUT','/api/users/'+state.slug+'/ui-state',{expanded:Array.from(state.expanded)})}

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
  panel.addEventListener('mousedown',function(e){
    state.tree.dragging=true;state.tree.didDrag=false;
    state.tree.dragStart={x:e.clientX-state.tree.x,y:e.clientY-state.tree.y};
  });
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

// ── Layout switching ───────────────────────────────────────────

function switchLayout(layout){
  state.layout=layout;
  var pl=document.getElementById('panelList');
  var pt=document.getElementById('treePanel');
  var ptl=document.getElementById('panelTimeline');
  var fab=document.getElementById('fabAdd');
  if(layout==='split'){
    if(pl)pl.style.display='';if(pt)pt.style.display='';
    if(ptl)ptl.classList.remove('tl-on');
    if(fab)fab.style.display='';
    destroyTLLines();
  } else {
    if(pl)pl.style.display='none';if(pt)pt.style.display='none';
    if(ptl)ptl.classList.add('tl-on');
    if(fab)fab.style.display='none';
    destroyTLLines();
    requestAnimationFrame(function(){setTimeout(renderTimeline,30)});
  }
  document.querySelectorAll('.lt-btn').forEach(function(b){b.classList.toggle('active',b.dataset.layout===layout)});
}

function switchMobileTab(tab){
  state.mobileTab=tab;
  var pl=document.getElementById('panelList');
  var pt=document.getElementById('treePanel');
  var ptl=document.getElementById('panelTimeline');
  var fab=document.getElementById('fabAdd');
  if(pl)pl.classList.toggle('m-hidden',tab!=='list');
  if(pt)pt.classList.toggle('m-hidden',tab!=='tree');
  if(ptl)ptl.classList.toggle('m-hidden',tab!=='timeline');
  if(fab)fab.style.display=tab==='list'?'':'none';
  document.querySelectorAll('.m-tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab)});
  if(tab==='tree'){state.treePos=null;requestAnimationFrame(function(){setTimeout(renderTree,30)})}
  if(tab==='timeline'){destroyTLLines();requestAnimationFrame(function(){setTimeout(renderTimeline,30)})}
  if(tab!=='timeline')destroyTLLines();
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
      c.innerHTML='<h2></h2><p></p>';
      c.querySelector('h2').textContent=u.name;
      c.querySelector('p').textContent='@'+u.slug;
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
  var dateStr=TODAY.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  var mob=isMobile();
  root.innerHTML=
    '<div class="panel-list'+(mob&&state.mobileTab!=='list'?' m-hidden':'')+'" id="panelList"' ' >'
      +'<div class="hdr">'
        +'<div class="hdr-top">'
          +'<a class="back" href="/" onclick="event.preventDefault();history.pushState(null,\'\',\'/\');route()">&#8592;</a>'
          +'<h1 id="appUserName"></h1>'
          +'<div class="lt-wrap">'
            +'<button class="lt-btn'+(state.layout==='split'?' active':'')+'" data-layout="split">board</button>'
            +'<button class="lt-btn'+(state.layout==='timeline'?' active':'')+'" data-layout="timeline">timeline</button>'
          +'</div>'
          +'<button class="ai-btn" id="askAiBtn">✦ AI</button>'
        +'</div>'
        +'<p>'+dateStr+'</p>'
        +'<div class="toggle-wrap">'
          +'<button class="toggle-btn'+(state.view==='current'?' active':'')+'" data-view="current">current</button>'
          +'<button class="toggle-btn'+(state.view==='archived'?' active':'')+'" data-view="archived">archived</button>'
        +'</div>'
        +'<input class="search" id="searchInput" placeholder="Search..." autocomplete="off">'
      +'</div>'
      +'<div class="cards" id="cardList"></div>'
    +'</div>'
    +'<div class="panel-tree'+(mob&&state.mobileTab!=='tree'?' m-hidden':'')+'" id="treePanel"' ' ></div>'
    +'<div class="panel-timeline'+(mob&&state.mobileTab!=='timeline'?' m-hidden':'')+(!mob?' tl-on':'')+'" id="panelTimeline"><div class="tl-canvas" id="tlCanvas"><div class="tl-axis" id="tlAxis"></div></div></div>'
    +'<button class="fab" id="fabAdd" style="'+(mob&&state.mobileTab!=='list'?'display:none':'')+'">+</button>'
    +'<div class="m-tabs" id="mTabs">'
      +'<button class="m-tab'+(state.mobileTab==='list'?' active':'')+'" data-tab="list">☰ Tasks</button>'
      +'<button class="m-tab'+(state.mobileTab==='tree'?' active':'')+'" data-tab="tree">◈ Tree</button>'
      +'<button class="m-tab'+(state.mobileTab==='timeline'?' active':'')+'" data-tab="timeline">◫ Timeline</button>'
    +'</div>';

  // View toggle (current/archived) — no DOM rebuild
  document.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){
    var v=this.getAttribute('data-view');if(v===state.view)return;
    state.view=v;
    document.querySelectorAll('.toggle-btn').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-view')===v)});
    state.searchQuery='';var si=document.getElementById('searchInput');if(si)si.value='';
    api('GET','/api/users/'+state.slug+'/tasks'+(v==='archived'?'?view=archived':'')).then(function(res){
      state.tasks=res.tasks;state.taskById={};state.tasks.forEach(function(t){state.taskById[t.id]=t});
      state.treePos=null;renderCards();
      var showingTree=isMobile()&&(state.mobileTab==='tree');
      var showingTimeline=!isMobile()||(isMobile()&&state.mobileTab==='timeline');
      if(showingTree)renderTree();
      if(showingTimeline){destroyTLLines();renderTimeline();}
    });
  })});

  document.getElementById('searchInput').addEventListener('input',function(){state.searchQuery=this.value;renderCards()});
  document.getElementById('fabAdd').addEventListener('click',openAddTask);

  // Desktop layout toggle
  document.querySelectorAll('.lt-btn').forEach(function(b){b.addEventListener('click',function(){switchLayout(this.dataset.layout)})});
  var aib=document.getElementById('askAiBtn');
  if(aib)aib.addEventListener('click',openAIModal);
  // Mobile tabs
  document.querySelectorAll('.m-tab').forEach(function(b){b.addEventListener('click',function(){switchMobileTab(this.dataset.tab)})});

  bindTreePanZoom(document.getElementById('treePanel'));
  var userNameEl=document.getElementById('appUserName');if(userNameEl&&state.user)userNameEl.textContent=state.user.name;
  renderCards();

  // Timeline scroll handler
  var ptl=document.getElementById('panelTimeline');
  if(ptl){
    ptl.addEventListener('scroll',function(){
      state.tlLines.forEach(function(l){try{l.position()}catch(e){}});
    });
  }

  var showTree=mob&&(state.mobileTab==='tree');
  var showTimeline=!mob||(mob&&state.mobileTab==='timeline');
  if(showTree)requestAnimationFrame(function(){setTimeout(renderTree,50)});
  if(showTimeline)requestAnimationFrame(function(){setTimeout(renderTimeline,50)});
}

// ── Card list (what-next) ──────────────────────────────────────

function renderCards(){
  var list=document.getElementById('cardList');if(!list)return;
  var filtered=state.tasks.filter(matchSearch);
  if(!filtered.length){list.innerHTML='<p class="empty">'+(state.searchQuery?'No matches':'No tasks')+'</p>';return}
  list.innerHTML='';
  filtered.forEach(function(t,idx){
    var col=(DM[t.domain]||{c:"#71717a"}).c,label=DM[t.domain]?DM[t.domain].l:t.domain;
    var blocked=isBlocked(t),done=taskDone(t),prog=taskProgress(t);
    var dd=df(t.due_date),sc=SC[t.stakes]||SC[0];
    var hasSubs=t.subs&&t.subs.length>0,isOpen=state.expanded.has(t.id);
    var el=document.createElement('div');
    el.className='card'+(done?' alldone':'')+(blocked?' blocked-card':'')+(state.selectedId===t.id?' selected':'');
    el.setAttribute('data-cardid',t.id);

    var pbar=hasSubs?'<div class="c-pbar"><div class="c-pbar-fill" style="width:'+Math.round(prog*100)+'%;background:'+col+'"></div></div>':'';
    var actHTML='<div class="c-actions"><button class="c-act" data-edit="'+t.id+'">edit</button>';
    if(!hasSubs)actHTML+='<button class="c-act" data-addfirstsub="'+t.id+'">+sub</button>';
    if(t.archived)actHTML+='<button class="c-act unarchive" data-unarchive="'+t.id+'">unarchive</button>';
    else if(done)actHTML+='<button class="c-act archive" data-archive="'+t.id+'">archive</button>';
    actHTML+='</div>';
    el.innerHTML='<div class="stripe" style="background:'+col+'"></div>'
      +'<div class="c-row"><span class="c-idx">'+(idx+1)+'</span><span class="c-domain" style="color:'+col+';border-color:'+col+'"></span><span class="c-name"></span>'+(blocked?'<span class="c-lock">blocked</span>':'')+'</div>'
      +'<div class="c-meta"><span class="c-pill" style="background:var(--bg3);color:var(--tx2)">'+TL[t.speed]+'</span><span class="c-pill" style="background:'+sc.bg+';color:'+sc.fg+'">'+SL[t.stakes]+'</span><span class="c-date"></span><span class="c-tp" style="background:'+(dd<=0?"#ef4444":dd<=2?"#C9652A":dd<=5?"#A67A4B":"#3f3f46")+'">T-'+dd+'</span></div>'
      +pbar+actHTML;

    el.querySelector('.c-domain').textContent=label;
    el.querySelector('.c-name').textContent=t.name;
    el.querySelector('.c-date').textContent=t.due_label||'';

    if(hasSubs&&isOpen){
      var sDiv=document.createElement('div'); sDiv.className='c-subs';
      t.subs.forEach(function(s){
        var sd=document.createElement('div'); sd.className='c-sub'+(s.done?' subdone':''); sd.dataset.sid=s.id;
        var sc=document.createElement('div'); sc.className='c-scheck'+(s.done?' on':'');
        var sl=document.createElement('span'); sl.className='c-slabel'; sl.textContent=s.label;
        var dx=document.createElement('span'); dx.className='c-sub-del'; dx.dataset.delsub=s.id; dx.innerHTML='&#10005;';
        sd.appendChild(sc); sd.appendChild(sl); sd.appendChild(dx);
        sDiv.appendChild(sd);
      });
      var add=document.createElement('div'); add.className='c-add-sub';
      add.innerHTML='<input placeholder="Add subtask..." data-addsub="'+t.id+'"><button data-addbtn="'+t.id+'">+</button>';
      sDiv.appendChild(add);
      el.appendChild(sDiv);
    }
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
  document.querySelectorAll('.card:not(.tl-card)').forEach(function(el){el.addEventListener('click',function(e){
    if(e.target.closest('[data-sid]')||e.target.closest('[data-edit]')||e.target.closest('[data-archive]')||e.target.closest('[data-unarchive]')||e.target.closest('[data-delsub]')||e.target.closest('[data-addbtn]')||e.target.closest('[data-addfirstsub]')||e.target.closest('[data-addsub]'))return;
    var tid=parseInt(this.getAttribute('data-cardid')),t=state.taskById[tid];
    selectTask(tid);
    if(t.subs&&t.subs.length){state.expanded.has(tid)?state.expanded.delete(tid):state.expanded.add(tid);saveExpanded();renderCards();selectTask(tid)}
    else{api('PATCH','/api/tasks/'+tid+'/toggle').then(function(r){t.done=r.done?1:0;renderCards();renderTree()})}
  })});
  document.querySelectorAll('[data-sid]').forEach(function(el){el.addEventListener('click',function(e){
    e.stopPropagation();var sid=parseInt(this.getAttribute('data-sid'));
    api('PATCH','/api/subtasks/'+sid+'/toggle').then(function(r){
      for(var i=0;i<state.tasks.length;i++){var subs=state.tasks[i].subs;if(!subs)continue;for(var j=0;j<subs.length;j++){if(subs[j].id===sid){subs[j].done=r.done?1:0;renderCards();renderTree();return}}}
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

// ── Skill tree ─────────────────────────────────────────────────

function renderTree(){
  var panel=document.getElementById('treePanel');
  if(!panel||panel.classList.contains('m-hidden')||panel.style.display==='none')return;
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
      var col=srcDone?(DM[srcT.domain]||{c:"#333"}).c:'#2c2c38',op=srcDone?0.85:0.45,w=srcDone?2.5:1.5;
      var mx=(f.x+to.x)/2,my=(f.y+to.y)/2;
      s+='<line x1="'+f.x+'" y1="'+f.y+'" x2="'+to.x+'" y2="'+to.y+'" stroke="'+col+'" stroke-width="'+w+'" opacity="'+op+'" filter="url(#edge-glow)"/>';
      s+='<circle cx="'+mx+'" cy="'+my+'" r="1.5" fill="'+col+'" opacity="'+op+'"/>';
    });
  });
  state.tasks.forEach(function(t,idx){
    var p=pos[t.id];if(!p)return;
    var col=(DM[t.domain]||{c:"#71717a"}).c,done=taskDone(t),blocked=isBlocked(t),active=!done&&!blocked;
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
    var item=document.createElement('div'); item.className='tree-legend-item';
    var dot=document.createElement('span'); dot.className='tree-legend-dot'; dot.style.background=DM[d].c;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(d));
    leg.appendChild(item);
  });
  applyTreeTransform();
  document.getElementById('treeReset').addEventListener('click',function(e){e.stopPropagation();state.tree.x=0;state.tree.y=0;state.tree.scale=1;applyTreeTransform()});
  document.querySelectorAll('.tree-node').forEach(function(n){
    n.addEventListener('click',function(){
      if(state.tree.didDrag)return;
      var id=parseInt(this.getAttribute('data-nid'));selectTask(id);
      var t=state.taskById[id];if(t&&t.subs&&t.subs.length){state.expanded.add(id);saveExpanded()}
      if(isMobile()){switchMobileTab('list');requestAnimationFrame(function(){var c=document.querySelector('[data-cardid="'+id+'"]');if(c)c.scrollIntoView({behavior:'smooth',block:'nearest'})})}
    });
    n.addEventListener('mouseenter',function(e){
      if(isMobile())return;
      var id=parseInt(this.getAttribute('data-nid')),t=state.taskById[id];if(!t)return;
      var tip=document.getElementById('tooltip'),done=taskDone(t),blocked=isBlocked(t),prog=taskProgress(t);
      var status=done?'✓ Complete':blocked?'🔒 Blocked':'● Active';if(prog>0&&prog<1)status+=' — '+Math.round(prog*100)+'%';
      var hint=(!done&&!blocked&&(!t.subs||!t.subs.length))?' · click ✓ to complete':'';
      tip.innerHTML='<div class="tt-domain"></div><div class="tt-name"></div><div class="tt-status"></div>';
      var dEl=tip.querySelector('.tt-domain');
      dEl.style.color=(DM[t.domain]||{c:"#999"}).c;
      dEl.textContent=t.domain;
      tip.querySelector('.tt-name').textContent=t.name;
      tip.querySelector('.tt-status').textContent=status+hint;
      tip.classList.add('show');tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-12)+'px';
    });
    n.addEventListener('mousemove',function(e){var tip=document.getElementById('tooltip');if(isMobile())return;tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-12)+'px'});
    n.addEventListener('mouseleave',function(){document.getElementById('tooltip').classList.remove('show')});
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

// ── Timeline ───────────────────────────────────────────────────

function destroyTLLines(){
  state.tlLines.forEach(function(l){try{l.remove()}catch(e){}});
  state.tlLines=[];
}

function tlComputeLayout(tasks){
  if(!tasks.length)return null;
  var dates=[];
  tasks.forEach(function(t){if(t.plan_date)dates.push(dayjs(t.plan_date));if(t.due_date)dates.push(dayjs(t.due_date))});
  if(!dates.length)return null;
  var startD=dates.reduce(function(a,b){return a.isBefore(b)?a:b}).subtract(1,'day');
  var endD=dates.reduce(function(a,b){return a.isAfter(b)?a:b}).add(2,'day');
  var totalDays=endD.diff(startD,'day')+1;

  function xOf(ds){return TL_LABEL_W+dayjs(ds).startOf('day').diff(startD,'day')*TL_PX_DAY}

  var domOrder=Object.keys(DM).filter(function(d){return tasks.some(function(t){return t.domain===d})});
  var byDom={};domOrder.forEach(function(d){byDom[d]=tasks.filter(function(t){return t.domain===d}).sort(function(a,b){return dayjs(a.plan_date||a.due_date).diff(dayjs(b.plan_date||b.due_date))})});

  var cardLayout={},laneMeta={},laneTop=TL_AXIS_H;
  domOrder.forEach(function(dom){
    var dt=byDom[dom],rows=[];
    dt.forEach(function(t){
      var ts=dayjs(t.plan_date||t.due_date||DAYJSTODAY.format('YYYY-MM-DD'));
      var te=dayjs(t.due_date||t.plan_date||DAYJSTODAY.format('YYYY-MM-DD'));
      var naturalW=(te.diff(ts,'day')+1)*TL_PX_DAY-4;
      var w=Math.max(TL_CARD_MIN,naturalW);
      var cardEndDate=ts.add(Math.ceil(w/TL_PX_DAY),'day');
      var row=0;while(rows[row]&&rows[row].isAfter(ts,'day'))row++;
      rows[row]=cardEndDate;
      cardLayout[t.id]={x:xOf(ts.format('YYYY-MM-DD')),row:row,w:w};
    });
    var nRows=rows.length||1,laneH=TL_LANE_PAD+nRows*(TL_CARD_H+TL_ROW_GAP)-TL_ROW_GAP+TL_LANE_PAD;
    laneMeta[dom]={nRows:nRows,y:laneTop,h:laneH};laneTop+=laneH;
  });
  Object.keys(cardLayout).forEach(function(id){
    var t=state.taskById[id];if(!t)return;
    var lm=laneMeta[t.domain];if(!lm)return;
    cardLayout[id].y=lm.y+TL_LANE_PAD+cardLayout[id].row*(TL_CARD_H+TL_ROW_GAP);
  });
  return{startD:startD,endD:endD,totalDays:totalDays,totalW:TL_LABEL_W+totalDays*TL_PX_DAY,totalH:laneTop+8,xOf:xOf,domOrder:domOrder,byDom:byDom,cardLayout:cardLayout,laneMeta:laneMeta};
}

function renderTimeline(){
  var panel=document.getElementById('panelTimeline');
  var canvas=document.getElementById('tlCanvas');
  var axis=document.getElementById('tlAxis');
  if(!panel||!canvas||!axis)return;
  if(panel.classList.contains('m-hidden'))return;
  if(!panel.classList.contains('tl-on')&&panel.style.display==='none')return;

  destroyTLLines();
  // Remove old content (keep axis div)
  Array.from(canvas.children).forEach(function(el){if(el!==axis)el.remove()});

  var L=tlComputeLayout(state.tasks);
  if(!L){axis.innerHTML='<p style="padding:40px;color:var(--tx3);font-size:13px">No tasks with dates</p>';return}

  canvas.style.width=L.totalW+'px';canvas.style.height=L.totalH+'px';

  // Axis
  var s='<svg width="'+L.totalW+'" height="'+TL_AXIS_H+'" xmlns="http://www.w3.org/2000/svg">';
  s+='<rect x="0" y="0" width="'+TL_LABEL_W+'" height="'+TL_AXIS_H+'" fill="var(--bg)"/>';
  s+='<text x="'+TL_LABEL_W/2+'" y="'+TL_AXIS_H/2+'" fill="var(--tx3)" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="central" letter-spacing="1">DOMAIN</text>';
  for(var i=0;i<=L.totalDays;i++){
    var d=L.startD.add(i,'day'),x=TL_LABEL_W+i*TL_PX_DAY,dow=d.day();
    var isWeekStart=dow===1||i===0,isToday=d.isSame(DAYJSTODAY,'day');
    s+='<line x1="'+x+'" y1="'+(TL_AXIS_H*0.55)+'" x2="'+x+'" y2="'+TL_AXIS_H+'" stroke="rgba(255,255,255,'+(isWeekStart?.08:.03)+')" stroke-width="'+(isWeekStart?1:.5)+'"/>';
    if(isWeekStart||i===0)s+='<text x="'+(x+TL_PX_DAY/2)+'" y="'+(TL_AXIS_H*0.28)+'" fill="#4a4a55" font-size="8" font-weight="600" text-anchor="middle">'+d.format('MMM D')+'</text>';
    s+='<text x="'+(x+TL_PX_DAY/2)+'" y="'+(TL_AXIS_H*0.72)+'" fill="'+(isToday?'#ef4444':dow===0||dow===6?'#3a3a45':'#5a5a65')+'" font-size="8" font-weight="'+(isToday?700:400)+'" text-anchor="middle" dominant-baseline="central">'+d.date()+'</text>';
    if(isToday)s+='<line x1="'+x+'" y1="0" x2="'+x+'" y2="'+TL_AXIS_H+'" stroke="#ef4444" stroke-width="1.5" opacity=".5"/>';
  }
  s+='</svg>';axis.innerHTML=s;
  axis.style.width=L.totalW+'px';

  // Today line
  var todayX=L.xOf(DAYJSTODAY.format('YYYY-MM-DD'));
  if(todayX>=TL_LABEL_W){
    var tl=document.createElement('div');tl.className='tl-today-line';
    tl.style.cssText='left:'+todayX+'px;top:'+TL_AXIS_H+'px;height:'+(L.totalH-TL_AXIS_H)+'px';canvas.appendChild(tl);
    var tlab=document.createElement('div');tlab.className='tl-today-label';
    tlab.style.left=todayX+'px';tlab.style.top=(TL_AXIS_H+4)+'px';tlab.textContent='today';canvas.appendChild(tlab);
  }

  // Swimlanes
  L.domOrder.forEach(function(dom){
    var lm=L.laneMeta[dom],c=DM[dom].c;
    var lane=document.createElement('div');lane.className='tl-lane';
    lane.style.cssText='top:'+lm.y+'px;height:'+lm.h+'px;left:0;right:0;position:absolute';
    lane.innerHTML='<div style="position:absolute;inset:0;background:'+c+';opacity:.03;pointer-events:none"></div>'
      +'<div style="position:absolute;bottom:0;left:0;right:0;height:1px;background:var(--brd)"></div>'
      +'<div class="tl-lane-label" style="height:'+lm.h+'px;position:sticky;left:0;top:auto">'
        +'<div><div class="tl-lane-name"></div>'
        +'<div class="tl-lane-count"></div></div>'
      +'</div>';
    var nEl=lane.querySelector('.tl-lane-name'); nEl.style.color=c; nEl.textContent=dom;
    lane.querySelector('.tl-lane-count').textContent=L.byDom[dom].length+' task'+(L.byDom[dom].length!==1?'s':'');
    canvas.appendChild(lane);
  });

  // Cards — identical structure to what-next list
  state.tasks.forEach(function(t){
    var cl=L.cardLayout[t.id];if(!cl)return;
    var col=(DM[t.domain]||{c:"#71717a"}).c,label=DM[t.domain]?DM[t.domain].l:'???';
    var done=taskDone(t),blocked=isBlocked(t),prog=taskProgress(t);
    var dd=df(t.due_date),sc=SC[t.stakes]||SC[0],hasSubs=t.subs&&t.subs.length>0;
    var el=document.createElement('div');
    el.className='card tl-card'+(done?' alldone':'')+(blocked?' blocked-card':'')+(state.selectedId===t.id?' selected':'');
    el.id='tlcard-'+t.id;el.dataset.cardid=t.id;
    el.style.cssText='left:'+cl.x+'px;top:'+cl.y+'px;width:'+cl.w+'px;height:'+TL_CARD_H+'px;padding:8px 10px 8px 16px;overflow:hidden';
    var pbar=hasSubs?'<div class="c-pbar"><div class="c-pbar-fill" style="width:'+Math.round(prog*100)+'%;background:'+col+'"></div></div>':'';
    var ddC=dd<=0?'#ef4444':dd<=2?'#C9652A':dd<=5?'#A67A4B':'#3f3f46';
    el.innerHTML='<div class="stripe" style="background:'+col+'"></div>'
      +'<div class="c-row"><span class="c-domain"></span><span class="c-name"></span>'+(blocked?'<span class="c-lock">blocked</span>':'')+'</div>'
      +'<div class="c-meta"><span class="c-pill" style="background:var(--bg3);color:var(--tx2)">'+TL[t.speed]+'</span><span class="c-pill" style="background:'+sc.bg+';color:'+sc.fg+'">'+SL[t.stakes]+'</span>'+(t.due_label?'<span class="c-date"></span>':'')+(dd<999?'<span class="c-tp" style="background:'+ddC+'">T-'+dd+'</span>':'')+'</div>'
      +pbar
      +(done?'<span style="position:absolute;top:7px;right:9px;font-size:11px;font-weight:700;color:'+col+'">✓</span>':'');

    var dEl=el.querySelector('.c-domain'); dEl.style.color=col; dEl.style.borderColor=col; dEl.textContent=label;
    el.querySelector('.c-name').textContent=t.name;
    if(t.due_label)el.querySelector('.c-date').textContent=t.due_label;

    // Tooltip
    el.addEventListener('mouseenter',function(e){
      var tip=document.getElementById('tlTip');
      var needs=(t.needs||[]).map(function(id){return state.taskById[id]&&state.taskById[id].name}).filter(Boolean);
      var unlocks=state.tasks.filter(function(u){return(u.needs||[]).indexOf(t.id)>-1}).map(function(u){return u.name});
      var status=done?'✓ Complete':blocked?'🔒 Blocked':prog>0?'⬡ '+Math.round(prog*100)+'% done':'● Active';
      tip.innerHTML='<div class="tl-tip-domain"></div><div class="tl-tip-name"></div><div class="tl-tip-meta"></div>';
      var dEl=tip.querySelector('.tl-tip-domain'); dEl.style.color=col; dEl.textContent=t.domain;
      tip.querySelector('.tl-tip-name').textContent=t.name;
      var mEl=tip.querySelector('.tl-tip-meta');
      mEl.textContent=status;
      if(needs.length){ mEl.appendChild(document.createElement('br')); mEl.appendChild(document.createTextNode('needs: '+needs.join(', '))); }
      if(unlocks.length){ mEl.appendChild(document.createElement('br')); mEl.appendChild(document.createTextNode('unlocks: '+unlocks.join(', '))); }
      if(t.due_label){ mEl.appendChild(document.createElement('br')); mEl.appendChild(document.createTextNode(t.due_label)); }
      tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-10)+'px';tip.classList.add('show');
    });
    el.addEventListener('mousemove',function(e){var tip=document.getElementById('tlTip');tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-10)+'px'});
    el.addEventListener('mouseleave',function(){document.getElementById('tlTip').classList.remove('show')});

    // Click: toggle done (no-subs, unblocked) or select
    el.addEventListener('click',function(){
      state.selectedId=state.selectedId===t.id?null:t.id;
      document.querySelectorAll('.card').forEach(function(c){c.classList.toggle('selected',parseInt(c.dataset.cardid)===state.selectedId)});
      if(!hasSubs&&!blocked){
        api('PATCH','/api/tasks/'+t.id+'/toggle',{}).then(function(r){
          t.done=r.done?1:0;renderCards();destroyTLLines();renderTimeline();
        });
      }
    });
    canvas.appendChild(el);
  });

  // Leader Line arrows after DOM is populated
  requestAnimationFrame(function(){
    state.tasks.forEach(function(t){
      (t.needs||[]).forEach(function(bid){
        var src=document.getElementById('tlcard-'+bid);
        var dst=document.getElementById('tlcard-'+t.id);
        if(!src||!dst)return;
        var srcT=state.taskById[bid],isDone=srcT&&taskDone(srcT),c=(DM[srcT&&srcT.domain]||{c:'#888'}).c;
        try{
          var ll=new LeaderLine(src,dst,{
            color:c,size:isDone?2:1.5,opacity:isDone?.65:.32,
            path:'fluid',startSocket:'right',endSocket:'left',
            endPlug:'arrow2',endPlugSize:1.8,
            dash:isDone?false:{len:6,gap:4}
          });
          state.tlLines.push(ll);
        }catch(e){}
      });
    });
    document.querySelectorAll('.leader-line').forEach(function(el){el.style.zIndex='5'});
  });
}

// ── Resize ─────────────────────────────────────────────────────

window.addEventListener('resize',function(){
  if(!state.slug)return;
  var showingTree=isMobile()&&(state.mobileTab==='tree');
  var showingTimeline=!isMobile()||(isMobile()&&state.mobileTab==='timeline');
  if(showingTree){state.treePos=null;renderTree()}
  if(showingTimeline){destroyTLLines();renderTimeline()}
});

// ── Modals ──────────────────────────────────────────────────────

function openEdit(id){
  var t=state.taskById[id];if(!t)return;var m=document.getElementById('modal');
  m.innerHTML='<h2>Edit task</h2>'
    +'<div class="field"><label>Name</label><input id="e-name"></div>'
    +'<div class="field"><label>Domain</label><select id="e-domain"></select></div>'
    +'<div style="display:flex;gap:6px"><div class="field" style="flex:1"><label>Plan date</label><input id="e-pdate" type="date"></div><div class="field" style="flex:1"><label>Due date</label><input id="e-ddate" type="date"></div></div>'
    +'<div style="display:flex;gap:6px"><div class="field" style="flex:1"><label>Plan label</label><input id="e-plabel"></div><div class="field" style="flex:1"><label>Due label</label><input id="e-dlabel"></div></div>'
    +'<div style="display:flex;gap:6px"><div class="field" style="flex:1"><label>Speed</label><select id="e-speed">'+TL.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div><div class="field" style="flex:1"><label>Stakes</label><select id="e-stakes">'+SL.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div></div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="e-cancel">Cancel</button><button class="btn-save" id="e-save">Save</button></div>';
  
  document.getElementById('e-name').value = t.name;
  var sel=document.getElementById('e-domain');
  DOMAINS.forEach(function(d){
    var opt=document.createElement('option'); opt.textContent=d; if(d===t.domain) opt.selected=true;
    sel.appendChild(opt);
  });
  document.getElementById('e-pdate').value = t.plan_date||'';
  document.getElementById('e-ddate').value = t.due_date||'';
  document.getElementById('e-plabel').value = t.plan_label||'';
  document.getElementById('e-dlabel').value = t.due_label||'';
  document.getElementById('e-speed').value = t.speed;
  document.getElementById('e-stakes').value = t.stakes;

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
    +'<div style="display:flex;gap:6px"><div class="field" style="flex:1"><label>Plan date</label><input id="e-pdate" type="date"></div><div class="field" style="flex:1"><label>Due date</label><input id="e-ddate" type="date"></div></div>'
    +'<div style="display:flex;gap:6px"><div class="field" style="flex:1"><label>Plan label</label><input id="e-plabel" placeholder="e.g. Wed Apr 8"></div><div class="field" style="flex:1"><label>Due label</label><input id="e-dlabel" placeholder="e.g. Fri Apr 10"></div></div>'
    +'<div style="display:flex;gap:6px"><div class="field" style="flex:1"><label>Speed</label><select id="e-speed">'+TL.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div><div class="field" style="flex:1"><label>Stakes</label><select id="e-stakes">'+SL.map(function(s,i){return'<option value="'+i+'">'+s+'</option>'}).join('')+'</select></div></div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="e-cancel">Cancel</button><button class="btn-save" id="e-save">Create</button></div>';

  var sel=document.getElementById('e-domain');
  DOMAINS.forEach(function(d){
    var opt=document.createElement('option'); opt.textContent=d;
    sel.appendChild(opt);
  });

  document.getElementById('modalBg').classList.add('show');
  document.getElementById('e-cancel').onclick=closeModal;
  document.getElementById('e-save').onclick=function(){
    var name=document.getElementById('e-name').value.trim();if(!name)return;
    api('POST','/api/users/'+state.slug+'/tasks',{name:name,domain:document.getElementById('e-domain').value,plan_date:document.getElementById('e-pdate').value||null,due_date:document.getElementById('e-ddate').value||null,plan_label:document.getElementById('e-plabel').value,due_label:document.getElementById('e-dlabel').value,speed:parseInt(document.getElementById('e-speed').value),stakes:parseInt(document.getElementById('e-stakes').value)}).then(function(){closeModal();loadBoard()});
  };
}

function openAIModal(){
  var SUGGESTIONS=[
    'What should I work on first today?',
    'What is blocking my most critical tasks?',
    'What is the critical path this week?',
    'Which tasks are overdue or at risk?',
    'Summarize my workload by domain'
  ];
  var m=document.getElementById('modal');
  m.innerHTML='<h2>✦ Ask Gemini</h2>'
    +'<div class="ai-chips">'+SUGGESTIONS.map(function(s){return'<span class="ai-chip">'+s+'</span>'}).join('')+'</div>'
    +'<div class="field"><label>Question</label><textarea id="ai-q" rows="3" style="width:100%;padding:7px 9px;border-radius:5px;border:1px solid var(--brd);background:var(--bg3);color:var(--tx1);font-size:12px;outline:none;resize:vertical;font-family:inherit" placeholder="Ask anything about your tasks..."></textarea></div>'
    +'<div class="modal-actions"><button class="btn-cancel" id="ai-cancel">Cancel</button><button class="btn-save" id="ai-submit">Ask</button></div>'
    +'<div class="ai-loading" id="ai-loading"><div class="ai-spinner"></div><span>Asking Gemini…</span></div>'
    +'<div class="ai-response" id="ai-response"></div>'
    +'<div class="ai-meta" id="ai-meta"></div>';
  document.getElementById('modalBg').classList.add('show');
  var qa=document.getElementById('ai-q');
  document.querySelectorAll('.ai-chip').forEach(function(chip){
    chip.addEventListener('click',function(){qa.value=this.textContent;qa.focus()});
  });
  document.getElementById('ai-cancel').onclick=closeModal;
  document.getElementById('ai-submit').addEventListener('click',function(){
    var q=(qa.value||'').trim();if(!q)return;
    this.disabled=true;
    document.getElementById('ai-loading').classList.add('show');
    document.getElementById('ai-response').classList.remove('show');
    document.getElementById('ai-meta').textContent='';
    api('POST','/api/agent/gemini',{question:q,slug:state.slug}).then(function(r){
      document.getElementById('ai-loading').classList.remove('show');
      var resp=document.getElementById('ai-response');
      resp.textContent=r.answer||r.error||'No response';
      resp.classList.add('show');
      if(r.model)document.getElementById('ai-meta').textContent='via '+r.model;
      document.getElementById('ai-submit').disabled=false;
    }).catch(function(e){
      document.getElementById('ai-loading').classList.remove('show');
      var resp=document.getElementById('ai-response');
      resp.textContent='Error: '+e.message;
      resp.classList.add('show');
      document.getElementById('ai-submit').disabled=false;
    });
  });
}

function closeModal(){document.getElementById('modalBg').classList.remove('show')}
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal()});

document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
route();
