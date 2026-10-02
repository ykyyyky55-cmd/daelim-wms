// 대기배출시설 및 방지시설 운영기록부 클라이언트 애플리케이션 스크립트 (진입점)
// 각 기능은 js/ 폴더의 ES 모듈로 분리되어 있으며, 여기서는 이벤트 바인딩과 초기 화면만 담당합니다.

import { recordDateInput } from './js/dom.js';
import { toLocalDateString } from './js/utils.js';
import { bindTableEvents } from './js/tables.js';
import { bindEditorEvents, loadRecord } from './js/editor.js';
import { bindExcelEvents } from './js/excel.js';
import { bindSignatureEvents } from './js/signature.js';
import { bindSupabaseSettingsEvents, updateSupabaseStatusBadge } from './js/supabaseSettings.js';
import { bindSearchEvents } from './js/search.js';
import { bindBookViewerEvents } from './js/bookViewer.js';
import { bindHomeEvents, showHomeScreen, updateHomePortalStats, homeEditDate, homeQuickDate } from './js/home.js';
import { fillMissingRecords } from './js/autoFill.js';

bindTableEvents();
bindEditorEvents();
bindExcelEvents();
bindSignatureEvents();
bindSupabaseSettingsEvents();

// 초기 Supabase 상태 표시 갱신
updateSupabaseStatusBadge();

bindSearchEvents();
bindBookViewerEvents();
bindHomeEvents();

// 초기 시작: 홈 포털 대시보드 화면을 기본으로 표시하고 최신 데이터 갱신
const todayStr = toLocalDateString();
recordDateInput.value = todayStr;
if (homeEditDate) homeEditDate.value = todayStr;
if (homeQuickDate) homeQuickDate.value = todayStr;
showHomeScreen();     // 홈 화면 진입

// WMS 사본: 첫 기록일부터 오늘까지 빠진 날짜를 자동 작성한 뒤(저장 권한이 있을 때만) 오늘 기록을 불러온다
// (원래 앱 서버의 매일 18:00 자동 작성을 대신한다 — js/autoFill.js)
fillMissingRecords()
  .then(async ({ filled }) => {
    if (!filled.length) return;
    await updateHomePortalStats();
    const notice = document.getElementById('autoFillNotice');
    if (notice) {
      notice.textContent = `빠진 날짜 ${filled.length}일(${filled[0]} ~ ${filled[filled.length - 1]})의 운영기록부를 자동 작성했습니다.`;
      notice.style.display = 'block';
    }
  })
  .catch((err) => console.error('[운영기록부] 빠진 날짜 자동 작성 오류:', err))
  .finally(() => loadRecord(recordDateInput.value || todayStr)); // 오늘 데이터 선로드 (자동 작성이 끝난 뒤)
