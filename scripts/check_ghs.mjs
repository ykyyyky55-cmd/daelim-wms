// ==========================================
// 혼합물 MSDS 작성 — 분류 계산 점검 (화면·DB 없이 Node에서: node scripts/check_ghs.mjs)
// ==========================================
// src/services/ghs의 순수 함수(표 · 분류 계산 · 경고표지 항목 · 분류 글 해석 · 위험물 구분)가 고시(고용노동부고시 제2026-26호) 규칙대로 도는지 본다.
// 고시가 개정되거나 ghsTables.js · mixtureClassify.js · msdsBuild.js · substanceParse.js를 고치면 다시 돌린다.
// 성분·함유량은 모두 임의로 지은 예시다 (실제 제품의 배합이 아니다 — 실제 배합을 여기에 넣지 말 것).
const imp = (f) => import(new URL(`../src/services/ghs/${f}`, import.meta.url).href);
const T = await imp('ghsTables.js');
const M = await imp('mixtureClassify.js');
const S = await imp('substanceParse.js');
const B = await imp('msdsBuild.js');
let fail = 0;
const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a !== b) { fail++; console.log(`✗ ${name}\n   got  ${a}\n   want ${b}`); } else console.log(`✓ ${name}`); };
const keys = (res) => res.classes.map(x => `${x.c}:${x.k}${x.form ? '/' + x.form : ''}`);

// ---- 표 무결성: 모든 분류의 H·P 코드에 문구가 있는가 ----
const missing = [];
T.GHS_CLASSES.forEach(cl => cl.cats.forEach(ct => { ct.h.forEach(h => { if (!T.H_TEXT[h]) missing.push(`${cl.key}/${ct.k} ${h}`); }); ['prev', 'resp', 'stor', 'disp'].forEach(g => ct.p[g].forEach(p => { if (!T.P_TEXT[p]) missing.push(`${cl.key}/${ct.k} ${p}`); })); ct.pic.forEach(p => { if (!T.PICTOGRAMS[p]) missing.push(`${cl.key}/${ct.k} ${p}`); }); }));
eq('표: 문구 없는 코드 없음', missing, []);
eq('표: 채운 문구에 … 남는 코드', Object.keys(T.P_TEXT).filter(c => /…/.test(T.pText(c))).sort(), ['P230', 'P411', 'P413']);
eq('MSDS 칸 수', T.MSDS_TEXT_KEYS.length, 90);

// ---- 분류 글자 해석 ----
eq('해석: 톨루엔', S.parseClassText('인화성 액체 : 구분2|피부 부식성/피부 자극성 : 구분2|생식독성 : 구분2|특정표적장기 독성(1회 노출) : 구분3(마취영향)|특정표적장기 독성(반복 노출) : 구분2|흡인 유해성 : 구분1').map(e => e.c + ':' + e.k),
    ['FLAM_LIQ:2', 'SKIN:2', 'REPRO:2', 'STOT_SE:3N', 'STOT_RE:2', 'ASP:1']);
eq('해석: 포름알데히드', S.parseClassText('인화성 가스 : 구분1|고압가스 : 액화가스|급성 독성(경구) : 구분3|급성 독성(경피) : 구분3|급성 독성(흡입: 증기) : 구분2|피부 부식성/피부 자극성 : 구분1|심한 눈 손상성/눈 자극성 : 구분2|호흡기 과민성 : 구분1(1A/1B)|피부 과민성 : 구분1(1A/1B)|생식세포 변이원성 : 구분2|발암성 : 구분1A|특정표적장기 독성(1회 노출) : 구분1|특정표적장기 독성(반복 노출) : 구분1|만성 수생환경 유해성 : 구분3').map(e => e.c + ':' + e.k + (e.form ? '/' + e.form : '')),
    ['FLAM_GAS:1', 'PRESS_GAS:LIQ', 'ACUTE_ORAL:3', 'ACUTE_DERMAL:3', 'ACUTE_INH:2/VAPOR', 'SKIN:1', 'EYE:2', 'RESP_SENS:1', 'SKIN_SENS:1', 'MUTA:2', 'CARC:1A', 'STOT_SE:1', 'STOT_RE:1', 'AQ_CHRONIC:3']);
eq('해석: 기타 표기', S.parseClassText('급성 수생환경 유해성 : 구분1\n심한 눈 손상성/눈 자극성 : 구분2(2A)\n생식독성 : 수유독성\n자기반응성 물질 및 혼합물 : 형식 C\n특정표적장기 독성(1회 노출) : 구분3(호흡기계자극)\n알 수 없는 줄').map(e => e.c + ':' + e.k),
    ['AQ_ACUTE:1', 'EYE:2A', 'REPRO:L', 'SELF_REACT:CD', 'STOT_SE:3R']);
eq('CAS 검증', [S.isValidCas('108-88-3'), S.isValidCas('64742-54-7'), S.isValidCas('108-88-4'), S.isValidCas('abc')], [true, true, false, false]);
eq('ATE 읽기', [S.parseAteText('LD50 5580 ㎎/㎏ 실험종 : Rat', 'oral'), S.parseAteText('LD50 &gt;5000 ㎎/㎏  실험종 : Rabbit', 'dermal'), S.parseAteText('증기 LC50 12.5 ㎎/ℓ 4 hr 실험종 : Rat', 'inh'), S.parseAteText('증기 LC50 2.5 ㎎/ℓ  6 hr', 'inh'), S.parseAteText('가스 LC50 5000 ㎎/㎥', 'inh'), S.parseAteText('LC50 463 ppm', 'inh')],
    [{ route: 'oral', value: 5580 }, null, { route: 'vapor', value: 12.5 }, null, { route: 'gas', value: 5 }, { route: 'gas', value: 463 }]);

// ---- 혼합물 분류 ----
const c = (name, pct, cls, extra = {}) => ({ name, pct, cls: S.parseClassText(cls), ...extra });
// 1) 엔진오일: 기유 85(분류 없음) + 첨가제(피부 2·눈 2·급성수생 1) 10 + 기타 5 → 분류 안 됨
eq('윤활유: 분류 없음', keys(M.classifyMixture([c('기유', 85, ''), c('ZDDP', 1.2, '피부 부식성/피부 자극성 : 구분2|심한 눈 손상성/눈 자극성 : 구분2|급성 수생환경 유해성 : 구분1'), c('점도지수 향상제', 13.8, '')], { state: 'LIQUID', flashPoint: 220, kv40: 60 })), []);
// 2) 부동액: 에틸렌글리콜 93 + 물 5 + 첨가제 2
const eg = '급성 독성(경구) : 구분4|피부 부식성/피부 자극성 : 구분2|심한 눈 손상성/눈 자극성 : 구분2|특정표적장기 독성(1회 노출) : 구분2|특정표적장기 독성(1회 노출) : 구분3(호흡기 자극)|특정표적장기 독성(반복 노출) : 구분2';
const af = M.classifyMixture([c('에틸렌 글리콜', 93, eg), c('물', 5, ''), c('방청제', 2, '')], { state: 'LIQUID', flashPoint: 111 });
eq('부동액: 분류', keys(af), ['ACUTE_ORAL:4', 'SKIN:2', 'EYE:2', 'STOT_SE:2', 'STOT_SE:3R', 'STOT_RE:2']);
eq('부동액: ATEmix 경구', Math.round(af.ate[0].ateMix * 10) / 10, 537.6); // 100 ÷ (93/500)
const afLabel = M.buildLabel(af.classes, { state: 'LIQUID' });
eq('부동액: 그림문자·신호어', [afLabel.pictograms, afLabel.signal], [['GHS07', 'GHS08'], 'WARNING']);
eq('부동액: H', afLabel.h.map(x => x.code), ['H302', 'H315', 'H319', 'H335', 'H371', 'H373']);
// 희석 부동액 50%: 경구 ATE 1075 → 구분 4, 피부 2 합 46.5 ≥10, STOT SE 2 ≥10, 3R 46.5 ≥ 20
eq('부동액 50%: 분류', keys(M.classifyMixture([c('에틸렌 글리콜', 46.5, eg), c('물', 53.5, '')], { flashPoint: null })), ['ACUTE_ORAL:4', 'SKIN:2', 'EYE:2', 'STOT_SE:2', 'STOT_SE:3R', 'STOT_RE:2']);
// 에틸렌글리콜 8%: 경구 ATE 6250 → 없음, 피부 2 합 8 <10 없음, STOT 2 성분 <10 없음
eq('글리콜 8%: 분류 없음', keys(M.classifyMixture([c('에틸렌 글리콜', 8, eg), c('물', 92, '')])), []);
// 3) 연료첨가제: 용제 나프타 70(인화3·흡인1·마취3·만성수생2) + 2-EHN 20(급성독성 경구4·경피4·흡입4, 만성2) + 기타 10, 인화점 45, 동점도 2
const naphtha = '인화성 액체 : 구분3|특정표적장기 독성(1회 노출) : 구분3(마취영향)|흡인 유해성 : 구분1|만성 수생환경 유해성 : 구분2';
const ehn = '급성 독성(경구) : 구분4|급성 독성(경피) : 구분4|급성 독성(흡입: 증기) : 구분4|만성 수생환경 유해성 : 구분2';
const fa = M.classifyMixture([c('용제 나프타', 70, naphtha), c('2-EHN', 20, ehn), c('기타', 10, '')], { state: 'LIQUID', flashPoint: 45, kv40: 2 });
eq('연료첨가제: 분류', keys(fa), ['FLAM_LIQ:3', 'STOT_SE:3N', 'ASP:1', 'AQ_CHRONIC:2']); // 경구 ATE 100/(20/500)=2500 → 없음, 경피 5500, 증기 55
const faLabel = M.buildLabel(fa.classes, { state: 'LIQUID' });
eq('연료첨가제: 그림문자·신호어', [faLabel.pictograms, faLabel.signal], [['GHS02', 'GHS07', 'GHS08', 'GHS09'], 'DANGER']);
eq('연료첨가제: P 대응', faLabel.p.resp.map(x => x.code), ['P301+P310', 'P303+P361+P353', 'P304+P340', 'P312', 'P331', 'P370+P378', 'P391']);
eq('연료첨가제: P 저장', faLabel.p.stor.map(x => x.code), ['P403+P233', 'P403+P235', 'P405']);
// 동점도가 높으면 흡인 유해성 없음
eq('동점도 25 → 흡인 없음', keys(M.classifyMixture([c('용제 나프타', 70, naphtha), c('기유', 30, '')], { flashPoint: 100, kv40: 25 })), ['STOT_SE:3N', 'AQ_CHRONIC:2']);
// 인화점 없음 → 경고, 인화점 20 + 끓는점 30 → 구분 1
eq('인화점 미입력 경고', M.classifyMixture([c('톨루엔', 50, '인화성 액체 : 구분2'), c('기타', 50, '')]).notes.some(n => /인화점을 입력/.test(n.text)), true);
eq('인화점 20·끓는점 30', keys(M.classifyMixture([c('가', 100, '')], { flashPoint: 20, boilingPoint: 30 })), ['FLAM_LIQ:1']);
// 4) 급성독성 가산식: A 10%(경구 구분 3 = 100), B 5%(LD50 30 → 구분 2 실측) → 100/(10/100+5/30)=375 → 구분 4
const at = M.classifyMixture([c('A', 10, '급성 독성(경구) : 구분3'), c('B', 5, '급성 독성(경구) : 구분2', { ate: { oral: 30 } }), c('물', 85, '')]);
eq('급성독성 가산식', [keys(at), Math.round(at.ate[0].ateMix)], [['ACUTE_ORAL:4'], 375]);
// 미상 성분 20% → 공식 2: (100-20)/(10/100) = 800 → 구분 4
const un = M.classifyMixture([c('A', 10, '급성 독성(경구) : 구분3'), c('미상', 20, '', { unknown: true }), c('물', 70, '')]);
eq('급성독성 공식 2', [keys(un), Math.round(un.ate[0].ateMix), un.unknownPct], [['ACUTE_ORAL:4'], 800, 20]);
// 5) 피부 부식성 소구분: 1B 3% + 1C 3% → 합 6 ≥5, 1A+1B=3 <5 → 1C / 눈 1
eq('피부 부식성 소구분', keys(M.classifyMixture([c('가', 3, '피부 부식성/피부 자극성 : 구분1B'), c('나', 3, '피부 부식성/피부 자극성 : 구분1C'), c('물', 94, '')])), ['SKIN:1C', 'EYE:1']);
// 피부 1 성분 2% → 피부 2, 눈: 1% 이상 3% 미만 → 눈 2
eq('피부 1 성분 2%', keys(M.classifyMixture([c('가', 2, '피부 부식성/피부 자극성 : 구분1'), c('물', 98, '')])), ['SKIN:2', 'EYE:2']);
// 피부 1 0.5% + 피부 2 6% → 10×0.5+6 = 11 ≥ 10 → 피부 2 ; 눈: e1=0.5, e2=0 → 없음
eq('가중 합', keys(M.classifyMixture([c('가', 0.5, '피부 부식성/피부 자극성 : 구분1'), c('나', 6, '피부 부식성/피부 자극성 : 구분2'), c('물', 93.5, '')])), ['SKIN:2']);
// 눈 2B만 12% → 2B
eq('눈 2B', keys(M.classifyMixture([c('가', 12, '심한 눈 손상성/눈 자극성 : 구분2B'), c('물', 88, '')])), ['EYE:2B']);
// pH 12.5 → 피부 1, 눈 1
eq('pH 12.5', keys(M.classifyMixture([c('가', 5, ''), c('물', 95, '')], { ph: 12.5 })), ['SKIN:1', 'EYE:1']);
// 가산 방식 적용 불가 성분 1.5%(구분 1) → 피부 1
eq('가산 불가 성분', keys(M.classifyMixture([c('수산화나트륨', 1.5, '피부 부식성/피부 자극성 : 구분1A', { nonAdditive: true }), c('물', 98.5, '')])), ['SKIN:1', 'EYE:1'].map((x, i) => (i ? x : 'SKIN:1')));
// 6) 과민성·CMR 한계농도
eq('과민성 1A 0.2%', keys(M.classifyMixture([c('가', 0.2, '피부 과민성 : 구분1A'), c('물', 99.8, '')])), ['SKIN_SENS:1A']);
eq('과민성 1 0.5% → 없음', keys(M.classifyMixture([c('가', 0.5, '피부 과민성 : 구분1'), c('물', 99.5, '')])), []);
eq('발암성 1B 0.1%', keys(M.classifyMixture([c('가', 0.1, '발암성 : 구분1B'), c('물', 99.9, '')])), ['CARC:1B']);
eq('발암성 2 0.9% → 없음', keys(M.classifyMixture([c('가', 0.9, '발암성 : 구분2'), c('물', 99.1, '')])), []);
eq('생식독성 1B 0.3%·수유 0.3%', keys(M.classifyMixture([c('붕산', 0.3, '생식독성 : 구분1B'), c('나', 0.3, '생식독성 : 수유독성'), c('물', 99.4, '')])), ['REPRO:1B', 'REPRO:L']);
eq('생식독성 2 2.9% → 없음', keys(M.classifyMixture([c('가', 2.9, '생식독성 : 구분2'), c('물', 97.1, '')])), []);
// 7) 표적장기: 구분 1 성분 5% → 구분 2
eq('STOT 1 성분 5%', keys(M.classifyMixture([c('가', 5, '특정표적장기 독성(반복 노출) : 구분1'), c('물', 95, '')])), ['STOT_RE:2']);
// 8) 수생환경: 급성1·만성1 2%(M 10) + 만성2 4% → 급성: 20 <25 없음, 만성: c1m 20 → 10×20+4 ≥25 → 만성 2
eq('수생환경 M', keys(M.classifyMixture([c('가', 2, '급성 수생환경 유해성 : 구분1|만성 수생환경 유해성 : 구분1', { m: { acute: 10, chronic: 10 } }), c('나', 4, '만성 수생환경 유해성 : 구분2'), c('기유', 94, '')], { flashPoint: 200 })), ['AQ_CHRONIC:2']);
eq('수생환경 급성1 M 100', keys(M.classifyMixture([c('가', 0.3, '급성 수생환경 유해성 : 구분1|만성 수생환경 유해성 : 구분1', { m: { acute: 100, chronic: 100 } }), c('기유', 99.7, '')])), ['AQ_ACUTE:1', 'AQ_CHRONIC:1']);
const lb = M.buildLabel(M.classifyMixture([c('가', 0.3, '급성 수생환경 유해성 : 구분1|만성 수생환경 유해성 : 구분1', { m: { acute: 100, chronic: 100 } }), c('기유', 99.7, '')]).classes);
eq('H400은 H410에 포함', [lb.h.map(x => x.code), lb.signal, lb.pictograms], [['H410'], 'WARNING', ['GHS09']]);
// 9) 그림문자 우선순위: 급성독성 3(해골) + 피부 자극 2 + 피부 과민성 → 감탄부호 없음
const pr = M.buildLabel(M.classifyMixture([c('가', 50, '급성 독성(경구) : 구분3|피부 부식성/피부 자극성 : 구분2|피부 과민성 : 구분1'), c('물', 50, '')]).classes);
eq('해골이면 감탄부호 없음', [pr.pictograms, pr.signal], [['GHS06'], 'DANGER']);
// 부식성 + 급성독성 4 → 부식성 + 감탄부호(급성독성 4 때문)
const pr2 = M.buildLabel(M.classifyMixture([c('가', 30, '급성 독성(경구) : 구분4|피부 부식성/피부 자극성 : 구분1B'), c('물', 70, '')]).classes);
eq('부식성 + 급성독성 4', [pr2.pictograms, pr2.h.map(x => x.code)], [['GHS05', 'GHS07'], ['H314']].map((x, i) => (i ? ['H302', 'H314'] : x)));
// 호흡기 과민성 + 피부 과민성 → 감탄부호 없음
const pr3 = M.buildLabel(M.classifyMixture([c('가', 5, '호흡기 과민성 : 구분1|피부 과민성 : 구분1'), c('물', 95, '')]).classes);
eq('호흡기 과민성이면 피부 과민성 감탄부호 없음', pr3.pictograms, ['GHS08']);
// 10) 직접 지정
eq('직접 지정', keys(M.classifyMixture([c('에틸렌 글리콜', 93, eg), c('물', 7, '')], { overrides: { STOT_SE: { k: 'NONE' }, SKIN: { k: 'NONE', reason: '제품 시험 결과 비자극' }, CARC: { k: '2' } }, physManual: [{ c: 'MET_CORR', k: '1' }] })), ['MET_CORR:1', 'ACUTE_ORAL:4', 'EYE:2', 'CARC:2', 'STOT_RE:2']);
// 합계 경고
eq('합계 경고', M.classifyMixture([c('가', 50, '')]).notes.some(n => /100%/.test(n.text)), true);
// 표적장기 문구
const og = M.buildLabel(M.classifyMixture([c('에틸렌 글리콜', 93, eg), c('물', 7, '')], { organs: { STOT_SE: '중추신경계, 신장', STOT_RE: '신장' } }).classes);
eq('표적장기 문구', og.h.filter(x => /^H37/.test(x.code)).map(x => x.text), ['장기(중추신경계, 신장)에 손상을 일으킬 수 있음', '장기간 또는 반복노출 되면 장기(신장)에 손상을 일으킬 수 있음']);

// ---- 15항 위험물안전관리법 구분 (인화점 기준 · 알코올류 · 가연성 액체량 안내) ----
const dg = B.dangerousGoodsOf;
eq('위험물: 인화점 230 → 제4석유류', dg({ state: 'LIQUID', fp: 230 }), '제4류 인화성 액체 제4석유류, 지정수량 6,000 L');
eq('위험물: 인화점 260 → 해당 없음', dg({ state: 'LIQUID', fp: 260 }), '해당 없음 (인화점 250℃ 이상)');
eq('위험물: 인화점 111·수용성 → 제3석유류', dg({ state: 'LIQUID', fp: 111, waterSoluble: true }), '제4류 인화성 액체 제3석유류(수용성 액체), 지정수량 4,000 L');
eq('위험물: 인화점 45 → 제2석유류', dg({ state: 'LIQUID', fp: 45 }), '제4류 인화성 액체 제2석유류(비수용성 액체), 지정수량 1,000 L');
eq('위험물: 인화점 -5 → 제1석유류', dg({ state: 'LIQUID', fp: -5 }), '제4류 인화성 액체 제1석유류(비수용성 액체), 지정수량 200 L');
eq('위험물: 특수인화물', [dg({ state: 'LIQUID', fp: -30, bp: 35 }), dg({ state: 'LIQUID', fp: '', ait: 90 })], ['제4류 인화성 액체 특수인화물, 지정수량 50 L', '제4류 인화성 액체 특수인화물, 지정수량 50 L']);
eq('위험물: 알코올 60% 이상', [dg({ state: 'LIQUID', fp: 13, alcoholPct: 70 }), dg({ state: 'LIQUID', fp: '', alcoholPct: 99 })], ['제4류 인화성 액체 알코올류, 지정수량 400 L', '제4류 인화성 액체 알코올류, 지정수량 400 L']);
eq('위험물: 인화점 없음·고체', [dg({ state: 'LIQUID', fp: '' }), dg({ state: 'SOLID', fp: 30 })], ['', '']);
const mk = (comps, props) => {
    const d = B.emptyDoc();
    d.product.name = '예시';
    d.supplier = { company: '예시', address: '예시', phone: '000' };
    d.comps = comps.map(([cas, pct]) => ({ cas, name: cas, pct, show: 'AUTO', own: true, cls: [] }));
    Object.assign(d.props, props);
    return B.buildMsds(d, new Map());
};
const hasNote = (built, word) => built.warnings.some(w => w.includes(word));
let b = mk([['64-17-5', 35], ['7732-18-5', 65]], { fp: 28, waterSoluble: true });
eq('15항: 에탄올 35% 수용액 → 인화점 기준 + 물 60% 이상 안내', [b.text['s15.danger'], hasNote(b, '가연성 액체량이 40중량% 이하')], ['제4류 인화성 액체 제2석유류(수용성 액체), 지정수량 2,000 L', true]);
b = mk([['64-17-5', 70], ['7732-18-5', 30]], { fp: 21 });
eq('15항: 에탄올 70% 수용액 → 알코올류', [b.text['s15.danger'], hasNote(b, '알코올류(지정수량 400 L)에 해당하는지')], ['제4류 인화성 액체 알코올류, 지정수량 400 L', false]);
b = mk([['67-63-0', 70], ['67-64-1', 30]], { fp: -5 });
eq('15항: 알코올 70% + 다른 용제 → 인화점 기준 + 확인 안내', [b.text['s15.danger'], hasNote(b, '알코올류(지정수량 400 L)에 해당하는지')], ['제4류 인화성 액체 제1석유류(비수용성 액체), 지정수량 200 L', true]);

// ---- 3항 표시 함유량 ----
eq('표시 함유량 자동 범위', [0.5, 1, 4.9, 5, 12, 93, 97, 100].map(B.autoRange), ['1 미만', '1 ~ 5', '1 ~ 5', '5 ~ 10', '10 ~ 15', '90 ~ 95', '95 ~ 100', '100']);
// 실제 12% → 7 ~ 17 안의 범위만 된다 (제11조제10항), 대체함유량은 25% 미만 ±10%P (제17조제5항)
eq('표시 함유량 ±5%P 검사', [B.checkRange('10 ~ 20', 12, 5), B.checkRange('5 ~ 15', 12, 5), B.checkRange('8 ~ 16', 12, 5), B.checkRange('1 미만', 0.5, 5), B.checkRange('10 ~ 30', 20, 10), B.checkRange('약간', 3, 5)], ['OUT', 'OUT', 'OK', 'OK', 'OK', 'TEXT']);

console.log(fail ? '실패 ' + fail + '건' : '모두 통과');
process.exitCode = fail ? 1 : 0;
