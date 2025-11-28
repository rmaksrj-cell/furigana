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
          content: `You are a Japanese-to-reading converter. Return EXACTLY a JSON array (no prose, no markdown) where each element is an object:
{ "jp": "<原文の語句>", "read": "<ひらがな reading>", "kr": "<한국어 발음 transliteration>" }.

Rules:
- Split into natural word/phrase units
- "read" must be hiragana only
- "kr" should be Korean pronunciation based on original Japanese sound
- Return ONLY the JSON array, no explanation
- No markdown code blocks

Example: [{"jp":"私","read":"わたし","kr":"와타시"},{"jp":"は","read":"は","kr":"와"},{"jp":"学生","read":"がくせい","kr":"가쿠세이"}]`
        },
        { role: 'user', content: `Convert this Japanese sentence: "${text}"` }
      ],
      temperature: 0.1,
      max_tokens: 1000
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
      kr: item.kr || ''
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