import { state, processProductionInbound, deleteProductionRecord } from '../services/db.js';
import { searchMasterItems } from '../services/searchUtils.js';

export const renderProductionManager = (container, { showToast, onSwitchTab }) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const expDateStr = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 3);
        return d.toISOString().slice(0, 10);
    })();

    // 완제품 기본 후보 (마스터 중 완제품 또는 전체)
    const finishedItems = state.master.filter(m => m.category === '완제품' || m.category?.includes('완제'));
    const defaultMasterList = finishedItems.length > 0 ? finishedItems : state.master;

    // KPI 통계 계산
    const productions = state.productions || [];
    const todayProds = productions.filter(p => p.prodDate === todayStr);
    const todayTotalQty = todayProds.reduce((acc, cur) => acc + Number(cur.qty || 0), 0);
    const monthProds = productions.filter(p => p.prodDate && p.prodDate.slice(0, 7) === todayStr.slice(0, 7));
    const monthTotalQty = monthProds.reduce((acc, cur) => acc + Number(cur.qty || 0), 0);
    const totalLotsCount = new Set(productions.map(p => p.lotNo)).size;

    container.innerHTML = `
    <section id="tab-content-production" class="space-y-6">
        <!-- 상단 헤더 & 브리핑 -->
        <div class="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-blue-900/50 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            생산·소분·충진 실적 관리
                        </span>
                        <span class="text-xs text-blue-200 font-mono">대림오일 스마트 제조 연동</span>
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2.5">
                        <i data-lucide="factory" class="w-6 h-6 text-blue-400"></i>
                        <span>제품 생산 입고 & LOT 실적 관리</span>
                    </h2>
                    <p class="text-xs text-slate-300">오일 배합/소분/포장 완제품을 생산 등록하면 창고 재고로 자동 입고되며, 원부자재(기유·첨가제·드럼용기) 동시 차감 및 생산 라벨을 즉시 발행할 수 있습니다.</p>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="btn-export-prod-csv" class="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/20">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-400"></i>
                        <span>생산 실적 CSV 내보내기</span>
                    </button>
                    <button type="button" onclick="window.print()" class="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>생산 일지 인쇄</span>
                    </button>
                </div>
            </div>

            <!-- 핵심 생산 지표 KPI 카드 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>금일 생산 입고량</span>
                        <i data-lucide="package-check" class="w-4 h-4 text-emerald-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-emerald-400 font-mono">${todayTotalQty.toLocaleString()}</span>
                        <span class="text-xs text-slate-300">개/통</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">오늘 처리된 생산: ${todayProds.length}건</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>당월 누적 생산 실적</span>
                        <i data-lucide="calendar-check-2" class="w-4 h-4 text-sky-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-sky-400 font-mono">${monthTotalQty.toLocaleString()}</span>
                        <span class="text-xs text-slate-300">개/통</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">당월 생산 건수: ${monthProds.length}건</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>관리 중인 고유 LOT</span>
                        <i data-lucide="layers" class="w-4 h-4 text-amber-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-amber-400 font-mono">${totalLotsCount}</span>
                        <span class="text-xs text-slate-300">개 로트</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">제조 이력 추적 가능</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>등록된 완제품 마스터</span>
                        <i data-lucide="box" class="w-4 h-4 text-purple-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-purple-400 font-mono">${defaultMasterList.length}</span>
                        <span class="text-xs text-slate-300">개 품목</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">생산 대상 지정 가능</span>
                </div>
            </div>
        </div>

        <!-- 메인 작업 영역 (좌: 생산입고 등록 폼, 우: 생산 완료 이력 및 라벨 연계) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- 생산 입고 등록 폼 -->
            <div class="lg:col-span-5 space-y-4">
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                            <i data-lucide="plus-circle" class="w-4 h-4 text-blue-600"></i>
                            <span>신규 제품 생산 입고 등록</span>
                        </h3>
                        <span class="text-[11px] font-bold text-slate-400">전산 재고 자동 증가</span>
                    </div>

                    <form id="form-production-inbound" class="space-y-3">
                        <!-- 완제품 선택 & 검색 -->
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">생산 완제품 선택 <span class="text-rose-500">*</span></label>
                            <input type="text" id="prod-item-search" placeholder="품목명 또는 품목코드 검색..." class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium mb-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <select id="prod-item-code" required class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                ${defaultMasterList.slice(0, 50).map(m => `
                                    <option value="${m.code}">[${m.code}] ${m.name} (${m.spec || '-'})</option>
                                `).join('')}
                            </select>
                        </div>

                        <!-- 생산 수량 및 포장 단위 -->
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">생산 수량 <span class="text-rose-500">*</span></label>
                                <input type="number" id="prod-qty" min="1" max="100000" value="10" required class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-blue-600 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">포장 용기 규격</label>
                                <select id="prod-packaging" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                    <option value="200L 드럼" selected>200L 드럼 (DRUM)</option>
                                    <option value="20L 페일">20L 페일 (PAIL)</option>
                                    <option value="4L 캔">4L 캔 (CAN)</option>
                                    <option value="1L 용기">1L 용기 (BOTTLE)</option>
                                    <option value="1,000L IBC">1,000L IBC 탱크</option>
                                    <option value="벌크/탱크로리">벌크/탱크로리</option>
                                    <option value="개별 박스">개별 박스 (BOX)</option>
                                </select>
                            </div>
                        </div>

                        <!-- 입고 창고 및 작업자 -->
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">입고 대상 거점/창고</label>
                                <select id="prod-location" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                    ${state.locations.map(loc => `<option value="${loc}" ${loc.includes('김포') || loc.includes('공장') ? 'selected' : ''}>${loc}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">생산 담당자</label>
                                <select id="prod-worker" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                    ${state.workers.map(w => `<option value="${w.name} (${w.role || w.dept})" ${w.name.includes('생산') ? 'selected' : ''}>${w.name} (${w.role || w.dept})</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <!-- LOT 번호 및 자동 채번 버튼 -->
                        <div>
                            <div class="flex items-center justify-between mb-1">
                                <label class="text-xs font-bold text-slate-700">생산 LOT 번호 <span class="text-rose-500">*</span></label>
                                <button type="button" id="btn-auto-lot" class="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                    <i data-lucide="refresh-cw" class="w-3 h-3"></i>
                                    <span>자동 생성 (오늘자)</span>
                                </button>
                            </div>
                            <input type="text" id="prod-lot-no" required value="LOT-${todayStr.replace(/-/g, '')}-01" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                        </div>

                        <!-- 제조일자 및 품질유효기간 -->
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">제조일자</label>
                                <input type="date" id="prod-mfg-date" value="${todayStr}" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">품질 유효기한</label>
                                <input type="date" id="prod-exp-date" value="${expDateStr}" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                        </div>

                        <!-- 원부자재(BOM) 자동 소모 토글 섹션 -->
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                            <label class="flex items-center justify-between cursor-pointer">
                                <div class="flex items-center gap-2">
                                    <input type="checkbox" id="chk-bom-deduct" class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                    <span class="text-xs font-bold text-slate-800">원부자재(BOM) 자동 차감 연동</span>
                                </div>
                                <span class="text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full">원료·용기 재고 감소</span>
                            </label>
                            
                            <div id="bom-items-container" class="hidden space-y-2 pt-2 border-t border-slate-200">
                                <div class="text-[11px] text-slate-500 flex items-center justify-between">
                                    <span>소모 투입할 원자재/공용기 선택</span>
                                    <button type="button" id="btn-add-bom-row" class="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                                        <i data-lucide="plus" class="w-3 h-3"></i> 행 추가
                                    </button>
                                </div>
                                <div id="bom-rows-list" class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                    <!-- 동적 BOM 행 -->
                                </div>
                            </div>
                        </div>

                        <!-- 비고 / 점도 / 성적서 메모 -->
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">생산 비고 / 품질 검사 내용</label>
                            <input type="text" id="prod-notes" placeholder="예: 비중 0.852 적합, 포장 및 밀봉 완료" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                        </div>

                        <div class="pt-2">
                            <button type="submit" id="btn-submit-production" class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2">
                                <i data-lucide="check-circle" class="w-4 h-4"></i>
                                <span>생산 완료 및 창고 입고 처리</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- 우측: 생산 실적 이력 테이블 & 빠른 라벨 인쇄 안내 -->
            <div class="lg:col-span-7 space-y-4">
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div>
                            <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                                <i data-lucide="list" class="w-4 h-4 text-blue-600"></i>
                                <span>최근 제품 생산 입고 실적 내역</span>
                            </h3>
                            <p class="text-xs text-slate-500 mt-0.5">등록된 생산 완제품의 LOT 정보 및 라벨 즉시 인쇄 바로가기를 제공합니다.</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <input type="text" id="prod-history-search" placeholder="품목명, LOT 검색..." class="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                    </div>

                    <!-- 생산 실적 테이블 -->
                    <div class="overflow-x-auto rounded-xl border border-slate-200">
                        <table class="w-full text-left text-xs text-slate-700">
                            <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                                <tr>
                                    <th class="p-2.5 whitespace-nowrap">생산일자</th>
                                    <th class="p-2.5 whitespace-nowrap">LOT 번호</th>
                                    <th class="p-2.5">완제품명</th>
                                    <th class="p-2.5 whitespace-nowrap">생산량</th>
                                    <th class="p-2.5 whitespace-nowrap">입고창고</th>
                                    <th class="p-2.5 whitespace-nowrap">원자재차감</th>
                                    <th class="p-2.5 whitespace-nowrap text-center">라벨발행</th>
                                </tr>
                            </thead>
                            <tbody id="prod-history-tbody" class="divide-y divide-slate-100">
                                <!-- 렌더링 함수에서 채워짐 -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    // BOM 행 추가 헬퍼
    const bomContainer = container.querySelector('#bom-items-container');
    const bomRowsList = container.querySelector('#bom-rows-list');
    const chkBom = container.querySelector('#chk-bom-deduct');

    chkBom?.addEventListener('change', (e) => {
        if (e.target.checked) {
            bomContainer.classList.remove('hidden');
            if (bomRowsList.children.length === 0) {
                addBomRow();
            }
        } else {
            bomContainer.classList.add('hidden');
        }
    });

    const addBomRow = (defaultCode = '', defaultQty = 1) => {
        const rawItems = state.master.filter(m => m.category === '원료' || m.category === '부자재' || m.category === '소모품');
        const candidateItems = rawItems.length > 0 ? rawItems : state.master;

        const row = document.createElement('div');
        row.className = 'bom-row flex items-center gap-1.5 bg-white p-1.5 rounded-lg border border-slate-200 text-xs';
        row.innerHTML = `
            <select class="bom-item-select flex-1 bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none">
                ${candidateItems.map(m => `<option value="${m.code}" ${m.code === defaultCode ? 'selected' : ''}>[${m.code}] ${m.name}</option>`).join('')}
            </select>
            <input type="number" min="0.1" step="any" value="${defaultQty}" placeholder="수량" class="bom-item-qty w-16 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-xs text-right font-bold" />
            <button type="button" class="btn-remove-bom text-slate-400 hover:text-rose-500 p-1">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
        `;

        row.querySelector('.btn-remove-bom')?.addEventListener('click', () => row.remove());
        bomRowsList.appendChild(row);
    };

    container.querySelector('#btn-add-bom-row')?.addEventListener('click', () => addBomRow());

    // 품목 검색 필터링
    const prodSearchInput = container.querySelector('#prod-item-search');
    const prodItemSelect = container.querySelector('#prod-item-code');

    prodSearchInput?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        const matches = searchMasterItems(q, 50);
        if (matches.length === 0) {
            prodItemSelect.innerHTML = '<option value="">일치하는 완제품 없음</option>';
        } else {
            prodItemSelect.innerHTML = matches.map(m => `
                <option value="${m.code}">[${m.code}] ${m.name} (${m.spec || '-'})</option>
            `).join('');
        }
    });

    // 자동 LOT 번호 채번
    container.querySelector('#btn-auto-lot')?.addEventListener('click', () => {
        const d = new Date();
        const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
        const rnd = String(Math.floor(Math.random() * 90) + 10);
        const lotInput = container.querySelector('#prod-lot-no');
        if (lotInput) {
            lotInput.value = `LOT-${ymd}-${rnd}`;
            showToast(`새로운 LOT 번호 '${lotInput.value}'가 생성되었습니다.`);
        }
    });

    // 생산 실적 테이블 렌더링
    const renderTable = (query = '') => {
        const tbody = container.querySelector('#prod-history-tbody');
        if (!tbody) return;

        let list = state.productions || [];
        if (query) {
            const lower = query.toLowerCase();
            list = list.filter(p => 
                (p.itemName && p.itemName.toLowerCase().includes(lower)) ||
                (p.itemCode && p.itemCode.toLowerCase().includes(lower)) ||
                (p.lotNo && p.lotNo.toLowerCase().includes(lower))
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400 font-bold">생산 입고 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(item => `
            <tr class="hover:bg-slate-50/80 transition">
                <td class="p-2.5 whitespace-nowrap font-mono text-slate-600 text-[11px]">${item.prodDate || '-'}</td>
                <td class="p-2.5 whitespace-nowrap font-mono font-black text-blue-600 text-[11px]">
                    <span class="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md">${item.lotNo}</span>
                </td>
                <td class="p-2.5">
                    <div class="font-extrabold text-slate-900 text-xs">${item.itemName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${item.itemCode}</div>
                </td>
                <td class="p-2.5 whitespace-nowrap font-bold text-slate-900">
                    ${Number(item.qty).toLocaleString()} <span class="text-[10px] text-slate-500 font-normal">(${item.packaging || '단위'})</span>
                </td>
                <td class="p-2.5 whitespace-nowrap text-xs font-semibold text-slate-700">${item.location || '-'}</td>
                <td class="p-2.5 whitespace-nowrap">
                    ${item.bomDeducted 
                        ? `<span class="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">원료 차감완료</span>`
                        : `<span class="px-1.5 py-0.5 text-[10px] text-slate-400">단순입고</span>`
                    }
                </td>
                <td class="p-2.5 whitespace-nowrap text-center">
                    <button type="button" class="btn-jump-label px-2.5 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-[11px] font-bold flex items-center gap-1 mx-auto transition" data-code="${item.itemCode}" data-lot="${item.lotNo}" data-mfg="${item.mfgDate || ''}" data-exp="${item.expDate || ''}">
                        <i data-lucide="qr-code" class="w-3 h-3 text-blue-400"></i>
                        <span>라벨 인쇄</span>
                    </button>
                </td>
            </tr>
        `).join('');

        // 라벨 발행 바로가기 이벤트 바인딩
        tbody.querySelectorAll('.btn-jump-label').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.getAttribute('data-code');
                const lot = btn.getAttribute('data-lot');
                const mfg = btn.getAttribute('data-mfg');
                const exp = btn.getAttribute('data-exp');

                // 전역 window 객체에 전달할 라벨 프리필 데이터 저장
                window.__labelPrefill = { code, lot, mfg, exp };
                showToast(`[${lot}] 라벨 인쇄 탭으로 이동합니다.`);
                onSwitchTab('label');
            });
        });
    };

    container.querySelector('#prod-history-search')?.addEventListener('input', (e) => {
        renderTable(e.target.value.trim());
    });

    // 폼 제출 이벤트
    const form = container.querySelector('#form-production-inbound');
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const prodItemCode = container.querySelector('#prod-item-code').value;
        const prodQty = Number(container.querySelector('#prod-qty').value);
        const packaging = container.querySelector('#prod-packaging').value;
        const location = container.querySelector('#prod-location').value;
        const worker = container.querySelector('#prod-worker').value;
        const lotNo = container.querySelector('#prod-lot-no').value.trim();
        const mfgDate = container.querySelector('#prod-mfg-date').value;
        const expDate = container.querySelector('#prod-exp-date').value;
        const notes = container.querySelector('#prod-notes').value.trim();
        const bomDeducted = container.querySelector('#chk-bom-deduct').checked;

        // BOM 목록 수집
        const bomDetails = [];
        if (bomDeducted) {
            container.querySelectorAll('.bom-row').forEach(row => {
                const bCode = row.querySelector('.bom-item-select').value;
                const bQty = Number(row.querySelector('.bom-item-qty').value);
                const mItem = state.master.find(m => m.code === bCode);
                if (bCode && bQty > 0) {
                    bomDetails.push({
                        code: bCode,
                        name: mItem ? mItem.name : bCode,
                        qty: bQty,
                        unit: mItem?.unit || 'EA'
                    });
                }
            });
        }

        try {
            const btnSubmit = container.querySelector('#btn-submit-production');
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<span class="animate-spin mr-1">⏳</span> 처리 중...`;

            await processProductionInbound({
                prodItemCode,
                prodQty,
                packaging,
                unit: 'EA',
                lotNo,
                mfgDate,
                expDate,
                location,
                worker,
                bomDeducted,
                bomDetails,
                notes
            });

            showToast(`🎉 [${lotNo}] ${prodQty}개 생산 입고가 완료되었습니다!`);
            renderProductionManager(container, { showToast, onSwitchTab });
        } catch (err) {
            alert(`오류: ${err.message}`);
            const btnSubmit = container.querySelector('#btn-submit-production');
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<span>생산 완료 및 창고 입고 처리</span>`;
        }
    });

    // CSV 내보내기 이벤트
    container.querySelector('#btn-export-prod-csv')?.addEventListener('click', () => {
        const list = state.productions || [];
        if (list.length === 0) {
            alert('내보낼 생산 실적 데이터가 없습니다.');
            return;
        }

        const headers = ["생산일자", "LOT번호", "품목코드", "완제품명", "생산수량", "포장단위", "입고창고", "작업자", "제조일자", "유효기간", "비고"];
        const rows = list.map(p => [
            `"${p.prodDate || ''}"`,
            `"${p.lotNo || ''}"`,
            `"${p.itemCode || ''}"`,
            `"${(p.itemName || '').replace(/"/g, '""')}"`,
            p.qty || 0,
            `"${p.packaging || ''}"`,
            `"${p.location || ''}"`,
            `"${p.worker || ''}"`,
            `"${p.mfgDate || ''}"`,
            `"${p.expDate || ''}"`,
            `"${(p.notes || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `대림오일_생산실적대장_${todayStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('📁 생산 실적 CSV 파일이 다운로드되었습니다.');
    });

    // 초기 테이블 렌더링
    renderTable();
};
