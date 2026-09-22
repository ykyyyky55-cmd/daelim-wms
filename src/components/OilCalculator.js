export const renderOilCalculator = (container, { showToast }) => {
    container.innerHTML = `
    <section id="tab-content-oilcalc" class="space-y-6">
        <!-- 헤더 배너 -->
        <div class="bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-slate-800 space-y-2">
            <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-sky-500/30 text-sky-300 border border-sky-400/30">윤활유 전문 분석 도구</span>
                <span class="text-xs text-slate-400">ASTM D1250 / ASTM D2270 표준 환산 엔진</span>
            </div>
            <h2 class="text-xl sm:text-2xl font-black tracking-tight">윤활유·석유제품 전용 비중(SG) & 수불 환산 계산 솔루션</h2>
            <p class="text-xs text-slate-300">현장 실측 온도 기준 15℃ 표준 비중 환산, 탱크로리·드럼 입출고 중량(kg) ↔ 용량(L) 실시간 상호 변환 및 기본유 혼합 점도를 정밀 산출합니다.</p>
        </div>

        <!-- 하위 탭 선택 바 -->
        <div class="flex rounded-2xl border border-slate-200 p-1 bg-white shadow-xs text-xs font-bold gap-1 overflow-x-auto">
            <button type="button" id="tool-tab-sg" class="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 text-white shadow-xs transition flex items-center justify-center gap-1.5 whitespace-nowrap">
                <i data-lucide="thermometer" class="w-4 h-4"></i>
                <span>1. 15℃ 표준 비중(SG) 보정 환산</span>
            </button>
            <button type="button" id="tool-tab-vol" class="flex-1 py-2.5 px-4 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-slate-50 transition flex items-center justify-center gap-1.5 whitespace-nowrap">
                <i data-lucide="scale" class="w-4 h-4"></i>
                <span>2. 중량(kg) ↔ 용량(L) 수불 변환</span>
            </button>
            <button type="button" id="tool-tab-blend" class="flex-1 py-2.5 px-4 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-slate-50 transition flex items-center justify-center gap-1.5 whitespace-nowrap">
                <i data-lucide="flask-conical" class="w-4 h-4"></i>
                <span>3. 기본유 혼합 점도 & VI 산출</span>
            </button>
        </div>

        <!-- 1번 탭: 15도 표준 비중 환산 -->
        <div id="subview-sg" class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="sliders" class="w-4 h-4 text-blue-600"></i>
                        <span>현장 실측 데이터 입력</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">비중계로 측정한 현재 온도와 비중을 입력하세요.</p>
                </div>

                <div class="space-y-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">측정 온도 (℃)</label>
                        <input type="number" id="sg-input-temp" value="25" step="0.1" class="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold focus:ring-2 focus:ring-blue-500" />
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 mb-1">실측 비중 (Specific Gravity)</label>
                        <input type="number" id="sg-input-val" value="0.8450" step="0.0001" min="0.6" max="1.5" class="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold text-blue-600 focus:ring-2 focus:ring-blue-500" />
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 mb-1">유종 분류 (팽창/보정계수)</label>
                        <select id="sg-select-product" class="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold bg-white focus:ring-2 focus:ring-blue-500">
                            <option value="0.00065" selected>엔진오일 / 윤활유 (계수: 0.00065)</option>
                            <option value="0.00063">합성 기유 / 유압작동유 (계수: 0.00063)</option>
                            <option value="0.00070">경유 / 디젤 (계수: 0.00070)</option>
                            <option value="0.00075">등유 / 솔벤트 (계수: 0.00075)</option>
                            <option value="0.00090">휘발유 / 가솔린 (계수: 0.00090)</option>
                            <option value="0.00062">중유 / 벙커유 (계수: 0.00062)</option>
                        </select>
                    </div>

                    <div class="pt-2 flex gap-2">
                        <button type="button" id="btn-quick-temp-15" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold">15℃ 기본</button>
                        <button type="button" id="btn-quick-temp-20" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold">20℃ 상온</button>
                        <button type="button" id="btn-quick-temp-40" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold">40℃ 고온</button>
                    </div>
                </div>
            </div>

            <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900">15℃ 표준 상태 환산 결과</h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">정유사 성적서(COA) 및 시험 규격 기준치와 즉시 대조 가능합니다.</p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 text-center shadow-xs">
                        <span class="text-xs font-bold text-blue-700 block">15℃ 기준 환산 비중 (SG @ 15℃)</span>
                        <div id="res-sg-15" class="text-3xl sm:text-4xl font-black text-blue-900 font-mono my-2">0.8515</div>
                        <span id="res-sg-diff" class="text-[11px] font-bold text-blue-600 block">+0.0065 보정치 적용</span>
                    </div>

                    <div class="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-5 text-center shadow-xs">
                        <span class="text-xs font-bold text-emerald-800 block">15℃ 기준 밀도 (Density)</span>
                        <div id="res-density-15" class="text-3xl sm:text-4xl font-black text-emerald-950 font-mono my-2">0.8507</div>
                        <span class="text-[11px] font-bold text-emerald-700 block">g/cm³ (또는 kg/L)</span>
                    </div>
                </div>

                <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-600 space-y-1">
                    <div class="font-bold text-slate-800 flex items-center gap-1">
                        <i data-lucide="info" class="w-3.5 h-3.5 text-blue-600"></i>
                        <span>ASTM D1250 환산 원리</span>
                    </div>
                    <p class="text-[11px] leading-relaxed">
                        석유제품은 온도가 상승하면 부피가 팽창하여 실측 비중이 낮아집니다.
                        산출 공식: <code>SG₁₅ = SG_T + 계수 × (T - 15℃)</code>에 의해 표준온도(15℃) 상태의 순수 질량 밀도로 자동 보정됩니다.
                    </p>
                </div>
            </div>
        </div>

        <!-- 2번 탭: 중량(kg) ↔ 용량(L) 수불 변환 -->
        <div id="subview-vol" class="hidden grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="arrow-left-right" class="w-4 h-4 text-emerald-600"></i>
                        <span>중량 ↔ 용량 변환 조건</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">탱크로리 계근표(kg) 또는 주유 유량계(L) 값을 입력하세요.</p>
                </div>

                <div class="space-y-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">적용 밀도/비중 (kg/L)</label>
                        <input type="number" id="vol-density" value="0.8515" step="0.0001" class="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500" />
                    </div>

                    <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                        <label class="block font-bold text-slate-800">변환 방향 선택</label>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer">
                                <input type="radio" name="conv-dir" value="KG_TO_L" checked class="text-emerald-600" />
                                <span class="font-bold">중량(kg) &rarr; 용량(L)</span>
                            </label>
                            <label class="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer">
                                <input type="radio" name="conv-dir" value="L_TO_KG" class="text-emerald-600" />
                                <span class="font-bold">용량(L) &rarr; 중량(kg)</span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label id="lbl-input-amount" class="block font-bold text-slate-700 mb-1">입력 수량 (kg)</label>
                        <input type="number" id="vol-input-amount" value="10000" min="0" step="1" class="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-base font-black text-slate-900 focus:ring-2 focus:ring-emerald-500" />
                    </div>
                </div>
            </div>

            <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900">환산 결과 및 패키징 환산</h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">탱크 및 드럼/페일 포장 단위로 동시 산출됩니다.</p>
                </div>

                <div class="bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-5 rounded-2xl text-center shadow-md">
                    <span id="res-conv-label" class="text-xs font-bold text-emerald-200 block">환산된 총 용량</span>
                    <div id="res-conv-main" class="text-3xl sm:text-4xl font-black font-mono my-1">11,744 L</div>
                    <span id="res-conv-sub" class="text-xs text-emerald-100">10,000 kg &times; 1.1744 L/kg</span>
                </div>

                <div class="grid grid-cols-3 gap-3 text-center text-xs">
                    <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                        <span class="text-slate-400 font-bold block text-[10px]">200L 드럼 환산</span>
                        <div id="res-conv-drum" class="text-lg font-black text-slate-800 mt-1">58.7 드럼</div>
                    </div>
                    <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                        <span class="text-slate-400 font-bold block text-[10px]">18L 페일 환산</span>
                        <div id="res-conv-pail" class="text-lg font-black text-slate-800 mt-1">652.4 캔</div>
                    </div>
                    <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                        <span class="text-slate-400 font-bold block text-[10px]">4L 용기 환산</span>
                        <div id="res-conv-4l" class="text-lg font-black text-slate-800 mt-1">2,936 통</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 3번 탭: 기본유 혼합 점도 & 점도지수 -->
        <div id="subview-blend" class="hidden grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="beaker" class="w-4 h-4 text-violet-600"></i>
                        <span>2종 기유(Base Oil) 혼합 동점도 계산</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">Refutas / Walther Logarithmic 혼합 공식 적용</p>
                </div>

                <div class="grid grid-cols-2 gap-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">기유 #1 점도 (cSt)</label>
                        <input type="number" id="blend-v1" value="30.0" step="0.1" class="w-full px-3 py-2 border rounded-xl font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">기유 #1 비율 (%)</label>
                        <input type="number" id="blend-r1" value="60" min="0" max="100" class="w-full px-3 py-2 border rounded-xl font-bold text-blue-600" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">기유 #2 점도 (cSt)</label>
                        <input type="number" id="blend-v2" value="90.0" step="0.1" class="w-full px-3 py-2 border rounded-xl font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">기유 #2 비율 (%)</label>
                        <input type="number" id="blend-r2" value="40" disabled class="w-full px-3 py-2 border rounded-xl font-bold text-slate-400 bg-slate-100" />
                    </div>
                </div>

                <div class="bg-violet-50 border border-violet-200 rounded-xl p-4 text-center">
                    <span class="text-xs font-bold text-violet-700 block">혼합 예측 동점도</span>
                    <div id="res-blend-visc" class="text-3xl font-black text-violet-950 font-mono mt-1">47.88 cSt</div>
                </div>
            </div>

            <div class="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="gauge" class="w-4 h-4 text-indigo-600"></i>
                        <span>ASTM D2270 점도지수 (VI) 산출</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">40℃ 및 100℃ 동점도로 점도 온도 안정성을 평가합니다.</p>
                </div>

                <div class="grid grid-cols-2 gap-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">40℃ 동점도 (KV40, cSt)</label>
                        <input type="number" id="vi-kv40" value="66.67" step="0.1" class="w-full px-3 py-2 border rounded-xl font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">100℃ 동점도 (KV100, cSt)</label>
                        <input type="number" id="vi-kv100" value="11.35" step="0.01" class="w-full px-3 py-2 border rounded-xl font-bold" />
                    </div>
                </div>

                <div class="bg-slate-900 text-white rounded-xl p-4 text-center">
                    <span class="text-xs font-bold text-slate-400 block">점도지수 (Viscosity Index)</span>
                    <div id="res-vi-value" class="text-3xl font-black text-sky-400 font-mono mt-1">165</div>
                    <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">초고점도지수 합성유 (Very High VI)</span>
                </div>
            </div>
        </div>
    </section>
    `;

    // 탭 전환 로직
    const switchSubTab = (tab) => {
        ['sg', 'vol', 'blend'].forEach(t => {
            const btn = container.querySelector(`#tool-tab-${t}`);
            const view = container.querySelector(`#subview-${t}`);
            if (t === tab) {
                btn.className = 'flex-1 py-2.5 px-4 rounded-xl bg-blue-600 text-white shadow-xs transition flex items-center justify-center gap-1.5 whitespace-nowrap';
                view.classList.remove('hidden');
            } else {
                btn.className = 'flex-1 py-2.5 px-4 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-slate-50 transition flex items-center justify-center gap-1.5 whitespace-nowrap';
                view.classList.add('hidden');
            }
        });
    };

    container.querySelector('#tool-tab-sg')?.addEventListener('click', () => switchSubTab('sg'));
    container.querySelector('#tool-tab-vol')?.addEventListener('click', () => switchSubTab('vol'));
    container.querySelector('#tool-tab-blend')?.addEventListener('click', () => switchSubTab('blend'));

    // 1. 비중 계산 로직
    const calcSG = () => {
        const temp = parseFloat(container.querySelector('#sg-input-temp').value) || 15;
        const sg = parseFloat(container.querySelector('#sg-input-val').value) || 0.85;
        const coef = parseFloat(container.querySelector('#sg-select-product').value) || 0.00065;

        // ASTM 보정: SG15 = SGT + coef * (T - 15)
        const sg15 = sg + coef * (temp - 15);
        const density15 = sg15 * 0.9991;
        const diff = sg15 - sg;

        container.querySelector('#res-sg-15').innerText = sg15.toFixed(4);
        container.querySelector('#res-density-15').innerText = density15.toFixed(4);
        container.querySelector('#res-sg-diff').innerText = `${diff >= 0 ? '+' : ''}${diff.toFixed(4)} 보정치 적용 (온도차: ${temp - 15}℃)`;

        // 2번 탭 기본 밀도로 자동 전파
        const volDensity = container.querySelector('#vol-density');
        if (volDensity) volDensity.value = sg15.toFixed(4);
        calcVol();
    };

    ['#sg-input-temp', '#sg-input-val', '#sg-select-product'].forEach(id => {
        container.querySelector(id)?.addEventListener('input', calcSG);
    });

    container.querySelector('#btn-quick-temp-15')?.addEventListener('click', () => { container.querySelector('#sg-input-temp').value = 15; calcSG(); });
    container.querySelector('#btn-quick-temp-20')?.addEventListener('click', () => { container.querySelector('#sg-input-temp').value = 20; calcSG(); });
    container.querySelector('#btn-quick-temp-40')?.addEventListener('click', () => { container.querySelector('#sg-input-temp').value = 40; calcSG(); });

    // 2. 중량/용량 변환 로직
    const calcVol = () => {
        const density = parseFloat(container.querySelector('#vol-density').value) || 0.8515;
        const amount = parseFloat(container.querySelector('#vol-input-amount').value) || 0;
        const dir = container.querySelector('input[name="conv-dir"]:checked')?.value || 'KG_TO_L';

        const lbl = container.querySelector('#lbl-input-amount');
        const resLabel = container.querySelector('#res-conv-label');
        const resMain = container.querySelector('#res-conv-main');
        const resSub = container.querySelector('#res-conv-sub');

        let liters = 0;
        if (dir === 'KG_TO_L') {
            lbl.innerText = '입력 수량 (중량: kg)';
            resLabel.innerText = '환산된 총 부피/용량 (Volume)';
            liters = density > 0 ? (amount / density) : 0;
            resMain.innerText = `${Math.round(liters).toLocaleString()} L`;
            resSub.innerText = `${amount.toLocaleString()} kg ÷ ${density} kg/L`;
        } else {
            lbl.innerText = '입력 수량 (용량: L)';
            resLabel.innerText = '환산된 총 중량/무게 (Weight)';
            const kg = amount * density;
            liters = amount;
            resMain.innerText = `${Math.round(kg).toLocaleString()} kg`;
            resSub.innerText = `${amount.toLocaleString()} L × ${density} kg/L`;
        }

        container.querySelector('#res-conv-drum').innerText = `${(liters / 200).toFixed(1)} 드럼`;
        container.querySelector('#res-conv-pail').innerText = `${(liters / 18).toFixed(1)} 캔`;
        container.querySelector('#res-conv-4l').innerText = `${Math.round(liters / 4).toLocaleString()} 통`;
    };

    container.querySelector('#vol-density')?.addEventListener('input', calcVol);
    container.querySelector('#vol-input-amount')?.addEventListener('input', calcVol);
    container.querySelectorAll('input[name="conv-dir"]').forEach(r => r.addEventListener('change', calcVol));

    // 3. 기유 혼합 및 VI
    const calcBlend = () => {
        const v1 = parseFloat(container.querySelector('#blend-v1').value) || 30;
        const r1 = parseFloat(container.querySelector('#blend-r1').value) || 50;
        const v2 = parseFloat(container.querySelector('#blend-v2').value) || 90;
        const r2 = Math.max(0, 100 - r1);
        container.querySelector('#blend-r2').value = r2;

        // Walther / Refutas index
        const w1 = Math.log(Math.log(v1 + 0.7));
        const w2 = Math.log(Math.log(v2 + 0.7));
        const wBlend = (r1 / 100) * w1 + (r2 / 100) * w2;
        const vBlend = Math.exp(Math.exp(wBlend)) - 0.7;

        container.querySelector('#res-blend-visc').innerText = `${vBlend.toFixed(2)} cSt`;
    };

    const calcVI = () => {
        const u = parseFloat(container.querySelector('#vi-kv40').value) || 66.67;
        const y = parseFloat(container.querySelector('#vi-kv100').value) || 11.35;

        // ASTM D2270 간이 근사 산출식
        let vi = 0;
        if (y > 2.0) {
            // L, H interpolation
            const l = 0.8353 * Math.pow(y, 2) + 14.67 * y - 216;
            const h = 0.1684 * Math.pow(y, 2) + 11.85 * y - 97;
            if (u <= h) {
                const n = (Math.log(h) - Math.log(u)) / Math.log(y);
                vi = Math.round((Math.pow(10, n) - 1) / 0.00715 + 100);
            } else {
                vi = Math.round(((l - u) / (l - h)) * 100);
            }
        }
        if (isNaN(vi) || vi < 0) vi = 100;
        container.querySelector('#res-vi-value').innerText = vi;
    };

    container.querySelector('#blend-v1')?.addEventListener('input', calcBlend);
    container.querySelector('#blend-r1')?.addEventListener('input', calcBlend);
    container.querySelector('#blend-v2')?.addEventListener('input', calcBlend);
    container.querySelector('#vi-kv40')?.addEventListener('input', calcVI);
    container.querySelector('#vi-kv100')?.addEventListener('input', calcVI);

    calcSG();
    calcVol();
    calcBlend();
    calcVI();
};
