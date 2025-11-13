import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import multer from 'multer';
import FormData from 'form-data';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Furigana API Server Running' });
});

// 기존 /furigana 라우트
app.post('/furigana', async (req, res) => {
  try {
    const { text } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    if (!text) {
      return res.status(400).json({ error: 'text parameter is required' });
    }

    const systemPrompt1 = `히라가나+한글발음. 이 밑에, 한자가 히라가나로 어떻게 읽히는지, 한글발음과 함께 제시. 한글 발음은 한글로 표기할 것.:\n\n${text}`;
    const systemPrompt2 = `문장 분석, 히라가나는 한글독음도 표시할 것.:\n\n${text}`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    };

    const [response1, response2] = await Promise.all([
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: systemPrompt1 }],
          temperature: 0.6
        })
      }),
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: systemPrompt2 }],
          temperature: 0.6
        })
      })
    ]);

    const data1 = await response1.json();
    const data2 = await response2.json();

    if (!response1.ok || !response2.ok) {
      console.error('OpenAI API Error:', data1 || data2);
      return res.status(500).json({ error: 'OpenAI API request failed' });
    }

    return res.json({
      original: data1.choices[0]?.message?.content ?? "",
      analysis: data2.choices[0]?.message?.content ?? ""
    });
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ OpenAI Whisper API 직접 사용
app.post('/whisper', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    console.log(`[WHISPER] 오디오 수신: ${req.file.size} bytes, mimetype: ${req.file.mimetype}`);

    // FormData 생성
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });
    form.append('model', 'whisper-1');
    form.append('language', 'ja'); // 일본어
    form.append('response_format', 'json');

    // OpenAI Whisper API 호출
    console.log('[WHISPER] OpenAI Whisper API 호출 중...');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[WHISPER] OpenAI API 오류:', response.status, data);
      return res.status(response.status).json({ 
        error: data.error?.message || `Whisper API failed with status ${response.status}` 
      });
    }

    console.log(`[WHISPER] 성공: "${data.text?.substring(0, 50)}..."`);

    // 결과 반환 (기존 Flask 형식과 호환)
    return res.json({
      partial_text: data.text || "",
      merged_sentences: data.text ? [{ text: data.text }] : []
    });

  } catch (err) {
    console.error("[WHISPER] Error:", err.message);
    res.status(500).json({ error: err.message || 'Whisper API error occurred' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Express Server running on port ${PORT}`);
  console.log(`📡 Whisper: OpenAI Whisper API 직접 사용`);
  console.log(`🔑 API Key: ${process.env.OPENAI_API_KEY ? '설정됨 ✅' : '미설정 ❌'}`);
});
