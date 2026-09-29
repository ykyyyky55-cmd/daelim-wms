import { state, WORKLOG_SITES, getGimpoLogByDate, saveGimpoLog, applyGimpoLogToInventory, checkGimpoLogSyncStatus, getGimpoSyncStatistics, syncAllUnsyncedGimpoLogs } from '../services/db.js';
import { localDateStr } from '../services/searchUtils.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { mountApprovalBox, approvalPrintHtml } from './approval/ApprovalBox.js';
import { readWorklogFile, readWorklogGoogleSheet } from '../services/worklogImport.js';
import { loadSheetConfig, saveSheetConfig, pingSheet, sendWorklogToSheet } from '../services/worklogSheets.js';
import { canPerformAction } from '../services/auth.js';

// 전자결재: 거점·날짜별 일지 하나에 결재 칸 하나 (doc_key LOG:<HQ|GIMPO>:<날짜>)
const LOG_APPR_ROLES = ['담당', '검토', '확인'];

// 업무일지(생산): 본사·김포가 같은 양식. site = 'HQ' | 'GIMPO' (탭 hqLog / gimpoLog)
// 화면 상태(보던 날짜·섹션·월 필터)는 거점마다 따로 기억한다.
const SITE_UI = {
    HQ: { fullName: '본사', badge: '대림오일 본사', moveLabel: '본사 ⇄ 김포', moveDesc: '본사에서 완제품/부자재/원액을 김포공장으로 이송', lotPrefix: 'H' },
    GIMPO: { fullName: '김포공장', badge: '대림오일 김포공장', moveLabel: '김포 ⇄ 본사', moveDesc: '김포공장에서 완제품/부자재/원액을 본사로 이송', lotPrefix: 'G' }
};
const SITE_STATE = {
    HQ: { currentDateStr: '', currentActiveSection: 'packaging', selectedMonthFilter: '' },
    GIMPO: { currentDateStr: '2026-09-22', currentActiveSection: 'packaging', selectedMonthFilter: '09' }
};
let SITE = 'GIMPO';
let currentDateStr = SITE_STATE.GIMPO.currentDateStr;
let currentActiveSection = SITE_STATE.GIMPO.currentActiveSection; // packaging, labeling, oilBlending, inOut, movement, courier, otherTasks
let selectedMonthFilter = SITE_STATE.GIMPO.selectedMonthFilter; // 'ALL' 또는 'MM'
const CFG = () => ({ ...WORKLOG_SITES[SITE], ...SITE_UI[SITE] });

// 업무 항목 1~7. '전체 펼치기'면 탭 대신 모든 항목을 위아래로 펼쳐 보이고, 항목 머리줄로 하나씩 접는다.
// 펼침 여부와 접은 항목은 기기별로 기억한다(본사·김포 공통).
const SECTION_DEFS = [
    { key: 'packaging', icon: 'package-check', color: '', title: '1. 제품포장작업', count: (l) => (l.packaging || []).length },
    { key: 'oilBlending', icon: 'flask-conical', color: 'text-sky-600', title: '2. 원액생산작업', count: (l) => (l.oilBlending || []).length },
    { key: 'labeling', icon: 'tag', color: 'text-indigo-600', title: '3. 라벨부착작업', count: (l) => (l.labeling || []).length },
    { key: 'movement', icon: 'truck', color: 'text-amber-600', title: '4. 이동제품', count: (l) => (l.movement || []).length },
    { key: 'inOut', icon: 'arrow-left-right', color: 'text-emerald-600', title: '5. 입고·출고·구매발주', count: (l) => (l.receiving || []).length + (l.shipping || []).length + (l.purchaseOrders || []).length },
    { key: 'courier', icon: 'box', color: 'text-teal-600', title: '6. 택배출고 및 특이사항', count: null },
    { key: 'otherTasks', icon: 'clipboard-list', color: 'text-purple-600', title: '7. 기타업무·공수', count: (l) => (l.otherTasks || []).length }
];
const EXPAND_KEY = 'daelim_worklog_expand_all';
const COLLAPSED_KEY = 'daelim_worklog_collapsed';
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } };
let expandAll = !!readJson(EXPAND_KEY, false);
const collapsedSections = new Set(readJson(COLLAPSED_KEY, []));
const logsList = () => state[WORKLOG_SITES[SITE].stateKey] || [];
const getLog = (d) => getGimpoLogByDate(d, SITE);
const saveLog = (log) => saveGimpoLog(log, SITE);

export const renderProductionLog = (container, { showToast, site = SITE }) => {
    if (site !== SITE) {
        SITE_STATE[SITE] = { currentDateStr, currentActiveSection, selectedMonthFilter };
        SITE = WORKLOG_SITES[site] ? site : 'GIMPO';
        ({ currentDateStr, currentActiveSection, selectedMonthFilter } = SITE_STATE[SITE]);
    }
    if (!currentDateStr) currentDateStr = localDateStr();
    // 다른 화면(실적 현황판 등)에서 특정 거점·날짜로 이동: window.__worklogInitialDate = { site, date }
    if (window.__worklogInitialDate?.site === SITE && window.__worklogInitialDate.date) {
        currentDateStr = window.__worklogInitialDate.date;
        selectedMonthFilter = currentDateStr.slice(5, 7);
        window.__worklogInitialDate = null;
        window.__gimpoInitialDate = null;
    }
    // 외부에서 특정 날짜로 점프 요청이 들어온 경우 처리 (김포 일지)
    if (SITE === 'GIMPO' && window.__gimpoInitialDate) {
        currentDateStr = window.__gimpoInitialDate;
        if (currentDateStr.includes('-')) {
            const m = currentDateStr.split('-')[1];
            selectedMonthFilter = m;
        }
        window.__gimpoInitialDate = null;
    }

    // 사용 가능한 일자 목록
    const availableLogs = logsList().slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (availableLogs.length > 0 && !logsList().find(l => l.date === currentDateStr)) {
        currentDateStr = availableLogs[0].date;
    }
    // 월 필터: 일지가 있는 달들 (없는 달이 골라져 있으면 보는 날짜의 달로)
    const monthKeys = [...new Set(availableLogs.map(l => (l.date || '').slice(5, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    if (selectedMonthFilter !== 'ALL' && !monthKeys.includes(selectedMonthFilter)) selectedMonthFilter = currentDateStr.slice(5, 7);
    const cfg = CFG();

    // 월별 필터링된 일지 목록
    const filteredChips = availableLogs.filter(l => {
        if (selectedMonthFilter === 'ALL') return true;
        return l.date && l.date.includes(`-${selectedMonthFilter}-`);
    });

    const currentLog = getLog(currentDateStr);
    const syncStatus = checkGimpoLogSyncStatus(currentLog, SITE);
    const overallSyncStats = getGimpoSyncStatistics(SITE);

    // KPI 합계 계산
    const packQty = (currentLog.packaging || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    const packBoxes = (currentLog.packaging || []).reduce((sum, r) => sum + (Number(r.box) || 0), 0);
    const packManHours = (currentLog.packaging || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);

    const labelQty = (currentLog.labeling || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    const labelManHours = (currentLog.labeling || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);

    const oilQty = (currentLog.oilBlending || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    const oilManHours = (currentLog.oilBlending || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);

    const moveCount = (currentLog.movement || []).length;
    const moveQty = (currentLog.movement || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

    const otherManHours = (currentLog.otherTasks || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);
    const totalDayManHours = (packManHours + labelManHours + oilManHours + otherManHours).toFixed(2);

    container.innerHTML = `
    <section id="tab-content-production" class="space-y-6">
        <!-- 1. 최상단 제어 바 & 결재 라인 & 수불부 동기화 현황 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 no-print">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200">${esc(cfg.badge)}</span>
                        <span class="text-xs text-slate-500 font-mono">생산공급망 실시간 원장</span>
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                            syncStatus.isSynced ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }">
                            ${syncStatus.isSynced ? '✅ 수불부 반영완료' : '⚠️ 수불부 미반영'}
                        </span>
                        ${currentLog.sheetSent?.at ? `<a href="${esc(currentLog.sheetSent.url || '#')}" target="_blank" rel="noopener" class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-green-100 text-green-800 border border-green-300 hover:bg-green-200" title="${esc(currentLog.sheetSent.file || '')}">📤 시트 보냄 ${esc(String(currentLog.sheetSent.at).slice(5, 16).replace('T', ' '))} · ${esc(currentLog.sheetSent.tab || '')}</a>` : ''}
                    </div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="factory" class="w-5 h-5 text-blue-600"></i>
                        <span>업무일지(${esc(cfg.name)}) · ${esc(cfg.fullName)} 생산공급망 일일 업무일지</span>
                    </h2>
                    <p class="text-xs text-slate-500">제품포장·원액생산·라벨부착·입출고·거점이동(본사 ⇄ 김포) 실적 관리 및 WMS 재고 자동 연동</p>
                </div>

                <!-- 전자결재 (빈 칸을 누르면 로그인한 사람의 전자서명) -->
                <div id="log-appr"></div>

                <!-- 상단 액션 버튼 그룹 -->
                <div class="flex items-center flex-wrap gap-2">
                    <!-- 개별 일지 수불부 반영 버튼 (반영 완료 일지는 중복 반영 방지를 위해 비활성화) -->
                    <button type="button" id="btn-apply-to-stock" ${syncStatus.isSynced ? 'disabled title="이미 반영된 일지입니다. 다시 반영하면 입출고가 중복 기록되므로 비활성화되어 있습니다."' : ''} class="px-3.5 py-2 ${
                        syncStatus.isSynced
                            ? 'bg-slate-100 text-emerald-800 border border-emerald-300 cursor-not-allowed opacity-80'
                            : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm'
                    } rounded-xl text-xs font-black transition flex items-center gap-1.5">
                        <i data-lucide="${syncStatus.isSynced ? 'check-circle' : 'check-check'}" class="w-4 h-4"></i>
                        <span>${syncStatus.isSynced ? '수불부 반영완료' : 'WMS 재고 및 수불부 자동 반영'}</span>
                    </button>

                    <!-- 미반영 전체 일괄 동기화 버튼 -->
                    ${overallSyncStats.unsyncedDays > 0 ? `
                        <button type="button" id="btn-sync-all-unsynced" class="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-sm animate-pulse">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                            <span>미반영 일지 전체 일괄 동기화 (${overallSyncStats.unsyncedDays}일 남음)</span>
                        </button>
                    ` : ''}

                    <button type="button" id="btn-print-gimpo-log" class="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>공식 A4 일지 인쇄</span>
                    </button>
                    <div class="flex items-stretch rounded-xl shadow-sm overflow-hidden border border-green-700">
                        <button type="button" id="btn-send-sheet" class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-black transition flex items-center gap-1.5" title="이 날짜 일지를 구글 시트 업무일지 파일에 날짜 탭으로 넣습니다 (달이 바뀌면 새 달 파일을 만듦)">
                            <i data-lucide="send" class="w-4 h-4"></i><span>구글 시트로 보내기</span>
                        </button>
                        <button type="button" id="btn-sheet-settings" class="px-2 bg-green-700 hover:bg-green-800 text-white" title="구글 시트 보내기 설정"><i data-lucide="settings-2" class="w-4 h-4"></i></button>
                    </div>
                    <button type="button" id="btn-upload-worklog" class="px-3 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="엑셀(.xlsx) 또는 구글 시트 링크로 날짜별 일지를 한꺼번에 올립니다">
                        <i data-lucide="upload" class="w-4 h-4"></i>
                        <span>파일 업로드</span>
                    </button>
                    <button type="button" id="btn-export-gimpo-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                        <span>엑셀 다운로드</span>
                    </button>
                    <button type="button" id="btn-save-gimpo-log" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="save" class="w-4 h-4"></i>
                        <span>일지 저장</span>
                    </button>
                </div>
            </div>

            <!-- 날짜 선택 및 8월/9월 일일 시트 칩 바 -->
            <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <div class="flex items-center gap-2">
                    <label class="font-bold text-slate-700">작업 일자:</label>
                    <input type="date" id="gimpo-log-date-picker" value="${currentDateStr}" class="border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500" />
                    <button type="button" id="btn-new-gimpo-log" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1 border border-slate-200">
                        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                        <span>새 일자 일지</span>
                    </button>
                </div>

                <!-- 월별 필터 버튼 -->
                <div class="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[11px] font-bold">
                    ${monthKeys.map(mm => `<button type="button" class="btn-month-filter px-2.5 py-1 rounded-lg transition whitespace-nowrap ${selectedMonthFilter === mm ? 'bg-white text-blue-600 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="${mm}">${Number(mm)}월 (${availableLogs.filter(l => (l.date || '').slice(5, 7) === mm).length}일)</button>`).join('')}
                    <button type="button" class="btn-month-filter px-2.5 py-1 rounded-lg transition whitespace-nowrap ${selectedMonthFilter === 'ALL' ? 'bg-white text-blue-600 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="ALL">전체 (${availableLogs.length}일)</button>
                </div>

                <div class="flex-1 flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
                    ${filteredChips.map(l => {
                        const isCurrent = l.date === currentDateStr;
                        const label = l.date ? l.date.slice(5).replace('-', '/') : l.sheetName;
                        const isSynced = !!l.isSyncedToLedger;
                        return `
                            <button type="button" class="btn-select-date-chip px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                                isCurrent 
                                    ? 'bg-blue-600 text-white shadow-xs' 
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                            }" data-date="${esc(l.date)}">
                                <span class="w-1.5 h-1.5 rounded-full ${isSynced ? 'bg-emerald-400' : 'bg-amber-400'}" title="${isSynced ? '수불부 반영됨' : '수불부 미반영'}"></span>
                                <span>${esc(label)}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>

        <!-- 2. 핵심 KPI 요약 카드 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 제품포장 실적</span>
                    <i data-lucide="package-check" class="w-4 h-4 text-blue-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-slate-900 font-mono">${packQty.toLocaleString()}</span>
                    <span class="text-xs text-slate-500 font-bold">EA (${packBoxes}BOX)</span>
                </div>
                <div class="text-[11px] text-blue-700 font-bold mt-1">포장 작업공수: ${packManHours.toFixed(2)}공수</div>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 원액생산(블렌딩)</span>
                    <i data-lucide="flask-conical" class="w-4 h-4 text-sky-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-slate-900 font-mono">${oilQty.toLocaleString()}</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <div class="text-[11px] text-sky-700 font-bold mt-1">블렌딩 공수: ${oilManHours.toFixed(2)}공수</div>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 이동제품 (${esc(cfg.moveLabel)})</span>
                    <i data-lucide="truck" class="w-4 h-4 text-amber-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-slate-900 font-mono">${moveCount}</span>
                    <span class="text-xs text-slate-500 font-bold">개 품목 (${moveQty.toLocaleString()}EA)</span>
                </div>
                <div class="text-[11px] text-amber-700 font-bold mt-1">3.5T 정기 셔틀 이동</div>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 일일 총 투입공수</span>
                    <i data-lucide="users" class="w-4 h-4 text-purple-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-purple-700 font-mono">${totalDayManHours}</span>
                    <span class="text-xs text-slate-500 font-bold">공수 (7.5hr 기준)</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-1">기타업무 공수: ${otherManHours.toFixed(2)}공수</div>
            </div>
        </div>

        <!-- 3. 업무 영역: 탭(한 항목씩) 또는 전체 펼치기(1~7 모두) -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-print">
            <div class="flex items-stretch border-b border-slate-200 bg-slate-50 text-xs font-bold">
                <div class="flex flex-1 min-w-0 overflow-x-auto scrollbar-none">
                    ${SECTION_DEFS.map(s => {
                        const on = !expandAll && currentActiveSection === s.key;
                        return `<button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${on ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="${s.key}" title="${expandAll ? '이 항목으로 이동' : '이 항목 보기'}">
                            <i data-lucide="${s.icon}" class="w-4 h-4 ${s.color}"></i>
                            <span>${s.title}${s.count ? ` (${s.count(currentLog)})` : ''}</span>
                        </button>`;
                    }).join('')}
                </div>
                <button type="button" id="btn-toggle-expand-all" class="flex-shrink-0 m-1.5 px-3 rounded-xl border flex items-center gap-1.5 whitespace-nowrap transition ${expandAll ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}" title="${expandAll ? '탭으로 한 항목씩 보기' : '1~7 항목을 한 화면에 모두 펼치기'}">
                    <i data-lucide="${expandAll ? 'chevrons-down-up' : 'chevrons-up-down'}" class="w-4 h-4"></i>
                    <span>${expandAll ? '전체 접기' : '전체 펼치기'}</span>
                </button>
            </div>

            ${expandAll ? `
            <div class="p-3 space-y-3" id="gimpo-section-content">
                ${SECTION_DEFS.map(s => {
                    const closed = collapsedSections.has(s.key);
                    return `<div class="border border-slate-200 rounded-xl overflow-hidden scroll-mt-28" id="wl-panel-${s.key}">
                        <button type="button" class="wl-panel-head w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left text-xs font-black text-slate-800" data-section="${s.key}" aria-expanded="${!closed}">
                            <i data-lucide="chevron-down" class="wl-panel-chev w-4 h-4 text-slate-500 transition-transform" style="${closed ? 'transform:rotate(-90deg)' : ''}"></i>
                            <i data-lucide="${s.icon}" class="w-4 h-4 ${s.color}"></i>
                            <span>${s.title}</span>
                            ${s.count ? `<span class="px-1.5 py-0.5 rounded-full bg-white border border-slate-200 text-[10px] text-slate-600">${s.count(currentLog)}건</span>` : ''}
                            <span class="wl-panel-state ml-auto text-[10px] font-bold text-slate-400">${closed ? '펼치기' : '접기'}</span>
                        </button>
                        <div class="wl-panel-body p-4 border-t border-slate-200 ${closed ? 'hidden' : ''}">${renderActiveSectionContent(currentLog, s.key)}</div>
                    </div>`;
                }).join('')}
            </div>` : `
            <!-- 활성화된 섹션 콘텐츠 -->
            <div class="p-5" id="gimpo-section-content">
                ${renderActiveSectionContent(currentLog, currentActiveSection)}
            </div>`}
        </div>

        <!-- 4. 인쇄 전용 공식 A4 업무일지 양식 (화면에서는 숨김, 인쇄 시 표시) -->
        <div id="print-area-gimpo" class="hidden print:block font-sans text-black p-4 space-y-4">
            ${renderPrintDocument(currentLog)}
        </div>
    </section>
    `;

    bindEvents(container, currentLog, showToast);
};

// ==========================================
// 섹션별 렌더링 헬퍼
// ==========================================

const formatLogItem = (itemText) => {
    if (!itemText) return '-';
    const isTemp = itemText.startsWith('0000') || itemText.includes('0000 /');
    const isNoCode = !itemText.includes('/');
    if (isTemp) {
        return `<span class="inline-flex items-center gap-1 max-w-xs"><span class="shrink-0 px-1.5 py-0.2 rounded text-[10px] bg-amber-100 text-amber-800 font-black border border-amber-300">0000 임시</span> <span class="font-bold text-slate-900 truncate" title="${esc(itemText)}">${esc(itemText)}</span></span>`;
    }
    if (isNoCode) {
        return `<span class="inline-flex items-center gap-1 max-w-xs"><span class="shrink-0 px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 font-bold border border-slate-300">미코드</span> <span class="font-bold text-slate-900 truncate" title="${esc(itemText)}">${esc(itemText)}</span></span>`;
    }
    return `<span class="font-bold text-slate-900 truncate block max-w-xs" title="${esc(itemText)}">${esc(itemText)}</span>`;
};

const renderActiveSectionContent = (log, section) => {
    if (section === 'packaging') {
        const rows = log.packaging || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 제품포장작업</span>
                        <span class="text-xs text-slate-500 font-normal">완제품 라인 충진 및 박스 포장 실적</span>
                    </h3>
                </div>
                <button type="button" id="btn-add-packaging-row" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    <span>포장 작업 행 추가</span>
                </button>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명 (코드 / 품목명)</th>
                            <th class="p-2.5">규격</th>
                            <th class="p-2.5 text-right">수량</th>
                            <th class="p-2.5 text-right">박스</th>
                            <th class="p-2.5 text-right">시간(h)</th>
                            <th class="p-2.5 text-right">인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">LINE</th>
                            <th class="p-2.5">LOT 번호</th>
                            <th class="p-2.5">카테고리</th>
                            <th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5">작업자</th>
                            <th class="p-2.5 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100" id="tbody-packaging">
                        ${rows.length === 0 ? `<tr><td colspan="13" class="p-6 text-center text-slate-400">등록된 제품포장 작업 실적이 없습니다.</td></tr>` : 
                            rows.map((r, i) => `
                            <tr class="hover:bg-slate-50/80 transition" data-index="${i}">
                                <td class="p-2.5">${formatLogItem(r.item)}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.spec || '-')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-blue-600">${r.qty.toLocaleString()}</td>
                                <td class="p-2.5 text-right font-mono">${esc(r.box || 0)}</td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">${esc(r.line || '-')}</span></td>
                                <td class="p-2.5 font-mono text-[11px] text-slate-500">${esc(r.lotNo || '-')}${r.stockDone ? '<div class="mt-1 font-sans text-[10px] font-bold text-emerald-700" title="제품생산/입고로 이미 재고에 들어가 수불부 반영 때 건너뜁니다">재고 반영됨 (생산입고)</div>' : ''}${r.yieldSynced ? '<div class="font-sans text-[10px] font-bold text-blue-700" title="포장수율표의 시간·인원으로 채움">⏱ 수율표 시간</div>' : ''}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.category || '-')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                                <td class="p-2.5 text-slate-700 max-w-xs truncate" title="${esc(r.workers)}">${esc(r.workers || '-')}</td>
                                <td class="p-2.5 text-center">
                                    <button type="button" class="btn-del-packaging-row text-rose-500 hover:text-rose-700 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-index="${i}">
                                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'oilBlending') {
        const rows = log.oilBlending || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 원액생산작업 (블렌딩)</span>
                        <span class="text-xs text-slate-500 font-normal">블렌딩 탱크(BT-1, BT-2 등) 조유 및 원액 제조</span>
                    </h3>
                </div>
                <button type="button" id="btn-add-oil-row" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    <span>원액 생산 행 추가</span>
                </button>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명 (코드 / 원액명)</th>
                            <th class="p-2.5">단위</th>
                            <th class="p-2.5 text-right">생산수량</th>
                            <th class="p-2.5">포장용기</th>
                            <th class="p-2.5 text-right">시간(h)</th>
                            <th class="p-2.5 text-right">인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">LINE (BT)</th>
                            <th class="p-2.5">LOT 번호</th>
                            <th class="p-2.5">카테고리</th>
                            <th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="12" class="p-6 text-center text-slate-400">등록된 원액 생산 실적이 없습니다.</td></tr>` : 
                            rows.map((r, i) => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5">${formatLogItem(r.item)}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.spec || 'L')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-sky-600">${r.qty.toLocaleString()} L</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200">${esc(r.packageType || 'TOTE')}</span></td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">${esc(r.line || 'BT-2')}</span></td>
                                <td class="p-2.5 font-mono text-[11px] text-slate-500 font-bold">${esc(r.lotNo || '-')}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.category || '-')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                                <td class="p-2.5 text-center">
                                    <button type="button" class="btn-del-oil-row text-rose-500 hover:text-rose-700 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-index="${i}">
                                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'labeling') {
        const rows = log.labeling || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 라벨부착작업</span>
                        <span class="text-xs text-slate-500 font-normal">공용기 라벨 자동/수동 부착 공정</span>
                    </h3>
                </div>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명</th>
                            <th class="p-2.5">규격</th>
                            <th class="p-2.5 text-right">수량</th>
                            <th class="p-2.5 text-right">박스</th>
                            <th class="p-2.5 text-right">작업시간</th>
                            <th class="p-2.5 text-right">인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">LINE</th>
                            <th class="p-2.5">LOT 번호</th>
                            <th class="p-2.5">카테고리</th>
                            <th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5">작업자</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="12" class="p-6 text-center text-slate-400">등록된 라벨 부착 실적이 없습니다.</td></tr>` : 
                            rows.map((r) => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5">${formatLogItem(r.item)}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.spec || '-')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-indigo-600">${r.qty.toLocaleString()}</td>
                                <td class="p-2.5 text-right font-mono">${esc(r.box || 0)}</td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5">${esc(r.line || '-')}</td>
                                <td class="p-2.5 font-mono text-[11px] text-slate-500">${esc(r.lotNo || '-')}</td>
                                <td class="p-2.5">${esc(r.category || '-')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                                <td class="p-2.5 text-slate-700">${esc(r.workers || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'movement') {
        const rows = log.movement || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 이동제품 (${esc(CFG().moveLabel)} 등 거점 이동)</span>
                        <span class="text-xs text-slate-500 font-normal">${esc(CFG().moveDesc)}</span>
                    </h3>
                </div>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명</th>
                            <th class="p-2.5">용량/규격</th>
                            <th class="p-2.5">단위</th>
                            <th class="p-2.5 text-right">수량</th>
                            <th class="p-2.5">박스/용기</th>
                            <th class="p-2.5">차량</th>
                            <th class="p-2.5">운반자</th>
                            <th class="p-2.5">이동 경로 (출발 &rarr; 도착)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="8" class="p-6 text-center text-slate-400">등록된 거점 이동 내역이 없습니다.</td></tr>` : 
                            rows.map((r) => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5">${formatLogItem(r.item)}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.spec || '-')}</td>
                                <td class="p-2.5 text-slate-600">${esc(r.unit || 'EA')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-amber-600">${(Number(r.qty) || 0).toLocaleString()}${r.qtyOriginal != null ? `<div class="text-[10px] font-normal text-slate-400" title="일지 원래 값">원래 ${esc(r.qtyOriginal)} ${esc(r.unitOriginal || '')}</div>` : ''}</td>
                                <td class="p-2.5 font-mono">${esc(r.box || '-')}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">${esc(r.vehicle || '3.5T')}</span></td>
                                <td class="p-2.5 font-bold text-slate-700">${esc(r.driver || '-')}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200">${esc(r.route || CFG().defaultRoute)}</span>${r.ledgerSkip ? `<div class="mt-1 text-[10px] font-bold text-rose-600" title="수불부 반영 때 건너뜀">수불부 건너뜀: ${esc(r.ledgerSkip)}</div>` : ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'inOut') {
        const inRows = log.receiving || [];
        const outRows = log.shipping || [];
        return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- 입고 내역 -->
            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>■ 입고내역 (원부자재/포장재)</span>
                </h3>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-emerald-50/50 text-emerald-900 font-bold border-b border-slate-200">
                            <tr>
                                <th class="p-2.5">품명</th>
                                <th class="p-2.5 text-right">수량</th>
                                <th class="p-2.5">단위</th>
                                <th class="p-2.5">거래처</th>
                                <th class="p-2.5">확인자</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${inRows.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">입고 내역 없음</td></tr>` : 
                                inRows.map(r => `
                                <tr>
                                    <td class="p-2.5">${formatLogItem(r.item)}</td>
                                    <td class="p-2.5 text-right font-mono font-bold text-emerald-600">${r.qty.toLocaleString()}</td>
                                    <td class="p-2.5 text-slate-500">${esc(r.box || 'EA')}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${esc(r.partner || '-')}</td>
                                    <td class="p-2.5 text-slate-600">${esc(r.inspector || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 출고 내역 -->
            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>■ 출고내역 (외부 납품/출하)</span>
                </h3>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-blue-50/50 text-blue-900 font-bold border-b border-slate-200">
                            <tr>
                                <th class="p-2.5">품명</th>
                                <th class="p-2.5 text-right">수량</th>
                                <th class="p-2.5">단위</th>
                                <th class="p-2.5">거래처</th>
                                <th class="p-2.5">확인자</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${outRows.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">출고 내역 없음</td></tr>` : 
                                outRows.map(r => `
                                <tr>
                                    <td class="p-2.5">${formatLogItem(r.item)}</td>
                                    <td class="p-2.5 text-right font-mono font-bold text-blue-600">${r.qty.toLocaleString()}</td>
                                    <td class="p-2.5 text-slate-500">${esc(r.box || 'EA')}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${esc(r.partner || '-')}</td>
                                    <td class="p-2.5 text-slate-600">${esc(r.inspector || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        ${purchaseOrdersHtml(log.purchaseOrders || [])}
        `;
    }

    if (section === 'courier') {
        const couriers = log.courier || [];
        const notes = log.otherNotes || [];
        return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <i data-lucide="truck" class="w-4 h-4 text-teal-600"></i>
                    <span>■ 택배출고현황</span>
                </h3>
                <div class="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                    ${couriers.length === 0 ? `<p class="text-slate-400 text-xs">등록된 택배 출고 건이 없습니다.</p>` : 
                        couriers.map(c => `
                        <div class="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                            <span class="font-bold text-slate-800">${esc(c.type)}</span>
                            <div class="flex items-center gap-2">
                                <span class="font-mono font-black text-teal-600">${c.count}건</span>
                                ${c.notes ? `<span class="text-slate-400 text-[11px]">(${esc(c.notes)})</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <i data-lucide="message-square" class="w-4 h-4 text-amber-600"></i>
                    <span>■ 공장 일일 특이사항 / 메모</span>
                </h3>
                <div class="border border-slate-200 rounded-xl p-4 bg-amber-50/40 space-y-2">
                    ${notes.length === 0 ? `<p class="text-slate-400 text-xs">등록된 특이사항이 없습니다.</p>` : 
                        notes.map(n => `
                        <div class="flex items-start gap-2 text-xs text-amber-950 bg-white p-2.5 rounded-lg border border-amber-200 shadow-xs">
                            <i data-lucide="chevron-right" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></i>
                            <span>${esc(n)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        `;
    }

    if (section === 'otherTasks') {
        const rows = log.otherTasks || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 기타업무 및 간접공수 집계</span>
                        <span class="text-xs text-slate-500 font-normal">공장 시설 점검, 환기, 전산 입력, 입고정리 등 작업공수</span>
                    </h3>
                </div>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">업무명</th>
                            <th class="p-2.5 text-right">작업시간(h)</th>
                            <th class="p-2.5 text-right">투입인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">담당자</th>
                            <th class="p-2.5 text-right">작업공수</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="6" class="p-6 text-center text-slate-400">등록된 기타업무 내역이 없습니다.</td></tr>` : 
                            rows.map(r => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5 font-bold text-slate-900">${esc(r.task)}</td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5 font-bold text-slate-700">${esc(r.worker || '-')}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    return '';
};

// 구매발주내역 (본사 업무일지 양식: 품명·규격·수량·거래처·LOT·입고처·비고)
const purchaseOrdersHtml = (rows) => (!rows.length && SITE !== 'HQ') ? '' : `<div class="space-y-3 mt-6">
    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-violet-500"></span><span>■ 구매발주내역</span></h3>
    <div class="overflow-x-auto border border-slate-200 rounded-xl">
        <table class="w-full text-xs text-left">
            <thead class="bg-violet-50/60 text-violet-900 font-bold border-b border-slate-200"><tr>
                <th class="p-2.5">품명</th><th class="p-2.5">용량/규격</th><th class="p-2.5 text-right">수량</th><th class="p-2.5">거래처</th><th class="p-2.5">LOT/NO</th><th class="p-2.5">입고처(LINE/구분)</th><th class="p-2.5">비고</th></tr></thead>
            <tbody class="divide-y divide-slate-100">
                ${rows.length === 0 ? '<tr><td colspan="7" class="p-4 text-center text-slate-400">구매발주 내역 없음</td></tr>' : rows.map(r => `<tr>
                    <td class="p-2.5">${formatLogItem(r.item)}</td><td class="p-2.5 text-slate-500">${esc(r.spec || '')}</td>
                    <td class="p-2.5 text-right font-mono font-bold text-violet-700">${(Number(r.qty) || 0).toLocaleString()}</td>
                    <td class="p-2.5 font-bold text-slate-700">${esc(r.partner || '-')}</td><td class="p-2.5 font-mono">${esc(r.lotNo || '')}</td>
                    <td class="p-2.5">${esc(r.site || '')}</td><td class="p-2.5 text-slate-600">${esc(r.notes || '')}</td></tr>`).join('')}
            </tbody>
        </table>
    </div>
</div>`;

// ==========================================
// 인쇄 전용 공식 양식 문서 렌더러
// ==========================================

// ==========================================
// 구글 시트 보내기 설정: Apps Script 웹 앱 주소·토큰, 거점별 기준 시트(이번 달 업무일지 파일) 링크 (매니저 이상만 저장)
const openSheetSettings = async (showToast) => {
    let cfg;
    try { cfg = await loadSheetConfig(true); } catch (err) { alert(err.message); return; }
    const canEdit = canPerformAction('MRP_PLANNING');
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 flex items-start justify-center overflow-y-auto';
    const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 font-mono text-[11px]';
    box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 text-xs overflow-hidden">
        <div class="px-4 py-3 bg-green-700 text-white flex items-center justify-between"><h3 class="font-black text-sm">📤 업무일지 → 구글 시트 보내기 설정</h3><button type="button" class="ss-x text-xl px-1">&times;</button></div>
        <div class="p-4 space-y-3">
            <ol class="list-decimal pl-5 space-y-1 text-slate-600">
                <li>회사 구글 계정으로 <b>script.google.com</b> → 프로젝트 편집기(Code.gs)의 내용을 모두 지우고, 아래 <b>설치 코드 복사</b>로 복사한 코드를 붙여넣고 저장(💾)합니다.
                    <div class="mt-1.5 space-y-1.5">
                        <button type="button" id="ss-copy" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-black">📋 설치 코드 복사</button>
                        <textarea id="ss-code" readonly class="w-full h-28 border border-slate-300 rounded-lg p-2 font-mono text-[10px] bg-slate-50" placeholder="코드를 불러오는 중..."></textarea>
                    </div></li>
                <li>프로젝트 설정 → 스크립트 속성에 <b>TOKEN</b>(아무 긴 글자)을 넣습니다. 아래 토큰 칸에도 같은 값을 넣습니다.</li>
                <li>배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자) → 권한 허용 → 나온 <b>웹 앱 URL(…/exec)</b>을 아래에 넣습니다. 이미 배포했는데 코드를 바꿨다면 <b>배포 관리 → ✏️ 수정 → 버전 '새 버전' → 배포</b>를 해야 반영됩니다. 웹 앱 URL을 브라우저로 열어 <code>{"ok":true,…}</code>가 보이면 정상입니다.</li>
                <li>거점별 <b>이번 달 업무일지 구글 시트 링크</b>를 넣습니다. 달이 바뀌면 이 파일을 같은 폴더에 복사해 'N월' 새 파일을 만들고, 날짜마다 탭(MMDD)을 양식 그대로 추가합니다. 웹 앱 계정이 이 시트를 편집할 수 있어야 합니다.</li>
            </ol>
            <label class="block"><span class="font-bold text-slate-700">웹 앱 URL</span><input id="ss-url" value="${esc(cfg.scriptUrl)}" placeholder="https://script.google.com/macros/s/…/exec" class="${inp}" ${canEdit ? '' : 'disabled'} /></label>
            <label class="block"><span class="font-bold text-slate-700">토큰 (스크립트 속성 TOKEN과 같게)</span><input id="ss-token" type="password" value="${esc(cfg.token)}" class="${inp}" ${canEdit ? '' : 'disabled'} /></label>
            <label class="block"><span class="font-bold text-slate-700">본사 기준 시트 링크</span><input id="ss-hq" value="${esc(cfg.seeds.HQ)}" placeholder="https://docs.google.com/spreadsheets/d/…" class="${inp}" ${canEdit ? '' : 'disabled'} /></label>
            <label class="block"><span class="font-bold text-slate-700">김포 기준 시트 링크</span><input id="ss-gimpo" value="${esc(cfg.seeds.GIMPO)}" placeholder="https://docs.google.com/spreadsheets/d/…" class="${inp}" ${canEdit ? '' : 'disabled'} /></label>
            ${canEdit ? '' : '<p class="text-amber-700 font-bold">설정은 매니저 이상만 바꿀 수 있습니다.</p>'}
            <div id="ss-msg" class="font-bold"></div>
            <div class="flex flex-wrap justify-end gap-2">
                <button type="button" id="ss-ping" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold">연결 확인</button>
                ${canEdit ? '<button type="button" id="ss-save" class="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-black">저장</button>' : ''}
            </div>
        </div></div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const read = () => ({ scriptUrl: $('#ss-url').value, token: $('#ss-token').value, seeds: { HQ: $('#ss-hq').value, GIMPO: $('#ss-gimpo').value } });
    const msg = (t, ok) => { $('#ss-msg').textContent = t; $('#ss-msg').className = `font-bold ${ok ? 'text-emerald-700' : 'text-rose-600'}`; };
    box.querySelectorAll('.ss-x').forEach(b => b.addEventListener('click', () => box.remove()));
    // 설치 코드: .gs 파일은 GitHub Pages가 내려받기 형식으로 주므로 글자로 받아 창 안에 보여 주고 복사한다
    const codeEl = $('#ss-code');
    fetch(`${import.meta.env.BASE_URL}tools/worklog-sheets.gs`, { cache: 'no-store' })
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(buf => { codeEl.value = new TextDecoder('utf-8').decode(buf); })
        .catch(err => { codeEl.value = `설치 코드를 불러오지 못했습니다 (${err.message}).`; });
    $('#ss-copy').addEventListener('click', async () => {
        if (!codeEl.value.includes('function doPost')) { msg('설치 코드를 아직 불러오지 못했습니다. 잠시 뒤 다시 누르세요.', false); return; }
        try { await navigator.clipboard.writeText(codeEl.value); msg(`📋 설치 코드 ${codeEl.value.split('\n').length}줄을 복사했습니다. Apps Script 편집기에 붙여넣고 저장하세요.`, true); }
        catch { codeEl.select(); document.execCommand('copy'); msg('📋 코드를 선택해 복사했습니다. 안 되면 칸을 눌러 Ctrl+A → Ctrl+C 하세요.', true); }
    });
    $('#ss-ping').addEventListener('click', async () => {
        msg('확인 중...', true);
        try { const r = await pingSheet(read()); msg(`✅ 연결됨 (웹 앱 계정 ${r.user || '-'})`, true); } catch (err) { msg(`❌ ${err.message}`, false); }
    });
    $('#ss-save')?.addEventListener('click', async () => {
        try { await saveSheetConfig(read()); showToast('📤 구글 시트 보내기 설정을 저장했습니다.'); box.remove(); } catch (err) { msg(`❌ ${err.message}`, false); }
    });
};

// 파일 업로드: 엑셀(.xlsx) 또는 구글 시트 링크 → 미리보기 → 고른 날짜만 일지로 저장
// ==========================================
// 이미 수불부에 반영된 날짜는 덮어쓰지 않는다 (재고와 일지가 어긋나지 않게). 미반영 일지는 골라서 덮어쓴다.
const UPLOAD_PARTS = [['packaging', '포장'], ['oilBlending', '원액'], ['labeling', '라벨'], ['movement', '이동'], ['receiving', '입고'], ['shipping', '출고'], ['purchaseOrders', '발주'], ['otherTasks', '기타']];
const openWorklogUpload = (container, showToast) => {
    const cfg = CFG();
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[60] bg-slate-900/60 p-3 overflow-y-auto flex items-start justify-center no-print';
    let days = [];
    const close = () => box.remove();
    const statusOf = (d) => {
        const old = logsList().find(l => l.date === d.log.date);
        if (!old) return { key: 'NEW', label: '새 일지', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
        if (old.isSyncedToLedger) return { key: 'LOCKED', label: '수불부 반영완료 — 덮어쓰지 않음', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
        return { key: 'OVERWRITE', label: '기존 일지 덮어쓰기', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
    };
    const draw = (msg = '') => {
        box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-6 text-xs overflow-hidden">
            <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
                <h3 class="font-black text-sm flex items-center gap-2"><i data-lucide="upload" class="w-4 h-4"></i>업무일지(${esc(cfg.name)}) 파일 업로드</h3>
                <button type="button" class="wu-close text-slate-300 hover:text-white text-xl px-1">&times;</button></div>
            <div class="p-4 space-y-3">
                <p class="text-slate-600">'(${esc(cfg.name)})생산공급망 업무일지' 양식의 <b>엑셀 파일</b> 또는 <b>구글 시트 링크</b>를 넣으면 날짜 시트(예: 0923)마다 일지로 읽습니다. 날짜는 <b>시트 이름</b> 기준입니다.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label class="block p-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-400 cursor-pointer text-center">
                        <i data-lucide="file-spreadsheet" class="w-6 h-6 mx-auto text-emerald-600"></i>
                        <div class="font-black mt-1">엑셀 파일 고르기 (.xlsx)</div>
                        <input type="file" id="wu-file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" />
                    </label>
                    <div class="p-3 rounded-xl border border-slate-300 space-y-1.5">
                        <div class="font-black">구글 시트 링크</div>
                        <div class="flex gap-1.5"><input id="wu-url" placeholder="https://docs.google.com/spreadsheets/d/…" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5" />
                            <button type="button" id="wu-url-go" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black">불러오기</button></div>
                        <div class="text-[10px] text-slate-400">공유: '링크가 있는 모든 사용자 - 뷰어'여야 읽을 수 있습니다.</div>
                    </div>
                </div>
                ${msg ? `<div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 font-bold text-slate-700">${msg}</div>` : ''}
                ${days.length ? `
                <div class="flex items-center justify-between"><div class="font-black text-slate-800">읽은 일지 ${days.length}일</div>
                    <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="wu-all" checked />업로드 가능한 날짜 모두 선택</label></div>
                <div class="overflow-x-auto border border-slate-200 rounded-xl max-h-[50vh]">
                    <table class="w-full"><thead class="bg-slate-100 text-slate-600 sticky top-0"><tr>
                        <th class="p-2 w-8"></th><th class="p-2 text-left">날짜 (시트)</th>${UPLOAD_PARTS.map(([, l]) => `<th class="p-2 text-right">${l}</th>`).join('')}<th class="p-2 text-left">상태</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">${days.map((d, i) => {
                        const st = statusOf(d);
                        return `<tr class="${st.key === 'LOCKED' ? 'opacity-60' : ''}">
                            <td class="p-2 text-center"><input type="checkbox" class="wu-chk" data-i="${i}" ${st.key === 'LOCKED' ? 'disabled' : 'checked'} /></td>
                            <td class="p-2 whitespace-nowrap font-bold">${esc(d.log.date)} <span class="text-slate-400 font-normal">(${esc(d.sheetName)})</span>
                                ${d.warnings.map(w => `<div class="text-[10px] text-amber-700 font-normal">⚠ ${esc(w)}</div>`).join('')}</td>
                            ${UPLOAD_PARTS.map(([k]) => `<td class="p-2 text-right ${d.log[k].length ? 'font-black' : 'text-slate-300'}">${d.log[k].length}</td>`).join('')}
                            <td class="p-2"><span class="px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${st.cls}">${esc(st.label)}</span></td></tr>`;
                    }).join('')}</tbody></table>
                </div>
                <div class="flex justify-end gap-2">
                    <button type="button" class="wu-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                    <button type="button" id="wu-save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black">선택한 일지 업로드</button>
                </div>
                <p class="text-[11px] text-slate-500">업로드한 일지는 '수불부 미반영' 상태입니다. 확인한 뒤 <b>WMS 재고 및 수불부 자동 반영</b>(또는 미반영 일지 전체 일괄 동기화)을 누르세요.</p>` : ''}
            </div></div>`;
        createIcons({ icons });
        box.querySelectorAll('.wu-close').forEach(b => b.addEventListener('click', close));
        const load = async (fn, label) => {
            draw(`⏳ ${label} 읽는 중…`);
            try {
                days = await fn();
                draw(days.length ? '' : '날짜 시트(예: 0923)를 찾지 못했습니다. 업무일지 양식 파일인지 확인하세요.');
            } catch (e) { days = []; draw(`⚠️ ${esc(e.message)}`); }
        };
        box.querySelector('#wu-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) load(() => readWorklogFile(f), f.name); });
        box.querySelector('#wu-url-go').addEventListener('click', () => { const u = box.querySelector('#wu-url').value.trim(); if (u) load(() => readWorklogGoogleSheet(u), '구글 시트'); });
        box.querySelector('#wu-all')?.addEventListener('change', (e) => box.querySelectorAll('.wu-chk:not(:disabled)').forEach(c => { c.checked = e.target.checked; }));
        box.querySelector('#wu-save')?.addEventListener('click', () => {
            const chosen = [...box.querySelectorAll('.wu-chk:checked')].map(c => days[Number(c.dataset.i)]);
            if (!chosen.length) { alert('업로드할 날짜를 고르세요.'); return; }
            const over = chosen.filter(d => statusOf(d).key === 'OVERWRITE').length;
            if (!confirm(`${chosen.length}일치 일지를 업로드할까요?${over ? `\n(기존 미반영 일지 ${over}일은 새 내용으로 덮어씁니다)` : ''}`)) return;
            let saved = 0;
            for (const d of chosen) {
                if (statusOf(d).key === 'LOCKED') continue;
                saveLog({ ...d.log, uploadedAt: new Date().toISOString() });
                saved++;
            }
            close();
            currentDateStr = chosen[chosen.length - 1].log.date;
            selectedMonthFilter = currentDateStr.slice(5, 7);
            showToast(`📤 업무일지 ${saved}일치를 업로드했습니다. 확인 뒤 수불부에 반영하세요.`);
            renderProductionLog(container, { showToast });
        });
    };
    document.body.appendChild(box);
    draw();
};

// 인쇄 양식 공통 표: cols = [제목, 값(r), 'l'|'r'|''] — 줄이 없으면 '내역 없음', total이 있으면 합계 줄
const PT = 'border: 1px solid black; padding: 2.5px 3px;';
const printSection = (title, cols, rows, { total = null } = {}) => `
    <div style="font-weight: bold; font-size: 11.5px; margin-top: 9px; margin-bottom: 3px;">■ ${esc(title)}</div>
    <table style="width: 100%; border-collapse: collapse; border: 1px solid black; font-size: 9.5px; text-align: center;">
        <tr style="background: #f0f0f0;">${cols.map(c => `<th style="${PT}">${esc(c[0])}</th>`).join('')}</tr>
        ${rows.length === 0 ? `<tr><td colspan="${cols.length}" style="${PT} color: #777;">내역 없음</td></tr>`
            : rows.map(r => `<tr>${cols.map(c => `<td style="${PT} text-align: ${c[2] === 'l' ? 'left' : c[2] === 'r' ? 'right' : 'center'};">${esc(c[1](r) ?? '')}</td>`).join('')}</tr>`).join('')}
        ${total && rows.length ? `<tr style="background: #f7f7f7; font-weight: bold;">${cols.map((c, i) => `<td style="${PT} text-align: ${i === 0 ? 'center' : 'right'};">${i === 0 ? '합계' : esc(total[i] ?? '')}</td>`).join('')}</tr>` : ''}
    </table>`;
const n2 = (v) => (v === '' || v === null || v === undefined ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const sumOf = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

// 인쇄 전용 공식 A4 업무일지: 화면의 1~7 항목을 모두 싣는다
const renderPrintDocument = (log) => {
    const pk = log.packaging || [], ob = log.oilBlending || [], lb = log.labeling || [], mv = log.movement || [];
    const rc = log.receiving || [], sh = log.shipping || [], po = log.purchaseOrders || [];
    const cr = log.courier || [], notes = log.otherNotes || [], ot = log.otherTasks || [];
    const workCols = [['품명', r => r.item, 'l'], ['규격', r => r.spec], ['수량', r => n2(r.qty), 'r'], ['박스', r => n2(r.box), 'r'], ['시간', r => n2(r.workHours)], ['인원', r => n2(r.workersCount)],
        ['총시간', r => n2(r.totalWorkHours)], ['라인', r => r.line], ['LOT', r => r.lotNo], ['공수', r => n2(r.manHours), 'r'], ['작업자', r => r.workers]];
    const workTotal = (rows) => ['', '', n2(sumOf(rows, 'qty')), n2(sumOf(rows, 'box')), '', '', n2(sumOf(rows, 'totalWorkHours')), '', '', n2(sumOf(rows, 'manHours')), ''];
    const totalMH = sumOf(pk, 'manHours') + sumOf(lb, 'manHours') + sumOf(ob, 'manHours') + sumOf(ot, 'manHours');
    return `
    <div style="font-family: 'Malgun Gothic', dotum, sans-serif; color: black; line-height: 1.35;">
        <table style="width: 100%; border: none; margin-bottom: 8px;">
            <tr>
                <td style="font-size: 20px; font-weight: bold; text-align: left;">(${esc(CFG().name)}) 생산공급망 업무일지</td>
                <td style="text-align: right;"><span id="log-appr-print" style="display: inline-block;">${approvalPrintHtml(LOG_APPR_ROLES, {})}</span></td>
            </tr>
        </table>
        <div style="font-size: 11.5px; margin-bottom: 4px; display: flex; justify-content: space-between;">
            <span><b>일자:</b> ${esc(log.date)}${log.sheetName ? ` (시트: ${esc(log.sheetName)})` : ''}</span>
            <span><b>일일 총 투입공수:</b> ${n2(totalMH)} · <b>수불부:</b> ${log.isSyncedToLedger ? '반영완료' : '미반영'}</span>
        </div>
        ${printSection('1. 제품포장작업', workCols, pk, { total: workTotal(pk) })}
        ${printSection('2. 원액생산작업', [['품명', r => r.item, 'l'], ['수량(L)', r => n2(r.qty), 'r'], ['포장', r => r.packageType], ['시간', r => n2(r.workHours)], ['인원', r => n2(r.workersCount)],
            ['총시간', r => n2(r.totalWorkHours)], ['라인', r => r.line], ['LOT', r => r.lotNo], ['공수', r => n2(r.manHours), 'r'], ['작업자', r => r.workers]], ob,
            { total: ['', n2(sumOf(ob, 'qty')), '', '', '', n2(sumOf(ob, 'totalWorkHours')), '', '', n2(sumOf(ob, 'manHours')), ''] })}
        ${printSection('3. 라벨부착작업', workCols, lb, { total: workTotal(lb) })}
        ${printSection('4. 이동제품', [['품명', r => r.item, 'l'], ['규격', r => r.spec], ['수량', r => n2(r.qty), 'r'], ['단위', r => r.unit || 'EA'], ['박스', r => r.box], ['차량', r => r.vehicle], ['운반자', r => r.driver], ['경로', r => r.route]], mv)}
        ${printSection('5-1. 입고내역', [['품명', r => r.item, 'l'], ['규격', r => r.spec], ['수량', r => n2(r.qty), 'r'], ['박스', r => r.box], ['거래처', r => r.partner], ['확인자', r => r.inspector], ['비고', r => r.notes]], rc)}
        ${printSection('5-2. 출고내역', [['품명', r => r.item, 'l'], ['규격', r => r.spec], ['수량', r => n2(r.qty), 'r'], ['박스', r => r.box], ['거래처', r => r.partner], ['확인자', r => r.inspector], ['운송', r => r.transport], ['비고', r => r.notes]], sh)}
        ${po.length || SITE === 'HQ' ? printSection('5-3. 구매발주내역', [['품명', r => r.item, 'l'], ['용량/규격', r => r.spec], ['수량', r => n2(r.qty), 'r'], ['거래처', r => r.partner], ['LOT/NO', r => r.lotNo], ['입고처', r => r.site], ['비고', r => r.notes]], po) : ''}
        ${printSection('6. 택배출고현황', [['구분', r => r.type], ['건수', r => n2(r.count), 'r'], ['비고', r => r.notes, 'l']], cr)}
        ${notes.length ? `<div style="font-weight: bold; font-size: 11.5px; margin-top: 9px; margin-bottom: 3px;">■ 특이사항 / 메모</div>
            <div style="border: 1px solid black; padding: 4px 6px; font-size: 10px; white-space: pre-wrap;">${notes.map(x => `- ${esc(x)}`).join('\n')}</div>` : ''}
        ${printSection('7. 기타업무', [['업무명', r => r.task, 'l'], ['규격', r => r.spec], ['수량', r => n2(r.qty), 'r'], ['단위', r => r.unit], ['시간', r => n2(r.workHours)], ['인원', r => n2(r.workersCount)],
            ['총시간', r => n2(r.totalWorkHours)], ['작업자/비고', r => r.worker], ['공수', r => n2(r.manHours), 'r']], ot,
            { total: ['', '', '', '', '', '', n2(sumOf(ot, 'totalWorkHours')), '', n2(sumOf(ot, 'manHours'))] })}
    </div>
    `;
};
// ==========================================
// 이벤트 핸들러 바인딩
// ==========================================

const bindEvents = (container, currentLog, showToast) => {
    createIcons({ icons });

    // 1. 날짜 피커 변경
    const datePicker = container.querySelector('#gimpo-log-date-picker');
    datePicker?.addEventListener('change', (e) => {
        currentDateStr = e.target.value;
        renderProductionLog(container, { showToast });
    });

    // 2. 날짜 칩 클릭
    container.querySelectorAll('.btn-select-date-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDateStr = btn.getAttribute('data-date');
            renderProductionLog(container, { showToast });
        });
    });

    // 2-1. 월별 필터 버튼 클릭
    container.querySelectorAll('.btn-month-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMonthFilter = btn.getAttribute('data-month');
            const availableLogs = logsList().slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const matching = availableLogs.filter(l => selectedMonthFilter === 'ALL' || l.date?.includes(`-${selectedMonthFilter}-`));
            if (matching.length > 0) {
                currentDateStr = matching[0].date;
            }
            renderProductionLog(container, { showToast });
        });
    });

    // 3. 섹션 탭 변경
    container.querySelectorAll('.tab-gimpo-section').forEach(btn => {
        btn.addEventListener('click', () => {
            currentActiveSection = btn.getAttribute('data-section');
            if (!expandAll) { renderProductionLog(container, { showToast }); return; }
            const panel = container.querySelector(`#wl-panel-${currentActiveSection}`);
            if (panel && collapsedSections.has(currentActiveSection)) setPanelOpen(panel, true);
            panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // 3-1. 전체 펼치기 / 전체 접기
    container.querySelector('#btn-toggle-expand-all')?.addEventListener('click', () => {
        expandAll = !expandAll;
        // 펼칠 때는 모든 항목을 연 상태로 시작
        if (expandAll) collapsedSections.clear();
        writeJson(EXPAND_KEY, expandAll);
        writeJson(COLLAPSED_KEY, [...collapsedSections]);
        renderProductionLog(container, { showToast });
    });

    // 3-2. 펼친 상태에서 항목 하나씩 접기/펼치기 (다시 그리지 않고 바로)
    const setPanelOpen = (panel, open) => {
        const key = panel.id.replace('wl-panel-', '');
        panel.querySelector('.wl-panel-body').classList.toggle('hidden', !open);
        panel.querySelector('.wl-panel-chev').style.transform = open ? '' : 'rotate(-90deg)';
        panel.querySelector('.wl-panel-state').textContent = open ? '접기' : '펼치기';
        panel.querySelector('.wl-panel-head').setAttribute('aria-expanded', String(open));
        if (open) collapsedSections.delete(key); else collapsedSections.add(key);
        writeJson(COLLAPSED_KEY, [...collapsedSections]);
    };
    container.querySelectorAll('.wl-panel-head').forEach(head => {
        head.addEventListener('click', () => {
            const panel = head.closest('[id^="wl-panel-"]');
            setPanelOpen(panel, head.getAttribute('aria-expanded') !== 'true');
        });
    });

    // 4. 전자결재 (담당·검토·확인) — 서명하면 인쇄 양식의 결재 칸에도 서명·날짜가 들어간다
    mountApprovalBox(container.querySelector('#log-appr'), {
        key: `LOG:${SITE}:${currentDateStr}`, type: 'WORKLOG', title: `업무일지(${CFG().name}) ${currentDateStr}`, date: currentDateStr, roles: LOG_APPR_ROLES
    }, {
        showToast,
        onChange: (slots) => { const p = container.querySelector('#log-appr-print'); if (p) p.innerHTML = approvalPrintHtml(LOG_APPR_ROLES, slots); }
    });

    // 5. 공식 A4 일지 인쇄
    // 파일 업로드 (엑셀·구글 시트 → 날짜별 일지)
    container.querySelector('#btn-upload-worklog')?.addEventListener('click', () => openWorklogUpload(container, showToast));

    // 구글 시트로 보내기: 저장 → 웹 앱에 보냄 → 보낸 시각·탭 링크를 일지에 남김
    container.querySelector('#btn-send-sheet')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        saveLog(currentLog);
        let cfg;
        try { cfg = await loadSheetConfig(); } catch (err) { alert(err.message); return; }
        if (!cfg.scriptUrl || !cfg.token) { openSheetSettings(showToast); return; }
        if (!cfg.seeds?.[SITE] && !confirm(`${CFG().name} 기준 시트 링크가 설정되어 있지 않습니다.\n웹 앱에 이미 이 거점의 월 파일이 기억되어 있으면 그대로 보냅니다. 계속할까요?`)) return;
        const label = btn.querySelector('span').textContent;
        btn.disabled = true;
        btn.querySelector('span').textContent = '보내는 중...';
        try {
            const r = await sendWorklogToSheet(currentLog, SITE);
            currentLog.sheetSent = { at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), url: r.url, tab: r.tab, file: r.fileName };
            saveLog(currentLog);
            showToast(`📤 ${r.fileName}${r.newFile ? '(새 달 파일)' : ''}에 ${r.tab} 탭을 ${r.newTab ? '만들어' : '새로'} 넣었습니다.`);
            renderProductionLog(container, { showToast, site: SITE });
        } catch (err) {
            alert(`구글 시트로 보내지 못했습니다.\n${err.message}`);
            btn.disabled = false;
            btn.querySelector('span').textContent = label;
        }
    });
    container.querySelector('#btn-sheet-settings')?.addEventListener('click', () => openSheetSettings(showToast));

    // 새 창에 A4 양식만 띄워 인쇄 (화면 안의 숨긴 인쇄 영역은 index.html의 전체 인쇄 규칙에 가려 백지가 됨)
    container.querySelector('#btn-print-gimpo-log')?.addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
        const body = container.querySelector('#print-area-gimpo')?.innerHTML || renderPrintDocument(getLog(currentDateStr));
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>업무일지(${esc(CFG().name)}) ${esc(currentDateStr)}</title>
            <style>
                @page { size: A4 portrait; margin: 10mm; }
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { margin: 0; background: #fff; color: #000; font-family: 'Malgun Gothic', dotum, sans-serif; }
                .sheet { width: 190mm; margin: 0 auto; }
                table { page-break-inside: auto; } tr { page-break-inside: avoid; }
                img { max-width: 100%; }
                @media screen { body { background: #cbd5e1; padding: 8mm 0; } .sheet { background: #fff; padding: 10mm; width: 210mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }
            </style></head><body><div class="sheet">${body}</div>
            <script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script></body></html>`);
        w.document.close();
    });

    // 6. 엑셀 다운로드
    container.querySelector('#btn-export-gimpo-excel')?.addEventListener('click', () => {
        const wb = XLSX.utils.book_new();

        // 제품포장 시트
        if ((currentLog.packaging || []).length > 0) {
            const wsPack = XLSX.utils.json_to_sheet(currentLog.packaging);
            XLSX.utils.book_append_sheet(wb, wsPack, '제품포장작업');
        }
        // 원액생산 시트
        if ((currentLog.oilBlending || []).length > 0) {
            const wsOil = XLSX.utils.json_to_sheet(currentLog.oilBlending);
            XLSX.utils.book_append_sheet(wb, wsOil, '원액생산작업');
        }
        // 이동제품 시트
        if ((currentLog.movement || []).length > 0) {
            const wsMove = XLSX.utils.json_to_sheet(currentLog.movement);
            XLSX.utils.book_append_sheet(wb, wsMove, '이동제품');
        }

        XLSX.writeFile(wb, `(${CFG().name})생산공급망업무일지_${currentDateStr}.xlsx`);
        showToast('📁 일일 생산공급망 업무일지 엑셀 파일이 다운로드되었습니다.');
    });

    // 7. WMS 재고 및 수불부 자동 반영
    container.querySelector('#btn-apply-to-stock')?.addEventListener('click', async () => {
        const confirmed = confirm(
            `[WMS 재고 및 수불부 자동 반영 안내]\n\n` +
            `해당 일자(${currentDateStr})의 제품포장, 원액생산, 거점이동, 입출고 실적을 WMS 재고와 수불부에 실시간 반영하시겠습니까?\n\n` +
            `■ 반영 및 지능형 대조 규칙:\n` +
            `1. 품목코드 없는 품목은 2,882종 마스터와 지능형 대조하여 동일 품목으로 자동 합산 반영됩니다.\n` +
            `2. 대조 불가 품목은 '0000' 임시코드로 신규 자동 등록되어 누락 0건으로 기록됩니다.\n` +
            `3. 임시 등록된 '0000' 품목은 [마스터 관리] 탭에서 언제든지 정식 코드로 변경/병합할 수 있습니다.`
        );
        if (!confirmed) return;

        try {
            const result = await applyGimpoLogToInventory(currentDateStr, state.currentGlobalWorker || state.currentUser?.name || '', SITE);
            
            let msg = `✅ [WMS 재고 및 수불부 반영 완료]\n\n`;
            msg += `• 포장 완제품 입고: ${result.packagingCount}건\n`;
            msg += `• 원액 블렌딩 입고: ${result.oilCount}건\n`;
            msg += `• 거점 이동 처리: ${result.moveCount}건\n`;
            msg += `• 부자재/원료 입고: ${result.receivingCount}건\n`;
            msg += `• 거래처 제품 출고: ${result.shippingCount}건\n\n`;
            msg += `■ 품목 매칭 분석:\n`;
            msg += `• 기존 마스터 대조 성공: ${result.matchedMasterCount}건\n`;
            
            if (result.tempCreatedCount > 0) {
                msg += `• 검색불가 '0000' 임시코드 신규 등록: ${result.tempCreatedCount}건\n`;
                const tempNames = result.tempItems.slice(0, 5).map(t => `  - [${t.code}] ${t.name}`).join('\n');
                msg += `${tempNames}${result.tempItems.length > 5 ? '\n  ... 외 ' + (result.tempItems.length - 5) + '건' : ''}\n\n`;
                msg += `👉 [마스터 관리] 탭의 [임시코드(0000) 모아보기]에서 정식 코드로 지정/병합할 수 있습니다!`;
            } else {
                msg += `• 신규 임시등록: 0건 (모든 품목이 정상 마스터와 매칭됨)`;
            }

            if (result.errors.length > 0) {
                msg += `\n\n⚠️ 처리 중 오류 발생 (${result.errors.length}건):\n` + result.errors.slice(0, 3).join('\n');
            }

            alert(msg);
            showToast(`✅ WMS 재고 반영 완료 (대조성공: ${result.matchedMasterCount}건, 0000등록: ${result.tempCreatedCount}건)`);
            renderProductionLog(container, { showToast });
        } catch (err) {
            alert('재고 반영 중 오류 발생: ' + err.message);
        }
    });

    // 7-2. 미반영 일지 전체 일괄 수불부 동기화
    container.querySelector('#btn-sync-all-unsynced')?.addEventListener('click', async () => {
        const stats = getGimpoSyncStatistics(SITE);
        if (stats.unsyncedDays === 0) {
            alert('이미 모든 생산공급망 일지가 수불부에 반영되어 있습니다.');
            return;
        }

        const confirmed = confirm(
            `[미반영 업무일지 전체 일괄 수불부 동기화]\n\n` +
            `현재 수불부에 미반영된 ${stats.unsyncedDays}일치 생산공급망 업무일지를 WMS 재고 및 수불부에 일괄 반영하시겠습니까?\n\n` +
            `대상 일자: ${stats.unsyncedLogs.slice(0, 5).map(l => l.date).join(', ')}${stats.unsyncedLogs.length > 5 ? ' 외 ' + (stats.unsyncedLogs.length - 5) + '일' : ''}`
        );
        if (!confirmed) return;

        try {
            showToast('⏳ 미반영 업무일지 일괄 동기화 진행 중...');
            const res = await syncAllUnsyncedGimpoLogs(state.currentGlobalWorker || state.currentUser?.name || '', SITE);
            alert(res.message);
            showToast('🎉 수불부 일괄 동기화가 성공적으로 완료되었습니다.');
            renderProductionLog(container, { showToast });
        } catch (err) {
            alert('일괄 동기화 중 오류가 발생했습니다: ' + err.message);
        }
    });

    // 8. 새 일자 일지 생성
    container.querySelector('#btn-new-gimpo-log')?.addEventListener('click', () => {
        const newDate = prompt('신규 생성할 일자를 입력하세요 (YYYY-MM-DD):', localDateStr());
        if (newDate) {
            currentDateStr = newDate;
            const newLog = getLog(newDate);
            saveLog(newLog);
            renderProductionLog(container, { showToast });
            showToast(`신규 일자 (${newDate}) 업무일지가 생성되었습니다.`);
        }
    });

    // 9. 포장 행 추가
    container.querySelector('#btn-add-packaging-row')?.addEventListener('click', () => {
        const itemInput = prompt('품명 또는 품목코드를 입력하세요:');
        if (!itemInput) return;
        const qtyInput = Number(prompt('생산 수량을 입력하세요:', '100')) || 0;
        const boxInput = Number(prompt('박스 수를 입력하세요:', Math.ceil(qtyInput / 12))) || 0;

        currentLog.packaging = currentLog.packaging || [];
        currentLog.packaging.push({
            item: itemInput,
            spec: '1L',
            qty: qtyInput,
            box: boxInput,
            workHours: 4,
            workersCount: 2,
            totalWorkHours: 8,
            line: '수동1',
            lotNo: `${CFG().lotPrefix}${currentDateStr.replace(/-/g, '').slice(2)}-01`,
            category: '엔진오일',
            manHours: Number((8 / 7.5).toFixed(2)),
            workers: state.currentGlobalWorker || '정화순, 윤상모'
        });
        saveLog(currentLog);
        renderProductionLog(container, { showToast });
        showToast('포장 작업 행이 추가되었습니다.');
    });

    // 10. 포장 행 삭제
    container.querySelectorAll('.btn-del-packaging-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            currentLog.packaging.splice(idx, 1);
            saveLog(currentLog);
            renderProductionLog(container, { showToast });
            showToast('포장 작업 행이 삭제되었습니다.');
        });
    });

    // 11. 원액 행 추가
    container.querySelector('#btn-add-oil-row')?.addEventListener('click', () => {
        const itemInput = prompt('원액 품명 또는 코드를 입력하세요:');
        if (!itemInput) return;
        const qtyInput = Number(prompt('생산 수량 (L)을 입력하세요:', '1000')) || 0;

        currentLog.oilBlending = currentLog.oilBlending || [];
        currentLog.oilBlending.push({
            item: itemInput,
            spec: 'L',
            qty: qtyInput,
            packageType: 'TOTE',
            workHours: 3,
            workersCount: 2,
            totalWorkHours: 6,
            line: 'BT-2',
            lotNo: `${CFG().lotPrefix}${currentDateStr.replace(/-/g, '').slice(2)}-01`,
            category: '원액',
            manHours: Number((6 / 7.5).toFixed(2))
        });
        saveLog(currentLog);
        renderProductionLog(container, { showToast });
        showToast('원액 생산 행이 추가되었습니다.');
    });

    // 12. 원액 행 삭제
    container.querySelectorAll('.btn-del-oil-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            currentLog.oilBlending.splice(idx, 1);
            saveLog(currentLog);
            renderProductionLog(container, { showToast });
            showToast('원액 생산 행이 삭제되었습니다.');
        });
    });

    // 13. 일지 저장
    container.querySelector('#btn-save-gimpo-log')?.addEventListener('click', () => {
        saveLog(currentLog);
        showToast('💾 일일 생산공급망 업무일지가 저장되었습니다.');
    });
};
