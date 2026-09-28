// ==========================================
// 생산입고 ↔ 업무일지 · 초·중·종물 검사 · 포장수율표 연동
// ==========================================
// (1) 생산입고(라인 스캔 집계 QR 입고, 제품생산/입고)를 하면 같은 날짜·거점의
//     업무일지 '제품포장작업'(재고는 이미 들어갔으므로 stockDone — 수불부 반영 때 건너뜀),
//     초·중·종물 검사 작업 줄, 포장수율표 포장 줄(라벨부착이면 라벨작업 줄)에 같이 넣는다. 같은 LOT·제품이 있으면 건너뜀.
// (2) 포장수율표를 저장하면 공정 시간·인원을 업무일지 포장·라벨부착작업의 시간·인원·공수로 채운다.
//     업무일지 작업시간 = 수율표 합계 시간, 총시간(인시) = Σ 공정 시간 × 인원, 인원 = 인시 ÷ 합계 시간(평균), 공수 = 인시 ÷ 7.5
import { getGimpoLogByDate, saveGimpoLog, WORKLOG_SITES } from './db.js';
import { getForm, saveForm, parseDuration } from './workForms.js';

/** 업무일지 거점(GIMPO/HQ) ↔ 양식 작업장 */
export const FORM_SITE_OF = { GIMPO: '김포공장 포장부', HQ: '본사 포장부' };
export const WORKLOG_SITE_OF = Object.fromEntries(Object.entries(FORM_SITE_OF).map(([k, v]) => [v, k]));

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const capOf = (spec) => (/\d\s*(l|ml)/i.test(spec || '') ? String(spec).replace(/\s/g, '') : '');
const codeOfItem = (item) => String(item || '').split(' / ')[0].trim();
const sameProduct = (row, code, name) => {
    const c = codeOfItem(row.item);
    return (code && c === code) || (name && String(row.item || '').includes(name));
};

/**
 * 생산입고 한 건을 업무일지·초중종물·수율표에 같이 반영
 * @param p { kind: 'PACK'|'LABEL', site: 'GIMPO'|'HQ', date, itemCode, itemName, spec, qty, box, lot, line, workers,
 *            workHours, workersCount, rawName, category, prodId }
 * @param opts { worklog: 업무일지 포장 줄(PACK만), inspect: 초중종물(PACK만), yieldForm: 포장수율표 }
 * @returns string[] 반영한 곳 (알림용)
 */
export const reflectProduction = async (p, { worklog = true, inspect = true, yieldForm = true } = {}) => {
    const done = [];
    const formSite = FORM_SITE_OF[p.site];
    const cap = capOf(p.spec);
    const workers = String(p.workers || '').replace(/\s*\(.*\)\s*$/, '').trim();

    // 업무일지 제품포장작업 (라벨부착은 제품생산/입고가 이미 라벨부착작업 줄을 넣음)
    if (worklog && p.kind === 'PACK' && WORKLOG_SITES[p.site]) {
        const log = getGimpoLogByDate(p.date, p.site);
        log.packaging = log.packaging || [];
        if (!log.packaging.some(r => r.lotNo === p.lot && sameProduct(r, p.itemCode, p.itemName))) {
            const h = r2(p.workHours);
            const wc = Number(p.workersCount) || (h ? 1 : 0);
            const tot = r2(h * wc);
            log.packaging.push({
                item: `${p.itemCode} / ${p.itemName}`, spec: p.spec || '', qty: Number(p.qty) || 0, box: Number(p.box) || 0,
                workHours: h, workersCount: wc, totalWorkHours: tot, line: p.line || '', lotNo: p.lot || '',
                category: p.category || '완제품', manHours: r2(tot / 7.5), workers, source: 'prod-inbound', stockDone: true, prodId: p.prodId || ''
            });
            saveGimpoLog(log, p.site);
            done.push(`${WORKLOG_SITES[p.site].name} 업무일지 제품포장작업`);
        }
    }
    if (!formSite) return done;

    // 초·중·종물 검사 및 작업일지 (포장만)
    if (inspect && p.kind === 'PACK') {
        try {
            const f = (await getForm('INSPECT_LOG', formSite, p.date)) || { tol: 2, rows: [], remarks: '' };
            const rows = (f.rows || []).filter(r => r.product || r.itemCode || r.prodLot || r.good);
            if (!rows.some(r => (p.lot && r.prodLot === p.lot && (!r.itemCode || r.itemCode === p.itemCode)))) {
                const last = rows[rows.length - 1] || {};
                rows.push({
                    id: uid(), line: p.line || last.line || '', time: '', workers: workers || last.workers || '', product: p.itemName, itemCode: p.itemCode, cap: cap || last.cap || '1L',
                    rawName: p.rawName || '', rawLot: '', sg: '', std: '', w: { init: ['', '', ''], mid: ['', '', ''], final: ['', '', ''] }, st: { init: 'OK', mid: 'OK', final: 'OK' },
                    prodLot: p.lot || '', good: Number(p.qty) || '', box: Number(p.box) || '', defect: '', defectType: '', note: '', source: 'prod-inbound'
                });
                await saveForm('INSPECT_LOG', formSite, p.date, { ...f, rows });
                done.push('초·중·종물 검사 작업 줄');
            }
        } catch (e) { done.push(`초·중·종물 반영 실패: ${e.message}`); }
    }

    // 포장수율표: 포장 줄 / 라벨작업 줄
    if (yieldForm) {
        try {
            const f = (await getForm('YIELD', formSite, p.date)) || { cond: {}, pack: [], label: [], other: [], remarks: '' };
            if (p.kind === 'LABEL') {
                const label = (f.label || []).filter(r => r.product || r.qty);
                if (!label.some(r => p.lot && r.lot === p.lot)) {
                    label.push({ id: uid(), time: '', people: '', product: p.itemName, itemCode: p.itemCode, cap: cap || '1L', qty: Number(p.qty) || '', manual: '', auto: Number(p.qty) || '', total: '', lot: p.lot || '', source: 'prod-inbound' });
                    await saveForm('YIELD', formSite, p.date, { ...f, label });
                    done.push('포장수율표 라벨작업 줄');
                }
            } else {
                const pack = (f.pack || []).filter(r => r.product || r.itemCode || r.qty);
                if (!pack.some(r => r.itemCode === p.itemCode && (!p.lot || !r.lot || r.lot === p.lot))) {
                    const last = pack[pack.length - 1] || {};
                    pack.push({ id: uid(), line: p.line || last.line || '', product: p.itemName, itemCode: p.itemCode, cap: cap || '1L', qty: Number(p.qty) || '', lot: p.lot || '', steps: {}, defects: [], note: '', source: 'prod-inbound' });
                    await saveForm('YIELD', formSite, p.date, { ...f, pack });
                    done.push('포장수율표 포장 줄');
                }
            }
        } catch (e) { done.push(`포장수율표 반영 실패: ${e.message}`); }
    }
    return done;
};

// ---------- 포장수율표 → 업무일지 시간·인원 ----------
const STEP_KEYS = ['prep', 'fill', 'cap', 'labelManual', 'labelAuto', 'inspect', 'pack', 'clean'];
const packTimes = (r) => {
    const min = STEP_KEYS.reduce((s, k) => s + parseDuration(r.steps?.[k]?.t), 0);
    const manMin = STEP_KEYS.reduce((s, k) => s + parseDuration(r.steps?.[k]?.t) * (Number(r.steps?.[k]?.p) || 0), 0);
    return { hours: r2(min / 60), total: r2(manMin / 60) };
};

/**
 * 수율표 한 장 → 업무일지 포장·라벨부착작업의 시간·인원·공수
 * 업무일지에 같은 제품(·LOT) 줄이 있으면 시간·인원만 바꾸고, 없으면 newRows로 돌려준다(넣을지는 부른 쪽이 확인).
 * @returns { updated: n, newPack: [...], newLabel: [...], site } — 넣기는 applyYieldNewRows
 */
export const syncYieldToWorklog = (doc, formSite, date) => {
    const site = WORKLOG_SITE_OF[formSite];
    if (!site || !WORKLOG_SITES[site]) return { updated: 0, newPack: [], newLabel: [], site: '' };
    const log = getGimpoLogByDate(date, site);
    log.packaging = log.packaging || [];
    log.labeling = log.labeling || [];
    let updated = 0;
    const newPack = [];
    const newLabel = [];
    (doc.pack || []).forEach(r => {
        const { hours, total } = packTimes(r);
        if (!hours || !(r.product || r.itemCode)) return;
        const wc = hours ? r2(total / hours) : 0;
        const row = log.packaging.find(x => sameProduct(x, r.itemCode, r.product) && (!r.lot || !x.lotNo || x.lotNo === r.lot));
        const vals = { workHours: hours, workersCount: wc, totalWorkHours: total, manHours: r2(total / 7.5), yieldSynced: true };
        if (row) { Object.assign(row, vals); if (!row.line && r.line) row.line = r.line; updated += 1; }
        else if (Number(r.qty) > 0) newPack.push({ item: `${r.itemCode || ''} / ${r.product}`.replace(/^ \/ /, ''), spec: r.cap || '', qty: Number(r.qty), box: 0, line: r.line || '', lotNo: r.lot || '', category: '완제품', workers: '', source: 'yield', ...vals });
    });
    (doc.label || []).forEach(r => {
        const hours = r2(parseDuration(r.total) / 60);
        const wc = Number(r.people) || 0;
        if (!hours || !(r.product || r.itemCode)) return;
        const total = r2(hours * (wc || 1));
        const row = log.labeling.find(x => sameProduct(x, r.itemCode, r.product) && (!r.lot || !x.lotNo || x.lotNo === r.lot));
        const vals = { workHours: hours, workersCount: wc || 1, totalWorkHours: total, manHours: r2(total / 7.5), yieldSynced: true };
        if (row) { Object.assign(row, vals); updated += 1; }
        else if (Number(r.qty) > 0) newLabel.push({ item: `${r.itemCode || ''} / ${r.product}`.replace(/^ \/ /, ''), spec: r.cap || '', qty: Number(r.qty), box: 0, line: '라벨', lotNo: r.lot || '', category: '라벨부착', workers: '', source: 'yield', ...vals });
    });
    if (updated) saveGimpoLog(log, site);
    return { updated, newPack, newLabel, site };
};

/** syncYieldToWorklog가 찾지 못한 줄을 업무일지에 새로 넣는다 */
export const applyYieldNewRows = (site, date, newPack, newLabel) => {
    const log = getGimpoLogByDate(date, site);
    log.packaging = [...(log.packaging || []), ...newPack];
    log.labeling = [...(log.labeling || []), ...newLabel];
    saveGimpoLog(log, site);
};

/** 재고 위치 → 업무일지 거점 (본사 → HQ, 그 밖 → GIMPO) */
export const worklogSiteOfLocation = (loc) => (String(loc || '').split(' / ')[0].trim() === '본사' ? 'HQ' : 'GIMPO');
