import { getFormattedDateString } from './utils.js';

// ============================================================
// 양식 렌더링 헬퍼 함수 (일괄 열람, 책 넘김 바인더 및 인쇄 전용)
// ============================================================
export function getRecordPagesHtml(record, isForPrint = false) {
  const pageClass = isForPrint ? 'batch-print-page' : 'a4-sheet';
  const dateFormatted = record.formattedDate || getFormattedDateString(record.date);
  const weather = record.weatherInfo ? record.weatherInfo.weather || '맑음' : '맑음';
  const temp = record.weatherInfo ? record.weatherInfo.temp || '15 ~ 25℃' : '15 ~ 25℃';

  const chargeSignImg = record.chargeSign ? `<img src="${record.chargeSign}" class="electronic-sign-img" alt="담당">` : '';
  const managerSignImg = record.managerSign ? `<img src="${record.managerSign}" class="electronic-sign-img" alt="부서장">` : '';
  const techSignImg = record.technicianSign ? `<img src="${record.technicianSign}" class="electronic-sign-img" alt="환경기술인">` : '';

  const exhaustRowsHtml = (record.exhaustList && record.exhaustList.length > 0 ? record.exhaustList : [
    { id: '1', facility: '혼합시설', opTime: '-', note: record.isHoliday ? '휴무' : '미가동' },
    { id: '2', facility: '혼합시설', opTime: '-', note: record.isHoliday ? '휴무' : '미가동' },
    { id: '3', facility: '혼합시설', opTime: '-', note: record.isHoliday ? '휴무' : '미가동' },
    { id: '4', facility: '혼합시설', opTime: '-', note: record.isHoliday ? '휴무' : '미가동' }
  ]).map(e => `
      <tr>
        <td style="font-weight: 600;">${e.id}</td>
        <td>${e.facility || '혼합시설'}</td>
        <td>${e.opTime || '-'}</td>
        <td style="font-weight: 600;">${e.note || '-'}</td>
      </tr>
    `).join('');

  const isExempt = record.preventionOperation ? (record.preventionOperation.exempt !== undefined ? record.preventionOperation.exempt : true) : true;
  let preventionHtml = '';
  if (isExempt) {
    preventionHtml = `
        <tr class="exempt-row">
          <td colspan="9" style="padding: 10px; font-weight: 600; color: #475569; background-color: #f8fafc; text-align: center;">
            ※ 방지시설 설치 면제 사업장 (기록 생략)
          </td>
        </tr>
      `;
  } else {
    const pRows = record.preventionOperation && record.preventionOperation.rows ? record.preventionOperation.rows : [];
    if (pRows.length === 0) {
      preventionHtml = `
          <tr>
            <td>혼합방지시설</td>
            <td>1층</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
          </tr>
        `;
    } else {
      preventionHtml = pRows.map(r => `
          <tr>
            <td>${r.facilityName || '-'}</td>
            <td>${r.location || '-'}</td>
            <td>${r.power || '-'}</td>
            <td>${r.capacity || '-'}</td>
            <td>${r.pollutant || '-'}</td>
            <td>${r.density || '-'}</td>
            <td>${r.efficiency || '-'}</td>
            <td>${r.chemical || '-'}</td>
            <td>${r.usage || '-'}</td>
          </tr>
        `).join('');
    }
  }

  // 앞면(Front Sheet): 상단 요소를 wrapper div로 감싸고 제목줄-표 간격 최소화
  const frontHtml = `
      <article class="${pageClass}">
        <div class="sheet-badge">양식 1 : 배출시설 운영기록부 (앞면) - ${record.date}</div>
        <div>
          <!-- 타이틀 및 결재란 -->
          <div class="form-title-row" style="margin-bottom: 6px;">
            <div class="form-title">대기배출시설 및 방지시설 운영기록부</div>
            <table class="approval-table">
              <tr>
                <th rowspan="2" class="approval-header"><div class="vertical-text"><span>결</span><span>재</span></div></th>
                <th class="approval-role">담당</th>
                <th class="approval-role">부서장</th>
              </tr>
              <tr>
                <td class="approval-sign">${chargeSignImg}</td>
                <td class="approval-sign">${managerSignImg}</td>
              </tr>
            </table>
          </div>

          <!-- 일자 및 날씨/온도 정보 (아래 표와의 여백 최소화) -->
          <div class="info-box-table" style="margin-bottom: 6px;">
            <div class="info-date-cell">${dateFormatted}</div>
            <div class="info-weather-cell">
              <span>날씨 : ${weather}</span>
              <span style="margin-left: 15px;">온도 : ${temp}</span>
            </div>
          </div>

          <!-- 1. 배출구별 주요 배출시설 및 방지시설 가동(조업)시간 (위/아래 여백 최소화) -->
          <div class="section-title" style="margin: 6px 0 3px 0;">
            <span>1. 배출구별 주요 배출시설 및 방지시설 가동(조업)시간</span>
          </div>
          <table class="sheet-table" style="margin-top: 0; margin-bottom: 2px;">
            <thead>
              <tr>
                <th style="width: 14%;">배출구</th>
                <th style="width: 28%;">배출시설</th>
                <th style="width: 32%;">가동시간</th>
                <th style="width: 26%;">비고</th>
              </tr>
            </thead>
            <tbody>${exhaustRowsHtml}</tbody>
          </table>
          <div class="sub-note" style="margin-top: 2px; margin-bottom: 6px; font-size: 0.8rem;">* 비고란은 정상 여부를 기재합니다.</div>

          <!-- 2. 방지시설 운영사항 (위/아래 여백 최소화) -->
          <div class="section-title" style="margin: 6px 0 3px 0;">
            <span>2. 방지시설 운영사항</span>
          </div>
          <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 2px;">가. 방지시설 운전사항</div>
          <table class="sheet-table" id="preventionOpTable" style="margin-top: 0; margin-bottom: 0;">
            <thead>
              <tr>
                <th rowspan="2" style="width: 12%;">방 지<br>시설명</th>
                <th rowspan="2" style="width: 8%;">설치<br>위치</th>
                <th style="width: 10%;">전력사용량</th>
                <th style="width: 10%;">처리용량</th>
                <th rowspan="2" style="width: 11%;">처리오염<br>물 질</th>
                <th rowspan="2" style="width: 14%;">처리농도<br>(ppm, ㎎/S㎥)</th>
                <th style="width: 11%; white-space: nowrap;">처리효율</th>
                <th colspan="2" style="width: 24%;">사용약품</th>
              </tr>
              <tr>
                <th>(㎾/h)</th>
                <th>(㎥/min)</th>
                <th>(%)</th>
                <th style="width: 12%; white-space: nowrap;">약품명</th>
                <th style="width: 12%; white-space: nowrap;">사용량</th>
              </tr>
            </thead>
            <tbody>${preventionHtml}</tbody>
          </table>
        </div>

        <!-- 하단 용지 규격 표기 -->
        <div class="footer-standard">210㎜×297㎜(신문용지 54g/㎡)</div>
      </article>
    `;

  // 뒷면(Back Sheet): 상단 요소를 wrapper div로 감싸고 나목 보수사항 및 자가측정 단일표 여백 최소화
  const selfWeather = (record.selfMeasurement && record.selfMeasurement.weather) ? record.selfMeasurement.weather : weather;
  const selfTemp = (record.selfMeasurement && record.selfMeasurement.temp) ? record.selfMeasurement.temp : '';
  const selfHumidity = (record.selfMeasurement && record.selfMeasurement.humidity) ? record.selfMeasurement.humidity : '';
  const selfPressure = (record.selfMeasurement && record.selfMeasurement.pressure) ? record.selfMeasurement.pressure : '';
  const selfWindDir = (record.selfMeasurement && record.selfMeasurement.windDir) ? record.selfMeasurement.windDir : '';
  const selfWindSpeed = (record.selfMeasurement && record.selfMeasurement.windSpeed) ? record.selfMeasurement.windSpeed : '';
  const measureDate = (record.selfMeasurement && record.selfMeasurement.measureDate) ? record.selfMeasurement.measureDate : record.date;
  const techName = (record.technician && record.technician.name) ? record.technician.name : '윤 경 용';
  const techPos = (record.technician && record.technician.position) ? record.technician.position : '부장';

  const measureRows = (record.selfMeasurement && record.selfMeasurement.rows && record.selfMeasurement.rows.length > 0)
    ? record.selfMeasurement.rows
    : [{ exhaustNo: '-', facilityName: '-', item: '-', density: '-', dailyFlow: '-', dailyEmission: '-', inspectionDevice: '-', method: '-' }];

  const measureRowsHtml = measureRows.map(r => `
      <tr>
        <td>${r.exhaustNo || '-'}</td>
        <td>${r.facilityName || '-'}</td>
        <td>${r.item || '-'}</td>
        <td>${r.density || '-'}</td>
        <td>${r.dailyFlow || '-'}</td>
        <td>${r.dailyEmission || '-'}</td>
        <td>${r.inspectionDevice || '-'}</td>
        <td colspan="2">${r.method || '-'}</td>
      </tr>
    `).join('');

  const backHtml = `
      <article class="${pageClass}">
        <div class="sheet-badge">양식 2 : 방지시설 및 자가측정 (뒷면) - ${record.date}</div>
        <div>
          <div class="back-header" style="text-align: right; font-size: 0.85rem; font-weight: 700; color: #64748b; margin-bottom: 2px;">(뒤 쪽)</div>

          <!-- 나. 방지시설 보수사항 (위/아래 여백 최소화) -->
          <div class="section-title" style="margin: 4px 0 2px 0;">
            <span>나. 방지시설 보수사항</span>
          </div>
          <table class="sheet-table" style="margin-top: 0; margin-bottom: 4px;">
            <thead>
              <tr>
                <th style="width: 20%;">방지시설명</th>
                <th style="width: 18%;">배 출 구 별</th>
                <th style="width: 18%;">보 수 기 간</th>
                <th style="width: 16%;">보 수 자</th>
                <th style="width: 28%;">보 수 명 세</th>
              </tr>
            </thead>
            <tbody>
              <tr class="exempt-row">
                <td colspan="5" style="padding: 8px; font-weight: 600; color: #475569; background-color: #f8fafc; text-align: center;">
                  ※ 방지시설 설치 면제 사업장 (보수 내역 없음)
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 3. 자가측정사항 (위/아래 여백 최소화) -->
          <div class="section-title" style="margin: 4px 0 2px 0;">
            <span>3. 자가측정사항</span>
          </div>
          <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 2px;">
            측정일: <span style="font-weight: normal;">${measureDate}</span>
          </div>

          <!-- 3개 표를 여백없이 1개로 통합한 자가측정 및 원료/연료 통합 테이블 -->
          <table class="sheet-table" style="margin-top: 2px; margin-bottom: 0;">
            <thead>
              <!-- 1. 기상 조건 헤더 -->
              <tr>
                <th colspan="2" style="width: 26%;">①기 상</th>
                <th style="width: 12%;">②기온</th>
                <th style="width: 17%;">③습도</th>
                <th style="width: 12%;">④기압</th>
                <th style="width: 12%;">⑤풍향</th>
                <th colspan="3" style="width: 21%;">⑥풍속</th>
              </tr>
            </thead>
            <tbody>
              <!-- 1-1. 기상 조건 데이터 행 -->
              <tr>
                <td colspan="2" style="text-align: center;">${selfWeather}</td>
                <td>${selfTemp ? selfTemp + '℃' : '-'}</td>
                <td>${selfHumidity ? selfHumidity + '%' : '-'}</td>
                <td>${selfPressure ? selfPressure + 'mb' : '-'}</td>
                <td>${selfWindDir ? selfWindDir + '풍' : '-'}</td>
                <td colspan="3">${selfWindSpeed ? selfWindSpeed + 'm/s' : '-'}</td>
              </tr>

              <!-- 2. 자가측정 결과 헤더 행 -->
              <tr>
                <th style="width: 10%;">⑦배출구<br>번 호</th>
                <th style="width: 16%;">⑧주요배출<br>시 설 명</th>
                <th style="width: 12%;">⑨측 정<br>항 목</th>
                <th style="width: 17%;">⑩측정농도<br>(ppm, ㎎/S㎥)</th>
                <th style="width: 12%;">⑪일일유량<br>(S㎥/일)</th>
                <th style="width: 12%;">⑫일일배출량<br>(㎏/일)</th>
                <th style="width: 11%;">⑬검 사<br>기기명</th>
                <th colspan="2" style="width: 10%;">⑭검 사<br>방 법</th>
              </tr>

              <!-- 2-1. 측정 결과 데이터 행 -->
              ${measureRowsHtml}

              <!-- 3. 원료 및 연료 사용량 섹션 -->
              <tr>
                <th colspan="3">
                  <div>⑮연  료  명    및    사  용  량</div>
                </th>
                <td colspan="6">${record.fuelUsage || '-'}</td>
              </tr>
              <tr>
                <th colspan="3">⑯원 료 명 및 사 용 량<br><span style="font-size:0.7rem; font-weight:normal;">(특정대기유해물질 배출원 포함)</span></th>
                <td colspan="6">${record.rawMaterialUsage || '-'}</td>
              </tr>
              <tr>
                <th colspan="3">⑰환 경 기 술 인 의 의 견</th>
                <td colspan="6" style="text-align: left; padding: 4px 8px;">${record.engineerOpinion || '특이사항 없음. 정상 가동.'}</td>
              </tr>
              <tr>
                <th colspan="3">⑱기 타</th>
                <td colspan="6" style="text-align: left; padding: 4px 8px;">${record.etc || '-'}</td>
              </tr>
              <!-- 환경기술인 서명란 -->
              <tr>
                <td colspan="9" class="engineer-box-cell" style="padding: 4px 10px;">
                  <div class="engineer-distributed-box" style="display: flex; justify-content: space-around; align-items: center;">
                    <div class="eng-item">
                      <span>환경기술인 직급 : </span><strong>${techPos}</strong>
                    </div>
                    <div class="eng-item">
                      <span>성명 : </span><strong>${techName}</strong>
                    </div>
                    <div class="eng-item">
                      <div class="technician-sign-slot" style="display: inline-block;">
                        ${techSignImg || '<span class="stamp-bracket">(인)</span>'}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 하단 작성 요령 법적 안내문 -->
        <div class="law-guide" style="margin-top: 10px;">
          <strong>※ 작성요령</strong>
          <ol style="margin-top: 2px;">
            <li>「대기환경보전법」 제39조에 따라 「환경분야 시험·검사 등에 관한 법률」에 따른 측정대행업자에게 해당 오염물질 전부를 위탁하여 측정하도록 하는 경우에는 제3호란을 작성하지 아니할 수 있습니다.</li>
            <li>방지시설의 설치를 면제받은 사업장은 제2호와 제3호란을 작성하지 아니할 수 있습니다.</li>
            <li>제2호나목의 방지시설 보수사항은 별도의 계약서나 지출증빙서로 갈음할 수 있습니다.</li>
          </ol>
        </div>
      </article>
    `;

  return { frontHtml, backHtml };
}

export function buildSheetsHtmlForRecord(record, isForPrint = false) {
  const pages = getRecordPagesHtml(record, isForPrint);
  return pages.frontHtml + pages.backHtml;
}
