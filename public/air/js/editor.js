import { state } from './state.js';
import {
  recordDateInput, btnPrevDate, btnNextDate, btnToday, btnFetchWeather,
  workHoursSelect, btnApplyWorkHours, btnSetAllRunning, btnSetAllIdle, btnSetAllHoliday,
  btnTableSetRunning, btnTableSetIdle, btnSave, btnPrint,
  displayFormattedDate, weatherSelect, tempRangeInput, measureDateInput,
  selfTemp, selfHumidity, selfPressure, selfWindDir, selfWindSpeed,
  fuelUsageInput, rawMaterialUsageInput, opinionInput, etcInput, technicianPosition, technicianName
} from './dom.js';
import { markUnsaved, markSaved } from './saveStatus.js';
import { generateStampSvg, getFormattedDateString, toLocalDateString } from './utils.js';
import { renderExhaustTable, renderPreventionOpTable, renderMaintenanceTable, renderMeasurementTable } from './tables.js';
import { renderSignatures } from './signature.js';
import { fetchWolgotWeather } from './weather.js';

// ============================================================
// ============================================================
// 운영기록 데이터를 화면 UI에 반영하는 함수
// ============================================================
export async function applyRecordToUI(record, isNew, targetDate) {
  // 앞면 날씨 및 온도
  if (record.weatherInfo) {
    weatherSelect.value = record.weatherInfo.weather || '맑음';
    tempRangeInput.value = record.weatherInfo.temp || '15 ~ 25℃';
  }

  // 배출구 목록 (없거나 비어있으면 기본 1~5번 혼합시설)
  if (record.exhaustList && record.exhaustList.length > 0) {
    state.currentExhaustList = record.exhaustList;
  } else {
    const defaultNote = record.isHoliday ? '휴무' : '미가동';
    state.currentExhaustList = [
      { id: '1', facility: '혼합시설', opTime: '-', note: defaultNote },
      { id: '2', facility: '혼합시설', opTime: '-', note: defaultNote },
      { id: '3', facility: '혼합시설', opTime: '-', note: defaultNote },
      { id: '4', facility: '혼합시설', opTime: '-', note: defaultNote },
      { id: '5', facility: '혼합시설', opTime: '-', note: defaultNote }
    ];
  }
  renderExhaustTable();

  // 방지시설 운전사항 (기본 면제 설정)
  if (record.preventionOperation) {
    state.isPreventionExempt = record.preventionOperation.exempt !== undefined ? !!record.preventionOperation.exempt : true;
    if (record.preventionOperation.rows && record.preventionOperation.rows.length > 0) {
      state.currentPreventionOpRows = record.preventionOperation.rows;
    }
  } else {
    state.isPreventionExempt = true;
  }
  renderPreventionOpTable();

  // 방지시설 보수사항
  if (record.preventionMaintenance && record.preventionMaintenance.rows) {
    state.currentMaintenanceRows = record.preventionMaintenance.rows;
  }
  renderMaintenanceTable();

  // 자가측정사항 (사용자가 직접 기입 및 수정할 수 있도록 기본 빈칸 처리)
  if (record.selfMeasurement) {
    measureDateInput.value = record.selfMeasurement.measureDate || '';
    selfTemp.value = record.selfMeasurement.temp || '';
    selfHumidity.value = record.selfMeasurement.humidity || '';
    selfPressure.value = record.selfMeasurement.pressure || '';
    selfWindDir.value = record.selfMeasurement.windDir || '';
    selfWindSpeed.value = record.selfMeasurement.windSpeed || '';

    const radios = document.querySelectorAll('input[name="selfWeather"]');
    radios.forEach(r => {
      r.checked = !!(record.selfMeasurement.weather && r.value === record.selfMeasurement.weather);
    });

    if (record.selfMeasurement.rows && record.selfMeasurement.rows.length > 0) {
      state.currentMeasurementRows = record.selfMeasurement.rows;
    } else {
      state.currentMeasurementRows = [
        { exhaustNo: '', facilityName: '', item: '', density: '', dailyFlow: '', dailyEmission: '', device: '', method: '' }
      ];
    }
  } else {
    measureDateInput.value = '';
    selfTemp.value = '';
    selfHumidity.value = '';
    selfPressure.value = '';
    selfWindDir.value = '';
    selfWindSpeed.value = '';
    document.querySelectorAll('input[name="selfWeather"]').forEach(r => r.checked = false);
    state.currentMeasurementRows = [
      { exhaustNo: '', facilityName: '', item: '', density: '', dailyFlow: '', dailyEmission: '', device: '', method: '' }
    ];
  }
  renderMeasurementTable();

  // 작업시간 설정 복원
  if (record.workHours) {
    state.currentWorkHours = record.workHours;
    if (workHoursSelect) {
      const exists = Array.from(workHoursSelect.options).some(opt => opt.value === record.workHours);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = record.workHours;
        opt.textContent = record.workHours;
        workHoursSelect.insertBefore(opt, workHoursSelect.lastElementChild);
      }
      workHoursSelect.value = record.workHours;
    }
  }

  fuelUsageInput.value = record.fuelUsage || '-';
  rawMaterialUsageInput.value = record.rawMaterialUsage || '-';
  opinionInput.value = record.engineerOpinion || '특이사항 없음. 정상 가동.';
  etcInput.value = record.etc || '-';

  if (record.technician) {
    technicianPosition.value = record.technician.position || '부장';
    technicianName.value = record.technician.name || '윤 경 용';
  }

  // 전자결재 서명 데이터 복원
  state.currentManagerSign = record.managerSign || '';
  state.currentTechnicianSign = record.technicianSign || '';
  renderSignatures();

  // 신규 레코드면 날씨 자동 조회
  if (isNew) {
    await fetchWolgotWeather(targetDate);
    markUnsaved();
  } else {
    markSaved();
  }
}

// ============================================================
// 특정 일자 기록 로드 함수 (Supabase -> 서버 -> LocalStorage 다단계 조회)
// ============================================================
export async function loadRecord(targetDate) {
  displayFormattedDate.textContent = getFormattedDateString(targetDate);
  measureDateInput.value = targetDate;

  // 1. Supabase 클라우드 데이터베이스 우선 조회
  if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
    try {
      const sbRes = await window.SupabaseService.fetchSupabaseRecord(targetDate);
      if (sbRes.success && sbRes.data) {
        // 브라우저 로컬 스토리지 캐시 동기화
        try {
          localStorage.setItem('daelim_air_record_' + targetDate, JSON.stringify(sbRes.data));
        } catch (e) {}
        await applyRecordToUI(sbRes.data, false, targetDate);
        return;
      }
    } catch (sbErr) {
      console.warn('[Supabase] 조회 실패, 로컬 데이터 시도:', sbErr);
    }
  }

  // 2. 로컬 백엔드 서버 조회
  try {
    const res = await fetch(`/api/records/${targetDate}`);
    if (res.ok) {
      const resJson = await res.json();
      if (resJson.success && resJson.data) {
        // 브라우저 로컬 스토리지 캐시 동기화
        try {
          localStorage.setItem('daelim_air_record_' + targetDate, JSON.stringify(resJson.data));
        } catch (e) {}
        await applyRecordToUI(resJson.data, !!resJson.isNew, targetDate);
        return;
      }
    }
  } catch (serverErr) {
    // 순수 웹 환경에서는 서버가 없으므로 LocalStorage 확인
  }

  // 3. 브라우저 LocalStorage 로컬 캐시 조회
  try {
    const localCached = localStorage.getItem('daelim_air_record_' + targetDate);
    if (localCached) {
      const parsed = JSON.parse(localCached);
      await applyRecordToUI(parsed, false, targetDate);
      return;
    }
  } catch (e) {
    console.warn('LocalStorage 로드 실패:', e);
  }

  // 4. 저장된 기록이 전혀 없는 신규 날짜: 기본 양식 생성
  const d = new Date(targetDate + 'T00:00:00');
  const dayOfWeek = d.getDay();
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // 토요일(6), 일요일(0)

  const defaultRecord = {
    date: targetDate,
    isHoliday: isWeekend,
    status: isWeekend ? 'HOLIDAY' : 'IDLE',
    workHours: '09:00 ~ 18:00',
    exhaustList: [
      { id: '1', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
      { id: '2', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
      { id: '3', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
      { id: '4', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' },
      { id: '5', facility: '혼합시설', opTime: '-', note: isWeekend ? '휴무' : '미가동' }
    ],
    preventionOperation: {
      exempt: true,
      text: '방지시설 면제',
      rows: []
    },
    preventionMaintenance: {
      exempt: false,
      rows: []
    },
    selfMeasurement: {
      measureDate: '',
      weather: '',
      temp: '',
      humidity: '',
      pressure: '',
      windDir: '',
      windSpeed: '',
      rows: []
    },
    fuelUsage: '-',
    rawMaterialUsage: '-',
    engineerOpinion: '특이사항 없음. 정상 가동.',
    etc: '-',
    technician: { position: '부장', name: '윤 경 용' },
    // 일자에 맞춘 부서장 및 환경기술인 공식 전자결재 도장 자동 날인
    managerSign: generateStampSvg('윤경용', targetDate),
    technicianSign: generateStampSvg('윤경용', targetDate)
  };

  await applyRecordToUI(defaultRecord, true, targetDate);
}

// ============================================================
// 현재 화면의 데이터 수집
// ============================================================
export function collectFormData() {
  const targetDate = recordDateInput.value;
  const selectedRadio = document.querySelector('input[name="selfWeather"]:checked');

  return {
    date: targetDate,
    formattedDate: getFormattedDateString(targetDate),
    workHours: state.currentWorkHours || '09:00 ~ 18:00',
    weatherInfo: {
      weather: weatherSelect.value,
      temp: tempRangeInput.value
    },
    exhaustList: state.currentExhaustList,
    preventionOperation: {
      exempt: state.isPreventionExempt,
      text: state.isPreventionExempt ? '방지시설 면제' : '',
      rows: state.currentPreventionOpRows
    },
    preventionMaintenance: {
      exempt: false,
      rows: state.currentMaintenanceRows
    },
    selfMeasurement: {
      measureDate: measureDateInput.value,
      weather: selectedRadio ? selectedRadio.value : '맑음',
      temp: selfTemp.value,
      humidity: selfHumidity.value,
      pressure: selfPressure.value,
      windDir: selfWindDir.value,
      windSpeed: selfWindSpeed.value,
      rows: state.currentMeasurementRows
    },
    fuelUsage: fuelUsageInput.value,
    rawMaterialUsage: rawMaterialUsageInput.value,
    engineerOpinion: opinionInput.value,
    etc: etcInput.value,
    technician: {
      position: technicianPosition.value,
      name: technicianName.value
    },
    managerSign: state.currentManagerSign,
    technicianSign: state.currentTechnicianSign
  };
}

// ============================================================
// 저장하기 함수 (Supabase 클라우드, 로컬 서버, 브라우저 스토리지 동기화)
// ============================================================
export async function saveCurrentRecord() {
  const targetDate = recordDateInput.value;
  const payload = collectFormData();

  btnSave.disabled = true;
  btnSave.textContent = '💾 저장 중...';

  let anySaved = false;
  let errorMessages = [];
  // WMS 사본: 클라우드(WMS DB)에 연결된 상태에서 클라우드 저장이 실패하면 저장된 것으로 보지 않는다
  let isCloudSaveFailed = false;

  // 1. 브라우저 LocalStorage 로컬 캐시 즉시 보관
  try {
    localStorage.setItem('daelim_air_record_' + targetDate, JSON.stringify(payload));
    anySaved = true;
  } catch (e) {
    console.warn('LocalStorage 저장 실패:', e);
  }

  // 2. Supabase 클라우드 데이터베이스 저장 (연동 설정 시)
  if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
    try {
      const recordStatus = payload.isHoliday ? 'HOLIDAY' : 'NORMAL';
      const sbRes = await window.SupabaseService.saveSupabaseRecord(targetDate, payload, recordStatus);
      if (sbRes.success) {
        anySaved = true;
      } else {
        isCloudSaveFailed = true;
        errorMessages.push(sbRes.message);
      }
    } catch (sbErr) {
      console.error('Supabase 저장 예외:', sbErr);
      isCloudSaveFailed = true;
      errorMessages.push('클라우드 저장 실패');
    }
  }

  // 3. 로컬 백엔드 서버 저장 (Node.js 실행 중인 경우)
  try {
    const res = await fetch(`/api/records/${targetDate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        anySaved = true;
      }
    }
  } catch (err) {
    // 순수 웹(GitHub Pages) 모드이거나 백엔드가 꺼져 있는 경우 에러 무시
  }

  if (isCloudSaveFailed) {
    alert('클라우드에 저장하지 못했습니다: ' + errorMessages.join('\n') + '\n\n지금 내용은 이 기기에만 남아 있어 다른 PC에서는 보이지 않습니다.');
  } else if (anySaved) {
    markSaved();
  } else {
    alert('저장 실패: ' + (errorMessages.join('\n') || '데이터를 저장하지 못했습니다.'));
  }

  btnSave.disabled = false;
  btnSave.textContent = '💾 저장하기';
}

// 날짜 이동 헬퍼 함수
export function changeDateByOffset(offsetDays) {
  const current = new Date(recordDateInput.value + 'T00:00:00');
  current.setDate(current.getDate() + offsetDays);
  const newDateStr = toLocalDateString(current);
  recordDateInput.value = newDateStr;
  loadRecord(newDateStr);
}

// 작업시간 및 가동상태 일괄 설정 함수들
export function setAllToRunning() {
  const hours = state.currentWorkHours || '09:00 ~ 18:00';
  state.currentExhaustList.forEach(item => {
    item.facility = '혼합시설';
    item.opTime = hours;
    item.note = '정상';
  });
  renderExhaustTable();
  opinionInput.value = `특이사항 없음. 전 배출시설(혼합시설 1~${state.currentExhaustList.length}번) 정상 가동.`;
  markUnsaved();
}

export function setAllToIdle() {
  state.currentExhaustList.forEach(item => {
    item.facility = '혼합시설';
    item.opTime = '-';
    item.note = '미가동';
  });
  renderExhaustTable();
  opinionInput.value = '배출시설 미가동.';
  markUnsaved();
}

export function setAllToHoliday() {
  state.currentExhaustList.forEach(item => {
    item.facility = '혼합시설';
    item.opTime = '-';
    item.note = '휴무';
  });
  renderExhaustTable();
  opinionInput.value = '휴무로 인한 배출시설 미가동.';
  markUnsaved();
}

export function applyCustomWorkHours() {
  const hours = state.currentWorkHours || '09:00 ~ 18:00';
  let runningCount = 0;
  state.currentExhaustList.forEach(item => {
    if (item.note === '정상') {
      item.opTime = hours;
      runningCount++;
    }
  });
  if (runningCount === 0) {
    setAllToRunning();
  } else {
    renderExhaustTable();
    markUnsaved();
  }
}

export function bindEditorEvents() {
  // 날짜 변경 이벤트
  recordDateInput.addEventListener('change', () => loadRecord(recordDateInput.value));
  btnPrevDate.addEventListener('click', () => changeDateByOffset(-1));
  btnNextDate.addEventListener('click', () => changeDateByOffset(1));
  btnToday.addEventListener('click', () => {
    const todayStr = toLocalDateString();
    recordDateInput.value = todayStr;
    loadRecord(todayStr);
  });

  // 날씨 연동 버튼
  btnFetchWeather.addEventListener('click', () => fetchWolgotWeather(recordDateInput.value));

  // 상단 바 작업시간 드롭다운 변경 리스너
  if (workHoursSelect) {
    workHoursSelect.addEventListener('change', (e) => {
      let val = e.target.value;
      if (val === '__custom__') {
        const customVal = prompt('작업시간을 직접 입력하세요 (예: 08:30 ~ 17:30):', state.currentWorkHours);
        if (customVal !== null && customVal.trim() !== '') {
          val = customVal.trim();
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          workHoursSelect.insertBefore(opt, workHoursSelect.lastElementChild);
          workHoursSelect.value = val;
        } else {
          workHoursSelect.value = state.currentWorkHours;
          return;
        }
      }
      state.currentWorkHours = val;
      applyCustomWorkHours();
    });
  }

  // 상단 바 및 표 상단 버튼 이벤트 바인딩
  if (btnSetAllRunning) btnSetAllRunning.addEventListener('click', setAllToRunning);
  if (btnTableSetRunning) btnTableSetRunning.addEventListener('click', setAllToRunning);
  if (btnSetAllIdle) btnSetAllIdle.addEventListener('click', setAllToIdle);
  if (btnTableSetIdle) btnTableSetIdle.addEventListener('click', setAllToIdle);
  if (btnSetAllHoliday) btnSetAllHoliday.addEventListener('click', setAllToHoliday);
  if (btnApplyWorkHours) btnApplyWorkHours.addEventListener('click', applyCustomWorkHours);

  // 저장 버튼
  btnSave.addEventListener('click', saveCurrentRecord);

  // 단축키 Ctrl + S 지원
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentRecord();
    }
  });

  // 인쇄 및 엑셀 다운로드 (로컬 서버 및 웹 브라우저 직접 생성 지원)
  btnPrint.addEventListener('click', () => window.print());

  // 자가측정 기상 라디오 토글 해제 지원 (라디오 재클릭 시 선택 해제)
  document.querySelectorAll('input[name="selfWeather"]').forEach(radio => {
    radio.addEventListener('click', function() {
      if (this.dataset.checked === 'true') {
        this.checked = false;
        this.dataset.checked = 'false';
      } else {
        document.querySelectorAll('input[name="selfWeather"]').forEach(r => r.dataset.checked = 'false');
        this.dataset.checked = 'true';
      }
      markUnsaved();
    });
  });

  // 자가측정 기상 및 측정일 수치 입력 시 수정 상태 반영
  [selfTemp, selfHumidity, selfPressure, selfWindDir, selfWindSpeed, measureDateInput].forEach(elem => {
    if (elem) {
      elem.addEventListener('input', () => markUnsaved());
    }
  });
}
