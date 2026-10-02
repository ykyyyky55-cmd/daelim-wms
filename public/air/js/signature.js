import { state } from './state.js';
import {
  recordDateInput, technicianName, signInCharge, signManager, signTechnician,
  signModal, modalTitle, btnCloseModal, btnCancelSign, btnClearCanvas,
  btnAutoStamp, btnApplySign, btnRemoveSign, signCanvas
} from './dom.js';
import { markUnsaved } from './saveStatus.js';

const ctx = signCanvas ? signCanvas.getContext('2d') : null;

let currentSignTarget = ''; // 'manager' | 'technician'
let isDrawing = false;

// ============================================================
// 전자결재 렌더링 및 모달 컨트롤
// ============================================================
let currentChargeSign = '';

export function renderSignatures() {
  if (currentChargeSign) {
    signInCharge.innerHTML = `<img src="${currentChargeSign}" class="electronic-sign-img" alt="담당 결재">`;
  } else {
    signInCharge.innerHTML = ``;
  }

  if (state.currentManagerSign) {
    signManager.innerHTML = `<img src="${state.currentManagerSign}" class="electronic-sign-img" alt="부서장 결재">`;
  } else {
    signManager.innerHTML = `<span class="sign-guide no-print">전자결재</span>`;
  }

  if (state.currentTechnicianSign) {
    signTechnician.innerHTML = `<img src="${state.currentTechnicianSign}" class="electronic-sign-img" alt="환경기술인 서명">`;
  } else {
    signTechnician.innerHTML = `<span class="stamp-bracket">(인)</span>`;
  }
}

// 캔버스 초기화
export function clearSignCanvas() {
  if (ctx && signCanvas) {
    ctx.clearRect(0, 0, signCanvas.width, signCanvas.height);
  }
}

// 캔버스 여백을 정밀하게 제거하고 도장/서명 내용만 타이트하게 크롭하는 함수
export function getTrimmedCanvasDataUrl(canvas) {
  const context = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = context.getImageData(0, 0, w, h);
  const data = imgData.data;

  let minX = w, minY = h, maxX = 0, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 15) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasContent = true;
      }
    }
  }

  if (!hasContent) return '';

  // 여백 4px 추가
  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const trimmed = document.createElement('canvas');
  trimmed.width = cropW;
  trimmed.height = cropH;
  const tCtx = trimmed.getContext('2d');
  tCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  return trimmed.toDataURL('image/png');
}

// 전자도장 자동 생성 함수 (관공서/기업 공식 인영 스타일 - 고해상도 확대 규격)
export function drawAutoStamp(nameText) {
  if (!ctx || !signCanvas) return;
  clearSignCanvas();

  const cx = signCanvas.width / 2;
  const cy = signCanvas.height / 2;
  const r = 64; // 기존 50에서 64로 대폭 확대 (지름 128px)

  // 선명하고 붉은 인주 색상
  ctx.strokeStyle = '#dc2626';
  ctx.fillStyle = '#dc2626';

  // 외곽 굵은 원
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 안쪽 가는 원
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.stroke();

  // 상단 반원 텍스트: "전자결재"
  ctx.font = 'bold 13px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('전자결재', cx, cy - 34);

  // 중앙 이름 (예: "윤경용" 또는 "담당")
  ctx.font = 'bold 26px "Noto Sans KR", sans-serif';
  ctx.fillText(nameText, cx, cy + 1);

  // 하단 날짜: YYYY.MM.DD
  const dStr = recordDateInput.value.replace(/-/g, '.');
  ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
  ctx.fillText(dStr, cx, cy + 34);
}

// 모달 열기
export function openSignModal(target) {
  currentSignTarget = target;
  clearSignCanvas();

  if (target === 'manager') {
    modalTitle.textContent = '부서장 전자결재 서명 / 날인';
    btnAutoStamp.textContent = '🔴 부서장 도장 자동 생성 (윤경용)';
  } else if (target === 'charge') {
    modalTitle.textContent = '담당 전자결재 서명 / 날인';
    btnAutoStamp.textContent = '🔴 담당 도장 자동 생성';
  } else {
    modalTitle.textContent = '환경기술인 전자결재 서명 / 날인';
    btnAutoStamp.textContent = '🔴 기술인 도장 자동 생성 (윤경용)';
  }

  signModal.style.display = 'flex';
}

// 모달 닫기
export function closeSignModal() {
  signModal.style.display = 'none';
}

export function bindSignatureEvents() {
  // 캔버스 드로잉 이벤트 (마우스 및 터치)
  if (signCanvas && ctx) {
    function getCanvasPos(e) {
      const rect = signCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (signCanvas.width / rect.width),
        y: (clientY - rect.top) * (signCanvas.height / rect.height)
      };
    }

    function startDraw(e) {
      isDrawing = true;
      const pos = getCanvasPos(e);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1e3a8a'; // 서명 잉크색: 네이비블루
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      e.preventDefault();
    }

    function draw(e) {
      if (!isDrawing) return;
      const pos = getCanvasPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      e.preventDefault();
    }

    function stopDraw() {
      isDrawing = false;
    }

    signCanvas.addEventListener('mousedown', startDraw);
    signCanvas.addEventListener('mousemove', draw);
    signCanvas.addEventListener('mouseup', stopDraw);
    signCanvas.addEventListener('mouseleave', stopDraw);

    signCanvas.addEventListener('touchstart', startDraw, { passive: false });
    signCanvas.addEventListener('touchmove', draw, { passive: false });
    signCanvas.addEventListener('touchend', stopDraw);
  }

  // 전자도장 자동 생성 버튼
  btnAutoStamp.addEventListener('click', () => {
    let name = '윤경용';
    if (currentSignTarget === 'charge') {
      name = '담당';
    } else if (currentSignTarget === 'technician') {
      name = technicianName.value.replace(/\s+/g, '') || '윤경용';
    }
    drawAutoStamp(name);
  });

  // 서명 지우기 버튼
  btnClearCanvas.addEventListener('click', clearSignCanvas);

  // 모달 닫기 버튼들
  btnCloseModal.addEventListener('click', closeSignModal);
  btnCancelSign.addEventListener('click', closeSignModal);

  // 전자결재 승인 적용 버튼 (여백 정밀 크롭 적용)
  btnApplySign.addEventListener('click', () => {
    if (!signCanvas) return;
    const dataUrl = getTrimmedCanvasDataUrl(signCanvas);
    if (!dataUrl) {
      alert('서명을 그리거나 [전자도장 생성]을 클릭해주세요.');
      return;
    }

    if (currentSignTarget === 'manager') {
      state.currentManagerSign = dataUrl;
    } else if (currentSignTarget === 'technician') {
      state.currentTechnicianSign = dataUrl;
    } else if (currentSignTarget === 'charge') {
      currentChargeSign = dataUrl;
    }

    renderSignatures();
    markUnsaved();
    closeSignModal();
  });

  // 결재 삭제 버튼
  btnRemoveSign.addEventListener('click', () => {
    if (currentSignTarget === 'manager') {
      state.currentManagerSign = '';
    } else if (currentSignTarget === 'technician') {
      state.currentTechnicianSign = '';
    } else if (currentSignTarget === 'charge') {
      currentChargeSign = '';
    }

    renderSignatures();
    markUnsaved();
    closeSignModal();
  });

  // 결재란 클릭 이벤트 연결
  signInCharge.addEventListener('click', () => openSignModal('charge'));
  signManager.addEventListener('click', () => openSignModal('manager'));
  signTechnician.addEventListener('click', () => openSignModal('technician'));
}
