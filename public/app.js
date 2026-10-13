/**
 * ==============================================================================
 * [남양주시 화물팀 인허가 안내 스마트 AI 챗봇 클라이언트 스크립트]
 * ==============================================================================
 * 
 * 💡 2열 분할 레이아웃 & 자연스러운 스크롤 시스템:
 * 1. [왼쪽 사이드바 조작]:
 *    - 6대 퀵 질문 카드가 상시 유지되어 언제든 원클릭 질의 가능.
 *    - 하단 입력창에서 엔터 또는 버튼 클릭 시 오른쪽 메인 뷰로 즉시 질문 전송.
 * 2. [오른쪽 메인 답변 뷰]:
 *    - 첫 질문 시 초기 안내(Empty State)가 사라지고 실시간 답변이 펼쳐짐.
 *    - requestAnimationFrame 기반 감속 보간(Lerp)으로 부드럽게 글자를 따라 내려가는 스크롤 엔진 적용.
 *    - 사용자가 위쪽을 읽으려고 휠을 올리면 자동 스크롤을 멈추고 우측 하단에 '맨 아래로 이동' 버튼 노출.
 */

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // 1. 주요 DOM 엘리먼트 가져오기
    // ==========================================================================
    const chatContainer = document.getElementById('chatContainer');
    const chatMessages = document.getElementById('chatMessages');
    const emptyStatePlaceholder = document.getElementById('emptyStatePlaceholder');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const quickButtons = document.querySelectorAll('.quick-btn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    const scrollProgressCircle = document.getElementById('scrollProgressCircle');
    const toastNotification = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');

    // ==========================================================================
    // 2. 대화 상태 및 자연스러운 스크롤 관리 변수
    // ==========================================================================
    let isGenerating = false;        // 현재 AI 답변 생성 진행 중 여부
    let conversationHistory = [];    // 대화 문맥 기록
    let abortController = null;      // 통신 중단 컨트롤러

    // 🌊 자연스러운 스크롤 컨트롤러 변수
    let autoScrollEnabled = true;    // 사용자가 바닥에 위치하여 자동 추적 중인지 여부
    let scrollAnimId = null;         // requestAnimationFrame ID
    let renderAnimId = null;         // 렌더링 배치 프레임 ID
    let isRenderPending = false;     // 마크다운 파싱 대기 플래그

    // 마크다운 파서 옵션 설정 (테이블, 줄바꿈 활성화)
    if (window.marked) {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    }

    // ==========================================================================
    // 3. 테마 토글 (다크 모드 / 라이트 모드)
    // ==========================================================================
    const savedTheme = localStorage.getItem('cargo_bot_theme') || 'theme-light';
    document.body.className = savedTheme;
    updateThemeIcon(savedTheme);

    themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.contains('theme-dark');
        const newTheme = isDark ? 'theme-light' : 'theme-dark';
        document.body.className = newTheme;
        localStorage.setItem('cargo_bot_theme', newTheme);
        updateThemeIcon(newTheme);
    });

    function updateThemeIcon(theme) {
        const icon = themeToggleBtn.querySelector('i');
        if (theme === 'theme-light') {
            icon.className = 'fa-solid fa-moon';
        } else {
            icon.className = 'fa-solid fa-sun';
        }
    }

    // ==========================================================================
    // 4. 입력창 자동 높이 조절 & 키 이벤트
    // ==========================================================================
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 110) + 'px';
    });

    // Enter 키 전송 (Shift + Enter는 줄바꿈)
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    sendBtn.addEventListener('click', handleSendMessage);

    // ==========================================================================
    // 5. 🌊 자연스러운 스크롤 엔진 (Smooth & Smart Scrolling)
    // ==========================================================================

    /**
     * 사용자의 스크롤 위치 감지:
     * 1. 스크롤 250px 초과 시 플로팅 Top 버튼을 부드러운 페이드/스케일로 표시
     * 2. 원형 프로그레스 링(Progress Ring)에 현재 페이지 진행률(0~100%) 시각적 갱신
     * 3. 위쪽으로 스크롤했을 때 Bottom 버튼 노출 및 자동 스크롤 잠금
     */
    function handleScrollState() {
        const currentScroll = chatContainer.scrollTop;
        const maxScroll = chatContainer.scrollHeight - chatContainer.clientHeight;
        const threshold = 80;
        const distanceFromBottom = maxScroll - currentScroll;
        const isNearBottom = distanceFromBottom <= threshold;

        // 1) 🔝 스크롤이 250px 초과 시 플로팅 탑 버튼 부드럽게 표시/숨김
        if (scrollToTopBtn) {
            if (currentScroll > 250) {
                scrollToTopBtn.classList.add('visible');
            } else {
                scrollToTopBtn.classList.remove('visible');
            }
        }

        // 2) ⭕ 원형 스크롤 진행률(Progress) 링 실시간 계산 (둘레: 125.66)
        if (scrollProgressCircle && maxScroll > 0) {
            const progress = Math.min(Math.max(currentScroll / maxScroll, 0), 1);
            const circumference = 125.66; // 2 * Math.PI * 20
            const offset = circumference - (progress * circumference);
            scrollProgressCircle.style.strokeDashoffset = offset;
        }

        // 3) ⬇️ 바닥 감지 및 맨 아래로 이동 버튼 상태 관리
        if (isNearBottom) {
            autoScrollEnabled = true;
            if (scrollToBottomBtn) {
                scrollToBottomBtn.classList.remove('visible');
            }
        } else {
            autoScrollEnabled = false;
            if (scrollToBottomBtn) {
                scrollToBottomBtn.classList.add('visible');
            }
        }
    }

    // 휠을 위로 올리면 즉각 자동 스크롤 일시 중지
    chatContainer.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) {
            autoScrollEnabled = false;
            if (scrollToBottomBtn) {
                scrollToBottomBtn.classList.add('visible');
            }
        }
    }, { passive: true });

    // 터치 스크롤 대응 (모바일)
    chatContainer.addEventListener('touchmove', () => {
        handleScrollState();
    }, { passive: true });

    chatContainer.addEventListener('scroll', handleScrollState, { passive: true });

    /**
     * 감속 보간(Ease-out Lerp)을 적용한 부드러운 스크롤 애니메이션
     * 뚝뚝 끊기지 않고 부드럽게 텍스트의 끝을 따라 내려갑니다.
     */
    function smoothScrollFollow() {
        if (!autoScrollEnabled) return;

        const targetTop = chatContainer.scrollHeight - chatContainer.clientHeight;
        const currentTop = chatContainer.scrollTop;
        const diff = targetTop - currentTop;

        // 목표 지점과의 거리가 미세하면 바로 맞춤
        if (Math.abs(diff) <= 2) {
            chatContainer.scrollTop = targetTop;
            return;
        }

        // 부드럽게 16%씩 다가가는 보간 이동
        chatContainer.scrollTop = currentTop + diff * 0.16;

        // 계속 생성 중이고 자동 스크롤 모드면 다음 프레임 요청
        if (isGenerating && autoScrollEnabled) {
            scrollAnimId = requestAnimationFrame(smoothScrollFollow);
        }
    }

    /**
     * 강제로 맨 아래로 즉시 또는 부드럽게 스크롤
     */
    function forceScrollToBottom(smooth = true) {
        autoScrollEnabled = true;
        if (scrollToBottomBtn) {
            scrollToBottomBtn.classList.remove('visible');
        }

        if (smooth) {
            chatContainer.scrollTo({
                top: chatContainer.scrollHeight,
                behavior: 'smooth'
            });
        } else {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    // 플로팅 맨 아래로 이동 버튼 클릭 이벤트
    if (scrollToBottomBtn) {
        scrollToBottomBtn.addEventListener('click', () => {
            forceScrollToBottom(true);
        });
    }

    // 🔝 플로팅 탑(Top) 버튼 클릭 시 최상단으로 부드럽게 스크롤
    if (scrollToTopBtn) {
        scrollToTopBtn.addEventListener('click', () => {
            chatContainer.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    // ==========================================================================
    // 6. 퀵 추천 질문 버튼 클릭 이벤트
    // ==========================================================================
    quickButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const query = btn.getAttribute('data-query');
            if (query && !isGenerating) {
                chatInput.value = query;
                handleSendMessage();
            }
        });
    });

    // 대화 초기화 버튼
    clearChatBtn.addEventListener('click', () => {
        if (confirm('대화 내용을 모두 지우고 처음으로 돌아가시겠습니까?')) {
            chatMessages.innerHTML = '';
            if (emptyStatePlaceholder) {
                emptyStatePlaceholder.style.display = 'flex';
            }
            conversationHistory = [];
            chatInput.value = '';
            chatInput.style.height = 'auto';
            if (scrollToBottomBtn) {
                scrollToBottomBtn.classList.remove('visible');
            }
            if (scrollToTopBtn) {
                scrollToTopBtn.classList.remove('visible');
            }
            showToast('대화가 초기화되었습니다.');
        }
    });

    // ==========================================================================
    // 7. 메시지 전송 및 초고속 실시간 스트리밍 처리 함수
    // ==========================================================================
    async function handleSendMessage() {
        const userText = chatInput.value.trim();
        if (!userText || isGenerating) return;

        // 오른쪽 초기 빈 화면 안내가 있다면 숨기기
        if (emptyStatePlaceholder && emptyStatePlaceholder.style.display !== 'none') {
            emptyStatePlaceholder.style.display = 'none';
        }

        // 1) 사용자 질문 화면에 추가 (오른쪽 대화창에 추가)
        appendUserMessage(userText);

        // 입력창 비우기 및 높이 리셋
        chatInput.value = '';
        chatInput.style.height = 'auto';

        // 2) AI 응답 말풍선(빈 상태 + 깜빡이는 커서) 생성
        const botMessageElements = createBotMessagePlaceholder();
        const { cursorElement, textContainer, rowElement } = botMessageElements;

        // 상태 플래그 활성화
        isGenerating = true;
        autoScrollEnabled = true; // 새 질문 시 자동 스크롤 모드 활성화
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        // 새 질문 위치로 부드럽게 스크롤
        forceScrollToBottom(true);

        // 3) 백엔드 서버에 SSE 스트리밍 요청
        abortController = new AbortController();
        let fullBotReply = '';

        /**
         * 프레임 드랍 없는 실시간 마크다운 렌더링 스케줄러 (requestAnimationFrame)
         */
        function scheduleMarkdownRender() {
            if (isRenderPending) return;
            isRenderPending = true;

            renderAnimId = requestAnimationFrame(() => {
                // 실시간 마크다운 파싱 및 표 렌더링
                textContainer.innerHTML = marked.parse(fullBotReply);
                isRenderPending = false;

                // 자동 스크롤 모드일 때 부드러운 스크롤 애니메이션 작동
                if (autoScrollEnabled) {
                    smoothScrollFollow();
                }
            });
        }

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: userText,
                    history: conversationHistory
                }),
                signal: abortController.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `서버 오류 (${response.status})`);
            }

            // 4) ReadableStream으로부터 초고속 청크 실시간 수신
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 미완성 청크는 버퍼에 보관

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine.startsWith('data: ')) continue;

                    const jsonStr = trimmedLine.replace('data: ', '').trim();
                    if (!jsonStr) continue;

                    try {
                        const parsed = JSON.parse(jsonStr);

                        if (parsed.error) {
                            throw new Error(parsed.error);
                        }

                        if (parsed.text) {
                            fullBotReply += parsed.text;
                            // requestAnimationFrame 주기에 맞춰 부드럽게 렌더링 및 스크롤
                            scheduleMarkdownRender();
                        }

                        if (parsed.done) {
                            break;
                        }
                    } catch (jsonErr) {
                        console.error('SSE 파싱 에러:', jsonErr);
                    }
                }
            }

            // 5) 스트리밍 완료 후 최종 정리
            if (renderAnimId) cancelAnimationFrame(renderAnimId);
            textContainer.innerHTML = marked.parse(fullBotReply); // 최종 완전 파싱 보장
            cursorElement.remove(); // 타이핑 커서 제거
            
            // 완료 후 메시지 툴바(복사 버튼, 시간 등) 추가
            appendMessageToolbar(rowElement, fullBotReply);

            // 대화 기록에 저장
            conversationHistory.push({ role: 'user', content: userText });
            conversationHistory.push({ role: 'assistant', content: fullBotReply });

            // 마지막 스크롤 정렬
            if (autoScrollEnabled) {
                forceScrollToBottom(true);
            }

        } catch (error) {
            console.error('대화 처리 실패:', error);
            cursorElement.remove();
            textContainer.innerHTML = `
                <div style="color: #ef4444; font-weight: 600;">
                    <i class="fa-solid fa-triangle-exclamation"></i> 죄송합니다. 응답 생성 중 오류가 발생했습니다:
                    <div style="font-size: 13px; margin-top: 4px; color: #94a3b8;">${error.message}</div>
                </div>
            `;
        } finally {
            isGenerating = false;
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
            if (scrollAnimId) cancelAnimationFrame(scrollAnimId);
            chatInput.focus();
        }
    }

    // ==========================================================================
    // 8. UI 보조 헬퍼 함수들
    // ==========================================================================

    // 사용자 메시지 DOM 생성
    function appendUserMessage(text) {
        const timeStr = getCurrentTime();
        const row = document.createElement('div');
        row.className = 'message-row user-row';
        row.innerHTML = `
            <div class="message-content-wrapper">
                <div class="message-bubble">${escapeHtml(text)}</div>
                <div class="message-meta">${timeStr}</div>
            </div>
            <div class="message-avatar">
                <i class="fa-solid fa-user"></i>
            </div>
        `;
        chatMessages.appendChild(row);
    }

    // 봇 메시지 플레이스홀더 생성
    function createBotMessagePlaceholder() {
        const row = document.createElement('div');
        row.className = 'message-row bot-row';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';

        const wrapper = document.createElement('div');
        wrapper.className = 'message-content-wrapper';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble markdown-body';

        const textContainer = document.createElement('div');
        textContainer.className = 'bot-text-inner';

        const cursor = document.createElement('span');
        cursor.className = 'typing-cursor';

        bubble.appendChild(textContainer);
        bubble.appendChild(cursor);
        wrapper.appendChild(bubble);

        row.appendChild(avatar);
        row.appendChild(wrapper);

        chatMessages.appendChild(row);

        return {
            rowElement: row,
            bubbleElement: bubble,
            textContainer: textContainer,
            cursorElement: cursor
        };
    }

    // 봇 메시지 하단에 툴바(복사 버튼, 안내 태그) 추가
    function appendMessageToolbar(rowElement, textContent) {
        const wrapper = rowElement.querySelector('.message-content-wrapper');
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.innerHTML = `
            <span>${getCurrentTime()}</span>
            <span>•</span>
            <button class="action-btn copy-btn" title="답변 복사">
                <i class="fa-regular fa-copy"></i> 복사
            </button>
        `;

        const copyBtn = meta.querySelector('.copy-btn');
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(textContent).then(() => {
                showToast('답변이 클립보드에 복사되었습니다!');
            }).catch(() => {
                showToast('복사에 실패했습니다.');
            });
        });

        wrapper.appendChild(meta);
    }

    // 현재 시간 포맷팅 (오전/오후 HH:MM)
    function getCurrentTime() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? '오후' : '오전';
        const formattedHours = hours % 12 || 12;
        return `${ampm} ${formattedHours}:${minutes}`;
    }

    // HTML 특수문자 이스케이프 (XSS 방지)
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 토스트 알림 표시
    function showToast(msg) {
        toastMessage.textContent = msg;
        toastNotification.classList.add('show');
        setTimeout(() => {
            toastNotification.classList.remove('show');
        }, 2500);
    }
});
