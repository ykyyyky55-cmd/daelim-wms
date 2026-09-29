/**
 * 대림 WMS 업무일지 → 구글 시트 (Google Apps Script 웹 앱)
 * ------------------------------------------------------------------
 * 앱 업무일지(본사·김포)의 [구글 시트로 보내기]가 이 웹 앱에 일지를 보내면
 *   1) 그 달의 업무일지 파일('(김포)9월 생산공급망 업무일지' 같은 월별 구글 시트)을 찾고
 *      - 없으면(달이 바뀌면) 지난달 파일을 같은 폴더에 복사해 이름의 'N월'을 바꾸고 가장 최근 날짜 탭 하나만 양식으로 남긴다
 *   2) 날짜 탭(MMDD)이 없으면 가장 가까운 이전 날짜 탭을 복사해 만들고(양식·서식·수식·드롭다운 그대로), 있으면 내용을 새로 쓴다
 *   3) 각 항목(■ 제품포장작업 … ■ 기타업무)의 머리줄 글자로 열을 찾아 입력 칸에만 쓴다. 수식 칸(초록색)은 건드리지 않고,
 *      줄이 모자라면 마지막 줄 서식을 복사해 줄을 늘린다 (총수량 합계 범위도 같이 늘어남)
 *
 * 설치 (회사 구글 계정, 한 번만)
 *   1) https://script.google.com → 새 프로젝트 → 이 코드를 모두 붙여넣고 저장
 *   2) 프로젝트 설정(⚙) → 스크립트 속성 → 추가:  TOKEN = (앱 시트 설정에 넣을 아무 긴 글자)
 *   3) 배포 → 새 배포 → 유형 '웹 앱' → 실행 사용자 '나' · 액세스 '모든 사용자' → 배포 → 권한 허용 → 웹 앱 URL 복사
 *   4) 앱 업무일지 → [시트 설정]에 웹 앱 URL·TOKEN·본사/김포 이번 달 시트 링크를 넣고 [연결 확인]
 *   코드를 고친 뒤에는 배포 → 배포 관리 → 수정 → 버전 '새 버전'으로 다시 배포해야 반영된다 (URL은 그대로).
 *
 * 스크립트 속성 FILE_<HQ|GIMPO>_<YYYY-MM> = 그 달 파일 ID (스크립트가 스스로 기록). 파일을 바꾸려면 이 값을 고치거나 지운다.
 */

var SECTIONS = [
  ['packaging', /제품포장/], ['labeling', /라벨부착/], ['oilBlending', /원액생산/], ['purchaseOrders', /구매발주/],
  ['receiving', /입고내역/], ['shipping', /출고내역/], ['movement', /이동제품/], ['courier', /택배/], ['otherTasks', /기타업무/]
];
// 머리줄 글자 → 열 이름 (앱 services/worklogImport.js와 같은 규칙)
var HEAD_KEYS = [
  ['item', /^(품명|업무명|구분)$/], ['spec', /용량|규격/], ['qty', /^수량/], ['box', /^박스/], ['unit', /^단위/],
  ['workHours', /^작업시간|^시간$/], ['workersCount', /인원/], ['totalWorkHours', /총작업시간|총시간/], ['line', /LINE|라인/i],
  ['lotNo', /LOT/i], ['category', /카테고리/], ['workers', /^작업자$/], ['manHours', /공수/], ['partner', /거래처/],
  ['inspector', /확인자|검수/], ['transport', /운송/], ['vehicle', /차량/], ['driver', /운반자/], ['notes', /^비고$/],
  ['packageType', /포장|용기/], ['count', /건수/]
];
var DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function doGet() { return out_({ ok: true, name: '대림 WMS 업무일지 시트' }); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var req = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) return out_({ ok: false, error: '토큰이 맞지 않습니다. 앱 시트 설정의 토큰과 스크립트 속성 TOKEN을 확인하세요.' });
    if (req.action === 'ping') return out_({ ok: true, user: Session.getEffectiveUser().getEmail() });
    return out_(writeLog_(req));
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* 잠금 없음 */ }
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function idOf_(url) { var m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/); return m ? m[1] : String(url || '').trim(); }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function dateTabs_(ss) {
  return ss.getSheets().filter(function (s) { return /^\d{4}$/.test(s.getName()); })
    .sort(function (a, b) { return b.getName().localeCompare(a.getName()); }); // 최신 먼저
}

// ---------- 그 달 파일 ----------
function monthFile_(site, ym, seedUrl) {
  var props = PropertiesService.getScriptProperties();
  var key = 'FILE_' + site + '_' + ym;
  var id = props.getProperty(key);
  if (id) {
    try { return { ss: SpreadsheetApp.openById(id), created: false }; } catch (e) { props.deleteProperty(key); }
  }
  var all = props.getProperties();
  var prev = Object.keys(all).filter(function (k) { return k.indexOf('FILE_' + site + '_') === 0 && k < key; }).sort();
  var srcId = prev.length ? all[prev[prev.length - 1]] : '';
  if (!srcId) {
    if (!seedUrl) throw new Error('이 거점의 기준 시트가 없습니다. 앱 업무일지 → [시트 설정]에 이번 달 구글 시트 링크를 넣으세요.');
    srcId = idOf_(seedUrl);
    var seed = SpreadsheetApp.openById(srcId);
    var mm = seed.getName().match(/(\d{1,2})월/);
    if (!mm) { props.setProperty(key, srcId); return { ss: seed, created: false }; }
    var y = Number(ym.slice(0, 4));
    var seedYm = y + '-' + pad_(Number(mm[1]));
    if (seedYm > ym) seedYm = (y - 1) + '-' + pad_(Number(mm[1])); // 1월 일지인데 기준이 12월 파일
    props.setProperty('FILE_' + site + '_' + seedYm, srcId);
    if (seedYm === ym) return { ss: seed, created: false };
  }
  // 새 달 파일: 이전 달 파일 복사 → 이름의 'N월' 바꾸기 → 가장 최근 날짜 탭만 양식으로 남김
  var src = DriveApp.getFileById(srcId);
  var mon = Number(ym.slice(5, 7));
  var name = /(\d{1,2})월/.test(src.getName()) ? src.getName().replace(/(\d{1,2})월/, mon + '월') : src.getName() + ' ' + ym;
  var parents = src.getParents();
  var copy = parents.hasNext() ? src.makeCopy(name, parents.next()) : src.makeCopy(name);
  var ss = SpreadsheetApp.openById(copy.getId());
  var tabs = dateTabs_(ss);
  tabs.slice(1).forEach(function (t) { ss.deleteSheet(t); });
  props.setProperty(key, copy.getId());
  props.setProperty('CREATED_' + copy.getId(), '1');
  return { ss: ss, created: true };
}

// ---------- 날짜 탭 ----------
function placeTab_(ss, sh) {
  var sheets = ss.getSheets();
  var pos = 1;
  sheets.forEach(function (s, i) {
    var n = s.getName();
    if (s.getSheetId() !== sh.getSheetId() && /^\d{4}$/.test(n) && n > sh.getName()) pos = Math.max(pos, i + 2);
  });
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(Math.min(pos, sheets.length));
}

function writeLog_(req) {
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜가 올바르지 않습니다: ' + date);
  var site = req.site === 'HQ' ? 'HQ' : 'GIMPO';
  var f = monthFile_(site, date.slice(0, 7), req.seedUrl);
  var ss = f.ss;
  var tab = date.slice(5, 7) + date.slice(8, 10);
  var sh = ss.getSheetByName(tab);
  var newTab = !sh;
  if (!sh) {
    var tabs = dateTabs_(ss);
    if (!tabs.length) throw new Error('양식으로 쓸 날짜 탭(MMDD)이 파일에 없습니다: ' + ss.getName());
    var tpl = tabs.filter(function (t) { return t.getName() < tab; })[0] || tabs[tabs.length - 1];
    sh = tpl.copyTo(ss).setName(tab);
    placeTab_(ss, sh);
  }
  fillSheet_(sh, date, req.sections || {});
  // 스크립트가 만든 새 달 파일이면 양식으로 남겨 둔 지난달 탭을 지운다
  if (PropertiesService.getScriptProperties().getProperty('CREATED_' + ss.getId())) {
    dateTabs_(ss).forEach(function (t) { if (t.getName().slice(0, 2) !== tab.slice(0, 2) && ss.getSheets().length > 1) ss.deleteSheet(t); });
  }
  SpreadsheetApp.flush();
  return { ok: true, fileName: ss.getName(), tab: tab, newTab: newTab, newFile: f.created, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

// ---------- 내용 쓰기 ----------
function headerMap_(row) {
  var map = {};
  row.forEach(function (cell, i) {
    var t = String(cell == null ? '' : cell).replace(/\r?\n/g, ' ').trim();
    if (!t) return;
    for (var j = 0; j < HEAD_KEYS.length; j++) {
      if (map[HEAD_KEYS[j][0]] === undefined && HEAD_KEYS[j][1].test(t)) { map[HEAD_KEYS[j][0]] = i; break; }
    }
  });
  return map;
}

function setDate_(sh, date) {
  var rows = Math.min(8, sh.getMaxRows());
  var vals = sh.getRange(1, 1, rows, sh.getMaxColumns()).getValues();
  var p = date.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  for (var r = 0; r < vals.length; r++) {
    for (var c = 0; c < vals[r].length; c++) {
      if (String(vals[r][c]).trim() !== '날짜') continue;
      // 오른쪽 첫 값 있는 칸(지금 날짜)을 바꾼다. 날짜 값이면 날짜로(서식 그대로), 글자면 같은 모양의 글자로
      for (var k = c + 1; k < vals[r].length; k++) {
        var v = vals[r][k];
        if (v === '' || v === null) continue;
        var cell = sh.getRange(r + 1, k + 1);
        if (cell.getFormula()) return;
        cell.setValue(v instanceof Date ? d : p[0] + '년 ' + p[1] + '월 ' + p[2] + '일 ' + DAYS[d.getDay()] + '요일');
        return;
      }
      sh.getRange(r + 1, c + 2).setValue(d);
      return;
    }
  }
}

function fillSheet_(sh, date, sections) {
  setDate_(sh, date);
  var vals = sh.getDataRange().getValues();
  var layout = [];
  var cur = null;
  for (var r = 0; r < vals.length; r++) {
    var c0 = String(vals[r][0] == null ? '' : vals[r][0]).trim();
    if (c0.indexOf('■') === 0) {
      var s = null;
      for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][1].test(c0)) { s = SECTIONS[i][0]; break; }
      cur = s ? { key: s, header: -1, first: -1, last: -1, done: false } : null;
      if (cur) layout.push(cur);
      continue;
    }
    if (!cur || cur.done) continue;
    if (cur.header < 0) {
      if (/^(품명|업무명|구분)$/.test(c0)) { cur.header = r; cur.map = headerMap_(vals[r]); }
      continue;
    }
    if (c0.indexOf('총수량') === 0 || c0.indexOf('합계') === 0) { cur.done = true; continue; }
    if (cur.first < 0) cur.first = r;
    cur.last = r;
  }
  var width = sh.getMaxColumns();
  // 아래 항목부터 써야 줄을 늘려도 위 항목 위치가 안 바뀐다
  layout.slice().reverse().forEach(function (L) {
    if (L.header < 0 || L.first < 0) return;
    var rows = sections[L.key] || [];
    var notes = L.key === 'courier' ? (sections.otherNotes || []) : [];
    var need = Math.max(rows.length, notes.length);
    var n = L.last - L.first + 1;
    if (need > n) {
      var add = need - n;
      sh.insertRowsBefore(L.last + 1, add); // 마지막 데이터 줄 앞에 넣어 총수량 합계 범위가 같이 늘어나게
      sh.getRange(L.last + 1 + add, 1, 1, width).copyTo(sh.getRange(L.last + 1, 1, add, width));
      n = need;
    }
    var top = L.first + 1;
    var writeCol = function (c, valueOf) {
      var rng = sh.getRange(top, c + 1, n, 1);
      var fs = rng.getFormulas();
      var vs = rng.getValues();
      var changed = false;
      for (var i = 0; i < n; i++) {
        if (fs[i][0]) { vs[i][0] = fs[i][0]; continue; } // 수식 칸은 그대로
        var v = valueOf(i);
        vs[i][0] = v === undefined || v === null ? '' : v;
        changed = true;
      }
      if (changed) rng.setValues(vs);
    };
    Object.keys(L.map).forEach(function (k) {
      writeCol(L.map[k], function (i) { return rows[i] ? rows[i][k] : ''; });
    });
    // 택배 오른쪽 기타 메모 (E열)
    if (L.key === 'courier' && L.map.notes !== 4 && L.map.item !== 4) {
      writeCol(4, function (i) { return notes[i] ? '- ' + notes[i] : ''; });
    }
  });
}
