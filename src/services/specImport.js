// ==========================================
// 제조시방서·작업일지 엑셀 → 제조시방서(배합 레시피) 데이터 변환
// ==========================================
// 대상 양식: 'DLS-QP-113-1(1) 작업일지' 엑셀 (시트 '제조시방서' + '작업일지')
//   - 제조시방서 시트: 원료 실명, L, wt%, KG, SG, 작업표준, 개정 이력, 적용 ODM 제품, 검사 항목
//   - 작업일지 시트: 같은 순번의 원료가 원료코드(보안 코드)로 적혀 있다
// 배합 자료는 보안 대상이므로 이 모듈은 파일 내용을 저장하지 않고 변환만 한다.
// (브라우저에서는 xlsx 모듈을, Node 스크립트에서는 require('xlsx')를 넘겨 쓴다)

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const compact = (v) => String(v ?? '').replace(/\s+/g, '');
const num = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};
const round = (n, d = 6) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

const rowsOf = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

// 행에서 라벨(공백 무시)이 있는 칸을 찾고, 그 오른쪽 첫 값 반환
const valueAfterLabel = (rows, labelRe) => {
    for (const r of rows) {
        for (let c = 0; c < r.length; c++) {
            if (labelRe.test(compact(r[c]))) {
                for (let k = c + 1; k < r.length; k++) {
                    const v = clean(r[k]);
                    if (v) return v;
                }
            }
        }
    }
    return '';
};

const findCell = (rows, re, fromRow = 0) => {
    for (let i = fromRow; i < rows.length; i++) {
        const r = rows[i];
        for (let c = 0; c < r.length; c++) if (re.test(compact(r[c]))) return { row: i, col: c };
    }
    return null;
};

// 원료 표 파싱: '원료명' 머리글 행부터 'S-TOTAL' 행 전까지
const parseMaterialTable = (rows) => {
    const head = findCell(rows, /^원료명$/);
    if (!head) return null;
    const hr = rows[head.row];
    const colOf = (re) => hr.findIndex(v => re.test(compact(v)));
    const cols = {
        seq: colOf(/^순$/),
        name: head.col,
        liters: colOf(/^L$/i),
        wtPct: colOf(/^wt%$/i),
        kg: colOf(/^KG$/i),
        sg: colOf(/^SG$/i),
        std: colOf(/^작업표준$/)
    };
    const materials = [];
    const workStandard = [];
    let totalLiters = null;
    let totalKg = null;
    let endRow = rows.length;
    for (let i = head.row + 1; i < rows.length; i++) {
        const r = rows[i];
        if (/^S-TOTAL$/i.test(compact(r[0]))) {
            totalLiters = num(r[cols.liters]);
            totalKg = cols.kg >= 0 ? num(r[cols.kg]) : null;
            endRow = i;
            break;
        }
        if (cols.std >= 0) {
            const s = clean(r[cols.std]);
            if (s) workStandard.push(s);
        }
        const name = clean(r[cols.name]);
        if (!name) continue;
        materials.push({
            seq: num(r[cols.seq]) ?? materials.length + 1,
            stage: clean(r[0]) || '',
            name,
            liters: round(num(r[cols.liters])),
            wtPct: cols.wtPct >= 0 ? round(num(r[cols.wtPct])) : null,
            kg: cols.kg >= 0 ? round(num(r[cols.kg])) : null,
            sg: cols.sg >= 0 ? num(r[cols.sg]) : null
        });
    }
    return { head, cols, materials, workStandard, totalLiters, totalKg, endRow };
};

// 개정 이력: '나. 작업현황 및 내역' 머리글 칸 아래 글(원료 표 범위 안)
const parseHistory = (rows, table) => {
    const h = findCell(rows, /^나\.작업현황및내역$/);
    if (!h) return [];
    const out = [];
    for (let i = h.row + 1; i < table.endRow; i++) {
        const v = clean(rows[i][h.col]);
        if (!v || /^ODM$/i.test(v)) continue;
        out.push(v.replace(/^㈜\s*/, ''));
    }
    return out;
};

// 적용 ODM 제품 목록: 'ODM' 칸 오른쪽 글을 번호 단위로 나눔
const parseBrands = (rows) => {
    const cell = findCell(rows, /^ODM$/i);
    if (!cell) return [];
    const text = rows[cell.row].slice(cell.col + 1).map(v => String(v ?? '')).join('\n');
    return text.split(/(?:^|\s|\n)(?=\d+\.\s)/)
        .map(s => s.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
};

// 검사 항목: '시험항목' 머리글 두 묶음(왼쪽·오른쪽)
const parseQcItems = (rows) => {
    const h = findCell(rows, /^시험항목$/);
    if (!h) return [];
    const hr = rows[h.row];
    const itemCols = hr.map((v, c) => (/^시험항목$/.test(compact(v)) ? c : -1)).filter(c => c >= 0);
    const stdCols = hr.map((v, c) => (/^검사기준$/.test(compact(v)) ? c : -1)).filter(c => c >= 0);
    const items = [];
    for (let i = h.row + 1; i < rows.length; i++) {
        const r = rows[i];
        if (/작성자/.test(compact(r[0]))) break;
        itemCols.forEach((c, k) => {
            const no = clean(r[c]);
            const item = clean(r[c + 1]);
            if (!no || !item) return;
            items.push({ no, item, standard: clean(r[stdCols[k]]) });
        });
    }
    const order = (s) => '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(s);
    return items.sort((a, b) => order(a.no) - order(b.no));
};

/**
 * 엑셀 워크북 → 제조시방서 객체
 * @returns {{ productName, revision, baseQty, baseUnit, baseLiters, materials, workStandard, history, brands, qcItems, docNo, author, warnings }}
 */
export const parseSpecWorkbook = (XLSX, wb) => {
    const warnings = [];
    const specName = wb.SheetNames.find(n => compact(n).includes('제조시방서')) || wb.SheetNames[0];
    const logName = wb.SheetNames.find(n => compact(n).includes('작업일지') && n !== specName);
    const spec = rowsOf(XLSX, wb.Sheets[specName]);
    const table = parseMaterialTable(spec);
    if (!table || table.materials.length === 0) throw new Error(`'${specName}' 시트에서 원료 표(원료명·L·SG)를 찾지 못했습니다.`);

    // 작업일지 시트의 같은 순번 원료명 = 원료코드
    const codeBySeq = new Map();
    if (logName) {
        const logTable = parseMaterialTable(rowsOf(XLSX, wb.Sheets[logName]));
        (logTable?.materials || []).forEach(m => codeBySeq.set(m.seq, m.name));
    } else {
        warnings.push("'작업일지' 시트가 없어 원료코드를 채우지 못했습니다. 화면에서 직접 입력하세요.");
    }

    const productName = valueAfterLabel(spec, /^1\.제품명$/) || valueAfterLabel(spec, /제품명$/);
    const revision = valueAfterLabel(spec, /관련근거$/);
    const prodQtyText = valueAfterLabel(spec, /^3\.생산량$/);
    const m = prodQtyText.match(/([\d.]+)\s*(.*)/);
    const baseQty = m ? Number(m[1]) : 1;
    const baseUnit = (m && m[2].trim()) || 'D/M';

    const materials = table.materials.map(mt => {
        const rawCode = codeBySeq.get(mt.seq) || '';
        if (!rawCode) warnings.push(`${mt.seq}번 원료 '${mt.name}'의 원료코드가 없습니다.`);
        return { ...mt, rawCode, itemCode: '' };
    });

    const docNoCell = findCell(spec, /^DLS-/i);
    const writtenCell = findCell(spec, /^작성일자/);
    const authorCell = findCell(spec, /^작성자$/);
    let author = '';
    if (authorCell) {
        const r = spec[authorCell.row];
        for (let k = authorCell.col + 1; k < r.length; k++) {
            const v = clean(r[k]);
            if (v && v !== '(인)') { author = v.replace(/\s+/g, ''); break; }
        }
    }

    return {
        productName: productName || '(제품명 없음)',
        revision,
        baseQty: baseQty || 1,
        baseUnit,
        baseLiters: table.totalLiters ?? materials.reduce((s, x) => s + (x.liters || 0), 0),
        baseKg: table.totalKg,
        materials,
        workStandard: table.workStandard,
        history: parseHistory(spec, table),
        brands: parseBrands(spec),
        qcItems: parseQcItems(spec),
        docNo: docNoCell ? clean(spec[docNoCell.row][docNoCell.col]) : '',
        docWrittenDate: writtenCell ? clean(spec[writtenCell.row][writtenCell.col]).replace(/^작성일자\s*/, '') : '',
        author,
        warnings
    };
};
