import { state } from '../services/db.js';
import { parseFieldQr, itemCodeOfScan as itemCodeOf } from '../services/fieldQr.js';
import { locationOptionsHtml, locationLabel } from '../services/locations.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 재고실사 → QR 스캔 실사: 위치 QR(또는 선택)로 위치를 정하고 품목 QR·바코드를 연속 스캔해 실사 수량을 센다.
// 센 수량은 실사표(workingMap)에 바로 들어가며, 반영은 기존 [화면 실사 수량 전산 일괄 반영] 버튼으로 한다.
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const mountAuditScan = (host, { workingMap, onChanged, showToast }) => {
    let loc = '';
    let camera = null;
    const counts = new Map(); // `${code}___${loc}` → 센 수량 (이번 스캔에서)
    let lastText = '', lastAt = 0;

    host.innerHTML = `
        <div class="p-4 rounded-2xl border-2 border-teal-400/50 bg-teal-50/40 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-black text-sm text-teal-900 flex items-center gap-2"><i data-lucide="scan-line" class="w-4 h-4"></i>QR 스캔 실사</h3>
                <div class="flex items-center gap-2">
                    <button type="button" id="as-camera" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold flex items-center gap-1"><i data-lucide="camera" class="w-3.5 h-3.5"></i><span>카메라 켜기</span></button>
                </div>
            </div>
            <p class="text-[11px] text-teal-900">① 위치 QR을 찍거나 위치를 고르고 ② 품목 QR·바코드를 찍을 때마다 1씩 셉니다 (수량 칸에서 직접 고칠 수 있음). 센 수량은 아래 실사표에 바로 들어가며, 끝나면 <b>[화면 실사 수량 전산 일괄 반영]</b>을 누르세요.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-2">
                    <div id="as-reader" class="hidden bg-slate-900 rounded-xl overflow-hidden"></div>
                    <label class="block text-xs"><span class="font-bold text-slate-700">실사 위치</span>
                        <select id="as-loc" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold bg-white">
                            <option value="">위치 QR을 찍거나 고르세요</option>
                            ${locationOptionsHtml(state.locations)}
                        </select></label>
                    <div class="flex gap-2">
                        <input type="text" id="as-input" placeholder="품목코드 입력 / 바코드 스캐너" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold font-mono bg-white" autocomplete="off" />
                        <button type="button" id="as-add" class="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold">+1</button>
                    </div>
                </div>
                <div class="space-y-2">
                    <div id="as-summary" class="text-xs font-bold text-slate-700"></div>
                    <div class="max-h-64 overflow-y-auto border border-slate-200 rounded-xl bg-white">
                        <table class="w-full text-xs"><thead class="bg-slate-100 text-slate-600 sticky top-0"><tr>
                            <th class="p-2 text-left">품목</th><th class="p-2 text-right">장부</th><th class="p-2 text-center">실사(센 수량)</th><th class="p-2 text-center">오차</th></tr></thead>
                            <tbody id="as-rows" class="divide-y divide-slate-100"></tbody></table>
                    </div>
                    <div id="as-missing"></div>
                </div>
            </div>
        </div>`;
    const $ = (s) => host.querySelector(s);

    const beep = (ok = true) => {
        try {
            navigator.vibrate?.(ok ? [60] : [200, 80, 200]);
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = ok ? 880 : 220;
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
            osc.start(); osc.stop(ctx.currentTime + 0.15);
        } catch { }
    };

    let changeTimer = null;
    const changed = () => { clearTimeout(changeTimer); changeTimer = setTimeout(onChanged, 300); };
    const bookQty = (code, l) => Number(state.inventory.find(i => i.code === code && i.location === l)?.quantity) || 0;
    const setCount = (key, value) => {
        const v = Math.max(0, Math.round((Number(value) || 0) * 1000) / 1000);
        counts.set(key, v);
        workingMap[key] = { actualQty: v, reason: workingMap[key]?.reason || 'QR 스캔 실사' };
        changed();
    };

    const render = () => {
        const mine = [...counts.keys()].filter(k => k.endsWith(`___${loc}`));
        $('#as-summary').textContent = loc
            ? `${locationLabel(loc)} · 스캔한 품목 ${mine.length}개 (이번 실사 전체 ${counts.size}개)`
            : '위치를 먼저 정하세요.';
        $('#as-rows').innerHTML = mine.length === 0
            ? '<tr><td colspan="4" class="p-4 text-center text-slate-400">스캔한 품목이 없습니다.</td></tr>'
            : mine.map(k => {
                const code = k.split('___')[0];
                const m = state.master.find(x => x.code === code);
                const book = bookQty(code, loc);
                const cnt = counts.get(k);
                const diff = Math.round((cnt - book) * 1000) / 1000;
                return `<tr>
                    <td class="p-2"><div class="font-mono font-bold text-blue-600">${esc(code)}</div><div class="font-bold">${esc(m?.name || code)}</div></td>
                    <td class="p-2 text-right">${fmt(book)}</td>
                    <td class="p-2 text-center"><input type="number" min="0" step="any" class="as-cnt w-20 text-center border border-slate-300 rounded px-1 py-0.5 font-black" data-key="${esc(k)}" value="${cnt}" /></td>
                    <td class="p-2 text-center font-black ${diff === 0 ? 'text-slate-500' : diff > 0 ? 'text-emerald-600' : 'text-rose-600'}">${diff === 0 ? '일치' : (diff > 0 ? '+' : '') + fmt(diff)}</td>
                </tr>`;
            }).join('');
        host.querySelectorAll('.as-cnt').forEach(inp => inp.addEventListener('change', () => { setCount(inp.dataset.key, inp.value); render(); }));

        // 장부에는 있는데 이번에 스캔하지 않은 품목 (이 위치)
        const missing = loc ? state.inventory.filter(i => i.location === loc && Number(i.quantity) !== 0 && !counts.has(`${i.code}___${loc}`)) : [];
        $('#as-missing').innerHTML = !loc || missing.length === 0 ? '' : `
            <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-1">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-black text-amber-900">장부에 있지만 스캔 안 된 품목 ${missing.length}개</span>
                    <button type="button" id="as-zero" class="px-2 py-1 bg-white border border-amber-300 rounded font-bold text-amber-800">모두 0으로 (없음 확인)</button>
                </div>
                <div class="max-h-24 overflow-y-auto text-amber-900">${missing.map(i => `<div>· ${esc(i.code)} ${esc(i.name)} (장부 ${fmt(i.quantity)})</div>`).join('')}</div>
            </div>`;
        $('#as-zero')?.addEventListener('click', () => {
            if (!confirm(`${locationLabel(loc)}에서 스캔하지 않은 ${missing.length}개 품목의 실사 수량을 0으로 넣을까요?\n(실제로 없는지 확인한 뒤에만 누르세요)`)) return;
            missing.forEach(i => setCount(`${i.code}___${loc}`, 0));
            render();
        });
    };

    const setLocation = (l) => {
        loc = l;
        const sel = $('#as-loc');
        if (![...sel.options].some(o => o.value === l)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(l)}">${esc(l)}</option>`);
        sel.value = l;
        render();
    };

    const handleText = (text) => {
        const q = parseFieldQr(text);
        if (q?.type === 'LOC') {
            beep();
            setLocation(q.value);
            showToast(`📍 실사 위치: ${locationLabel(q.value)}`);
            return;
        }
        if (q) { beep(false); showToast('실사에서는 위치 QR과 품목 QR만 씁니다.'); return; }
        if (!loc) { beep(false); alert('먼저 위치 QR을 찍거나 실사 위치를 고르세요.'); return; }
        const code = itemCodeOf(text);
        const m = state.master.find(x => x.code.toLowerCase() === code.toLowerCase());
        if (!m) { beep(false); showToast(`❌ 품목을 찾을 수 없습니다: ${code}`); return; }
        const key = `${m.code}___${loc}`;
        setCount(key, (counts.get(key) || 0) + 1);
        beep();
        showToast(`[${m.code}] ${m.name} → ${counts.get(key)}`);
        render();
    };

    $('#as-loc').addEventListener('change', (e) => { loc = e.target.value; render(); });
    const addManual = () => { const v = $('#as-input').value.trim(); if (v) { handleText(v); $('#as-input').value = ''; } };
    $('#as-add').addEventListener('click', addManual);
    $('#as-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });

    $('#as-camera').addEventListener('click', async () => {
        const btnText = $('#as-camera span');
        if (camera) {
            try { await camera.clear(); } catch { }
            camera = null;
            $('#as-reader').classList.add('hidden');
            btnText.textContent = '카메라 켜기';
            return;
        }
        const { Html5QrcodeScanner } = await import('html5-qrcode');
        $('#as-reader').classList.remove('hidden');
        $('#as-reader').innerHTML = '<div id="as-reader-inner"></div>';
        btnText.textContent = '카메라 끄기';
        camera = new Html5QrcodeScanner('as-reader-inner', { fps: 12, qrbox: { width: 240, height: 240 } }, false);
        camera.render((text) => {
            const now = Date.now();
            if (text === lastText && now - lastAt < 1200) return; // 같은 코드 연속 인식 방지
            lastText = text; lastAt = now;
            handleText(text);
        }, () => { });
    });

    render();
    createIcons({ icons });
    return {
        stop: async () => { if (camera) { try { await camera.clear(); } catch { } camera = null; } }
    };
};
