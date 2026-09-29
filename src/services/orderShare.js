// ==========================================
// 주문관리 공유: 생산요청서·출하요청서를 구글 챗·메일에 붙여 보내기 좋은 글로
// ==========================================
// 구글 챗 글: *굵게* 서식(구글 챗 마크업)과 한 줄에 한 품목. 메일: 표(HTML)로 복사 → 메일 본문에 붙여넣기,
// 또는 메일 앱(mailto)으로 제목·본문(글)을 채워 연다. 서버로 보내는 것은 없다(복사·메일 앱만).
import { esc } from './html.js';
import { state } from './db.js';
import { locationLabel } from './locations.js';

const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const md = (s) => (s ? String(s).slice(5).replace('-', '/') : '');
const specOf = (l) => l.spec || state.master.find(m => m.code === l.code)?.spec || '';
const EXTERNAL = '외부 거래처';
const locText = (loc) => (loc && loc !== EXTERNAL ? locationLabel(loc) : loc || '');

// 단위별 합계 ('1,200 EA · 300 L')
const totals = (lines, unitOf) => {
    const by = {};
    lines.forEach(l => { const u = unitOf(l) || 'EA'; by[u] = (by[u] || 0) + (Number(l.qty) || 0); });
    return Object.entries(by).map(([u, q]) => `${fmt(q)} ${u}`).join(' · ');
};

const mailTable = (head, rows) => `<table style="border-collapse:collapse;font-size:13px;font-family:'Malgun Gothic',sans-serif">
<thead><tr>${head.map(h => `<th style="border:1px solid #94a3b8;background:#f1f5f9;padding:4px 8px;white-space:nowrap">${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="border:1px solid #cbd5e1;padding:4px 8px;${typeof c === 'number' || /^[\d,.]+$/.test(String(c)) && i > 1 ? 'text-align:right' : ''}">${esc(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const mailInfo = (pairs) => `<table style="border-collapse:collapse;font-size:13px;font-family:'Malgun Gothic',sans-serif;margin-bottom:8px">${pairs.filter(p => p[1]).map(([k, v]) => `<tr><th style="text-align:left;padding:2px 10px 2px 0;color:#475569;white-space:nowrap">${esc(k)}</th><td style="padding:2px 0">${esc(String(v))}</td></tr>`).join('')}</table>`;

/** 생산요청서 → { title, subject, text, html } */
export const requestShare = (r) => {
    const raw = r.reqType === 'RAW';
    const label = raw ? '원액생산요청서' : '제품생산요청서';
    const lines = (r.lines || []).filter(l => l.code || l.name);
    const unitOf = (l) => l.unit || (raw ? 'L' : 'EA');
    const dest = raw ? (r.moveTo ? `이동처 ${locationLabel(r.moveTo)}` : '') : (r.partner ? `거래처 ${r.partner}` : '');
    const text = [
        `${raw ? '🛢️' : '📦'} *${label} ${r.docNo || '(미등록)'}*${r.urgent ? ' 🔴긴급' : ''}`,
        `• 요청일 ${r.reqDate || '-'} · 납기 *${r.dueDate || '-'}*${r.planDate ? ` · 생산 예정 ${r.planDate}` : ''}`,
        [dest, r.orderNo ? `주문번호 ${r.orderNo}` : ''].filter(Boolean).length ? `• ${[dest, r.orderNo ? `주문번호 ${r.orderNo}` : ''].filter(Boolean).join(' · ')}` : '',
        `• 생산 거점 ${r.site || '-'} · 요청 ${r.requester || '-'}${r.dept ? `(${r.dept})` : ''}${r.assigneeName ? ` → 담당 ${r.assigneeName}` : ''}`,
        '',
        `*품목 ${lines.length}건* (합계 ${totals(lines, unitOf)})`,
        ...lines.map((l, i) => `${i + 1}) ${l.name || l.code}${specOf(l) ? ` [${specOf(l)}]` : ''}${l.code ? ` (${l.code})` : ''} — *${fmt(l.qty)} ${unitOf(l)}*${l.pack ? ` · ${l.pack}` : ''}${l.perBox ? ` · 입수 ${l.perBox}` : ''}${l.due && l.due !== r.dueDate ? ` · 납기 ${md(l.due)}` : ''}${l.note ? ` · ${l.note}` : ''}`),
        r.reason ? `\n📝 ${r.reason}` : ''
    ].filter(x => x !== '').join('\n').replace(/\n\n\n+/g, '\n\n');
    const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:13px">
<p style="font-size:15px;font-weight:bold;margin:0 0 6px">${esc(label)} ${esc(r.docNo || '')}${r.urgent ? ' <span style="color:#e11d48">[긴급]</span>' : ''}</p>
${mailInfo([['요청일', r.reqDate], ['납기', r.dueDate], ['생산 예정일', r.planDate], [raw ? '이동처' : '거래처', raw ? (r.moveTo ? locationLabel(r.moveTo) : '') : r.partner], ['주문번호', r.orderNo], ['생산 거점', r.site], ['요청', `${r.requester || ''}${r.dept ? ` (${r.dept})` : ''}`], ['담당', r.assigneeName]])}
${mailTable(['No', '품목코드', raw ? '원액명' : '품목명', '규격', '수량', '단위', raw ? '용기·보관' : '포장·용기', ...(raw ? [] : ['입수']), '납기', '비고'],
        lines.map((l, i) => [i + 1, l.code || '', l.name || '', specOf(l), fmt(l.qty), unitOf(l), l.pack || '', ...(raw ? [] : [l.perBox || '']), l.due || r.dueDate || '', l.note || '']))}
<p style="margin:6px 0 0">합계 ${esc(totals(lines, unitOf))}</p>
${r.reason ? `<p style="margin:6px 0 0">요청 사유: ${esc(r.reason)}</p>` : ''}</div>`;
    return { title: `${label} ${r.docNo || ''} 공유`, subject: `[${label}] ${r.docNo || ''} ${dest ? `${dest.replace(/^(거래처|이동처) /, '')} ` : ''}납기 ${r.dueDate || ''}${r.urgent ? ' (긴급)' : ''}`, text, html };
};

/** 출하(출고)요청서 전표 → { title, subject, text, html } */
export const slipShare = (s, { orderNo = '' } = {}) => {
    const items = (s.items || []).filter(i => i.code || i.name);
    const to = s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : locText(s.toLoc);
    const text = [
        `🚚 *출하요청서 ${s.docNo}*${s.shippedAt ? ' ✅출하완료' : ''}`,
        `• 출하일 *${s.date}${s.shipTime ? ` ${s.shipTime}` : ''}* · ${locText(s.fromLoc) || '-'} → *${to}*`,
        [s.transport ? `운송 ${s.transport}` : '', orderNo ? `주문 ${orderNo}` : '', s.assigneeName ? `담당 ${s.assigneeName}` : ''].filter(Boolean).length ? `• ${[s.transport ? `운송 ${s.transport}` : '', orderNo ? `주문 ${orderNo}` : '', s.assigneeName ? `담당 ${s.assigneeName}` : ''].filter(Boolean).join(' · ')}` : '',
        '',
        `*품목 ${items.length}건* (합계 ${totals(items, i => i.unit)})`,
        ...items.map((it, i) => `${i + 1}) ${it.name}${it.spec ? ` [${it.spec}]` : ''}${it.code ? ` (${it.code})` : ''} — *${fmt(it.qty)} ${it.unit || 'EA'}*${it.note ? ` · ${it.note}` : ''}`),
        s.reason ? `\n📝 ${s.reason}` : ''
    ].filter(x => x !== '').join('\n');
    const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:13px">
<p style="font-size:15px;font-weight:bold;margin:0 0 6px">출하요청서 ${esc(s.docNo)}${s.shippedAt ? ' (출하완료)' : ''}</p>
${mailInfo([['출하일', `${s.date}${s.shipTime ? ` ${s.shipTime}` : ''}`], ['출발', locText(s.fromLoc)], ['받는 곳', to], ['운송', s.transport], ['주문번호', orderNo], ['담당', s.assigneeName]])}
${mailTable(['No', '품목코드', '품목명', '규격', '수량', '단위', '비고'], items.map((it, i) => [i + 1, it.code || '', it.name || '', it.spec || '', fmt(it.qty), it.unit || 'EA', it.note || '']))}
<p style="margin:6px 0 0">합계 ${esc(totals(items, i => i.unit))}</p>
${s.reason ? `<p style="margin:6px 0 0">비고: ${esc(s.reason)}</p>` : ''}</div>`;
    return { title: `출하요청서 ${s.docNo} 공유`, subject: `[출하요청서] ${s.docNo} ${to} ${s.date}`, text, html };
};

/** 공유 창: 미리보기 + [구글 챗용 복사] [메일용(표) 복사] [메일 앱으로 열기] */
export const openShareDialog = ({ title, subject, text, html }, { showToast = () => {} } = {}) => {
    document.getElementById('share-dlg')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'share-dlg';
    wrap.className = 'fixed inset-0 z-[80] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4';
    wrap.innerHTML = `
        <div class="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <h3 class="font-black text-slate-900 text-sm">📤 ${esc(title)}</h3>
                <button type="button" id="sd-close" class="p-2 text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
            </div>
            <div class="p-4 space-y-3 overflow-y-auto text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                    <button type="button" data-v="chat" class="sd-view px-3 py-1.5 rounded-lg font-black">구글 챗 글</button>
                    <button type="button" data-v="mail" class="sd-view px-3 py-1.5 rounded-lg font-black">메일 (표)</button>
                </div>
                <textarea id="sd-text" rows="12" class="w-full border border-slate-300 rounded-xl p-3 font-mono text-[12px] leading-relaxed">${esc(text)}</textarea>
                <div id="sd-mail" class="hidden border border-slate-200 rounded-xl p-3 overflow-x-auto bg-white">${html}</div>
                <p class="text-[11px] text-slate-500">구글 챗: <b>복사</b> 후 대화방에 붙여넣으면 *굵게* 서식이 적용됩니다. 메일: <b>표 복사</b> 후 메일 본문에 붙여넣거나, <b>메일 앱 열기</b>로 제목·본문(글)을 채워 엽니다.</p>
            </div>
            <div class="flex flex-wrap gap-2 justify-end px-4 py-3 border-t border-slate-100">
                <button type="button" id="sd-copy-chat" class="px-3 py-2 rounded-lg text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700">💬 구글 챗용 복사</button>
                <button type="button" id="sd-copy-mail" class="px-3 py-2 rounded-lg text-xs font-black bg-blue-600 text-white hover:bg-blue-700">📋 메일용 표 복사</button>
                <button type="button" id="sd-mailto" class="px-3 py-2 rounded-lg text-xs font-black bg-white border border-slate-300 text-slate-700 hover:bg-slate-50">✉️ 메일 앱 열기</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    const close = () => wrap.remove();
    $('#sd-close').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    const paint = (v) => {
        wrap.querySelectorAll('.sd-view').forEach(b => { b.className = `sd-view px-3 py-1.5 rounded-lg font-black ${b.dataset.v === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`; });
        $('#sd-text').classList.toggle('hidden', v !== 'chat');
        $('#sd-mail').classList.toggle('hidden', v !== 'mail');
    };
    wrap.querySelectorAll('.sd-view').forEach(b => b.addEventListener('click', () => paint(b.dataset.v)));
    paint('chat');
    const copyText = async (t) => {
        try { await navigator.clipboard.writeText(t); return true; } catch {
            const ta = $('#sd-text'); ta.classList.remove('hidden'); ta.select();
            try { return document.execCommand('copy'); } catch { return false; }
        }
    };
    $('#sd-copy-chat').addEventListener('click', async () => {
        showToast(await copyText($('#sd-text').value) ? '💬 복사했습니다. 구글 챗 대화방에 붙여넣으세요.' : '⚠️ 복사하지 못했습니다. 글을 직접 선택해 복사하세요.');
    });
    $('#sd-copy-mail').addEventListener('click', async () => {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([$('#sd-text').value], { type: 'text/plain' }) })]);
            showToast('📋 표를 복사했습니다. 메일 본문에 붙여넣으세요.');
        } catch {
            // 표 복사를 못 하는 브라우저: 미리보기를 선택해 복사
            paint('mail');
            const range = document.createRange(); range.selectNodeContents($('#sd-mail'));
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            let ok = false; try { ok = document.execCommand('copy'); } catch { /* 무시 */ }
            showToast(ok ? '📋 표를 복사했습니다. 메일 본문에 붙여넣으세요.' : '⚠️ 표를 복사하지 못했습니다. 미리보기를 직접 선택해 복사하세요.');
        }
    });
    $('#sd-mailto').addEventListener('click', () => {
        // 메일 앱 주소 길이 제한 때문에 본문은 글(구글 챗 서식 * 제거)로, 너무 길면 자른다
        let body = $('#sd-text').value.replace(/\*/g, '');
        if (body.length > 1800) body = `${body.slice(0, 1800)}\n… (이하 생략 — 표 복사로 붙여넣으세요)`;
        window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
    return { close };
};
