import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import multer from 'multer';
import FormData from 'form-data';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FLASK_TARGET_URL = process.env.FLASK_URL || 'http://localhost:5000';

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

// ✅ /whisper 프록시 라우트 (Flask로 전달)
app.post('/whisper', upload.single('audio'), async (req, res) => {
  const target = `${FLASK_TARGET_URL}/whisper_stream`;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`[PROXY] 오디오 수신: ${req.file.size} bytes, mimetype: ${req.file.mimetype}`);

    const form = new FormData();
    form.append('audio', req.file.buffer, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });

    if (req.body && req.body.session_id) {
      form.append('session_id', req.body.session_id);
    }

    console.log(`[PROXY] Flask로 전달: ${target}`);

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        ...form.getHeaders()
      },
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[PROXY] Flask 에러:', response.status, data);
      return res.status(response.status).json({ 
        error: data.error || `whisper_stream failed with status ${response.status}` 
      });
    }

    console.log(`[PROXY] 성공: partial_text="${data.partial_text?.substring(0, 30)}..."`);
    return res.json(data);

  } catch (err) {
    console.error("[PROXY] /whisper error:", err.message);

    // ✅ Flask 서버 연결 실패 감지
    if (err.message.includes('ECONNREFUSED') || 
        err.message.includes('EHOSTUNREACH') || 
        err.message.includes('fetch failed')) {
      return res.status(503).json({
        error: `Flask 서버 연결 실패: ${FLASK_TARGET_URL}에 연결할 수 없습니다. Python 서버(whisper_local_server.py)가 실행 중인지 확인하세요.`
      });
    }

    res.status(500).json({ error: err.message || 'An unknown proxy error occurred.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Express Server running on port ${PORT}`);
  console.log(`👉 Flask Target: ${FLASK_TARGET_URL}`);
  console.log(`📡 Whisper 프록시: http://localhost:${PORT}/whisper → ${FLASK_TARGET_URL}/whisper_stream`);
});
