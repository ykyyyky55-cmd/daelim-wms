import { recordDateInput, bookViewerModal } from './dom.js';
import { getFormattedDateString, getKoreanDayOfWeek } from './utils.js';
import { fetchAllAvailableRecords, fetchSingleRecord } from './recordStore.js';
import { getRecordPagesHtml } from './recordTemplate.js';
import { showHomeScreen, showEditorScreen } from './home.js';
import { getSelectedDates, closeSearchModal } from './search.js';

// ============================================================
// ============================================================
// 책 넘김 바인더 뷰어 (Flipbook / Binder Viewer) 로직 & 5대 추가 기능
// ============================================================
export const bookPageIndicator = document.getElementById('bookPageIndicator');
export const bookBottomIndicator = document.getElementById('bookBottomIndicator');
export const bookDateSelect = document.getElementById('bookDateSelect');
export const btnBookBackHome = document.getElementById('btnBookBackHome');
export const btnBookPrevTop = document.getElementById('btnBookPrevTop');
export const btnBookNextTop = document.getElementById('btnBookNextTop');
export const btnBookPrevSide = document.getElementById('btnBookPrevSide');
export const btnBookNextSide = document.getElementById('btnBookNextSide');
export const btnBookPrevBottom = document.getElementById('btnBookPrevBottom');
export const btnBookNextBottom = document.getElementById('btnBookNextBottom');
export const btnCloseBookViewer = document.getElementById('btnCloseBookViewer');
export const btnBookPrintCurrent = document.getElementById('btnBookPrintCurrent');
export const btnBookPrintAll = document.getElementById('btnBookPrintAll');
export const btnBookEditCurrent = document.getElementById('btnBookEditCurrent');
export const bookLeftPage = document.getElementById('bookLeftPage');
export const bookRightPage = document.getElementById('bookRightPage');
export const bookSpread = document.getElementById('bookSpread');
export const btnOpenBookViewer = document.getElementById('btnOpenBookViewer');
export const btnModalBookView = document.getElementById('btnModalBookView');

// 신규 추가 기능 컨트롤 요소
export const btnBookThumbnails = document.getElementById('btnBookThumbnails');
export const bookThumbnailDrawer = document.getElementById('bookThumbnailDrawer');
export const btnCloseThumbnailDrawer = document.getElementById('btnCloseThumbnailDrawer');
export const inputThumbnailSearch = document.getElementById('inputThumbnailSearch');
export const bookThumbnailList = document.getElementById('bookThumbnailList');

export const btnBookViewMode = document.getElementById('btnBookViewMode');
export const singlePageToggleBar = document.getElementById('singlePageToggleBar');

export const btnBookZoomOut = document.getElementById('btnBookZoomOut');
export const btnBookZoomFit = document.getElementById('btnBookZoomFit');
export const btnBookZoomIn = document.getElementById('btnBookZoomIn');
export const btnBookZoomReset = document.getElementById('btnBookZoomReset');
export const btnBookFullscreen = document.getElementById('btnBookFullscreen');

// 책 넘김 뷰어 상태 변수
let bookRecordList = []; // [{ date: '2026-09-01', data: {...} }, ...]
let bookCurrentIndex = 0;
let bookZoomLevel = 1.0;
let isBookFitMode = true;
let isSinglePageMode = false;
let singlePageSheet = 'front'; // 'front' | 'back'
let isThumbnailDrawerOpen = false;

// 1. 줌 & 화면 맞춤 제어 함수
export function applyBookZoom() {
  if (!bookSpread) return;

  if (isBookFitMode) {
    const bookStage = document.getElementById('bookStage') || document.querySelector('.book-stage');
    if (bookStage) {
      const stageW = bookStage.clientWidth - (isThumbnailDrawerOpen ? 340 : 120);
      const stageH = bookStage.clientHeight - 40;
      const targetW = isSinglePageMode ? 820 : 1660; // A4 단면 vs 양면 펼침 기준 폭
      const targetH = 1140; // A4 높이 기준

      const scaleW = stageW / targetW;
      const scaleH = stageH / targetH;
      bookZoomLevel = Math.min(scaleW, scaleH);
      bookZoomLevel = Math.max(0.35, Math.min(1.4, bookZoomLevel));
    }
  }

  bookSpread.style.transform = `scale(${bookZoomLevel.toFixed(3)})`;
  bookSpread.style.transformOrigin = 'top center';

  if (btnBookZoomFit) {
    btnBookZoomFit.classList.toggle('active', isBookFitMode);
  }
  if (btnBookZoomReset) {
    btnBookZoomReset.classList.toggle('active', !isBookFitMode && Math.abs(bookZoomLevel - 1.0) < 0.05);
  }
}

export function setZoom(level) {
  isBookFitMode = false;
  bookZoomLevel = Math.max(0.35, Math.min(2.0, level));
  applyBookZoom();
}

// 2. 단면 / 양면 보기 전환 토글 함수
export function toggleBookViewMode() {
  isSinglePageMode = !isSinglePageMode;
  if (btnBookViewMode) {
    btnBookViewMode.innerHTML = isSinglePageMode ? '📄 단면 보기' : '📖 양면 보기';
    btnBookViewMode.classList.toggle('active', isSinglePageMode);
  }
  if (singlePageToggleBar) {
    singlePageToggleBar.style.display = isSinglePageMode ? 'flex' : 'none';
  }
  const bookStage = document.getElementById('bookStage');
  if (bookStage) {
    bookStage.classList.toggle('book-single-mode', isSinglePageMode);
  }

  updateSinglePageVisibility();
  applyBookZoom();
}

export function updateSinglePageVisibility() {
  if (!isSinglePageMode) {
    if (bookLeftPage) bookLeftPage.classList.remove('hidden-in-single');
    if (bookRightPage) bookRightPage.classList.remove('hidden-in-single');
    return;
  }

  if (singlePageSheet === 'front') {
    if (bookLeftPage) bookLeftPage.classList.remove('hidden-in-single');
    if (bookRightPage) bookRightPage.classList.add('hidden-in-single');
  } else {
    if (bookLeftPage) bookLeftPage.classList.add('hidden-in-single');
    if (bookRightPage) bookRightPage.classList.remove('hidden-in-single');
  }

  const singleTabs = document.querySelectorAll('.btn-single-sheet-tab');
  singleTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.sheet === singlePageSheet);
  });
}

// 3. 전체화면 전환 토글 함수
export function toggleBookFullscreen() {
  if (!document.fullscreenElement) {
    if (bookViewerModal.requestFullscreen) {
      bookViewerModal.requestFullscreen();
    } else if (bookViewerModal.webkitRequestFullscreen) {
      bookViewerModal.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// 4. 썸네일 목차 서랍 패널 렌더링 및 토글
export function renderThumbnailDrawer(searchFilter = '') {
  if (!bookThumbnailList) return;
  const filter = (searchFilter || '').trim().toLowerCase();

  const filtered = bookRecordList.map((item, idx) => ({ ...item, idx })).filter(item => {
    if (!filter) return true;
    const tag = item.data.isHoliday ? '휴무' : (item.data.status === 'NORMAL' ? '가동' : '미가동');
    const text = `${item.date} ${getKoreanDayOfWeek(item.date)} ${tag} ${item.data.holidayReason || ''}`.toLowerCase();
    return text.includes(filter);
  });

  if (filtered.length === 0) {
    bookThumbnailList.innerHTML = `<div style="text-align:center; padding:30px 10px; color:#94a3b8; font-size:0.85rem;">검색 결과가 없습니다.</div>`;
    return;
  }

  bookThumbnailList.innerHTML = filtered.map(item => {
    const isActive = item.idx === bookCurrentIndex;
    const holidayClass = item.data.isHoliday ? 'holiday' : (item.data.status === 'NORMAL' ? 'normal' : 'idle');
    const holidayTag = item.data.isHoliday ? '🏖️ 휴무' : (item.data.status === 'NORMAL' ? '🟢 가동' : '⚡ 미가동');
    const dayName = getKoreanDayOfWeek(item.date);

    return `
        <div class="book-thumb-item ${isActive ? 'active' : ''}" data-index="${item.idx}">
          <div class="book-thumb-top">
            <span class="book-thumb-date">${item.date} (${dayName})</span>
            <span class="book-thumb-badge ${holidayClass}">${holidayTag}</span>
          </div>
          <div class="book-thumb-bottom">
            <span>페이지 ${item.idx + 1} / ${bookRecordList.length}</span>
            <span style="color:#64748b;">${item.data.isHoliday ? (item.data.holidayReason || '휴무') : (item.data.workHours || '09:00~18:00')}</span>
          </div>
        </div>
      `;
  }).join('');

  bookThumbnailList.querySelectorAll('.book-thumb-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      if (!isNaN(idx)) {
        const dir = idx > bookCurrentIndex ? 'next' : 'prev';
        bookCurrentIndex = idx;
        renderBookSpread(dir);
        highlightActiveThumbnail();
      }
    });
  });
}

export function highlightActiveThumbnail() {
  if (!bookThumbnailList) return;
  bookThumbnailList.querySelectorAll('.book-thumb-item').forEach(el => {
    const idx = parseInt(el.getAttribute('data-index'), 10);
    el.classList.toggle('active', idx === bookCurrentIndex);
  });
}

export function toggleThumbnailDrawer() {
  isThumbnailDrawerOpen = !isThumbnailDrawerOpen;
  if (bookThumbnailDrawer) {
    bookThumbnailDrawer.classList.toggle('hidden', !isThumbnailDrawerOpen);
  }
  if (btnBookThumbnails) {
    btnBookThumbnails.classList.toggle('active', isThumbnailDrawerOpen);
  }
  if (isThumbnailDrawerOpen) {
    renderThumbnailDrawer(inputThumbnailSearch ? inputThumbnailSearch.value : '');
  }
  setTimeout(applyBookZoom, 200);
}

// 5. 인쇄 및 PDF 저장 함수
export function printBookCurrentRecord() {
  if (bookRecordList.length === 0) return;
  const currentItem = bookRecordList[bookCurrentIndex];
  if (!currentItem) return;

  let printArea = document.getElementById('bookPrintArea');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'bookPrintArea';
    document.body.appendChild(printArea);
  }

  const pages = getRecordPagesHtml(currentItem.data, true);
  printArea.innerHTML = pages.frontHtml + pages.backHtml;

  document.body.classList.add('printing-book');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-book');
    if (printArea) printArea.innerHTML = '';
  }, 500);
}

export function printAllBookPages() {
  if (bookRecordList.length === 0) {
    alert('인쇄할 운영기록이 없습니다.');
    return;
  }

  const count = bookRecordList.length;
  const confirmMsg = `총 ${count}개 일자의 운영기록부(총 ${count * 2}페이지)를 일괄 인쇄(PDF 저장)하시겠습니까?\n\n(브라우저 인쇄 창에서 대상을 'PDF로 저장'으로 선택하시면 단일 PDF 파일로 저장됩니다)`;
  if (!confirm(confirmMsg)) return;

  let printArea = document.getElementById('bookPrintArea');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'bookPrintArea';
    document.body.appendChild(printArea);
  }

  let allHtml = '';
  for (const item of bookRecordList) {
    const pages = getRecordPagesHtml(item.data, true);
    allHtml += pages.frontHtml + pages.backHtml;
  }

  printArea.innerHTML = allHtml;
  document.body.classList.add('printing-book');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-book');
    if (printArea) printArea.innerHTML = '';
  }, 1000);
}

// 책 넘김 바인더 뷰어 열기
export async function openBookViewer(specifiedDates = null, initialDate = null) {
  if (!bookViewerModal) return;

  // 1. 전체 가용 운영기록 일괄 로드 및 동기화
  const allRecords = await fetchAllAvailableRecords();
  const recordsMap = new Map(allRecords.map(r => [r.date, r]));

  let targetDates = [];

  // 2. 대상 일자 목록 구성
  if (specifiedDates && specifiedDates.length > 0) {
    targetDates = [...specifiedDates].sort();
  } else {
    targetDates = Array.from(recordsMap.keys()).sort();
  }

  if (targetDates.length === 0) {
    alert('열람할 운영기록이 없습니다. 먼저 기록을 생성하거나 동기화해 주세요.');
    return;
  }

  // 3. 각 일자의 전체 기록 데이터 수집 (누락 일자는 안전 템플릿 생성)
  bookRecordList = [];
  for (const dateStr of targetDates) {
    let rec = recordsMap.get(dateStr);
    if (!rec) {
      rec = await fetchSingleRecord(dateStr);
    }
    if (!rec) {
      // 기록이 없는 경우 기본 휴무/미가동 템플릿 생성
      const d = new Date(dateStr + 'T00:00:00');
      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      rec = {
        date: dateStr,
        formattedDate: getFormattedDateString(dateStr),
        isHoliday: isWeekend,
        holidayReason: isWeekend ? '주말 휴무' : '미가동',
        status: isWeekend ? 'HOLIDAY' : 'IDLE',
        workHours: '09:00 ~ 18:00',
        exhaustList: [
          { id: '1', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
          { id: '2', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
          { id: '3', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
          { id: '4', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' }
        ],
        preventionOperation: { exempt: true, text: '방지시설 면제', rows: [] },
        preventionMaintenance: { rows: [] },
        selfMeasurement: { measureDate: dateStr, rows: [] },
        fuelUsage: '-',
        rawMaterialUsage: '-',
        engineerOpinion: isWeekend ? '주말 휴무로 설비 미가동.' : '특이사항 없음. 정상 가동 대기.',
        technician: { name: '윤경용' }
      };
    }
    bookRecordList.push({ date: dateStr, data: rec });
  }

  if (bookRecordList.length === 0) {
    alert('운영기록 데이터를 불러올 수 없습니다.');
    return;
  }

  // 4. 상단 날짜 선택 드롭다운 채우기
  if (bookDateSelect) {
    bookDateSelect.innerHTML = '';
    bookRecordList.forEach((item, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      const holidayTag = item.data.isHoliday ? '🏖️ 휴무' : (item.data.status === 'NORMAL' ? '🟢 가동' : '⚡ 미가동');
      opt.textContent = `${item.date} (${getKoreanDayOfWeek(item.date)}) - ${holidayTag}`;
      bookDateSelect.appendChild(opt);
    });
  }

  // 5. 초기 펼칠 페이지 인덱스 설정
  let startIdx = 0;
  if (initialDate) {
    const found = bookRecordList.findIndex(item => item.date === initialDate);
    if (found !== -1) startIdx = found;
  } else {
    const curInputVal = recordDateInput.value;
    const found = bookRecordList.findIndex(item => item.date === curInputVal);
    if (found !== -1) startIdx = found;
  }

  bookCurrentIndex = startIdx;
  isBookFitMode = true;
  renderBookSpread();

  // 뷰어 모달 표시 및 초기 줌 자동 계산
  bookViewerModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(applyBookZoom, 150);
}

// 양면 펼침 바인더 현재 페이지 렌더링
export function renderBookSpread(animationDirection = null) {
  if (!bookSpread || bookRecordList.length === 0) return;

  const currentItem = bookRecordList[bookCurrentIndex];
  if (!currentItem) return;

  // 인디케이터 배지 및 드롭다운 동기화
  const indicatorText = `${bookCurrentIndex + 1} / ${bookRecordList.length}`;
  if (bookPageIndicator) bookPageIndicator.textContent = indicatorText;
  if (bookBottomIndicator) bookBottomIndicator.textContent = indicatorText;
  if (bookDateSelect) bookDateSelect.value = bookCurrentIndex;

  // 이전/다음 버튼 활성/비활성화 처리
  const isFirst = bookCurrentIndex === 0;
  const isLast = bookCurrentIndex === bookRecordList.length - 1;
  if (btnBookPrevTop) btnBookPrevTop.disabled = isFirst;
  if (btnBookNextTop) btnBookNextTop.disabled = isLast;
  if (btnBookPrevSide) btnBookPrevSide.disabled = isFirst;
  if (btnBookNextSide) btnBookNextSide.disabled = isLast;
  if (btnBookPrevBottom) btnBookPrevBottom.disabled = isFirst;
  if (btnBookNextBottom) btnBookNextBottom.disabled = isLast;

  // 책 넘김 3D 플립 애니메이션 적용
  bookSpread.classList.remove('flip-animation-next', 'flip-animation-prev');
  if (animationDirection === 'next') {
    void bookSpread.offsetWidth;
    bookSpread.classList.add('flip-animation-next');
  } else if (animationDirection === 'prev') {
    void bookSpread.offsetWidth;
    bookSpread.classList.add('flip-animation-prev');
  }

  // 양면 서식 HTML 주입: 좌측(앞면: 배출시설 운영기록), 우측(뒷면: 자가측정 및 원료연료)
  const pages = getRecordPagesHtml(currentItem.data, false);
  if (bookLeftPage) {
    bookLeftPage.innerHTML = pages.frontHtml;
  }
  if (bookRightPage) {
    bookRightPage.innerHTML = pages.backHtml;
  }

  updateSinglePageVisibility();
  highlightActiveThumbnail();

  const bookStage = document.getElementById('bookStage') || document.querySelector('.book-stage');
  if (bookStage) bookStage.scrollTop = 0;
}

// 이전/다음 페이지 탐색
export function navigateBook(direction) {
  if (direction === 'prev' && bookCurrentIndex > 0) {
    bookCurrentIndex--;
    renderBookSpread('prev');
  } else if (direction === 'next' && bookCurrentIndex < bookRecordList.length - 1) {
    bookCurrentIndex++;
    renderBookSpread('next');
  }
}

// 책 넘김 뷰어 닫기
export function closeBookViewer() {
  if (bookViewerModal) {
    bookViewerModal.style.display = 'none';
    document.body.style.overflow = '';
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (e) {}
    }
  }
}

// 현재 보고 있는 일자를 메인 편집기로 로드하고 뷰어 닫기
export function editBookCurrentRecord() {
  if (bookRecordList.length === 0) return;
  const currentItem = bookRecordList[bookCurrentIndex];
  if (!currentItem) return;

  const targetDate = currentItem.date;
  closeBookViewer();
  showEditorScreen(targetDate);
}

export function bindBookViewerEvents() {
  // 이벤트 리스너 등록
  if (btnBookPrevTop) btnBookPrevTop.addEventListener('click', () => navigateBook('prev'));
  if (btnBookNextTop) btnBookNextTop.addEventListener('click', () => navigateBook('next'));
  if (btnBookPrevSide) btnBookPrevSide.addEventListener('click', () => navigateBook('prev'));
  if (btnBookNextSide) btnBookNextSide.addEventListener('click', () => navigateBook('next'));
  if (btnBookPrevBottom) btnBookPrevBottom.addEventListener('click', () => navigateBook('prev'));
  if (btnBookNextBottom) btnBookNextBottom.addEventListener('click', () => navigateBook('next'));

  if (btnCloseBookViewer) btnCloseBookViewer.addEventListener('click', closeBookViewer);
  if (btnBookPrintCurrent) btnBookPrintCurrent.addEventListener('click', printBookCurrentRecord);
  if (btnBookPrintAll) btnBookPrintAll.addEventListener('click', printAllBookPages);
  if (btnBookEditCurrent) btnBookEditCurrent.addEventListener('click', editBookCurrentRecord);

  // 줌 컨트롤 리스너
  if (btnBookZoomOut) btnBookZoomOut.addEventListener('click', () => setZoom(bookZoomLevel - 0.1));
  if (btnBookZoomIn) btnBookZoomIn.addEventListener('click', () => setZoom(bookZoomLevel + 0.1));
  if (btnBookZoomReset) btnBookZoomReset.addEventListener('click', () => setZoom(1.0));
  if (btnBookZoomFit) btnBookZoomFit.addEventListener('click', () => { isBookFitMode = true; applyBookZoom(); });

  // 단면/양면 보기 토글 및 단면 탭 리스너
  if (btnBookViewMode) btnBookViewMode.addEventListener('click', toggleBookViewMode);
  document.querySelectorAll('.btn-single-sheet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      singlePageSheet = tab.dataset.sheet || 'front';
      updateSinglePageVisibility();
    });
  });

  // 전체화면 토글 리스너
  if (btnBookFullscreen) btnBookFullscreen.addEventListener('click', toggleBookFullscreen);
  document.addEventListener('fullscreenchange', () => {
    if (btnBookFullscreen) {
      const isFs = !!document.fullscreenElement;
      btnBookFullscreen.innerHTML = isFs ? '⛶ 창모드' : '⛶ 전체화면';
      btnBookFullscreen.classList.toggle('active', isFs);
    }
    setTimeout(applyBookZoom, 150);
  });

  // 썸네일 목차 서랍 리스너
  if (btnBookThumbnails) btnBookThumbnails.addEventListener('click', toggleThumbnailDrawer);
  if (btnCloseThumbnailDrawer) btnCloseThumbnailDrawer.addEventListener('click', toggleThumbnailDrawer);
  if (inputThumbnailSearch) {
    inputThumbnailSearch.addEventListener('input', (e) => {
      renderThumbnailDrawer(e.target.value);
    });
  }

  // 창 크기 변경 시 맞춤 줌 자동 재계산
  window.addEventListener('resize', () => {
    if (bookViewerModal && bookViewerModal.style.display === 'flex' && isBookFitMode) {
      applyBookZoom();
    }
  });

  // 책 뷰어 상단 [🏠 홈으로] 버튼
  if (btnBookBackHome) {
    btnBookBackHome.addEventListener('click', () => {
      closeBookViewer();
      showHomeScreen();
    });
  }

  if (bookDateSelect) {
    bookDateSelect.addEventListener('change', (e) => {
      const newIdx = parseInt(e.target.value, 10);
      if (!isNaN(newIdx) && newIdx >= 0 && newIdx < bookRecordList.length) {
        const dir = newIdx > bookCurrentIndex ? 'next' : 'prev';
        bookCurrentIndex = newIdx;
        renderBookSpread(dir);
      }
    });
  }

  // 키보드 방향키, PageUp/PageDown 책장 넘김 및 ESC 닫기 단축키
  window.addEventListener('keydown', (e) => {
    if (bookViewerModal && bookViewerModal.style.display === 'flex') {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        navigateBook('prev');
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        navigateBook('next');
      } else if (e.key === 'Home') {
        e.preventDefault();
        bookCurrentIndex = 0;
        renderBookSpread('prev');
      } else if (e.key === 'End') {
        e.preventDefault();
        bookCurrentIndex = bookRecordList.length - 1;
        renderBookSpread('next');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeBookViewer();
      }
    }
  });

  // 헤더 [📖 책 넘김 뷰어] 버튼 클릭 이벤트
  if (btnOpenBookViewer) {
    btnOpenBookViewer.addEventListener('click', () => {
      openBookViewer(null, recordDateInput.value);
    });
  }

  // 검색 모달 내 [📖 책 넘김 뷰어로 열기] 버튼 클릭 이벤트
  if (btnModalBookView) {
    btnModalBookView.addEventListener('click', () => {
      const selectedDates = getSelectedDates();
      if (selectedDates.length === 0) {
        alert('책 넘김 뷰어로 열람할 일자를 하나 이상 선택해 주세요.');
        return;
      }
      closeSearchModal();
      openBookViewer(selectedDates, selectedDates[0]);
    });
  }
}
