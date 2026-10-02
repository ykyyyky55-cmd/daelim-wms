// 날짜 포맷 및 전자도장 SVG 생성 등 DOM에 의존하지 않는 헬퍼

/**
 * 일자에 맞는 고해상도 벡터 전자도장 SVG Data URL 생성 함수
 * @param {string} nameText 도장 중앙 이름 (예: '윤경용')
 * @param {string} dateStr 날짜 문자열 (YYYY-MM-DD)
 * @returns {string} SVG Data URL
 */
export function generateStampSvg(nameText, dateStr) {
  const dStr = (dateStr || '').replace(/-/g, '.');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">
      <!-- 외곽 굵은 원 -->
      <circle cx="70" cy="70" r="63" fill="none" stroke="#dc2626" stroke-width="3.5" />
      <!-- 안쪽 가는 원 -->
      <circle cx="70" cy="70" r="57" fill="none" stroke="#dc2626" stroke-width="1.5" />
      <!-- 상단 텍스트: 전자결재 -->
      <text x="70" y="37" fill="#dc2626" font-family="'Noto Sans KR', sans-serif" font-weight="bold" font-size="13" text-anchor="middle">전자결재</text>
      <!-- 중앙 이름: 윤경용 -->
      <text x="70" y="78" fill="#dc2626" font-family="'Noto Sans KR', sans-serif" font-weight="bold" font-size="25" text-anchor="middle">${nameText}</text>
      <!-- 하단 일자: YYYY.MM.DD -->
      <text x="70" y="108" fill="#dc2626" font-family="'Noto Sans KR', sans-serif" font-weight="bold" font-size="11" text-anchor="middle">${dStr}</text>
    </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Date를 로컬(KST) 기준 'YYYY-MM-DD' 문자열로 변환 (toISOString은 UTC라 하루 밀림)
export function toLocalDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 날짜 문자열(YYYY-MM-DD)을 'YYYY년 M월 D일 O요일' 포맷으로 변환
export function getFormattedDateString(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${y}년 ${m}월 ${day}일 ${days[d.getDay()]}`;
}

// 요일 한글 변환 헬퍼 함수
export function getKoreanDayOfWeek(dateStr) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(dateStr);
  return days[d.getDay()] || '';
}
