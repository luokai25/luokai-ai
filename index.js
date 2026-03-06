const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

// ============================================
//  LUO KAI - Personal AI Agent
// ============================================

const OPENROUTER_API_KEY = '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 ';
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';

let browser = null;
let page = null;

// Start browser
async function startBrowser() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ]
  });
  page = await browser.newPage();
  console.log('🌐 Browser started!');
}

// Ask AI
async function askAI(message, context) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openrouter/auto',
        messages: [
          {
            role: 'system',
            content: `You are Luo Kai, a powerful personal AI assistant. 
You can browse the web, click buttons, fill forms, search anything, and complete tasks autonomously.
Current browser context: ${context || 'No page open'}`
          },
          {
            role: 'user',
            content: message
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    return 'Sorry, AI error: ' + err.message;
  }
}

// Browse a website
async function browseWeb(url) {
  try {
    if (!page) await startBrowser();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    const content = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    return `📄 Page: ${title}\n\n${content}`;
  } catch (err) {
    return 'Browser error: ' + err.message;
  }
}

// Click something on page
async function clickOnPage(text) {
  try {
    await page.evaluate((txt) => {
      const elements = document.querySelectorAll('a, button, input[type=submit]');
      for (let el of elements) {
        if (el.innerText && el.innerText.toLowerCase().includes(txt.toLowerCase())) {
          el.click();
          return true;
        }
      }
    }, text);
    await page.waitForTimeout(2000);
    const content = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    return `✅ Clicked! New page content:\n${content}`;
  } catch (err) {
    return 'Click error: ' + err.message;
  }
}

// Type into a field
async function typeIntoPage(selector, text) {
  try {
    await page.type(selector, text);
    return `✅ Typed "${text}" successfully!`;
  } catch (err) {
    return 'Type error: ' + err.message;
  }
}

// Search Google
async function searchGoogle(query) {
  try {
    if (!page) await startBrowser();
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, 
      { waitUntil: 'domcontentloaded' });
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll('h3');
      return Array.from(items).slice(0, 5).map(h => h.innerText).join('\n');
    });
    return `🔍 Google results for "${query}":\n\n${results}`;
  } catch (err) {
    return 'Search error: ' + err.message;
  }
}

// Take screenshot description
async function getPageInfo() {
  try {
    const url = page.url();
    const title = await page.title();
    const content = await page.evaluate(() => document.body.innerText.slice(0, 1000));
    return `🌐 URL: ${url}\n📄 Title: ${title}\n\n${content}`;
  } catch (err) {
    return 'Page info error: ' + err.message;
  }
}

// Process commands from WhatsApp
async function processCommand(message) {
  const msg = message.trim().toLowerCase();

  // Browse command
  if (msg.startsWith('go to ') || msg.startsWith('open ') || msg.startsWith('browse ')) {
    let url = message.split(' ').slice(2).join(' ');
    if (!url.startsWith('http')) url = 'https://' + url;
    return await browseWeb(url);
  }

  // Search command
  if (msg.startsWith('search ') || msg.startsWith('google ')) {
    const query = message.split(' ').slice(1).join(' ');
    return await searchGoogle(query);
  }

  // Click command
  if (msg.startsWith('click ')) {
    const target = message.split(' ').slice(1).join(' ');
    return await clickOnPage(target);
  }

  // Page info
  if (msg === 'where am i' || msg === 'what page' || msg === 'current page') {
    return await getPageInfo();
  }

  // AI for everything else
  const context = page ? page.url() : 'No page open';
  return await askAI(message, context);
}

// ============================================
// WHATSAPP CLIENT
// ============================================

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('\n🦞 LUO KAI - Scan this QR code with WhatsApp:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nGo to WhatsApp > Linked Devices > Link a Device > Scan QR\n');
});

client.on('ready', async () => {
  console.log('\n✅ Luo Kai is ready and connected to WhatsApp!');
  console.log('🦞 Send a message to start!\n');
  await startBrowser();
});

const MY_NUMBER = '269788924350632@lid';
client.on('message', async (msg) => {

  if (msg.from !== MY_NUMBER) return;
  console.log(`📩 Message from ${msg.from}: ${msg.body}`);
  
  // Send typing indicator
  const chat = await msg.getChat();
  await chat.sendStateTyping();

  try {
    const response = await processCommand(msg.body);
    await msg.reply(response);
    console.log(`✅ Replied: ${response.slice(0, 100)}...`);
  } catch (err) {
    await msg.reply('❌ Error: ' + err.message);
  }
});

client.on('auth_failure', () => {
  console.log('❌ Auth failed! Delete .wwebjs_auth folder and restart');
});

client.on('disconnected', () => {
  console.log('❌ Disconnected! Restarting...');
  client.initialize();
});

// Start Luo Kai
console.log('🦞 Starting Luo Kai...');
client.initialize();


// ============================================
// SELF IMPROVEMENT SYSTEM
// ============================================
const fs2 = require('fs'); const axios2 = require('axios'); const { exec } = require('child_process');

const DATA_DIR = '/data/data/com.termux/files/home/luokai/data';
const MEMORY_FILE = `${DATA_DIR}/memory.json`;
const UPGRADE_FILE = `${DATA_DIR}/pending_upgrade.json`;
const INDEX_FILE = '/data/data/com.termux/files/home/luokai/index.js';

if (!fs2.existsSync(DATA_DIR)) fs2.mkdirSync(DATA_DIR, { recursive: true });

function loadMemory() {
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs2.readFileSync(MEMORY_FILE,'utf8')); } catch(e) {}
  return { knowledge:{}, conversations:[], errors:[], improvements:[], version:1 };
}
function saveMemory(m) { fs2.writeFileSync(MEMORY_FILE, JSON.stringify(m,null,2)); }
function saveConversation(user,bot) { const m=loadMemory(); m.conversations.push({user,bot:bot?.slice(0,200),time:new Date().toISOString()}); saveMemory(m); }
function logError(error) { const m=loadMemory(); m.errors.push({error,time:new Date().toISOString()}); saveMemory(m); }

function getApiKey() {
  try {
    const code=fs.readFileSync(INDEX_FILE,'utf8');
    const match=code.match(/OPENROUTER_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    return match?match[1]:null;
  } catch(e) { return null; }
}

async function analyzeSelf() {
  const apiKey=getApiKey();
  if (!apiKey) return null;
  const m=loadMemory();
  const errors=m.errors.slice(-10).map(e=>e.error).join('\n');
  const convs=m.conversations.slice(-20).map(c=>`User:${c.user}|Me:${c.bot?.slice(0,50)}`).join('\n');
  try {
    const r=await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:'Analyze this AI agent and propose improvements. Return ONLY JSON: {"shouldUpgrade":true,"reason":"why","improvements":["imp1","imp2"],"priority":"high/medium/low"}' },
        { role:'user', content:`Version:${m.version}\nErrors:\n${errors||'None'}\nConversations:\n${convs}\nWhat should I improve?` }
      ]},
      { headers:{ Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json' }}
    );
    const text=r.data.choices[0].message.content;
    const clean=text.replace(/```json|```/g,'').trim();
    return JSON.parse(clean.substring(clean.indexOf('{'),clean.lastIndexOf('}')+1));
  } catch(e) { return null; }
}

async function writeUpgrade(improvements) {
  const apiKey=getApiKey();
  if (!apiKey) return null;
  const currentCode=fs.readFileSync(INDEX_FILE,'utf8');
  try {
    const r=await axios.post('https://openrouter.ai/api/v1/chat/completions',
      { model:'openrouter/auto', messages:[
        { role:'system', content:'Expert Node.js developer. Improve the code. Return ONLY pure JavaScript. No markdown. No backticks.' },
        { role:'user', content:`Code:\n${currentCode.slice(0,6000)}\n\nImprovements:\n${improvements.join('\n')}\n\nReturn complete improved code:` }
      ]},
      { headers:{ Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json' }}
    );
    return r.data.choices[0].message.content;
  } catch(e) { return null; }
}

async function runSelfImprovement(sendFn) {
  console.log('🔍 Analyzing myself...');
  const analysis=await analyzeSelf();
  if (!analysis||!analysis.shouldUpgrade) { console.log('✅ No improvements needed'); return; }
  const newCode=await writeUpgrade(analysis.improvements);
  if (!newCode) return;
  fs2.writeFileSync(UPGRADE_FILE,JSON.stringify({ reason:analysis.reason, improvements:analysis.improvements, priority:analysis.priority, newCode, time:new Date().toISOString() },null,2));
  await sendFn(
    `🧬 *Luo Kai wants to upgrade himself!*\n\n`+
    `📊 Priority: *${analysis.priority}*\n`+
    `💡 Reason: ${analysis.reason}\n\n`+
    `📈 *Improvements:*\n${analysis.improvements.map(i=>`• ${i}`).join('\n')}\n\n`+
    `Reply *approve upgrade* to install\n`+
    `Reply *reject upgrade* to skip`
  );
}

async function applyUpgrade() {
  if (!fs2.existsSync(UPGRADE_FILE)) return '❌ No pending upgrade!';
  const upgrade=JSON.parse(fs.readFileSync(UPGRADE_FILE,'utf8'));
  fs.writeFileSync(INDEX_FILE.replace('index.js','index.backup.js'),fs.readFileSync(INDEX_FILE,'utf8'));
  const m=loadMemory(); m.version++; m.improvements.push({version:m.version,improvements:upgrade.improvements,time:new Date().toISOString()}); saveMemory(m);
  fs.writeFileSync(INDEX_FILE,upgrade.newCode);
  fs2.unlinkSync(UPGRADE_FILE);
  setTimeout(()=>{ exec('cd ~/luokai && node index.js'); process.exit(0); },2000);
  return `✅ *Upgraded to v${m.version}!*\n\n${upgrade.improvements.map(i=>`• ${i}`).join('\n')}\n\n🔄 Restarting...`;
}

function getStats() {
  const m=loadMemory();
  return `📊 *Luo Kai Stats:*\n\n🧬 Version: ${m.version}\n💬 Conversations: ${m.conversations.length}\n⚠️ Errors logged: ${m.errors.length}\n📈 Upgrades applied: ${m.improvements.length}`;
}

// Override client message handler to include upgrade commands and memory
client.removeAllListeners('message');
client.on('message', async (msg) => {
  if (msg.from !== MY_NUMBER) return;
  console.log(`📩 ${msg.body}`);
  const chat=await msg.getChat();
  await chat.sendStateTyping();
  const sendFn=async(text)=>{ await msg.reply(text); };

  // Upgrade commands
  if (msg.body.toLowerCase()==='approve upgrade') { await msg.reply(await applyUpgrade()); return; }
  if (msg.body.toLowerCase()==='reject upgrade') { if (fs2.existsSync(UPGRADE_FILE)) fs2.unlinkSync(UPGRADE_FILE); await msg.reply('❌ Upgrade rejected!'); return; }
  if (msg.body.toLowerCase()==='my stats') { await msg.reply(getStats()); return; }
  if (msg.body.toLowerCase()==='analyze yourself' || msg.body.toLowerCase()==='self improve') { await msg.reply('🔍 Analyzing...'); await runSelfImprovement(sendFn); return; }

  try {
    const response=await processCommand(msg.body);
    if (response) {
      await msg.reply(response);
      saveConversation(msg.body,response);
      console.log(`✅ Replied: ${response.slice(0,100)}...`);
    }
  } catch(err) {
    logError(err.message);
    await msg.reply('❌ Error: '+err.message);
  }
});

// Self improve every 30 minutes automatically
let globalSendFn = null;
client.on('ready', async()=>{
  globalSendFn = async(text)=>{
    try {
      const chats=await client.getChats();
      const chat=chats.find(c=>c.id._serialized===MY_NUMBER);
      if (chat) await chat.sendMessage(text);
    } catch(e) {}
  };
  setInterval(()=>runSelfImprovement(globalSendFn), 1800000);
});

console.log('🧠 Self improvement system loaded!');
