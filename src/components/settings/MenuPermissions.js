// ==========================================
// 환경설정 → 계정 & 권한 & 작업자 → 메뉴 권한 설정
// ==========================================
// 역할마다(역할별) 또는 사용자 한 명마다(사용자별) 열 수 있는 메뉴를 체크로 고른다.
//   - 체크 = 그 메뉴가 메뉴 줄·사이드바·주메뉴 화면에 보이고 열린다.
//   - 저장할 때는 기본값(auth.js TAB_PERMISSIONS)과 다른 메뉴만 적는다 (사용자별은 그 사람의 역할 설정과 다른 메뉴만).
//   - 판정 순서: 사용자 설정 → 역할 설정 → 기본값 (auth.js canAccessTab, services/menuPermissions.js)
// 화면을 여는 권한만 바꾼다 — 저장·수정·삭제는 역할(DB의 RLS)이 그대로 막는다. 총괄 관리자 이상만 고칠 수 있다(그 아래는 보기만).
import { state } from '../../services/db.js';
import { TAB_PERMISSIONS, ROLE_INFO, ROLE_LEVEL, defaultTabAccess, isCloudAuth } from '../../services/auth.js';
import { MENU_ROLES, FIXED_TABS, listMenuPermissions, saveRoleMenuPermissions, saveUserMenuPermissions } from '../../services/menuPermissions.js';
import { NAV_TREE, TAB_META } from '../navMenu.js';
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';

/** @typedef {{ id: string, name: string, role: string, email: string, isShared: boolean }} Person */

const OTHER_SECTION = '그 밖의 메뉴';

/** 메뉴를 주메뉴(묶음)별로: [{ label, tabs: [탭 이름] }] — 묶음에 들지 않은 단독 메뉴는 맨 뒤 '그 밖의 메뉴' */
const menuSections = () => {
    const sections = NAV_TREE.filter(node => node.items).map(node => ({ label: node.label, tabs: node.items.filter(item => typeof item === 'string') }));
    const singles = NAV_TREE.filter(node => node.tab).map(node => node.tab);
    const listed = new Set([...sections.flatMap(section => section.tabs), ...singles]);
    const unlisted = Object.keys(TAB_PERMISSIONS).filter(tab => !listed.has(tab)); // 메뉴 줄에 없는 탭이 생겨도 빠지지 않게
    return [...sections, { label: OTHER_SECTION, tabs: [...singles, ...unlisted] }];
};
const labelOf = (tab) => TAB_META[tab]?.label || tab;
const isFixed = (tab) => FIXED_TABS.includes(tab);
const roleLabel = (role) => ROLE_INFO[role]?.label || role;

/**
 * @param {HTMLElement} host
 * @param {{ showToast: (message: string) => void, onChanged?: () => void }} opts onChanged = 저장 뒤 (메뉴를 다시 그릴 때)
 * @returns {{ setProfiles: (profiles: Array<Object>, errorMessage?: string) => void }}
 */
export const mountMenuPermissions = (host, { showToast, onChanged }) => {
    const sections = menuSections();
    const editableTabs = sections.flatMap(section => section.tabs).filter(tab => !isFixed(tab));
    const canEdit = (ROLE_LEVEL[state.currentUser?.role] || 0) >= ROLE_LEVEL.ADMIN;

    let mode = 'ROLE';                        // 'ROLE' 역할별 | 'USER' 사용자별
    let saved = { roles: {}, users: {} };     // 저장된 설정 (기본값과 다른 메뉴만)
    /** @type {Record<string, Record<string, boolean>>} 역할별 표의 지금 값 (모든 메뉴) */
    let roleDraft = {};
    /** @type {Record<string, boolean>} 고른 사용자의 지금 값 (모든 메뉴) */
    let userDraft = {};
    /** @type {Person[]} */
    let people = [];
    let peopleError = '';
    let userId = '';
    let keyword = '';     // 메뉴 이름 찾기 (비교용 — 소문자)
    let keywordText = ''; // 검색 칸에 보이는 글자
    let isBusy = false;
    let loadError = '';

    // ---------- 값 계산 ----------
    /** 저장된 설정으로 본 그 역할의 메뉴 권한 */
    const roleSavedValue = (role, tab) => saved.roles[role]?.[tab] ?? defaultTabAccess(tab, role);
    const personOf = (id) => people.find(person => person.id === id) || null;
    const userSavedValue = (person, tab) => saved.users[person.id]?.[tab] ?? roleSavedValue(person.role, tab);
    const resetDrafts = () => {
        roleDraft = Object.fromEntries(MENU_ROLES.map(role => [role, Object.fromEntries(editableTabs.map(tab => [tab, roleSavedValue(role, tab)]))]));
        const person = personOf(userId);
        userDraft = person ? Object.fromEntries(editableTabs.map(tab => [tab, userSavedValue(person, tab)])) : {};
    };
    /** 저장하지 않은 변경 수 (지금 보는 방식 기준) */
    const dirtyCount = () => {
        if (mode === 'ROLE') return MENU_ROLES.reduce((sum, role) => sum + editableTabs.filter(tab => roleDraft[role][tab] !== roleSavedValue(role, tab)).length, 0);
        const person = personOf(userId);
        return person ? editableTabs.filter(tab => userDraft[tab] !== userSavedValue(person, tab)).length : 0;
    };
    const matches = (tab) => !keyword || labelOf(tab).toLowerCase().includes(keyword) || tab.toLowerCase().includes(keyword);

    // ---------- 그리기 ----------
    const menuCellHtml = (tab) => `
        <td class="sticky left-0 z-[1] bg-white px-3 py-1.5 border-r border-slate-100">
            <span class="inline-flex items-center gap-1.5 font-bold text-slate-800 whitespace-nowrap"><i data-lucide="${esc(TAB_META[tab]?.icon || 'square')}" class="w-3.5 h-3.5 text-slate-400"></i>${esc(labelOf(tab))}</span>
        </td>`;
    const fixedNoteHtml = (tab, span) => `<td colspan="${span}" class="px-3 py-1.5 text-[11px] text-slate-500">${tab === 'home'
        ? '항상 열립니다'
        : '🔒 특별보안 — 위 표의 <b>작업일지 관리자</b>·<b>작업지시서 사용자</b>로 지정합니다'}</td>`;
    const checkHtml = (attrs, checked, { changed = false, title = '' } = {}) => `
        <td class="px-2 py-1.5 text-center ${changed ? 'bg-amber-50' : ''}" title="${esc(title)}">
            <input type="checkbox" ${attrs} class="w-[18px] h-[18px] accent-blue-600 ${canEdit ? 'cursor-pointer' : ''}" ${checked ? 'checked' : ''} ${canEdit && !isBusy ? '' : 'disabled'} />
        </td>`;

    const roleTableHtml = () => {
        const head = `
            <tr class="bg-slate-50 text-slate-600">
                <th class="sticky left-0 z-[3] bg-slate-50 px-3 py-2 text-left border-r border-slate-200">메뉴</th>
                ${MENU_ROLES.map(role => `
                <th class="px-2 py-2 text-center min-w-[84px]">
                    <div class="font-black text-slate-800 whitespace-nowrap">${esc(roleLabel(role))}</div>
                    <label class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 ${canEdit ? 'cursor-pointer' : ''}" title="${esc(roleLabel(role))}의 모든 메뉴를 한 번에 켜고 끕니다">
                        <input type="checkbox" data-all-role="${role}" class="w-3.5 h-3.5 accent-blue-600" ${canEdit && !isBusy ? '' : 'disabled'} /> 전체</label>
                </th>`).join('')}
            </tr>`;
        const body = sections.map(section => {
            const tabs = section.tabs.filter(matches);
            if (!tabs.length) return '';
            const hasEditable = tabs.some(tab => !isFixed(tab));
            return `
            <tr class="bg-slate-100/80">
                <th class="sticky left-0 z-[1] bg-slate-100 px-3 py-1.5 text-left text-[11px] font-black text-slate-700 border-r border-slate-200">${esc(section.label)}</th>
                ${MENU_ROLES.map(role => `<td class="px-2 py-1 text-center">${hasEditable ? `<input type="checkbox" data-group-role="${role}" data-group="${esc(section.label)}" class="w-3.5 h-3.5 accent-slate-600" title="${esc(section.label)}의 메뉴를 한 번에 켜고 끕니다" ${canEdit && !isBusy ? '' : 'disabled'} />` : ''}</td>`).join('')}
            </tr>
            ${tabs.map(tab => `
            <tr class="border-t border-slate-100 hover:bg-slate-50/60">
                ${menuCellHtml(tab)}
                ${isFixed(tab) ? fixedNoteHtml(tab, MENU_ROLES.length) : MENU_ROLES.map(role => {
                    const base = defaultTabAccess(tab, role);
                    const value = roleDraft[role][tab];
                    return checkHtml(`data-role="${role}" data-tab="${esc(tab)}"`, value, { changed: value !== base, title: `${roleLabel(role)} · ${labelOf(tab)} — 기본값: ${base ? '허용' : '차단'}` });
                }).join('')}
            </tr>`).join('')}`;
        }).join('');
        return `<table class="w-full text-xs border-separate border-spacing-0"><thead class="sticky top-0 z-[2]">${head}</thead><tbody>${body || `<tr><td colspan="${MENU_ROLES.length + 1}" class="p-6 text-center text-slate-400">찾는 메뉴가 없습니다.</td></tr>`}</tbody></table>`;
    };

    const userTableHtml = () => {
        const person = personOf(userId);
        if (!person) return `<div class="p-8 text-center text-xs text-slate-400">${people.length ? '위에서 사용자를 고르세요.' : esc(peopleError || '메뉴 권한을 따로 줄 수 있는 사용자가 없습니다.')}</div>`;
        const head = `
            <tr class="bg-slate-50 text-slate-600">
                <th class="sticky left-0 z-[3] bg-slate-50 px-3 py-2 text-left border-r border-slate-200">메뉴</th>
                <th class="px-2 py-2 text-center min-w-[92px] whitespace-nowrap" title="이 사용자의 역할(${esc(roleLabel(person.role))})에 설정된 값">역할 설정</th>
                <th class="px-2 py-2 text-center min-w-[92px]">
                    <div class="font-black text-slate-800 whitespace-nowrap">${esc(person.name)}</div>
                    <label class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 ${canEdit ? 'cursor-pointer' : ''}"><input type="checkbox" data-all-user class="w-3.5 h-3.5 accent-blue-600" ${canEdit && !isBusy ? '' : 'disabled'} /> 전체</label>
                </th>
                <th class="px-3 py-2 text-left">표시</th>
            </tr>`;
        const body = sections.map(section => {
            const tabs = section.tabs.filter(matches);
            if (!tabs.length) return '';
            return `
            <tr class="bg-slate-100/80"><th class="sticky left-0 z-[1] bg-slate-100 px-3 py-1.5 text-left text-[11px] font-black text-slate-700 border-r border-slate-200">${esc(section.label)}</th><td colspan="3"></td></tr>
            ${tabs.map(tab => {
                if (isFixed(tab)) return `<tr class="border-t border-slate-100">${menuCellHtml(tab)}${fixedNoteHtml(tab, 3)}</tr>`;
                const base = roleSavedValue(person.role, tab);
                const value = userDraft[tab];
                return `
                <tr class="border-t border-slate-100 hover:bg-slate-50/60">
                    ${menuCellHtml(tab)}
                    <td class="px-2 py-1.5 text-center font-bold ${base ? 'text-emerald-600' : 'text-slate-300'}">${base ? '허용' : '차단'}</td>
                    ${checkHtml(`data-user-tab="${esc(tab)}"`, value, { changed: value !== base, title: `${person.name} · ${labelOf(tab)} — 역할 설정: ${base ? '허용' : '차단'}` })}
                    <td class="px-3 py-1.5 text-[11px] font-bold ${value !== base ? 'text-amber-700' : 'text-slate-300'}">${value !== base ? `개별 설정 (${value ? '허용' : '차단'})` : '역할 설정 따름'}</td>
                </tr>`;
            }).join('')}`;
        }).join('');
        return `<table class="w-full text-xs border-separate border-spacing-0"><thead class="sticky top-0 z-[2]">${head}</thead><tbody>${body || '<tr><td colspan="4" class="p-6 text-center text-slate-400">찾는 메뉴가 없습니다.</td></tr>'}</tbody></table>`;
    };

    /** '전체'·묶음 체크의 모습을 지금 값에 맞춘다 (모두 켜짐 = 체크 · 섞임 = 가운데 줄) */
    const syncBulkChecks = () => {
        const setState = (box, values) => {
            const onCount = values.filter(Boolean).length;
            box.checked = values.length > 0 && onCount === values.length;
            box.indeterminate = onCount > 0 && onCount < values.length;
        };
        host.querySelectorAll('[data-all-role]').forEach(box => setState(box, editableTabs.map(tab => roleDraft[box.dataset.allRole][tab])));
        host.querySelectorAll('[data-group-role]').forEach(box => {
            const tabs = (sections.find(section => section.label === box.dataset.group)?.tabs || []).filter(tab => !isFixed(tab));
            setState(box, tabs.map(tab => roleDraft[box.dataset.groupRole][tab]));
        });
        const allUser = host.querySelector('[data-all-user]');
        if (allUser) setState(allUser, editableTabs.map(tab => userDraft[tab]));
    };

    const peopleOptionsHtml = () => MENU_ROLES.map(role => {
        const members = people.filter(person => person.role === role);
        if (!members.length) return '';
        return `<optgroup label="${esc(roleLabel(role))}">${members.map(person => {
            const count = Object.keys(saved.users[person.id] || {}).length;
            return `<option value="${esc(person.id)}" ${person.id === userId ? 'selected' : ''}>${esc(person.name)}${person.isShared ? ' (공용)' : ''}${count ? ` · 개별 설정 ${count}개` : ''}</option>`;
        }).join('')}</optgroup>`;
    }).join('');

    const render = () => {
        const scroller = host.querySelector('#mp-scroll');
        const scrollTop = scroller?.scrollTop || 0;
        const scrollLeft = scroller?.scrollLeft || 0;
        const dirty = dirtyCount();
        const person = personOf(userId);
        const tabBtn = (key, icon, text) => `<button type="button" data-mode="${key}" class="px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition ${mode === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${text}</button>`;
        host.innerHTML = `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div class="min-w-0">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2"><i data-lucide="list-checks" class="w-4 h-4 text-blue-600"></i><span>메뉴 권한 설정</span></h3>
                    <p class="text-xs text-slate-500 mt-0.5">역할마다, 또는 사용자 한 명마다 <b>열 수 있는 메뉴</b>를 고릅니다. 체크한 메뉴만 메뉴 줄·사이드바·주메뉴 화면에 보입니다.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex gap-1 p-1 bg-slate-100 rounded-xl">${tabBtn('ROLE', 'users', '역할별')}${tabBtn('USER', 'user', '사용자별')}</div>
                </div>
            </div>

            ${loadError ? `<div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">메뉴 권한 설정을 불러오지 못했습니다: ${esc(loadError)}</div>` : ''}

            <div class="flex flex-wrap items-center gap-2 text-xs">
                ${mode === 'USER' ? `
                <label class="inline-flex items-center gap-1.5 font-bold text-slate-600">사용자
                    <select id="mp-user" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold max-w-[260px]">
                        <option value="">사용자 선택…</option>${peopleOptionsHtml()}
                    </select></label>
                ${person ? `<span class="px-2 py-1 rounded-lg border text-[11px] font-black ${esc(ROLE_INFO[person.role]?.color || '')}">${esc(roleLabel(person.role))}</span>` : ''}` : ''}
                <label class="relative inline-flex items-center">
                    <i data-lucide="search" class="w-3.5 h-3.5 text-slate-400 absolute left-2"></i>
                    <input type="search" id="mp-search" value="${esc(keywordText)}" placeholder="메뉴 이름 찾기" class="pl-7 pr-2 py-1.5 w-40 bg-slate-50 border border-slate-300 rounded-lg font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </label>
                <span class="ml-auto inline-flex flex-wrap items-center gap-2">
                    <span id="mp-dirty" class="font-bold ${dirty ? 'text-amber-700' : 'text-slate-400'}">${dirty ? `저장하지 않은 변경 ${dirty}건` : '변경 없음'}</span>
                    ${canEdit ? `
                    <button type="button" id="mp-reset" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold inline-flex items-center gap-1.5" title="${mode === 'ROLE' ? '모든 역할의 메뉴를 처음 정해진 값으로 되돌립니다 (저장을 눌러야 반영)' : '이 사용자의 개별 설정을 모두 지워 역할 설정을 따르게 합니다 (저장을 눌러야 반영)'}" ${isBusy || (mode === 'USER' && !person) ? 'disabled' : ''}><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>${mode === 'ROLE' ? '기본값으로' : '역할 설정으로'}</button>
                    <button type="button" id="mp-save" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold inline-flex items-center gap-1.5" ${dirty && !isBusy ? '' : 'disabled'}><i data-lucide="save" class="w-3.5 h-3.5"></i>${isBusy ? '저장 중…' : '저장'}</button>` : ''}
                </span>
            </div>

            <div id="mp-scroll" class="overflow-auto rounded-xl border border-slate-200 max-h-[62vh]">${mode === 'ROLE' ? roleTableHtml() : userTableHtml()}</div>

            <ul class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 leading-relaxed list-disc pl-6 space-y-0.5">
                <li><b class="text-amber-700">노란 칸</b>은 ${mode === 'ROLE' ? '처음 정해진 값(기본값)과' : '그 사용자의 역할 설정과'} 다르게 바꾼 메뉴입니다. 사용자별 설정이 역할별 설정보다 먼저 적용됩니다.</li>
                <li><b>메뉴를 여는 권한만</b> 바뀝니다. 저장·수정·삭제는 역할을 그대로 따릅니다 (예: 조회 전용에게 품목 마스터 관리를 열어 주면 볼 수만 있고, 그 화면 위에 '조회만 할 수 있습니다' 안내가 뜹니다).</li>
                <li>총괄 관리자·마스터는 항상 모든 메뉴를 엽니다. 주메뉴는 그 안에 열 수 있는 메뉴가 하나라도 있으면 보입니다.</li>
                <li>바꾼 내용은 그 사용자가 앱을 다시 열거나, 다른 창을 보다가 돌아왔을 때(5분마다 확인) 적용됩니다.${canEdit ? '' : ' <b>총괄 관리자 이상</b>만 바꿀 수 있습니다.'}</li>
            </ul>
        </div>`;
        createIcons({ icons });
        syncBulkChecks();
        const nextScroller = host.querySelector('#mp-scroll');
        if (nextScroller) { nextScroller.scrollTop = scrollTop; nextScroller.scrollLeft = scrollLeft; }
    };

    // ---------- 불러오기 · 저장 ----------
    /** 로컬(데모) 모드의 사용자 = 이 기기의 로컬 계정 */
    const localPeople = () => (state.users || []).filter(user => MENU_ROLES.includes(user.role))
        .map(user => ({ id: String(user.id || user.username), name: user.name || user.username, role: user.role, email: '', isShared: false }));
    /**
     * 클라우드 모드의 사용자 목록을 받는다 — 계정 표(SettingsManager)가 불러온 프로필을 그대로 넘긴다 (역할을 바꾸면 다시 넘어온다)
     * @param {Array<{ id: string, name?: string, email?: string, effectiveRole: string, is_shared?: boolean }>} profiles
     * @param {string} [errorMessage] 목록을 불러오지 못했을 때의 안내
     */
    const setProfiles = (profiles, errorMessage = '') => {
        peopleError = errorMessage;
        people = (profiles || []).filter(profile => MENU_ROLES.includes(profile.effectiveRole))
            .map(profile => ({ id: profile.id, name: profile.name || profile.email || '', role: profile.effectiveRole, email: profile.email || '', isShared: !!profile.is_shared }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        if (dirtyCount() && mode === 'USER') { render(); return; } // 고치던 값은 그대로 둔다
        if (userId && !personOf(userId)) userId = '';
        resetDrafts();
        if (host.isConnected) render();
    };
    const load = async () => {
        const res = await listMenuPermissions();
        loadError = res.success ? '' : (res.message || '알 수 없는 오류');
        saved = { roles: res.roles, users: res.users };
        if (!isCloudAuth()) people = localPeople();
        if (userId && !personOf(userId)) userId = '';
        resetDrafts();
        if (host.isConnected) render();
    };

    const save = async () => {
        if (!canEdit || isBusy) return;
        const byName = state.currentUser?.name || '';
        const errors = [];
        isBusy = true;
        render();
        if (mode === 'ROLE') {
            for (const role of MENU_ROLES) {
                if (!editableTabs.some(tab => roleDraft[role][tab] !== roleSavedValue(role, tab))) continue;
                const diff = Object.fromEntries(editableTabs.filter(tab => roleDraft[role][tab] !== defaultTabAccess(tab, role)).map(tab => [tab, roleDraft[role][tab]]));
                const res = await saveRoleMenuPermissions(role, diff, byName);
                if (!res.success) errors.push(`${roleLabel(role)}: ${res.message}`);
            }
        } else {
            const person = personOf(userId);
            if (person) {
                const diff = Object.fromEntries(editableTabs.filter(tab => userDraft[tab] !== roleSavedValue(person.role, tab)).map(tab => [tab, userDraft[tab]]));
                const res = await saveUserMenuPermissions(person.id, diff, byName);
                if (!res.success) errors.push(`${person.name}: ${res.message}`);
            }
        }
        isBusy = false;
        showToast(errors.length ? `❌ 메뉴 권한을 저장하지 못했습니다 — ${errors[0]}` : '✅ 메뉴 권한을 저장했습니다. 그 사용자가 앱을 다시 열면 적용됩니다.');
        await load();
        if (!errors.length) onChanged?.();
    };

    /** 저장하지 않은 변경을 버려도 되는지 (없으면 바로 true) */
    const confirmDiscard = () => !dirtyCount() || confirm('저장하지 않은 메뉴 권한 변경이 있습니다. 버리고 계속할까요?');

    // ---------- 이벤트 (host에 한 번만 — 다시 그려도 쌓이지 않는다) ----------
    host.addEventListener('click', (e) => {
        const modeBtn = e.target.closest('[data-mode]');
        if (modeBtn && modeBtn.dataset.mode !== mode) {
            if (!confirmDiscard()) return;
            mode = modeBtn.dataset.mode;
            resetDrafts();
            render();
            return;
        }
        if (e.target.closest('#mp-save')) { save(); return; }
        if (e.target.closest('#mp-reset') && canEdit) {
            if (mode === 'ROLE') MENU_ROLES.forEach(role => editableTabs.forEach(tab => { roleDraft[role][tab] = defaultTabAccess(tab, role); }));
            else { const person = personOf(userId); if (person) editableTabs.forEach(tab => { userDraft[tab] = roleSavedValue(person.role, tab); }); }
            render();
        }
    });
    host.addEventListener('change', (e) => {
        const box = e.target;
        if (box.id === 'mp-user') {
            if (!confirmDiscard()) { box.value = userId; return; }
            userId = box.value;
            resetDrafts();
            render();
            return;
        }
        if (box.type !== 'checkbox' || !canEdit) return;
        if (box.dataset.role) roleDraft[box.dataset.role][box.dataset.tab] = box.checked;
        else if (box.dataset.userTab) userDraft[box.dataset.userTab] = box.checked;
        else if (box.dataset.allRole) editableTabs.forEach(tab => { roleDraft[box.dataset.allRole][tab] = box.checked; });
        else if (box.dataset.groupRole) (sections.find(section => section.label === box.dataset.group)?.tabs || []).filter(tab => !isFixed(tab)).forEach(tab => { roleDraft[box.dataset.groupRole][tab] = box.checked; });
        else if ('allUser' in box.dataset) editableTabs.forEach(tab => { userDraft[tab] = box.checked; });
        else return;
        render();
    });
    host.addEventListener('input', (e) => {
        if (e.target.id !== 'mp-search') return;
        keywordText = e.target.value;
        keyword = keywordText.trim().toLowerCase();
        const scroller = host.querySelector('#mp-scroll');
        if (!scroller) return;
        // 검색 칸의 커서가 끊기지 않게 표만 다시 그린다
        scroller.innerHTML = mode === 'ROLE' ? roleTableHtml() : userTableHtml();
        createIcons({ icons });
        syncBulkChecks();
    });

    resetDrafts();
    render();
    load();
    return { setProfiles };
};
