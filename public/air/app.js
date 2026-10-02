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
import { bindHomeEvents, showHomeScreen, homeEditDate, homeQuickDate } from './js/home.js';

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
loadRecord(todayStr); // 오늘 데이터 백그라운드 선로드
showHomeScreen();     // 홈 화면 진입
