// ==========================================
// 메뉴 구성 (상단 메뉴 Header.js · 사이드바 Sidebar.js 공용)
// ==========================================
// NAV_TREE: 상단 메뉴 줄의 순서. 묶음(items)은 커서를 올리면 전체 메뉴가 한꺼번에 펼쳐지는 칸(열)이 된다.
//   items 안의 { heading } 은 칸 안의 작은 제목(예: 업무일지(생산))이다.
// 순서는 사용자가 메뉴 줄의 [⇄ 메뉴 순서] 로 좌우를 바꿀 수 있고 기기별로 기억한다(daelim_nav_order).
// 새 탭을 추가하면 TAB_META와 NAV_TREE(묶음 또는 단독)에 넣으세요.

export const TAB_META = {
    home: { icon: 'home', label: '홈 (대시보드)', desc: '실시간 재고 현황 및 위젯 대시보드' },
    hqLog: { icon: 'clipboard-list', label: '업무일지(본사)', desc: '본사 일일 포장·원액·이동·입출고 실적' },
    gimpoLog: { icon: 'clipboard-list', label: '업무일지(김포)', desc: '김포공장 일일 포장·원액·이동·입출고 실적' },
    production: { icon: 'factory', label: '제품생산 / 입고', desc: 'BOM 배합비 자동 연동 생산 및 입고' },
    secureWorkOrders: { icon: 'flask-round', label: '원액 작업지시서 🔒', desc: '제조시방서·작업지시서 (마스터·작업일지 관리자)' },
    scan: { icon: 'scan-line', label: '현장 스캔 / 작업', desc: 'QR·바코드 모바일 스캔 입출고·이동' },
    prodSchedule: { icon: 'calendar-range', label: '생산(포장) 스케줄', desc: '작성일자별 본사·김포 포장 스케줄' },
    calendar: { icon: 'calendar', label: '수불·입출고 캘린더', desc: '일정·전표·입출고 캘린더' },
    prodPlan: { icon: 'clipboard-pen-line', label: '생산계획', desc: '월간·주간·일일 생산계획, 부족·안전재고 확인' },
    purchPlan: { icon: 'shopping-cart', label: '구매계획', desc: '월간·주간 구매계획 (부족 원부자재·구매요청 연동)' },
    prodRequest: { icon: 'file-input', label: '생산요청서', desc: '제품생산요청서 · 원액생산요청서 → 생산계획 반영' },
    purchRequest: { icon: 'shopping-bag', label: '구매요청서', desc: '원료·부자재 구매 요청 → 구매계획 반영' },
    slipIssue: { icon: 'file-signature', label: '전표발행', desc: '거래 출하 전표 발행 (위아래 2장·담당자 알림)' },
    master: { icon: 'layout-grid', label: '품목 마스터 관리', desc: '품목코드·분류·규격 기준정보' },
    inventory: { icon: 'database', label: '창고 재고 현황', desc: '거점별 실시간 재고 및 안전재고' },
    docScan: { icon: 'scan-text', label: '전표 스캔 등록', desc: '인쇄된 전표를 찍어 읽고 확인 후 입고/출고' },
    rawLedger: { icon: 'cylinder', label: '원료 수불부', desc: '원료·원액 수·불·재고(L/KG/비중) 누적 원장' },
    productLedger: { icon: 'package-check', label: '제품 수불부', desc: '완제품 수·불·재고 누적 원장' },
    ledger: { icon: 'book-open-check', label: '자재 수불부', desc: '부자재·소모품·기타 수·불·재고 누적 원장' },
    ledgerViewer: { icon: 'library', label: '수불부 조회·인쇄', desc: '원료·제품·자재 수불부 기간 조회·A4 인쇄·엑셀' },
    label: { icon: 'tag', label: '라벨·파렛트식별표 발행', desc: 'Formtec 3120/3130 규격 드럼·파렛트 라벨' },
    labelDesigner: { icon: 'pen-tool', label: '라벨 만들기', desc: '폼텍 용지 선택·양식 디자인·저장·인쇄' },
    fieldQr: { icon: 'qr-code', label: '현장 QR 라벨', desc: '위치·원료 탱크/드럼·사원증 QR 인쇄' },
    oilcalc: { icon: 'flask-conical', label: '비중·오일 계산기', desc: '온도별 비중 환산 및 블렌딩 계산' },
    lubCalc: { icon: 'droplets', label: '윤활유 충진 보정계산기', desc: '충진 용량/중량 환산 및 노즐별 오차 보정' },
    calc: { icon: 'calculator', label: '전자계산기', desc: '사칙연산·괄호·%·메모리·계산 기록' },
    unitConv: { icon: 'ruler', label: '단위환산계산기', desc: '길이·무게·부피·넓이·온도·압력·속도·비중 환산' },
    fxCalc: { icon: 'coins', label: '환율계산기', desc: '무료 공개 환율로 통화 환산 (수수료 보정)' },
    docTools: { icon: 'file-pen-line', label: '뷰어 및 편집기', desc: '엑셀·구글시트·문서(Docs)·PDF 보기 및 간단 편집' },
    audit: { icon: 'clipboard-check', label: '재고실사 / 조사', desc: '전수/표본 실사 및 오차 보정' },
    analytics: { icon: 'bar-chart-3', label: '월간 실적 현황판', desc: '업무일지 월별 종합 실적' },
    planning: { icon: 'calculator', label: '발주·생산 검토', desc: '적정 재고 분석 및 원료 소요량 예측' },
    eApproval: { icon: 'stamp', label: '전자결재', desc: '내 전자서명(원형 도장) · 결재 문서함' },
    history: { icon: 'history', label: '전체 작업·감사 이력', desc: '모든 입출고 및 수정 감사 로그' },
    notice: { icon: 'megaphone', label: '공지사항', desc: '회사 공지 (등록 시 모두에게 알림·메시지)' },
    manual: { icon: 'book-open', label: '매뉴얼', desc: '사용자 매뉴얼: 기능별 단계별 사용법·주의사항' },
    settings: { icon: 'settings', label: '환경설정', desc: '사용자 권한, 클라우드 연동, 백업' }
};

export const NAV_TREE = [
    { id: 'home', tab: 'home' },
    { id: 'prodWork', label: '생산업무', icon: 'factory', items: [{ heading: '업무일지(생산)' }, 'hqLog', 'gimpoLog', { heading: '생산·현장' }, 'production', 'scan'] },
    { id: 'schedule', label: '일정관리', icon: 'calendar-days', items: ['prodSchedule', 'calendar'] },
    { id: 'plan', label: '생산관리', icon: 'clipboard-pen-line', items: ['prodPlan', 'purchPlan', 'prodRequest', 'purchRequest', 'slipIssue'] },
    { id: 'stock', label: '품목 및 재고관리', icon: 'boxes', items: ['master', 'inventory', 'docScan', 'audit', { heading: '수불부' }, 'rawLedger', 'productLedger', 'ledger', 'ledgerViewer'] },
    { id: 'labelGroup', label: '라벨', icon: 'tag', items: ['label', 'labelDesigner', 'fieldQr'] },
    { id: 'tool', label: 'TOOL', icon: 'wrench', items: ['oilcalc', 'lubCalc', 'calc', 'unitConv', 'fxCalc', 'docTools'] },
    // 특별보안: 메뉴 줄에서 접어(🔒만) 숨기거나 펼칠 수 있다 (collapsible)
    { id: 'secureWorkOrders', tab: 'secureWorkOrders', collapsible: true },
    { id: 'analytics', tab: 'analytics' },
    { id: 'planning', tab: 'planning' },
    { id: 'eApproval', tab: 'eApproval' },
    { id: 'history', tab: 'history' },
    { id: 'support', label: '지원', icon: 'life-buoy', items: ['notice', 'manual'] },
    { id: 'settings', tab: 'settings' }
];

/** 묶음 메뉴 (사이드바 펼침 그룹): [{ id, label, icon, memberIds }] */
export const NAV_GROUPS = NAV_TREE.filter(n => n.items).map(n => ({ id: n.id, label: n.label, icon: n.icon, memberIds: n.items.filter(x => typeof x === 'string') }));

// ---------- 상단 메뉴 순서 (좌우 바꾸기) ----------
const ORDER_KEY = 'daelim_nav_order';
export const DEFAULT_NAV_ORDER = NAV_TREE.map(n => n.id);
export const loadNavOrder = () => {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { saved = []; }
    if (!Array.isArray(saved) || !saved.length) return [...DEFAULT_NAV_ORDER];
    const known = saved.filter(id => DEFAULT_NAV_ORDER.includes(id));
    // 저장 뒤에 새로 생긴 메뉴는 기본 순서의 앞 메뉴 뒤에 끼운다
    DEFAULT_NAV_ORDER.forEach((id, i) => {
        if (known.includes(id)) return;
        const prev = DEFAULT_NAV_ORDER.slice(0, i).reverse().find(p => known.includes(p));
        known.splice(prev ? known.indexOf(prev) + 1 : 0, 0, id);
    });
    return known;
};
export const saveNavOrder = (order) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* 무시 */ } };
// 접을 수 있는 메뉴(원액 작업지시서)의 접힘 상태 (기기별)
const COLLAPSE_KEY = 'daelim_nav_collapsed';
export const navCollapsed = () => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch { return []; } };
export const toggleNavCollapsed = (id) => { const list = navCollapsed(); const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]; try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* 무시 */ } return next.includes(id); };
export const resetNavOrder = () => { try { localStorage.removeItem(ORDER_KEY); } catch { /* 무시 */ } };
export const orderedNav = () => { const order = loadNavOrder(); return order.map(id => NAV_TREE.find(n => n.id === id)).filter(Boolean); };
