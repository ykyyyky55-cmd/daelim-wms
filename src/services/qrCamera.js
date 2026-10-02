// 공용 카메라 QR·바코드 스캐너 (현장 스캔 · 재고실사 · 통합 검색 · LOT 추적 · 검색 등록 · 작업지시서 스캔 공용)
//
// 예전에는 화면마다 html5-qrcode를 따로 켰다. 그 라이브러리는 카메라를 640×480으로 열고
// 화면의 250px 상자만 250×250 그림으로 줄여 해독하므로, QR이 화면 폭의 38% 넘게 차야 읽혔다
// (작은 라벨은 초점이 맞지 않을 만큼 가까이 대야 했음 — 2026-10-02 가상 카메라 화면 측정).
// 여기서는 카메라를 1920×1080으로 열고 가운데 정사각형을 원본 해상도 그대로 해독한다:
//   1) 기기의 BarcodeDetector(안드로이드 Chrome 등)가 있으면 그것으로,
//   2) 없거나 한동안 못 읽으면 ZXing C++(zxing-wasm, 처음 쓸 때만 받음)으로.
// 같은 측정에서 QR이 화면 폭의 8~12%만 되어도 읽힌다(기울임·원근·어두움 포함).
import { createIcons, icons } from './icons.js';

/** @typedef {{ onText: (text: string) => void, once?: boolean, dedupeMs?: number, isAlive?: () => boolean, onStop?: () => void, hint?: string, feedback?: boolean, showToast?: (message: string) => void }} QrCameraOptions */

const CAMERA_KEY = 'daelim_scan_camera'; // 마지막으로 쓴 카메라 (기기별)
const NATIVE_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf', 'data_matrix'];
const WASM_FORMATS = ['QRCode', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA', 'ITF', 'DataMatrix'];
const AIM_RATIO = 0.85; // 해독하는 가운데 정사각형 = 짧은 변의 85%
const MAX_DECODE_SIDE = 1280; // 이보다 큰 화면은 줄여서 해독 (속도)
const FRAME_GAP_MS = 80; // 해독 간격 (초당 12번쯤)
const NATIVE_MISS_MS = 1200; // 기기 해독기가 이만큼 못 읽으면 ZXing도 번갈아 씀

const WASM_RETRY_MS = 5000; // 해독기를 못 받았으면 이만큼 뒤에 다시 받아 본다 (장마다 다시 받지 않게)
let wasmReader = null; // { readBarcodes }
let wasmLoading = null;
/** ZXing C++(wasm) 해독기 — 처음 쓸 때만 받는다 (wasm 파일은 앱과 함께 배포되어 오프라인에서도 캐시로 열림) */
const loadWasmReader = () => {
    if (wasmReader) return Promise.resolve(wasmReader);
    if (wasmLoading) return wasmLoading;
    wasmLoading = Promise.all([
        import('zxing-wasm/reader'),
        import('zxing-wasm/reader/zxing_reader.wasm?url')
    ]).then(([mod, wasm]) => {
        mod.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm.default : prefix + path) } });
        wasmReader = mod;
        return mod;
    }).catch((err) => {
        setTimeout(() => { wasmLoading = null; }, WASM_RETRY_MS);
        throw err;
    });
    return wasmLoading;
};

let nativeDetector; // undefined = 아직 안 봄, null = 없음
const loadNativeDetector = async () => {
    if (nativeDetector !== undefined) return nativeDetector;
    nativeDetector = null;
    if (!('BarcodeDetector' in window)) return null;
    try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (!supported.includes('qr_code')) return null;
        nativeDetector = new window.BarcodeDetector({ formats: NATIVE_FORMATS.filter(f => supported.includes(f)) });
    } catch (err) {
        console.warn('[스캐너] 기기 해독기를 쓸 수 없어 ZXing으로 읽습니다.', err);
    }
    return nativeDetector;
};

/** 그림(ImageData·캔버스·Blob) 하나에서 코드 글자를 읽는다. 못 읽으면 '' */
const decodeWithWasm = async (image) => {
    const reader = await loadWasmReader();
    const found = await reader.readBarcodes(image, { tryHarder: true, tryInvert: true, formats: WASM_FORMATS, maxNumberOfSymbols: 1 });
    return found[0]?.text || '';
};

/** 사진 파일에서 QR·바코드를 읽는다 (카메라를 쓸 수 없는 브라우저용) */
export const decodeImageFile = async (file) => {
    const native = await loadNativeDetector();
    if (native) {
        try {
            const bitmap = await createImageBitmap(file);
            const hit = (await native.detect(bitmap))[0]?.rawValue;
            if (hit) return hit;
        } catch (err) {
            console.warn('[스캐너] 사진을 기기 해독기로 읽지 못해 ZXing으로 읽습니다.', err);
        }
    }
    return decodeWithWasm(file);
};

let audioCtx = null;
/** 읽었을 때의 짧은 소리 + 진동 */
export const scanFeedback = (ok = true) => {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = ok ? 1320 : 300;
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (ok ? 0.12 : 0.3));
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + (ok ? 0.12 : 0.3));
    } catch (err) {
        console.warn('[스캐너] 소리를 낼 수 없습니다.', err);
    }
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
};

const cameraErrorText = (err) => {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return '카메라 권한이 막혀 있습니다. 주소창의 자물쇠 → 카메라를 허용으로 바꾼 뒤 다시 켜 주세요.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return '쓸 수 있는 카메라를 찾지 못했습니다.';
    if (name === 'NotReadableError') return '다른 앱이 카메라를 쓰고 있습니다. 그 앱을 닫고 다시 켜 주세요.';
    return `카메라를 켜지 못했습니다: ${err?.message || err}`;
};

const btnCls = 'tap-compact w-9 h-9 min-w-[36px] rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75';

/**
 * 카메라 스캐너를 만든다. host 안에 영상·조준 틀·도구(손전등·확대·카메라 바꾸기·사진에서 읽기)를 그린다.
 * @param {HTMLElement} host
 * @param {QrCameraOptions} options
 *   onText — 읽은 글자 (같은 글자는 dedupeMs(기본 1.5초) 안에 다시 넘기지 않음)
 *   once — 하나 읽으면 스스로 끔
 *   isAlive — false를 돌려주면 스스로 끔 (화면이 다시 그려져 host가 버려진 경우)
 *   onStop — 꺼졌을 때 (단추 글자 되돌리기 등)
 *   feedback — 읽었을 때 소리·진동 (부르는 화면이 스스로 소리를 내면 false)
 * @returns {{ start: () => Promise<boolean>, stop: () => void, readonly on: boolean }}
 */
export const createQrCamera = (host, options) => {
    const { onText, once = false, dedupeMs = 1500, isAlive, onStop, hint = 'QR·바코드를 네모 안에 맞추세요', feedback = true, showToast } = options;
    let stream = null;
    let track = null;
    let timer = null;
    let watch = null;
    let isBusy = false;
    let isOn = false;
    let last = { text: '', at: 0 };
    let lastHitAt = 0;
    let useWasmNext = false;
    let hasWarned = false; // 해독 실패는 한 번만 기록 (장마다 남기지 않게)
    let devices = [];
    let zoomStep = 0;
    const canvas = document.createElement('canvas');
    const $ = (sel) => host.querySelector(sel);

    const draw = () => {
        host.innerHTML = `
        <div class="relative bg-black rounded-xl overflow-hidden select-none" style="aspect-ratio: 4 / 3; max-height: 62vh;">
            <video class="qc-video w-full h-full object-cover" playsinline muted autoplay></video>
            <div class="qc-aim absolute inset-0 flex items-center justify-center pointer-events-none">
                <div class="qc-box border-2 border-white/90 rounded-2xl" style="height: 78%; aspect-ratio: 1 / 1; box-shadow: 0 0 0 2000px rgba(0,0,0,0.35);"></div>
            </div>
            <div class="absolute top-2 right-2 flex gap-1.5">
                <button type="button" class="qc-torch hidden ${btnCls}" title="손전등" aria-label="손전등"><i data-lucide="flashlight" class="w-4 h-4"></i></button>
                <button type="button" class="qc-zoom hidden ${btnCls} text-[11px] font-black" title="확대" aria-label="확대">1×</button>
                <button type="button" class="qc-switch hidden ${btnCls}" title="카메라 바꾸기" aria-label="카메라 바꾸기"><i data-lucide="switch-camera" class="w-4 h-4"></i></button>
                <label class="${btnCls} cursor-pointer" title="사진에서 읽기" aria-label="사진에서 읽기"><i data-lucide="image" class="w-4 h-4"></i><input type="file" accept="image/*" class="qc-file hidden" /></label>
            </div>
            <div class="qc-status absolute left-0 right-0 bottom-0 px-3 py-1.5 text-[11px] font-bold text-white text-center bg-gradient-to-t from-black/70 to-transparent"></div>
        </div>`;
        createIcons({ icons });
        $('.qc-status').textContent = '카메라를 켜는 중…';
        $('.qc-file').addEventListener('change', onFile);
        $('.qc-torch').addEventListener('click', toggleTorch);
        $('.qc-zoom').addEventListener('click', cycleZoom);
        $('.qc-switch').addEventListener('click', switchCamera);
    };

    const setStatus = (text) => { const el = $('.qc-status'); if (el) el.textContent = text; };

    const flash = () => {
        const box = $('.qc-box');
        if (!box) return;
        box.style.borderColor = '#34d399';
        setTimeout(() => { if (box.isConnected) box.style.borderColor = ''; }, 350);
    };

    const deliver = (text) => {
        const now = Date.now();
        lastHitAt = now;
        if (text === last.text && now - last.at < dedupeMs) return;
        last = { text, at: now };
        flash();
        if (feedback) scanFeedback(true);
        if (once) stop();
        onText(text);
    };

    const openStream = async (deviceId) => {
        const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
        const tries = [
            deviceId ? { ...base, deviceId: { exact: deviceId } } : null,
            { ...base, facingMode: { ideal: 'environment' } },
            true
        ].filter(Boolean);
        let lastError = null;
        for (const video of tries) {
            try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); } catch (err) { lastError = err; }
        }
        throw lastError;
    };

    const setupTrack = async () => {
        track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        // 가까운 라벨에 초점이 따라가게 (지원하는 기기만)
        if (caps.focusMode?.includes('continuous')) {
            try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (err) { console.warn('[스캐너] 연속 초점을 켜지 못했습니다.', err); }
        }
        $('.qc-torch')?.classList.toggle('hidden', !caps.torch);
        $('.qc-zoom')?.classList.toggle('hidden', !(caps.zoom && caps.zoom.max > caps.zoom.min));
        zoomStep = 0;
        try {
            devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        } catch (err) {
            console.warn('[스캐너] 카메라 목록을 읽지 못했습니다.', err);
            devices = [];
        }
        $('.qc-switch')?.classList.toggle('hidden', devices.length < 2);
        const used = track.getSettings?.().deviceId;
        if (used) localStorage.setItem(CAMERA_KEY, used);
    };

    const toggleTorch = async () => {
        if (!track) return;
        const isLit = $('.qc-torch').dataset.on === '1';
        try {
            await track.applyConstraints({ advanced: [{ torch: !isLit }] });
            $('.qc-torch').dataset.on = isLit ? '' : '1';
            $('.qc-torch').classList.toggle('!bg-amber-400', !isLit);
        } catch (err) {
            console.warn('[스캐너] 손전등을 바꾸지 못했습니다.', err);
            setStatus('이 카메라는 손전등을 켤 수 없습니다.');
        }
    };

    // 확대: 1× → 2× → 3× (카메라가 되는 범위 안에서) — 작은 라벨을 멀리서 읽을 때
    const cycleZoom = async () => {
        if (!track) return;
        const caps = track.getCapabilities();
        const steps = [1, 2, 3].map(z => Math.min(caps.zoom.max, Math.max(caps.zoom.min, z))).filter((z, i, a) => a.indexOf(z) === i);
        zoomStep = (zoomStep + 1) % steps.length;
        try {
            await track.applyConstraints({ advanced: [{ zoom: steps[zoomStep] }] });
            $('.qc-zoom').textContent = `${steps[zoomStep]}×`;
        } catch (err) {
            console.warn('[스캐너] 확대를 바꾸지 못했습니다.', err);
        }
    };

    const switchCamera = async () => {
        if (devices.length < 2 || !track) return;
        const current = track.getSettings?.().deviceId;
        const index = devices.findIndex(d => d.deviceId === current);
        const next = devices[(index + 1) % devices.length];
        stream.getTracks().forEach(t => t.stop());
        try {
            stream = await openStream(next.deviceId);
            $('.qc-video').srcObject = stream;
            await setupTrack();
        } catch (err) {
            setStatus(cameraErrorText(err));
        }
    };

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setStatus('사진을 읽는 중…');
        try {
            const text = await decodeImageFile(file);
            if (text) { last = { text: '', at: 0 }; deliver(text); setStatus(hint); return; }
            scanFeedback(false);
            setStatus('사진에서 QR·바코드를 찾지 못했습니다. 코드가 크게 나오게 다시 찍어 주세요.');
        } catch (err) {
            console.warn('[스캐너] 사진 읽기 실패', err);
            setStatus(`사진을 읽지 못했습니다: ${err.message || err}`);
        }
    };

    // 한 장 해독: 가운데 정사각형을 원본 해상도로 잘라 기기 해독기 → (못 읽는 동안) ZXing과 번갈아
    const tick = async () => {
        if (!isOn || isBusy) return;
        const video = $('.qc-video');
        if (!video || video.readyState < 2 || !video.videoWidth) return;
        isBusy = true;
        try {
            const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * AIM_RATIO);
            const out = Math.min(side, MAX_DECODE_SIDE);
            if (canvas.width !== out) { canvas.width = out; canvas.height = out; }
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, out, out);
            const native = await loadNativeDetector();
            const shouldUseWasm = !native || (useWasmNext && Date.now() - lastHitAt > NATIVE_MISS_MS);
            useWasmNext = !useWasmNext;
            let text = '';
            if (shouldUseWasm) text = await decodeWithWasm(ctx.getImageData(0, 0, out, out));
            else text = (await native.detect(canvas))[0]?.rawValue || '';
            if (text && isOn) deliver(text);
        } catch (err) {
            // 한 장을 못 읽은 것은 흔한 일이라 다음 장으로 넘어간다. 해독기를 못 받은 경우만 알린다.
            if (!wasmReader && !nativeDetector) setStatus('해독기를 받지 못했습니다. 인터넷 연결을 확인해 주세요.');
            if (!hasWarned) console.warn('[스캐너] 해독 실패', err);
            hasWarned = true;
        } finally {
            isBusy = false;
        }
    };

    const stop = () => {
        if (!isOn && !stream) return;
        isOn = false;
        clearInterval(timer);
        clearInterval(watch);
        document.removeEventListener('visibilitychange', onVisibility);
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        track = null;
        if (host.isConnected) host.innerHTML = '';
        if (onStop) onStop();
    };

    // 화면을 가리면(다른 앱·탭) 카메라를 놓는다 — 켠 채로 두면 배터리를 쓰고 다른 앱이 카메라를 못 쓴다
    const onVisibility = () => { if (document.hidden) stop(); };

    const start = async () => {
        if (isOn) return true;
        draw();
        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus('이 브라우저는 카메라를 바로 켤 수 없습니다. 오른쪽 위 사진 단추로 QR 사진을 골라 주세요.');
            isOn = true;
            return false;
        }
        try {
            stream = await openStream(localStorage.getItem(CAMERA_KEY) || '');
        } catch (err) {
            const message = cameraErrorText(err);
            setStatus(`${message} (오른쪽 위 사진 단추로 QR 사진을 읽을 수 있습니다)`);
            if (showToast) showToast(`⚠️ ${message}`);
            isOn = true; // 사진에서 읽기는 쓸 수 있게 틀은 남긴다
            return false;
        }
        isOn = true;
        const video = $('.qc-video');
        video.srcObject = stream;
        try { await video.play(); } catch (err) { console.warn('[스캐너] 영상 재생을 시작하지 못했습니다.', err); }
        await setupTrack();
        setStatus(hint);
        lastHitAt = Date.now();
        // 기기 해독기가 없으면 ZXing을 미리 받아 둔다 (첫 해독이 늦지 않게)
        loadNativeDetector().then(native => { if (!native) loadWasmReader().catch(err => { console.warn('[스캐너] ZXing을 받지 못했습니다.', err); setStatus('해독기를 받지 못했습니다. 인터넷 연결을 확인해 주세요.'); }); });
        timer = setInterval(tick, FRAME_GAP_MS);
        watch = setInterval(() => { if (!host.isConnected || (isAlive && !isAlive())) stop(); }, 1000);
        document.addEventListener('visibilitychange', onVisibility);
        return true;
    };

    return { start, stop, get on() { return isOn; } };
};
