// ==========================================
// 제품생산/입고 메뉴의 거점 (본사 · 김포)
// ==========================================
// 제품생산/입고는 거점마다 메뉴가 따로다. 두 메뉴는 같은 화면(components/ProductionManager.js)을 site로 나눠 쓴다
// (업무일지 본사·김포와 같은 방식 — 거점 키는 db.js WORKLOG_SITES의 'HQ' | 'GIMPO').
// 김포 메뉴는 예전 탭 이름 'production'을 그대로 쓴다: 저장해 둔 즐겨찾기·홈 바로가기·주소(#production)가 그대로 열린다.
import { siteOf } from './locations.js';

/** 거점 키 → 탭 이름 */
export const PROD_TABS = { HQ: 'productionHq', GIMPO: 'production' };
/** 탭 이름 → 거점 키 */
export const PROD_SITE_OF_TAB = { productionHq: 'HQ', production: 'GIMPO' };

const HQ_SITE_NAME = '본사';
const LAST_SITE_KEY = 'daelim_prod_site'; // 이 기기에서 마지막으로 연 제품생산/입고 메뉴의 거점

/** 위치('거점' 또는 '거점 / 창고') → 거점 키. 본사가 아니면 김포 (prodReflect.worklogSiteOfLocation과 같은 규칙) */
export const prodSiteOfLocation = (loc) => (siteOf(loc) === HQ_SITE_NAME ? 'HQ' : 'GIMPO');

/** 위치 → 그 거점의 제품생산/입고 탭 */
export const prodTabOfLocation = (loc) => PROD_TABS[prodSiteOfLocation(loc)];

/** 메뉴를 열 때마다 불러 둔다 (기기별) */
export const rememberProdSite = (site) => {
    try { localStorage.setItem(LAST_SITE_KEY, site === 'HQ' ? 'HQ' : 'GIMPO'); } catch { /* 저장할 수 없는 브라우저: 다음에도 기본값(김포)으로 연다 */ }
};

/** 이 기기에서 마지막으로 연 메뉴의 거점 (없으면 김포 — 나누기 전 화면의 기본 거점) */
export const lastProdSite = () => {
    try { return localStorage.getItem(LAST_SITE_KEY) === 'HQ' ? 'HQ' : 'GIMPO'; } catch { return 'GIMPO'; }
};

/** 거점을 알 수 없는 곳(품목 QR·생산입고 작업 QR)에서 열 탭: 이 기기에서 마지막으로 연 제품생산/입고 메뉴 */
export const lastProdTab = () => PROD_TABS[lastProdSite()];
