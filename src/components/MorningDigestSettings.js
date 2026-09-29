// ==========================================
// 아침 알림 설정 창 (종합현황판 [🔔 아침 알림] 버튼) — services/morningDigest.js
// ==========================================
import { esc } from '../services/html.js';
import { canPerformAction } from '../services/auth.js';
import { isSupabaseConfigured } from '../services/supabase.js';
import { listChatUsers } from '../services/chat.js';
import { loadMorningConfig, saveMorningConfig, gchatWebhookSet, setGchatWebhook, sendDigestNow, listDigestLog, buildDigestText } from '../services/morningDigest.js';
import { loadDigestData, buildAlerts } from '../services/digest.js';

export const openMorningDigestSettings = async ({ showToast = () => {} } = {}) => {
    const canEdit = canPerformAction('MRP_PLANNING'); // 매니저 이상 (RLS 같은 규칙)
    const cloud = isSupabaseConfigured();
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[80] bg-slate-900/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto';
    wrap.innerHTML = '<div class="bg-white w-full sm:max-w-2xl sm:rounded-2xl p-6 text-center text-xs text-slate-400">불러오는 중...</div>';
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    let cfg, users = [], hookSet = false, log = [];
    try {
        [cfg, users, hookSet, log] = await Promise.all([loadMorningConfig(), listChatUsers().catch(() => []), gchatWebhookSet().catch(() => false), listDigestLog(10).catch(() => [])]);
    } catch (e) { wrap.innerHTML = `<div class="bg-white p-6 rounded-2xl text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
    const dis = canEdit ? '' : 'disabled';
    wrap.innerHTML = `
    <div class="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[100vh] sm:max-h-[92vh]">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100"><h3 class="font-black text-slate-900 text-sm">🔔 아침 알림 요약 설정</h3><button type="button" id="md-close" class="p-2 text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button></div>
        <div class="p-4 space-y-4 overflow-y-auto text-xs">
            <p class="text-slate-600 leading-relaxed">종합현황판의 <b>확인할 일</b>(납기 지남·부적합·설비 점검·안전재고 미달·재고 차이 등)을 매일 아침 한 번 보냅니다. <b>설정 시각 이후 처음 앱을 연 기기</b>가 보내며(서버 예약 없음), 여러 기기가 열어도 하루 한 번만 갑니다. 아무도 앱을 열지 않은 날은 보내지 않습니다.${canEdit ? '' : ' <b class="text-rose-600">설정 저장은 매니저 이상이 합니다.</b>'}</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label class="flex items-center gap-2 p-2 rounded-lg border border-slate-200 font-bold"><input type="checkbox" id="md-enabled" ${cfg.enabled ? 'checked' : ''} ${dis} />사용</label>
                <label class="p-2 rounded-lg border border-slate-200 font-bold">보낼 시각 <select id="md-hour" class="ml-1 border border-slate-300 rounded px-1 py-0.5" ${dis}>${Array.from({ length: 16 }, (_, i) => i + 5).map(h => `<option value="${h}" ${Number(cfg.hour) === h ? 'selected' : ''}>${h}시 이후</option>`).join('')}</select></label>
                <label class="flex items-center gap-2 p-2 rounded-lg border border-slate-200 font-bold"><input type="checkbox" id="md-weekdays" ${cfg.weekdaysOnly ? 'checked' : ''} ${dis} />평일만</label>
                <label class="p-2 rounded-lg border border-slate-200 font-bold">분류별 최대 <input type="number" id="md-max" min="3" max="50" value="${cfg.maxLines}" class="w-12 border border-slate-300 rounded px-1 py-0.5 text-right" ${dis} />줄</label>
            </div>
            <div class="p-3 rounded-xl border border-slate-200 space-y-2">
                <div class="font-black text-slate-700">앱 메시지로 받을 사람 <span class="text-slate-400 font-normal">(1:1 메시지, 보내는 사람은 그날 처음 연 사용자)</span></div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">${users.map(u => `<label class="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-50"><input type="checkbox" class="md-user" value="${esc(u.id)}" ${cfg.recipients.includes(u.id) ? 'checked' : ''} ${dis} /><span class="truncate">${esc(u.name)}${u.dept ? ` <span class="text-slate-400">${esc(u.dept)}</span>` : ''}</span></label>`).join('') || '<span class="text-slate-400">사용자 목록이 없습니다.</span>'}</div>
                <label class="flex items-center gap-2 font-bold"><input type="checkbox" id="md-all" ${cfg.toAll ? 'checked' : ''} ${dis} />전체 대화방에도 올리기</label>
            </div>
            <div class="p-3 rounded-xl border border-slate-200 space-y-2">
                <label class="flex items-center gap-2 font-black text-slate-700"><input type="checkbox" id="md-gchat" ${cfg.gchat ? 'checked' : ''} ${dis} ${cloud ? '' : 'disabled'} />구글 챗 스페이스로 보내기 <span class="px-1.5 py-0.5 rounded text-[10px] ${hookSet ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${hookSet ? '웹훅 설정됨' : '웹훅 없음'}</span></label>
                ${canEdit && cloud ? `<div class="flex flex-wrap gap-1.5"><input id="md-hook" type="url" placeholder="https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…" class="flex-1 min-w-[220px] border border-slate-300 rounded-lg px-2 py-1.5" autocomplete="off" />
                    <button type="button" id="md-hook-save" class="px-3 py-1.5 rounded-lg bg-slate-800 text-white font-bold">웹훅 저장</button>${hookSet ? '<button type="button" id="md-hook-del" class="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 font-bold">지우기</button>' : ''}</div>
                <p class="text-[11px] text-slate-500">구글 챗 스페이스 이름 ▸ <b>앱 및 통합</b> ▸ <b>웹훅 추가</b>로 만든 주소를 붙여 넣으세요. 주소는 서버에만 보관되고 다시 보이지 않습니다.</p>` : `<p class="text-[11px] text-slate-500">${cloud ? '웹훅 저장은 매니저 이상이 합니다.' : '구글 챗은 클라우드 모드에서만 쓸 수 있습니다.'}</p>`}
            </div>
            <div class="space-y-1.5">
                <div class="flex items-center justify-between"><span class="font-black text-slate-700">미리보기 (지금 기준)</span><button type="button" id="md-preview" class="px-2 py-1 rounded-lg bg-slate-100 font-bold">다시 만들기</button></div>
                <pre id="md-text" class="whitespace-pre-wrap text-[11px] bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto">만드는 중...</pre>
            </div>
            <div class="space-y-1"><div class="font-black text-slate-700">최근 보낸 기록</div>
                ${log.length ? log.map(x => `<div class="text-[11px] text-slate-600">• ${esc(String(x.id).replace('MORNING:', ''))} ${esc(x.by || '')} — ${esc(x.summary?.status === 'SENT' ? '보냄' : x.summary?.status === 'PARTIAL' ? '일부 실패' : x.summary?.status || '')}${x.summary?.counts ? ` (급함 ${x.summary.counts.red} · 주의 ${x.summary.counts.amber})` : ''}${x.summary?.errors?.length ? ` · ${esc(x.summary.errors[0])}` : ''}</div>`).join('') : '<div class="text-[11px] text-slate-400">아직 없습니다.</div>'}</div>
        </div>
        <div class="flex flex-wrap gap-2 justify-end px-4 py-3 border-t border-slate-100">
            <button type="button" id="md-test" class="px-3 py-2 rounded-lg text-xs font-black bg-white border border-slate-300 text-slate-700">지금 시험 발송</button>
            ${canEdit ? '<button type="button" id="md-save" class="px-4 py-2 rounded-lg text-xs font-black bg-indigo-600 text-white hover:bg-indigo-700">저장</button>' : ''}
        </div>
    </div>`;
    const $ = (s) => wrap.querySelector(s);
    const read = () => ({ enabled: $('#md-enabled').checked, hour: Number($('#md-hour').value), weekdaysOnly: $('#md-weekdays').checked, maxLines: Math.max(3, Number($('#md-max').value) || 15),
        recipients: [...wrap.querySelectorAll('.md-user:checked')].map(c => c.value), toAll: $('#md-all').checked, gchat: $('#md-gchat').checked });
    const preview = async () => {
        $('#md-text').textContent = '만드는 중...';
        try { const d = await loadDigestData(); $('#md-text').textContent = buildDigestText(buildAlerts(d), { maxLines: read().maxLines, errors: d.errors }); } catch (e) { $('#md-text').textContent = e.message; }
    };
    $('#md-close').addEventListener('click', close);
    $('#md-preview').addEventListener('click', preview);
    $('#md-save')?.addEventListener('click', async () => {
        const c = read();
        if (c.enabled && !c.recipients.length && !c.toAll && !c.gchat) { alert('받는 사람, 전체 대화방, 구글 챗 중 하나 이상을 고르세요.'); return; }
        try { await saveMorningConfig(c); showToast('🔔 아침 알림 설정을 저장했습니다.'); close(); } catch (e) { alert(e.message); }
    });
    $('#md-test').addEventListener('click', async () => {
        const c = read();
        if (!c.recipients.length && !c.toAll && !c.gchat) { alert('받는 사람, 전체 대화방, 구글 챗 중 하나 이상을 고르세요.'); return; }
        if (!confirm('지금 설정대로 시험 발송할까요? (오늘 아침 알림 기록과는 따로입니다)')) return;
        $('#md-test').disabled = true;
        try {
            const r = await sendDigestNow(c, { test: true });
            showToast(`🧪 시험 발송: 메시지 ${r.sent.dm}명${r.sent.all ? ' · 전체 대화방' : ''}${r.sent.gchat ? ' · 구글 챗' : ''}`);
            if (r.sent.errors.length) alert(`일부 실패:\n${r.sent.errors.join('\n')}`);
        } catch (e) { alert(e.message); }
        $('#md-test').disabled = false;
    });
    $('#md-hook-save')?.addEventListener('click', async () => {
        const url = $('#md-hook').value.trim();
        if (!url) { alert('웹훅 주소를 붙여 넣으세요.'); return; }
        try { await setGchatWebhook(url); $('#md-hook').value = ''; showToast('🔐 구글 챗 웹훅을 서버에 저장했습니다.'); close(); openMorningDigestSettings({ showToast }); } catch (e) { alert(e.message); }
    });
    $('#md-hook-del')?.addEventListener('click', async () => {
        if (!confirm('저장된 구글 챗 웹훅을 지울까요?')) return;
        try { await setGchatWebhook(''); showToast('웹훅을 지웠습니다.'); close(); openMorningDigestSettings({ showToast }); } catch (e) { alert(e.message); }
    });
    preview();
};
