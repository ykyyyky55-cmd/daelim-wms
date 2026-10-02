// 예시 데이터(가짜)만 뽑기: scripts/capture_manual.mjs가 로컬 데모 모드에 넣는 demoStorage를 JSON 파일로 저장한다.
//   node scripts/dump_demo_storage.mjs <저장할 파일>
// 개발 서버 화면에서 손으로 확인할 때 쓴다 (브라우저 콘솔에서 그 JSON을 localStorage에 넣고 새로 고침).
// capture_manual.mjs의 앞부분(자료 정의)만 실행하고 브라우저를 띄우는 부분은 실행하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const out = process.argv[2];
if (!out) { console.error('저장할 파일 경로를 주세요.'); process.exit(1); }
const source = fs.readFileSync(new URL('./capture_manual.mjs', import.meta.url), 'utf8');
const end = source.indexOf('const browserPath = ');
if (end < 0) throw new Error('capture_manual.mjs에서 자료 정의의 끝을 찾지 못했습니다.');
const temp = path.join(os.tmpdir(), `wms-demo-${process.pid}.mjs`);
fs.writeFileSync(temp, `${source.slice(0, end)}\nexport { demoStorage };\n`);
try {
    const { demoStorage } = await import(pathToFileURL(temp).href);
    fs.writeFileSync(out, JSON.stringify(demoStorage));
    console.log(`${Object.keys(demoStorage).length}개 키를 ${out}에 저장했습니다.`);
} finally {
    fs.unlinkSync(temp);
}
