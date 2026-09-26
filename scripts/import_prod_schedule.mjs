// 예전 엑셀 '생산스케즐 2026년.xlsx'의 날짜 시트 하나를 생산 스케줄표(wms_production_schedule) INSERT SQL로 바꾼다 (최초 이관용).
// 사용: node scripts/import_prod_schedule.mjs "생산스케즐 2026년.xlsx" 0928 2026-09-28 > out.sql
// 앱의 [엑셀 가져오기]와 같은 해석기(src/services/prodScheduleParse.js)를 쓴다. 결과 SQL은 Supabase SQL Editor 등에서 실행.
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseScheduleSheet, sheetToRows } from '../src/services/prodScheduleParse.js';

const [file, sheetName, sheetDate] = process.argv.slice(2);
if (!file || !sheetName) { console.error('사용: node scripts/import_prod_schedule.mjs <xlsx> <시트명> [YYYY-MM-DD]'); process.exit(1); }
XLSX.set_fs(fs);
const wb = XLSX.readFile(file);
const ws = wb.Sheets[sheetName];
if (!ws) { console.error(`시트 ${sheetName} 없음`); process.exit(1); }
const rows = sheetToRows(XLSX, ws);
const list = parseScheduleSheet(rows, { sheetDate });
const q = (v) => (v === '' || v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (Number(v) ? String(Number(v)) : 'NULL');
const stamp = Date.now();
const values = list.map((r, i) => `(${q(`PS-${stamp}-${String(i + 1).padStart(3, '0')}`)}, ${q(r.site)}, ${q(r.line)}, ${q(r.status)}, ${q(r.orderDate)}, ${q(r.dueText)}, ${q(r.dueDate)}, ${q(r.planText)}, ${q(r.planDate)}, ${q(r.partner)}, ${q(r.manager)}, ${q(r.itemName)}, ${q(r.spec)}, ${n(r.qty)}, ${n(r.perBox)}, ${q(r.container)}, ${q(JSON.stringify(r.materials))}::jsonb, ${r.matsDone}, ${q(r.lotNo)}, ${q(r.notes)}, ${i + 1})`);
console.log(`INSERT INTO public.wms_production_schedule (id, site, line, status, order_date, due_text, due_date, plan_text, plan_date, partner, manager, item_name, spec, qty, per_box, container, materials, mats_done, lot_no, notes, sort_order) VALUES\n${values.join(',\n')};`);
console.error(`${list.length}줄`);
