// 예전 엑셀 '생산스케즐 2026년.xlsx'의 날짜 시트들을 생산 스케줄표(wms_production_schedule) INSERT SQL로 바꾼다 (최초 이관용).
// 사용: node scripts/import_prod_schedule.mjs "생산스케즐 2026년.xlsx" 0914 [0923] > out.sql
//   시트 이름(MMDD)이 작성일자(sheet_date)가 되고, 연도는 파일 이름의 20XX(없으면 올해)다. 끝 시트를 주면 그 범위의 날짜 시트를 모두 만든다.
// 앱의 [엑셀 가져오기]와 같은 해석기(src/services/prodScheduleParse.js)를 쓴다. 결과 SQL은 Supabase SQL Editor 등에서 실행.
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseScheduleSheet, sheetToRows } from '../src/services/prodScheduleParse.js';

const [file, from, to] = process.argv.slice(2);
if (!file || !from) { console.error('사용: node scripts/import_prod_schedule.mjs <xlsx> <시작 시트 MMDD> [끝 시트 MMDD]'); process.exit(1); }
XLSX.set_fs(fs);
const wb = XLSX.readFile(file);
const year = (file.match(/20\d{2}/) || [String(new Date().getFullYear())])[0];
const names = wb.SheetNames.filter(n => /^\d{4}$/.test(n) && n >= from && n <= (to || from)).sort();
if (!names.length) { console.error(`${from}~${to || from} 날짜 시트 없음`); process.exit(1); }
const q = (v) => (v === '' || v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (Number(v) ? String(Number(v)) : 'NULL');
const stamp = Date.now();
let total = 0;
for (const name of names) {
    const sheetDate = `${year}-${name.slice(0, 2)}-${name.slice(2)}`;
    const list = parseScheduleSheet(sheetToRows(XLSX, wb.Sheets[name]), { sheetDate });
    if (!list.length) continue;
    const values = list.map((r, i) => `(${q(`PS-${stamp}-${name}-${String(i + 1).padStart(3, '0')}`)}, ${q(sheetDate)}, ${q(r.site)}, ${q(r.line)}, ${q(r.status)}, ${q(r.orderDate)}, ${q(r.dueText)}, ${q(r.dueDate)}, ${q(r.planText)}, ${q(r.planDate)}, ${q(r.partner)}, ${q(r.manager)}, ${q(r.itemName)}, ${q(r.spec)}, ${n(r.qty)}, ${n(r.perBox)}, ${q(r.container)}, ${q(JSON.stringify(r.materials))}::jsonb, ${r.matsDone}, ${q(r.lotNo)}, ${q(r.notes)}, ${i + 1})`);
    console.log(`INSERT INTO public.wms_production_schedule (id, sheet_date, site, line, status, order_date, due_text, due_date, plan_text, plan_date, partner, manager, item_name, spec, qty, per_box, container, materials, mats_done, lot_no, notes, sort_order) VALUES\n${values.join(',\n')};`);
    console.error(`${name} → ${sheetDate}: ${list.length}줄`);
    total += list.length;
}
console.error(`합계 ${names.length}장 ${total}줄`);
