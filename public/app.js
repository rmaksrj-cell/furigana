// ========== API 설정 ==========
// Version: 2.0 - Fixed response body reading issue
// 로컬 개발 시: localhost 사용
// GitHub Pages 배포 시: Render 서버 사용
const isLocalDev = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.port === '3000';

const API_BASE_URL = isLocalDev
    ? 'http://localhost:3000'
    : 'https://fur-qar7.onrender.com';

console.log('🔧 API Configuration:', {
    hostname: window.location.hostname,
    port: window.location.port,
    isLocalDev: isLocalDev,
    API_BASE_URL: API_BASE_URL
});

// ========== DOM 요소 참조 ==========
const statusEl = document.getElementById('status');
const japaneseEl = document.getElementById('japanese');
const preview = document.getElementById('preview');
const rateEl = document.getElementById('rate');
const rateLabel = document.getElementById('rateLabel');
const genBtn = document.getElementById('gen');
const playBtn = document.getElementById('play');
const pauseBtn = document.getElementById('pause');
const clearBtn = document.getElementById('clear');
const meaningSection = document.getElementById('meaningSection');
const meaningList = document.getElementById('meaningList');
const cumulativeSection = document.getElementById('cumulativeSection');
const cumulativeList = document.getElementById('cumulativeList');
const resultSummarySection = document.getElementById('resultSummarySection');
const summaryContent = document.getElementById('summaryContent');
const fileInput = document.getElementById('fileInput');
const sentenceList = document.getElementById('sentenceList');
const sentencePanel = document.getElementById('sentencePanel');
const analyzeBtn = document.getElementById('analyzeBtn');
const analysisSection = document.getElementById('analysisSection');
const analysisList = document.getElementById('analysisList');

// ========== 전역 변수 ==========
let wordSpans = [];
let currentUtter = null;
let apiResultData = [];
let sentences = [];
let selectedSentenceIndex = -1;
let currentAudio = null;
let slashEnabled = false;

// ========== 라이브러리 관리자 팩토리 함수 ==========
function createLibraryManager(storageKey) {
    let data = [];

    function load() {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                data = JSON.parse(saved);
            } catch (e) {
                console.error('라이브러리 로드 실패', e);
                data = [];
            }
        }
        return data;
    }

    function save() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(data));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                alert('저장 공간이 부족합니다! 😢\n오래된 항목을 삭제하거나 브라우저 데이터를 정리해주세요.');
            } else {
                alert('저장 중 오류가 발생했습니다.');
            }
            console.error('Storage save error:', e);
            return false;
        }
    }

    function add(item) {
        data.unshift(item);
        return save();
    }

    function remove(id) {
        data = data.filter(item => item.id !== id);
        return save();
    }

    function clear() {
        data = [];
        return save();
    }

    function find(id) {
        return data.find(item => item.id === id);
    }

    function exists(predicate) {
        return data.some(predicate);
    }

    function removeWhere(predicate) {
        data = data.filter(item => !predicate(item));
    }

    function getAll() {
        return data;
    }

    function getCount() {
        return data.length;
    }

    return { load, save, add, remove, clear, find, exists, removeWhere, getAll, getCount };
}

// ========== 라이브러리 인스턴스 생성 ==========
const exampleLibrary = createLibraryManager('jp_learning_library_v1');
const srtLibrary = createLibraryManager('jp_learning_srt_library_v1');

// ========== 초기화 ==========
function init() {
    exampleLibrary.load();
    srtLibrary.load();
    displayLibrary();
    displaySrtLibrary();
    checkHealth();
    setupEventListeners();
    initializeColorPicker();
}

// ========== 이벤트 리스너 설정 ==========
function setupEventListeners() {
    rateEl.addEventListener('input', () => {
        rateLabel.textContent = parseFloat(rateEl.value).toFixed(2) + 'x';
    });

    genBtn.addEventListener('click', handleGenerate);
    playBtn.addEventListener('click', () => playSequence());
    document.getElementById('playServer').addEventListener('click', () => playServerTTS());
    pauseBtn.addEventListener('click', () => {
        if (speechSynthesis.speaking) speechSynthesis.pause();
    });
    clearBtn.addEventListener('click', handleClear);
    analyzeBtn.addEventListener('click', handleAnalyze);
    fileInput.addEventListener('change', handleFileUpload);
    document.getElementById('srtFileInput').addEventListener('change', handleSrtUpload);

    playBtn.disabled = true;
    document.getElementById('playServer').disabled = true;
}

// ========== 미리보기 관련 함수 ==========
function clearPreview() {
    preview.innerHTML = '';
    wordSpans = [];
    if (currentUtter) speechSynthesis.cancel();
    meaningSection.style.display = 'none';
    meaningList.innerHTML = '';
    cumulativeSection.style.display = 'none';
    cumulativeList.innerHTML = '';
    resultSummarySection.style.display = 'none';
    apiResultData = [];
}

function buildFromApiResult(arr) {
    clearPreview();

    if (!Array.isArray(arr) || arr.length === 0) {
        statusEl.textContent = '상태: 변환 결과가 비어 있습니다.';
        preview.innerHTML = '<div style="opacity:0.5;font-size:18px;">결과 없음</div>';
        return;
    }

    apiResultData = arr.map(item => ({ ...item, meaningShown: false }));
    buildCumulativeResults(arr);

    arr.forEach((seg, idx) => {
        const sp = document.createElement('span');
        sp.className = 'word';
        sp.dataset.index = idx;

        const rb = document.createElement('ruby');
        rb.textContent = seg.jp;

        const rt = document.createElement('rt');
        const read = seg.read || '';
        const kr = seg.kr || '';
        rt.textContent = read + (read && kr ? '｜' : '') + kr;

        if (rt.textContent) rb.appendChild(rt);
        sp.appendChild(rb);
        preview.appendChild(sp);
        wordSpans.push(sp);
    });

    statusEl.textContent = '상태: 변환 완료! 재생 버튼을 눌러보세요.';
    playBtn.disabled = false;
    document.getElementById('playServer').disabled = false;
    meaningSection.style.display = 'block';
}

// ========== 누적 결과 관련 함수 ==========
function buildCumulativeResults(arr) {
    cumulativeList.innerHTML = '';

    let accumulatedJp = '';
    let accumulatedKr = '';
    let accumulatedTrans = '';
    let accumulatedTransWithSlash = '';

    arr.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'cumulative-item';
        div.style.animationDelay = `${idx * 0.1}s`;

        const jpText = document.createElement('div');
        jpText.className = 'cumulative-jp';

        const newJpPart = item.jp;

        if (idx === 0) {
            accumulatedJp = item.cumulativeJp;
            accumulatedKr = item.cumulativeKr;
            accumulatedTrans = item.cumulativeTranslation;
            accumulatedTransWithSlash = item.meaning;
        } else {
            const prevJp = arr[idx - 1].cumulativeJp;
            const currentJp = item.cumulativeJp;
            const newPart = currentJp.slice(prevJp.length);
            accumulatedJp += (slashEnabled ? '/' : '') + newPart;

            const prevKr = arr[idx - 1].cumulativeKr;
            const currentKr = item.cumulativeKr;
            const spacingKr = currentKr.slice(prevKr.length).match(/^\s*/)[0];
            const newKrOnly = currentKr.slice(prevKr.length).trimStart();
            accumulatedKr += spacingKr + newKrOnly;

            const prevTrans = arr[idx - 1].cumulativeTranslation;
            const currentTrans = item.cumulativeTranslation;
            const spacingTrans = currentTrans.slice(prevTrans.length).match(/^\s*/)[0];
            const newTransOnly = currentTrans.slice(prevTrans.length).trimStart();
            accumulatedTrans += spacingTrans + newTransOnly;

            const slash = slashEnabled ? '<span class="light-slash">/</span>' : ' ';
            accumulatedTransWithSlash += slash + item.meaning;
        }

        let highlightedJp = '';
        if (idx === 0) {
            highlightedJp = `<span class="new-word" data-new="true">${newJpPart}</span>`;
        } else {
            let prevJpWithSlash = '';
            if (slashEnabled) {
                for (let i = 0; i <= idx - 1; i++) {
                    if (i === 0) {
                        prevJpWithSlash = arr[i].jp;
                    } else {
                        prevJpWithSlash += '/' + arr[i].jp;
                    }
                }
            } else {
                prevJpWithSlash = arr[idx - 1].cumulativeJp;
            }
            const slash = slashEnabled ? '/' : '';
            highlightedJp = `${prevJpWithSlash}${slash}<span class="new-word" data-new="true">${newJpPart}</span>`;
        }

        let highlightedKr = '';
        if (idx === 0) {
            highlightedKr = `<span class="new-word" data-new="true">${item.cumulativeKr}</span>`;
        } else {
            const prevKr = arr[idx - 1].cumulativeKr;
            const currentKr = item.cumulativeKr;
            const spacingKr = currentKr.slice(prevKr.length).match(/^\s*/)[0];
            const newKrPart = currentKr.slice(prevKr.length).trimStart();
            highlightedKr = `${prevKr}${spacingKr}<span class="new-word" data-new="true">${newKrPart}</span>`;
        }

        let highlightedTrans = '';
        if (idx === 0) {
            highlightedTrans = `<span class="new-word" data-new="true">${item.cumulativeTranslation}</span>`;
        } else {
            const prevTrans = arr[idx - 1].cumulativeTranslation;
            const currentTrans = item.cumulativeTranslation;
            const spacingTrans = currentTrans.slice(prevTrans.length).match(/^\s*/)[0];
            const newTransPart = currentTrans.slice(prevTrans.length).trimStart();
            highlightedTrans = `${prevTrans}${spacingTrans}<span class="new-word" data-new="true">${newTransPart}</span>`;
        }

        jpText.innerHTML = highlightedJp;

        const detail = document.createElement('div');
        detail.className = 'cumulative-detail';
        detail.innerHTML = `
            <div style="margin-bottom: 6px;">
                <span>• <code>${accumulatedTransWithSlash}</code></span>
            </div>
            <div style="padding-left: 12px;">
                <span>(${highlightedKr})</span>
                <span class="cumulative-arrow">→</span>
                <span class="cumulative-translation">${highlightedTrans}</span>
            </div>
        `;

        div.appendChild(jpText);
        div.appendChild(detail);
        cumulativeList.appendChild(div);
    });

    cumulativeSection.style.display = 'block';
    updateFinalResult(arr);
}

function updateFinalResult(arr) {
    if (!arr || arr.length === 0) return;

    const lastItem = arr[arr.length - 1];

    document.getElementById('finalJp').textContent = lastItem.cumulativeJp;

    const readingsWithSlash = arr.map(item => item.read).join('/');
    document.getElementById('finalRead').textContent = readingsWithSlash;

    document.getElementById('finalKr').textContent = lastItem.cumulativeKr;
    document.getElementById('finalTranslation').textContent = lastItem.cumulativeTranslation;

    resultSummarySection.style.display = 'block';
}

// ========== 슬래쉬 토글 ==========
function toggleSlashes() {
    slashEnabled = !slashEnabled;
    const slashBtn = document.getElementById('slashToggle');

    if (slashEnabled) {
        slashBtn.textContent = '/ 슬래쉬 제거';
        slashBtn.style.background = '#f59e0b';
    } else {
        slashBtn.textContent = '/ 슬래쉬 추가';
        slashBtn.style.background = '#10b981';
    }

    if (apiResultData.length > 0) {
        buildCumulativeResults(apiResultData);
    }
}

// ========== 요약 토글 ==========
function toggleSummary() {
    const btn = document.getElementById('summaryToggle');

    if (summaryContent.classList.contains('show')) {
        summaryContent.classList.remove('show');
        summaryContent.classList.add('collapsed');
        btn.textContent = '▼ 펼치기';
    } else {
        summaryContent.classList.remove('collapsed');
        summaryContent.classList.add('show');
        btn.textContent = '▲ 접기';
    }
}

// ========== 색상 선택 기능 ==========
const colorPresets = {
    yellow: { start: '#ffd54f', end: '#ffb300', shadow: 'rgba(255, 179, 0, 0.3)' },
    green: { start: '#a7f3d0', end: '#34d399', shadow: 'rgba(52, 211, 153, 0.3)' },
    blue: { start: '#bfdbfe', end: '#60a5fa', shadow: 'rgba(96, 165, 250, 0.3)' },
    pink: { start: '#fbcfe8', end: '#f472b6', shadow: 'rgba(244, 114, 182, 0.3)' },
    purple: { start: '#ddd6fe', end: '#a78bfa', shadow: 'rgba(167, 139, 250, 0.3)' }
};

function setHighlightColor(colorStart, colorEnd, shadow) {
    document.documentElement.style.setProperty('--highlight-color-start', colorStart);
    document.documentElement.style.setProperty('--highlight-color-end', colorEnd);
    document.documentElement.style.setProperty('--highlight-shadow', shadow);
}

function initializeColorPicker() {
    document.querySelectorAll('.color-preset').forEach(preset => {
        preset.addEventListener('click', function () {
            const colorName = this.dataset.color;
            const colors = colorPresets[colorName];

            if (colors) {
                setHighlightColor(colors.start, colors.end, colors.shadow);
                document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));
                this.classList.add('active');
            }
        });
    });

    const customColorInput = document.getElementById('customColor');
    if (customColorInput) {
        customColorInput.addEventListener('input', function () {
            const color = this.value;
            const darkerColor = adjustBrightness(color, -20);
            const shadowColor = hexToRgba(color, 0.3);

            setHighlightColor(color, darkerColor, shadowColor);
            document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));
        });
    }

    const yellowPreset = document.querySelector('.color-preset[data-color="yellow"]');
    if (yellowPreset) {
        yellowPreset.classList.add('active');
    }
}

function adjustBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, (num >> 8 & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function hexToRgba(hex, alpha) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ========== 의미 표시 함수 ==========
function revealNext(idx) {
    for (let i = 0; i <= idx && i < apiResultData.length; i++) {
        if (wordSpans[i]) wordSpans[i].classList.add('revealed');

        if (!apiResultData[i].meaningShown) {
            if (apiResultData[i].meaning) {
                addMeaning(apiResultData[i].jp, apiResultData[i].meaning, 'word');
            }
            if (apiResultData[i].sentenceTranslation) {
                addMeaning('문장 번역', apiResultData[i].sentenceTranslation, 'sentence');
            }
            apiResultData[i].meaningShown = true;
        }
    }
}

function revealAll() {
    revealNext(apiResultData.length - 1);
}

function addMeaning(word, meaning, type) {
    const div = document.createElement('div');
    div.className = `meaning-item ${type === 'word' ? 'word-meaning' : 'sentence-meaning'}`;

    if (type === 'word') {
        div.innerHTML = `<span class="meaning-word">${word}</span><span class="meaning-text">${meaning}</span>`;
    } else {
        div.innerHTML = `<span class="meaning-word">💬 ${word}:</span><span class="meaning-text"> ${meaning}</span>`;
    }

    meaningList.appendChild(div);
    meaningList.scrollTop = meaningList.scrollHeight;
}

// ========== TTS 재생 함수 ==========
function playSequence() {
    const text = japaneseEl.value.trim();
    if (!text) return;

    if (wordSpans.length === 0) {
        statusEl.textContent = '먼저 "자동독음 생성"을 눌러주세요.';
        return;
    }

    if (currentUtter) speechSynthesis.cancel();

    apiResultData.forEach(d => d.meaningShown = false);
    meaningList.innerHTML = '';
    wordSpans.forEach(s => s.classList.remove('revealed'));

    let currentIndex = 0;
    apiResultData.forEach(item => {
        const foundIndex = text.indexOf(item.jp, currentIndex);
        if (foundIndex !== -1) {
            item.startIndex = foundIndex;
            currentIndex = foundIndex + item.jp.length;
        } else {
            item.startIndex = currentIndex;
        }
    });

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = parseFloat(rateEl.value);
    currentUtter = u;

    u.onstart = () => {
        statusEl.textContent = '상태: TTS 재생 중...';
    };

    u.onboundary = (event) => {
        if (event.name === 'word' || event.name === 'sentence') {
            const charIndex = event.charIndex;
            let activeIndex = -1;
            for (let i = 0; i < apiResultData.length; i++) {
                if (apiResultData[i].startIndex <= charIndex) {
                    activeIndex = i;
                } else {
                    break;
                }
            }

            if (activeIndex !== -1) {
                revealNext(activeIndex);
            }
        }
    };

    u.onend = () => {
        revealAll();
        statusEl.textContent = '상태: 재생 완료!';
    };

    speechSynthesis.speak(u);
}

async function playServerTTS() {
    const text = japaneseEl.value.trim();
    if (!text) {
        statusEl.textContent = '상태: 일본어 문장을 입력하세요.';
        return;
    }

    if (wordSpans.length === 0) {
        statusEl.textContent = '먼저 "자동독음 생성"을 눌러주세요.';
        return;
    }

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    apiResultData.forEach(d => d.meaningShown = false);
    meaningList.innerHTML = '';
    wordSpans.forEach(s => s.classList.remove('revealed'));

    statusEl.textContent = '상태: 서버에서 음성 생성 중... ⏳';

    try {
        const resp = await fetch(`${API_BASE_URL}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                voice: 'alloy'
            })
        });

        if (!resp.ok) throw new Error(`서버 오류: ${resp.status}`);

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        currentAudio = audio;

        audio.onplay = () => {
            statusEl.textContent = '상태: TTS 재생 중...';
        };

        audio.ontimeupdate = () => {
            const progress = audio.currentTime / audio.duration;
            const wordIndex = Math.floor(progress * apiResultData.length);
            if (wordIndex >= 0 && wordIndex < apiResultData.length) {
                revealNext(wordIndex);
            }
        };

        audio.onended = () => {
            revealAll();
            statusEl.textContent = '상태: 재생 완료!';
        };

        audio.onerror = (e) => {
            statusEl.textContent = '상태: 오디오 재생 실패 ❌';
            console.error('Audio error:', e);
        };

        await audio.play();

    } catch (e) {
        statusEl.textContent = '상태: 서버 TTS 실패 ❌';
        console.error('Server TTS error:', e);
        alert('서버 TTS 실패:\n' + e.message);
    }
}

// ========== API 호출 ==========
async function callApi(text) {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/furigana`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        // Response body를 텍스트로 먼저 읽기
        const responseText = await resp.text();

        if (!resp.ok) {
            let errorMessage = `${resp.status} ${resp.statusText}`;
            try {
                const error = JSON.parse(responseText);
                errorMessage = error.error || errorMessage;
            } catch (e) {
                // 서버가 JSON이 아닌 HTML을 반환한 경우
                console.error('Server returned non-JSON response:', responseText.substring(0, 200));
                errorMessage = `서버 오류 (${resp.status}): JSON 응답이 아님`;
            }
            throw new Error(errorMessage);
        }

        // 성공 응답도 JSON 파싱
        try {
            const data = JSON.parse(responseText);
            return data;
        } catch (e) {
            console.error('Failed to parse success response:', responseText.substring(0, 200));
            throw new Error('서버 응답을 파싱할 수 없습니다');
        }
    } catch (e) {
        throw e;
    }
}

async function handleGenerate() {
    const text = japaneseEl.value.trim();
    if (!text) {
        statusEl.textContent = '상태: 일본어 문장을 입력하세요.';
        return;
    }

    statusEl.textContent = '상태: GPT로 변환 중... ⏳';
    genBtn.disabled = true;
    playBtn.disabled = true;

    try {
        const arr = await callApi(text);
        buildFromApiResult(arr);

        // 자동으로 문장 분석도 실행
        await performAnalysis(text);
    } catch (err) {
        console.error(err);
        statusEl.textContent = '상태: 변환 실패 ❌';
        statusEl.className = 'status danger';
        alert('변환 API 호출 실패:\n' + (err.message || err));
    } finally {
        genBtn.disabled = false;
        statusEl.className = 'status';
    }
}

function handleClear() {
    japaneseEl.value = '';
    clearPreview();
    statusEl.textContent = '상태: 초기화됨';
    playBtn.disabled = true;
    document.getElementById('playServer').disabled = true;
}

async function checkHealth() {
    try {
        const r = await fetch(`${API_BASE_URL}/api/health`);
        if (r.ok) {
            statusEl.textContent = '상태: 서버 연결됨 ✓';
        } else {
            statusEl.textContent = '상태: 서버 응답 없음';
        }
    } catch (e) {
        statusEl.textContent = '상태: 서버 연결 실패';
        statusEl.className = 'status danger';
    }
}

// ========== 문장 분석 함수 ==========
async function performAnalysis(text) {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        // Response body를 텍스트로 먼저 읽기
        const responseText = await resp.text();

        if (!resp.ok) {
            let errorMessage = `${resp.status} ${resp.statusText}`;
            try {
                const error = JSON.parse(responseText);
                errorMessage = error.error || errorMessage;
            } catch (e) {
                // 서버가 JSON이 아닌 HTML을 반환한 경우
                console.error('Server returned non-JSON response:', responseText.substring(0, 200));
                errorMessage = `서버 오류 (${resp.status}): JSON 응답이 아님`;
            }
            throw new Error(errorMessage);
        }

        // 성공 응답도 JSON 파싱
        try {
            const data = JSON.parse(responseText);
            displayAnalysis(data);
            return data;
        } catch (e) {
            console.error('Failed to parse success response:', responseText.substring(0, 200));
            throw new Error('서버 응답을 파싱할 수 없습니다');
        }
    } catch (err) {
        console.error('Analysis error:', err);
        throw err;
    }
}

async function handleAnalyze() {
    const text = japaneseEl.value.trim();
    if (!text) {
        statusEl.textContent = '상태: 일본어 문장을 입력하세요.';
        return;
    }

    statusEl.textContent = '상태: 문장 분석 중... ⏳';
    analyzeBtn.disabled = true;

    try {
        await performAnalysis(text);
        statusEl.textContent = '상태: 문장 분석 완료! ✓';
    } catch (err) {
        console.error(err);
        statusEl.textContent = '상태: 분석 실패 ❌';
        statusEl.className = 'status danger';
        alert('문장 분석 API 호출 실패:\n' + (err.message || err));
    } finally {
        analyzeBtn.disabled = false;
        statusEl.className = 'status';
    }
}

function displayAnalysis(data) {
    analysisList.innerHTML = '';

    if (!data || !data.analysis || data.analysis.length === 0) {
        analysisSection.style.display = 'none';
        return;
    }

    data.analysis.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'analysis-item';
        div.style.animationDelay = `${idx * 0.1}s`;

        div.innerHTML = `
            <div class="analysis-word">${item.word}</div>
            <div class="analysis-detail">
                <span class="analysis-pos">${item.pos}</span>
                <span class="analysis-reading">${item.reading}</span>
            </div>
            <div class="analysis-meaning">${item.meaning}</div>
        `;

        analysisList.appendChild(div);
    });

    analysisSection.style.display = 'block';
}


// ========== 파일 업로드 처리 ==========
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();

        if (file.name.endsWith('.csv')) {
            sentences = text.split('\n')
                .map(line => line.split(',')[0].trim())
                .filter(line => line.length > 0);
        } else {
            sentences = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .filter(line => !/^\d+$/.test(line))
                .filter(line => !/\d{2}:\d{2}:\d{2}/.test(line))
                .filter(line => /[ぁ-んァ-ン一-龯]/.test(line));
        }

        if (sentences.length === 0) {
            alert('파일에서 문장을 찾을 수 없습니다.');
            return;
        }

        displaySentenceList();
        statusEl.textContent = `상태: ${sentences.length}개의 문장을 불러왔습니다.`;

    } catch (error) {
        console.error('파일 읽기 오류:', error);
        alert('파일을 읽는 중 오류가 발생했습니다.');
    }
}

function displaySentenceList() {
    sentenceList.innerHTML = '';

    sentences.forEach((sentence, index) => {
        const div = document.createElement('div');
        div.className = 'sentence-item';
        div.innerHTML = `<span class="sentence-number">${index + 1}</span>${sentence}`;
        div.dataset.index = index;

        div.addEventListener('click', () => {
            selectSentence(index);
        });

        sentenceList.appendChild(div);
    });

    sentencePanel.style.display = 'block';
    sentencePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectSentence(index) {
    selectedSentenceIndex = index;
    japaneseEl.value = sentences[index];

    document.querySelectorAll('.sentence-item').forEach((item, i) => {
        if (i === index) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    clearPreview();
    statusEl.textContent = `상태: 문장 #${index + 1} 선택됨`;

    japaneseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    japaneseEl.focus();
}

// ========== 예문 라이브러리 함수 ==========
function saveToLibrary() {
    if (apiResultData.length === 0) {
        alert('저장할 변환 결과가 없습니다.');
        return;
    }

    const lastItem = apiResultData[apiResultData.length - 1];
    const newItem = {
        id: Date.now(),
        jp: lastItem.cumulativeJp,
        kr: lastItem.cumulativeKr,
        trans: lastItem.cumulativeTranslation,
        fullData: apiResultData,
        date: new Date().toISOString()
    };

    const exists = exampleLibrary.exists(item => item.jp === newItem.jp);
    if (exists) {
        if (!confirm('이미 라이브러리에 존재하는 문장입니다. 덮어쓰시겠습니까?')) {
            return;
        }
        exampleLibrary.removeWhere(item => item.jp === newItem.jp);
    }

    exampleLibrary.add(newItem);
    displayLibrary();

    const btn = document.getElementById('saveToLibBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>✅</span> 저장됨!';
    btn.style.background = 'rgba(16, 185, 129, 0.4)';
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
    }, 2000);
}

function deleteFromLibrary(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('정말 삭제하시겠습니까?')) return;

    exampleLibrary.remove(id);
    displayLibrary();
}

function clearLibrary() {
    if (exampleLibrary.getCount() === 0) return;
    if (!confirm('라이브러리의 모든 예문을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

    exampleLibrary.clear();
    displayLibrary();
}

function loadFromLibrary(id) {
    const item = exampleLibrary.find(id);
    if (!item) return;

    japaneseEl.value = item.jp;

    if (item.fullData) {
        apiResultData = item.fullData;
        buildFromApiResult(apiResultData);
        statusEl.textContent = '상태: 라이브러리에서 불러옴';

        document.querySelector('.panel').scrollIntoView({ behavior: 'smooth' });
    }
}

function displayLibrary() {
    const listEl = document.getElementById('libraryList');
    const countEl = document.getElementById('libCount');
    const data = exampleLibrary.getAll();

    countEl.textContent = data.length;
    listEl.innerHTML = '';

    if (data.length === 0) {
        listEl.innerHTML = `
            <div class="empty-library" style="grid-column: 1/-1;">
                <div style="font-size: 40px; margin-bottom: 10px;">📚</div>
                <div>저장된 예문이 없습니다.<br>문장을 학습하고 '저장' 버튼을 눌러보세요!</div>
            </div>
        `;
        return;
    }

    data.forEach(item => {
        const date = new Date(item.date).toLocaleDateString();

        const el = document.createElement('div');
        el.className = 'library-item';
        el.onclick = () => loadFromLibrary(item.id);

        el.innerHTML = `
            <button class="delete-btn" onclick="deleteFromLibrary(${item.id}, event)" title="삭제">×</button>
            <div class="library-item-jp">${item.jp}</div>
            <div class="library-item-kr">${item.kr}</div>
            <div class="library-item-trans">${item.trans}</div>
            <div class="library-item-date">${date}</div>
        `;

        listEl.appendChild(el);
    });
}

// ========== SRT 라이브러리 함수 ==========
function parseSrtFile(text) {
    // 모든 종류의 줄바꿈 처리: \r\n (Windows), \n (Unix/Mac), \r (Old Mac)
    const lines = text.split(/\r?\n|\r/);
    const sentences = [];
    let currentText = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 빈 줄, 번호, 타임코드를 만나면 현재 문장 저장
        if (!line || /^\d+$/.test(line) || /\d{2}:\d{2}:\d{2}/.test(line)) {
            if (currentText && /[ぁ-んァ-ン一-龯]/.test(currentText)) {
                sentences.push(currentText.trim());
                currentText = '';
            }
            continue;
        }

        // 일본어가 포함된 줄이면 현재 문장에 추가 (누적)
        if (/[ぁ-んァ-ン一-龯]/.test(line)) {
            if (currentText) {
                // 이미 텍스트가 있으면 공백으로 연결
                currentText += ' ' + line;
            } else {
                // 첫 줄이면 그냥 저장
                currentText = line;
            }
        }
    }

    // 마지막 문장 처리
    if (currentText && /[ぁ-んァ-ン一-龯]/.test(currentText)) {
        sentences.push(currentText.trim());
    }

    return sentences;
}

async function handleSrtUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const extractedSentences = parseSrtFile(text);

        if (extractedSentences.length === 0) {
            alert('SRT 파일에서 일본어 문장을 찾을 수 없습니다.');
            return;
        }

        const newItem = {
            id: Date.now(),
            filename: file.name,
            sentences: extractedSentences,
            count: extractedSentences.length,
            date: new Date().toISOString()
        };

        const exists = srtLibrary.exists(item => item.filename === newItem.filename);
        if (exists) {
            if (!confirm('이미 라이브러리에 존재하는 파일입니다. 덮어쓰시겠습니까?')) {
                e.target.value = '';
                return;
            }
            srtLibrary.removeWhere(item => item.filename === newItem.filename);
        }

        srtLibrary.add(newItem);
        displaySrtLibrary();

        statusEl.textContent = `상태: ${file.name}에서 ${extractedSentences.length}개의 문장을 추출했습니다.`;
        e.target.value = '';

    } catch (error) {
        console.error('SRT 파일 읽기 오류:', error);
        alert('SRT 파일을 읽는 중 오류가 발생했습니다.');
        e.target.value = '';
    }
}

function deleteFromSrtLibrary(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('정말 삭제하시겠습니까?')) return;

    srtLibrary.remove(id);
    displaySrtLibrary();
}

function clearSrtLibrary() {
    if (srtLibrary.getCount() === 0) return;
    if (!confirm('SRT 라이브러리의 모든 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

    srtLibrary.clear();
    displaySrtLibrary();
}

function loadSrtToSentenceList(id) {
    const item = srtLibrary.find(id);
    if (!item) return;

    sentences = item.sentences;
    displaySentenceList();

    statusEl.textContent = `상태: ${item.filename}에서 ${item.count}개의 문장을 불러왔습니다.`;
    sentencePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function displaySrtLibrary() {
    const listEl = document.getElementById('srtLibraryList');
    const countEl = document.getElementById('srtLibCount');
    const data = srtLibrary.getAll();

    countEl.textContent = data.length;
    listEl.innerHTML = '';

    if (data.length === 0) {
        listEl.innerHTML = `
            <div class="empty-library" style="grid-column: 1/-1;">
                <div style="font-size: 40px; margin-bottom: 10px;">🎬</div>
                <div>저장된 SRT 파일이 없습니다.<br>SRT 파일을 업로드해보세요!</div>
            </div>
        `;
        return;
    }

    data.forEach(item => {
        const date = new Date(item.date).toLocaleDateString();

        const el = document.createElement('div');
        el.className = 'srt-item';
        el.onclick = () => loadSrtToSentenceList(item.id);

        el.innerHTML = `
            <button class="delete-btn" onclick="deleteFromSrtLibrary(${item.id}, event)" title="삭제">×</button>
            <div class="srt-item-name">📄 ${item.filename}</div>
            <div class="srt-item-count">문장 수: ${item.count}개</div>
            <div class="srt-item-date">${date}</div>
        `;

        listEl.appendChild(el);
    });
}

// ========== 페이지 로드 시 초기화 ==========
document.addEventListener('DOMContentLoaded', init);
