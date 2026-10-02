import { setupSlipIssuer } from './SlipIssuer.js';

// 생산관리 → 전표발행: 거래 출하 전표 발행기(환경설정의 📄 창과 같은 것)를 메뉴 화면으로 연다.
export const renderSlipIssuePage = (container, { showToast }) => {
    container.innerHTML = '<section id="slip-page" class="max-w-6xl"></section>';
    const host = container.querySelector('#slip-page');
    setupSlipIssuer(host, { showToast, inline: true, crumb: '전표·라벨 › 전표발행' });
    host.dispatchEvent(new Event('modal:open'));
};
