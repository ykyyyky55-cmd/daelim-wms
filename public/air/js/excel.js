import { recordDateInput, btnExportExcel } from './dom.js';
import { collectFormData } from './editor.js';
import { getSelectedDates } from './search.js';
import { fetchAllAvailableRecords } from './recordStore.js';

/**
 * 브라우저 클라이언트에서 직접 ExcelJS를 사용하여 엑셀 파일을 생성하고 다운로드합니다.
 * @param {string} dateStr 
 */
export async function exportClientExcel(dateStr) {
  if (!window.ExcelJS) {
    alert('ExcelJS 라이브러리를 불러오지 못했습니다. 네트워크를 확인해주세요.');
    return;
  }

  btnExportExcel.disabled = true;
  btnExportExcel.textContent = '📊 엑셀 생성 중...';

  try {
    const data = collectFormData();
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = '대림 공조기록 시스템';
    const sheetName = dateStr.replace(/-/g, '').slice(4);
    const sheet = workbook.addWorksheet(sheetName);

    sheet.pageSetup = {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 2
    };

    sheet.columns = [
      { width: 5 }, { width: 5 }, { width: 5 }, { width: 7 },
      { width: 7 }, { width: 5 }, { width: 5 }, { width: 5 },
      { width: 5 }, { width: 5 }, { width: 5 }, { width: 6 },
      { width: 6 }, { width: 6 }, { width: 6 }, { width: 8 }
    ];

    // 제목
    sheet.mergeCells('A1:L3');
    const titleCell = sheet.getCell('A1');
    titleCell.value = '대기배출시설 및 방지시설 운영기록부';
    titleCell.font = { name: '맑은 고딕', size: 14, bold: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // 결재란
    sheet.mergeCells('M1:M3');
    sheet.getCell('M1').value = '결\n재';
    sheet.getCell('M1').alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.getCell('N1').value = '담당';
    sheet.getCell('O1').value = '부서장';
    sheet.getCell('P1').value = '환경기술인';

    // 일자/날씨
    sheet.mergeCells('A4:P4');
    const weatherText = data.weatherInfo ? `${data.weatherInfo.weather || '맑음'} (기온: ${data.weatherInfo.temp || '-'})` : '맑음';
    sheet.getCell('A4').value = `■ 작성일자: ${data.formattedDate || dateStr}   |   ■ 날씨: ${weatherText}`;
    sheet.getCell('A4').font = { bold: true };

    // 1. 배출시설 운전사항
    sheet.mergeCells('A6:P6');
    sheet.getCell('A6').value = '1. 배출시설 운전사항';
    sheet.getCell('A6').font = { bold: true };

    sheet.mergeCells('A7:B7'); sheet.getCell('A7').value = '배출구';
    sheet.mergeCells('C7:H7'); sheet.getCell('C7').value = '배출시설명';
    sheet.mergeCells('I7:M7'); sheet.getCell('I7').value = '가동시간';
    sheet.mergeCells('N7:P7'); sheet.getCell('N7').value = '비고';

    let rIdx = 8;
    (data.exhaustList || []).forEach(item => {
      sheet.mergeCells(`A${rIdx}:B${rIdx}`); sheet.getCell(`A${rIdx}`).value = item.id + '번';
      sheet.mergeCells(`C${rIdx}:H${rIdx}`); sheet.getCell(`C${rIdx}`).value = item.facility;
      sheet.mergeCells(`I${rIdx}:M${rIdx}`); sheet.getCell(`I${rIdx}`).value = item.opTime;
      sheet.mergeCells(`N${rIdx}:P${rIdx}`); sheet.getCell(`N${rIdx}`).value = item.note;
      rIdx++;
    });

    // 2. 방지시설 운전사항
    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`);
    sheet.getCell(`A${rIdx}`).value = '2. 방지시설 운전사항 (면제)';
    sheet.getCell(`A${rIdx}`).font = { bold: true };
    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`);
    sheet.getCell(`A${rIdx}`).value = '방지시설 설치 면제 사업장 (기록 생략)';
    sheet.getCell(`A${rIdx}`).alignment = { horizontal: 'center' };
    rIdx += 2;

    // 3. 자가측정사항
    sheet.mergeCells(`A${rIdx}:P${rIdx}`);
    sheet.getCell(`A${rIdx}`).value = '3. 자가측정사항';
    sheet.getCell(`A${rIdx}`).font = { bold: true };
    rIdx++;
    sheet.mergeCells(`A${rIdx}:B${rIdx}`); sheet.getCell(`A${rIdx}`).value = '배출구';
    sheet.mergeCells(`C${rIdx}:F${rIdx}`); sheet.getCell(`C${rIdx}`).value = '오염물질';
    sheet.mergeCells(`G${rIdx}:I${rIdx}`); sheet.getCell(`G${rIdx}`).value = '농도';
    sheet.mergeCells(`J${rIdx}:L${rIdx}`); sheet.getCell(`J${rIdx}`).value = '유량';
    sheet.mergeCells(`M${rIdx}:P${rIdx}`); sheet.getCell(`M${rIdx}`).value = '측정방법';
    rIdx++;

    (data.selfMeasurement && data.selfMeasurement.rows ? data.selfMeasurement.rows : []).forEach(row => {
      sheet.mergeCells(`A${rIdx}:B${rIdx}`); sheet.getCell(`A${rIdx}`).value = row.exhaustNo || '-';
      sheet.mergeCells(`C${rIdx}:F${rIdx}`); sheet.getCell(`C${rIdx}`).value = row.item || '-';
      sheet.mergeCells(`G${rIdx}:I${rIdx}`); sheet.getCell(`G${rIdx}`).value = row.density || '-';
      sheet.mergeCells(`J${rIdx}:L${rIdx}`); sheet.getCell(`J${rIdx}`).value = row.dailyFlow || '-';
      sheet.mergeCells(`M${rIdx}:P${rIdx}`); sheet.getCell(`M${rIdx}`).value = row.method || '-';
      rIdx++;
    });

    // 4. 기술인 의견
    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`);
    sheet.getCell(`A${rIdx}`).value = '4. 환경기술인 의견 및 특이사항';
    sheet.getCell(`A${rIdx}`).font = { bold: true };
    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`);
    sheet.getCell(`A${rIdx}`).value = data.engineerOpinion || '특이사항 없음. 정상 가동.';

    // 테두리 스타일 적용
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.font) cell.font = { name: '맑은 고딕', size: 9 };
        if (!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = `대기배출시설_운영기록부_${dateStr}.xlsx`;
    
    if (window.saveAs) {
      window.saveAs(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error('브라우저 엑셀 다운로드 오류:', err);
    alert('엑셀 파일 생성 중 오류가 발생했습니다: ' + err.message);
  } finally {
    btnExportExcel.disabled = false;
    btnExportExcel.textContent = '📊 엑셀 다운로드';
  }
}

// ============================================================
// 일괄 엑셀 (Batch Excel - 다중 시트) 다운로드
// ============================================================
export const btnModalBatchExcel = document.getElementById('btnModalBatchExcel');
export const btnBatchExcelCurrent = document.getElementById('btnBatchExcelCurrent');

export async function executeBatchExcel() {
  const selectedDates = getSelectedDates();
  if (selectedDates.length === 0) {
    alert('일괄 엑셀로 내보낼 일자를 1개 이상 선택해주세요.');
    return;
  }

  if (!window.ExcelJS) {
    alert('ExcelJS 라이브러리가 로드되지 않았습니다.');
    return;
  }

  const allRecords = await fetchAllAvailableRecords();
  const recordsMap = new Map(allRecords.map(r => [r.date, r]));

  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = '대림 공조기록 시스템';

  for (const dateStr of selectedDates) {
    const data = recordsMap.get(dateStr) || { date: dateStr };
    const sheetName = dateStr.replace(/-/g, '').slice(4);
    const sheet = workbook.addWorksheet(sheetName);

    sheet.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 2 };
    sheet.columns = [
      { width: 5 }, { width: 5 }, { width: 5 }, { width: 7 },
      { width: 7 }, { width: 5 }, { width: 5 }, { width: 5 },
      { width: 5 }, { width: 5 }, { width: 5 }, { width: 6 },
      { width: 6 }, { width: 6 }, { width: 6 }, { width: 8 }
    ];

    sheet.mergeCells('A1:L3');
    const titleCell = sheet.getCell('A1');
    titleCell.value = '대기배출시설 및 방지시설 운영기록부';
    titleCell.font = { name: '맑은 고딕', size: 14, bold: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.mergeCells('M1:M3');
    sheet.getCell('M1').value = '결\n재';
    sheet.getCell('M1').alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.getCell('N1').value = '담당';
    sheet.getCell('O1').value = '부서장';
    sheet.getCell('P1').value = '환경기술인';

    sheet.mergeCells('A4:P4');
    const weatherText = data.weatherInfo ? `${data.weatherInfo.weather || '맑음'} (기온: ${data.weatherInfo.temp || '-'})` : '맑음';
    sheet.getCell('A4').value = `■ 작성일자: ${data.formattedDate || dateStr}   |   ■ 날씨: ${weatherText}`;
    sheet.getCell('A4').font = { bold: true };

    sheet.mergeCells('A6:P6'); sheet.getCell('A6').value = '1. 배출시설 운전사항'; sheet.getCell('A6').font = { bold: true };
    sheet.mergeCells('A7:B7'); sheet.getCell('A7').value = '배출구';
    sheet.mergeCells('C7:H7'); sheet.getCell('C7').value = '배출시설명';
    sheet.mergeCells('I7:M7'); sheet.getCell('I7').value = '가동시간';
    sheet.mergeCells('N7:P7'); sheet.getCell('N7').value = '비고';

    let rIdx = 8;
    (data.exhaustList || []).forEach(item => {
      sheet.mergeCells(`A${rIdx}:B${rIdx}`); sheet.getCell(`A${rIdx}`).value = item.id + '번';
      sheet.mergeCells(`C${rIdx}:H${rIdx}`); sheet.getCell(`C${rIdx}`).value = item.facility;
      sheet.mergeCells(`I${rIdx}:M${rIdx}`); sheet.getCell(`I${rIdx}`).value = item.opTime;
      sheet.mergeCells(`N${rIdx}:P${rIdx}`); sheet.getCell(`N${rIdx}`).value = item.note;
      rIdx++;
    });

    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`); sheet.getCell(`A${rIdx}`).value = '2. 방지시설 운전사항 (면제)'; sheet.getCell(`A${rIdx}`).font = { bold: true };
    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`); sheet.getCell(`A${rIdx}`).value = '방지시설 설치 면제 사업장 (기록 생략)';
    sheet.getCell(`A${rIdx}`).alignment = { horizontal: 'center' };
    rIdx += 2;

    sheet.mergeCells(`A${rIdx}:P${rIdx}`); sheet.getCell(`A${rIdx}`).value = '3. 환경기술인 의견 및 특이사항'; sheet.getCell(`A${rIdx}`).font = { bold: true };
    rIdx++;
    sheet.mergeCells(`A${rIdx}:P${rIdx}`); sheet.getCell(`A${rIdx}`).value = data.engineerOpinion || (data.isHoliday ? '휴무' : '미가동');

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.font) cell.font = { name: '맑은 고딕', size: 9 };
        if (!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `대기배출운영기록부_일괄_${selectedDates.length}건.xlsx`;
  if (window.saveAs) {
    window.saveAs(blob, filename);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export function bindExcelEvents() {
  btnExportExcel.addEventListener('click', async () => {
    const dateStr = recordDateInput.value;
    // WMS에 넣은 사본에는 로컬 서버가 없으므로 항상 브라우저에서 엑셀을 만든다
    const isLocalhost = !window.AIR_EMBEDDED && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    // 로컬 서버 실행 중이면 백엔드 다운로드 시도
    if (isLocalhost) {
      try {
        window.location.href = `/api/export/excel/${dateStr}`;
        return;
      } catch (e) {
        // 실패 시 브라우저 직접 생성으로 이동
      }
    }

    // 웹 클라우드(GitHub Pages 등) 또는 오프라인 환경: 브라우저 직접 엑셀 생성
    await exportClientExcel(dateStr);
  });

  if (btnModalBatchExcel) btnModalBatchExcel.addEventListener('click', executeBatchExcel);
  if (btnBatchExcelCurrent) btnBatchExcelCurrent.addEventListener('click', executeBatchExcel);
}
