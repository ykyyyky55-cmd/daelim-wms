import { state } from './state.js';
import {
  recordDateInput, exhaustTableBody, btnAddExhaustRow,
  preventionOpTableBody, btnAddPreventionOpRow, btnTogglePreventionExempt,
  maintenanceTableBody, btnAddMaintenanceRow, measurementTableBody, btnAddMeasureRow
} from './dom.js';
import { markUnsaved } from './saveStatus.js';

// ============================================================
// 배출구 테이블 렌더링 (1~4번 및 추가 배출구)
// ============================================================
export function renderExhaustTable() {
  exhaustTableBody.innerHTML = '';
  const activeHours = state.currentWorkHours || '09:00 ~ 18:00';
  const timeOptions = [activeHours, '09:00 ~ 18:00', '08:30 ~ 17:30', '08:00 ~ 17:00', '09:00 ~ 12:00', '13:00 ~ 18:00', '-'];
  const uniqueTimeOptions = [...new Set(timeOptions)];

  state.currentExhaustList.forEach((item, index) => {
    const tr = document.createElement('tr');

    let customTimeOpt = '';
    if (item.opTime && !uniqueTimeOptions.includes(item.opTime)) {
      customTimeOpt = `<option value="${item.opTime}" selected>${item.opTime}</option>`;
    }

    const opTimeSelectHtml = uniqueTimeOptions.map(opt => 
      `<option value="${opt}" ${item.opTime === opt ? 'selected' : ''}>${opt}</option>`
    ).join('') + customTimeOpt + `<option value="__custom__">직접 입력...</option>`;

    tr.innerHTML = `
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="id" value="${item.id}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="facility" value="${item.facility}"></td>
        <td>
          <select class="editable-cell select-in-cell" data-idx="${index}" data-field="opTime">
            ${opTimeSelectHtml}
          </select>
        </td>
        <td>
          <select class="editable-cell select-in-cell" data-idx="${index}" data-field="note">
            <option value="정상" ${item.note === '정상' ? 'selected' : ''}>정상</option>
            <option value="미가동" ${item.note === '미가동' ? 'selected' : ''}>미가동</option>
            <option value="휴무" ${item.note === '휴무' ? 'selected' : ''}>휴무</option>
            ${!['정상', '미가동', '휴무'].includes(item.note) && item.note ? `<option value="${item.note}" selected>${item.note}</option>` : ''}
            <option value="__custom__">직접 입력...</option>
          </select>
        </td>
        <td class="no-print">
          <button type="button" class="btn-delete btn-del-exhaust" data-idx="${index}" title="삭제">❌</button>
        </td>
      `;
    exhaustTableBody.appendChild(tr);
  });

  // 1. 배출구 id, facility 입력 변경 리스너
  exhaustTableBody.querySelectorAll('input').forEach(elem => {
    elem.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      state.currentExhaustList[idx][field] = e.target.value;
      markUnsaved();
    });
  });

  // 2. 가동(작업)시간 드롭다운 변경 리스너
  exhaustTableBody.querySelectorAll('select[data-field="opTime"]').forEach(selectElem => {
    selectElem.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      let val = e.target.value;

      if (val === '__custom__') {
        const customVal = prompt('가동(작업)시간을 직접 입력하세요 (예: 08:30 ~ 17:30):', state.currentExhaustList[idx].opTime === '-' ? state.currentWorkHours : state.currentExhaustList[idx].opTime);
        if (customVal !== null && customVal.trim() !== '') {
          val = customVal.trim();
        } else {
          val = state.currentExhaustList[idx].opTime || state.currentWorkHours;
        }
      }

      state.currentExhaustList[idx].opTime = val;

      // 가동시간 설정에 따른 비고 자동 연동
      if (val === '-') {
        state.currentExhaustList[idx].note = '미가동';
      } else if (val !== '' && (state.currentExhaustList[idx].note === '미가동' || state.currentExhaustList[idx].note === '휴무')) {
        state.currentExhaustList[idx].note = '정상';
      }

      renderExhaustTable();
      markUnsaved();
    });
  });

  // 3. 비고(note) 드롭다운 변경 리스너
  exhaustTableBody.querySelectorAll('select[data-field="note"]').forEach(selectElem => {
    selectElem.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      let val = e.target.value;

      if (val === '__custom__') {
        const customVal = prompt('비고 내용을 직접 입력하세요 (예: 부분가동, 점검 등):', state.currentExhaustList[idx].note || '');
        if (customVal !== null && customVal.trim() !== '') {
          val = customVal.trim();
        } else {
          val = state.currentExhaustList[idx].note || '정상';
        }
      }

      // 비고 상태값 갱신
      state.currentExhaustList[idx].note = val;

      // 비고에 따른 가동시간 자동 연동
      if (val === '미가동' || val === '휴무') {
        state.currentExhaustList[idx].opTime = '-';
      } else if (val === '정상') {
        if (state.currentExhaustList[idx].opTime === '-' || !state.currentExhaustList[idx].opTime) {
          state.currentExhaustList[idx].opTime = state.currentWorkHours;
        }
      }

      renderExhaustTable();
      markUnsaved();
    });
  });

  // 삭제 버튼 리스너
  exhaustTableBody.querySelectorAll('.btn-del-exhaust').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.currentExhaustList.splice(idx, 1);
      renderExhaustTable();
      markUnsaved();
    });
  });
}

// ============================================================
// 방지시설 운영사항(가. 운전사항) 렌더링
// ============================================================
export function renderPreventionOpTable() {
  preventionOpTableBody.innerHTML = '';

  if (state.isPreventionExempt) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td colspan="9" style="height: 110px; font-size: 1.15rem; font-weight: normal; color: #475569; letter-spacing: 3px;">
          방지시설 면제
        </td>
        <td class="no-print">-</td>
      `;
    preventionOpTableBody.appendChild(tr);
    return;
  }

  state.currentPreventionOpRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="facility" value="${row.facility || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="location" value="${row.location || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="power" value="${row.power || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="capacity" value="${row.capacity || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="pollutant" value="${row.pollutant || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="density" value="${row.density || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="efficiency" value="${row.efficiency || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="chemName" value="${row.chemName || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="chemAmount" value="${row.chemAmount || ''}"></td>
        <td class="no-print">
          <button type="button" class="btn-delete btn-del-prev-op" data-idx="${index}" title="삭제">❌</button>
        </td>
      `;
    preventionOpTableBody.appendChild(tr);
  });

  // 기본 최소 2행으로 절반 축소
  const minRows = 2;
  for (let i = state.currentPreventionOpRows.length; i < minRows; i++) {
    const emptyTr = document.createElement('tr');
    emptyTr.innerHTML = `
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td><input type="text" class="editable-cell" value="" placeholder="-"></td>
        <td class="no-print">-</td>
      `;
    preventionOpTableBody.appendChild(emptyTr);
  }

  // 입력 변경 리스너
  preventionOpTableBody.querySelectorAll('input').forEach(elem => {
    elem.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      state.currentPreventionOpRows[idx][field] = e.target.value;
      markUnsaved();
    });
  });

  // 삭제 버튼 리스너
  preventionOpTableBody.querySelectorAll('.btn-del-prev-op').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.currentPreventionOpRows.splice(idx, 1);
      if (state.currentPreventionOpRows.length === 0) {
        state.currentPreventionOpRows.push({
          facility: '', location: '', power: '', capacity: '', pollutant: '', density: '', efficiency: '', chemName: '', chemAmount: ''
        });
      }
      renderPreventionOpTable();
      markUnsaved();
    });
  });
}

// ============================================================
// 나. 방지시설 보수사항 렌더링
// ============================================================
export function renderMaintenanceTable() {
  maintenanceTableBody.innerHTML = '';
  state.currentMaintenanceRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="facility" value="${row.facility || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="exhaustNo" value="${row.exhaustNo || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="period" value="${row.period || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="worker" value="${row.worker || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="details" value="${row.details || ''}"></td>
        <td class="no-print">
          <button type="button" class="btn-delete btn-del-maint" data-idx="${index}" title="삭제">❌</button>
        </td>
      `;
    maintenanceTableBody.appendChild(tr);
  });

  maintenanceTableBody.querySelectorAll('input').forEach(elem => {
    elem.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      state.currentMaintenanceRows[idx][field] = e.target.value;
      markUnsaved();
    });
  });

  maintenanceTableBody.querySelectorAll('.btn-del-maint').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.currentMaintenanceRows.splice(idx, 1);
      if (state.currentMaintenanceRows.length === 0) {
        state.currentMaintenanceRows.push({ facility: '-', exhaustNo: '-', period: '-', worker: '-', details: '-' });
      }
      renderMaintenanceTable();
      markUnsaved();
    });
  });
}

// ============================================================
// 3. 자가측정 결과 테이블 렌더링
// ============================================================
export function renderMeasurementTable() {
  measurementTableBody.innerHTML = '';
  state.currentMeasurementRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="exhaustNo" value="${row.exhaustNo || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="facilityName" value="${row.facilityName || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="item" value="${row.item || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="density" value="${row.density || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="dailyFlow" value="${row.dailyFlow || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="dailyEmission" value="${row.dailyEmission || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="device" value="${row.device || ''}"></td>
        <td><input type="text" class="editable-cell" data-idx="${index}" data-field="method" value="${row.method || ''}"></td>
        <td class="no-print">
          <button type="button" class="btn-delete btn-del-meas" data-idx="${index}" title="삭제">❌</button>
        </td>
      `;
    measurementTableBody.appendChild(tr);
  });

  measurementTableBody.querySelectorAll('input').forEach(elem => {
    elem.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      state.currentMeasurementRows[idx][field] = e.target.value;
      markUnsaved();
    });
  });

  measurementTableBody.querySelectorAll('.btn-del-meas').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.currentMeasurementRows.splice(idx, 1);
      if (state.currentMeasurementRows.length === 0) {
        state.currentMeasurementRows.push({ exhaustNo: '', facilityName: '', item: '', density: '', dailyFlow: '', dailyEmission: '', device: '', method: '' });
      }
      renderMeasurementTable();
      markUnsaved();
    });
  });
}

export function bindTableEvents() {
  // 배출구 행 추가 버튼
  btnAddExhaustRow.addEventListener('click', () => {
    const nextNum = state.currentExhaustList.length + 1;
    state.currentExhaustList.push({
      id: `${nextNum}`,
      facility: '혼합시설',
      opTime: '09:00 ~ 18:00',
      note: '정상'
    });
    renderExhaustTable();
    markUnsaved();
  });

  // 방지시설 운전사항 행 추가 버튼
  btnAddPreventionOpRow.addEventListener('click', () => {
    state.isPreventionExempt = false;
    state.currentPreventionOpRows.push({
      facility: '여과집진시설',
      location: '옥외',
      power: '',
      capacity: '',
      pollutant: '입자상물질(먼지)',
      density: '',
      efficiency: '',
      chemName: '-',
      chemAmount: '-'
    });
    renderPreventionOpTable();
    markUnsaved();
  });

  // 방지시설 면제/상세 토글 버튼
  btnTogglePreventionExempt.addEventListener('click', () => {
    state.isPreventionExempt = !state.isPreventionExempt;
    renderPreventionOpTable();
    markUnsaved();
  });

  // 보수사항 행 추가 버튼
  btnAddMaintenanceRow.addEventListener('click', () => {
    state.currentMaintenanceRows.push({
      facility: '여과집진시설',
      exhaustNo: '1',
      period: recordDateInput.value,
      worker: '자체',
      details: '필터 점검 및 청소'
    });
    renderMaintenanceTable();
    markUnsaved();
  });

  // 자가측정 행 추가 버튼 (완전한 빈칸 행으로 추가)
  btnAddMeasureRow.addEventListener('click', () => {
    state.currentMeasurementRows.push({
      exhaustNo: '',
      facilityName: '',
      item: '',
      density: '',
      dailyFlow: '',
      dailyEmission: '',
      device: '',
      method: ''
    });
    renderMeasurementTable();
    markUnsaved();
  });
}
