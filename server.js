import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'Server is running' });
});

// 메인 변환 엔드포인트
app.post('/api/furigana', async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'text required' });
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a Japanese-to-reading converter with translation. Return EXACTLY a JSON array where each element is an object:
{ "jp": "<原文の語句>", "read": "<ひらがな reading>", "kr": "<한국어 발음>", "meaning": "<한국어 뜻>", "cumulativeJp": "<누적 일본어>", "cumulativeRead": "<누적 읽기>", "cumulativeKr": "<누적 한국어 발음>", "cumulativeTranslation": "<누적 번역>" }.

Rules:
- Split into natural word/phrase units (particles, nouns, verbs, etc.)
- "read" must be hiragana only for that specific word/phrase
- "kr" should be Korean pronunciation for that specific word/phrase
- "meaning" should be Korean translation of that specific word/phrase
- "cumulativeJp" should show all Japanese text accumulated up to this point
- "cumulativeRead" should show all readings accumulated up to this point (space-separated)
- "cumulativeKr" should show all Korean pronunciations accumulated up to this point (space-separated)
- "cumulativeTranslation" should show the translation of the entire sentence up to this point
- Provide cumulative fields for EVERY word/phrase in the sentence
- Return ONLY the JSON array, no explanation, no markdown

Example for "今日の晩ご飯は何を食べようか": 
[
  {
    "jp": "今日の",
    "read": "きょうの",
    "kr": "쿄-노",
    "meaning": "오늘의",
    "cumulativeJp": "今日の",
    "cumulativeRead": "きょうの",
    "cumulativeKr": "쿄-노",
    "cumulativeTranslation": "오늘의"
  },
  {
    "jp": "晩ご飯は",
    "read": "ばんごはんは",
    "kr": "방고항와",
    "meaning": "저녁밥은",
    "cumulativeJp": "今日の晩ご飯は",
    "cumulativeRead": "きょうの ばんごはんは",
    "cumulativeKr": "쿄-노 방고항와",
    "cumulativeTranslation": "오늘의 저녁밥은"
  },
  {
    "jp": "何を",
    "read": "なにを",
    "kr": "나니오",
    "meaning": "무엇을",
    "cumulativeJp": "今日の晩ご飯は何を",
    "cumulativeRead": "きょうの ばんごはんは なにを",
    "cumulativeKr": "쿄-노 방고항와 나니오",
    "cumulativeTranslation": "오늘의 저녁밥은 무엇을"
  },
  {
    "jp": "食べようか",
    "read": "たべようか",
    "kr": "타베요-카",
    "meaning": "먹을까",
    "cumulativeJp": "今日の晩ご飯は何を食べようか",
    "cumulativeRead": "きょうの ばんごはんは なにを たべようか",
    "cumulativeKr": "쿄-노 방고항와 나니오 타베요-카",
    "cumulativeTranslation": "오늘의 저녁밥은 무엇을 먹을까"
  }
]`
        },
        { role: 'user', content: `Convert this Japanese sentence: "${text}"` }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    let content = response.choices[0].message.content.trim();
    
    // Remove markdown code blocks if present
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const parsed = JSON.parse(content);
    
    // Validation
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }
    
    // Ensure each item has required fields
    const validated = parsed.map(item => ({
      jp: item.jp || '',
      read: item.read || '',
      kr: item.kr || '',
      meaning: item.meaning || '',
      cumulativeJp: item.cumulativeJp || '',
      cumulativeRead: item.cumulativeRead || '',
      cumulativeKr: item.cumulativeKr || '',
      cumulativeTranslation: item.cumulativeTranslation || ''
    }));
    
    res.json(validated);
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process text',
      details: error.message 
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
});
