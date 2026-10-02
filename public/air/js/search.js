import { recordDateInput } from './dom.js';
import { loadRecord } from './editor.js';
import { generateStampSvg, getFormattedDateString, toLocalDateString } from './utils.js';
import { fetchAllAvailableRecords } from './recordStore.js';
import { buildSheetsHtmlForRecord } from './recordTemplate.js';
import { openBookViewer } from './bookViewer.js';

// ============================================================
// 월간 / 주간 / 일일 검색 및 일괄 열람 / 인쇄 모듈
// ============================================================
let currentSearchResults = [];

// 검색 모달 열기/닫기
export const btnOpenSearchModal = document.getElementById('btnOpenSearchModal');
export const batchSearchModal = document.getElementById('batchSearchModal');
export const btnCloseSearchModal = document.getElementById('btnCloseSearchModal');
export const btnCloseSearchModalFooter = document.getElementById('btnCloseSearchModalFooter');

export function openSearchModal() {
  if (batchSearchModal) {
    batchSearchModal.style.display = 'flex';
    executeMonthlySearch();
  }
}

export function closeSearchModal() {
  if (batchSearchModal) {
    batchSearchModal.style.display = 'none';
  }
}

// 탭 전환
export const tabButtons = document.querySelectorAll('.search-tabs .tab-btn');
export const tabPanels = {
  monthly: document.getElementById('tabContentMonthly'),
  weekly: document.getElementById('tabContentWeekly'),
  daily: document.getElementById('tabContentDaily'),
  batch_create: document.getElementById('tabContentBatchCreate')
};

// 검색 결과 테이블 렌더링
export const searchResultTableBody = document.getElementById('searchResultTableBody');
export const searchResultSummary = document.getElementById('searchResultSummary');
export const selectAllCheckbox = document.getElementById('selectAllCheckbox');

export function renderSearchResults(records) {
  currentSearchResults = records;
  if (!searchResultTableBody) return;

  if (!records || records.length === 0) {
    searchResultTableBody.innerHTML = `<tr><td colspan="7" style="padding: 24px; color: #94a3b8;">해당 기간에 등록된 운영기록이 없습니다.</td></tr>`;
    if (searchResultSummary) searchResultSummary.textContent = '(0건 선택됨)';
    return;
  }

  const dayKorean = ['일', '월', '화', '수', '목', '금', '토'];

  searchResultTableBody.innerHTML = records.map(r => {
    const d = new Date(r.date + 'T00:00:00');
    const dayName = dayKorean[d.getDay()];
    const isWeekend = (d.getDay() === 0 || d.getDay() === 6);

    let statusBadge = '<span class="badge-running">정상가동</span>';
    if (r.status === 'HOLIDAY' || r.isHoliday) {
      statusBadge = `<span class="badge-holiday">${r.holidayReason || '휴무'}</span>`;
    } else if (r.status === 'IDLE' || (r.exhaustList && r.exhaustList.every(e => e.note === '미가동'))) {
      statusBadge = '<span class="badge-idle">미가동</span>';
    }

    const weatherStr = r.weatherInfo ? `${r.weatherInfo.weather || '-'} (${r.weatherInfo.temp || '-'})` : '-';
    const reasonStr = r.engineerOpinion || (r.isHoliday ? '휴무' : '미가동');

    return `
        <tr>
          <td><input type="checkbox" class="batch-row-checkbox" data-date="${r.date}" checked></td>
          <td style="font-weight: 600;">${r.date}</td>
          <td style="color: ${isWeekend ? '#dc2626' : '#1e293b'};">${dayName}요일</td>
          <td>${statusBadge}</td>
          <td>${weatherStr}</td>
          <td style="text-align: left; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${reasonStr}">${reasonStr}</td>
          <td>
            <button type="button" class="btn btn-default" style="padding: 2px 8px; font-size: 0.78rem;" onclick="openSingleRecord('${r.date}')">
              열기
            </button>
          </td>
        </tr>
      `;
  }).join('');

  bindCheckboxEvents();
  updateSelectionSummary();
}

// 체크박스 이벤트 바인딩
export function bindCheckboxEvents() {
  const rowCheckboxes = document.querySelectorAll('.batch-row-checkbox');
  rowCheckboxes.forEach(cb => {
    cb.addEventListener('change', updateSelectionSummary);
  });

  if (selectAllCheckbox) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.onchange = () => {
      rowCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
      updateSelectionSummary();
    };
  }
}

export function updateSelectionSummary() {
  const selected = getSelectedDates();
  if (searchResultSummary) {
    searchResultSummary.textContent = `(총 ${currentSearchResults.length}건 중 ${selected.length}건 선택됨)`;
  }
}

export function getSelectedDates() {
  const checkboxes = document.querySelectorAll('.batch-row-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.date);
}

// 1. 월간 검색 실행
export async function executeMonthlySearch() {
  const monthInput = document.getElementById('searchMonthInput');
  const targetMonth = monthInput ? monthInput.value : '2026-09';
  searchResultTableBody.innerHTML = `<tr><td colspan="7" style="padding: 20px; color: #64748b;">⏳ ${targetMonth} 운영기록을 조회하는 중...</td></tr>`;

  const allRecords = await fetchAllAvailableRecords();
  const filtered = allRecords.filter(r => r.date.startsWith(targetMonth));
  renderSearchResults(filtered);
}

export const btnSearchMonthly = document.getElementById('btnSearchMonthly');

// 2. 주간 검색 실행
export async function executeWeeklySearch() {
  const monthInput = document.getElementById('searchWeekMonthInput');
  const weekSelect = document.getElementById('searchWeekSelect');
  const targetMonth = monthInput ? monthInput.value : '2026-09';
  const weekNum = parseInt(weekSelect ? weekSelect.value : '1', 10);

  const weekRanges = {
    1: [1, 6],
    2: [7, 13],
    3: [14, 20],
    4: [21, 27],
    5: [28, 31]
  };

  const [startDay, endDay] = weekRanges[weekNum] || [1, 31];
  searchResultTableBody.innerHTML = `<tr><td colspan="7" style="padding: 20px; color: #64748b;">⏳ ${targetMonth} ${weekNum}주차 기록을 조회하는 중...</td></tr>`;

  const allRecords = await fetchAllAvailableRecords();
  const filtered = allRecords.filter(r => {
    if (!r.date.startsWith(targetMonth)) return false;
    const day = parseInt(r.date.split('-')[2], 10);
    return day >= startDay && day <= endDay;
  });

  renderSearchResults(filtered);
}

export const btnSearchWeekly = document.getElementById('btnSearchWeekly');

// 3. 일일 검색 실행
export const btnSearchDaily = document.getElementById('btnSearchDaily');

// 4. 기간 일괄 자동생성 실행
export const btnExecuteBatchGenerate = document.getElementById('btnExecuteBatchGenerate');
export const batchGenerateStatus = document.getElementById('batchGenerateStatus');

// ============================================================
// 일괄 열람 (Batch View) 실행 -> 책 뷰어 형식으로 일원화하여 양식 배치 완벽 보장
// ============================================================
export const batchViewBanner = document.getElementById('batchViewBanner');
export const batchViewContainer = document.getElementById('batchViewContainer');
export const batchViewCount = document.getElementById('batchViewCount');
export const singleWorkspace = document.getElementById('singleWorkspace');
export const btnExitBatchView = document.getElementById('btnExitBatchView');
export const btnModalBatchView = document.getElementById('btnModalBatchView');
export const btnBatchPrintCurrent = document.getElementById('btnBatchPrintCurrent');

export async function executeBatchView() {
  const selectedDates = getSelectedDates();
  if (selectedDates.length === 0) {
    alert('일괄 열람할 일자를 1개 이상 선택해주세요.');
    return;
  }

  closeSearchModal();
  // 모든 열람은 양식 깨짐이 없는 책 뷰어(양면 펼침 바인더) 형식으로 실행
  await openBookViewer(selectedDates, selectedDates[0]);
}

export function exitBatchViewMode() {
  if (batchViewBanner) batchViewBanner.style.display = 'none';
  if (batchViewContainer) {
    batchViewContainer.style.display = 'none';
    batchViewContainer.innerHTML = '';
  }
  if (singleWorkspace) singleWorkspace.style.display = 'flex';
}

// ============================================================
// 일괄 인쇄 (Batch Print - A4 다중 페이지) 실행
// ============================================================
export const batchPrintContainer = document.getElementById('batchPrintContainer');
export const btnModalBatchPrint = document.getElementById('btnModalBatchPrint');

export async function executeBatchPrint() {
  const selectedDates = getSelectedDates();
  if (selectedDates.length === 0) {
    alert('일괄 인쇄할 일자를 1개 이상 선택해주세요.');
    return;
  }

  if (!batchPrintContainer) return;
  batchPrintContainer.innerHTML = '';

  const allRecords = await fetchAllAvailableRecords();
  const recordsMap = new Map(allRecords.map(r => [r.date, r]));

  const printSheetsHtml = selectedDates.map(dateStr => {
    const rec = recordsMap.get(dateStr) || { date: dateStr, formattedDate: getFormattedDateString(dateStr) };
    return buildSheetsHtmlForRecord(rec, true);
  }).join('');

  batchPrintContainer.innerHTML = printSheetsHtml;
  document.body.classList.add('printing-batch');

  setTimeout(() => {
    window.print();
  }, 250);

  const cleanupPrint = () => {
    document.body.classList.remove('printing-batch');
    batchPrintContainer.innerHTML = '';
    window.removeEventListener('afterprint', cleanupPrint);
  };
  window.addEventListener('afterprint', cleanupPrint);
  setTimeout(cleanupPrint, 3000);
}

export function bindSearchEvents() {
  if (btnOpenSearchModal) btnOpenSearchModal.addEventListener('click', openSearchModal);
  if (btnCloseSearchModal) btnCloseSearchModal.addEventListener('click', closeSearchModal);
  if (btnCloseSearchModalFooter) btnCloseSearchModalFooter.addEventListener('click', closeSearchModal);
  if (batchSearchModal) {
    batchSearchModal.addEventListener('click', (e) => {
      if (e.target === batchSearchModal) closeSearchModal();
    });
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = btn.dataset.tab;
      Object.keys(tabPanels).forEach(key => {
        if (tabPanels[key]) {
          tabPanels[key].style.display = (key === targetTab) ? 'block' : 'none';
        }
      });
    });
  });

  // 개별 일자 열기 전역 등록
  window.openSingleRecord = function(dateStr) {
    closeSearchModal();
    exitBatchViewMode();
    recordDateInput.value = dateStr;
    loadRecord(dateStr);
  };

  if (btnSearchMonthly) btnSearchMonthly.addEventListener('click', executeMonthlySearch);
  if (btnSearchWeekly) btnSearchWeekly.addEventListener('click', executeWeeklySearch);

  if (btnSearchDaily) {
    btnSearchDaily.addEventListener('click', () => {
      const dailyInput = document.getElementById('searchDailyInput');
      const targetDate = dailyInput ? dailyInput.value : '';
      if (targetDate) {
        window.openSingleRecord(targetDate);
      }
    });
  }

  if (btnExecuteBatchGenerate) {
    btnExecuteBatchGenerate.addEventListener('click', async () => {
      const startInput = document.getElementById('batchStartInput');
      const endInput = document.getElementById('batchEndInput');
      const startDate = startInput.value;
      const endDate = endInput.value;

      if (!startDate || !endDate || startDate > endDate) {
        alert('올바른 시작일과 종료일을 지정해주세요.');
        return;
      }

      // WMS 사본: 저장 권한이 없는 계정은 클라우드에 올리지 못하므로 시작하지 않는다
      if (window.SupabaseService && !window.SupabaseService.canEdit()) {
        alert('운영기록부 일괄 생성은 매니저 이상만 할 수 있습니다.');
        return;
      }

      btnExecuteBatchGenerate.disabled = true;
      btnExecuteBatchGenerate.textContent = '⏳ 일괄 생성 중...';
      if (batchGenerateStatus) {
        batchGenerateStatus.style.display = 'block';
        batchGenerateStatus.textContent = `${startDate}부터 ${endDate}까지 일일 기록을 자동 생성하고 있습니다...`;
      }

      try {
        let generatedCount = 0;
        try {
          const res = await fetch('/api/records/batch-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startDate, endDate })
          });
          if (res.ok) {
            const data = await res.json();
            generatedCount = data.count || 0;
          }
        } catch (e) {}

        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const curDateStr = toLocalDateString(d);
          const dayOfWeek = d.getDay();
          const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
          const defaultNote = isWeekend ? '휴무' : '미가동';
          const opinion = isWeekend ? '휴무로 인한 배출시설 미가동.' : '배출시설 미가동.';

          const recordData = {
            date: curDateStr,
            formattedDate: getFormattedDateString(curDateStr),
            isHoliday: isWeekend,
            holidayReason: isWeekend ? (dayOfWeek === 6 ? '토요일(주말 휴무)' : '일요일(주말 휴무)') : '',
            status: isWeekend ? 'HOLIDAY' : 'IDLE',
            workHours: '09:00 ~ 18:00',
            weatherInfo: { weather: '맑음', temp: '17 ~ 25℃' },
            exhaustList: [
              { id: '1', facility: '혼합시설', opTime: '-', note: defaultNote },
              { id: '2', facility: '혼합시설', opTime: '-', note: defaultNote },
              { id: '3', facility: '혼합시설', opTime: '-', note: defaultNote },
              { id: '4', facility: '혼합시설', opTime: '-', note: defaultNote },
              { id: '5', facility: '혼합시설', opTime: '-', note: defaultNote }
            ],
            preventionOperation: { exempt: true, text: '방지시설 면제', rows: [] },
            preventionMaintenance: { exempt: false, rows: [] },
            selfMeasurement: { measureDate: '', weather: '', temp: '', humidity: '', pressure: '', windDir: '', windSpeed: '', rows: [] },
            fuelUsage: '-',
            rawMaterialUsage: '-',
            engineerOpinion: opinion,
            etc: '-',
            technician: { position: '부장', name: '윤 경 용' },
            // 일자에 맞춘 부서장 및 환경기술인 공식 전자결재 도장 자동 날인
            managerSign: generateStampSvg('윤경용', curDateStr),
            technicianSign: generateStampSvg('윤경용', curDateStr),
            updatedAt: new Date().toISOString()
          };

          localStorage.setItem('daelim_air_record_' + curDateStr, JSON.stringify(recordData));

          if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
            await window.SupabaseService.saveSupabaseRecord(curDateStr, recordData, recordData.status);
          }
          generatedCount++;
        }

        if (batchGenerateStatus) {
          batchGenerateStatus.textContent = `✅ ${startDate} ~ ${endDate} 총 ${generatedCount}건 일괄 생성 및 동기화 완료!`;
        }
        alert('일괄 생성이 완료되었습니다.');
        const monthTab = document.querySelector('.search-tabs .tab-btn[data-tab="monthly"]');
        if (monthTab) monthTab.click();
        executeMonthlySearch();
      } catch (err) {
        console.error('일괄 생성 오류:', err);
        alert('일괄 생성 중 오류가 발생했습니다: ' + err.message);
      } finally {
        btnExecuteBatchGenerate.disabled = false;
        btnExecuteBatchGenerate.textContent = '⚡ 일괄 생성 실행';
      }
    });
  }

  if (btnModalBatchView) btnModalBatchView.addEventListener('click', executeBatchView);
  if (btnExitBatchView) btnExitBatchView.addEventListener('click', exitBatchViewMode);

  if (btnModalBatchPrint) btnModalBatchPrint.addEventListener('click', executeBatchPrint);
  if (btnBatchPrintCurrent) btnBatchPrintCurrent.addEventListener('click', executeBatchPrint);
}
