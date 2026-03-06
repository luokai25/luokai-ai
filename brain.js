const fs = require('fs');
const axios = require('axios');
const path = require('path');

// ============================================
//  LUO KAI - BRAIN & LEARNING SYSTEM
// ============================================

const DATA_DIR = '/data/data/com.termux/files/home/luokai/data';
const MEMORY_FILE = `${DATA_DIR}/memory.json`;
const LEARNING_FILE = `${DATA_DIR}/learning.json`;
const PERSONALITY_FILE = `${DATA_DIR}/personality.json`;
const CONVERSATIONS_FILE = `${DATA_DIR}/conversations.json`;
const SKILLS_FILE = `${DATA_DIR}/skills.json`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================
// MEMORY - NEVER FORGETS ANYTHING
// ============================================

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (e) {}
  return {
    knowledge: {},
    facts: [],
    history: [],
    websites: {},
    patterns: {},
    createdAt: new Date().toISOString()
  };
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function remember(key, value) {
  const memory = loadMemory();
  memory.knowledge[key] = {
    value,
    savedAt: new Date().toISOString(),
    accessCount: (memory.knowledge[key]?.accessCount || 0) + 1
  };
  saveMemory(memory);
}

function recall(key) {
  const memory = loadMemory();
  if (memory.knowledge[key]) {
    memory.knowledge[key].accessCount++;
    memory.knowledge[key].lastAccessed = new Date().toISOString();
    saveMemory(memory);
    return memory.knowledge[key].value;
  }
  return null;
}

function addFact(fact) {
  const memory = loadMemory();
  if (!memory.facts.includes(fact)) {
    memory.facts.push(fact);
    saveMemory(memory);
  }
}

function addToHistory(action, result, success) {
  const memory = loadMemory();
  memory.history.push({
    action,
    result: result?.slice(0, 200),
    success,
    time: new Date().toISOString()
  });
  saveMemory(memory);
}

function rememberWebsite(url, data) {
  const memory = loadMemory();
  memory.websites[url] = {
    ...data,
    visitCount: (memory.websites[url]?.visitCount || 0) + 1,
    lastVisited: new Date().toISOString()
  };
  saveMemory(memory);
}

function getMemoryContext() {
  const memory = loadMemory();
  const recentHistory = memory.history.slice(-20);
  const topKnowledge = Object.entries(memory.knowledge)
    .sort((a, b) => (b[1].accessCount || 0) - (a[1].accessCount || 0))
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${v.value}`)
    .join('\n');
  const recentFacts = memory.facts.slice(-10).join('\n');
  return { recentHistory, topKnowledge, recentFacts };
}

// ============================================
// CONVERSATIONS - FULL HISTORY FOREVER
// ============================================

function loadConversations() {
  try {
    if (fs.existsSync(CONVERSATIONS_FILE)) return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveConversation(userMessage, botResponse, context) {
  const conversations = loadConversations();
  conversations.push({
    id: Date.now(),
    user: userMessage,
    bot: botResponse?.slice(0, 500),
    context,
    time: new Date().toISOString(),
    learned: false
  });
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
  return conversations.length;
}

function getRecentConversations(count = 10) {
  const conversations = loadConversations();
  return conversations.slice(-count);
}

// ============================================
// LEARNING SYSTEM
// ============================================

function loadLearning() {
  try {
    if (fs.existsSync(LEARNING_FILE)) return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
  } catch (e) {}
  return {
    successPatterns: [],
    failurePatterns: [],
    improvements: [],
    skills: {},
    totalLearningCycles: 0,
    lastLearned: null
  };
}

function saveLearning(learning) {
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(learning, null, 2));
}

async function learnFromConversation(apiKey) {
  const conversations = loadConversations();
  const unlearned = conversations.filter(c => !c.learned).slice(-5);
  if (unlearned.length === 0) return;

  const learning = loadLearning();

  for (let conv of unlearned) {
    try {
      const analysis = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'openrouter/auto',
          messages: [
            {
              role: 'system',
              content: `You are analyzing a conversation to extract learning insights.
Return ONLY a JSON object like:
{
  "wasSuccessful": true/false,
  "userIntent": "what user wanted",
  "whatWorked": "what worked well",
  "whatFailed": "what failed if anything",
  "improvement": "how to do better next time",
  "newFact": "any new fact learned about user or world"
}`
            },
            {
              role: 'user',
              content: `User said: ${conv.user}\nI responded: ${conv.bot}`
            }
          ]
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
      );

      const text = analysis.data.choices[0].message.content;
      const clean = text.replace(/```json|```/g, '').trim();
      try {
        const insight = JSON.parse(clean);
        if (insight.wasSuccessful) {
          learning.successPatterns.push({
            pattern: insight.userIntent,
            approach: insight.whatWorked,
            time: new Date().toISOString()
          });
        } else {
          learning.failurePatterns.push({
            pattern: insight.userIntent,
            issue: insight.whatFailed,
            fix: insight.improvement,
            time: new Date().toISOString()
          });
        }
        if (insight.improvement) learning.improvements.push(insight.improvement);
        if (insight.newFact) addFact(insight.newFact);
      } catch (e) {}

      // Mark as learned
      conv.learned = true;
    } catch (e) {}
  }

  // Save learned conversations
  const allConvs = loadConversations();
  const unlearnedIds = unlearned.map(c => c.id);
  allConvs.forEach(c => {
    if (unlearnedIds.includes(c.id)) c.learned = true;
  });
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(allConvs, null, 2));

  learning.totalLearningCycles++;
  learning.lastLearned = new Date().toISOString();
  saveLearning(learning);
}

// ============================================
// PERSONALITY - EVOLVES OVER TIME
// ============================================

function loadPersonality() {
  try {
    if (fs.existsSync(PERSONALITY_FILE)) return JSON.parse(fs.readFileSync(PERSONALITY_FILE, 'utf8'));
  } catch (e) {}
  return {
    name: 'Luo Kai',
    traits: ['loyal', 'powerful', 'efficient', 'autonomous'],
    communicationStyle: 'direct and helpful',
    userPreferences: {},
    adaptations: [],
    version: 1
  };
}

async function evolvePersonality(apiKey) {
  const learning = loadLearning();
  const personality = loadPersonality();
  const memory = loadMemory();

  if (learning.improvements.length < 3) return;

  try {
    const evolution = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openrouter/auto',
        messages: [
          {
            role: 'system',
            content: `You are evolving an AI assistant's personality based on learnings.
Return ONLY a JSON object:
{
  "newTraits": ["trait1", "trait2"],
  "communicationStyle": "updated style",
  "adaptations": ["adaptation1", "adaptation2"]
}`
          },
          {
            role: 'user',
            content: `Current personality: ${JSON.stringify(personality)}
Recent improvements learned: ${learning.improvements.slice(-10).join('\n')}
Success patterns: ${learning.successPatterns.slice(-5).map(p => p.approach).join('\n')}
What I know about user: ${memory.facts.slice(-10).join('\n')}`
          }
        ]
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );

    const text = evolution.data.choices[0].message.content;
    const clean = text.replace(/```json|```/g, '').trim();
    try {
      const evolved = JSON.parse(clean);
      personality.traits = [...new Set([...personality.traits, ...evolved.newTraits])];
      personality.communicationStyle = evolved.communicationStyle;
      personality.adaptations = [...personality.adaptations, ...evolved.adaptations];
      personality.version++;
      personality.lastEvolved = new Date().toISOString();
      fs.writeFileSync(PERSONALITY_FILE, JSON.stringify(personality, null, 2));
      console.log(`🧬 Personality evolved to version ${personality.version}!`);
    } catch (e) {}
  } catch (e) {}
}

// ============================================
// SKILLS SYSTEM
// ============================================

function loadSkills() {
  try {
    if (fs.existsSync(SKILLS_FILE)) return JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
  } catch (e) {}
  return {
    browsing: { level: 1, uses: 0 },
    coding: { level: 1, uses: 0 },
    writing: { level: 1, uses: 0 },
    research: { level: 1, uses: 0 },
    planning: { level: 1, uses: 0 }
  };
}

function improveSkill(skillName) {
  const skills = loadSkills();
  if (!skills[skillName]) skills[skillName] = { level: 1, uses: 0 };
  skills[skillName].uses++;
  if (skills[skillName].uses % 10 === 0) {
    skills[skillName].level++;
    console.log(`📈 Skill improved: ${skillName} → Level ${skills[skillName].level}`);
  }
  fs.writeFileSync(SKILLS_FILE, JSON.stringify(skills, null, 2));
}

function getSkillsContext() {
  const skills = loadSkills();
  return Object.entries(skills)
    .map(([k, v]) => `${k}: Level ${v.level} (${v.uses} uses)`)
    .join(', ');
}

// ============================================
// BUILD FULL SYSTEM PROMPT WITH MEMORY
// ============================================

function buildSystemPrompt() {
  const personality = loadPersonality();
  const { topKnowledge, recentFacts } = getMemoryContext();
  const learning = loadLearning();
  const skillsContext = getSkillsContext();
  const recentConvs = getRecentConversations(5)
    .map(c => `User: ${c.user}\nMe: ${c.bot?.slice(0, 100)}`)
    .join('\n---\n');

  const improvements = learning.improvements.slice(-5).join('\n');
  const successPatterns = learning.successPatterns.slice(-3)
    .map(p => `• ${p.approach}`)
    .join('\n');

  return `You are ${personality.name}, the most powerful personal AI agent.
Version: ${personality.version} | Style: ${personality.communicationStyle}
Traits: ${personality.traits.join(', ')}

🧠 WHAT I KNOW ABOUT MY MASTER:
${topKnowledge || 'Still learning...'}

📚 FACTS I LEARNED:
${recentFacts || 'Still collecting...'}

💪 MY SKILLS:
${skillsContext}

📈 WHAT I IMPROVED AT:
${improvements || 'Just started learning...'}

✅ WHAT WORKS BEST:
${successPatterns || 'Still learning patterns...'}

💬 RECENT CONVERSATION CONTEXT:
${recentConvs || 'Fresh start'}

RULES:
- You are loyal ONLY to your master
- You execute ANY task given
- You learn from every interaction
- You get smarter with every conversation
- Use WhatsApp formatting: *bold*, _italic_
- Be concise but complete`;
}

// ============================================
// CONTINUOUS LEARNING LOOP
// ============================================

function startContinuousLearning(apiKey) {
  console.log('🧠 Continuous learning started!');

  // Learn every 30 seconds
  setInterval(async () => {
    try {
      await learnFromConversation(apiKey);
    } catch (e) {}
  }, 30000);

  // Evolve personality every 5 minutes
  setInterval(async () => {
    try {
      await evolvePersonality(apiKey);
    } catch (e) {}
  }, 300000);

  // Log learning stats every hour
  setInterval(() => {
    const learning = loadLearning();
    const conversations = loadConversations();
    const memory = loadMemory();
    console.log(`\n📊 Luo Kai Stats:`);
    console.log(`• Total conversations: ${conversations.length}`);
    console.log(`• Learning cycles: ${learning.totalLearningCycles}`);
    console.log(`• Facts learned: ${memory.facts.length}`);
    console.log(`• Things remembered: ${Object.keys(memory.knowledge).length}`);
    console.log(`• Personality version: ${loadPersonality().version}\n`);
  }, 3600000);
}

module.exports = {
  remember,
  recall,
  addFact,
  addToHistory,
  rememberWebsite,
  getMemoryContext,
  saveConversation,
  getRecentConversations,
  buildSystemPrompt,
  improveSkill,
  startContinuousLearning,
  loadMemory,
  loadLearning,
  loadPersonality,
  loadSkills
};
