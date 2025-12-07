import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import * as googleTTS from 'google-tts-api';

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

// 기존 일본어 분석 엔드포인트
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

// 🆕 한국어→일본어 번역 및 분석 엔드포인트
app.post('/api/translate-kr-to-jp', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text required' });
  }

  try {
    // Step 1: 한국어→일본어 번역
    const translationResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a Korean to Japanese translator. Translate the given Korean text into natural, fluent Japanese.

Rules:
- Translate Korean text to natural Japanese
- Maintain the original meaning and nuance
- Use appropriate Japanese grammar and expressions
- Return ONLY the translated Japanese text, no explanation, no markdown
- Do not include any additional formatting or commentary`
        },
        { role: 'user', content: `Translate this Korean text to Japanese: "${text}"` }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });

    const japaneseText = translationResponse.choices[0].message.content.trim();

    // Step 2: 번역된 일본어 분석
    const analysisResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a Japanese-to-reading converter with translation. Return EXACTLY a JSON array where each element is an object:
{ "jp": "<原文の語句>", "read": "<ひらがな reading>", "kr": "<한국어 발음>", "meaning": "<한국어 뜻>" }.

Rules:
- Split into natural word/phrase units (particles, nouns, verbs, etc.)
- "read" must be hiragana only for that specific word/phrase
- "kr" should be Korean pronunciation for that specific word/phrase
- "meaning" should be Korean translation of that specific word/phrase
- Return ONLY the JSON array, no explanation, no markdown

Example for "今日の晩ご飯は何を食べようか": 
[
  {
    "jp": "今日の",
    "read": "きょうの",
    "kr": "쿄-노",
    "meaning": "오늘의"
  },
  {
    "jp": "晩ご飯は",
    "read": "ばんごはんは",
    "kr": "방고항와",
    "meaning": "저녁밥은"
  },
  {
    "jp": "何を",
    "read": "なにを",
    "kr": "나니오",
    "meaning": "무엇을"
  },
  {
    "jp": "食べようか",
    "read": "たべようか",
    "kr": "타베요-카",
    "meaning": "먹을까"
  }
]`
        },
        { role: 'user', content: `Convert this Japanese sentence: "${japaneseText}"` }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    let analysisContent = analysisResponse.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    analysisContent = analysisContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    const parsed = JSON.parse(analysisContent);

    // Validation
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }

    // Ensure each item has required fields
    const validated = parsed.map(item => ({
      jp: item.jp || '',
      read: item.read || '',
      kr: item.kr || '',
      meaning: item.meaning || ''
    }));

    // 응답 반환
    res.json({
      translatedText: japaneseText,
      analysis: validated
    });

  } catch (error) {
    console.error('Translation API Error:', error);
    res.status(500).json({
      error: 'Failed to translate and analyze text',
      details: error.message
    });
  }
});

// TTS 엔드포인트 (Google TTS 사용)
app.post('/api/tts', async (req, res) => {
  const { text, speed = 1.0 } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text required' });
  }

  try {
    // Google TTS API로부터 오디오 URL 생성
    const url = googleTTS.getAudioUrl(text, {
      lang: 'ja',
      slow: speed < 1.0,
      host: 'https://translate.google.com',
    });

    // 서버가 대신 오디오 데이터를 가져와서 클라이언트에 전달
    const audioResp = await fetch(url);
    if (!audioResp.ok) throw new Error(`Google TTS fetch failed: ${audioResp.status}`);

    const arrayBuffer = await audioResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });

    res.send(buffer);

  } catch (error) {
    console.error('TTS Error:', error);
    res.status(500).json({ error: 'TTS generation failed', details: error.message });
  }
});

// 문장 분석 엔드포인트
app.post('/api/analyze', async (req, res) => {
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
          content: `You are a Japanese grammar analyzer. Analyze the given Japanese sentence and return a JSON object with an "analysis" array.

Each element in the array should be an object with:
{
  "word": "<Japanese word/phrase>",
  "pos": "<part of speech in Korean (명사, 동사, 형용사, 조사, etc.)>",
  "reading": "<hiragana reading>",
  "meaning": "<Korean meaning/explanation>"
}

Rules:
- Break down the sentence into grammatical units (words, particles, verb forms, etc.)
- Identify the part of speech for each unit in Korean
- Provide hiragana reading for each unit
- Give a clear Korean explanation of the meaning and grammatical function
- Return ONLY the JSON object, no markdown, no explanation

Example for "今日は晴れです":
{
  "analysis": [
    {
      "word": "今日",
      "pos": "명사",
      "reading": "きょう",
      "meaning": "오늘"
    },
    {
      "word": "は",
      "pos": "조사",
      "reading": "は",
      "meaning": "주제를 나타내는 조사"
    },
    {
      "word": "晴れ",
      "pos": "명사",
      "reading": "はれ",
      "meaning": "맑음, 화창함"
    },
    {
      "word": "です",
      "pos": "조동사",
      "reading": "です",
      "meaning": "정중한 단정의 표현 (~입니다)"
    }
  ]
}`
        },
        { role: 'user', content: `Analyze this Japanese sentence: "${text}"` }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    let content = response.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    const parsed = JSON.parse(content);

    // Validation
    if (!parsed.analysis || !Array.isArray(parsed.analysis)) {
      throw new Error('Invalid response format');
    }

    res.json(parsed);

  } catch (error) {
    console.error('Analyze API Error:', error);
    res.status(500).json({
      error: 'Failed to analyze sentence',
      details: error.message
    });
  }
});

// 한글→일본어 번역 엔드포인트 (단순 번역만)
app.post('/api/translate', async (req, res) => {
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
          content: `You are a Korean to Japanese translator. Translate the given Korean text into natural, fluent Japanese.

Rules:
- Translate Korean text to natural Japanese
- Maintain the original meaning and nuance
- Use appropriate Japanese grammar and expressions
- Return ONLY the translated Japanese text, no explanation, no markdown
- Do not include any additional formatting or commentary`
        },
        { role: 'user', content: `Translate this Korean text to Japanese: "${text}"` }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });

    const japanese = response.choices[0].message.content.trim();

    res.json({ japanese });

  } catch (error) {
    console.error('Translation API Error:', error);
    res.status(500).json({
      error: 'Failed to translate text',
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
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
});
