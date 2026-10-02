import { recordDateInput, btnSupabaseModal, bookViewerModal } from './dom.js';
import { loadRecord } from './editor.js';
import { fetchAllAvailableRecords } from './recordStore.js';
import { openBookViewer } from './bookViewer.js';
import { openSearchModal } from './search.js';
import { toLocalDateString } from './utils.js';

// ============================================================
// 홈 화면 (Home Portal Dashboard) 및 화면 전환 네비게이션 로직
// ============================================================
export const homeScreen = document.getElementById('homeScreen');
export const editorScreen = document.getElementById('editorScreen');
export const btnBackToHome = document.getElementById('btnBackToHome');
export const btnGoEditorToday = document.getElementById('btnGoEditorToday');
export const btnGoBookViewerAll = document.getElementById('btnGoBookViewerAll');
export const btnGoSearchModal = document.getElementById('btnGoSearchModal');
export const btnHomeOpenSupabaseModal = document.getElementById('btnHomeOpenSupabaseModal');
export const homeSupabaseBadge = document.getElementById('homeSupabaseBadge');

// 홈 빠른 열람 요소들
export const homeQuickDate = document.getElementById('homeQuickDate');
export const btnHomeViewDate = document.getElementById('btnHomeViewDate');
export const homeQuickStart = document.getElementById('homeQuickStart');
export const homeQuickEnd = document.getElementById('homeQuickEnd');
export const btnHomeViewRange = document.getElementById('btnHomeViewRange');
export const btnHomeViewAll = document.getElementById('btnHomeViewAll');

// 홈 대시보드 통계 요소들
export const statTotalCount = document.getElementById('statTotalCount');
export const statLatestDate = document.getElementById('statLatestDate');


// 홈 특정 일자 편집 요소
export const homeEditDate = document.getElementById('homeEditDate');
export const btnGoEditorDate = document.getElementById('btnGoEditorDate');

// 홈 포털 대시보드 화면 표시 함수
export async function showHomeScreen() {
  if (bookViewerModal) bookViewerModal.style.display = 'none';
  if (editorScreen) editorScreen.style.display = 'none';
  if (homeScreen) homeScreen.style.display = 'flex';
  document.body.style.overflow = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await updateHomePortalStats();
}

// 단일 작성 및 편집 화면 표시 함수
export function showEditorScreen(targetDate = null) {
  if (homeScreen) homeScreen.style.display = 'none';
  if (bookViewerModal) bookViewerModal.style.display = 'none';
  if (editorScreen) editorScreen.style.display = 'block';
  document.body.style.overflow = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const dateToLoad = targetDate || recordDateInput.value || toLocalDateString();
  recordDateInput.value = dateToLoad;
  loadRecord(dateToLoad);
}

// 홈 포털 통계 요약 갱신 함수
export async function updateHomePortalStats() {
  // 서버 및 Supabase, localStorage의 모든 기록을 일괄 로드하여 동기화
  const allRecords = await fetchAllAvailableRecords();
  const sortedDates = allRecords.map(r => r.date).sort();
  const count = sortedDates.length;
  const latest = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : toLocalDateString();

  if (statTotalCount) statTotalCount.textContent = `${count} 일`;
  if (statLatestDate) statLatestDate.textContent = latest;
  if (homeQuickDate && !homeQuickDate.value) homeQuickDate.value = latest;
  if (homeEditDate && !homeEditDate.value) homeEditDate.value = latest;
  if (homeQuickStart && !homeQuickStart.value && sortedDates.length > 0) homeQuickStart.value = sortedDates[0];
  if (homeQuickEnd && !homeQuickEnd.value) homeQuickEnd.value = latest;

  // Supabase 연동 배지 상태 동기화
  if (homeSupabaseBadge) {
    if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
      homeSupabaseBadge.textContent = '⚡ WMS 클라우드 연결됨';
      homeSupabaseBadge.style.background = '#10b981';
    } else {
      homeSupabaseBadge.textContent = '⚡ 이 기기에만 저장';
      homeSupabaseBadge.style.background = '#64748b';
    }
  }
}

export function bindHomeEvents() {
  // ============================================================
  // 홈 화면 버튼 이벤트 연결
  // ============================================================
  // 1. [🏠 홈으로] 뒤로가기 버튼
  if (btnBackToHome) {
    btnBackToHome.addEventListener('click', () => {
      showHomeScreen();
    });
  }

  // 2. 홈 카드: [✍️ 운영기록부 작성 / 편집]
  if (btnGoEditorToday) {
    btnGoEditorToday.addEventListener('click', () => {
      showEditorScreen(toLocalDateString());
    });
  }

  // 2-1. 특정 일자 선택 편집
  if (btnGoEditorDate) {
    btnGoEditorDate.addEventListener('click', () => {
      const d = homeEditDate.value;
      if (!d) {
        alert('편집할 일자를 선택해 주세요.');
        return;
      }
      showEditorScreen(d);
    });
  }

  // 3. 홈 카드: [📖 책 뷰어로 전체 열람]
  if (btnGoBookViewerAll) {
    btnGoBookViewerAll.addEventListener('click', () => {
      openBookViewer();
    });
  }

  // 4. 홈 카드: [📑 일괄 검색 및 인쇄 창]
  if (btnGoSearchModal) {
    btnGoSearchModal.addEventListener('click', () => {
      openSearchModal();
    });
  }

  // 5. 홈 상단: [⚡ 클라우드 설정]
  if (btnHomeOpenSupabaseModal && btnSupabaseModal) {
    btnHomeOpenSupabaseModal.addEventListener('click', () => {
      btnSupabaseModal.click();
    });
  }

  // 6. 빠른 일자 선택 열람
  if (btnHomeViewDate) {
    btnHomeViewDate.addEventListener('click', () => {
      const d = homeQuickDate.value;
      if (!d) {
        alert('열람할 일자를 선택해 주세요.');
        return;
      }
      openBookViewer([d], d);
    });
  }

  // 7. 빠른 기간 선택 열람
  if (btnHomeViewRange) {
    btnHomeViewRange.addEventListener('click', () => {
      const start = homeQuickStart.value;
      const end = homeQuickEnd.value;
      if (!start || !end) {
        alert('시작일과 종료일을 모두 선택해 주세요.');
        return;
      }
      if (start > end) {
        alert('시작일은 종료일보다 이전이어야 합니다.');
        return;
      }

      // 지정 기간에 해당하는 모든 일자 추출 (시차 오차 방지)
      const rangeDates = [];
      const [sY, sM, sD] = start.split('-').map(Number);
      const [eY, eM, eD] = end.split('-').map(Number);
      const cur = new Date(sY, sM - 1, sD, 12, 0, 0);
      const endD = new Date(eY, eM - 1, eD, 12, 0, 0);
      while (cur <= endD) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        rangeDates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }

      openBookViewer(rangeDates, rangeDates[0]);
    });
  }

  // 8. 빠른 전체 기록 열람 (원클릭)
  if (btnHomeViewAll) {
    btnHomeViewAll.addEventListener('click', () => {
      openBookViewer();
    });
  }
}
