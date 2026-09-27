import formtecLabels from '../data/formtecLabels.json';

// QR 다목적 라벨 용지 (실제 폼텍 규격: src/data/formtecLabels.json) — [코드, 용도]
// 라벨 발행(LabelPrinter)과 현장 QR 라벨(FieldQrLabels)이 같이 쓴다.
export const ROLL_PAPER = { code: 'roll-10080', sheet: '감열 롤', sheetW: 100, sheetH: 80, across: 1, down: 1, left: 0, top: 0, gapX: 0, gapY: 0, w: 100, h: 80, shape: 'rect', radius: 0 };
export const QR_LABEL_PAPERS = [
    { group: '[대형] 드럼 & 페일용', items: [['3120', '200L 드럼/파렛트'], ['3118', '20L 페일/말통']] },
    { group: '[중형] 박스 & 윤활유 용기용', items: [['3116', '중형 박스용'], ['3114', '물류 출하 박스용'], ['3108', '표준 부착용'], ['3218', '다목적용']] },
    { group: '[소형 및 감열 롤] 부품 & 연속용', items: [['3106', '소형 캔/샘플병'], ['3105', '소형 용기'], ['3102', '바코드·부품용'], [ROLL_PAPER.code, '바코드 프린터용 (100 x 80 mm)']] }
];
export const qrPaperOf = (code) => (code === ROLL_PAPER.code ? ROLL_PAPER : formtecLabels.find(p => p.code === code && p.sheet === 'A4'));
