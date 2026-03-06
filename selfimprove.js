const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');

const DATA_DIR = '/data/data/com.termux/files/home/luokai/data';
const MEMORY_FILE = `${DATA_DIR}/memory.json`;
const UPGRADE_FILE = `${DATA_DIR}/pending_upgrade.json`;
const INDEX_FILE = '/data/data/com.termux/files/home/luokai/index.js';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Get API key directly from index.js
function getApiKey() {
  try {
    const code = fs.readFileSync(INDEX_FILE, 'utf8');
    const match = code.match(/OPENROUTER_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  } catch(e) { return null; }
}

function loadMemory() {
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE,'utf8')); } catch(e) {}
  return { knowledge:{}, conversations:[], facts:[], errors:[], improvements:[], version:1 };
}

function saveMemory(m) { fs.writeFileSync(MEMORY_FILE, JSON.stringify(m,null,2)); }

function remember(key, value) {
  const m = loadMemory();
  m.knowledge[key] = { value, time: new Date().toISOString() };
  saveMemory(m);
}

function saveConversation(user, bot) {
  const m = loadMemory();
  m.conversations.push({ user, bot: bot?.slice(0,300), time: new Date().toISOString() });
  saveMemory(m);
}

function logError(error) {
  const m = loadMemory();
  m.errors.push({ error, time: new Date().toISOString() });
  saveMemory(m);
}

function getContext() {
  const m = loadMemory();
  return {
    recentConvs: m.conversations.slice(-10).map(c=>`User:${c.user}\nMe:${c.bot?.slice(0,100)}`).join('\n---\n'),
    knowledge: Object.entries(m.knowledge).map(([k,v])=>`${k}:${v.value}`).join('\n'),
    recentErrors: m.errors.slice(-5).map(e=>e.error).join('\n'),
    version: m.version
  };
}

async function analyzeSelf() {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const m = loadMemory();
  const errors = m.errors.slice(-10).map(e=>e.error).join('\n');
  const convs = m.conversations.slice(-20).map(c=>`User:${c.user}|Me:${c.bot?.slice(0,50)}`).join('\n');
  try {
    const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:'Analyze this AI and propose improvements. Return ONLY JSON: {"shouldUpgrade":true,"reason":"why","improvements":["imp1","imp2"],"priority":"high/medium/low"}' },
        { role:'user', content:`Version:${m.version}\nErrors:\n${errors||'None'}\nConversations:\n${convs}\nWhat should I improve?` }
      ]},
      { headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' }}
    );
    const text = r.data.choices[0].message.content;
    const clean = text.replace(/```json|```/g,'').trim();
    return JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}')+1));
  } catch(e) { return null; }
}

async function writeUpgrade(improvements) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const currentCode = fs.readFileSync(INDEX_FILE,'utf8');
  try {
    const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:'You are an expert Node.js developer. Improve the code based on the improvements list. IMPORTANT: Keep the same API key, MY_NUMBER, and CHROMIUM_PATH variables. Return ONLY pure JavaScript. No markdown. No explanations.' },
        { role:'user', content:`Current code:\n${currentCode.slice(0,8000)}\n\nImprovements to make:\n${improvements.join('\n')}\n\nWrite the complete improved code:` }
      ]},
      { headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' }}
    );
    return r.data.choices[0].message.content;
  } catch(e) { return null; }
}

async function runSelfImprovement(sendApprovalRequest) {
  console.log('🔍 Analyzing myself...');
  const analysis = await analyzeSelf();
  if (!analysis || !analysis.shouldUpgrade) {
    console.log('✅ No improvements needed right now');
    return;
  }
  console.log(`📈 Improvements found: ${analysis.improvements.join(', ')}`);
  console.log('✍️ Writing upgrade code...');
  const newCode = await writeUpgrade(analysis.improvements);
  if (!newCode) { console.log('❌ Failed to write upgrade'); return; }
  fs.writeFileSync(UPGRADE_FILE, JSON.stringify({
    reason: analysis.reason,
    improvements: analysis.improvements,
    priority: analysis.priority,
    newCode,
    time: new Date().toISOString()
  }, null, 2));
  await sendApprovalRequest(
    `🧬 *Luo Kai wants to upgrade himself!*\n\n` +
    `📊 Priority: *${analysis.priority}*\n` +
    `💡 Reason: ${analysis.reason}\n\n` +
    `📈 *Improvements:*\n${analysis.improvements.map(i=>`• ${i}`).join('\n')}\n\n` +
    `Reply *approve upgrade* to install ✅\n` +
    `Reply *reject upgrade* to skip ❌`
  );
}

async function applyUpgrade() {
  if (!fs.existsSync(UPGRADE_FILE)) return '❌ No pending upgrade!';
  const upgrade = JSON.parse(fs.readFileSync(UPGRADE_FILE,'utf8'));
  // Backup current code
  fs.writeFileSync(INDEX_FILE.replace('index.js','index.backup.js'), fs.readFileSync(INDEX_FILE,'utf8'));
  // Update memory version
  const m = loadMemory();
  m.version++;
  m.improvements.push({ version:m.version, improvements:upgrade.improvements, time:new Date().toISOString() });
  saveMemory(m);
  // Write new code
  fs.writeFileSync(INDEX_FILE, upgrade.newCode);
  // Delete pending upgrade
  fs.unlinkSync(UPGRADE_FILE);
  const result = `✅ *Upgrade applied!*\nNow on version: ${m.version}\n\n*What improved:*\n${upgrade.improvements.map(i=>`• ${i}`).join('\n')}\n\n🔄 Restarting...`;
  // Restart after 3 seconds
  setTimeout(() => { process.exit(0); }, 3000);
  return result;
}

function rejectUpgrade() {
  if (fs.existsSync(UPGRADE_FILE)) fs.unlinkSync(UPGRADE_FILE);
  return '❌ *Upgrade rejected!* Keeping current version.';
}

function getStats() {
  const m = loadMemory();
  return `📊 *Luo Kai Stats:*\n\n🔢 Version: ${m.version}\n💬 Conversations: ${m.conversations.length}\n🧠 Memories: ${Object.keys(m.knowledge).length}\n⚠️ Errors logged: ${m.errors.length}\n📈 Total upgrades: ${m.improvements.length}`;
}

module.exports = { remember, saveConversation, logError, getContext, loadMemory, runSelfImprovement, applyUpgrade, rejectUpgrade, getStats, getApiKey };
