// 포장작업표준서 편집기(단독 HTML) → WMS용 public/pack-standard/index.html
// 사용: node scripts/build_pack_standard.cjs "<원본 index.html 경로>"
// 원본은 브라우저 localStorage에만 저장하고 비밀번호가 화면에 노출된 단독 앱이라 다음을 바꾼다:
//  1) 기본 양식·예시 문서에 들어 있던 실제 제품·거래처 사양을 빈 칸으로 (앱·저장소가 공개 배포되므로)
//  2) 비밀번호 로그인 대신 WMS 권한(자재 관리자 이상 편집)을 쓰고, 시작할 때 무조건 관리자 모드로 켜던 버그 제거
//  3) 저장·불러오기·삭제·백업/복원을 WMS DB(wms_pack_standards)로 (window.parent.__packStdBridge)
//  4) QR·링크는 WMS 주소(?std=<문서id>#packStandard) — 로그인한 사람만 열림
//  5) 붙여 넣은 큰 사진은 긴 변 1400px JPEG로 줄여 저장 용량을 아낌
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
// 원본 없이 연동 스크립트만 바꿀 때: node scripts/build_pack_standard.cjs --bridge-only
// (만들어 둔 public/pack-standard/index.html에서 연동 스크립트 자리만 새 pack_standard_bridge.js로 바꾼다)
if (src === '--bridge-only') {
    const out = path.join(__dirname, '..', 'public', 'pack-standard', 'index.html');
    const html = fs.readFileSync(out, 'utf8');
    const start = html.indexOf('<script>', html.indexOf('scripts/pack_standard_bridge.js) ====='));
    const end = html.lastIndexOf('    </script>');
    if (start < 0 || end < start) throw new Error('연동 스크립트 자리를 찾지 못함');
    fs.writeFileSync(out, `${html.slice(0, start)}<script>\n${fs.readFileSync(path.join(__dirname, 'pack_standard_bridge.js'), 'utf8')}\n${html.slice(end)}`);
    console.log('연동 스크립트만 바꿈:', out);
    process.exit(0);
}
if (!src) { console.error('원본 index.html 경로를 주세요.'); process.exit(1); }
let t = fs.readFileSync(src, 'utf8');

const rep = (from, to, count = 1) => {
    const n = t.split(from).length - 1;
    if (n !== count) throw new Error(`바꿀 곳 개수가 다름 (${n}/${count}): ${from.slice(0, 80)}`);
    t = t.split(from).join(to);
};

// 1) 기본 양식의 제품 사양 → 빈 칸
rep('id="cell_buyer" oninput="saveState(); updateQRCode();">지티 [GT]</td>', 'id="cell_buyer" oninput="saveState(); updateQRCode();"></td>');
rep('id="cell_product" oninput="saveState(); updateQRCode();">GT Formula 엔진오일 PAO 5W30 1L</td>', 'id="cell_product" oninput="saveState(); updateQRCode();"></td>');
rep('id="cell_category" oninput="saveState(); updateQRCode();">엔진오일</td>', 'id="cell_category" oninput="saveState(); updateQRCode();"></td>');
rep('id="cell_date" oninput="saveState(); updateQRCode();">2026-07-02</td>', 'id="cell_date" oninput="saveState(); updateQRCode();"></td>');
for (const v of ['대성 HDPE 골드사각_GT용', '1L x 12개입', '대성 HDPE 검정(버진캡)', '아래 사진 참조', '없음', '아래 사진 참조(공용) + 식별 스티커', '검정 파렛트', '12박스 4단 적재<br>(12ea x 12box x 4D)', '아웃박스 스티커 배치넘버', 'GT formula 엔진오일 PAO 5W30']) {
    rep(`contenteditable="true" oninput="saveState()">${v}</td>`, 'contenteditable="true" oninput="saveState()"></td>');
}
// 예시 사진(외부 placehold.co, 제품명 글자) → 빈 사진 칸
const EMPTY = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>`;
const before = (t.match(/src="https:\/\/placehold\.co\/[^"]+"/g) || []).length;
if (before !== 6) throw new Error(`예시 사진 개수가 다름: ${before}`);
t = t.replace(/src="https:\/\/placehold\.co\/[^"]+"/g, `src="${EMPTY}" data-empty="true"`);
// 변경 이력 예시 행
rep('oninput="saveState()">2026-07-02</td>', 'oninput="saveState()"></td>');
rep('>최초 작업표준서 제정 및 부자재 양식 등록<', '>최초 제정<');
rep('oninput="saveState()">홍길동</td>', 'oninput="saveState()"></td>');
rep('oninput="saveState()">김관리</td>', 'oninput="saveState()"></td>');

// 예시 문서 목록(실제 거래처·제품명) → 빈 목록
const dd = t.match(/const defaultDocs = \[[\s\S]*?\n\s*\];/);
if (!dd || !/MOBIS/.test(dd[0])) throw new Error('예시 문서 목록을 찾지 못함');
t = t.replace(dd[0], 'const defaultDocs = [];');

// '예시 데이터 불러오기'의 거래처 제품 사양 → 중립 예시
const sr = t.match(/const sampleRows = \[[\s\S]*?\n\s*\];/);
if (!sr || !/MOBIS/.test(sr[0])) throw new Error('예시 시트 데이터를 찾지 못함');
t = t.replace(sr[0], `const sampleRows = [
                ['거래처 [BUYER]', '샘플 거래처', '구분', '엔진오일'],
                ['제품명 [PRODUCT]', '샘플 엔진오일 5W-30 4L', '제품 버전', '2026-01-01'],
                ['1. 용기(BOTTLE)', '4L 사각 용기 (예시)', '주의사항', '라벨 정위치 부착'],
                ['2. 용량(L) X 입수(Bottle)', '4L x 4개입', '식별스티커', '아웃박스 한 면 부착'],
                ['3. 캡(CAP)', '안전캡 (예시)', '', ''],
                ['4. 라벨(LABEL)', '아래 사진 참조', '', ''],
                ['5. 인박스(INNER BOX)', '없음', '', ''],
                ['6. 아웃 박스(OUTTER BOX)', '아래 사진 참조', '', ''],
                ['7. 사용 파렛트', '플라스틱 파렛트 (1100x1100)', '', ''],
                ['8. 박스 파렛트 적재 방법', '1단 8박스 x 5단 (예시)', '', ''],
                ['9. 생산 날짜 표기 방법', '아웃박스 스티커 LOT', '', ''],
                ['10. 사용 원액명', '샘플 원액 (예시)', '', '']
            ];`);
rep("const DEFAULT_ADMIN_PW = 'daelim1234';", "const DEFAULT_ADMIN_PW = ''; // WMS 권한을 쓰므로 사용하지 않음");
rep("let userRole = 'admin';", "let userRole = 'viewer'; // WMS 연동 스크립트가 권한에 맞춰 바꿈");
rep('placeholder="제품명 입력 (예: GT Formula 엔진오일 PAO 5W30 1L)"', 'placeholder="제품명 입력 (예: 샘플 엔진오일 5W30 1L)"');

// 종류(구분)에 엔진코팅제 추가 (자사 제품에 많음), 산업용 윤활유 필터 버튼 추가
rep('<option value="연료첨가제">⚡ 연료첨가제</option>', '<option value="연료첨가제">⚡ 연료첨가제</option>\n                                        <option value="엔진코팅제">🧴 엔진코팅제</option>');
rep(`data-category="연료첨가제" class="cat-filter-btn px-2.5 py-1 rounded-md font-medium text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition shrink-0">첨가제</button>`,
    `data-category="연료첨가제" class="cat-filter-btn px-2.5 py-1 rounded-md font-medium text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition shrink-0">첨가제</button>
                        <button onclick="setCategoryFilter('엔진코팅제')" data-category="엔진코팅제" class="cat-filter-btn px-2.5 py-1 rounded-md font-medium text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition shrink-0">엔진코팅제</button>
                        <button onclick="setCategoryFilter('산업용윤활유')" data-category="산업용윤활유" class="cat-filter-btn px-2.5 py-1 rounded-md font-medium text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition shrink-0">산업용</button>`);

// 구글 폰트에 없는 Pretendard 요청 제거 (매번 400 오류, 글꼴은 목록의 맑은 고딕으로 표시됨)
t = t.replace(/\s*@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Pretendard[^']*'\);/, '');

// 2) 비밀번호 안내 문구 제거, 편집 카드 설명
t = t.replace(/<p class="text-\[11px\] text-slate-400 mt-1\.5">초기 기본 비밀번호:[\s\S]*?<\/p>/, '');
rep('관리자 세션</span>', '자재 관리자 이상</span>');

// 3~5) WMS 연동 스크립트 (원래 함수를 뒤에서 덮어쓴다)
const bridgeJs = fs.readFileSync(path.join(__dirname, 'pack_standard_bridge.js'), 'utf8');
// 원본은 </body></html> 없이 끝나므로(브라우저가 보정) 없으면 끝에 붙이고 닫는 태그를 채운다
let idx = t.lastIndexOf('</body>');
if (idx < 0) { t = `${t.trimEnd()}\n</body>\n</html>\n`; idx = t.lastIndexOf('</body>'); }
t = `${t.slice(0, idx)}\n    <!-- ===== 대림 스마트 WMS 연동 (scripts/pack_standard_bridge.js) ===== -->\n    <style>#btnHeaderLogin, #btnHeaderPwChange, #btnHeaderLogout { display: none !important; }</style>\n    <script>\n${bridgeJs}\n    </script>\n${t.slice(idx)}`;

// 남은 제품·거래처 흔적 검사 (예시 문서 목록은 연동 스크립트가 덮어써 쓰이지 않음)
const out = path.join(__dirname, '..', 'public', 'pack-standard', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, t);
console.log('작성:', out, `${Math.round(t.length / 1024)}KB`);
