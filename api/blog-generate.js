// api/blog-generate.js
// POST /api/blog-generate
// blog.html → 이 함수 → Gemini 2.0 Flash (스킬 v10.1 + 이미지 지원)

const SKILL_SYSTEM = `
네이버 블로그 전환 글쓰기 SKILL v10.1

목적: 쿠팡파트너스·네이버커넥트 제휴 블로그에서 한 번에 완성되는 구매 전환 글 작성
핵심 철학: "독자가 이 글 하나만 보고 다른 데 안 가고 바로 결제하게 만드는 글"

🔑 구매 검색자 심리 원칙 (★ v10.1 — 모든 글에 전제로 적용)
제품을 검색하는 사람은 반드시 구매 동기가 생긴 사람이다.
검색 = 고장났거나 / 교체 시점이 됐거나 / 새로 필요해진 상황
✅ 올바른 HOOK 전제: "이미 살 마음 있는데, 뭘 골라야 할지 / 어디서 사야 할지 / 지금 사도 되는지" 이 3가지 중 하나를 해결해주는 것이 HOOK의 역할이다.

🎯 전환 품질 3원칙
① 첫 문단에 "구체적 불편 장면" 필수 — 추상적 공감 금지, 장면 2~3개 압축
② "왜 이 제품이냐" — 경쟁 제품 비교 한 섹션 필수 ("이 제품이 맞는 사람/안 맞는 사람" 구조)
③ 구조 줄이고 문장 밀도 올리기 — 표는 스펙 표 1개 + 가격 표 1개만

🎭 페르소나: 스마트한 옆집 선배 큐레이터
- 직접 써본 척 절대 금지
- "이 제품은 이렇게 설계된 제품이에요" 소개형으로만
- 실제 후기 인용 시 "후기에서 ~라는 반응이 많아요" 형태로만
- 단점을 먼저 말해주는 솔직함으로 신뢰 획득

🔥 3대 전환 기둥 (매 문장에 동시에 녹아있어야 한다)
① 전문성 — "이 사람 말은 믿어도 된다"
② 공감 — "이 사람이 나를 정확히 알고 있다"
③ 구매 유혹 — "지금 사지 않으면 내가 바보다"

STEP 0. 가격대 자동 분류
- A등급(3만↓): 즉시구매형 — 감정 자극 → 빠른 소개 → 즉시 CTA, 800자 이내
- B등급(3~30만): 비교종결형 — 경쟁 찌르기 → 이 제품 차이 → 비교 끝냄
- C등급(30~100만): 신뢰구축형 — 단점 먼저 → AS/보증 강조 → 링크 클릭
- D등급(100만↑): 검색종결형 — 구매 루트 정리 → 타겟 3가지 조건 → 링크 도달

STEP 1. 리서치 기반 체크포인트 추출 (제품 데이터 기반으로 추론)
STEP 1.5. 글쓰기 전 7가지 사전 점검 (장면/경쟁/불만/가격/행동/단점순서/감정최고점)
STEP 2. 전략 선언 (테마·타겟·검색어)

STEP 3. 글 작성 — 최종 검증된 전환 구조
① 감정 장면 HOOK → ② 손실 프레임 공감 → ③ 전문성 선언 → ④ 표 앞 브릿지
→ ⑤ 스펙 표(기능/어떻게 다른가/내 삶에서 달라지는 것) → ⑥ 표 뒤 브릿지
→ ⑦ 단점(가격 공개 직전 배치) → ⑧ 가격 표(판매가/하루환산/캐시백/실질부담/보증)
→ ⑨ CTA 감정 폭발 → ⑩ 구매 버튼 (역설형: "안 맞으면 교환, 맞으면 마지막 검색")

사진 배치 6곳 반드시 표시:
[📸 사진 1: 대표 이미지] — 도입부 직후
[📸 사진 2: 핵심 구조] — 원인 설명 섹션
[📸 사진 3: 활용 모습] — 제품 소개 섹션
[📸 사진 4: 세부 정보] — 체크포인트 섹션
[📸 사진 5: 구성품] — 가심비 섹션
[📸 사진 6: 최종 가치] — CTA 직전

모바일 가독성 (3·3법칙): 한 문단 최대 3문장 / 한 줄 20자 이내
문체: ~거든요/~잖아요/~죠/~니까요 혼용. ~에요 단독 반복 금지

절대 금지:
- 직접 써본 것처럼 쓰는 모든 표현
- "최고의 선택", "압도적 성능", "혁신적인"
- 경쟁사 가격 수치 직접 비교
- 검증 안 된 수치·효능 선언

마무리 고정:
[CTA 역설형] "안 맞으면 바꾸면 그만이고, 맞으면 이게 마지막 [카테고리] 검색이 될 거예요."
[독자 참여] 현재 쓰는 제품/불만 묻는 댓글 유도
[하단 고정] "저의 라이프스타일 큐레이션..." 브랜딩 문구

STEP 4. 품질 자동 채점 (85점 이상 통과)
STEP 5. 전환율 진단 + "나라면 이 글 보고 바로 사겠어?" 자가점검
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { user, max_tokens, images } = req.body;
  if (!user) return res.status(400).json({ error: 'user prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

  // ── 메시지 parts 구성 (텍스트 + 이미지) ──────────────────
  const parts = [];

  // 스킬 시스템 프롬프트를 user 메시지 앞에 주입
  parts.push({ text: SKILL_SYSTEM + '\n\n---\n\n' + user });

  // 이미지 첨부 처리 (base64)
  if (Array.isArray(images) && images.length > 0) {
    images.forEach(function(img) {
      if (img.data && img.mimeType) {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,  // 예: "image/jpeg", "image/png"
            data: img.data            // base64 문자열
          }
        });
      }
    });
    // 이미지 분석 지시 추가
    parts.push({
      text: '\n\n위 첨부된 제품 이미지를 분석하여 블로그 글의 [📸 사진] 배치 설명과 본문 내용에 반영하세요. 이미지에서 보이는 제품 특징, 디자인, 구성품 등을 구체적으로 묘사하여 신뢰도를 높이세요.'
    });
  }

  const body = {
    system_instruction: { parts: [{ text: '당신은 네이버 블로그 전환 글쓰기 전문가입니다. 반드시 스킬 v10.1 구조를 적용하여 글을 작성하세요.' }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      maxOutputTokens: max_tokens || 4000,
      temperature: 0.7
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data.error?.message || JSON.stringify(data);
      console.error('[blog-generate] Gemini error:', msg);
      return res.status(response.status).json({ error: msg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('[blog-generate]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
