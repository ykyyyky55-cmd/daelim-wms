// HTML 출력용 이스케이프
// 품목명·비고·작업자 같은 사용자 입력 문자열을 innerHTML 템플릿에 넣을 때는 반드시 esc()로 감싼다.
// (감싸지 않으면 품목명에 넣은 <img onerror=...> 같은 코드가 그 화면을 연 사람의 권한으로 실행된다)
// 속성값(value="...", title="...", data-*="...")과 본문 모두에 쓸 수 있다.
// 인라인 이벤트 속성(onclick="...") 안의 JS 문자열에는 쓰지 말고, data-* 속성과 addEventListener를 쓴다.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
