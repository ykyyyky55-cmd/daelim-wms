// ==========================================
// 결재 칸 (화면 · 인쇄)
// ==========================================
// 화면: mountApprovalBox(host, doc) → 빈 칸을 누르면 로그인한 사람의 전자서명으로 서명, 서명 아래에 서명 날짜.
//       내 서명(또는 MANAGER 이상은 모든 서명)을 다시 누르면 취소.
// 인쇄: approvalPrintHtml(roles, slots) → 인라인 스타일 표(어느 인쇄 양식에도 그대로 넣음).
import { getApproval, signDoc, unsignDoc, isMine, canSign, canCancelOthers, signDateText } from '../../services/approvals.js';
import { state } from '../../services/db.js';
import { esc } from '../../services/html.js';

const slotCellHtml = (slot, role, { interactive }) => {
    if (slot) {
        return `<button type="button" class="appr-cell w-full h-full flex flex-col items-center justify-center gap-0.5 px-1 py-1 ${interactive ? 'hover:bg-rose-50' : ''}"
                    data-role="${esc(role)}" title="${esc(`${slot.name} ${slot.title || ''} · ${String(slot.at || '').replace('T', ' ')}`)}">
                    <img src="${esc(slot.sig)}" alt="${esc(slot.name)} 서명" class="h-10 w-auto max-w-[64px] object-contain pointer-events-none" />
                    <span class="text-[10px] font-bold text-slate-700 leading-none">${esc(slot.name)}</span>
                    <span class="text-[9px] text-slate-500 leading-none">${esc(signDateText(slot.at))}</span>
                </button>`;
    }
    return `<button type="button" class="appr-cell w-full h-full min-h-[64px] flex flex-col items-center justify-center text-[10px] font-bold ${interactive ? 'text-blue-500 hover:bg-blue-50' : 'text-slate-300 cursor-default'}"
                data-role="${esc(role)}" ${interactive ? '' : 'disabled'}>${interactive ? '<span class="text-base leading-none">✍</span>서명' : ''}</button>`;
};

/** 화면용 결재 칸 */
export const approvalScreenHtml = (roles, slots = {}, { title = '결재', readOnly = false, labelOf = (r) => r } = {}) => `
    <table class="appr-box border-collapse bg-white text-center shadow-sm rounded-lg overflow-hidden">
        <tr>
            <th rowspan="2" class="border border-slate-300 bg-slate-100 text-[10px] font-black text-slate-600 w-6 leading-tight px-0.5">${[...title].map(esc).join('<br>')}</th>
            ${roles.map(r => `<th class="border border-slate-300 bg-slate-100 text-[10px] font-black text-slate-600 px-1 py-0.5 w-[76px]">${esc(labelOf(r))}</th>`).join('')}
        </tr>
        <tr>${roles.map(r => `<td class="border border-slate-300 p-0 h-[68px] align-middle">${slotCellHtml(slots[r], r, { interactive: !readOnly && (slots[r] ? (isMine(slots[r]) || canCancelOthers()) : canSign()) })}</td>`).join('')}</tr>
    </table>`;

/**
 * 결재 칸 붙이기
 * @param host  넣을 요소
 * @param doc   { key, type, title, date, roles, label?: '결재', show?: 이 상자에 보일 칸(기본 roles), labelOf? } — key가 없으면(저장 전 문서) 서명 불가
 * @param opts  { showToast, onChange(slots), readOnly }
 * @returns { refresh(), getSlots() }
 */
export const mountApprovalBox = (host, doc, { showToast = () => {}, onChange = () => {}, readOnly = false } = {}) => {
    if (!host) return { refresh: async () => {}, getSlots: () => ({}) };
    let slots = {};
    const draw = () => {
        host.innerHTML = approvalScreenHtml(doc.show || doc.roles, slots, { title: doc.label || '결재', readOnly: readOnly || !doc.key, labelOf: doc.labelOf });
        host.querySelectorAll('.appr-cell').forEach(b => b.addEventListener('click', () => onCell(b.dataset.role)));
    };
    const onCell = async (role) => {
        if (!doc.key) { showToast('문서를 먼저 저장해야 결재할 수 있습니다.', 'warning'); return; }
        const slot = slots[role];
        try {
            if (slot) {
                const whose = isMine(slot) ? '내' : `${slot.name}님의`;
                if (!confirm(`'${role}' 칸의 ${whose} 서명(${signDateText(slot.at)})을 취소할까요?`)) return;
                slots = await unsignDoc(doc.key, role);
                showToast(`'${role}' 서명을 취소했습니다.`, 'info');
            } else {
                const name = state.currentUser?.name || '';
                if (!confirm(`${name} 님의 전자서명으로 '${role}' 칸에 서명할까요?\n서명 아래에 오늘 날짜가 표시됩니다.`)) return;
                slots = await signDoc(doc, role);
                showToast(`'${role}' 칸에 서명했습니다.`, 'success');
            }
            draw();
            onChange(slots);
        } catch (e) {
            showToast(e.message || '결재 처리에 실패했습니다.', 'error');
            slots = await getApproval(doc.key, { refresh: true });
            draw();
        }
    };
    const refresh = async () => {
        slots = doc.key ? await getApproval(doc.key, { refresh: true }) : {};
        draw();
        onChange(slots);
        return slots;
    };
    draw();
    refresh();
    return { refresh, getSlots: () => slots };
};

/**
 * 인쇄용 결재 칸 (인라인 스타일)
 * @param roles  ['담당','검토','승인']
 * @param slots  getApproval 결과
 * @param opts   { title: '결재', cellW: 18(mm), cellH: 15(mm), fontPt: 8 }
 */
export const approvalPrintHtml = (roles, slots = {}, { title = '결재', cellW = 18, cellH = 15, fontPt = 8, labelOf = (r) => r } = {}) => {
    const b = 'border:0.3mm solid #444;';
    const cell = (s) => (s
        ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:${cellH}mm;gap:0.2mm;">
               <img src="${esc(s.sig)}" alt="" style="height:${Math.max(6, cellH - 6)}mm;max-width:${cellW - 1}mm;object-fit:contain;" />
               <span style="font-size:${fontPt - 1.5}pt;line-height:1;white-space:nowrap;">${esc(s.name)}</span>
               <span style="font-size:${fontPt - 2}pt;line-height:1;color:#444;white-space:nowrap;">${esc(signDateText(s.at))}</span>
           </div>`
        : `<div style="height:${cellH}mm;"></div>`);
    return `<table class="appr-print" style="border-collapse:collapse;">
        <tr><th rowspan="2" style="${b}background:#eef1f5;width:6mm;font-size:${fontPt}pt;text-align:center;line-height:1.3;">${[...title].map(esc).join('<br>')}</th>
            ${roles.map(r => `<th style="${b}background:#eef1f5;width:${cellW}mm;padding:0.6mm;font-size:${fontPt}pt;text-align:center;">${esc(labelOf(r))}</th>`).join('')}</tr>
        <tr>${roles.map(r => `<td style="${b}padding:0;text-align:center;vertical-align:middle;">${cell(slots[r])}</td>`).join('')}</tr>
    </table>`;
};
