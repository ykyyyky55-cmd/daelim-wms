// ==========================================
// 품질관리 → MSDS관리 → 혼합물 MSDS 작성 (목록 · 물질 정보 · 안전보건공단 연동 설정)
// ==========================================
// CAS 번호와 함유량으로 혼합물의 GHS 분류·경고표지·MSDS 16개 항목을 만든다 (고용노동부고시 제2026-26호).
// - 작성 문서에는 정확한 함유량(배합 자료)이 들어가므로 마스터·작업일지 관리자만 쓴다 (services/auth.js hasWorklogAccess, DB RLS 같은 규칙).
// - 편집기(msds/msdsEditor.js)는 화면을 덮는 창으로 뜨고, 이 화면은 목록만 보여 준다 — 화면이 다시 그려져도 편집 중인 내용은 남는다.
// - 발행본(함유량은 범위로)은 편집기의 [MSDS 대장에 등록]으로 제품 MSDS 대장에 올려 모두가 본다.
import { esc } from '../../services/html.js';
import { hasWorklogAccess, isCloudAuth } from '../../services/auth.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc } from '../../services/quality.js';
import { GHS_NOTICE, PICTOGRAMS, SIGNALS } from '../../services/ghs/ghsTables.js';
import { pictogramSvg } from '../../services/ghs/pictograms.js';
import { emptySubstance, isValidCas, normCas } from '../../services/ghs/substanceParse.js';
import { listSubstances, saveSubstance, deleteSubstance, lookupSubstance, koshaKeySet, setKoshaKey, testKosha, clearChemCache } from '../../services/ghs/chemSubstances.js';
import { listMsdsDocs, deleteMsdsDoc, getSupplierDefault } from '../../services/ghs/msdsDocs.js';
import { openMsdsEditor, forceCloseMsdsEditor } from './msds/msdsEditor.js';
import { openSubstanceDialog } from './msds/substanceDialog.js';
import { openDialog, refreshIcons, clsChips, sourceBadge, INPUT, BTN_PRIMARY, BTN_SUB, BTN_MINI, CARD } from './msds/msdsUi.js';

const KOSHA_PORTAL = 'https://www.data.go.kr/data/15157612/openapi.do';

// 로그아웃하면 편집기를 닫고 받아 둔 물질 정보를 메모리에서 지운다 (main.js가 부른다 — 배합 자료가 화면·메모리에 남지 않게)
window.__msdsCleanup = () => { forceCloseMsdsEditor(); clearChemCache(); };

/** 안전보건공단 MSDS 조회 인증키 설정 창 */
const openKoshaDialog = async ({ showToast, onChanged = () => {} }) => {
    const isCloud = isCloudAuth();
    const isSet = isCloud ? await koshaKeySet() : false;
    const dlg = openDialog({
        title: '안전보건공단 MSDS 조회 연동', sub: 'CAS 번호로 공단 화학물질정보(분류·노출기준·규제현황)를 받아옵니다', maxW: 'max-w-2xl', icon: 'key-round',
        bodyHtml: `
        <div class="rounded-xl border ${isSet ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'} p-3" id="kd-state">
            ${!isCloud ? '<b>로컬 모드</b>에서는 공단 조회를 쓸 수 없습니다 (PubChem과 직접 입력만).' : isSet ? '<b>인증키가 설정되어 있습니다.</b> [연결 확인]으로 실제 조회가 되는지 볼 수 있습니다.' : '<b>인증키가 아직 없습니다.</b> 지금은 PubChem(외국 자료)과 직접 입력으로만 물질 정보를 넣을 수 있습니다.'}</div>
        <div class="space-y-1.5 text-slate-700 leading-relaxed">
            <b class="text-slate-900">인증키 받는 방법 (무료 · 한 번만)</b>
            <ol class="list-decimal pl-5 space-y-1">
                <li><a href="${KOSHA_PORTAL}" target="_blank" rel="noopener" class="text-blue-700 font-bold underline">공공데이터포털 — 한국산업안전보건공단_물질안전보건자료 조회 서비스</a>를 엽니다.</li>
                <li>회원가입·로그인 뒤 <b>활용신청</b>을 누릅니다 (활용 목적은 "사내 MSDS 작성·검토"처럼 적으면 됩니다).</li>
                <li>마이페이지 → 데이터 활용 → 그 서비스의 <b>일반 인증키</b>를 복사해 아래에 붙여 넣고 [저장]합니다.</li>
            </ol>
            <p class="text-[11px] text-slate-500">인증키는 서버의 비밀 저장소에만 두고 화면에는 다시 보여 주지 않습니다. 개발 계정은 하루 2,000건까지 조회할 수 있습니다(물질 하나에 9건). 한 번 받은 물질 정보는 저장해 두고 다시 받지 않습니다.</p>
        </div>
        ${isCloud ? `<label class="block"><span class="font-bold text-slate-600">일반 인증키</span>
            <input id="kd-key" type="password" autocomplete="off" placeholder="${isSet ? '새 키로 바꾸려면 붙여 넣으세요 (비워 두고 저장하면 지웁니다)' : '공공데이터포털에서 복사한 인증키'}" class="${INPUT} mt-0.5 font-mono"></label>
        <div id="kd-msg" class="font-bold whitespace-pre-line"></div>` : ''}`,
        footHtml: `<button type="button" data-dlg-close class="${BTN_SUB}">닫기</button>
            ${isCloud ? `<button type="button" id="kd-test" class="${BTN_SUB}"><i data-lucide="plug-zap" class="w-3.5 h-3.5 text-blue-600"></i>연결 확인</button><button type="button" id="kd-save" class="${BTN_PRIMARY}">저장</button>` : ''}`
    });
    if (!isCloud) return;
    const say = (text, ok) => { const m = dlg.$('#kd-msg'); m.className = `font-bold whitespace-pre-line ${ok ? 'text-emerald-700' : 'text-rose-600'}`; m.textContent = text; };
    const test = async () => {
        say('공단 조회 서비스에 연결해 보는 중…', true);
        const r = await testKosha();
        if (r.keySet && r.keyOk) say('✅ 연결되었습니다. CAS 번호를 넣으면 공단 자료를 받아옵니다.', true);
        else if (r.keySet) say(`인증키는 저장되어 있지만 조회가 되지 않습니다.\n${r.message}`, false);
        else say(r.message || '인증키가 없습니다.', false);
        return r;
    };
    dlg.$('#kd-test').addEventListener('click', () => test().catch(e => say(e.message, false)));
    dlg.$('#kd-save').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const key = dlg.$('#kd-key').value.trim();
        if (!key && !isSet) { say('인증키를 붙여 넣으세요.', false); return; }
        if (!key && !confirm('저장된 인증키를 지울까요?')) return;
        btn.disabled = true;
        try {
            const nowSet = await setKoshaKey(key);
            dlg.$('#kd-key').value = '';
            onChanged(nowSet);
            if (!nowSet) { say('인증키를 지웠습니다.', true); showToast('안전보건공단 인증키를 지웠습니다.'); return; }
            const r = await test();
            if (r.keyOk) showToast('✅ 안전보건공단 MSDS 조회를 연결했습니다.');
        } catch (e) { say(e.message, false); } finally { btn.disabled = false; }
    });
};

/** 물질 정보 목록 창 (CAS 번호별로 저장해 둔 분류) */
const openLibraryDialog = async ({ showToast }) => {
    let list = [];
    let q = '';
    const dlg = openDialog({
        title: '물질 정보 (CAS 번호별)', sub: '조회해 저장한 물질의 분류·독성값 — 공급사 MSDS에 맞게 고칠 수 있습니다', maxW: 'max-w-4xl', icon: 'database',
        bodyHtml: `
        <div class="flex flex-wrap items-center gap-2">
            <input type="search" id="lb-q" placeholder="CAS · 물질명 검색" class="${INPUT} !w-56">
            <span id="lb-n" class="text-slate-500"></span>
            <div class="ml-auto flex flex-wrap gap-1.5">
                <input id="lb-cas" placeholder="CAS 번호" class="${INPUT} !w-32 font-mono">
                <button type="button" id="lb-lookup" class="${BTN_SUB}"><i data-lucide="search" class="w-3.5 h-3.5 text-blue-600"></i>조회해 추가</button>
                <button type="button" id="lb-new" class="${BTN_SUB}"><i data-lucide="plus" class="w-3.5 h-3.5"></i>직접 입력</button>
                <button type="button" id="lb-msds" class="${BTN_SUB}" title="원료 MSDS 대장에 적힌 CAS 번호를 한꺼번에 조회해 저장합니다"><i data-lucide="flask-conical" class="w-3.5 h-3.5"></i>원료 MSDS 대장의 CAS 받기</button>
            </div>
        </div>
        <div id="lb-progress" class="text-blue-700 font-bold"></div>
        <div class="border border-slate-200 rounded-xl overflow-x-auto max-h-[58vh] overflow-y-auto"><table class="w-full text-xs min-w-[720px]">
            <thead class="bg-slate-50 text-slate-600 sticky top-0"><tr><th class="p-2 text-left w-[110px]">CAS 번호</th><th class="p-2 text-left w-[26%]">물질명</th><th class="p-2 text-left w-[84px]">출처</th><th class="p-2 text-left">분류</th><th class="p-2 w-[112px]"></th></tr></thead>
            <tbody id="lb-rows"></tbody></table></div>`,
        footHtml: `<button type="button" data-dlg-close class="${BTN_SUB}">닫기</button>`
    });
    const paint = () => {
        const needle = q.trim().toLowerCase();
        const rows = list.filter(s => !needle || `${s.cas} ${s.nameKo} ${s.nameEn} ${s.synonyms}`.toLowerCase().includes(needle));
        dlg.$('#lb-n').textContent = `${rows.length}개${rows.length < list.length ? ` / 전체 ${list.length}개` : ''}`;
        dlg.$('#lb-rows').innerHTML = rows.length ? rows.map(s => `<tr class="border-t border-slate-100 align-top" data-cas="${esc(s.cas)}">
            <td class="p-2 font-mono font-bold">${esc(s.cas)}</td>
            <td class="p-2"><b class="text-slate-800">${esc(s.nameKo || s.nameEn || '')}</b>${s.nameKo && s.nameEn ? `<div class="text-[11px] text-slate-400">${esc(s.nameEn)}</div>` : ''}</td>
            <td class="p-2">${sourceBadge(s.source || 'MANUAL')}</td>
            <td class="p-2">${s.cls?.length ? clsChips(s.cls) : `<span class="${s.unknown ? 'text-rose-600 font-bold' : 'text-slate-400'}">${s.unknown ? '유해성 자료 없음(미상)' : '분류되지 않음'}</span>`}</td>
            <td class="p-2 text-right whitespace-nowrap"><button type="button" data-act="edit" class="${BTN_MINI}">편집</button> <button type="button" data-act="del" class="${BTN_MINI} !text-rose-600">삭제</button></td></tr>`).join('')
            : `<tr><td colspan="5" class="p-8 text-center text-slate-400">${list.length ? '찾는 물질이 없습니다.' : '저장된 물질 정보가 없습니다. CAS 번호를 넣고 [조회해 추가]를 누르세요.'}</td></tr>`;
    };
    const load = async (opt) => { try { list = await listSubstances(opt); paint(); } catch (e) { showToast(e.message); } };
    const edit = (sub, isNew = false) => openSubstanceDialog({
        sub, isNew, showToast,
        onSave: async ({ sub: edited }) => { await saveSubstance(edited); showToast(`물질 정보를 저장했습니다 (${edited.cas}).`); await load(); }
    });
    dlg.$('#lb-q').addEventListener('input', (e) => { q = e.target.value; paint(); });
    dlg.$('#lb-new').addEventListener('click', () => edit(emptySubstance(normCas(dlg.$('#lb-cas').value)), true));
    dlg.$('#lb-lookup').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const cas = normCas(dlg.$('#lb-cas').value);
        if (!isValidCas(cas)) { showToast('CAS 번호를 정확히 넣으세요 (예: 107-21-1).'); return; }
        btn.disabled = true;
        try {
            const res = await lookupSubstance(cas);
            if (res.from === 'NONE') { showToast(`${cas}: 자동으로 찾지 못했습니다. ${res.notes.join(' ')}`); edit(res.sub, true); return; }
            showToast(`${cas} ${res.sub.nameKo || res.sub.nameEn || ''} — ${{ LIBRARY: '이미 저장되어 있습니다', KOSHA: '안전보건공단에서 받았습니다', PUBCHEM: 'PubChem에서 받았습니다' }[res.from]}. ${res.notes.join(' ')}`);
            dlg.$('#lb-cas').value = '';
            await load();
        } catch (e) { showToast(e.message); } finally { btn.disabled = false; }
    });
    dlg.$('#lb-msds').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
            const records = await listQc('MSDS');
            const have = new Set(list.map(s => s.cas));
            const casList = [...new Set(records.flatMap(m => (String(m.casNo || '').match(/\d{2,7}-\d{2}-\d/g) || []).map(normCas)))].filter(cas => isValidCas(cas) && !have.has(cas));
            if (!casList.length) { showToast('새로 받을 CAS 번호가 없습니다 (MSDS 대장의 CAS는 모두 저장되어 있습니다).'); return; }
            if (!confirm(`원료 MSDS 대장에 적힌 CAS 번호 ${casList.length}개의 물질 정보를 받아 저장할까요?\n(안전보건공단 인증키가 있으면 공단 자료, 없으면 PubChem 자료)`)) return;
            let ok = 0;
            for (let i = 0; i < casList.length; i++) {
                dlg.$('#lb-progress').textContent = `받는 중… ${i + 1} / ${casList.length} (${casList[i]})`;
                try { if ((await lookupSubstance(casList[i])).from !== 'NONE') ok += 1; } catch (e) { console.warn('[물질 정보] 조회 실패', casList[i], e.message); }
            }
            dlg.$('#lb-progress').textContent = '';
            showToast(`물질 정보 ${ok}개를 받아 저장했습니다${ok < casList.length ? ` (${casList.length - ok}개는 찾지 못함 — 직접 입력)` : ''}.`);
            await load({ refresh: true });
        } catch (e) { showToast(e.message); } finally { btn.disabled = false; dlg.$('#lb-progress').textContent = ''; }
    });
    dlg.$('#lb-rows').addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) return;
        const sub = list.find(s => s.cas === act.closest('tr').dataset.cas);
        if (act.dataset.act === 'edit') { edit(sub); return; }
        if (!confirm(`${sub.cas} ${sub.nameKo || sub.nameEn || ''}\n이 물질 정보를 지울까요? 이 물질을 쓰는 문서에서는 다시 조회해야 합니다.`)) return;
        try { await deleteSubstance(sub.cas); showToast('물질 정보를 지웠습니다.'); await load(); } catch (err) { showToast(err.message); }
    });
    await load({ refresh: true });
};

/**
 * 혼합물 MSDS 작성 목록을 그린다.
 * @param {HTMLElement} host
 * @param {{ showToast?: (m: string) => void, onPublished?: () => void }} [opt]
 */
export const mountMsdsAuthoring = (host, { showToast = () => {} } = {}) => {
    if (!hasWorklogAccess()) {
        host.innerHTML = `<div class="${CARD} text-sm text-slate-600 flex items-start gap-3">
            <i data-lucide="lock" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5"></i>
            <div><b class="text-slate-900">혼합물 MSDS 작성은 마스터와 작업일지 관리자만 쓸 수 있습니다.</b>
                <p class="mt-1 text-xs leading-relaxed">구성성분의 CAS 번호와 정확한 함유량(배합 자료)을 다루기 때문입니다. 만든 MSDS의 발행본은 <b>제품 MSDS</b> 대장에서 누구나 열람할 수 있습니다.<br>권한이 필요하면 마스터 관리자에게 '작업일지 관리자' 지정을 요청하세요 (환경설정 → 계정).</p></div></div>`;
        refreshIcons();
        return;
    }
    let docs = [];
    let q = '';
    let hasKey = null; // 공단 인증키 설정 여부 (null = 확인 중)

    host.innerHTML = `
    <div class="${CARD} space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="file-plus-2" class="w-4 h-4 text-blue-600"></i>혼합물 MSDS 작성 <span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-black">배합 자료 · 마스터·작업일지 관리자</span></h3>
                <p class="text-xs text-slate-500 mt-1 leading-relaxed">구성성분의 <b>CAS 번호와 함유량</b>을 넣으면 혼합물의 GHS 분류·그림문자·신호어·유해·위험 문구·예방조치 문구를 계산해 MSDS 16개 항목을 만듭니다 (${esc(GHS_NOTICE)} 별표 1·2·4).</p>
            </div>
            <div class="flex flex-wrap gap-2">
                <button type="button" id="ma-new" class="${BTN_PRIMARY}"><i data-lucide="plus" class="w-4 h-4"></i>새 MSDS 작성</button>
                <button type="button" id="ma-lib" class="${BTN_SUB}"><i data-lucide="database" class="w-4 h-4 text-slate-500"></i>물질 정보</button>
                <button type="button" id="ma-kosha" class="${BTN_SUB}"><i data-lucide="key-round" class="w-4 h-4 text-slate-500"></i>공단 연동 <span id="ma-kosha-state"></span></button>
            </div>
        </div>
        <div id="ma-key-note"></div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <input type="search" id="ma-q" placeholder="제품명 검색" class="${INPUT} !w-56">
            <span id="ma-n" class="text-slate-500"></span>
        </div>
    </div>
    <div id="ma-list" class="mt-4"></div>
    <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 leading-relaxed">
        <b class="text-slate-800">꼭 확인하세요</b>
        <ul class="list-disc pl-5 mt-1 space-y-0.5">
            <li>이 기능은 <b>MSDS 초안</b>을 만드는 도구입니다. 조회한 물질 분류(공단·PubChem)는 참고 자료이며, MSDS 작성과 내용에 대한 책임은 제조·수입자에게 있습니다(산업안전보건법 제110조). 공급사 MSDS·제품 시험 자료로 확인한 뒤 발행하세요.</li>
            <li>제품 전체로 시험한 자료(인화점·동점도·pH, 독성 시험 등)가 있으면 그 결과가 계산보다 우선입니다.</li>
            <li>MSDS를 제공하기 전에 공단 MSDS 시스템(msds.kosha.or.kr)에 제출하고, 구성성분을 영업비밀로 감추려면 대체자료 기재 승인을 받아야 합니다.</li>
        </ul>
    </div>`;
    const $ = (s) => host.querySelector(s);

    const paintKey = () => {
        $('#ma-kosha-state').innerHTML = hasKey === null ? '' : hasKey ? '<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px]">연결됨</span>' : '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">미설정</span>';
        $('#ma-key-note').innerHTML = hasKey === false ? `<div class="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            <b>안전보건공단 연동이 아직 설정되지 않았습니다.</b> 지금은 PubChem(외국 자료 — 석유계 기유·고분자 첨가제는 없음)과 직접 입력으로만 물질 정보를 넣을 수 있습니다.
            공단의 국내 분류·노출기준·법적 규제현황을 자동으로 받으려면 <button type="button" id="ma-kosha2" class="underline font-black">공단 연동</button>에서 무료 인증키를 등록하세요.</div>` : '';
        $('#ma-kosha2')?.addEventListener('click', openKosha);
    };
    const paint = () => {
        const needle = q.trim().toLowerCase();
        const rows = docs.filter(d => !needle || String(d.product?.name || '').toLowerCase().includes(needle));
        $('#ma-n').textContent = `${rows.length}건`;
        $('#ma-list').innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto"><table class="w-full text-xs min-w-[820px]">
            <thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left min-w-[200px]">제품명</th><th class="p-2 text-left w-[190px]">그림문자 · 신호어</th><th class="p-2 text-center w-[70px]">분류</th><th class="p-2 text-center w-[70px]">성분</th>
                <th class="p-2 text-left w-[120px]">개정</th><th class="p-2 text-center w-[70px]">상태</th><th class="p-2 text-left w-[130px]">고친 사람 · 날짜</th><th class="p-2 w-[150px]"></th></tr></thead>
            <tbody>${rows.length ? rows.map(d => {
                const s = d.summary || {};
                return `<tr class="border-t border-slate-100 hover:bg-blue-50/40 cursor-pointer" data-id="${esc(d.id)}">
                    <td class="p-2"><b class="text-slate-900">${esc(d.product?.name || '(제품명 없음)')}</b><div class="text-[10px] font-mono text-slate-400">${esc(d.product?.itemCode || '')}${d.product?.msdsNo ? ` · MSDS 번호 ${esc(d.product.msdsNo)}` : ''}</div></td>
                    <td class="p-2"><span class="inline-flex items-center gap-1 align-middle">${(s.pictograms || []).map(c => `<span title="${esc(PICTOGRAMS[c] || c)}" class="leading-none">${pictogramSvg(c, 26)}</span>`).join('')}</span>
                        ${s.signal ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-black ${s.signal === 'DANGER' ? 'bg-rose-600 text-white' : 'bg-amber-400 text-white'}">${SIGNALS[s.signal]}</span>` : '<span class="text-slate-400">분류 없음</span>'}</td>
                    <td class="p-2 text-center">${s.classes ?? '-'}</td><td class="p-2 text-center">${s.comps ?? (d.comps || []).length}</td>
                    <td class="p-2">Rev.${esc(d.rev?.no || '1')} <span class="text-slate-400">${esc(d.rev?.revDate || '')}</span></td>
                    <td class="p-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${d.status === 'FINAL' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}">${d.status === 'FINAL' ? '확정' : '작성 중'}</span></td>
                    <td class="p-2">${esc(d.updatedBy || d.by || '')}<div class="text-[10px] text-slate-400">${esc(String(d.updatedAt || '').slice(0, 10))}</div></td>
                    <td class="p-2 text-right whitespace-nowrap"><button type="button" data-act="open" class="px-2 py-1 rounded-md bg-slate-800 text-white font-bold">열기</button> <button type="button" data-act="copy" class="${BTN_MINI}" title="성분·특성을 복사해 새 문서를 만듭니다">복제</button> <button type="button" data-act="del" class="${BTN_MINI} !text-rose-600">삭제</button></td></tr>`;
            }).join('') : `<tr><td colspan="8" class="p-10 text-center text-slate-400">${docs.length ? '찾는 문서가 없습니다.' : '작성한 MSDS가 없습니다. [새 MSDS 작성]으로 시작하세요.'}</td></tr>`}</tbody></table></div>`;
    };
    const load = async () => {
        try { docs = await listMsdsDocs(); paint(); } catch (e) { $('#ma-list').innerHTML = `<div class="p-5 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; }
    };
    const openEditor = async (doc) => {
        const supplierDefault = doc ? null : await getSupplierDefault().catch(() => null);
        // 화면이 다시 그려졌어도(host가 문서에서 빠졌어도) 저장 뒤 목록을 새로 받도록 그때그때 지금 화면을 찾는다
        await openMsdsEditor({ doc, supplierDefault, showToast, onSaved: () => window.__msdsAuthoringReload?.(), onClosed: () => window.__msdsAuthoringReload?.() });
    };
    const openKosha = () => openKoshaDialog({ showToast, onChanged: (isSet) => { hasKey = isSet; paintKey(); } });
    window.__msdsAuthoringReload = () => { if (host.isConnected) load(); };

    $('#ma-new').addEventListener('click', () => openEditor(null));
    $('#ma-lib').addEventListener('click', () => openLibraryDialog({ showToast }).catch(e => showToast(e.message)));
    $('#ma-kosha').addEventListener('click', openKosha);
    $('#ma-q').addEventListener('input', (e) => { q = e.target.value; paint(); });
    $('#ma-list').addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const doc = docs.find(d => d.id === tr.dataset.id);
        const act = e.target.closest('[data-act]')?.dataset.act || 'open';
        if (act === 'open') { openEditor(doc); return; }
        if (act === 'copy') {
            const { id: _id, by: _by, updatedBy: _ub, createdAt: _c, updatedAt: _u, summary: _s, ...rest } = JSON.parse(JSON.stringify(doc));
            openEditor({ ...rest, status: 'DRAFT', product: { ...rest.product, name: `${rest.product?.name || ''} (복사)`, itemCode: '', msdsNo: '' }, rev: { no: '1', count: 0, firstDate: localDateStr(), revDate: localDateStr(), prevDate: '' } });
            return;
        }
        if (!confirm(`[${doc.product?.name || ''}] MSDS 작성 문서를 삭제할까요? 되돌릴 수 없습니다.\n(MSDS 대장에 등록한 발행본은 그대로 남습니다)`)) return;
        try { await deleteMsdsDoc(doc.id); showToast('🗑️ MSDS 작성 문서를 삭제했습니다.'); await load(); } catch (err) { showToast(err.message); }
    });
    refreshIcons();
    load();
    (isCloudAuth() ? koshaKeySet() : Promise.resolve(false)).then(v => { hasKey = isCloudAuth() ? v : null; paintKey(); });
};
