// ==========================================
// 대림기업 조직(부서) — 홈페이지 조직도(daelimoil.co.kr/124, 2026-09 확인)
// ==========================================
// 부서 칸(가입·계정 관리·작업자 명단·요청서 요청 부서·업무추진계획 주관부서·월례회의 부서)의 선택 목록.
// 예전 부서 이름이 저장된 자료는 그대로 두고 목록에 함께 보여 준다(바꾸지 않음).
import { esc } from './html.js';

/** @type {{ name: string, icon: string, desc: string }[]} */
export const ORG_DEPTS = [
    { name: '연구혁신팀', icon: '🧪', desc: '연구개발(R&D), 신제품·신기술 개발, 성능 개선, 특허 및 기술 연구, 기술연구소 운영' },
    { name: '품질경영팀', icon: '🧭', desc: '품질 정책·기준 수립, 검사·평가, 공정 최적화, 품질 데이터 기반 관리' },
    { name: '생산공급망팀', icon: '🏭', desc: '생산 계획·운영, 효율화, 구매·물류 통합 관리, 공급망 최적화' },
    { name: '디지털전략팀', icon: '💻', desc: '온라인 유통·마케팅, 디자인 기획, 브랜드 홍보, 디지털 혁신 전략' },
    { name: '영업전략팀', icon: '📈', desc: '국내 영업·유통 전략, 신규 사업 발굴, 고객 관리, 해외 시장 진출' },
    { name: '경영지원팀', icon: '🧾', desc: '재무·회계, 인사·총무, 법무, 전사 관리·지원' }
];
export const DEPT_NAMES = ORG_DEPTS.map(d => d.name);

/**
 * 부서 <option> 목록 (조직도 순서). 목록에 없는 예전 부서가 선택돼 있으면 맨 뒤에 '(예전 부서)'로 붙인다.
 * @param selected 선택할 부서
 * @param opts { empty: 빈 선택 글자(없으면 빈 선택 없음) }
 */
export const deptOptionsHtml = (selected = '', { empty = '' } = {}) => {
    const cur = String(selected || '').trim();
    const opts = ORG_DEPTS.map(d => `<option value="${esc(d.name)}" ${d.name === cur ? 'selected' : ''} title="${esc(d.desc)}">${esc(d.name)}</option>`);
    if (cur && !DEPT_NAMES.includes(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)} (예전 부서)</option>`);
    return (empty ? `<option value="" ${cur ? '' : 'selected'}>${esc(empty)}</option>` : '') + opts.join('');
};

/** 자유 입력 칸에 붙이는 제안 목록 (<input list="id">) */
export const deptDatalistHtml = (id) => `<datalist id="${esc(id)}">${ORG_DEPTS.map(d => `<option value="${esc(d.name)}">${esc(d.desc)}</option>`).join('')}</datalist>`;

/** 문서에 부서 제안 목록을 한 번 넣고 그 id를 돌려준다 (<input list="org-dept-list">) */
export const DEPT_LIST_ID = 'org-dept-list';
export const ensureDeptDatalist = () => {
    if (!document.getElementById(DEPT_LIST_ID)) document.body.insertAdjacentHTML('beforeend', deptDatalistHtml(DEPT_LIST_ID));
    return DEPT_LIST_ID;
};
