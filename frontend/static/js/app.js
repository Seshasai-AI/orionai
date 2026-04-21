'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let messages = [], isTyping = false, sessions = [], currentId = null;

// ── DOM ────────────────────────────────────────────────────────────────────
const feedEl      = document.getElementById('feed');
const inputEl     = document.getElementById('input');
const sendEl      = document.getElementById('send-btn');
const welcomeEl   = document.getElementById('welcome');
const clearEl     = document.getElementById('clear-btn');
const newChatEl   = document.getElementById('new-chat-btn');
const historyEl   = document.getElementById('chat-history');
const modelEl     = document.getElementById('model-display');
const webRowEl    = document.getElementById('web-row');
const sidebarEl   = document.getElementById('sidebar');
const menuEl      = document.getElementById('menu-btn');
const closeEl     = document.getElementById('sidebar-close');
const toastEl     = document.getElementById('toast');

// ── Background canvas ──────────────────────────────────────────────────────
(function(){
  const c = document.getElementById('bg-canvas');
  if(!c) return;
  const ctx = c.getContext('2d');
  const orbs = [];
  const resize = () => { c.width = innerWidth; c.height = innerHeight; };
  const mkOrb = () => ({
    x: Math.random()*c.width, y: Math.random()*c.height,
    r: 160+Math.random()*200, vx:(Math.random()-.5)*.22, vy:(Math.random()-.5)*.22,
    hue:[260,245,275][Math.floor(Math.random()*3)], a:.05+Math.random()*.07
  });
  function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    orbs.forEach(o=>{
      const g=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
      g.addColorStop(0,`hsla(${o.hue},78%,60%,${o.a})`);
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2); ctx.fill();
      o.x+=o.vx; o.y+=o.vy;
      if(o.x<-o.r)o.x=c.width+o.r; if(o.x>c.width+o.r)o.x=-o.r;
      if(o.y<-o.r)o.y=c.height+o.r; if(o.y>c.height+o.r)o.y=-o.r;
    });
    requestAnimationFrame(draw);
  }
  resize(); window.addEventListener('resize',resize);
  for(let i=0;i<5;i++) orbs.push(mkOrb());
  draw();
})();

// ── Markdown renderer ──────────────────────────────────────────────────────
function md(text){
  let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g,(_,l,c)=>`<pre><code>${c.trim()}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  h = h.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm,'<h1>$1</h1>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/(^|\n)([ \t]*[-*] .+(\n[ \t]*[-*] .+)*)/g,(_,p,l)=>{
    const items=l.trim().split('\n').map(x=>`<li>${x.replace(/^[ \t]*[-*] /,'')}</li>`).join('');
    return `${p}<ul>${items}</ul>`;
  });
  h = h.replace(/(^|\n)([ \t]*\d+\. .+(\n[ \t]*\d+\. .+)*)/g,(_,p,l)=>{
    const items=l.trim().split('\n').map(x=>`<li>${x.replace(/^[ \t]*\d+\. /,'')}</li>`).join('');
    return `${p}<ol>${items}</ol>`;
  });
  h = h.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean)
    .map(p=>/^<(h[1-6]|ul|ol|pre)/.test(p)?p:`<p>${p.replace(/\n/g,'<br>')}</p>`).join('\n');
  return h;
}

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

// ── Avatar SVG ─────────────────────────────────────────────────────────────
const AV = `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="18" cy="5"  r="2.5" fill="currentColor"/>
  <circle cx="29" cy="12" r="2"   fill="currentColor" opacity=".7"/>
  <circle cx="7"  cy="12" r="2"   fill="currentColor" opacity=".7"/>
  <circle cx="18" cy="18" r="3.5" fill="currentColor"/>
  <circle cx="27" cy="25" r="2"   fill="currentColor" opacity=".6"/>
  <circle cx="9"  cy="25" r="2"   fill="currentColor" opacity=".6"/>
</svg>`;

// ── Web-search trigger keywords (mirrors backend) ──────────────────────────
const SPORTS_KW = ['ipl','cricket','match','winner','score','wicket','t20','football','goal','result','final','world cup'];
const SEARCH_KW = ['today','latest','current','now','recent','news','price','weather','update','live','stock','2025','2026'];
function needsWebSearch(q){ const lq=q.toLowerCase(); return SPORTS_KW.some(k=>lq.includes(k))||SEARCH_KW.some(k=>lq.includes(k)); }

// ── Scroll ─────────────────────────────────────────────────────────────────
function scrollBottom(){ feedEl.scrollTo({top:feedEl.scrollHeight,behavior:'smooth'}); }

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg,err=false){
  toastEl.textContent=msg; toastEl.className='toast show'+(err?' err':'');
  clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.className='toast',3000);
}

// ── Typing indicator ───────────────────────────────────────────────────────
function showTyping(){
  const r=document.createElement('div'); r.id='typing'; r.className='typing-row';
  r.innerHTML=`<div class="ai-av">${AV}</div><div class="dots"><span></span><span></span><span></span></div>`;
  feedEl.appendChild(r); scrollBottom();
}
function hideTyping(){ document.getElementById('typing')?.remove(); }

// ── Append message ─────────────────────────────────────────────────────────
function append(role, content, raw=false, webSearch=false){
  if(messages.length<=1 && welcomeEl) welcomeEl.style.display='none';
  const row=document.createElement('div'); row.className=`row ${role}`;
  if(role==='assistant'){
    const av=document.createElement('div'); av.className='ai-av'; av.innerHTML=AV; row.appendChild(av);
  }
  const bub=document.createElement('div'); bub.className='bubble';
  if(role==='assistant'&&webSearch){
    const badge=document.createElement('div'); badge.className='web-badge';
    badge.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>
    </svg><span id="badge-txt">Web search used</span>`;
    bub.appendChild(badge);
  }
  const inner=document.createElement('div');
  if(raw) inner.innerHTML=content;
  else inner.innerHTML=role==='assistant'?md(content):esc(content);
  bub.appendChild(inner); row.appendChild(bub); feedEl.appendChild(row); scrollBottom();
  return inner;
}

// ── Send message ───────────────────────────────────────────────────────────
async function send(text){
  if(!text.trim()||isTyping) return;
  isTyping=true; sendEl.disabled=true;
  messages.push({role:'user',content:text});
  append('user',text);
  showTyping();
  const willSearch=needsWebSearch(text);

  try{
    const res=await fetch('/api/chat/stream',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages,stream:true})
    });
    if(!res.ok){
      const e=await res.json().catch(()=>({}));
      throw new Error(e.detail||`Server error ${res.status}`);
    }
    hideTyping();

    // Build assistant bubble
    const row=document.createElement('div'); row.className='row assistant';
    const av=document.createElement('div'); av.className='ai-av'; av.innerHTML=AV; row.appendChild(av);
    const bub=document.createElement('div'); bub.className='bubble';
    if(willSearch){
      const badge=document.createElement('div'); badge.className='web-badge';
      badge.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>
      </svg> Searching the web…`;
      bub.appendChild(badge);
    }
    const inner=document.createElement('div');
    inner.innerHTML='<span class="cursor"></span>';
    bub.appendChild(inner); row.appendChild(bub); feedEl.appendChild(row); scrollBottom();

    // Stream tokens
    const reader=res.body.getReader(), dec=new TextDecoder();
    let buf='', acc='';
    while(true){
      const{done,value}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){
        if(!line.startsWith('data:')) continue;
        const raw=line.slice(5).trim();
        if(raw==='[DONE]') break;
        try{
          const delta=JSON.parse(raw).choices?.[0]?.delta?.content;
          if(delta){ acc+=delta; inner.innerHTML=md(acc)+'<span class="cursor"></span>'; scrollBottom(); }
        }catch{}
      }
    }
    inner.innerHTML=md(acc);
    if(willSearch){ const b=bub.querySelector('.web-badge'); if(b) b.innerHTML=b.innerHTML.replace('Searching the web…','Web search used'); }
    messages.push({role:'assistant',content:acc});
    saveSession();

  }catch(err){
    hideTyping(); console.error(err);
    append('assistant', err.message.includes('GROQ_API_KEY')
      ? '⚠️ API key not configured. Check your environment variables.'
      : `❌ ${err.message||'Something went wrong.'}`);
    toast('Request failed',true);
  }finally{
    isTyping=false;
    sendEl.disabled=!inputEl.value.trim();
    inputEl.focus();
  }
}

// ── Sessions ───────────────────────────────────────────────────────────────
function saveSession(){
  if(!messages.length) return;
  if(!currentId) currentId=Date.now().toString();
  const title=messages[0].content.slice(0,44)+(messages[0].content.length>44?'…':'');
  const idx=sessions.findIndex(s=>s.id===currentId);
  const entry={id:currentId,title,messages:[...messages]};
  if(idx>=0) sessions[idx]=entry; else sessions.unshift(entry);
  renderHistory();
}
function renderHistory(){
  historyEl.querySelectorAll('.history-item').forEach(e=>e.remove());
  sessions.forEach(s=>{
    const b=document.createElement('button'); b.className='history-item'+(s.id===currentId?' active':'');
    b.textContent=s.title; b.onclick=()=>loadSession(s.id); historyEl.appendChild(b);
  });
}
function loadSession(id){
  const s=sessions.find(s=>s.id===id); if(!s) return;
  currentId=id; messages=[...s.messages];
  feedEl.innerHTML='';
  if(welcomeEl){feedEl.appendChild(welcomeEl);welcomeEl.style.display='none';}
  messages.forEach(m=>append(m.role,m.content));
  renderHistory(); closeSidebar();
}
function newChat(){
  currentId=null; messages=[]; feedEl.innerHTML='';
  if(welcomeEl){feedEl.appendChild(welcomeEl);welcomeEl.style.display='flex';}
  renderHistory(); closeSidebar(); inputEl.focus();
}

// ── Sidebar ────────────────────────────────────────────────────────────────
let ov=null;
function openSidebar(){
  sidebarEl.classList.add('open');
  if(!ov){ov=document.createElement('div');ov.className='overlay';ov.onclick=closeSidebar;document.body.appendChild(ov);}
  ov.classList.add('on');
}
function closeSidebar(){sidebarEl.classList.remove('open');ov?.classList.remove('on');}

// ── Events ─────────────────────────────────────────────────────────────────
sendEl.onclick=()=>{ const t=inputEl.value.trim(); if(!t) return; inputEl.value=''; resize(); send(t); };
inputEl.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendEl.click();} });
inputEl.addEventListener('input',()=>{ sendEl.disabled=!inputEl.value.trim()||isTyping; resize(); });
function resize(){ inputEl.style.height='auto'; inputEl.style.height=Math.min(inputEl.scrollHeight,180)+'px'; }
document.querySelectorAll('.chip').forEach(c=>{ c.onclick=()=>{ inputEl.value=c.dataset.p; resize(); sendEl.disabled=false; sendEl.click(); }; });
clearEl.onclick=()=>{ if(!messages.length) return; newChat(); toast('Conversation cleared'); };
newChatEl.onclick=newChat;
menuEl.onclick=openSidebar;
closeEl.onclick=closeSidebar;

// ── Init ───────────────────────────────────────────────────────────────────
(async function init(){
  try{
    const[mr,hr]=await Promise.all([fetch('/api/models'),fetch('/health')]);
    const md=await mr.json(), hd=await hr.json();
    modelEl.textContent=md.current||'OrionAI';
    if(hd.web_search_ready&&webRowEl) webRowEl.style.display='flex';
  }catch{ modelEl.textContent='OrionAI'; }
  inputEl.focus();
})();
