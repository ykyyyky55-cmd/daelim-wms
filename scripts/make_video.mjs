// 영상 가이드 만들기: 대본(scripts/video/scenes.mjs) → 음성(한국어 신경망 음성) + 화면(천천히 확대·겹쳐 바뀜) + 자막 → mp4
// 사용법 (daelim-wms 루트):
//   1) npm run build && npm run preview                         (다른 창, http://localhost:4173)
//   2) MANUAL_SET=video MANUAL_OUT=<촬영 폴더> node scripts/capture_manual.mjs   (가짜 예시 데이터 화면 촬영)
//   3) VIDEO_TOOLS=<도구 폴더> VIDEO_SHOTS=<촬영 폴더> VIDEO_OUT=<출력 폴더> node scripts/make_video.mjs intro [guide-…]
// 도구 폴더: 저장소 밖에서 `npm install msedge-tts ffmpeg-static` 한 폴더 (앱 의존성·배포에 넣지 않음).
// 음성은 마이크로소프트 온라인 음성 서비스로 만든다 → 대본 글자만 보낸다 (업무 자료를 대본에 넣지 말 것).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEOS } from './video/scenes.mjs';

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} 환경 변수를 지정하세요.`); return path.resolve(v); };
const TOOLS = need('VIDEO_TOOLS');
const SHOTS = need('VIDEO_SHOTS');
const OUT = need('VIDEO_OUT');
// 중간 파일(음성·그림·장면)은 출력 폴더 밖에 둘 수 있다 (앱에 배포하는 public/manual/video에는 결과만)
const WORK = process.env.VIDEO_WORK ? path.resolve(process.env.VIDEO_WORK) : path.join(OUT, 'work');
const VOICE = process.env.VIDEO_VOICE || 'ko-KR-SunHiNeural';
const RATE = process.env.VIDEO_RATE || '-5%';
const FPS = 30;
const XFADE = 0.6;      // 장면 안 그림이 바뀔 때 겹치는 시간
const LEAD = 0.35;      // 장면 시작 뒤 말을 시작하기까지
const TAIL = 0.9;       // 말이 끝난 뒤 여유
const W = 1920, H = 1080;
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];

const req = createRequire(path.join(TOOLS, 'package.json'));
const FFMPEG = req('ffmpeg-static');
const { MsEdgeTTS, OUTPUT_FORMAT } = await import(pathToFileURL(req.resolve('msedge-tts')).href);
const CHROME = BROWSERS.find(p => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome/Edge를 찾지 못했습니다.');
fs.mkdirSync(OUT, { recursive: true });
['tts', 'img', 'scene'].forEach(d => fs.mkdirSync(path.join(WORK, d), { recursive: true }));

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const run = (args, what) => {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(`${what} 실패:\n${r.stderr}`);
};
const durationOf = (file) => {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
    if (!m) throw new Error(`길이를 읽지 못했습니다: ${file}`);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

// ---------- 음성 (같은 글자는 다시 만들지 않음) ----------
const speak = async (text) => {
    const file = path.join(WORK, 'tts', `${hash(`${VOICE}|${RATE}|${text}`)}.mp3`);
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: RATE });
    const chunks = [];
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('close', res); audioStream.on('error', rej); });
    tts.close();
    fs.writeFileSync(file, Buffer.concat(chunks));
    return file;
};

// ---------- HTML → PNG (카드·스마트폰 틀·자막) ----------
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (p) => pathToFileURL(p).href;
const LOGO_WHITE = fileUrl(path.resolve('public/logo-white.svg'));
const BASE_CSS = `*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Malgun Gothic','맑은 고딕',sans-serif}`;
const BRAND_BG = 'background:radial-gradient(ellipse at 30% 20%,#2f55c4 0%,#1E3C96 45%,#0b1640 100%)';
const phoneHtml = (shot, h) => `<div style="height:${h}px;aspect-ratio:390/844;border:14px solid #0f172a;border-radius:48px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45);background:#fff"><img src="${fileUrl(path.join(SHOTS, `${shot}.png`))}" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
const TEMPLATES = {
    title: () => `<body style="${BRAND_BG};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px;color:#fff">
        <img src="${LOGO_WHITE}" style="height:190px"><div style="font-size:84px;font-weight:800;letter-spacing:-1px">대림오일 스마트 WMS</div>
        <div style="font-size:38px;opacity:.85">생산 · 재고 · 수불 · 품질 · 결재를 하나로</div></body>`,
    end: () => `<body style="${BRAND_BG};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;color:#fff">
        <img src="${LOGO_WHITE}" style="height:160px"><div style="font-size:72px;font-weight:800">대림오일 스마트 WMS</div>
        <div style="font-size:44px;opacity:.9">현장의 일을 더 쉽고 정확하게</div></body>`,
    guideTitle: ({ title, sub }) => `<body style="${BRAND_BG};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;color:#fff">
        <img src="${LOGO_WHITE}" style="height:120px;opacity:.95"><div style="font-size:40px;opacity:.8">영상 가이드</div>
        <div style="font-size:88px;font-weight:800">${esc(title)}</div>${sub ? `<div style="font-size:38px;opacity:.85">${esc(sub)}</div>` : ''}</body>`,
    phone: ({ shot }) => `<body style="background:linear-gradient(135deg,#e8eef8,#c7d4ee);display:flex;align-items:center;justify-content:center">${phoneHtml(shot, 960)}</body>`,
    devices: ({ pc, phone }) => `<body style="background:linear-gradient(135deg,#e8eef8,#c7d4ee);position:relative">
        <div style="position:absolute;left:150px;top:150px;width:1340px;border:18px solid #0f172a;border-bottom-width:40px;border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;background:#fff">
            <img src="${fileUrl(path.join(SHOTS, `${pc}.png`))}" style="width:100%;display:block"></div>
        <div style="position:absolute;left:1340px;top:190px">${phoneHtml(phone, 760)}</div></body>`,
    caption: ({ text }) => `<body style="background:transparent;position:relative">
        <div style="position:absolute;left:50%;bottom:56px;transform:translateX(-50%);max-width:1640px;padding:22px 40px;border-radius:18px;background:rgba(15,23,42,.82);color:#fff;font-size:42px;line-height:1.45;font-weight:700;text-align:center;word-break:keep-all">${esc(text)}</div></body>`
};
const renderHtml = (name, params) => {
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>${TEMPLATES[name](params)}</html>`;
    const out = path.join(WORK, 'img', `${name}-${hash(html)}.png`);
    if (fs.existsSync(out)) return out;
    const src = out.replace(/\.png$/, '.html');
    fs.writeFileSync(src, html);
    const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, '--default-background-color=00000000',
        '--virtual-time-budget=3000', `--screenshot=${out}`, fileUrl(src)], { encoding: 'utf8' });
    if (!fs.existsSync(out)) throw new Error(`그림을 만들지 못했습니다 (${name}): ${r.stderr}`);
    return out;
};
const imageOf = (show, video) => {
    const [kind, arg = ''] = show.includes(':') ? show.split(/:(.*)/s) : ['shot', show];
    if (kind === 'shot') {
        const p = path.join(SHOTS, `${show}.png`);
        if (!fs.existsSync(p)) throw new Error(`촬영 화면이 없습니다: ${p}`);
        return p;
    }
    if (kind === 'card') return arg === 'guide' ? renderHtml('guideTitle', { title: video.title, sub: video.sub }) : renderHtml(arg, {});
    if (kind === 'phone') return renderHtml('phone', { shot: arg });
    if (kind === 'devices') { const [pc, phone] = arg.split('|'); return renderHtml('devices', { pc, phone }); }
    throw new Error(`알 수 없는 장면: ${show}`);
};

// ---------- 장면 하나 → mp4 ----------
// 내레이션은 문장마다 따로 읽고, 자막도 지금 읽는 문장만 보인다 (긴 설명이 화면을 가리지 않게)
const GAP = 0.3; // 문장 사이 쉼
const renderScene = async (video, scene, i) => {
    const sentences = scene.say.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
    const lines = [];
    let t = LEAD;
    for (const text of sentences) {
        const audio = await speak(text);
        const d = durationOf(audio);
        lines.push({ text, audio, start: t, end: t + d });
        t += d + GAP;
    }
    const D = Math.max(t - GAP + TAIL, 3.5);
    const imgs = scene.show.map(s => imageOf(s, video));
    const n = imgs.length;
    const L = (D + (n - 1) * XFADE) / n; // 그림 하나가 보이는 시간 (겹침 포함)
    const args = [];
    imgs.forEach(p => args.push('-loop', '1', '-framerate', String(FPS), '-t', L.toFixed(3), '-i', p));
    const withCaption = scene.caption !== false;
    if (withCaption) lines.forEach(l => args.push('-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(3), '-i', renderHtml('caption', { text: l.text })));
    lines.forEach(l => args.push('-i', l.audio));
    const frames = Math.ceil(L * FPS);
    const f = [];
    imgs.forEach((_, k) => {
        // 천천히 확대(짝수) / 천천히 축소(홀수). 4K로 키운 뒤 잘라 떨림을 줄인다
        const z = k % 2 === 0 ? `1+0.07*on/${frames}` : `1.07-0.07*on/${frames}`;
        f.push(`[${k}:v]scale=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},trim=duration=${L.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[v${k}]`);
    });
    let last = 'v0';
    for (let k = 1; k < n; k++) {
        f.push(`[${last}][v${k}]xfade=transition=fade:duration=${XFADE}:offset=${(k * (L - XFADE)).toFixed(3)}[x${k}]`);
        last = `x${k}`;
    }
    if (withCaption) {
        // 문장 자막: 그 문장을 읽는 동안 ~ 다음 문장 시작 전까지 (마지막은 장면 끝까지)
        lines.forEach((l, k) => {
            const from = k === 0 ? 0 : l.start;
            const to = k === lines.length - 1 ? D : lines[k + 1].start;
            f.push(`[${last}][${n + k}:v]overlay=0:0:enable='between(t,${from.toFixed(3)},${(to - 0.001).toFixed(3)})'[c${k}]`);
            last = `c${k}`;
        });
    }
    f.push(`[${last}]trim=duration=${D.toFixed(3)},fade=t=in:st=0:d=0.35,fade=t=out:st=${(D - 0.35).toFixed(3)}:d=0.35,format=yuv420p[vout]`);
    const a0 = n + (withCaption ? lines.length : 0);
    lines.forEach((l, k) => { const ms = Math.round(l.start * 1000); f.push(`[${a0 + k}:a]aresample=48000,adelay=${ms}|${ms}[a${k}]`); });
    f.push(`${lines.map((_, k) => `[a${k}]`).join('')}amix=inputs=${lines.length}:normalize=0:duration=longest,apad,atrim=0:${D.toFixed(3)},afade=t=out:st=${(D - 0.3).toFixed(3)}:d=0.3[aout]`);
    const out = path.join(WORK, 'scene', `${video.file}-${String(i + 1).padStart(2, '0')}.mp4`);
    run([...args, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-tune', 'stillimage', '-r', String(FPS),
        '-c:a', 'aac', '-b:a', '128k', '-ac', '1', '-ar', '48000', out], `장면 ${i + 1}`);
    console.log(`  장면 ${i + 1}/${video.scenes.length} (${D.toFixed(1)}초)`);
    return { out, D };
};

const makeVideo = async (key) => {
    const video = VIDEOS[key];
    if (!video) throw new Error(`대본에 없는 영상: ${key} (있는 것: ${Object.keys(VIDEOS).join(', ')})`);
    console.log(`▶ ${video.title}`);
    const parts = [];
    for (let i = 0; i < video.scenes.length; i++) parts.push(await renderScene(video, video.scenes[i], i));
    const list = path.join(WORK, `${video.file}-list.txt`);
    fs.writeFileSync(list, parts.map(p => `file '${p.out.replace(/\\/g, '/')}'`).join('\n'));
    const mp4 = path.join(OUT, `${video.file}.mp4`);
    run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', mp4], '합치기');
    // 미리보기 그림: 두 번째 장면 중간 (첫 장면이 제목 카드면 제목 카드)
    const posterAt = parts[0].D * 0.5;
    run(['-ss', posterAt.toFixed(2), '-i', mp4, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', path.join(OUT, `${video.file}.jpg`)], '미리보기 그림');
    const total = parts.reduce((s, p) => s + p.D, 0);
    console.log(`✓ ${mp4} (${Math.floor(total / 60)}분 ${Math.round(total % 60)}초, ${(fs.statSync(mp4).size / 1048576).toFixed(1)}MB)`);
    return { file: video.file, title: video.title, desc: video.desc || '', seconds: Math.round(total), size: fs.statSync(mp4).size };
};

// 목록 videos.json (앱 매뉴얼 → 영상 가이드가 읽음): 대본 순서대로, 이번에 안 만든 영상은 예전 정보 유지
const keys = process.argv.slice(2);
const made = {};
for (const k of (keys.length ? keys : Object.keys(VIDEOS))) made[k] = await makeVideo(k);
const indexFile = path.join(OUT, 'videos.json');
let prev = [];
try { prev = JSON.parse(fs.readFileSync(indexFile, 'utf8')).videos || []; } catch { /* 처음 만듦 */ }
const today = new Date().toISOString().slice(0, 10);
const videos = Object.entries(VIDEOS).map(([k, v]) => (made[k] ? { ...made[k], updated: today } : prev.find(p => p.file === v.file))).filter(Boolean)
    .filter(v => fs.existsSync(path.join(OUT, `${v.file}.mp4`)));
fs.writeFileSync(indexFile, JSON.stringify({ videos }, null, 2));
console.log(`✓ ${indexFile} (${videos.length}편)`);
