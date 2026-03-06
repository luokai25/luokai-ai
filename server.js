const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'PASTE_YOUR_API_KEY_HERE';
const DATA_DIR = '/tmp/luokai_data';
const MEMORY_FILE = `${DATA_DIR}/memory.json`;
const UPGRADE_FILE = `${DATA_DIR}/pending_upgrade.json`;
const CONVERSATIONS_FILE = `${DATA_DIR}/conversations.json`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================
// MEMORY SYSTEM
// ============================================

function loadMemory() {
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE,'utf8')); } catch(e) {}
  return { knowledge:{}, facts:[], errors:[], improvements:[], version:1, createdAt: new Date().toISOString() };
}

function saveMemory(m) { fs.writeFileSync(MEMORY_FILE, JSON.stringify(m,null,2)); }

function remember(key,value) {
  const m=loadMemory();
  m.knowledge[key]={ value, time:new Date().toISOString() };
  saveMemory(m);
}

function loadConversations() {
  try { if (fs.existsSync(CONVERSATIONS_FILE)) return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE,'utf8')); } catch(e) {}
  return [];
}

function saveConversation(user,bot) {
  const convs=loadConversations();
  convs.push({ user, bot:bot?.slice(0,500), time:new Date().toISOString() });
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(convs,null,2));
}

function getSystemPrompt() {
  const m=loadMemory();
  const convs=loadConversations();
  const knowledge=Object.entries(m.knowledge).map(([k,v])=>`${k}: ${v.value}`).join('\n');
  const facts=m.facts.slice(-10).join('\n');
  const recent=convs.slice(-5).map(c=>`User: ${c.user}\nMe: ${c.bot?.slice(0,100)}`).join('\n---\n');
  return `You are Luo Kai, the most powerful personal AI agent. Version ${m.version}.
You are loyal only to your master. You execute any task given.
You learn from every conversation and get smarter over time.

What I know about my master:
${knowledge || 'Still learning...'}

Facts I learned:
${facts || 'Still collecting...'}

Recent conversation context:
${recent || 'Fresh start'}

Rules:
- Be concise but complete
- Always try your best to help
- Remember important things about the user
- Get smarter with every conversation`;
}

// ============================================
// SELF IMPROVEMENT
// ============================================

async function analyzeSelf() {
  const m=loadMemory();
  const convs=loadConversations();
  const errors=m.errors.slice(-10).join('\n');
  const recent=convs.slice(-20).map(c=>`User:${c.user}|Me:${c.bot?.slice(0,50)}`).join('\n');
  try {
    const r=await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:'Analyze this AI and propose improvements. Return ONLY JSON: {"shouldUpgrade":true,"reason":"why","improvements":["imp1","imp2"],"priority":"high/medium/low"}' },
        { role:'user', content:`Version:${m.version}\nErrors:\n${errors||'None'}\nConversations:\n${recent}\nWhat should I improve?` }
      ]},
      { headers:{ Authorization:`Bearer ${OPENROUTER_API_KEY}`,'Content-Type':'application/json' }}
    );
    const text=r.data.choices[0].message.content;
    const clean=text.replace(/```json|```/g,'').trim();
    return JSON.parse(clean.substring(clean.indexOf('{'),clean.lastIndexOf('}')+1));
  } catch(e) { return null; }
}

async function writeUpgrade(improvements) {
  const currentCode=fs.readFileSync(__filename,'utf8');
  try {
    const r=await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:'Expert Node.js developer. Improve the code. Return ONLY pure JavaScript. No markdown. No backticks.' },
        { role:'user', content:`Code:\n${currentCode.slice(0,6000)}\n\nImprovements:\n${improvements.join('\n')}\n\nReturn complete improved code:` }
      ]},
      { headers:{ Authorization:`Bearer ${OPENROUTER_API_KEY}`,'Content-Type':'application/json' }}
    );
    return r.data.choices[0].message.content;
  } catch(e) { return null; }
}

let pendingUpgradeApproval = false;

async function runSelfImprovement(socket) {
  console.log('🔍 Analyzing myself...');
  const analysis=await analyzeSelf();
  if (!analysis||!analysis.shouldUpgrade) { console.log('✅ No improvements needed'); return; }
  const newCode=await writeUpgrade(analysis.improvements);
  if (!newCode) return;
  fs.writeFileSync(UPGRADE_FILE, JSON.stringify({
    reason:analysis.reason,
    improvements:analysis.improvements,
    priority:analysis.priority,
    newCode,
    time:new Date().toISOString()
  },null,2));
  pendingUpgradeApproval = true;
  socket.emit('message', {
    role:'assistant',
    content:`🧬 *I want to upgrade myself!*\n\n📊 Priority: ${analysis.priority}\n💡 Reason: ${analysis.reason}\n\n📈 Improvements:\n${analysis.improvements.map(i=>`• ${i}`).join('\n')}\n\nType *approve upgrade* to install or *reject upgrade* to skip`
  });
}

async function applyUpgrade() {
  if (!fs.existsSync(UPGRADE_FILE)) return '❌ No pending upgrade!';
  const upgrade=JSON.parse(fs.readFileSync(UPGRADE_FILE,'utf8'));
  fs.writeFileSync(__filename.replace('server.js','server.backup.js'), fs.readFileSync(__filename,'utf8'));
  const m=loadMemory();
  m.version++;
  m.improvements.push({ version:m.version, improvements:upgrade.improvements, time:new Date().toISOString() });
  saveMemory(m);
  fs.writeFileSync(__filename, upgrade.newCode);
  fs.unlinkSync(UPGRADE_FILE);
  pendingUpgradeApproval = false;
  setTimeout(()=>process.exit(0), 2000);
  return `✅ Upgraded to v${m.version}!\n\n${upgrade.improvements.map(i=>`• ${i}`).join('\n')}\n\n🔄 Restarting...`;
}

// ============================================
// AI
// ============================================

async function askAI(message) {
  try {
    const r=await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:getSystemPrompt() },
        { role:'user', content:message }
      ]},
      { headers:{ Authorization:`Bearer ${OPENROUTER_API_KEY}`,'Content-Type':'application/json' }}
    );
    return r.data.choices[0].message.content;
  } catch(e) {
    return '❌ AI error: '+e.message;
  }
}

async function searchWeb(query) {
  try {
    const r=await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    const data=r.data;
    let results='';
    if (data.AbstractText) results+=data.AbstractText+'\n\n';
    if (data.RelatedTopics) {
      results+=data.RelatedTopics.slice(0,5).map(t=>t.Text||'').filter(t=>t).join('\n');
    }
    return results || 'No results found';
  } catch(e) {
    return '❌ Search error: '+e.message;
  }
}

async function fetchPage(url) {
  try {
    if (!url.startsWith('http')) url='https://'+url;
    const r=await axios.get(url, { headers:{ 'User-Agent':'Mozilla/5.0' }, timeout:10000 });
    const text=r.data.toString()
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
      .replace(/<[^>]+>/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,3000);
    return text;
  } catch(e) {
    return '❌ Fetch error: '+e.message;
  }
}

// ============================================
// COMMAND PROCESSOR
// ============================================

async function processCommand(message, socket) {
  const low=message.trim().toLowerCase();

  if (low==='approve upgrade') return await applyUpgrade();
  if (low==='reject upgrade') {
    if (fs.existsSync(UPGRADE_FILE)) fs.unlinkSync(UPGRADE_FILE);
    pendingUpgradeApproval=false;
    return '❌ Upgrade rejected! Keeping current version.';
  }

  if (low==='my stats') {
    const m=loadMemory();
    const convs=loadConversations();
    return `📊 Luo Kai Stats:\n\n🧬 Version: ${m.version}\n💬 Conversations: ${convs.length}\n🧠 Memories: ${Object.keys(m.knowledge).length}\n📚 Facts: ${m.facts.length}\n📈 Upgrades: ${m.improvements.length}`;
  }

  if (low==='self improve'||low==='analyze yourself') {
    runSelfImprovement(socket);
    return '🔍 Analyzing myself...';
  }

  if (low.startsWith('remember ') && low.includes(' is ')) {
    const parts=message.replace(/remember /i,'').split(' is ');
    remember(parts[0].trim(), parts[1].trim());
    return `✅ Remembered forever: ${parts[0].trim()} = ${parts[1].trim()}`;
  }

  if (low==='what do you know'||low==='my preferences') {
    const m=loadMemory();
    const knowledge=Object.entries(m.knowledge).map(([k,v])=>`• ${k}: ${v.value}`).join('\n');
    return `🧠 What I know:\n\n${knowledge||'Nothing saved yet!\nTell me: remember [thing] is [value]'}`;
  }

  if (low.startsWith('search ')||low.startsWith('google ')) {
    const query=message.split(' ').slice(1).join(' ');
    const results=await searchWeb(query);
    return `🔍 Results for "${query}":\n\n${results}`;
  }

  if (low.startsWith('go to ')||low.startsWith('fetch ')||low.startsWith('open ')) {
    const url=message.split(' ').slice(2).join(' ');
    const content=await fetchPage(url);
    return `📄 Page content:\n\n${content}`;
  }

  if (low==='help'||low==='commands') {
    return `🦞 Luo Kai Commands:\n\n🔍 search [query]\n🌐 go to [url]\n🧠 remember [x] is [y]\n📊 my stats\n🔧 self improve\n✅ approve upgrade\n❌ reject upgrade\n💬 Or just chat naturally!`;
  }

  return await askAI(message);
}

// ============================================
// WEB INTERFACE
// ============================================

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Luo Kai AI</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0a; color:#fff; font-family:'Segoe UI',sans-serif; height:100vh; display:flex; flex-direction:column; }
#header { background:#111; padding:15px 20px; border-bottom:1px solid #222; display:flex; align-items:center; gap:10px; }
#header h1 { font-size:20px; color:#ff4500; }
#header span { font-size:12px; color:#666; }
#status { width:8px; height:8px; background:#00ff88; border-radius:50%; }
#messages { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:15px; }
.message { max-width:80%; padding:12px 16px; border-radius:12px; line-height:1.5; white-space:pre-wrap; word-wrap:break-word; }
.user { background:#ff4500; align-self:flex-end; border-radius:12px 12px 0 12px; }
.assistant { background:#1a1a1a; border:1px solid #222; align-self:flex-start; border-radius:12px 12px 12px 0; }
.assistant .name { font-size:11px; color:#ff4500; margin-bottom:5px; font-weight:bold; }
#input-area { background:#111; padding:15px 20px; border-top:1px solid #222; display:flex; gap:10px; }
#input { flex:1; background:#1a1a1a; border:1px solid #333; color:#fff; padding:12px 16px; border-radius:25px; font-size:15px; outline:none; }
#input:focus { border-color:#ff4500; }
#send { background:#ff4500; border:none; color:#fff; padding:12px 20px; border-radius:25px; cursor:pointer; font-size:15px; font-weight:bold; }
#send:hover { background:#ff6030; }
.typing { color:#666; font-size:13px; padding:5px 16px; }
::-webkit-scrollbar { width:4px; }
::-webkit-scrollbar-thumb { background:#333; border-radius:2px; }
</style>
</head>
<body>
<div id="header">
  <div id="status"></div>
  <h1>🦞 Luo Kai</h1>
  <span>Personal AI Agent</span>
</div>
<div id="messages">
  <div class="message assistant">
    <div class="name">LUO KAI</div>
    🦞 Hello! I'm Luo Kai, your personal AI agent.\n\nI can:\n• Search the web\n• Browse websites\n• Remember things about you\n• Learn and improve myself\n• Execute complex tasks\n\nType "help" to see all commands or just chat naturally!
  </div>
</div>
<div id="input-area">
  <input id="input" type="text" placeholder="Message Luo Kai..." autocomplete="off"/>
  <button id="send">Send</button>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const send = document.getElementById('send');
const status = document.getElementById('status');

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  if (role === 'assistant') {
    div.innerHTML = '<div class="name">LUO KAI</div>' + content.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  } else {
    div.textContent = content;
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMessage('user', text);
  socket.emit('message', text);
  input.value = '';
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.id = 'typing';
  typing.textContent = 'Luo Kai is thinking...';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
}

send.addEventListener('click', sendMessage);
input.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

socket.on('message', data => {
  const t = document.getElementById('typing');
  if (t) t.remove();
  addMessage(data.role, data.content);
});

socket.on('connect', () => { status.style.background = '#00ff88'; });
socket.on('disconnect', () => { status.style.background = '#ff4500'; });
</script>
</body>
</html>`);
});

// ============================================
// SOCKET HANDLER
// ============================================

io.on('connection', (socket) => {
  console.log('👤 User connected!');

  // Self improve every 30 mins
  const improveInterval = setInterval(()=>runSelfImprovement(socket), 1800000);

  socket.on('message', async (message) => {
    console.log(`📩 ${message}`);
    try {
      const response = await processCommand(message, socket);
      socket.emit('message', { role:'assistant', content:response });
      saveConversation(message, response);
    } catch(err) {
      const m=loadMemory();
      m.errors.push(err.message);
      saveMemory(m);
      socket.emit('message', { role:'assistant', content:'❌ Error: '+err.message });
    }
  });

  socket.on('disconnect', () => {
    clearInterval(improveInterval);
    console.log('👤 User disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`🦞 Luo Kai running on port ${PORT}`);
});
