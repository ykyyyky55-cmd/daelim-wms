// ==========================================
// 제조시방서 폴더 일괄 가져오기 규칙 (화면 없이 쓰는 순수 함수)
// ==========================================
// - 분류 = 고른 폴더 바로 아래 폴더 이름(끝의 '(2023.1.30)' 같은 날짜 제외)
// - 종류 = 그 아래 가장 깊은 폴더 이름('기존', '기존 (참고)', '신규 (…)', '04_기타' 같은 보관용 폴더는 건너뜀)
// - 내용(제품명·리비전·원료·배합)이 같은 파일은 하나만 등록 (기존 폴더가 아닌 것 → 최근 수정 파일 우선)
// - 이미 등록된 시방서(같은 파일 이름 또는 같은 제품명·리비전)는 다시 등록하지 않고 분류·종류만 폴더에 맞춘다
// - 제품명·리비전이 같은데 내용이 다른 파일: 파일 이름의 Rev(_Rev01_240627)가 다르면 그 Rev를 쓰고,
//   그래도 겹치면 변형 제품(거품감소·소진용 등)으로 보고 파일 이름을 제품명으로 쓴다
// 배합 자료를 저장하지 않고 판정만 한다.

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const nz = (s) => norm(s).replace(/\s+/g, '');

// 리비전 순서: 'Rev.07 (26.03.12)' → 번호 7, 날짜 260312. 번호가 없으면 가장 오래된 것으로 본다.
export const revKey = (r) => {
    const s = String(r?.revision || '');
    const n = s.match(/rev\.?\s*(\d+)/i);
    const d = s.match(/(\d{2})\.(\d{2})\.(\d{2})/);
    return { no: n ? Number(n[1]) : -1, date: d ? Number(d[1] + d[2] + d[3]) : 0, created: r?.createdAt ? Date.parse(r.createdAt) || 0 : Infinity };
};
// a가 b보다 최신이면 양수
export const cmpRev = (a, b) => {
    const x = revKey(a);
    const y = revKey(b);
    return (x.no - y.no) || (x.date - y.date) || (x.created === y.created ? 0 : (x.created > y.created ? 1 : -1));
};

const stripDate = (s) => norm(s).replace(/\s*\(\s*\d{2,4}\.\d{1,2}(\.\d{1,2})?\s*\)\s*$/, '');
const isArchiveFolder = (s) => /^기존/.test(s) || /^신규/.test(s) || /^\d+_기타$/.test(s);

/** 고른 폴더 기준 경로('분류/종류/…/파일.xlsx', 고른 폴더 이름은 뺀 것) → 분류·종류 */
export const folderCategory = (relPath) => {
    const segs = String(relPath).split(/[\\/]/).slice(0, -1).map(norm).filter(Boolean);
    const category = segs.length ? stripDate(segs[0]) : '';
    const sub = segs.slice(1).reverse().find(s => !isArchiveFolder(s));
    return {
        category,
        subCategory: sub ? stripDate(sub).replace(/(\d+W)\s+(\d+)/gi, '$1$2') : '', // '5W 30' → '5W30'
        legacy: segs.some(s => /^기존/.test(s))
    };
};

const fileRev = (f) => {
    const m = String(f).match(/_Rev(\d+)\s*[_(]\s*(\d{2})\.?(\d{2})\.?(\d{2})/i);
    return m ? `Rev.${m[1].padStart(2, '0')} (${m[2]}.${m[3]}.${m[4]})` : '';
};
const stemOf = (f) => norm(String(f).replace(/\.(xlsx|xlsm|xls)$/i, '')
    .replace(/_Rev\d+\s*[_(]\s*\d{2}\.?\d{2}\.?\d{2}\)?/i, '')
    .replace(/-\d{6}$/, '')
    .replace(/★/g, ''));

const pk = (x) => `${norm(x.productName)}|${norm(x.revision)}`;
const sig = (x) => pk(x) + '#' + (x.spec.materials || []).map(m => [norm(m.name), m.rawCode, m.liters, m.wtPct].join(':')).join(';');
const groupBy = (list, keyFn) => {
    const m = new Map();
    for (const x of list) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
};

/**
 * @param entries [{ rel, file, mtime(ms), spec }]  spec = parseSpecWorkbook 결과
 * @param existing 이미 등록된 시방서 목록 (secure.recipes)
 * @returns {{ items, dupFiles, skippedForms, changes }}
 *   items: 등록·갱신할 파일 [{ rel, file, mtime, spec, productName, revision, category, subCategory, legacy, existing }]
 *          (existing이 있으면 이미 등록된 시방서 → 분류·종류만 맞춤). 오래된 파일 → 최근 파일 순서.
 */
export const planFolderImport = (entries, existing = []) => {
    const skippedForms = [];
    let list = [];
    for (const e of entries) {
        const cat = folderCategory(e.rel);
        const productName = norm(e.spec.productName);
        if (!cat.category || !productName || productName === '(제품명 없음)') { skippedForms.push(e.rel); continue; }
        list.push({ ...e, ...cat, productName, revision: norm(e.spec.revision) });
    }

    const dupFiles = [];
    const dedupe = (xs) => [...groupBy(xs, sig).values()].map(g => {
        g.sort((a, b) => (a.legacy - b.legacy) || (b.mtime - a.mtime));
        g.slice(1).forEach(d => dupFiles.push(d.rel));
        return g[0];
    });
    list = dedupe(list);

    const changes = [];
    const conflicts = () => [...groupBy(list, pk).values()].filter(g => g.length > 1);
    // ① 파일 이름의 Rev가 시트의 Rev와 다르면 파일 이름 Rev로 (시트를 복사하고 Rev 칸을 안 고친 경우)
    for (const g of conflicts()) {
        for (const x of g) {
            const fr = fileRev(x.file);
            if (fr && fr !== x.revision) { changes.push(`[Rev 보정] ${x.rel}: ${x.revision || '(없음)'} → ${fr}`); x.revision = fr; }
        }
    }
    // ② 그래도 겹치면 변형 제품: 기본형(제품명으로 시작하거나 다른 파일 이름의 앞부분인 가장 짧은 파일 이름)만 제품명 유지
    for (const g of conflicts()) {
        const base = nz(g[0].productName);
        const byLen = [...g].sort((a, b) => stemOf(a.file).length - stemOf(b.file).length);
        const shortest = nz(stemOf(byLen[0].file));
        const keep = byLen.find(x => nz(stemOf(x.file)).startsWith(base))
            || (g.every(x => nz(stemOf(x.file)).startsWith(shortest)) ? byLen[0] : null);
        for (const x of g) {
            if (x === keep) continue;
            const name = stemOf(x.file);
            changes.push(`[제품명 구분] ${x.rel}: ${x.productName} → ${name}`);
            x.productName = name;
        }
    }
    list = dedupe(list);
    for (const g of conflicts()) {
        g.slice(1).forEach(x => {
            const name = `${x.productName} (${stemOf(x.file)})`;
            changes.push(`[제품명 구분] ${x.rel}: ${x.productName} → ${name}`);
            x.productName = name;
        });
    }

    const byFile = new Map(existing.filter(r => r.sourceFile).map(r => [r.sourceFile, r]));
    const byPk = new Map(existing.map(r => [pk(r), r]));
    const items = list
        .map(x => ({ ...x, existing: byFile.get(x.file) || byPk.get(pk(x)) || null }))
        .sort((a, b) => (b.legacy - a.legacy) || (a.mtime - b.mtime));
    return { items, dupFiles, skippedForms, changes };
};

/**
 * 제품별 최종 상태: 가장 최신 리비전(보관함 제외)만 사용, 분류·종류는 최신 리비전의 것으로 통일.
 * @param recipes 같은 화면의 모든 시방서 (새로 등록한 것 포함)
 * @param productNames 대상 제품명 목록
 * @returns 바꿔야 할 것만 [{ recipe, active, category, subCategory }]
 */
export const settleProducts = (recipes, productNames) => {
    const out = [];
    const targets = new Set([...productNames].map(norm));
    for (const group of groupBy(recipes.filter(r => targets.has(norm(r.productName))), r => norm(r.productName)).values()) {
        const pool = group.filter(r => !r.archived);
        const latest = (pool.length ? pool : group).reduce((a, b) => (cmpRev(b, a) > 0 ? b : a));
        const category = latest.category || group.find(r => r.category)?.category || '';
        const subCategory = latest.category ? (latest.subCategory || '') : (group.find(r => r.category)?.subCategory || '');
        for (const r of group) {
            const active = r === latest;
            if (r.active !== active || (r.category || '') !== category || (r.subCategory || '') !== subCategory) {
                out.push({ recipe: r, active, category, subCategory });
            }
        }
    }
    return out;
};
