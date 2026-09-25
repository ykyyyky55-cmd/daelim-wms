// 윤활유 충진 용량/중량 환산 및 보정계산기 (독립 정적 도구, public/tools/lubricant-calculator.html)
// 자체 계산 로직을 그대로 쓰기 위해 iframe으로 그대로 띄운다.
export const renderLubricantCalculator = (container) => {
    const src = `${import.meta.env.BASE_URL}tools/lubricant-calculator.html`;
    container.innerHTML = `
    <section class="space-y-3">
        <iframe src="${src}" title="윤활유 충진 보정계산기" class="w-full border border-slate-200 rounded-2xl bg-white shadow-sm" style="height: calc(100vh - 220px); min-height: 640px;"></iframe>
    </section>`;
};
