// 폼텍 Design Pro 9의 라벨 용지 규격(Formtec.mdb의 TA110/TA120/TA130)을 앱용 JSON으로 변환한다.
// 1) 32비트 PowerShell로 mdb를 JSON으로 내보낸다 (ACE OLEDB는 32비트만 설치되어 있음):
//    C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File scripts\export_formtec_mdb.ps1 -db <Formtec.mdb 복사본> -out <export.json>
//    (원본: 문서\Formtec\DesignPro9\Formtec.mdb)
// 2) node scripts/gen_formtec_labels.cjs <export.json>  → src/data/formtecLabels.json
// 용지 규격(크기·칸 수·여백·간격)만 담는다. 폼텍의 디자인 템플릿·이미지는 가져오지 않는다.
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('사용법: node scripts/gen_formtec_labels.cjs <export.json>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, ''));

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round = (v) => Math.round(v * 100) / 100;
const comps = Object.fromEntries(raw.comps.map(c => [c.COMP_NOXX, c.COMP_NAME]));
const types = Object.fromEntries(raw.types.map(t => [t.TYPE_NOXX, t]));
const SHAPES = { 1: 'rect', 2: 'circle', 3: 'rect', 4: 'rect' };

const out = [];
const skipped = [];
for (const l of raw.labels) {
    const t = types[l.TYPE_NOXX];
    if (!t) { skipped.push(`${l.LABL_NAME}: 분류 없음`); continue; }
    if (num(l.LABL_MIXE)) { skipped.push(`${l.LABL_NAME}: 크기가 섞인 용지`); continue; }
    const sheetW = num(l.SHET_WIDT);
    const sheetH = num(l.SHET_HIGT);
    const across = num(l.LABL_ROWS); // 폼텍 DB는 가로 칸 수를 ROWS, 세로 줄 수를 COLS에 둔다
    const down = num(l.LABL_COLS);
    const ml = num(l.MAGN_LEFT) || 0;
    const mr = num(l.MAGN_RIGT) || 0;
    const mt = num(l.MAGN_TOPX) || 0;
    const mb = num(l.MAGN_BOTM) || 0;
    const gapX = num(l.DIST_ROWS) || 0;
    const gapY = num(l.DIST_COLS) || 0;
    let w = num(l.LABL_WITH);
    let h = num(l.LABL_HIGH);
    // 라벨 크기가 비어 있으면 용지·여백·간격으로 계산
    if (!w && across) w = (sheetW - ml - mr - gapX * (across - 1)) / across;
    if (!h && down) h = (sheetH - mt - mb - gapY * (down - 1)) / down;
    if (!(sheetW > 0 && sheetH > 0 && across > 0 && down > 0 && w > 0 && h > 0)) { skipped.push(`${l.LABL_NAME}: 규격 불완전`); continue; }
    const shape = SHAPES[num(l.LABL_TYPE)] || 'rect';
    out.push({
        code: String(l.LABL_NAME).trim(),
        type: t.TYPE_NAME,
        group: comps[t.COMP_NOXX] || '',
        desc: String(l.LABL_DESC || '').trim(),
        sheet: String(l.SHET_CODE || '').trim(),
        sheetW, sheetH,
        across, down,
        left: ml, top: mt,
        gapX, gapY,
        w: round(w), h: round(h),
        shape: shape === 'rect' && num(l.ROND_WIDT) > 1 ? 'round' : shape,
        radius: num(l.ROND_WIDT) > 1 ? num(l.ROND_WIDT) : (shape === 'rect' && num(l.ROND_WIDT) === 1 ? 2 : 0)
    });
}

// 같은 코드가 여러 분류에 있으면(색상·재질만 다른 경우) 첫 번째만 두고 분류를 합친다
const byCode = new Map();
for (const l of out) {
    const key = `${l.code}|${l.sheetW}|${l.sheetH}|${l.across}|${l.down}|${l.w}|${l.h}`;
    const prev = byCode.get(key);
    if (prev) { if (!prev.types.includes(l.type)) prev.types.push(l.type); continue; }
    const { type, ...rest } = l;
    byCode.set(key, { ...rest, types: [type] });
}
const list = [...byCode.values()];
const dest = path.join(__dirname, '..', 'src', 'data', 'formtecLabels.json');
fs.writeFileSync(dest, JSON.stringify(list));
console.log(`라벨 용지 ${list.length}종 저장 → ${dest}`);
if (skipped.length) console.log(`제외 ${skipped.length}건:\n- ${skipped.join('\n- ')}`);
