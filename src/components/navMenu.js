// ==========================================
// 메뉴 구성 (상단 메뉴 Header.js · 사이드바 Sidebar.js 공용)
// ==========================================
// NAV_TREE: 상단 메뉴 줄의 순서. 묶음(items)은 커서를 올리면 전체 메뉴가 한꺼번에 펼쳐지는 칸(열)이 된다.
//   묶음 이름을 누르면 그 묶음의 화면(묶음 화면: 안의 메뉴를 카드로 모아 보여 줌, 탭 이름 'hub-<묶음 id>')이 열린다 — components/MenuHub.js. desc = 그 화면 머리의 한 줄 설명.
//   items 안의 { heading } 은 칸 안의 작은 제목(예: 업무일지(생산))이다.
// 순서는 사용자가 메뉴 줄의 [⇄ 메뉴 순서] 로 좌우를 바꿀 수 있고 기기별로 기억한다(daelim_nav_order).
// 새 탭을 추가하면 TAB_META와 NAV_TREE(묶음 또는 단독)에 넣으세요.

export const TAB_META = {
    home: { icon: 'home', label: '홈', desc: '오늘 현황·바로가기·위젯' },
    hqLog: { icon: 'clipboard-list', label: '업무일지(본사)', desc: '본사 일일 포장·원액·이동·입출고 실적' },
    gimpoLog: { icon: 'clipboard-list', label: '업무일지(김포)', desc: '김포공장 일일 포장·원액·이동·입출고 실적' },
    productionHq: { icon: 'factory', label: '제품생산/입고(본사)', desc: '본사에서 만든 제품·원액 입고, 본사 재고에서 원부자재 자동 차감' },
    production: { icon: 'factory', label: '제품생산/입고(김포)', desc: '김포공장에서 만든 제품·원액 입고, 김포 재고에서 원부자재 자동 차감' },
    secureWorkOrders: { icon: 'flask-round', label: '원액 작업지시서 🔒', desc: '제조시방서·작업지시서 (마스터·작업일지 관리자)' },
    scan: { icon: 'scan-line', label: '현장 스캔 / 작업', desc: 'QR·바코드 모바일 스캔 입출고·이동' },
    lineCount: { icon: 'scan-barcode', label: '라인 스캔 집계', desc: '포장 라인 스캐너로 제품 수량 자동 집계 → 업무일지·생산 입고' },
    packStandard: { icon: 'book-marked', label: '포장작업표준서', desc: '제품별 포장 작업표준서 작성·열람·인쇄 (QR)' },
    prodSchedule: { icon: 'calendar-range', label: '생산(포장) 스케줄', desc: '작성일자별 본사·김포 포장 스케줄' },
    calendar: { icon: 'calendar', label: '수불·입출고 캘린더', desc: '일정·전표·입출고 캘린더' },
    prodPlan: { icon: 'clipboard-pen-line', label: '생산계획', desc: '월간·주간·일일 생산계획, 부족·안전재고 확인' },
    purchPlan: { icon: 'shopping-cart', label: '구매계획', desc: '월간·주간 구매계획 (부족 원부자재·구매요청 연동)' },
    prodRequest: { icon: 'file-input', label: '생산요청서', desc: '제품·원액 생산요청서 → 생산 스케줄·생산계획 일괄 반영 · 구글 챗·메일 공유' },
    orderBoard: { icon: 'list-ordered', label: '주문관리', desc: '생산요청 접수부터 출하까지 진행 현황 · 주간·월간·분기·반기·년간 집계' },
    shipRequest: { icon: 'truck', label: '출하요청서', desc: '출하(출고)요청서 발행·출하 현황 · 주문 연결 · 공유'},
    purchRequest: { icon: 'shopping-bag', label: '구매요청서', desc: '원료·부자재 구매 요청 → 구매계획 반영' },
    workPlan: { icon: 'target', label: '업무추진계획', desc: '월간·연간 업무추진계획서 (과제·진행률·실적·결재)' },
    slipIssue: { icon: 'file-signature', label: '전표발행', desc: '거래 출하 전표 발행 (위아래 2장·담당자 알림)' },
    slipManage: { icon: 'files', label: '전표관리', desc: '발행한 전표 조회·검색·재인쇄·엑셀·출고 상태' },
    qcProduct: { icon: 'package-check', label: '제품관리', desc: '제품 출하검사 기록 · 제품별 불량률 현황' },
    qcProcess: { icon: 'workflow', label: '공정관리', desc: '공정검사 기록 · 공정·라인별 불량률 현황' },
    qcMaterial: { icon: 'package-search', label: '원부자재관리', desc: '원부자재 수입검사 · 공급처별 불량률 현황' },
    lotTrace: { icon: 'route', label: 'LOT 추적', desc: 'LOT 하나로 생산·투입 원부자재·품질 검사·이동·출하 거래처 이력 조회 (클레임·회수 대응)' },
    qcEquipment: { icon: 'cog', label: '설비관리', desc: '설비 대장 · 점검·수리·검교정 이력 · 점검 일정' },
    inspectLog: { icon: 'clipboard-check', label: '초·중·종물 검사', desc: '초·중·종물 검사 및 작업일지 (중량 3회·상태·양품/불량)' },
    yieldLog: { icon: 'timer', label: '포장수율표', desc: '포장 공정별 시간·인원 · 인시 · 생산성, 라벨·기타작업' },
    qcBoard: { icon: 'shield-check', label: '품질관리 현황판', desc: '불량률·부적합 조치·성적서 판정·설비 점검·MSDS 검토를 한 화면에' },
    qcMonthly: { icon: 'shield-alert', label: '월간 불량률 현황', desc: '제품·공정·원부자재 불량률 월별 취합 · 추이 · 조치 현황' },
    qcMsds: { icon: 'flask-conical', label: 'MSDS관리', desc: '물질안전보건자료 대장 · 파일 · 검토일 관리' },
    master: { icon: 'layout-grid', label: '품목 마스터 관리', desc: '품목코드·분류·규격 기준정보' },
    inventory: { icon: 'database', label: '창고 재고 현황', desc: '거점별 실시간 재고 및 안전재고' },
    ibcTotes: { icon: 'cylinder', label: 'IBC(공토트) 관리', desc: '공토트 재고(용도 없음·유종별) · 원액 담긴 IBC 대장 · 비움 회수' },
    docScan: { icon: 'scan-text', label: '전표 스캔 등록', desc: '인쇄된 전표를 찍어 읽고 확인 후 입고/출고' },
    rawLedger: { icon: 'cylinder', label: '원료 수불부', desc: '원료·원액 수·불·재고(L/KG/비중) 누적 원장' },
    productLedger: { icon: 'package-check', label: '제품 수불부', desc: '완제품 수·불·재고 누적 원장' },
    ledger: { icon: 'book-open-check', label: '자재 수불부', desc: '부자재·소모품·기타 수·불·재고 누적 원장' },
    ledgerViewer: { icon: 'library', label: '수불부 조회·인쇄', desc: '원료·제품·자재 수불부 기간 조회·A4 인쇄·엑셀' },
    label: { icon: 'tag', label: '라벨·파렛트식별표 발행', desc: 'Formtec 3120/3130 규격 드럼·파렛트 라벨' },
    labelDesigner: { icon: 'pen-tool', label: '라벨 만들기', desc: '폼텍 용지 선택·양식 디자인·저장·인쇄' },
    fieldQr: { icon: 'qr-code', label: '현장 QR 라벨', desc: '위치·원료 탱크/드럼·사원증 QR 인쇄' },
    qrStore: { icon: 'scan-qr-code', label: 'QR코드 저장소', desc: '모든 품목·위치의 품목·입고·출고·생산투입·이동·생산입고 QR · 검색 후 바로 진행 · 종류별 일괄 인쇄' },
    oilcalc: { icon: 'flask-conical', label: '비중·오일 계산기', desc: '온도별 비중 환산 및 블렌딩 계산' },
    viscCalc: { icon: 'beaker', label: '점도·비중 계산기', desc: '혼합 점도·목표 비율·점도지수(ASTM D2270)·온도별 동점도·15℃ 비중(ASTM D1250)' },
    lubCalc: { icon: 'droplets', label: '윤활유 충진 보정계산기', desc: '충진 용량/중량 환산 및 노즐별 오차 보정' },
    calc: { icon: 'calculator', label: '전자계산기', desc: '사칙연산·괄호·%·메모리·계산 기록' },
    unitConv: { icon: 'ruler', label: '단위환산계산기', desc: '길이·무게·부피·넓이·온도·압력·속도·비중 환산' },
    fxCalc: { icon: 'coins', label: '환율계산기', desc: '무료 공개 환율로 통화 환산 (수수료 보정)' },
    docTools: { icon: 'file-pen-line', label: '뷰어 및 편집기', desc: '엑셀·구글시트·문서(Docs)·PDF·이미지 보기 및 간단 편집' },
    stockCheck: { icon: 'scale', label: '재고 차이 점검', desc: '수불부 최종 재고 ↔ 창고 재고 비교 · 한 번에 맞추기 · 안전재고 구매요청 초안' },
    audit: { icon: 'clipboard-check', label: '재고실사 / 조사', desc: '전수/표본 실사 및 오차 보정' },
    warehouse3d: { icon: 'box', label: '창고 배치도(3D)', desc: '김포1·2공장·본사1(도창동) 창고 구획(라인)·칸을 3D로 보고, 원부자재·제품 위치 찾기·끌어서 옮기기(이동전표 자동 발행)' },
    erpMap: { icon: 'link-2', label: 'ERP 코드 대응표', desc: 'ECOUNT ERP 연동 준비: 품목·거래처·창고 코드 1:1 대응, 단위(L↔kg) 환산, 임시코드 정리, 대응률' },
    feedback: { icon: 'lightbulb', label: '의견·개선 요청', desc: '어느 화면에서든 💡로 캡처와 함께 보낸 오류·개선 요청 — 접수·검토·개발·배포 상태와 답변' },
    usageBoard: { icon: 'activity', label: '사용 정착 현황', desc: 'WMS 기본업무 사용 정착: 거점별 업무일지 작성률·빠진 날, 입출고·수불부·전표 입력 건수, 사람별 현황' },
    partnerBoard: { icon: 'building-2', label: '거래처별 실적', desc: '거래처별 주문·출하·납기 준수율·출하검사 불량률 — 영업·품질 협의 자료' },
    overview: { icon: 'layout-dashboard', label: '종합현황판', desc: '생산·원료 입고·주문·스케줄·품질·재고·요청서·일정 현황을 한 화면에' },
    analytics: { icon: 'bar-chart-3', label: '월간 실적 현황판', desc: '월별 생산실적·원료입고 실적·업무추진 현황' },
    qualityMeeting: { icon: 'clipboard-list', label: '품질회의', desc: '달마다 본사·김포 품질회의 자료(PDF) 보관·열람·결재' },
    reports: { icon: 'folder-kanban', label: '보고서', desc: '월례회의 자료(PPT·PDF)·검토 보고서 모음' },
    planning: { icon: 'calculator', label: '발주·생산 검토', desc: '적정 재고 분석 및 원료 소요량 예측' },
    eApproval: { icon: 'stamp', label: '전자결재', desc: '내 전자서명(원형 도장) · 결재 문서함' },
    fileStore: { icon: 'folder-open', label: '파일 저장소', desc: '품목 사진(품목마스터 대표 사진) · 접수·발행 문서 보관' },
    history: { icon: 'history', label: '전체 작업·감사 이력', desc: '모든 입출고 및 수정 감사 로그' },
    notice: { icon: 'megaphone', label: '공지사항', desc: '회사 공지 (등록 시 모두에게 알림·메시지)' },
    library: { icon: 'library', label: '자료실', desc: '로고·양식·규정·교육 자료 올리기·내려받기' },
    manual: { icon: 'book-open', label: '매뉴얼', desc: '사용자 매뉴얼: 기능별 단계별 사용법·주의사항' },
    settings: { icon: 'settings', label: '환경설정', desc: '사용자 권한, 클라우드 연동, 백업' }
};

export const NAV_TREE = [
    { id: 'home', tab: 'home' },
    { id: 'prodWork', label: '생산업무', icon: 'factory', desc: '매일의 업무일지, 제품생산·입고, 현장 스캔, 검사·수율 양식', items: [{ heading: '업무일지(생산)' }, 'hqLog', 'gimpoLog', { heading: '생산·현장' }, 'productionHq', 'production', 'scan', 'lineCount', 'packStandard', { heading: '검사·수율 양식' }, 'inspectLog', 'yieldLog'] },
    { id: 'schedule', label: '일정관리', icon: 'calendar-days', desc: '생산(포장) 스케줄과 수불·입출고 캘린더', items: ['prodSchedule', 'calendar'] },
    { id: 'plan', label: '생산관리', icon: 'clipboard-pen-line', desc: '생산·구매계획, 구매요청, 업무추진계획, 전표 발행·관리', items: ['prodPlan', 'purchPlan', 'purchRequest', 'workPlan', 'slipIssue', 'slipManage'] },
    { id: 'order', label: '주문관리', icon: 'list-ordered', desc: '생산요청 접수부터 출하까지 주문의 흐름', items: ['orderBoard', 'prodRequest', 'shipRequest'] },
    { id: 'quality', label: '품질관리', icon: 'shield-check', desc: '불량률 관리, 설비·MSDS, LOT 추적', items: [{ heading: '불량률 관리' }, 'qcProduct', 'qcProcess', 'qcMaterial', { heading: '설비·안전' }, 'qcEquipment', 'qcMsds', { heading: '추적' }, 'lotTrace'] },
    { id: 'stock', label: '품목 및 재고관리', icon: 'boxes', desc: '품목 기준정보, 창고 재고·배치도, 실사, 수불부', items: ['master', 'inventory', 'warehouse3d', 'ibcTotes', 'docScan', 'audit', 'stockCheck', 'erpMap', { heading: '수불부' }, 'rawLedger', 'productLedger', 'ledger', 'ledgerViewer'] },
    { id: 'labelGroup', label: '라벨', icon: 'tag', desc: '라벨·식별표 발행, 라벨 만들기, 현장 QR', items: ['label', 'labelDesigner', 'fieldQr', 'qrStore'] },
    { id: 'tool', label: 'TOOL', icon: 'wrench', desc: '비중·점도·충진 계산기, 단위·환율 환산, 문서 뷰어·편집기', items: ['oilcalc', 'viscCalc', 'lubCalc', 'calc', 'unitConv', 'fxCalc', 'docTools'] },
    // 특별보안: 메뉴 줄에서 접어(🔒만) 숨기거나 펼칠 수 있다 (collapsible)
    { id: 'secureWorkOrders', tab: 'secureWorkOrders', collapsible: true },
    { id: 'analyticsGroup', label: '월간 실적 현황판', icon: 'bar-chart-3', desc: '종합현황판, 월간 실적, 거래처·품질 현황, 회의 자료·보고서', items: ['overview', 'analytics', 'partnerBoard', 'qcBoard', 'qcMonthly', 'qualityMeeting', 'reports'] },
    { id: 'planning', tab: 'planning' },
    { id: 'eApproval', tab: 'eApproval' },
    { id: 'fileStore', tab: 'fileStore' },
    { id: 'history', tab: 'history' },
    { id: 'support', label: '지원', icon: 'life-buoy', desc: '공지사항, 의견·개선 요청, 사용 정착 현황, 자료실, 매뉴얼', items: ['notice', 'feedback', 'usageBoard', 'library', 'manual'] },
    { id: 'settings', tab: 'settings' }
];

// ---------- 묶음 화면 (주메뉴마다 그 안의 메뉴를 모아 보여 주는 화면) ----------
const HUB_PREFIX = 'hub-';
/** 묶음의 화면 탭 이름 (예: prodWork → 'hub-prodWork') */
export const hubTabOf = (groupId) => `${HUB_PREFIX}${groupId}`;
/**
 * 탭 이름이 묶음 화면이면 그 묶음, 아니면 null
 * @param {string} tabId
 * @returns {{ id: string, label: string, icon: string, desc?: string, items: Array<string | { heading: string }> } | null}
 */
export const hubGroupOf = (tabId) => (typeof tabId === 'string' && tabId.startsWith(HUB_PREFIX) ? NAV_TREE.find(n => n.items && n.id === tabId.slice(HUB_PREFIX.length)) || null : null);
/**
 * 묶음 화면을 그 주메뉴만의 새 창으로 연다 (창 이름이 묶음마다 달라, 같은 주메뉴는 열려 있던 창을 다시 쓴다)
 * @returns {boolean} 팝업이 막혀 열지 못했으면 false
 */
export const openHubWindow = (groupId) => {
    const url = `${window.location.origin}${window.location.pathname}#${hubTabOf(groupId)}`;
    const win = window.open(url, `daelim-wms-${groupId}`, 'width=1360,height=900');
    if (!win) return false;
    try { win.focus(); } catch { /* 다른 창으로 초점을 옮기지 못해도 창은 열렸다 */ }
    return true;
};
/** 그 탭이 든 묶음 (묶음 밖의 단독 메뉴면 null) */
export const groupOfTab = (tabId) => NAV_TREE.find(n => n.items?.includes(tabId)) || null;

/** 묶음 메뉴 (사이드바 펼침 그룹): [{ id, label, icon, memberIds }] */
export const NAV_GROUPS = NAV_TREE.filter(n => n.items).map(n => ({ id: n.id, label: n.label, icon: n.icon, memberIds: n.items.filter(x => typeof x === 'string') }));

// ---------- 상단 메뉴 순서 (좌우 바꾸기) ----------
const ORDER_KEY = 'daelim_nav_order';
export const DEFAULT_NAV_ORDER = NAV_TREE.map(n => n.id);
export const loadNavOrder = () => {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { saved = []; }
    if (!Array.isArray(saved) || !saved.length) return [...DEFAULT_NAV_ORDER];
    // 단독 메뉴가 묶음으로 바뀐 경우 예전 자리를 이어받는다 (월간 실적 현황판 → 현황판·보고서 묶음)
    const RENAMED = { analytics: 'analyticsGroup' };
    saved = saved.map(id => RENAMED[id] || id);
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
