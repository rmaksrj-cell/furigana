# 일본어 자동 독음 + TTS 재생기

일본어 문장을 입력하면 GPT가 형태소별로 히라가나 읽기와 한국어 발음을 자동으로 생성해주는 학습 도구입니다.

## 🚀 GitHub Pages 배포 방법

### 1. 파일 업로드
다음 3개 파일을 GitHub 저장소에 업로드하세요:
```
public/
├── index.html
├── styles.css
└── app.js
```

### 2. GitHub Pages 설정
1. GitHub 저장소 → **Settings** → **Pages**
2. **Source**: `Deploy from a branch` 선택
3. **Branch**: `main` (또는 `master`) 선택, 폴더는 `/public` 선택
4. **Save** 클릭

### 3. 배포 완료
몇 분 후 `https://your-username.github.io/repository-name/` 에서 접속 가능합니다.

## 🔧 기술 스택

- **프론트엔드**: HTML, CSS, JavaScript (바닐라)
- **백엔드**: Node.js + Express (Render에 배포)
- **API**: OpenAI GPT-4 (독음 생성), OpenAI TTS (음성 생성)

## ✨ 주요 기능

- ✅ 일본어 문장 자동 독음 생성 (히라가나 + 한국어 발음)
- ✅ TTS 음성 재생 (브라우저 TTS / 서버 TTS)
- ✅ 파일 업로드 (TXT, CSV, SRT)
- ✅ 예문 라이브러리 (localStorage)
- ✅ SRT 자막 파일 파싱 및 문장 추출
- ✅ 누적 학습 결과 표시

## 🌐 환경별 API 설정

앱은 자동으로 환경을 감지합니다:
- **로컬 개발**: `http://localhost:3000`
- **GitHub Pages**: `https://fur-qar7.onrender.com`

## 📝 로컬 개발

```bash
# 서버 실행
node server.js

# 브라우저에서 접속
http://localhost:3000
```

## 📄 라이선스

MIT License
