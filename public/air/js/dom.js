// 여러 모듈이 공유하는 주요 DOM 요소 참조
// (type="module" 스크립트는 문서 파싱 후 실행되므로 최상위에서 조회해도 안전)

export const recordDateInput = document.getElementById('recordDate');
export const btnPrevDate = document.getElementById('btnPrevDate');
export const btnNextDate = document.getElementById('btnNextDate');
export const btnToday = document.getElementById('btnToday');
export const btnFetchWeather = document.getElementById('btnFetchWeather');

// 작업시간 및 가동/미가동 상태 설정 요소들
export const workHoursSelect = document.getElementById('workHoursSelect');
export const btnApplyWorkHours = document.getElementById('btnApplyWorkHours');
export const btnSetAllRunning = document.getElementById('btnSetAllRunning');
export const btnSetAllIdle = document.getElementById('btnSetAllIdle');
export const btnSetAllHoliday = document.getElementById('btnSetAllHoliday');
export const btnTableSetRunning = document.getElementById('btnTableSetRunning');
export const btnTableSetIdle = document.getElementById('btnTableSetIdle');

export const btnSave = document.getElementById('btnSave');
export const btnPrint = document.getElementById('btnPrint');
export const btnExportExcel = document.getElementById('btnExportExcel');
export const saveStatusBadge = document.getElementById('saveStatus');
export const cloudStatusBadge = document.getElementById('cloudStatus');
export const supabaseStatusBadge = document.getElementById('supabaseStatus');

// Supabase 모달 관련 DOM 요소
export const btnSupabaseModal = document.getElementById('btnSupabaseModal');
export const supabaseModal = document.getElementById('supabaseModal');
export const btnCloseSupabaseModal = document.getElementById('btnCloseSupabaseModal');
export const supabaseUrlInput = document.getElementById('supabaseUrlInput');
export const supabaseKeyInput = document.getElementById('supabaseKeyInput');
export const btnTestSupabase = document.getElementById('btnTestSupabase');
export const btnSaveSupabaseConfig = document.getElementById('btnSaveSupabaseConfig');
export const btnDisconnectSupabase = document.getElementById('btnDisconnectSupabase');
export const supabaseTestResult = document.getElementById('supabaseTestResult');

export const displayFormattedDate = document.getElementById('displayFormattedDate');
export const weatherSelect = document.getElementById('weatherSelect');
export const tempRangeInput = document.getElementById('tempRangeInput');

// 배출구 테이블 및 추가 버튼
export const exhaustTableBody = document.getElementById('exhaustTableBody');
export const btnAddExhaustRow = document.getElementById('btnAddExhaustRow');

// 방지시설 운전사항 테이블 및 컨트롤
export const preventionOpTableBody = document.getElementById('preventionOpTableBody');
export const btnAddPreventionOpRow = document.getElementById('btnAddPreventionOpRow');
export const btnTogglePreventionExempt = document.getElementById('btnTogglePreventionExempt');

// 방지시설 보수사항 테이블 및 컨트롤
export const maintenanceTableBody = document.getElementById('maintenanceTableBody');
export const btnAddMaintenanceRow = document.getElementById('btnAddMaintenanceRow');

// 자가측정사항 테이블 및 컨트롤
export const measureDateInput = document.getElementById('measureDateInput');
export const measurementTableBody = document.getElementById('measurementTableBody');
export const btnAddMeasureRow = document.getElementById('btnAddMeasureRow');

// 자가측정 기상 요소들
export const selfTemp = document.getElementById('selfTemp');
export const selfHumidity = document.getElementById('selfHumidity');
export const selfPressure = document.getElementById('selfPressure');
export const selfWindDir = document.getElementById('selfWindDir');
export const selfWindSpeed = document.getElementById('selfWindSpeed');

export const fuelUsageInput = document.getElementById('fuelUsageInput');
export const rawMaterialUsageInput = document.getElementById('rawMaterialUsageInput');
export const opinionInput = document.getElementById('opinionInput');
export const etcInput = document.getElementById('etcInput');
export const technicianPosition = document.getElementById('technicianPosition');
export const technicianName = document.getElementById('technicianName');

// 결재 도장 요소들
export const signInCharge = document.getElementById('signInCharge');
export const signManager = document.getElementById('signManager');
export const signTechnician = document.getElementById('signTechnician');

// 전자결재 모달 요소들
export const signModal = document.getElementById('signModal');
export const modalTitle = document.getElementById('modalTitle');
export const btnCloseModal = document.getElementById('btnCloseModal');
export const btnCancelSign = document.getElementById('btnCancelSign');
export const btnClearCanvas = document.getElementById('btnClearCanvas');
export const btnAutoStamp = document.getElementById('btnAutoStamp');
export const btnApplySign = document.getElementById('btnApplySign');
export const btnRemoveSign = document.getElementById('btnRemoveSign');
export const signCanvas = document.getElementById('signCanvas');

// 책 넘김 뷰어 모달 (홈 화면과 책 뷰어가 공유)
export const bookViewerModal = document.getElementById('bookViewerModal');
