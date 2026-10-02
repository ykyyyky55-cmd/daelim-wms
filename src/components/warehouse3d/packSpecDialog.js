// ==========================================
// 적재 규격 창 (창고 배치도) — 품목이 파렛트에 어떤 포장으로 몇 개 실리는지 정한다 (services/packSpecs.js)
// ==========================================
// 정한 규격대로 3D의 파렛트 짐 모양이 그려지고, 파렛트 수를 따로 적지 않은 품목의 파렛트 수(재고 ÷ 파렛트당 수량)가 계산된다.
import { PACK_TYPES, PACK_GRID_MAX, PACK_LAYER_MAX, packSpecOf, hasSavedPackSpec, savePackSpec, cleanPackSpec, packsPerPallet, qtyPerPallet, palletsForQty, defaultPackSpec } from '../../services/packSpecs.js';
import { state } from '../../services/db.js';
import { esc } from '../../services/html.js';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const SOURCE_TEXT = { SAVED: '직접 정한 규격', NAME: '품명·규격에서 읽은 값', DEFAULT: '분류 기본값 (수량 모름)' };

/** 위에서 본 한 단 + 옆에서 본 단 수 그림 */
const previewSvg = (spec) => {
    const type = PACK_TYPES[spec.type];
    const size = 120, pad = 6, cellX = (size - pad * 2) / spec.cols, cellZ = (size - pad * 2) / spec.rows;
    const top = [];
    for (let row = 0; row < spec.rows; row += 1) {
        for (let col = 0; col < spec.cols; col += 1) {
            const x = pad + cellX * col, y = pad + cellZ * row;
            top.push(type.round
                ? `<circle cx="${x + cellX / 2}" cy="${y + cellZ / 2}" r="${Math.min(cellX, cellZ) * 0.45}" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="1.5"/>`
                : `<rect x="${x + cellX * 0.04}" y="${y + cellZ * 0.04}" width="${cellX * 0.92}" height="${cellZ * 0.92}" rx="2" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="1.5"/>`);
        }
    }
    const layerH = Math.min(22, (size - 22) / spec.layers);
    const side = Array.from({ length: spec.layers }, (_, i) => `<rect x="${pad}" y="${size - 14 - layerH * (i + 1)}" width="${size - pad * 2}" height="${layerH - 2}" rx="2" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="1.5"/>`).join('');
    const board = (y) => `<rect x="2" y="${y}" width="${size - 4}" height="8" rx="1.5" fill="#d6b27c" stroke="#a16207"/>`;
    return `<div class="flex items-end justify-center gap-4 theme-paper bg-white rounded-lg border p-2">
        <figure class="text-center"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="3" fill="#f5e6c8" stroke="#a16207"/>${top.join('')}</svg><figcaption class="text-[11px] text-slate-500">위에서 본 한 단 (${spec.cols} × ${spec.rows})</figcaption></figure>
        <figure class="text-center"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${side}${board(size - 12)}</svg><figcaption class="text-[11px] text-slate-500">옆에서 본 모습 (${spec.layers}단)</figcaption></figure></div>`;
};

/**
 * @param {HTMLElement} modal 창을 띄울 덮개 (fixed inset-0)
 * @param {{ item: { code: string, name: string, unit?: string, quantity?: number, spec?: string, category?: string },
 *   canEdit: boolean, showToast: (message: string) => void, onSaved: () => void }} opts
 *   item.quantity = 지금 보고 있는 자리의 재고 (있으면 '몇 파렛트'를 함께 보여 준다)
 */
export const openPackSpecDialog = (modal, { item, canEdit, showToast, onSaved }) => {
    const master = (state.master || []).find(m => m.code === item.code) || item;
    const unit = master.unit || item.unit || '';
    let spec = packSpecOf(item.code, item);
    const off = canEdit ? '' : 'disabled';
    const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };

    const draw = () => {
        const perPallet = qtyPerPallet(spec), packs = packsPerPallet(spec);
        const pallets = palletsForQty(spec, Number(item.quantity) || 0);
        const numBox = (key, max, title) => `<input data-k="${key}" type="number" min="1" max="${max}" step="1" value="${spec[key]}" ${off} title="${title}" class="w-16 border rounded-lg px-2 py-1.5 text-right font-bold">`;
        modal.innerHTML = `<div class="bg-white rounded-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div class="bg-slate-900 text-white px-4 py-2.5 rounded-t-xl flex items-center justify-between"><b class="text-sm">적재 규격</b><span class="text-[11px] text-white/70">${esc(SOURCE_TEXT[spec.source] || SOURCE_TEXT.SAVED)}</span></div>
            <div class="p-4 space-y-3">
                <div class="text-sm"><b>${esc(master.name || item.name)}</b> <span class="text-slate-400 text-xs">${esc(item.code)}${master.spec ? ` · ${esc(master.spec)}` : ''}</span></div>
                <label class="block text-sm">포장 종류<select data-k="type" ${off} class="w-full border rounded-lg px-2 py-2 mt-1 font-bold">${Object.entries(PACK_TYPES).map(([key, type]) => `<option value="${key}" ${spec.type === key ? 'selected' : ''}>${esc(type.name)}</option>`).join('')}</select></label>
                <div class="flex flex-wrap items-center gap-2 text-sm">한 단에 가로 ${numBox('cols', PACK_GRID_MAX, '파렛트 한 단의 가로 개수')} × 세로 ${numBox('rows', PACK_GRID_MAX, '파렛트 한 단의 세로 개수')} 개 · ${numBox('layers', PACK_LAYER_MAX, '위로 쌓는 단 수')} 단</div>
                <label class="flex flex-wrap items-center gap-2 text-sm" title="포장 하나(드럼 한 통·박스 한 개)에 든 수량 — 품목 단위 기준. 비우거나 0이면 파렛트 수를 계산하지 않고 모양만 그립니다">포장 하나에 든 수량
                    <input data-k="packQty" type="number" min="0" step="any" value="${spec.packQty || ''}" placeholder="모름" ${off} class="w-24 border rounded-lg px-2 py-1.5 text-right font-bold"> <span class="text-slate-500">${esc(unit)}</span></label>
                ${previewSvg(spec)}
                <div class="text-sm bg-slate-50 border rounded-lg px-3 py-2 space-y-0.5">
                    <div>파렛트 한 장에 <b>${fmt(packs)}개</b>${perPallet ? ` = <b>${fmt(perPallet)} ${esc(unit)}</b>` : ' <span class="text-slate-500">(포장 하나에 든 수량을 넣으면 수량으로 계산합니다)</span>'}</div>
                    ${Number(item.quantity) > 0 ? `<div class="text-slate-600">이 자리 재고 ${fmt(item.quantity)} ${esc(unit)} → ${pallets ? `<b>${fmt(pallets)}파렛트</b>` : '파렛트 수는 직접 적습니다'}</div>` : ''}
                </div>
                <p class="text-[11px] text-slate-500">3D 배치도의 파렛트가 이 모양과 개수로 그려지고, 파렛트 수를 직접 적지 않은 품목은 재고 ÷ 파렛트당 수량으로 계산합니다. 재고·수불부는 바뀌지 않습니다.</p>
                <div class="flex flex-wrap justify-end gap-2">
                    ${canEdit && hasSavedPackSpec(item.code) ? '<button id="ps-auto" class="mr-auto px-3 py-2 text-sm border rounded-lg text-slate-600 hover:bg-slate-50" title="저장한 규격을 지우고 품명·규격에서 읽은 값으로 되돌립니다">자동으로 되돌리기</button>' : ''}
                    <button data-close class="px-3 py-2 text-sm border rounded-lg">${canEdit ? '취소' : '닫기'}</button>
                    ${canEdit ? '<button id="ps-save" class="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-bold">저장</button>' : ''}
                </div>
            </div></div>`;
        modal.classList.remove('hidden');
    };

    // 입력 중에는 창을 다시 그리지 않고(커서가 끊김) 칸에서 나올 때 다시 그린다
    const onChange = (ev) => {
        const key = ev.target.dataset?.k;
        if (!key) return;
        if (key === 'type') {
            // 포장을 바꾸면 그 포장의 기본 적재로 (개수 단위 품목은 포장 하나 = 1)
            spec = { ...defaultPackSpec(ev.target.value, unit), source: 'SAVED' };
        } else {
            spec = { ...cleanPackSpec({ ...spec, [key]: ev.target.value === '' ? 0 : Number(ev.target.value) }), source: 'SAVED' };
        }
        draw();
    };
    const onClick = async (ev) => {
        if (ev.target === modal || ev.target.closest('[data-close]')) { detach(); close(); return; }
        const isSave = !!ev.target.closest('#ps-save'), isAuto = !!ev.target.closest('#ps-auto');
        if (!isSave && !isAuto) return;
        try {
            await savePackSpec(item.code, isSave ? spec : null);
            showToast(isSave ? `✅ ${master.name || item.code}의 적재 규격을 저장했습니다.` : '적재 규격을 자동 값으로 되돌렸습니다.');
            detach();
            close();
            onSaved();
        } catch (e) {
            showToast(`⚠️ ${e.message}`);
        }
    };
    const detach = () => { modal.removeEventListener('change', onChange); modal.removeEventListener('click', onClick); };
    modal.addEventListener('change', onChange);
    modal.addEventListener('click', onClick);
    draw();
};
