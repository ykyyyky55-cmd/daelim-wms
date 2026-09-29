// ==========================================
// 대림기업 조직(부서) — 「2026 대림 조직도 및 업무분장 (내부용 Ver.3.0, 2026-06)」 기준
// ==========================================
// 부서 칸(가입·계정 관리·작업자 명단·요청서 요청 부서·업무추진계획 주관부서·월례회의 부서)의 선택 목록과
// 결재 수신(결재자)·참조·공유, 담당자 선택 창의 부서별 묶음(ORG_CHART).
// 예전 부서 이름이 저장된 자료는 그대로 두고 목록에 함께 보여 준다(바꾸지 않음).
import { esc } from './html.js';

/** @type {{ name: string, icon: string, desc: string }[]} */
export const ORG_DEPTS = [
    { name: '연구혁신팀', icon: '🧪', desc: '기술연구소 운영 / 연구개발(R&D) / 신제품·기술 개발 / 제품 성능 개선 / 특허 및 기술 연구 / 기술 경쟁력 강화' },
    { name: '품질경영팀', icon: '🧭', desc: '품질 정책 수립 / 품질 관리 및 보증 / 제품 검사 및 평가 / 공정 최적화 / 안전·환경 관리 / 고객 심사 대응' },
    { name: '생산공급망팀', icon: '🏭', desc: '생산 계획 및 운영 관리 / 생산 효율화 / 구매·물류 통합 관리 / 공급망 최적화' },
    { name: '디지털전략팀', icon: '💻', desc: '온라인 마케팅·판매 전략 / 기업 브랜드 관리 / 콘텐츠 개발 / 디지털 혁신 전략 / 디자인' },
    { name: '영업전략팀', icon: '📈', desc: '국내외 영업·유통 전략 / 신규 사업 기회 확대 / 주요 고객 관리 / 영업 시스템 개선·효율화 / ODM·수출' },
    { name: '경영지원팀', icon: '🧾', desc: '인사·총무 / 재무·회계 / 영업 지원' }
];
export const DEPT_NAMES = ORG_DEPTS.map(d => d.name);

// ---------- 조직도 (부서 → 단위 → 사람) ----------
// [이름, 직위, 담당(요약)]. 한 사람이 두 부서에 있으면(겸직·협력) 양쪽에 모두 나온다.
const M = (rows) => rows.map(([name, position, duty = '']) => ({ name, position, duty }));
/** @type {{ key: string, dept: string, unit: string, members: { name: string, position: string, duty: string }[] }[]} */
export const ORG_CHART = [
    { key: 'EXEC', dept: '경영진', unit: '', members: M([['임명수', '회장'], ['정원일', '대표'], ['임현정', '이사', '대표 보좌 · 디지털전략팀 총괄'], ['한규태', '전무', '총괄전무: 전사 전략·운영, 조직 관리, R&D 투자, 대외 소통, 리스크 관리']]) },
    { key: 'RND', dept: '연구혁신팀', unit: '', members: M([['한규태', '전무', '총괄'], ['최태혁', '이사', '(김포) R&D 전략·과제 승인·예산, 김포 공장 관리 총괄'], ['김정식', '부장', '(김포) 국책과제, 제품 개발·개선, 지식재산권, 원료 최적화'], ['홍승우', '차장', '(김포) 신제품 설계, 성능 평가, 공정 기술 지원'], ['김종민', '책임', '(본사) 신제품 기획·테스트, 시장 조사, CS 가이드']]) },
    { key: 'QM', dept: '품질경영팀', unit: '', members: M([['김기철', '이사', '품질경영시스템 총괄·의사 결정'], ['이동엽', '차장', 'QE·QA, ISO 9001·KS 인증, 품질 문서, VOC, APQP'], ['김완규', '차장', 'PQE·SQE, 공정검사, 검교정, 첨가제 허가번호, MSDS']]) },
    { key: 'SCM-HQ', dept: '생산공급망팀', unit: '본사 총괄', members: M([['김진남', '이사', '본사 생산공급망 총괄']]) },
    { key: 'SCM-OP', dept: '생산공급망팀', unit: '본사 운영부', members: M([['장선영', '차장', '운영책임 (원·부자재 ERP 책임)'], ['전유진', '차장', '구매 책임']]) },
    { key: 'SCM-SUP', dept: '생산공급망팀', unit: '본사 지원부', members: M([['박용채', '부장', '부서장 (지원부 책임)'], ['이재승', '과장', '택배 책임'], ['황현음', '과장', '부동액 제조책임, 원료공급 지원'], ['원영준', '과장', '첨가제 제조책임, 원료공급 지원'], ['김희철', '소장', '운송 책임'], ['박지완', '사원', '자재 책임'], ['장현정', '사원', '라벨 업무책임']]) },
    { key: 'SCM-PK', dept: '생산공급망팀', unit: '본사 포장부', members: M([['박재균', '부장', '부서장 (포장부 책임)'], ['박춘화', '과장', '첨가제, 포장책임'], ['곽수련', '과장', '부동액, 포장책임'], ['이태준', '과장', '포장업무진행 책임'], ['박경순', '반장', '포장업무'], ['배경민', '반장', '포장업무'], ['김은솔', '사원', '포장업무'], ['이종현', '사원', '포장업무']]) },
    { key: 'SCM-GP', dept: '생산공급망팀', unit: '김포 원료·포장', members: M([['최태혁', '이사', '김포 총괄'], ['윤경용', '부장', '김포공장 원료·제품 생산 총괄, 공장 유지관리, 생산·계획, 자재출하'], ['최용화', '대리', '생산·충진 포장, 생산 관리'], ['윤상모', '사원', '생산·충진 포장, 생산 관리'], ['정화순', '사원', '생산·충진 포장'], ['김백철', '사원', '생산·충진 포장'], ['김세중', '사원', '생산·충진 포장'], ['강문모', '사원', '생산·충진 포장']]) },
    { key: 'DX', dept: '디지털전략팀', unit: '', members: M([['임현정', '이사', '디지털전략팀·디자인 총괄'], ['유지은', '팀장', '온라인 채널 브랜드·마케팅 총괄, 광고, 상품 기획 MD'], ['김민기', '과장', '마케팅 운영, 쿠팡 채널, 신제품 개발 지원'], ['백세영', '과장', '브랜드 콘텐츠, 기업 SNS'], ['유영경', '과장', 'ODM 패키지·홍보물 디자인, 브랜드 관리, 제품 촬영'], ['박현송', '사원', '브랜드 콘텐츠·패키지·홈페이지 디자인, 제품 촬영'], ['김경원', '사원', '온라인 CS, 3PL 물류, 쿠팡 리테일 지원'], ['김종민', '책임', '(협력) 공식인증점 운영, 제품 기술 정보, CS 가이드']]) },
    { key: 'SALES', dept: '영업전략팀', unit: '', members: M([['곽재호', '상무', '팀 회의·KPI, 거점 판매점, 필드영업·주요 고객사'], ['박영환', '이사', '영업 전략·KPI, 매출 관리, 주요 고객사'], ['이병욱', '부장', '주요 고객사, 신규 업체·아이템, 납품 관리'], ['김재혁', '차장', '주요 고객사, 수출, ODM 거래처, 매출 data'], ['유승경', '차장', '주요 고객사, 신규 업체, 납품 관리'], ['진윤정', '차장', '해외 영업, 신규 바이어·해외 업체']]) },
    { key: 'MS', dept: '경영지원팀', unit: '', members: M([['김미소', '팀장', '재무·회계·인사·총무 총괄, 결산, 세무, 자금'], ['권시현', '차장', '영업지원, 발주·출고, 수금·정산, 매출·매입, 전산·ERP'], ['김수정', '사원', '사내 환경·위생, 생산 포장 지원']]) }
];
export const orgGroupLabel = (g) => (g.unit ? `${g.dept} · ${g.unit}` : g.dept);
const normName = (s) => String(s || '').replace(/\s+/g, '').trim();

/** 조직도에서 이 이름의 첫 소속 (부서 칸 자동 채움·표시용) */
export const orgInfoOf = (name) => {
    const n = normName(name);
    if (!n) return null;
    for (const g of ORG_CHART) { const m = g.members.find(x => x.name === n); if (m && g.key !== 'EXEC') return { ...m, dept: g.dept, unit: g.unit }; }
    const ex = ORG_CHART[0].members.find(x => x.name === n);
    return ex ? { ...ex, dept: '경영진', unit: '' } : null;
};

/**
 * 앱 사용자 목록을 조직도 부서별로 묶는다
 * @param {{ id: string, name: string, dept?: string }[]} people 가입·승인된 사용자
 * @returns {{ key: string, label: string, members: { name: string, position: string, duty: string, users: object[] }[] }[]}
 *   users = 이 이름의 앱 사용자(없으면 미가입). 조직도에 없는 사용자는 맨 뒤 '조직도 밖' 묶음(프로필 부서 표시)
 */
export const groupPeopleByOrg = (people) => {
    const byName = new Map();
    people.forEach(p => { const n = normName(p.name); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(p); });
    const matched = new Set();
    const groups = ORG_CHART.map(g => ({
        key: g.key, label: orgGroupLabel(g), dept: g.dept,
        members: g.members.map(m => { const users = byName.get(m.name) || []; users.forEach(u => matched.add(String(u.id))); return { ...m, users }; })
    }));
    const rest = people.filter(p => !matched.has(String(p.id)));
    if (rest.length) groups.push({ key: 'ETC', label: '조직도 밖 (가입 정보 부서)', dept: '', members: rest.map(p => ({ name: p.name, position: p.dept || '', duty: '', users: [p] })) });
    return groups;
};

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
