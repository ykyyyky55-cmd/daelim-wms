import { state } from '../services/db.js';
import QRCode from 'qrcode';
import { searchMasterItems } from '../services/searchUtils.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';

export const renderLabelPrinter = (container) => {
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
        const shortDate = formatToShort(prefill.mfg) || formatToShort(new Date().toISOString().slice(0, 10));
        
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
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-subtab-formtec3120" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="stamp" class="w-4 h-4 text-amber-300"></i>
                        <span>대림오일 공식 라벨 (합격도장 2칸)</span>
                    </button>
                    <button type="button" id="btn-subtab-multiformat" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10">
                        <i data-lucide="qr-code" class="w-4 h-4 text-blue-400"></i>
                        <span>QR & 폼텍 다목적 발행기</span>
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
                        <p class="text-xs text-slate-500 mt-1">200L 드럼(2칸), 20L 페일(4칸), 박스(6·8·14·18·24칸) 및 감열식 롤 프린터 규격별 맞춤 라벨을 발행합니다.</p>
                    </div>
                    <button type="button" id="btn-print-multi-labels" class="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>라벨 인쇄 (Ctrl + P)</span>
                    </button>
                </div>

                <!-- 라벨 설정 그리드 -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                    <div class="lg:col-span-4 space-y-4">
                        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 text-xs">
                            <div>
                                <label class="block font-bold text-slate-700 mb-1">라벨 용지 규격 선택 <span class="text-rose-500">*</span></label>
                                <select id="label-formtec-type" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                    <optgroup label="[대형] 드럼 & 페일용">
                                        <option value="fmt-3102" data-cells="2">폼텍 3102 (2칸: 199.6 x 143.5 mm) - 200L 드럼/파레트</option>
                                        <option value="fmt-3105" data-cells="4">폼텍 3105 (4칸: 99.1 x 139.0 mm) - 20L 페일/말통</option>
                                    </optgroup>
                                    <optgroup label="[중형] 박스 & 윤활유 용기용">
                                        <option value="fmt-3107" data-cells="6">폼텍 3107 (6칸: 99.1 x 93.1 mm) - 중형 박스용</option>
                                        <option value="fmt-3108" data-cells="8">폼텍 3108 (8칸: 99.1 x 67.7 mm) - 물류 출하 박스용</option>
                                        <option value="fmt-3120" data-cells="14" selected>폼텍 3120 / 3114 (14칸: 99.1 x 38.1 mm) - 표준 부착용</option>
                                        <option value="fmt-3118" data-cells="18">폼텍 3118 (18칸: 63.5 x 46.6 mm) - 다목적용</option>
                                    </optgroup>
                                    <optgroup label="[소형 및 감열 롤] 부품 & 연속용">
                                        <option value="fmt-3130" data-cells="24">폼텍 3130 (24칸: 64.0 x 33.8 mm) - 소형 캔/샘플병</option>
                                        <option value="roll-10080" data-cells="1">감열식 롤 라벨 (1매: 100 x 80 mm) - 바코드 프린터용</option>
                                    </optgroup>
                                </select>
                            </div>

                            <div>
                                <label class="block font-bold text-slate-700 mb-1">인쇄 대상 품목 검색 & 선택</label>
                                <input type="text" id="label-item-search" placeholder="코드 또는 품목명 일부 입력..." class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium mb-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                <select id="label-target-item" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                    ${state.master.slice(0, 50).map(m => `<option value="${m.code}">[${m.code}] ${m.name}</option>`).join('')}
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
                                        <input type="text" id="label-mfg-date" value="${new Date().toISOString().slice(0, 10)}" placeholder="YYYY-MM-DD" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
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
                                <span>실제 용지 레이아웃 미리보기</span>
                                <span class="text-blue-600">※ 실제 인쇄 시 브라우저 여백을 '없음(None)'으로 설정하세요.</span>
                            </div>
                            <div id="label-render-area" class="bg-white shadow-xl mx-auto rounded-sm overflow-hidden" style="min-height: 400px;"></div>
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
    // 3. 서브탭 전환 로직 (대림오일 공식 2칸 vs 다목적 QR)
    // -------------------------------------------------------------
    const btnSubtab3120 = container.querySelector('#btn-subtab-formtec3120');
    const btnSubtabMulti = container.querySelector('#btn-subtab-multiformat');
    const view3120 = container.querySelector('#view-formtec3120');
    const viewMulti = container.querySelector('#view-multiformat');

    const switchSubTab = (tab) => {
        if (tab === '3120') {
            view3120.classList.remove('hidden');
            viewMulti.classList.add('hidden');
            btnSubtab3120.className = 'px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md';
            btnSubtabMulti.className = 'px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10';
        } else {
            view3120.classList.add('hidden');
            viewMulti.classList.remove('hidden');
            btnSubtab3120.className = 'px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10';
            btnSubtabMulti.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md';
            generateMultiPreview();
        }
        createIcons({ icons });
    };

    btnSubtab3120?.addEventListener('click', () => switchSubTab('3120'));
    btnSubtabMulti?.addEventListener('click', () => switchSubTab('multi'));

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
                const lower = searchQuery.toLowerCase();
                const pName = (item.productName || '').toLowerCase();
                const sheet = (item.sheet || '').toLowerCase();
                const lot = (item.lotNo || '').toLowerCase();
                const date = (item.date || '').toLowerCase();
                const qty = (item.qty || '').toLowerCase();
                const note = (item.note || '').toLowerCase();
                const inspect = (item.inspectDate || '').toLowerCase();

                const match = pName.includes(lower) ||
                              sheet.includes(lower) ||
                              lot.includes(lower) ||
                              date.includes(lower) ||
                              qty.includes(lower) ||
                              note.includes(lower) ||
                              inspect.includes(lower);
                if (!match) return false;
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
                        📂 '${selectedCategory}' 구분이 선택되었습니다.<br>
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
                    <div class="label-title-3120">${item.productName || '&nbsp;'}</div>
                    <table class="label-table-3120">
                        <tr>
                            <th>DATE</th>
                            <td>${item.date || ''}</td>
                        </tr>
                        <tr>
                            <th>LOT NO</th>
                            <td>
                                <div class="lot-td-container-3120">
                                    <span>${item.lotNo || ''}</span>
                                    <div class="stamp-box-inline-3120">
                                        <div class="stamp-company-3120">(주)대림오일</div>
                                        <div class="stamp-date-3120">${item.inspectDate || ''}</div>
                                        <div class="stamp-pass-3120">합 격</div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <th>수 량</th>
                            <td>${item.qty || ''}</td>
                        </tr>
                        <tr>
                            <th>비 고</th>
                            <td>${item.note || ''}</td>
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
                qtyOptionsHtml = `<option value="${item.qty}" selected>${item.qty}</option>` + qtyOptionsHtml;
            }

            const tr = document.createElement('tr');
            tr.className = 'bg-white hover:bg-slate-50 transition';
            tr.innerHTML = `
                <td class="p-3 text-center"><input type="checkbox" class="row-checkbox rounded w-4 h-4 text-blue-600 cursor-pointer" ${item.checked ? 'checked' : ''}></td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-sheet w-full bg-emerald-50/70 border border-emerald-200 rounded-lg px-2 py-1 text-xs font-bold text-emerald-900" value="${item.sheet || ''}"></td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-name w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-black text-slate-900" value="${item.productName || ''}"></td>
                <td class="px-2.5 py-1.5"><input type="date" class="input-date w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700" value="${dateISO}"></td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-lot w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono font-black text-indigo-800" value="${item.lotNo || ''}"></td>
                <td class="px-2.5 py-1.5">
                    <select class="select-qty w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800">
                        ${qtyOptionsHtml}
                    </select>
                </td>
                <td class="px-2.5 py-1.5"><input type="text" class="input-note w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs" value="${item.note || ''}"></td>
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
                const todayStr = formatToShort(new Date().toISOString().slice(0, 10));
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
        const todayStr = formatToShort(new Date().toISOString().slice(0, 10));
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
                                    date: String(row[1] || formatToShort(new Date().toISOString().slice(0, 10))),
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
        XLSX.writeFile(wb, `대림오일_라벨목록_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
        link.download = `대림오일_라벨데이터_${new Date().toISOString().slice(0, 10)}.csv`;
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

        const todayStr = formatToShort(new Date().toISOString().slice(0, 10));
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
    const generateMultiPreview = async () => {
        const itemCode = container.querySelector('#label-target-item')?.value;
        const formtecSelect = container.querySelector('#label-formtec-type');
        const formtecType = formtecSelect ? formtecSelect.value : 'fmt-3120';
        const count = parseInt(container.querySelector('#label-print-count')?.value, 10) || 1;
        const offset = parseInt(container.querySelector('#label-start-offset')?.value, 10) || 0;
        const lotNo = container.querySelector('#label-lot-no')?.value.trim() || '';
        const mfgDate = container.querySelector('#label-mfg-date')?.value.trim() || '';
        const expDate = container.querySelector('#label-exp-date')?.value.trim() || '';

        const item = state.master.find(m => m.code === itemCode);
        if (!item) return;

        const qrPayload = lotNo ? `${item.code}|${lotNo}` : item.code;
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 220, margin: 1 });

        const renderArea = container.querySelector('#label-render-area');
        if (!renderArea) return;
        const isRoll = formtecType === 'roll-10080';
        renderArea.className = isRoll ? `roll-10080 printable-area` : `formtec-page fmt-grid ${formtecType} printable-area`;

        let cellsHtml = '';
        if (!isRoll) {
            for (let i = 0; i < offset; i++) {
                cellsHtml += `<div class="fmt-cell border border-dashed border-slate-200 opacity-20"></div>`;
            }
        }

        const maxCells = isRoll ? count : Math.min(count, 48);
        for (let i = 0; i < maxCells; i++) {
            cellsHtml += `
                <div class="fmt-cell border border-slate-200 bg-white">
                    <div class="flex-1 pr-2 min-w-0">
                        <div class="flex items-center gap-1">
                            <span class="text-[9px] font-mono font-black text-blue-700">${item.code}</span>
                            <span class="px-1 py-0.2 rounded text-[8px] bg-slate-100 text-slate-600 font-bold">${item.category}</span>
                        </div>
                        <div class="font-extrabold text-slate-900 text-xs truncate mt-0.5">${item.name}</div>
                        <div class="text-[9px] text-slate-400 truncate">${item.spec || '-'}</div>
                        ${lotNo ? `<div class="text-[9px] font-mono text-indigo-700 font-bold mt-0.5">LOT: ${lotNo}</div>` : ''}
                        ${mfgDate ? `<div class="text-[8px] text-slate-500 font-mono">제조: ${mfgDate} ${expDate ? `| 유효: ${expDate}` : ''}</div>` : ''}
                    </div>
                    <div class="flex-shrink-0 text-center">
                        <img src="${qrDataUrl}" alt="QR" class="w-12 h-12 object-contain" />
                    </div>
                </div>
            `;
        }
        renderArea.innerHTML = cellsHtml;
    };

    container.querySelector('#btn-generate-preview')?.addEventListener('click', generateMultiPreview);
    container.querySelector('#label-target-item')?.addEventListener('change', generateMultiPreview);
    container.querySelector('#label-formtec-type')?.addEventListener('change', generateMultiPreview);
    container.querySelector('#btn-print-multi-labels')?.addEventListener('click', () => {
        window.print();
    });

    const multiSearchInput = container.querySelector('#label-item-search');
    multiSearchInput?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        const matches = searchMasterItems(q, 40);
        const itemSelect = container.querySelector('#label-target-item');
        if (matches.length === 0) {
            itemSelect.innerHTML = '<option value="">일치하는 품목 없음</option>';
        } else {
            itemSelect.innerHTML = matches.map(m => `<option value="${m.code}">[${m.code}] ${m.name}</option>`).join('');
            generateMultiPreview();
        }
    });

    // -------------------------------------------------------------
    // 6. 초기 로딩 실행
    // -------------------------------------------------------------
    updateCategoryDropdown();
    updateIndexDropdown();
    updateHistoryDropdown();
    renderTable3120();
};
