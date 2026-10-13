/**
 * ==============================================================================
 * [Vercel 서버리스 함수: POST /api/chat]
 * ==============================================================================
 * 
 * 💡 특징:
 * 1. Vercel Zero-Config 표준 서버리스 함수로 동작.
 * 2. 매뉴얼 데이터를 코드 내장 모듈(manualData.js)에서 직접 로드하여 파일 경로 에러(ENOENT) 원천 방지.
 * 3. Groq API 키가 없어도 500 크래시 없이 친절한 안내 메시지를 실시간 SSE로 반환.
 */

const { Groq } = require('groq-sdk');
const manualContent = require('../manual_data/manualData.js');

// 모델명 설정
const MODEL_NAME = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// 46개 세부 섹션 파싱 및 메모리 인덱스 구축 (람다 인스턴스 생명주기 동안 캐싱)
let manualSections = [];

function initSections() {
    if (manualSections.length > 0) return;

    const lines = manualContent.split('\n');
    let currentTitle = '남양주시 화물차 인허가 매뉴얼 개요';
    let currentContent = [];

    for (const line of lines) {
        if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ') || line.startsWith('#### ')) {
            if (currentContent.length > 0) {
                manualSections.push({
                    title: currentTitle,
                    content: currentContent.join('\n').trim()
                });
                currentContent = [];
            }
            currentTitle = line.replace(/^#+\s*/, '').trim();
        }
        currentContent.push(line);
    }

    if (currentContent.length > 0) {
        manualSections.push({
            title: currentTitle,
            content: currentContent.join('\n').trim()
        });
    }
}

initSections();

/**
 * 사용자 질문 키워드와 가장 일치하는 매뉴얼 섹션 스마트 발췌
 */
function findRelevantSections(userQuery, maxSections = 3) {
    if (!manualSections.length) initSections();
    if (!manualSections.length) return [];

    const keywords = userQuery.toLowerCase()
        .replace(/[^a-z0-9가-힣\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1);

    const scored = manualSections.map(sec => {
        let score = 0;
        const titleLower = sec.title.toLowerCase();
        const contentLower = sec.content.toLowerCase();

        for (const kw of keywords) {
            if (titleLower.includes(kw)) {
                score += 15;
            }
            const matches = contentLower.match(new RegExp(kw, 'g'));
            if (matches) {
                score += Math.min(matches.length, 10);
            }
        }

        return { ...sec, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const topMatches = scored.filter(s => s.score > 0).slice(0, maxSections);

    if (topMatches.length === 0) {
        return manualSections.slice(0, 3);
    }

    return topMatches;
}

module.exports = async function handler(req, res) {
    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // OPTIONS 프리플라이트 처리
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    // SSE(Server-Sent Events) 응답 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            // 키 누락 시에도 500 크래시 없이 사용자에게 친절한 가이드 출력
            const msg = '⚠️ [안내] Vercel 환경 변수에 GROQ_API_KEY가 등록되지 않았습니다.\nVercel 프로젝트 대시보드 > Settings > Environment Variables 메뉴에서 GROQ_API_KEY를 등록하신 후 Redeploy 해주세요.';
            res.write(`data: ${JSON.stringify({ text: msg })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
        }

        // 요청 바디 파싱 (문자열인 경우 JSON 파싱)
        let body = req.body;
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (e) {
                body = {};
            }
        }
        const { message, history } = body || {};

        if (!message || typeof message !== 'string') {
            res.write(`data: ${JSON.stringify({ text: '질문 내용을 올바르게 입력해주세요.' })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
        }

        // 1) 질문 관련 매뉴얼 섹션 발췌
        const matchedSections = findRelevantSections(message, 3);
        const contextText = matchedSections.map(s => `### [${s.title}]\n${s.content}`).join('\n\n---\n\n');

        // 2) 시스템 프롬프트 구성
        const systemPrompt = `
당신은 "남양주시 자동차관리과 화물팀"의 스마트 인허가 행정 전문 AI 상담관입니다.
남양주시 화물자동차 운송사업 인허가, 양도양수, 차고지 설치, 유가보조금, 휴·폐업 등에 대해 민원인과 실무자에게 안내합니다.

[답변 원칙 및 지침]
1. 아래 [남양주시 화물 실무 매뉴얼 발췌 내용]을 철저히 근거로 하여 사실에 입각한 정확한 답변을 제공하십시오.
2. 답변 형식:
   - 복잡한 서류나 절차는 글머리 기호(-), 번호 목록([1단계], [2단계]), 또는 마크다운 표(Table)로 가독성 높게 정리하십시오.
   - 구비서류 목록, 수수료(예: 3,000원, 1,000원), 처리 기한, 담당 협회 연락처를 빠짐없이 명확하게 기재하십시오.
   - 중요한 유의사항(예: 양도양수 6개월 제한, 1.5톤 이하 차고지 면제 등)은 **볼드체**로 강조하십시오.
3. 정중하고 신뢰감 있는 공공기관 어조로 답변하십시오.
4. 발췌된 매뉴얼에 없는 특수하거나 불확실한 내용은 임의로 추측하지 말고 "남양주시청 자동차관리과 화물팀(또는 관할 화물협회)에 문의하시기 바랍니다"라고 안내하십시오.

--------------------------------------------------
[남양주시 화물 실무 매뉴얼 발췌 내용]
${contextText}
--------------------------------------------------
`.trim();

        // 3) 대화 메시지 배열
        const messages = [{ role: 'system', content: systemPrompt }];

        if (Array.isArray(history)) {
            const recent = history.slice(-4);
            for (const item of recent) {
                if (item.role && item.content) {
                    messages.push({
                        role: item.role === 'user' ? 'user' : 'assistant',
                        content: item.content
                    });
                }
            }
        }

        messages.push({ role: 'user', content: message });

        // 4) Groq SDK 클라이언트 초기화 및 호출
        const groq = new Groq({ apiKey });
        const completionStream = await groq.chat.completions.create({
            model: MODEL_NAME,
            messages: messages,
            temperature: 0.2,
            max_tokens: 1500,
            stream: true
        });

        // 5) 스트리밍 토큰 전송
        for await (const chunk of completionStream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

    } catch (error) {
        console.error('❌ [Vercel 챗봇 스트리밍 오류]:', error);
        res.write(`data: ${JSON.stringify({ text: `\n\n⚠️ 답변 생성 중 오류가 발생했습니다: ${error.message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    }
};
