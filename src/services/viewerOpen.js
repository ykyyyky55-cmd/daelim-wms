// ==========================================
// 앱에 보관한 파일을 TOOL → 뷰어 및 편집기(탭 docTools)에서 열기
// ==========================================
// 자료실·문서 첨부·파일 저장소·일정·채팅 첨부의 [열기]가 부른다.
// 엑셀(xlsx·xls·csv·ods) → 엑셀 편집기, PDF → PDF 편집기, Word(.docx)·HTML·TXT → 문서 편집기.
// 그림·한글(.hwp) 등 뷰어가 못 여는 파일은 viewerTabOf가 null → 부르는 쪽이 예전처럼 새 창으로 연다.
import { canAccessTab } from './auth.js';

const RULES = [
    ['excel', /\.(xlsx|xlsm|xls|csv|ods)$/i, /spreadsheet|excel|text\/csv|opendocument\.spreadsheet/i],
    ['pdf', /\.pdf$/i, /application\/pdf/i],
    ['docs', /\.(docx|html?|txt|md)$/i, /wordprocessingml|text\/html|text\/plain|text\/markdown/i]
];

/** 뷰어에서 열 수 있으면 편집기 이름('excel'|'pdf'|'docs'), 아니면 null */
export const viewerTabOf = (name = '', mime = '') => {
    const byName = RULES.find(([, ext]) => ext.test(name));
    if (byName) return byName[0];
    if (/\.[a-z0-9]{2,5}$/i.test(name)) return null; // 확장자가 있는데 위에 없으면 (hwp·zip·그림 등) 못 연다
    return RULES.find(([, , m]) => m.test(mime))?.[0] || null;
};

/** 뷰어 화면을 쓸 수 있는 사용자인지 (메뉴 권한) */
export const canUseViewer = () => canAccessTab('docTools');

/**
 * 파일 주소를 받아 뷰어 및 편집기로 넘긴다
 * @param {{ name: string, mime?: string, url?: string, blob?: Blob }} f  url(서명 URL·blob:·data:·앱 안 경로) 또는 blob
 * @returns {Promise<boolean>} 뷰어로 넘겼으면 true, 뷰어가 못 여는 파일·권한 없음이면 false
 */
export const openFileInViewer = async ({ name, mime = '', url = '', blob = null }) => {
    const tab = viewerTabOf(name, mime);
    if (!tab || !canUseViewer() || typeof window.__switchTab !== 'function') return false;
    let data = blob;
    if (!data) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`파일을 불러오지 못했습니다 (${res.status}). 잠시 뒤 다시 시도하세요.`);
        data = await res.blob();
    }
    const file = new File([data], name || '파일', { type: mime || data.type || '' });
    // DocTools.js의 openInDocTools와 같은 모양 (뷰어 모듈을 여기서 미리 불러오지 않으려고 직접 넣는다)
    // url은 HTML 문서 안의 상대 경로(그림 등)를 찾는 기준 주소로 쓴다
    window.__docToolsPending = { tab, payload: { file, url } };
    try { localStorage.setItem('daelim_doctools_tab', tab); } catch { /* 탭 기억만 못 함 */ }
    // 이미 뷰어 화면이면(채팅 창처럼 떠 있는 도구에서 연 경우) 다시 그려서 넘긴 파일을 연다
    if (window.__activeTab === 'docTools') window.__rerenderDocTools?.();
    else window.__switchTab('docTools');
    // 저장 안 한 편집 내용 때문에 옮기기를 취소했으면, 넘긴 파일이 나중에 엉뚱하게 열리지 않게 비운다
    if (window.__activeTab !== 'docTools') window.__docToolsPending = null;
    return true;
};
