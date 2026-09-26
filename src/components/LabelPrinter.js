import { state } from '../services/db.js';
import { qrDataUrl } from '../services/qrCode.js';
import { searchMasterItems, localDateStr } from '../services/searchUtils.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';
import formtecLabels from '../data/formtecLabels.json';
import { qrItemLabelElements, sheetsHtml, cellsPerSheet, fitLabelTexts, openLabelPrintWindow, writeLabelPrintWindow } from '../services/labelRender.js';

// QR 다목적 라벨 용지 (실제 폼텍 규격: src/data/formtecLabels.json) — [코드, 용도]
const ROLL_PAPER = { code: 'roll-10080', sheet: '감열 롤', sheetW: 100, sheetH: 80, across: 1, down: 1, left: 0, top: 0, gapX: 0, gapY: 0, w: 100, h: 80, shape: 'rect', radius: 0 };
const QR_LABEL_PAPERS = [
    { group: '[대형] 드럼 & 페일용', items: [['3120', '200L 드럼/파렛트'], ['3118', '20L 페일/말통']] },
    { group: '[중형] 박스 & 윤활유 용기용', items: [['3116', '중형 박스용'], ['3114', '물류 출하 박스용'], ['3108', '표준 부착용'], ['3218', '다목적용']] },
    { group: '[소형 및 감열 롤] 부품 & 연속용', items: [['3106', '소형 캔/샘플병'], ['3105', '소형 용기'], ['3102', '바코드·부품용'], [ROLL_PAPER.code, '바코드 프린터용 (100 x 80 mm)']] }
];
const qrPaperOf = (code) => (code === ROLL_PAPER.code ? ROLL_PAPER : formtecLabels.find(p => p.code === code && p.sheet === 'A4'));

export const renderLabelPrinter = (container, { initialSubtab = null } = {}) => {
    // -------------------------------------------------------------
    // 1. 초기 상수 및 마스터 데이터 (index1.html 기반)
    // -------------------------------------------------------------
    const MASTER_PRODUCT_INDEX = [
        "AZ - 37", "BF DOT4+ (시생산품)", "BF4+ LV", "DR  5W40", "DR 5W30 PAO", "DR 5W40", "DR BASIC 5W30", "DR ST 0W20", "DR.GP4-PAO 5W30", "EOA - B", "GT 5W30 PAO", "ODM 0W20", "ODM 0W20 GD", "ODM 0W30 LS", "ODM 5W30", "ODM 5W30 PAO", "ODM 5W40", "ODM 5W40 PAO", "SUMOIL  5W40", "SUMOIL 0W20", "SUMOIL 0W30", "SUMOIL 4T 5W40", "SUMOIL 5W30", "고농축 엔진코팅제", "기성K프라임 5W30", "라디크린", "무용제 엔진세척제", "방청윤활제 원료", "보크고스트 5W30", "보크고스트 5W40", "보크스포츠 가솔린 5W30", "보크스포츠 디젤 5W30", "보크스포츠가솔린 5W30", "보크스포츠디젤 5W30", "삼마 엔진코팅제", "삼마글로벌 엔진코팅제", "수분제거&동결방지제", "엑스퍼트 엔진코팅제", "엔진 세척제(크린텍)", "엔진세척제 (크린텍)", "엔진세척제(크린텍)", "엔진코팅제 C", "엔진코팅제-프리미엄", "울트라찬 코팅제", "철분제거제", "철분제거제 (불량)", "카보  0W20", "카보 5W30 PAO", "카보 5W40 PAO", "카보 GT 0W30", "프라임그래핀플러스", "프로텍 엔진코팅제 B"
    ];

    const MASTER_CATEGORIES = [
        "020.xlsx", "030.xlsx", "530.xlsx", "540.xlsx", "BF4+.xlsx", "방청윤활.xlsx", "세척제.xlsx", "수분제거.xlsx", "철분제거제.xlsx", "코팅제.xlsx"
    ];

    const INITIAL_DEFAULT_DATA = [
        {"id": 1, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20", "date": "26.06.23", "lotNo": "G260623-021", "qty": "1,000 L", "note": "SG : 0.8430", "inspectDate": "26.06.23"},
        {"id": 2, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20", "date": "26.07.13", "lotNo": "G260713-021", "qty": "1,000 L", "note": "SG : 0.8436", "inspectDate": "26.07.13"},
        {"id": 3, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20 GD", "date": "26.07.22", "lotNo": "G260722-021", "qty": "1,000 L", "note": "SG : 0.8444", "inspectDate": "26.07.22"},
        {"id": 4, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20 GD", "date": "26.07.23", "lotNo": "G260723-022", "qty": "1,000 L", "note": "SG : 0.8441", "inspectDate": "26.07.23"},
        {"id": 5, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20 GD", "date": "26.04.15", "lotNo": "G260415-022", "qty": "1,000 L", "note": "SG : 0.8453", "inspectDate": "26.04.15"},
        {"id": 6, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20 GD", "date": "26.05.12", "lotNo": "G260512-022", "qty": "1,000 L", "note": "SG : 0.8446", "inspectDate": "26.05.12"},
        {"id": 7, "checked": true, "sheet": "020.xlsx", "productName": "ODM 0W20 GD", "date": "26.08.13", "lotNo": "G260813-022", "qty": "1,000 L", "note": "SG : 0.8443", "inspectDate": "26.08.13"},
        {"id": 8, "checked": true, "sheet": "020.xlsx", "productName": "카보  0W20", "date": "25.12.15", "lotNo": "G251215-021", "qty": "1,000 L", "note": "SG : 0.8455", "inspectDate": "25.12.15"},
        {"id": 9, "checked": true, "sheet": "020.xlsx", "productName": "ODM 5W30 PAO", "date": "25.11.12", "lotNo": "G251112-012", "qty": "1,000 L", "note": "SG : 0.8504", "inspectDate": "25.11.12"},
        {"id": 10, "checked": true, "sheet": "020.xlsx", "productName": "ODM 5W30", "date": "25.11.13", "lotNo": "G251113-021", "qty": "1,000 L", "note": "SG : 0.8512", "inspectDate": "25.11.13"},
        {"id": 11, "checked": true, "sheet": "020.xlsx", "productName": "DR BASIC 5W30", "date": "25.11.13", "lotNo": "G251113-021", "qty": "1,000 L", "note": "SG : 0.8512", "inspectDate": "25.11.13"},
        {"id": 12, "checked": true, "sheet": "020.xlsx", "productName": "DR BASIC 5W30", "date": "25.11.20", "lotNo": "G251120-021", "qty": "1,000 L", "note": "SG : 0.8512", "inspectDate": "25.11.20"},
        {"id": 13, "checked": true, "sheet": "020.xlsx", "productName": "보크고스트 5W30", "date": "25.11.20", "lotNo": "G251120-021", "qty": "1,000 L", "note": "SG : 0.8512", "inspectDate": "25.11.20"},
        {"id": 14, "checked": true, "sheet": "020.xlsx", "productName": "보크스포츠 가솔린 5W30", "date": "25.11.20", "lotNo": "G251120-021", "qty": "1,000 L", "note": "SG : 0.8512", "inspectDate": "25.11.20"},
        {"id": 15, "checked": true, "sheet": "030.xlsx", "productName": "SUMOIL 5W30", "date": "25.12.01", "lotNo": "G251201-021", "qty": "1,000 L", "note": "SG : 0.8513", "inspectDate": "25.12.01"},
        {"id": 16, "checked": true, "sheet": "030.xlsx", "productName": "SUMOIL 0W30", "date": "25.12.01", "lotNo": "G251201-022", "qty": "1,000 L", "note": "SG : 0.8461", "inspectDate": "25.12.01"},
        {"id": 17, "checked": true, "sheet": "030.xlsx", "productName": "ODM 0W30 LS", "date": "25.12.01", "lotNo": "G251201-022", "qty": "1,000 L", "note": "SG : 0.8461", "inspectDate": "25.12.01"},
        {"id": 18, "checked": true, "sheet": "030.xlsx", "productName": "카보 GT 0W30", "date": "25.12.01", "lotNo": "G251201-022", "qty": "1,000 L", "note": "SG : 0.8461", "inspectDate": "25.12.01"},
        {"id": 19, "checked": true, "sheet": "530.xlsx", "productName": "DR 5W30 PAO", "date": "26.01.20", "lotNo": "G260120-021", "qty": "1,000 L", "note": "SG : 0.8511", "inspectDate": "26.01.20"},
        {"id": 20, "checked": true, "sheet": "530.xlsx", "productName": "DR 5W30 PAO", "date": "26.02.04", "lotNo": "G260204-022", "qty": "1,000 L", "note": "SG : 0.8511", "inspectDate": "26.02.04"},
        {"id": 21, "checked": true, "sheet": "540.xlsx", "productName": "ODM 5W40 PAO", "date": "26.01.12", "lotNo": "G260112-021", "qty": "1,000 L", "note": "SG : 0.8522", "inspectDate": "26.01.12"},
        {"id": 22, "checked": true, "sheet": "540.xlsx", "productName": "ODM 5W40 PAO", "date": "26.03.10", "lotNo": "G260310-021", "qty": "1,000 L", "note": "SG : 0.8521", "inspectDate": "26.03.10"},
        {"id": 23, "checked": true, "sheet": "BF4+.xlsx", "productName": "BF4+ LV", "date": "26.02.10", "lotNo": "G260210-021", "qty": "1,000 L", "note": "SG : 1.0541", "inspectDate": "26.02.10"},
        {"id": 24, "checked": true, "sheet": "BF4+.xlsx", "productName": "BF DOT4+ (시생산품)", "date": "26.05.04", "lotNo": "G260504-021", "qty": "1,000 L", "note": "SG : 1.0543", "inspectDate": "26.05.04"},
        {"id": 25, "checked": true, "sheet": "방청윤활.xlsx", "productName": "방청윤활제 원료", "date": "26.01.15", "lotNo": "G260115-021", "qty": "1,000 L", "note": "SG : 0.8123", "inspectDate": "26.01.15"},
        {"id": 26, "checked": true, "sheet": "방청윤활.xlsx", "productName": "방청윤활제 원료", "date": "26.04.10", "lotNo": "G260410-021", "qty": "1,000 L", "note": "SG : 0.8125", "inspectDate": "26.04.10"},
        {"id": 27, "checked": true, "sheet": "세척제.xlsx", "productName": "무용제 엔진세척제", "date": "26.02.18", "lotNo": "G260218-021", "qty": "1,000 L", "note": "SG : 0.8410", "inspectDate": "26.02.18"},
        {"id": 28, "checked": true, "sheet": "세척제.xlsx", "productName": "라디크린", "date": "26.03.22", "lotNo": "G260322-021", "qty": "1,000 L", "note": "SG : 1.0021", "inspectDate": "26.03.22"},
        {"id": 29, "checked": true, "sheet": "수분제거.xlsx", "productName": "수분제거&동결방지제", "date": "26.01.08", "lotNo": "G260108-021", "qty": "1,000 L", "note": "SG : 0.7912", "inspectDate": "26.01.08"},
        {"id": 30, "checked": true, "sheet": "철분제거제.xlsx", "productName": "철분제거제", "date": "26.02.25", "lotNo": "G260225-021", "qty": "1,000 L", "note": "SG : 1.0412", "inspectDate": "26.02.25"},
        {"id": 31, "checked": true, "sheet": "코팅제.xlsx", "productName": "EOA - B", "date": "26.04.06", "lotNo": "G260406-022", "qty": "200 L", "note": "SG : 0.8903", "inspectDate": "26.04.06"},
        {"id": 32, "checked": true, "sheet": "코팅제.xlsx", "productName": "프로텍 엔진코팅제 B", "date": "25.11.20", "lotNo": "G251120-022", "qty": "1,000 L", "note": "SG : 0.8903", "inspectDate": "25.11.20"},
        {"id": 33, "checked": true, "sheet": "코팅제.xlsx", "productName": "엔진코팅제-프리미엄", "date": "26.05.18", "lotNo": "G260518-022", "qty": "1,000 L", "note": "SG : 0.8742", "inspectDate": "26.05.18"},
        {"id": 34, "checked": true, "sheet": "코팅제.xlsx", "productName": "고농축 엔진코팅제", "date": "26.05.18", "lotNo": "G260518-022", "qty": "1,000 L", "note": "SG : 0.8742", "inspectDate": "26.05.18"},
        {"id": 35, "checked": true, "sheet": "코팅제.xlsx", "productName": "프라임그래핀플러스", "date": "26.01.22", "lotNo": "G260122-021", "qty": "1,000 L", "note": "SG : 0.8591", "inspectDate": "26.01.22"},
        {"id": 36, "checked": true, "sheet": "코팅제.xlsx", "productName": "엔진코팅제 C", "date": "26.08.12", "lotNo": "G260812-021", "qty": "1,000 L", "note": "SG : 0.8604", "inspectDate": "26.08.12"},
        {"id": 37, "checked": true, "sheet": "코팅제.xlsx", "productName": "삼마 엔진코팅제", "date": "26.03.15", "lotNo": "G260315-021", "qty": "1,000 L", "note": "SG : 0.8750", "inspectDate": "26.03.15"},
        {"id": 38, "checked": true, "sheet": "코팅제.xlsx", "productName": "삼마글로벌 엔진코팅제", "date": "26.04.18", "lotNo": "G260418-021", "qty": "1,000 L", "note": "SG : 0.8760", "inspectDate": "26.04.18"},
        {"id": 39, "checked": true, "sheet": "코팅제.xlsx", "productName": "엑스퍼트 엔진코팅제", "date": "26.05.20", "lotNo": "G260520-021", "qty": "1,000 L", "note": "SG : 0.8735", "inspectDate": "26.05.20"},
        {"id": 40, "checked": true, "sheet": "코팅제.xlsx", "productName": "울트라찬 코팅제", "date": "26.06.10", "lotNo": "G260610-021", "qty": "1,000 L", "note": "SG : 0.8740", "inspectDate": "26.06.10"}
    ];

    const QTY_OPTIONS = ['1,000 L', '900 L', '800 L', '700 L', '600 L', '500 L', '400 L', '300 L', '200 L', '100 L', '20 L', '4 L', '1 L'];

    const STORAGE_KEY = 'LABEL_APP_SAVED_DATA_V19';
    const HISTORY_KEY = 'LABEL_APP_PRINT_HISTORY_V19';
    const INDEX_STORAGE_KEY = 'LABEL_APP_SAVED_INDEX_V19';
    const CAT_STORAGE_KEY = 'LABEL_APP_SAVED_CATS_V19';

    // 로컬 스토리지 데이터 로드 (기존 index1.html 키와 100% 호환)
    const loadSavedData = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('daelim_formtec_labels');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const existingKeySet = new Set(parsed.map(x => `${x.sheet || ''}||${x.productName || ''}`));
                    const missingDefaults = INITIAL_DEFAULT_DATA.filter(d => !existingKeySet.has(`${d.sheet}||${d.productName}`));
                    if (missingDefaults.length > 0) {
                        const merged = [...parsed, ...JSON.parse(JSON.stringify(missingDefaults))];
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
                        return merged;
                    }
                    return parsed;
                }
            }
        } catch { }
        return JSON.parse(JSON.stringify(INITIAL_DEFAULT_DATA));
    };

    const loadPrintHistory = () => {
        try {
            const raw = localStorage.getItem(HISTORY_KEY);
            if (raw) return JSON.parse(raw);
        } catch { }
        return [];
    };

    const getMasterIndex = () => {
        try {
            const raw = localStorage.getItem(INDEX_STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch { }
        return MASTER_PRODUCT_INDEX;
    };

    const getMasterCategories = () => {
        try {
            const raw = localStorage.getItem(CAT_STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch { }
        return MASTER_CATEGORIES;
    };

    let extractedLabels = loadSavedData();
    let printHistoryList = loadPrintHistory();
    let currentMasterIndex = getMasterIndex();
    let currentMasterCategories = getMasterCategories();

    let searchQuery = '';
    let selectedCategory = '';
    let selectedIndexProduct = '';

    // 날짜 및 LOT 변환 헬퍼
    const formatToShort = (isoDateStr) => {
        if (!isoDateStr) return '';
        const parts = isoDateStr.split('-');
        if (parts.length === 3) {
            return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
        }
        return isoDateStr;
    };

    const formatToISO = (shortDateStr) => {
        if (!shortDateStr) return '';
        const parts = shortDateStr.split('.');
        if (parts.length === 3) {
            const yr = parts[0].length === 2 ? `20${parts[0]}` : parts[0];
            return `${yr}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
        return shortDateStr;
    };

    const generateLotFromDate = (isoDateStr, oldLotNo = '') => {
        if (!isoDateStr) return oldLotNo;
        const parts = isoDateStr.split('-');
        if (parts.length === 3) {
            const yr = parts[0].slice(2);
            const mo = parts[1];
            const dy = parts[2];
            let seq = '021';
            if (oldLotNo && oldLotNo.includes('-')) {
                const oldParts = oldLotNo.split('-');
                if (oldParts.length > 1 && oldParts[1].trim()) {
                    seq = oldParts[1].trim();
                }
            }
            return `G${yr}${mo}${dy}-${seq}`;
        }
        return oldLotNo;
    };

    const saveData = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(extractedLabels));
            localStorage.setItem('daelim_formtec_labels', JSON.stringify(extractedLabels));
            const currentProducts = extractedLabels.map(item => item.productName).filter(Boolean);
            const currentCats = extractedLabels.map(item => item.sheet).filter(Boolean);
            currentProducts.forEach(p => {
                if (p && !currentMasterIndex.includes(p)) currentMasterIndex.push(p);
            });
            currentCats.forEach(c => {
                if (c && !currentMasterCategories.includes(c)) currentMasterCategories.push(c);
            });
            localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(currentMasterIndex));
            localStorage.setItem(CAT_STORAGE_KEY, JSON.stringify(currentMasterCategories));
        } catch (e) {
            console.warn('저장 한도 초과', e);
        }
    };

    // 이전 화면(생산입고 등)에서 전달된 프리필 데이터 확인 및 자동 항목 추가
    const prefill = window.__labelPrefill || null;
    if (prefill) {
        window.__labelPrefill = null;
        const masterMatch = state.master.find(m => m.code === prefill.code);
        const prodName = masterMatch ? masterMatch.name : prefill.code;
        const shortDate = formatToShort(prefill.mfg) || formatToShort(localDateStr());
        
        extractedLabels.unshift({
            id: Date.now() + Math.random(),
            checked: true,
            sheet: "생산연동.xlsx",
            productName: prodName,
            date: shortDate,
            lotNo: prefill.lot || `G${shortDate.replace(/\./g, '')}-021`,
            qty: "1,000 L",
            note: "품질검사 적합 (생산연동)",
            inspectDate: shortDate
        });
        saveData();
    }

    // -------------------------------------------------------------
    // 2. 메인 UI 템플릿 렌더링
    // -------------------------------------------------------------
    container.innerHTML = `
    <section id="tab-content-label" class="space-y-6">
        <!-- 상단 내비게이션 탭 -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white p-5 rounded-2xl shadow-lg border border-slate-800 space-y-4 no-print">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-400/30 flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                            대림오일 정품 라벨 & 바코드 통합 발행기
                        </span>
                        <span class="text-xs text-blue-200 font-mono">Formtec 3120 & 3102 규격 탑재</span>
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2.5">
                        <i data-lucide="tag" class="w-6 h-6 text-amber-400"></i>
                        <span>코팅제 & 오일 라벨 출력 시스템</span>
                    </h2>
                    <p class="text-xs text-slate-300">200L 드럼·1,000L IBC 탱크·소분 용기용 Formtec 3120(A4 2칸 대형, 품질검사 합격 도장) 라벨과 QR/감열식 롤 라벨을 즉시 인쇄합니다.</p>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <button type="button" id="btn-subtab-formtec3120" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="stamp" class="w-4 h-4 text-amber-300"></i>
                        <span>대림오일 공식 라벨 (합격도장 2칸)</span>
                    </button>
                    <button type="button" id="btn-subtab-multiformat" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10">
                        <i data-lucide="qr-code" class="w-4 h-4 text-blue-400"></i>
                        <span>QR & 폼텍 다목적 발행기</span>
                    </button>
                    <button type="button" id="btn-subtab-formtec3130" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10">
                        <i data-lucide="package-check" class="w-4 h-4 text-emerald-400"></i>
                        <span>파렛트 식별표 (Formtec 3130 전면)</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- ========================================================================= -->
        <!-- VIEW 1: 대림오일 공식 라벨 시스템 (Formtec 3120 / 합격도장 / index1.html 이식) -->
        <!-- ========================================================================= -->
        <div id="view-formtec3120" class="space-y-6">
            <!-- 1. 컨트롤 헤더 바 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 no-print">
                <div class="flex flex-wrap justify-between items-center gap-3">
                    <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="printer" class="w-5 h-5 text-rose-600"></i>
                        <span>대림오일 2칸 대형 드럼 라벨 (Formtec 3120 / 200mm × 138mm)</span>
                    </h3>
                    <div class="flex items-center gap-2">
                        <span id="save-status-badge" class="text-xs text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 flex items-center gap-1">
                            <i data-lucide="check" class="w-3.5 h-3.5"></i>
                            <span>자동 저장 활성화됨</span>
                        </span>
                    </div>
                </div>

                <!-- 💡 파일 불러오기 & 업로드 툴바 -->
                <div class="flex items-center gap-2 flex-wrap pt-1">
                    <input type="file" id="excel-file-upload-input" accept=".xlsx, .xls, .csv" class="hidden" />
                    <button type="button" id="btn-trigger-upload-excel" class="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 whitespace-nowrap transition">
                        <i data-lucide="upload" class="w-3.5 h-3.5"></i>
                        <span>라벨 목록 / 백업 파일 업로드 (.xlsx)</span>
                    </button>
                    <button type="button" id="btn-manual-save" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 whitespace-nowrap transition">
                        <i data-lucide="save" class="w-3.5 h-3.5"></i>
                        <span>저장하기</span>
                    </button>
                    <button type="button" id="btn-add-new-label" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 whitespace-nowrap transition">
                        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                        <span>새 라벨 추가</span>
                    </button>
                    <button type="button" id="btn-delete-selected" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-bold py-2 px-3 rounded-xl text-xs whitespace-nowrap transition">
                        선택 항목 삭제
                    </button>
                    <button type="button" id="btn-reset-default-data" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-3 rounded-xl text-xs whitespace-nowrap transition">
                        기본 라벨 복원
                    </button>
                    <button type="button" id="btn-clear-all" class="bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 font-bold py-2 px-3 rounded-xl text-xs whitespace-nowrap transition">
                        전체 비우기
                    </button>
                    <button type="button" id="btn-print-formtec-labels" class="ml-auto bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black py-2.5 px-6 rounded-xl text-sm shadow-md flex items-center gap-2 whitespace-nowrap transition">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>선택 라벨 즉시 인쇄 (A4 2매)</span>
                    </button>
                </div>
            </div>

            <!-- 2. 라벨 폰트 스타일 및 크기 설정 바 -->
            <div class="bg-violet-950 text-white p-4 rounded-2xl shadow-md grid grid-cols-1 md:grid-cols-12 gap-4 items-center no-print border border-violet-900">
                <div class="md:col-span-4 flex items-center gap-2">
                    <span class="text-xs font-bold text-violet-200 whitespace-nowrap">🔤 글꼴 종류:</span>
                    <select id="fmt-font-family-select" class="w-full p-2 border border-violet-400 rounded-xl text-xs font-bold text-slate-900 bg-violet-50 focus:outline-none">
                        <option value="'맑은 고딕', 'Malgun Gothic', sans-serif" selected>맑은 고딕 (기본)</option>
                        <option value="'나눔고딕', 'Nanum Gothic', sans-serif">나눔고딕 (Nanum Gothic)</option>
                        <option value="'Noto Sans KR', sans-serif">노토 산스 (Noto Sans KR)</option>
                        <option value="'돋움', Dotum, sans-serif">돋움 (Dotum)</option>
                        <option value="'굴림', Gulim, sans-serif">굴림 (Gulim)</option>
                        <option value="'Arial', sans-serif">Arial</option>
                    </select>
                </div>
                <div class="md:col-span-4 flex items-center gap-2">
                    <span class="text-xs font-bold text-violet-200 whitespace-nowrap">🏷️ 제품명 크기:</span>
                    <input type="range" id="fmt-title-size-slider" min="36" max="68" value="52" class="w-full cursor-pointer accent-violet-400">
                    <span id="fmt-title-size-val" class="text-xs font-bold bg-violet-900 px-2.5 py-1 rounded-lg border border-violet-700 min-w-[48px] text-center font-mono">52px</span>
                </div>
                <div class="md:col-span-4 flex items-center gap-2">
                    <span class="text-xs font-bold text-violet-200 whitespace-nowrap">📋 본문글자 크기:</span>
                    <input type="range" id="fmt-body-size-slider" min="28" max="58" value="44" class="w-full cursor-pointer accent-violet-400">
                    <span id="fmt-body-size-val" class="text-xs font-bold bg-violet-900 px-2.5 py-1 rounded-lg border border-violet-700 min-w-[48px] text-center font-mono">44px</span>
                </div>
            </div>

            <!-- 3. 과거 출력 이력 조회 및 엑셀 다운로드 바 -->
            <div class="bg-slate-800 text-white p-4 rounded-2xl shadow-md grid grid-cols-1 md:grid-cols-12 gap-3 items-center no-print border border-slate-700">
                <div class="md:col-span-7 flex items-center gap-2">
                    <span class="text-xs font-bold text-amber-300 whitespace-nowrap flex items-center gap-1">
                        <i data-lucide="history" class="w-3.5 h-3.5"></i> 과거 출력 이력:
                    </span>
                    <select id="fmt-history-dropdown" class="w-full p-2 border border-slate-600 rounded-xl text-xs font-bold text-slate-900 bg-amber-50 focus:outline-none">
                        <option value="">-- 과거에 출력했던 데이터 선택 --</option>
                    </select>
                </div>
                <div class="md:col-span-5 flex justify-end gap-2">
                    <button type="button" id="btn-export-label-excel" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded-xl text-xs shadow flex items-center gap-1 whitespace-nowrap transition">
                        <i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i> 엑셀 (.xlsx)
                    </button>
                    <button type="button" id="btn-export-label-csv" class="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3 rounded-xl text-xs shadow flex items-center gap-1 whitespace-nowrap transition">
                        구글시트 CSV
                    </button>
                    <button type="button" id="btn-clear-label-history" class="bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold py-2 px-3 rounded-xl text-xs whitespace-nowrap transition">
                        이력 삭제
                    </button>
                </div>
            </div>

            <!-- 4. 구분 및 제품색인 검색바 -->
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-center no-print">
                <div class="md:col-span-3 flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-700 whitespace-nowrap">📂 구분 선택:</span>
                    <select id="fmt-category-dropdown" class="w-full p-2 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-900 bg-emerald-50 focus:outline-none">
                        <option value="">-- 전체 구분 보기 --</option>
                    </select>
                </div>
                <div class="md:col-span-4 flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-700 whitespace-nowrap">📑 제품 색인:</span>
                    <select id="fmt-index-dropdown" class="w-full p-2 border border-blue-300 rounded-xl text-xs font-bold text-blue-900 bg-blue-50 focus:outline-none">
                        <option value="">-- 전체 제품 보기 --</option>
                    </select>
                </div>
                <div class="md:col-span-3 flex items-center gap-1 relative">
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3"></i>
                    <input type="text" id="fmt-search-input" placeholder="검색어 입력..." class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div class="md:col-span-2 flex justify-end gap-1.5">
                    <button type="button" id="btn-open-register-modal" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded-xl text-xs whitespace-nowrap shadow transition">
                        ➕ 신규 등록
                    </button>
                    <button type="button" id="btn-reset-search" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2 px-3 rounded-xl text-xs whitespace-nowrap transition">
                        🔄 초기화
                    </button>
                </div>
            </div>

            <!-- 5. ⚡ 일괄 수정 박스 -->
            <div class="bg-gradient-to-r from-indigo-50 to-blue-50 p-5 rounded-2xl shadow-sm border border-indigo-100 space-y-3 no-print">
                <div class="flex justify-between items-center">
                    <h4 class="text-xs font-black text-indigo-900 flex items-center gap-1.5">
                        <i data-lucide="zap" class="w-4 h-4 text-amber-500"></i>
                        <span>선택된 라벨 내용 동시에 일괄 수정</span>
                    </h4>
                    <span class="text-[11px] text-indigo-600 font-medium">* 달력 날짜를 변경하면 LOT NO가 자동으로 연동 채번됩니다.</span>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <div>
                        <label class="block text-[11px] font-bold text-slate-600 mb-1">제품명</label>
                        <input type="text" id="bulk-productName" placeholder="예: ODM 0W20" class="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-600 mb-1">DATE (달력)</label>
                        <input type="date" id="bulk-date" class="w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-600 mb-1">LOT NO (자동 연동)</label>
                        <input type="text" id="bulk-lotNo" placeholder="예: G260812-021" class="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-indigo-900">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-600 mb-1">수량 (선택)</label>
                        <select id="bulk-qty" class="w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold">
                            <option value="">-- 변경 안함 --</option>
                            ${QTY_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-600 mb-1">비고 (비중 등)</label>
                        <input type="text" id="bulk-note" placeholder="예: SG : 0.8430" class="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-rose-600 mb-1">검사일자 (도장)</label>
                        <input type="date" id="bulk-inspectDate" class="w-full bg-white border border-rose-300 rounded-xl px-2 py-1.5 text-xs font-bold text-rose-600">
                    </div>
                </div>
                <div class="flex justify-end pt-1">
                    <button type="button" id="btn-apply-bulk" class="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2 px-5 rounded-xl text-xs shadow transition flex items-center gap-1.5">
                        <i data-lucide="check-check" class="w-4 h-4"></i>
                        <span>선택한 라벨 동시에 내용 변경하기</span>
                    </button>
                </div>
            </div>

            <!-- 6. 데이터 입력/수정 테이블 -->
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-print">
                <div class="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div class="flex items-center gap-3">
                        <h4 class="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                            <i data-lucide="list" class="w-4 h-4 text-blue-600"></i>
                            <span>라벨 목록</span>
                        </h4>
                        <span id="fmt-total-count" class="text-xs font-bold text-slate-500 font-mono">총 0건</span>
                    </div>
                </div>
                <div class="overflow-x-auto max-h-[380px]">
                    <table class="w-full text-xs text-left text-slate-700">
                        <thead class="bg-slate-100 text-slate-600 sticky top-0 z-10 font-bold border-b border-slate-200">
                            <tr>
                                <th class="p-3 w-10 text-center"><input type="checkbox" id="fmt-select-all" class="rounded w-4 h-4 text-blue-600 cursor-pointer"></th>
                                <th class="px-3 py-3 w-28">구분(시트)</th>
                                <th class="px-3 py-3">제품명</th>
                                <th class="px-3 py-3 w-32">DATE (달력)</th>
                                <th class="px-3 py-3 w-36">LOT NO (자동연동)</th>
                                <th class="px-3 py-3 w-28">수량 (선택)</th>
                                <th class="px-3 py-3 w-32">비고 (SG 등)</th>
                                <th class="px-3 py-3 w-32 text-rose-600 font-bold">검사일자(도장)</th>
                                <th class="px-3 py-3 w-12 text-center">삭제</th>
                            </tr>
                        </thead>
                        <tbody id="fmt-table-body" class="divide-y divide-slate-100">
                            <!-- JS 렌더링 -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 7. A4 2칸 라벨 실시간 미리보기 및 인쇄 영역 -->
            <div class="space-y-3">
                <div class="flex justify-between items-center no-print">
                    <h4 class="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="eye" class="w-4 h-4 text-blue-600"></i>
                        <span>라벨 미리보기 (A4 1장에 2장씩, 200mm × 138mm 규격)</span>
                    </h4>
                    <button type="button" id="btn-print-formtec-labels-bottom" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-5 rounded-xl shadow text-xs flex items-center gap-1.5 transition">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>선택 라벨 인쇄하기</span>
                    </button>
                </div>

                <div id="print-area-3120" class="printable-area mx-auto flex flex-col items-center gap-6 p-4 bg-slate-200/50 rounded-2xl border border-slate-300 overflow-x-auto">
                    <!-- A4 1장에 2장씩 생성 -->
                </div>
            </div>
        </div>

        <!-- ========================================================================= -->
        <!-- VIEW 2: QR & 폼텍 규격 다목적 라벨 발행기 (기존 기능 유지) -->
        <!-- ========================================================================= -->
        <div id="view-multiformat" class="hidden space-y-6">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="qr-code" class="w-5 h-5 text-blue-600"></i>
                            <span>QR 코드 & 다목적 폼텍/감열 롤 라벨 발행기</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-1">200L 드럼(2칸), 20L 페일(4칸), 박스(6·8·14·18칸), 소형(21·24·40칸) 및 감열식 롤 라벨을 발행합니다. 용지 크기에 맞춰 QR·글자 크기와 배치가 자동으로 바뀝니다.</p>
                    </div>
                    <button type="button" id="btn-print-multi-labels" class="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>라벨 인쇄</span>
                    </button>
                </div>

                <!-- 라벨 설정 그리드 -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                    <div class="lg:col-span-4 space-y-4">
                        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 text-xs">
                            <div>
                                <label class="block font-bold text-slate-700 mb-1">라벨 용지 규격 선택 <span class="text-rose-500">*</span></label>
                                <select id="label-formtec-type" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                    ${QR_LABEL_PAPERS.map(g => `<optgroup label="${esc(g.group)}">${g.items.map(([code, use]) => {
                                        const p = qrPaperOf(code);
                                        return p ? `<option value="${esc(code)}" ${code === '3108' ? 'selected' : ''}>${code === ROLL_PAPER.code ? '감열식 롤 라벨' : `폼텍 ${esc(code)}`} (${p.across * p.down}칸: ${p.w} x ${p.h} mm) - ${esc(use)}</option>` : '';
                                    }).join('')}</optgroup>`).join('')}
                                </select>
                            </div>

                            <div>
                                <label class="block font-bold text-slate-700 mb-1">인쇄 대상 품목 검색 & 선택</label>
                                <input type="text" id="label-item-search" placeholder="코드 또는 품목명 일부 입력..." class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium mb-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                <select id="label-target-item" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                    ${state.master.slice(0, 50).map(m => `<option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)}</option>`).join('')}
                                </select>
                            </div>

                            <div class="bg-white p-2.5 rounded-xl border border-slate-200 space-y-2">
                                <span class="text-[11px] font-bold text-blue-600 block">제조 및 품질 정보 기재</span>
                                <div>
                                    <label class="block text-[10px] font-bold text-slate-600 mb-0.5">LOT 번호 (선택)</label>
                                    <input type="text" id="label-lot-no" placeholder="예: LOT-20260922-01" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold focus:ring-2 focus:ring-blue-500" />
                                </div>
                                <div class="grid grid-cols-2 gap-1.5">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-600 mb-0.5">제조일자</label>
                                        <input type="text" id="label-mfg-date" value="${localDateStr()}" placeholder="YYYY-MM-DD" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-600 mb-0.5">유효기간</label>
                                        <input type="text" id="label-exp-date" placeholder="YYYY-MM-DD" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                </div>
                            </div>

                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block font-bold text-slate-700 mb-1">인쇄 매수</label>
                                    <input type="number" id="label-print-count" min="1" max="100" value="14" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-blue-500" />
                                </div>
                                <div>
                                    <label class="block font-bold text-slate-700 mb-1">시작 칸 (오프셋)</label>
                                    <input type="number" id="label-start-offset" min="0" max="23" value="0" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                                </div>
                            </div>

                            <button type="button" id="btn-generate-preview" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5">
                                <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                                <span>인쇄 미리보기 새로고침</span>
                            </button>
                        </div>
                    </div>

                    <div class="lg:col-span-8">
                        <div class="bg-slate-200/60 p-4 rounded-2xl border border-slate-300 overflow-x-auto">
                            <div class="text-[11px] font-bold text-slate-500 mb-2 flex items-center justify-between">
                                <span>실제 용지 레이아웃 미리보기 <span id="label-paper-info" class="text-slate-700"></span></span>
                                <span class="text-blue-600">※ 인쇄 창에서 배율 100%(실제 크기), 여백 '없음'으로 인쇄하세요.</span>
                            </div>
                            <div id="label-render-area" class="bg-white shadow-xl mx-auto rounded-sm overflow-hidden" style="min-height: 400px;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ========================================================================= -->
        <!-- VIEW 3: 완제품 파렛트 식별표 시스템 (Formtec 3130 / A4 1분할 전면 라벨) -->
        <!-- ========================================================================= -->
        <div id="view-formtec3130" class="hidden space-y-6">
            <!-- 1. 컨트롤 헤더 바 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 no-print">
                <div class="flex flex-wrap justify-between items-center gap-3">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                                <i data-lucide="check-circle" class="w-3 h-3 text-emerald-600"></i>
                                한국폼텍 Formtec 3130 규격 (200mm × 287mm 전면)
                            </span>
                            <span class="text-xs text-slate-500 font-medium">카밈(Carmime) 등 ODM·자사 완제품 출하용 공식 파렛트 태그</span>
                        </div>
                        <h3 class="text-lg font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="package-check" class="w-5 h-5 text-emerald-600"></i>
                            <span>공식 파렛트 식별표 (PALLET IDENTIFICATION TAG)</span>
                        </h3>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-load-carmime-example" class="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-black py-2.5 px-4 rounded-xl text-xs shadow-md flex items-center gap-1.5 transition">
                            <i data-lucide="sparkles" class="w-4 h-4 text-amber-300"></i>
                            <span>카밈 예시 데이터 즉시 로드</span>
                        </button>
                        <button type="button" id="btn-reset-pallet-form" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-3.5 rounded-xl text-xs transition flex items-center gap-1">
                            <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                            <span>입력 초기화</span>
                        </button>
                        <button type="button" id="btn-print-pallet-top" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black py-2.5 px-5 rounded-xl text-xs shadow-md flex items-center gap-1.5 transition">
                            <i data-lucide="printer" class="w-4 h-4"></i>
                            <span>식별표 즉시 인쇄 / PDF 저장</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- 2. 메인 바디: 입력 폼 & 실시간 미리보기 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <!-- 좌측 설정 패널 (5 cols) -->
                <div class="lg:col-span-5 space-y-4 no-print">
                    <!-- 공급업체 / 납품처 카드 -->
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <h4 class="text-xs font-black text-slate-900 flex items-center gap-1.5 border-b pb-2">
                            <i data-lucide="building" class="w-4 h-4 text-indigo-600"></i>
                            <span>1. 거래처 및 공급 정보</span>
                        </h4>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">공급업체 (발행처)</label>
                                <input type="text" id="plt-supplier" value="대림기업" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">납품처 (고객사)</label>
                                <input type="text" id="plt-customer" list="plt-customer-list" value="에이치엘비글로벌(주)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                <datalist id="plt-customer-list">
                                    <option value="에이치엘비글로벌(주)">
                                    <option value="브릿지엠">
                                    <option value="세양">
                                    <option value="루키(LUKI)">
                                    <option value="보크코리아(BOK)">
                                    <option value="(주)한국정밀">
                                    <option value="대한화학(주)">
                                </datalist>
                            </div>
                        </div>
                    </div>

                    <!-- 제품 정보 카드 -->
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div class="flex items-center justify-between border-b pb-2">
                            <h4 class="text-xs font-black text-slate-900 flex items-center gap-1.5">
                                <i data-lucide="package" class="w-4 h-4 text-blue-600"></i>
                                <span>2. 제품 정보 (마스터 품목 연동)</span>
                            </h4>
                            <span class="text-[10px] text-blue-600 font-bold">* 마스터에서 자동 검색</span>
                        </div>
                        <div class="space-y-2">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">마스터 품목 검색</label>
                                <div class="relative">
                                    <i data-lucide="search" class="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5"></i>
                                    <input type="text" id="plt-master-search" placeholder="품목명 또는 코드 검색 (예: 카밈, 2AC40160)..." class="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                                </div>
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">제품정보 (라벨 표기용 품목명)</label>
                                <textarea id="plt-product-name" rows="2" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">카밈 가솔린 촉매 산소센서 클리너 프로 0.3L</textarea>
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-[11px] font-bold text-slate-600 mb-1">규격 / 입수량</label>
                                    <input type="text" id="plt-spec" value="0.3L x 30개" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800">
                                </div>
                                <div>
                                    <label class="block text-[11px] font-bold text-slate-600 mb-1">품목 코드 (내부용)</label>
                                    <input type="text" id="plt-item-code" value="2AC40160-1" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-800">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 파렛트 번호 & LOT & 생산일자 카드 -->
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <h4 class="text-xs font-black text-slate-900 flex items-center gap-1.5 border-b pb-2">
                            <i data-lucide="hash" class="w-4 h-4 text-amber-600"></i>
                            <span>3. 파렛트 번호 & 로트 & 생산일자</span>
                        </h4>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">시작/단일 파렛트 No.</label>
                                <div class="flex items-center gap-1">
                                    <input type="number" id="plt-current-no" min="1" max="99" value="1" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-center">
                                    <span class="text-slate-400 font-bold">/</span>
                                    <input type="number" id="plt-total-count" min="1" max="99" value="3" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-center">
                                </div>
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">LOT NO.</label>
                                <input type="text" id="plt-lot-no" value="260914" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-800">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">생산일자 (달력)</label>
                                <input type="date" id="plt-prod-date-picker" value="2026-09-17" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800">
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">생산일자 라벨 표기</label>
                                <input type="text" id="plt-prod-date-text" value="260917" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-800">
                            </div>
                        </div>
                        <div class="bg-amber-50/70 p-3 rounded-xl border border-amber-200 space-y-1.5">
                            <span class="block text-[11px] font-bold text-amber-900">📄 인쇄 대상 파렛트:</span>
                            <div class="flex items-center gap-4 text-xs">
                                <label class="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                                    <input type="radio" name="plt-print-mode" id="plt-mode-all" value="all" checked class="accent-indigo-600">
                                    <span>전체 파렛트 일괄 인쇄 (1번 ~ <span id="lbl-total-pallets">3</span>번 총 <span id="lbl-total-pages">3</span>매)</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                                    <input type="radio" name="plt-print-mode" id="plt-mode-single" value="single" class="accent-indigo-600">
                                    <span>현재 번호 1매만 인쇄</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- 수량 계산기 카드 -->
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div class="flex items-center justify-between border-b pb-2">
                            <h4 class="text-xs font-black text-slate-900 flex items-center gap-1.5">
                                <i data-lucide="calculator" class="w-4 h-4 text-teal-600"></i>
                                <span>4. 수량 자동 계산 (박스 × 입수)</span>
                            </h4>
                            <span class="text-[10px] text-teal-700 font-bold">자동 계산 연동</span>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">파렛트당 박스 수량</label>
                                <div class="flex items-center gap-1">
                                    <input type="number" id="plt-box-count" min="1" max="999" value="60" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-center">
                                    <span class="text-xs font-bold text-slate-500 whitespace-nowrap">박스</span>
                                </div>
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">1박스당 입수량</label>
                                <div class="flex items-center gap-1">
                                    <input type="number" id="plt-box-per-unit" min="1" max="999" value="30" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-center">
                                    <span class="text-xs font-bold text-slate-500 whitespace-nowrap">개입</span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-600 mb-1">라벨 표기 수량 텍스트 (직접 수정 가능)</label>
                            <input type="text" id="plt-qty-text" value="60박스(1800개)" class="w-full bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2 text-xs font-black text-emerald-950">
                        </div>
                    </div>

                    <!-- 출력 옵션 및 서명란 카드 -->
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <h4 class="text-xs font-black text-slate-900 flex items-center gap-1.5 border-b pb-2">
                            <i data-lucide="sliders" class="w-4 h-4 text-purple-600"></i>
                            <span>5. 추가 출력 옵션 & 디자인 설정</span>
                        </h4>
                        <div class="grid grid-cols-2 gap-3 text-xs">
                            <label class="flex items-center gap-2 cursor-pointer font-bold text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition">
                                <input type="checkbox" id="plt-show-barcode" class="w-4 h-4 accent-indigo-600 rounded">
                                <span>정품 식별 QR코드 포함</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer font-bold text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition">
                                <input type="checkbox" id="plt-show-sign" class="w-4 h-4 accent-indigo-600 rounded">
                                <span>출하 검수 승인 서명란</span>
                            </label>
                        </div>
                        <div class="grid grid-cols-2 gap-3 pt-1">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">글꼴 (Font Family)</label>
                                <select id="plt-font-family" class="w-full bg-slate-50 border border-slate-300 rounded-xl p-1.5 text-xs font-bold">
                                    <option value="'맑은 고딕', 'Malgun Gothic', sans-serif" selected>맑은 고딕 (기본)</option>
                                    <option value="'Noto Sans KR', sans-serif">노토 산스 (Noto Sans KR)</option>
                                    <option value="'나눔고딕', 'Nanum Gothic', sans-serif">나눔고딕 (Nanum Gothic)</option>
                                    <option value="'돋움', Dotum, sans-serif">돋움 (Dotum)</option>
                                    <option value="'굴림', Gulim, sans-serif">굴림 (Gulim)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-600 mb-1">제품명 글자 크기</label>
                                <select id="plt-product-size" class="w-full bg-slate-50 border border-slate-300 rounded-xl p-1.5 text-xs font-bold">
                                    <option value="22pt">22pt (긴 제품명)</option>
                                    <option value="26pt">26pt (표준)</option>
                                    <option value="30pt">30pt (대형)</option>
                                    <option value="35pt" selected>35pt (국내건_카밈 원본 규격)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 우측 실시간 A4 미리보기 패널 (7 cols) -->
                <div class="lg:col-span-7 space-y-4">
                    <div class="bg-slate-800 text-white p-4 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-3 no-print">
                        <div class="flex items-center gap-2">
                            <i data-lucide="eye" class="w-5 h-5 text-emerald-400"></i>
                            <div>
                                <span class="text-xs font-bold text-emerald-300">Formtec 3130 실시간 인쇄 미리보기</span>
                                <p class="text-[11px] text-slate-300">A4 1장 풀사이즈(200mm × 287mm) 규격과 100% 동일하게 렌더링됩니다.</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span id="plt-preview-badge" class="px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                                총 3페이지 연속 인쇄 준비됨
                            </span>
                            <button type="button" id="btn-print-pallet-bottom" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2 px-4 rounded-xl text-xs shadow flex items-center gap-1.5 transition">
                                <i data-lucide="printer" class="w-4 h-4"></i>
                                <span>지금 인쇄</span>
                            </button>
                        </div>
                    </div>

                    <!-- 실시간 A4 용지 미리보기 컨테이너 (스크롤 가능) -->
                    <div class="bg-slate-200/80 p-4 sm:p-6 rounded-2xl border border-slate-300 overflow-x-auto shadow-inner">
                        <div class="text-[11px] font-bold text-slate-500 mb-3 flex items-center justify-between no-print">
                            <span>※ 인쇄 대화상자에서 배율 '기본(100%)', 여백 '없음(None)'을 권장합니다.</span>
                            <span class="text-indigo-700 font-bold">A4 (210mm × 297mm) 1:1 규격</span>
                        </div>
                        
                        <!-- 실제 인쇄 대상 컨테이너 -->
                        <div id="print-area-3130" class="printable-area mx-auto flex flex-col items-center gap-8">
                            <!-- 렌더링될 페이지들이 동적으로 주입됨 -->
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 💡 신규 구분 / 제품 색인 등록 모달 (index1.html) -->
        <div id="fmt-register-modal" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 hidden flex items-center justify-center p-4 no-print">
            <div class="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 border border-slate-100 text-slate-800 space-y-4">
                <div class="flex justify-between items-center border-b pb-3">
                    <h4 class="text-base font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="plus-circle" class="w-5 h-5 text-emerald-600"></i>
                        <span>신규 구분 및 제품 색인 등록</span>
                    </h4>
                    <button type="button" id="btn-close-register-modal" class="text-slate-400 hover:text-slate-600 font-bold text-lg">&times;</button>
                </div>
                
                <div class="space-y-4 text-xs">
                    <div>
                        <label class="block font-bold text-emerald-900 mb-1">📂 1. 신규 구분(파일명/시트) 등록</label>
                        <div class="flex gap-2">
                            <input type="text" id="new-category-input" placeholder="예: 특수유.xlsx" class="flex-1 bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800">
                            <button type="button" id="btn-submit-new-category" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs whitespace-nowrap shadow">
                                등록
                            </button>
                        </div>
                    </div>

                    <div class="border-t pt-3">
                        <label class="block font-bold text-blue-900 mb-1">📑 2. 신규 제품 색인(독립 제품명) 등록</label>
                        <div class="flex gap-2">
                            <input type="text" id="new-product-input" placeholder="예: SUPER 0W20 PAO" class="flex-1 bg-blue-50 border border-blue-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800">
                            <button type="button" id="btn-submit-new-product" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs whitespace-nowrap shadow">
                                등록
                            </button>
                        </div>
                    </div>

                    <div class="border-t pt-3 bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200">
                        <label class="block font-bold text-amber-950 mb-1.5">🏷️ 3. 기존 구분에 제품명 추가 등록</label>
                        <div class="space-y-2">
                            <select id="modal-category-select" class="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800">
                            </select>
                            <div class="flex gap-2">
                                <input type="text" id="target-product-input" placeholder="등록할 신규 제품명 입력..." class="flex-1 bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800">
                                <button type="button" id="btn-submit-product-to-category" class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap shadow">
                                    구분에 등록
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end pt-2">
                    <button type="button" id="btn-close-register-modal-2" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-xl text-xs">
                        닫기
                    </button>
                </div>
            </div>
        </div>
    </section>
    `;

    createIcons({ icons });

    // -------------------------------------------------------------
    // 3. 서브탭 전환 로직 (대림오일 공식 2칸 vs 다목적 QR vs 파렛트 식별표 3130)
    // -------------------------------------------------------------
    const btnSubtab3120 = container.querySelector('#btn-subtab-formtec3120');
    const btnSubtabMulti = container.querySelector('#btn-subtab-multiformat');
    const btnSubtab3130 = container.querySelector('#btn-subtab-formtec3130');
    const view3120 = container.querySelector('#view-formtec3120');
    const viewMulti = container.querySelector('#view-multiformat');
    const view3130 = container.querySelector('#view-formtec3130');

    const switchSubTab = (tab) => {
        const inactiveClass = 'px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10';
        
        view3120?.classList.add('hidden');
        viewMulti?.classList.add('hidden');
        view3130?.classList.add('hidden');

        if (btnSubtab3120) btnSubtab3120.className = inactiveClass;
        if (btnSubtabMulti) btnSubtabMulti.className = inactiveClass;
        if (btnSubtab3130) btnSubtab3130.className = inactiveClass;

        if (tab === '3120') {
            view3120?.classList.remove('hidden');
            if (btnSubtab3120) btnSubtab3120.className = 'px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md';
        } else if (tab === 'multi') {
            viewMulti?.classList.remove('hidden');
            if (btnSubtabMulti) btnSubtabMulti.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md';
            generateMultiPreview();
        } else if (tab === '3130') {
            view3130?.classList.remove('hidden');
            if (btnSubtab3130) btnSubtab3130.className = 'px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md';
            renderPalletPages();
        }
        try {
            localStorage.setItem('daelim_label_active_subtab', tab);
        } catch {}
        createIcons({ icons });
    };

    btnSubtab3120?.addEventListener('click', () => switchSubTab('3120'));
    btnSubtabMulti?.addEventListener('click', () => switchSubTab('multi'));
    btnSubtab3130?.addEventListener('click', () => switchSubTab('3130'));

    // -------------------------------------------------------------
    // 4. Formtec 3120 대림오일 공식 라벨 로직 (index1.html 이식)
    // -------------------------------------------------------------
    const updateCategoryDropdown = () => {
        const dd = container.querySelector('#fmt-category-dropdown');
        if (!dd) return;
        const currentSelected = selectedCategory;

        const catSet = new Set([...MASTER_CATEGORIES, ...currentMasterCategories]);
        extractedLabels.forEach(item => {
            if (item.sheet) catSet.add(item.sheet.trim());
        });
        const catList = Array.from(catSet).sort((a, b) => a.localeCompare(b, 'ko'));

        dd.innerHTML = '<option value="">-- 전체 구분 보기 --</option>';
        catList.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            if (c === currentSelected) opt.selected = true;
            dd.appendChild(opt);
        });
    };

    const updateIndexDropdown = () => {
        const dd = container.querySelector('#fmt-index-dropdown');
        if (!dd) return;
        const currentSelected = selectedIndexProduct;

        let productsSet = new Set();

        if (selectedCategory) {
            extractedLabels.forEach(item => {
                if (item.sheet === selectedCategory && item.productName) {
                    productsSet.add(item.productName.trim());
                }
            });
            // 코팅제 카테고리 선택 시 10대 코팅 제품군 모두 인덱스에 노출
            if (selectedCategory.includes('코팅')) {
                const COATING_ITEMS = [
                    "고농축 엔진코팅제", "삼마 엔진코팅제", "삼마글로벌 엔진코팅제", 
                    "엑스퍼트 엔진코팅제", "엔진코팅제 C", "엔진코팅제-프리미엄", 
                    "울트라찬 코팅제", "프로텍 엔진코팅제 B", "프라임그래핀플러스", "EOA - B"
                ];
                COATING_ITEMS.forEach(p => productsSet.add(p));
            }
        } else {
            let savedIndex = [];
            try {
                savedIndex = JSON.parse(localStorage.getItem(INDEX_STORAGE_KEY) || '[]');
            } catch (e) {}
            [...MASTER_PRODUCT_INDEX, ...savedIndex].forEach(p => {
                if (p) productsSet.add(p.trim());
            });
            extractedLabels.forEach(item => {
                if (item.productName) productsSet.add(item.productName.trim());
            });
        }

        const productsList = Array.from(productsSet).sort((a, b) => a.localeCompare(b, 'ko'));

        dd.innerHTML = '<option value="">-- 전체 제품 보기 --</option>';
        productsList.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            if (p === currentSelected) opt.selected = true;
            dd.appendChild(opt);
        });

        if (selectedCategory && selectedIndexProduct && !productsSet.has(selectedIndexProduct)) {
            selectedIndexProduct = '';
        }
    };

    const updateHistoryDropdown = () => {
        const dd = container.querySelector('#fmt-history-dropdown');
        if (!dd) return;
        dd.innerHTML = '<option value="">-- 과거에 출력했던 데이터 선택 --</option>';
        printHistoryList.forEach((h, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${h.timestamp} [${h.items.length}개 항목] ${h.items[0]?.productName || ''} 등`;
            dd.appendChild(opt);
        });
    };

    const getFilteredLabels = () => {
        let res = extractedLabels.filter(item => {
            if (selectedCategory && item.sheet !== selectedCategory) {
                return false;
            }
            if (selectedIndexProduct && item.productName !== selectedIndexProduct) {
                return false;
            }
            if (searchQuery) {
                // 다중 검색어 및 공백/하이픈 제거 정규화 부분 문자 일치 검사
                const tokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
                const combined = `${item.productName || ''} ${item.sheet || ''} ${item.lotNo || ''} ${item.date || ''} ${item.qty || ''} ${item.note || ''} ${item.inspectDate || ''}`.toLowerCase();
                const normCombined = combined.replace(/[\s\-_/\\,.]/g, '');

                const isAllTokensMatched = tokens.every(tok => {
                    if (combined.includes(tok)) return true;
                    const normTok = tok.replace(/[\s\-_/\\,.]/g, '');
                    return normTok && normCombined.includes(normTok);
                });
                if (!isAllTokensMatched) return false;
            }
            return true;
        });

        if (selectedIndexProduct) {
            return res.slice(0, 2);
        }
        return res;
    };

    const updateFontStyle = () => {
        const fontFamily = container.querySelector('#fmt-font-family-select')?.value || "'맑은 고딕', 'Malgun Gothic', sans-serif";
        const titleSize = (container.querySelector('#fmt-title-size-slider')?.value || 52) + 'px';
        const bodySize = (container.querySelector('#fmt-body-size-slider')?.value || 44) + 'px';
        const thSize = (parseInt(container.querySelector('#fmt-body-size-slider')?.value || 44) - 6) + 'px';

        container.querySelectorAll('.label-card-3120').forEach(card => {
            card.style.fontFamily = fontFamily;
        });
        container.querySelectorAll('.label-title-3120').forEach(el => {
            el.style.fontSize = titleSize;
        });
        container.querySelectorAll('.label-table-3120 th').forEach(el => {
            el.style.fontSize = thSize;
        });
        container.querySelectorAll('.label-table-3120 td').forEach(el => {
            el.style.fontSize = bodySize;
        });
    };

    const updatePreview3120 = (forcePrintMode = false) => {
        const printArea = container.querySelector('#print-area-3120');
        if (!printArea) return;
        printArea.innerHTML = '';

        const activeItems = getFilteredLabels();
        const selectedItems = activeItems.filter(item => item.checked);

        if (selectedItems.length === 0 && !forcePrintMode) {
            if (selectedCategory && !selectedIndexProduct && !searchQuery) {
                printArea.innerHTML = `
                    <div class="no-print text-center py-12 text-slate-400 font-medium bg-white rounded-2xl shadow-sm border border-dashed border-slate-300 w-full max-w-2xl">
                        📂 '${esc(selectedCategory)}' 구분이 선택되었습니다.<br>
                        <span class="text-xs text-blue-600 font-bold mt-1 inline-block">👉 [📑 제품 색인]에서 제품을 선택하시거나 목록의 체크박스를 선택하시면 A4 규격(2매) 미리보기가 표시됩니다.</span>
                    </div>
                `;
            } else {
                printArea.innerHTML = `
                    <div class="no-print text-center py-12 text-slate-400 font-medium bg-white rounded-2xl shadow-sm border border-dashed border-slate-300 w-full max-w-2xl">
                        선택된 라벨 항목이 없습니다. 상단 목록에서 체크박스를 선택해 주세요.
                    </div>
                `;
            }
            return;
        }

        let itemsToRender = [...selectedItems];
        // 특정 색인 제품 선택 시 1개 항목만 있더라도 A4 용지 2칸을 꽉 채우도록 자동 2매 구성
        if (selectedIndexProduct && itemsToRender.length === 1) {
            itemsToRender.push(JSON.parse(JSON.stringify(itemsToRender[0])));
        }

        for (let i = 0; i < itemsToRender.length; i += 2) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'a4-page-3120';

            for (let j = i; j < Math.min(i + 2, itemsToRender.length); j++) {
                const item = itemsToRender[j];
                const labelCard = document.createElement('div');
                labelCard.className = 'label-card-3120';
                
                labelCard.innerHTML = `
                    <div class="label-title-3120">${esc(item.productName) || '&nbsp;'}</div>
                    <table class="label-table-3120">
                        <tr>
                            <th>DATE</th>
                            <td>${esc(item.date || '')}</td>
                        </tr>
                        <tr>
                            <th>LOT NO</th>
                            <td>
                                <div class="lot-td-container-3120">
                                    <span>${esc(item.lotNo || '')}</span>
                                    <div class="stamp-box-inline-3120">
                                        <div class="stamp-company-3120">(주)대림오일</div>
                                        <div class="stamp-date-3120">${esc(item.inspectDate || '')}</div>
                                        <div class="stamp-pass-3120">합 격</div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <th>수 량</th>
                            <td>${esc(item.qty || '')}</td>
                        </tr>
                        <tr>
                            <th>비 고</th>
                            <td>${esc(item.note || '')}</td>
                        </tr>
                    </table>
                `;
                pageDiv.appendChild(labelCard);
            }

            printArea.appendChild(pageDiv);
        }

        updateFontStyle();
    };

    const renderTable3120 = () => {
        const tbody = container.querySelector('#fmt-table-body');
        const countBadge = container.querySelector('#fmt-total-count');
        if (!tbody) return;

        const filtered = getFilteredLabels();
        if (countBadge) countBadge.textContent = `검색 ${filtered.length}건 / 총 ${extractedLabels.length}건`;
        tbody.innerHTML = '';

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">조건에 일치하는 라벨이 없습니다. [➕ 새 라벨 추가] 또는 [📤 라벨 목록 업로드]를 이용해 주세요.</td></tr>';
            updatePreview3120();
            return;
        }

        filtered.forEach((item) => {
            const dateISO = formatToISO(item.date);
            const inspectISO = formatToISO(item.inspectDate);

            let qtyOptionsHtml = '';
            let currentQtyMatched = false;
            QTY_OPTIONS.forEach(opt => {
                const selected = (opt === item.qty) ? 'selected' : '';
                if (selected) currentQtyMatched = true;
                qtyOptionsHtml += `<option value="${opt}" ${selected}>${opt}</option>`;
            });
            if (!currentQtyMatched && item.qty) {
                qtyOptionsHtml = `<option value="${esc(item.qty)}" selected>${esc(item.qty)}</option>` + qtyOptionsHtml;
            }

            const tr = document.createElement('tr');
            tr.className = 'bg-white hover:bg-slate-50 transition';
            tr.innerHTML = `
                <td class="p-3 text-center"><input type="checkbox" class="row-checkbox rounded w-4 h-4 text-blue-600 cursor-pointer" ${item.checked ? 'checked' : ''}></td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-sheet w-full bg-emerald-50/70 border border-emerald-200 rounded-lg px-2 py-1 text-xs font-bold text-emerald-900" value="${esc(item.sheet || '')}"></td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-name w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-black text-slate-900" value="${esc(item.productName || '')}"></td>
                <td class="px-2.5 py-1.5"><input type="date" class="input-date w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700" value="${dateISO}"></td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-lot w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono font-black text-indigo-800" value="${esc(item.lotNo || '')}"></td>
                <td class="px-2.5 py-1.5">
                    <select class="select-qty w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800">
                        ${qtyOptionsHtml}
                    </select>
                </td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-note w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs" value="${esc(item.note || '')}"></td>
                <td class="px-2.5 py-1.5"><input type="date" class="input-inspect w-full bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 text-xs font-bold text-rose-700" value="${inspectISO}"></td>
                <td class="px-2 py-1.5 text-center"><button type="button" class="btn-del-row text-rose-400 hover:text-rose-600 font-bold p-1 text-sm">&times;</button></td>
            `;

            tr.querySelector('.row-checkbox')?.addEventListener('change', (e) => {
                item.checked = e.target.checked;
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.input-sheet')?.addEventListener('input', (e) => {
                item.sheet = e.target.value;
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.input-name')?.addEventListener('input', (e) => {
                item.productName = e.target.value;
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.input-date')?.addEventListener('change', (e) => {
                const shortDate = formatToShort(e.target.value);
                item.date = shortDate;
                item.lotNo = generateLotFromDate(e.target.value, item.lotNo);
                if (!item.inspectDate) item.inspectDate = shortDate;
                saveData();
                renderTable3120();
            });

            tr.querySelector('.input-lot')?.addEventListener('input', (e) => {
                item.lotNo = e.target.value;
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.select-qty')?.addEventListener('change', (e) => {
                item.qty = e.target.value;
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.input-note')?.addEventListener('input', (e) => {
                item.note = e.target.value;
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.input-inspect')?.addEventListener('change', (e) => {
                item.inspectDate = formatToShort(e.target.value);
                saveData();
                updatePreview3120();
            });

            tr.querySelector('.btn-del-row')?.addEventListener('click', () => {
                extractedLabels = extractedLabels.filter(x => x.id !== item.id);
                saveData();
                renderTable3120();
            });

            tbody.appendChild(tr);
        });

        updatePreview3120();
    };

    // 전체 선택 체크박스
    container.querySelector('#fmt-select-all')?.addEventListener('change', (e) => {
        getFilteredLabels().forEach(item => item.checked = e.target.checked);
        saveData();
        renderTable3120();
    });

    // 폰트 크기 슬라이더 이벤트
    container.querySelector('#fmt-title-size-slider')?.addEventListener('input', (e) => {
        container.querySelector('#fmt-title-size-val').textContent = e.target.value + 'px';
        updateFontStyle();
    });
    container.querySelector('#fmt-body-size-slider')?.addEventListener('input', (e) => {
        container.querySelector('#fmt-body-size-val').textContent = e.target.value + 'px';
        updateFontStyle();
    });
    container.querySelector('#fmt-font-family-select')?.addEventListener('change', updateFontStyle);

    // 검색 및 드롭다운 필터
    container.querySelector('#fmt-category-dropdown')?.addEventListener('change', (e) => {
        selectedCategory = e.target.value;
        selectedIndexProduct = '';
        updateIndexDropdown();
        renderTable3120();
    });

    container.querySelector('#fmt-index-dropdown')?.addEventListener('change', (e) => {
        selectedIndexProduct = e.target.value;
        // 선택한 카테고리는 유지 (selectedCategory를 지우지 않음)
        if (selectedIndexProduct) {
            // 해당 제품이 현재 추출된 라벨 목록에 없으면 자동으로 기본 항목 생성
            const hasItem = extractedLabels.some(item => 
                item.productName === selectedIndexProduct && 
                (!selectedCategory || item.sheet === selectedCategory)
            );
            if (!hasItem) {
                const todayStr = formatToShort(localDateStr());
                extractedLabels.unshift({
                    id: Date.now() + Math.random(),
                    checked: true,
                    sheet: selectedCategory || (selectedIndexProduct.includes('코팅') ? '코팅제.xlsx' : '신규입력.xlsx'),
                    productName: selectedIndexProduct,
                    date: todayStr,
                    lotNo: `G${todayStr.replace(/\./g, '')}-021`,
                    qty: '1,000 L',
                    note: 'SG : 0.8600',
                    inspectDate: todayStr
                });
                saveData();
            } else {
                // 해당 제품 라벨이 이미 존재하면 모두 체크 활성화
                extractedLabels.forEach(item => {
                    if (item.productName === selectedIndexProduct && (!selectedCategory || item.sheet === selectedCategory)) {
                        item.checked = true;
                    }
                });
                saveData();
            }
        }
        renderTable3120();
    });

    container.querySelector('#fmt-search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderTable3120();
    });

    container.querySelector('#btn-reset-search')?.addEventListener('click', () => {
        selectedCategory = '';
        selectedIndexProduct = '';
        searchQuery = '';
        const searchInput = container.querySelector('#fmt-search-input');
        if (searchInput) searchInput.value = '';
        updateCategoryDropdown();
        updateIndexDropdown();
        renderTable3120();
    });

    // 일괄 수정 기능
    container.querySelector('#bulk-date')?.addEventListener('change', (e) => {
        if (e.target.value) {
            const autoLot = generateLotFromDate(e.target.value, 'G260812-021');
            container.querySelector('#bulk-lotNo').value = autoLot;
        }
    });

    container.querySelector('#btn-apply-bulk')?.addEventListener('click', () => {
        const checkedItems = extractedLabels.filter(item => item.checked);
        if (checkedItems.length === 0) {
            alert('일괄 수정할 라벨을 1개 이상 선택해 주세요.');
            return;
        }

        const bulkProductName = container.querySelector('#bulk-productName').value.trim();
        const bulkDateRaw = container.querySelector('#bulk-date').value;
        const bulkLotNo = container.querySelector('#bulk-lotNo').value.trim();
        const bulkQty = container.querySelector('#bulk-qty').value;
        const bulkNote = container.querySelector('#bulk-note').value.trim();
        const bulkInspectDateRaw = container.querySelector('#bulk-inspectDate').value;

        const bulkDate = bulkDateRaw ? formatToShort(bulkDateRaw) : '';
        const bulkInspectDate = bulkInspectDateRaw ? formatToShort(bulkInspectDateRaw) : '';

        if (!bulkProductName && !bulkDate && !bulkLotNo && !bulkQty && !bulkNote && !bulkInspectDate) {
            alert('일괄 수정할 내용을 1개 이상 입력해 주세요.');
            return;
        }

        extractedLabels.forEach(item => {
            if (item.checked) {
                if (bulkProductName) item.productName = bulkProductName;
                if (bulkDate) item.date = bulkDate;
                if (bulkLotNo) item.lotNo = bulkLotNo;
                if (bulkQty) item.qty = bulkQty;
                if (bulkNote) item.note = bulkNote;
                if (bulkInspectDate) item.inspectDate = bulkInspectDate;
            }
        });

        saveData();
        renderTable3120();
        alert(`총 ${checkedItems.length}개 라벨의 내용이 동시에 변경 및 저장되었습니다.`);
    });

    // 버튼 액션들
    container.querySelector('#btn-add-new-label')?.addEventListener('click', () => {
        const todayStr = formatToShort(localDateStr());
        const defaultProd = selectedIndexProduct || (selectedCategory && selectedCategory.includes('코팅') ? '고농축 엔진코팅제' : 'ODM 0W20');
        extractedLabels.unshift({
            id: Date.now() + Math.random(),
            checked: true,
            sheet: selectedCategory || (defaultProd.includes('코팅') ? '코팅제.xlsx' : '신규입력.xlsx'),
            productName: defaultProd,
            date: todayStr,
            lotNo: `G${todayStr.replace(/\./g, '')}-021`,
            qty: '1,000 L',
            note: 'SG : 0.8600',
            inspectDate: todayStr
        });
        saveData();
        renderTable3120();
    });

    container.querySelector('#btn-delete-selected')?.addEventListener('click', () => {
        const count = extractedLabels.filter(item => item.checked).length;
        if (count === 0) {
            alert('삭제할 라벨을 선택해 주세요.');
            return;
        }
        if (confirm(`선택한 ${count}개 라벨 항목을 삭제하시겠습니까?`)) {
            extractedLabels = extractedLabels.filter(item => !item.checked);
            saveData();
            renderTable3120();
        }
    });

    container.querySelector('#btn-reset-default-data')?.addEventListener('click', () => {
        if (confirm('40종 기본 라벨 데이터로 복원하시겠습니까? (현재 수정 내용은 대체됩니다)')) {
            extractedLabels = JSON.parse(JSON.stringify(INITIAL_DEFAULT_DATA));
            saveData();
            updateCategoryDropdown();
            updateIndexDropdown();
            renderTable3120();
        }
    });

    container.querySelector('#btn-clear-all')?.addEventListener('click', () => {
        if (confirm('모든 라벨 목록을 비우시겠습니까?')) {
            extractedLabels = [];
            saveData();
            renderTable3120();
        }
    });

    container.querySelector('#btn-manual-save')?.addEventListener('click', () => {
        saveData();
        alert('모든 라벨 데이터가 정상적으로 저장되었습니다.');
    });

    // 엑셀 업로드 처리
    const uploadInput = container.querySelector('#excel-file-upload-input');
    container.querySelector('#btn-trigger-upload-excel')?.addEventListener('click', () => {
        uploadInput?.click();
    });

    uploadInput?.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const newItems = [];
                const fileName = file.name;

                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    if (json.length > 0) {
                        for (let r = 1; r < json.length; r++) {
                            const row = json[r];
                            if (row && row.length > 0 && row[0]) {
                                newItems.push({
                                    id: Date.now() + Math.random(),
                                    checked: true,
                                    sheet: sheetName || fileName,
                                    productName: String(row[0] || '').trim(),
                                    date: String(row[1] || formatToShort(localDateStr())),
                                    lotNo: String(row[2] || ''),
                                    qty: String(row[3] || '1,000 L'),
                                    note: String(row[4] || ''),
                                    inspectDate: String(row[5] || row[1] || '')
                                });
                            }
                        }
                    }
                });

                if (newItems.length > 0) {
                    extractedLabels = [...newItems, ...extractedLabels];
                    saveData();
                    renderTable3120();
                    alert(`'${fileName}' 파일에서 ${newItems.length}개의 라벨 항목을 성공적으로 불러왔습니다!`);
                } else {
                    alert('선택한 파일에서 라벨 데이터를 찾을 수 없습니다.');
                }
            } catch (err) {
                alert(`엑셀 파일 파싱 오류: ${err.message}`);
            }
            uploadInput.value = '';
        };
        reader.readAsArrayBuffer(file);
    });

    // 엑셀 다운로드
    container.querySelector('#btn-export-label-excel')?.addEventListener('click', () => {
        if (extractedLabels.length === 0) {
            alert('다운로드할 라벨 데이터가 없습니다.');
            return;
        }
        const wb = XLSX.utils.book_new();
        const wsData = [
            ["구분(시트)", "제품명", "DATE", "LOT NO", "수량", "비고", "검사일자(도장)"],
            ...extractedLabels.map(item => [
                item.sheet || '',
                item.productName || '',
                item.date || '',
                item.lotNo || '',
                item.qty || '',
                item.note || '',
                item.inspectDate || ''
            ])
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, "라벨대장");
        XLSX.writeFile(wb, `대림오일_라벨목록_${localDateStr()}.xlsx`);
    });

    // 구글시트 CSV
    container.querySelector('#btn-export-label-csv')?.addEventListener('click', () => {
        if (extractedLabels.length === 0) {
            alert('내보낼 데이터가 없습니다.');
            return;
        }
        const headers = ["구분", "제품명", "DATE", "LOT NO", "수량", "비고", "검사일자"];
        const rows = extractedLabels.map(i => [
            `"${i.sheet || ''}"`,
            `"${(i.productName || '').replace(/"/g, '""')}"`,
            `"${i.date || ''}"`,
            `"${i.lotNo || ''}"`,
            `"${i.qty || ''}"`,
            `"${(i.note || '').replace(/"/g, '""')}"`,
            `"${i.inspectDate || ''}"`
        ]);
        const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `대림오일_라벨데이터_${localDateStr()}.csv`;
        link.click();
    });

    // 인쇄 이력 저장 및 재출력
    const savePrintHistory = (items) => {
        const nowStr = new Date().toLocaleString('ko-KR');
        printHistoryList.unshift({
            timestamp: nowStr,
            items: JSON.parse(JSON.stringify(items))
        });
        if (printHistoryList.length > 30) printHistoryList.pop();
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(printHistoryList));
        } catch { }
        updateHistoryDropdown();
    };

    container.querySelector('#fmt-history-dropdown')?.addEventListener('change', (e) => {
        const idx = e.target.value;
        if (idx !== '' && printHistoryList[idx]) {
            const h = printHistoryList[idx];
            if (confirm(`[${h.timestamp}]에 출력했던 ${h.items.length}개 라벨을 화면 목록으로 복원하시겠습니까?`)) {
                extractedLabels = JSON.parse(JSON.stringify(h.items));
                saveData();
                renderTable3120();
            }
        }
    });

    container.querySelector('#btn-clear-label-history')?.addEventListener('click', () => {
        if (confirm('과거 출력 이력을 모두 삭제하시겠습니까?')) {
            printHistoryList = [];
            localStorage.removeItem(HISTORY_KEY);
            updateHistoryDropdown();
            alert('이력이 삭제되었습니다.');
        }
    });

    // 인쇄 실행 함수
    const doPrintFormtec = () => {
        const activeItems = getFilteredLabels();
        const selectedItems = activeItems.filter(item => item.checked);
        if (selectedItems.length === 0) {
            alert('인쇄할 라벨을 1개 이상 선택해 주세요.');
            return;
        }

        let itemsToPrint = [...selectedItems];
        if (selectedIndexProduct && itemsToPrint.length === 1) {
            itemsToPrint.push(JSON.parse(JSON.stringify(itemsToPrint[0])));
        }

        savePrintHistory(itemsToPrint);
        updatePreview3120(true);
        setTimeout(() => {
            window.print();
            updatePreview3120();
        }, 120);
    };

    container.querySelector('#btn-print-formtec-labels')?.addEventListener('click', doPrintFormtec);
    container.querySelector('#btn-print-formtec-labels-bottom')?.addEventListener('click', doPrintFormtec);

    // 신규 등록 모달 열기/닫기
    const regModal = container.querySelector('#fmt-register-modal');
    const updateModalCats = () => {
        const dd = container.querySelector('#modal-category-select');
        if (!dd) return;
        dd.innerHTML = '<option value="">-- 기존 구분(파일명/시트) 선택 --</option>';
        currentMasterCategories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            dd.appendChild(opt);
        });
    };

    container.querySelector('#btn-open-register-modal')?.addEventListener('click', () => {
        updateModalCats();
        regModal.classList.remove('hidden');
    });

    const closeRegModal = () => regModal.classList.add('hidden');
    container.querySelector('#btn-close-register-modal')?.addEventListener('click', closeRegModal);
    container.querySelector('#btn-close-register-modal-2')?.addEventListener('click', closeRegModal);

    container.querySelector('#btn-submit-new-category')?.addEventListener('click', () => {
        const val = container.querySelector('#new-category-input').value.trim();
        if (!val) {
            alert('등록할 구분명을 입력해 주세요.');
            return;
        }
        if (!currentMasterCategories.includes(val)) {
            currentMasterCategories.push(val);
            localStorage.setItem(CAT_STORAGE_KEY, JSON.stringify(currentMasterCategories));
        }
        selectedCategory = val;
        updateCategoryDropdown();
        container.querySelector('#new-category-input').value = '';
        closeRegModal();
        renderTable3120();
        alert(`'${val}' 구분이 등록되었습니다.`);
    });

    container.querySelector('#btn-submit-new-product')?.addEventListener('click', () => {
        const val = container.querySelector('#new-product-input').value.trim();
        if (!val) {
            alert('등록할 제품명을 입력해 주세요.');
            return;
        }
        if (!currentMasterIndex.includes(val)) {
            currentMasterIndex.push(val);
            localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(currentMasterIndex));
        }
        selectedIndexProduct = val;
        updateIndexDropdown();
        container.querySelector('#new-product-input').value = '';
        closeRegModal();
        renderTable3120();
        alert(`'${val}' 제품 색인이 등록되었습니다.`);
    });

    container.querySelector('#btn-submit-product-to-category')?.addEventListener('click', () => {
        const targetCat = container.querySelector('#modal-category-select').value;
        const newProdName = container.querySelector('#target-product-input').value.trim();

        if (!targetCat) {
            alert('제품을 등록할 기존 구분을 선택해 주세요.');
            return;
        }
        if (!newProdName) {
            alert('등록할 제품명을 입력해 주세요.');
            return;
        }

        const todayStr = formatToShort(localDateStr());
        extractedLabels.push({
            id: Date.now() + Math.random(),
            checked: true,
            sheet: targetCat,
            productName: newProdName,
            date: todayStr,
            lotNo: `G${todayStr.replace(/\./g, '')}-021`,
            qty: '1,000 L',
            note: '',
            inspectDate: todayStr
        });

        if (!currentMasterIndex.includes(newProdName)) {
            currentMasterIndex.push(newProdName);
            localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(currentMasterIndex));
        }

        selectedCategory = targetCat;
        selectedIndexProduct = newProdName;
        saveData();
        container.querySelector('#target-product-input').value = '';
        closeRegModal();
        updateCategoryDropdown();
        updateIndexDropdown();
        renderTable3120();
        alert(`'${targetCat}' 구분에 '${newProdName}' 제품이 등록되었습니다!`);
    });

    // -------------------------------------------------------------
    // 5. 다목적 QR 라벨 미리보기 로직 (기존 기능 유지)
    // -------------------------------------------------------------
    // 선택한 용지 규격(폼텍 실제 치수)에 맞춰 QR·글자 크기와 배치를 자동으로 정한다 (labelRender.qrItemLabelElements)
    const buildMultiLabels = () => {
        const code = container.querySelector('#label-formtec-type')?.value || '3108';
        const paper = qrPaperOf(code) || qrPaperOf('3108');
        const item = state.master.find(m => m.code === container.querySelector('#label-target-item')?.value);
        if (!item) return null;
        const per = cellsPerSheet(paper);
        const count = Math.min(500, Math.max(1, parseInt(container.querySelector('#label-print-count')?.value, 10) || 1));
        const offset = paper === ROLL_PAPER ? 0 : Math.min(per - 1, Math.max(0, parseInt(container.querySelector('#label-start-offset')?.value, 10) || 0));
        const lotNo = container.querySelector('#label-lot-no')?.value.trim() || '';
        const liveAppUrl = window.location.href.includes('localhost')
            ? 'https://ykyyyky55-cmd.github.io/daelim-wms/'
            : window.location.href.split('#')[0].split('?')[0];
        // 스마트폰 카메라로 QR 인식 시 WMS 현장 스캔 화면으로 즉시 연결되는 딥링크
        const qrPayload = `${liveAppUrl}?scan=${encodeURIComponent(item.code)}${lotNo ? '&lot=' + encodeURIComponent(lotNo) : ''}#scan`;
        const tpl = {
            paper,
            elements: qrItemLabelElements(paper, {
                code: item.code, category: item.category, name: item.name, spec: item.spec, lot: lotNo,
                mfg: container.querySelector('#label-mfg-date')?.value.trim() || '',
                exp: container.querySelector('#label-exp-date')?.value.trim() || '',
                qr: qrPayload
            })
        };
        return { tpl, item, count, offset, per };
    };

    let multiSeq = 0;
    const generateMultiPreview = async () => {
        const renderArea = container.querySelector('#label-render-area');
        const built = buildMultiLabels();
        if (!renderArea || !built) return;
        const seq = ++multiSeq;
        const { tpl, count, offset, per } = built;
        const p = tpl.paper;
        const offsetInput = container.querySelector('#label-start-offset');
        if (offsetInput) offsetInput.max = String(Math.max(0, per - 1));
        // 미리보기는 첫 장만 (인쇄는 전체)
        const sheets = await sheetsHtml(tpl, Array(Math.min(count, per - offset)).fill({}), { startIndex: offset, outline: true });
        if (seq !== multiSeq) return;
        const pxW = p.sheetW * 96 / 25.4;
        const scale = Math.min(1.2, Math.max(200, (renderArea.parentElement?.clientWidth || 700) - 40) / pxW);
        const pages = Math.ceil((count + offset) / per);
        renderArea.className = 'bg-white shadow-xl mx-auto rounded-sm overflow-hidden';
        renderArea.style.minHeight = '';
        renderArea.style.width = `${pxW * scale}px`;
        renderArea.style.height = `${p.sheetH * 96 / 25.4 * scale}px`;
        renderArea.innerHTML = `<div style="transform:scale(${scale});transform-origin:0 0">${sheets[0] || ''}</div>`;
        fitLabelTexts(renderArea);
        const info = container.querySelector('#label-paper-info');
        if (info) info.textContent = `${p.code === ROLL_PAPER.code ? '감열 롤' : `폼텍 ${p.code}`} · 라벨 ${p.w}×${p.h}mm · ${per}칸 · 라벨 ${count}개 = 용지 ${pages}장${pages > 1 ? ' (미리보기는 첫 장)' : ''}`;
    };

    container.querySelector('#btn-generate-preview')?.addEventListener('click', generateMultiPreview);
    container.querySelector('#label-target-item')?.addEventListener('change', generateMultiPreview);
    container.querySelector('#label-formtec-type')?.addEventListener('change', generateMultiPreview);
    ['#label-lot-no', '#label-mfg-date', '#label-exp-date', '#label-print-count', '#label-start-offset'].forEach(sel => {
        let t = null;
        container.querySelector(sel)?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(generateMultiPreview, 250); });
    });
    container.querySelector('#btn-print-multi-labels')?.addEventListener('click', async () => {
        const built = buildMultiLabels();
        if (!built) { alert('인쇄할 품목을 고르세요.'); return; }
        const w = openLabelPrintWindow();
        if (!w) return;
        const sheets = await sheetsHtml(built.tpl, Array(built.count).fill({}), { startIndex: built.offset });
        writeLabelPrintWindow(w, `${built.item.name} QR 라벨`, built.tpl.paper, sheets);
    });

    const multiSearchInput = container.querySelector('#label-item-search');
    multiSearchInput?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        const matches = searchMasterItems(q, 40);
        const itemSelect = container.querySelector('#label-target-item');
        if (matches.length === 0) {
            itemSelect.innerHTML = '<option value="">일치하는 품목 없음</option>';
        } else {
            itemSelect.innerHTML = matches.map(m => `<option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)}</option>`).join('');
            generateMultiPreview();
        }
    });

    // -------------------------------------------------------------
    // 6. Formtec 3130 파렛트 식별표 (PALLET IDENTIFICATION TAG) 로직
    // -------------------------------------------------------------
    const pltSupplier = container.querySelector('#plt-supplier');
    const pltCustomer = container.querySelector('#plt-customer');
    const pltProductName = container.querySelector('#plt-product-name');
    const pltSpec = container.querySelector('#plt-spec');
    const pltItemCode = container.querySelector('#plt-item-code');
    const pltCurrentNo = container.querySelector('#plt-current-no');
    const pltTotalCount = container.querySelector('#plt-total-count');
    const pltModeAll = container.querySelector('#plt-mode-all');
    const pltModeSingle = container.querySelector('#plt-mode-single');
    const pltLotNo = container.querySelector('#plt-lot-no');
    const pltProdDatePicker = container.querySelector('#plt-prod-date-picker');
    const pltProdDateText = container.querySelector('#plt-prod-date-text');
    const pltBoxCount = container.querySelector('#plt-box-count');
    const pltBoxPerUnit = container.querySelector('#plt-box-per-unit');
    const pltQtyText = container.querySelector('#plt-qty-text');
    const pltShowBarcode = container.querySelector('#plt-show-barcode');
    const pltShowSign = container.querySelector('#plt-show-sign');
    const pltFontFamily = container.querySelector('#plt-font-family');
    const pltProductSize = container.querySelector('#plt-product-size');

    const updateCalculatedQty = () => {
        const bCount = parseInt(pltBoxCount?.value, 10) || 0;
        const bUnit = parseInt(pltBoxPerUnit?.value, 10) || 0;
        if (pltQtyText) {
            pltQtyText.value = `${bCount}박스(${bCount * bUnit}개)`;
        }
    };

    const renderPalletPages = async () => {
        const supplier = pltSupplier?.value?.trim() || '대림기업';
        const customer = pltCustomer?.value?.trim() || '에이치엘비글로벌(주)';
        const productName = pltProductName?.value?.trim() || '카밈 가솔린 촉매 산소센서 클리너 프로 0.3L';
        const spec = pltSpec?.value?.trim() || '0.3L x 30개';
        const itemCode = pltItemCode?.value?.trim() || '2AC40160-1';
        const currentNo = Math.max(1, parseInt(pltCurrentNo?.value, 10) || 1);
        const totalCount = Math.max(1, parseInt(pltTotalCount?.value, 10) || 1);
        const isModeAll = pltModeAll ? pltModeAll.checked : true;
        const lotNo = pltLotNo?.value?.trim() || '260914';
        const prodDateText = pltProdDateText?.value?.trim() || '260917';
        const qtyText = pltQtyText?.value?.trim() || '60박스(1800개)';
        const showBarcode = pltShowBarcode ? pltShowBarcode.checked : false;
        const showSign = pltShowSign ? pltShowSign.checked : false;
        const fontFamily = pltFontFamily?.value || "'맑은 고딕', 'Malgun Gothic', sans-serif";
        const productSize = pltProductSize?.value || '35pt';

        const pages = [];
        if (isModeAll) {
            for (let i = 1; i <= totalCount; i++) {
                pages.push(i);
            }
        } else {
            pages.push(currentNo);
        }

        const badge = container.querySelector('#plt-preview-badge');
        if (badge) {
            badge.textContent = `총 ${pages.length}페이지 연속 인쇄 준비됨 (${pages[0]}번 ~ ${pages[pages.length - 1]}번)`;
        }
        const lblTotalPallets = container.querySelector('#lbl-total-pallets');
        const lblTotalPages = container.querySelector('#lbl-total-pages');
        if (lblTotalPallets) lblTotalPallets.textContent = totalCount;
        if (lblTotalPages) lblTotalPages.textContent = pages.length;

        const printArea = container.querySelector('#print-area-3130');
        if (!printArea) return;
        printArea.innerHTML = '';

        for (const pNo of pages) {
            const palletNoStr = `${pNo}/${totalCount}`;
            let qrUrl = '';
            if (showBarcode) {
                const qrPayload = `[PALLET TAG]\n품명: ${productName}\n코드: ${itemCode}\n규격: ${spec}\nPALLET: ${palletNoStr}\nLOT: ${lotNo}\n생산일자: ${prodDateText}\n수량: ${qtyText}\n공급: ${supplier}\n납품: ${customer}`;
                try {
                    qrUrl = await qrDataUrl(qrPayload, { width: 240, ecc: 'M' }); // 흰 여백 4칸 + 테두리선 (앱 공통)
                } catch (e) {
                    console.warn('QR 생성 실패:', e);
                }
            }

            const pageEl = document.createElement('div');
            pageEl.className = 'a4-page-3130 bg-white text-black shadow-2xl print:shadow-none';
            pageEl.style.width = '210mm';
            pageEl.style.height = '297mm';
            pageEl.style.minHeight = '297mm';
            pageEl.style.maxHeight = '297mm';
            pageEl.style.padding = '7.7mm 6.9mm';
            pageEl.style.boxSizing = 'border-box';
            pageEl.style.fontFamily = fontFamily;
            pageEl.style.position = 'relative';
            pageEl.style.backgroundColor = '#ffffff';

            pageEl.innerHTML = `
                <!-- 가장 바깥 외곽 테두리선 (Formtec 3130 실측 196.5mm x 279.3mm) -->
                <div style="width: 196.5mm; height: 279.3mm; border: 2.5px solid #000000; box-sizing: border-box; display: flex; flex-direction: column; padding: 5.3mm 4.5mm 5.3mm 4.5mm; gap: 5.3mm; background: #ffffff;">
                    
                    <!-- 1. 최상단: 파렛트 식별표 독립 박스 (높이 34.4mm, 폰트 50pt) -->
                    <div style="height: 34.4mm; min-height: 34.4mm; max-height: 34.4mm; border: 2.5px solid #000000; box-sizing: border-box; display: flex; align-items: center; justify-content: center; position: relative; background: #ffffff;">
                        <!-- QR코드 옵션 ON일 때 좌측에 배치 (체크 해제 시 순수 원본 서식 100% 유지) -->
                        ${showBarcode && qrUrl ? `
                            <div style="position: absolute; left: 3.5mm; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 6px;">
                                <img src="${qrUrl}" alt="QR" style="width: 27mm; height: 27mm;" />
                                <div style="font-size: 8pt; line-height: 1.2; font-weight: 800; color: #000000; text-align: left;">
                                    <div>정품식별 QR</div>
                                    <div style="font-family: monospace; font-size: 7.5pt; color: #334155;">${esc(itemCode)}</div>
                                </div>
                            </div>
                        ` : ''}

                        <h1 style="font-size: 50pt; font-weight: 900; letter-spacing: 6px; color: #000000; margin: 0; line-height: 1; text-align: center;">
                            파렛트 식별표
                        </h1>
                    </div>

                    <!-- 2. 본문 대형 테이블 박스 (높이 230.6mm) -->
                    <div style="flex: 1; border: 2.5px solid #000000; box-sizing: border-box; display: flex; flex-direction: column; background: #ffffff;">
                        
                        <!-- 섹션 1: 제품명 박스 (높이 35mm, 폰트 35pt) -->
                        <div style="height: 35mm; min-height: 35mm; max-height: 35mm; border-bottom: 2.5px solid #000000; box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 2mm 6mm; text-align: center; background: #ffffff;">
                            <div style="font-size: ${productSize}; font-weight: 900; line-height: 1.15; word-break: keep-all; color: #000000; letter-spacing: -0.5px;">
                                ${esc(productName)}
                            </div>
                        </div>

                        <!-- 섹션 2: PALLET NO. 박스 (높이 52mm, 배경 #d9d9d9 연회색, 라벨 20pt, 번호 70pt) -->
                        <div style="height: 52mm; min-height: 52mm; max-height: 52mm; border-bottom: 2.5px solid #000000; box-sizing: border-box; background-color: #d9d9d9; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2mm 0;">
                            <div style="font-size: 20pt; font-weight: 900; letter-spacing: 2px; color: #000000; margin-bottom: 1.5mm; line-height: 1;">
                                PALLET NO.
                            </div>
                            <div style="font-size: 70pt; font-weight: 900; line-height: 1; color: #000000; letter-spacing: 4px; font-family: 'Arial Black', Impact, sans-serif;">
                                ${esc(palletNoStr)}
                            </div>
                        </div>

                        <!-- 섹션 3: 공급업체 박스 (라벨 18pt, 값 20pt) -->
                        <div style="height: 29mm; min-height: 29mm; max-height: 29mm; border-bottom: 2.5px solid #000000; box-sizing: border-box; display: flex; flex-direction: column; background: #ffffff;">
                            <div style="height: 10.5mm; min-height: 10.5mm; border-bottom: 1.5px solid #000000; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 18pt; font-weight: 900; color: #000000; letter-spacing: 4px; background: #ffffff;">
                                공급업체
                            </div>
                            <div style="flex: 1; display: flex; align-items: center; justify-content: center; font-size: 20pt; font-weight: 900; color: #000000; background: #ffffff;">
                                ${esc(supplier)}
                            </div>
                        </div>

                        <!-- 섹션 4: 제품정보 박스 (헤더 18pt, 행 3개 각각 20pt) -->
                        <div style="border-bottom: 2.5px solid #000000; box-sizing: border-box; display: flex; flex-direction: column; background: #ffffff;">
                            <div style="height: 10.5mm; min-height: 10.5mm; border-bottom: 1.5px solid #000000; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 18pt; font-weight: 900; color: #000000; letter-spacing: 4px; background: #ffffff;">
                                제품정보
                            </div>
                            <table style="width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; padding: 0;">
                                <tr style="height: 13.5mm; border-bottom: 1.5px solid #000000;">
                                    <th style="width: 32%; border-right: 1.5px solid #000000; font-size: 20pt; font-weight: 900; text-align: center; color: #000000; letter-spacing: 1px; padding: 0;">
                                        LOT NO.
                                    </th>
                                    <td style="width: 68%; font-size: 20pt; font-weight: 900; text-align: center; color: #000000; letter-spacing: 2px; padding: 0; font-family: monospace, ${fontFamily};">
                                        ${esc(lotNo)}
                                    </td>
                                </tr>
                                <tr style="height: 13.5mm; border-bottom: 1.5px solid #000000;">
                                    <th style="width: 32%; border-right: 1.5px solid #000000; font-size: 20pt; font-weight: 900; text-align: center; color: #000000; letter-spacing: 1px; padding: 0;">
                                        생산일자.
                                    </th>
                                    <td style="width: 68%; font-size: 20pt; font-weight: 900; text-align: center; color: #000000; letter-spacing: 2px; padding: 0; font-family: monospace, ${fontFamily};">
                                        ${esc(prodDateText)}
                                    </td>
                                </tr>
                                <tr style="height: 13.5mm;">
                                    <th style="width: 32%; border-right: 1.5px solid #000000; font-size: 20pt; font-weight: 900; text-align: center; color: #000000; letter-spacing: 3px; padding: 0;">
                                        수 &nbsp; &nbsp; 량.
                                    </th>
                                    <td style="width: 68%; font-size: 20pt; font-weight: 900; text-align: center; color: #000000; letter-spacing: 1px; padding: 0;">
                                        ${qtyText}
                                    </td>
                                </tr>
                            </table>
                        </div>

                        <!-- 섹션 5: 납품처 박스 (헤더 18pt, 값 20pt) -->
                        <div style="flex: 1; box-sizing: border-box; display: flex; flex-direction: column; background: #ffffff;">
                            <div style="height: 10.5mm; min-height: 10.5mm; border-bottom: 1.5px solid #000000; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 18pt; font-weight: 900; color: #000000; letter-spacing: 4px; background: #ffffff;">
                                납품처
                            </div>
                            <div style="flex: 1; display: flex; align-items: center; justify-content: center; font-size: 20pt; font-weight: 900; color: #000000; background: #ffffff; padding: 2mm 0;">
                                ${esc(customer)}
                            </div>
                            
                            <!-- 선택 시에만 노출되는 출하 검수 승인 서명란 (기본값 OFF) -->
                            ${showSign ? `
                                <div style="border-top: 1.5px solid #000000; padding: 2mm 3mm; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;">
                                    <div style="font-size: 8.5pt; font-weight: bold; color: #334155;">
                                        ※ 출하 및 입고 검수 필증 (대림기업 공식 검사 기준)
                                    </div>
                                    <table style="border: 1px solid #000000; border-collapse: collapse; text-align: center; font-size: 9pt; background: #ffffff;">
                                        <tr style="height: 5mm;">
                                            <th style="border: 1px solid #000000; width: 35px; background: #f1f5f9; font-weight: bold;">작성</th>
                                            <th style="border: 1px solid #000000; width: 35px; background: #f1f5f9; font-weight: bold;">검토</th>
                                            <th style="border: 1px solid #000000; width: 35px; background: #f1f5f9; font-weight: bold;">승인</th>
                                        </tr>
                                        <tr style="height: 10mm;">
                                            <td style="border: 1px solid #000000;"></td>
                                            <td style="border: 1px solid #000000;"></td>
                                            <td style="border: 1px solid #000000;"></td>
                                        </tr>
                                    </table>
                                </div>
                            ` : ''}
                        </div>

                    </div>
                </div>
            `;

            printArea.appendChild(pageEl);
        }
    };

    // 이벤트 리스너: 카밈 예시 데이터 즉시 로드
    container.querySelector('#btn-load-carmime-example')?.addEventListener('click', () => {
        if (pltSupplier) pltSupplier.value = '대림기업';
        if (pltCustomer) pltCustomer.value = '에이치엘비글로벌(주)';
        if (pltProductName) pltProductName.value = '카밈 가솔린 촉매 산소센서 클리너 프로 0.3L';
        if (pltSpec) pltSpec.value = '0.3L x 30개';
        if (pltItemCode) pltItemCode.value = '2AC40160-1';
        if (pltCurrentNo) pltCurrentNo.value = '1';
        if (pltTotalCount) pltTotalCount.value = '3';
        if (pltModeAll) pltModeAll.checked = true;
        if (pltLotNo) pltLotNo.value = '260914';
        if (pltProdDatePicker) pltProdDatePicker.value = '2026-09-17';
        if (pltProdDateText) pltProdDateText.value = '260917';
        if (pltBoxCount) pltBoxCount.value = '60';
        if (pltBoxPerUnit) pltBoxPerUnit.value = '30';
        if (pltQtyText) pltQtyText.value = '60박스(1800개)';
        renderPalletPages();
    });

    // 이벤트 리스너: 입력 초기화
    container.querySelector('#btn-reset-pallet-form')?.addEventListener('click', () => {
        if (pltSupplier) pltSupplier.value = '대림기업';
        if (pltCustomer) pltCustomer.value = '';
        if (pltProductName) pltProductName.value = '';
        if (pltSpec) pltSpec.value = '';
        if (pltItemCode) pltItemCode.value = '';
        if (pltCurrentNo) pltCurrentNo.value = '1';
        if (pltTotalCount) pltTotalCount.value = '1';
        if (pltModeAll) pltModeAll.checked = true;
        const todayIso = localDateStr();
        if (pltProdDatePicker) pltProdDatePicker.value = todayIso;
        const shortDate = todayIso.replace(/-/g, '').slice(2);
        if (pltProdDateText) pltProdDateText.value = shortDate;
        if (pltLotNo) pltLotNo.value = shortDate;
        if (pltBoxCount) pltBoxCount.value = '1';
        if (pltBoxPerUnit) pltBoxPerUnit.value = '1';
        if (pltQtyText) pltQtyText.value = '1박스(1개)';
        renderPalletPages();
    });

    // 입력 필드 자동 렌더링 연동
    [pltSupplier, pltCustomer, pltProductName, pltSpec, pltItemCode, pltLotNo, pltProdDateText, pltQtyText].forEach(el => {
        el?.addEventListener('input', renderPalletPages);
    });

    [pltCurrentNo, pltTotalCount].forEach(el => {
        el?.addEventListener('input', renderPalletPages);
    });

    [pltModeAll, pltModeSingle, pltShowBarcode, pltShowSign, pltFontFamily, pltProductSize].forEach(el => {
        el?.addEventListener('change', renderPalletPages);
    });

    // 수량 계산기 연동
    [pltBoxCount, pltBoxPerUnit].forEach(el => {
        el?.addEventListener('input', () => {
            updateCalculatedQty();
            renderPalletPages();
        });
    });

    // 달력 변경 시 포맷 변환 및 LOT 번호 자동 제안
    pltProdDatePicker?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
            const shortStr = val.replace(/-/g, '').slice(2);
            if (pltProdDateText) pltProdDateText.value = shortStr;
            renderPalletPages();
        }
    });

    // 마스터 품목 검색 연동
    const pltMasterSearch = container.querySelector('#plt-master-search');
    pltMasterSearch?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (!q) return;
        const matches = searchMasterItems(q, 5);
        if (matches.length > 0) {
            const topMatch = matches[0];
            if (pltProductName) pltProductName.value = topMatch.name;
            if (pltSpec) pltSpec.value = topMatch.spec || '';
            if (pltItemCode) pltItemCode.value = topMatch.code;
            if (topMatch.supplier && pltCustomer && topMatch.supplier !== '대림오일(김포)') {
                pltCustomer.value = topMatch.supplier;
            }
            renderPalletPages();
        }
    });

    // 인쇄 트리거
    container.querySelector('#btn-print-pallet-top')?.addEventListener('click', () => {
        window.print();
    });
    container.querySelector('#btn-print-pallet-bottom')?.addEventListener('click', () => {
        window.print();
    });

    // -------------------------------------------------------------
    // 7. 초기 로딩 실행
    // -------------------------------------------------------------
    updateCategoryDropdown();
    updateIndexDropdown();
    updateHistoryDropdown();
    renderTable3120();
    renderPalletPages();

    const startSubtab = initialSubtab || window.__labelInitialSubtab || localStorage.getItem('daelim_label_active_subtab') || '3120';
    window.__labelInitialSubtab = null;
    switchSubTab(startSubtab);
};
