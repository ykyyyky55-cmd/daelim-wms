// 대한민국 공휴일·명절 (캘린더 표시용)
// 양력 고정 공휴일 + 음력 명절(설날·추석·부처님오신날, 양력 환산표) + 대체공휴일 규칙(공휴일에 관한 법률, 2023년 개정)
// + 선거일·임시공휴일(따로 지정되는 날)을 계산한다. 음력 환산표가 없는 해는 양력 공휴일만 나온다.
//
// 대체공휴일 규칙
//  - 설날·추석 연휴(전날·당일·다음날): 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 평일 (토요일은 해당 없음)
//  - 어린이날: 토·일요일 또는 다른 공휴일과 겹치면 다음 첫 평일
//  - 삼일절·광복절·개천절·한글날·부처님오신날·성탄절: 토·일요일과 겹치면 다음 첫 평일
//  - 신정·현충일: 대체공휴일 없음

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const dow = (s) => new Date(`${s}T00:00:00`).getDay();

// 음력 명절의 양력 날짜 (설날 = 음력 1/1, 부처님오신날 = 음력 4/8, 추석 = 음력 8/15)
const LUNAR = {
    2024: ['2024-02-10', '2024-05-15', '2024-09-17'],
    2025: ['2025-01-29', '2025-05-05', '2025-10-06'],
    2026: ['2026-02-17', '2026-05-24', '2026-09-25'],
    2027: ['2027-02-07', '2027-05-13', '2027-09-15'],
    2028: ['2028-01-27', '2028-05-02', '2028-10-03'],
    2029: ['2029-02-13', '2029-05-20', '2029-09-22'],
    2030: ['2030-02-03', '2030-05-09', '2030-09-12'],
    2031: ['2031-01-23', '2031-05-28', '2031-10-01'],
    2032: ['2032-02-11', '2032-05-16', '2032-09-19'],
    2033: ['2033-01-31', '2033-05-06', '2033-09-08'],
    2034: ['2034-02-19', '2034-05-25', '2034-09-27'],
    2035: ['2035-02-08', '2035-05-15', '2035-09-16']
};

// 따로 지정된 날 (선거일·임시공휴일). 새로 지정되면 여기에 추가한다.
const SPECIAL = {
    '2024-04-10': '국회의원선거',
    '2024-10-01': '임시공휴일(국군의날)',
    '2025-01-27': '임시공휴일',
    '2025-06-03': '대통령선거',
    '2026-06-03': '지방선거',
    '2028-04-12': '국회의원선거'
};

// 법정 공휴일은 아니지만 회사가 쉬는 날
const COMPANY = { '05-01': '근로자의 날' };

const cache = new Map();

// 한 해의 { 'YYYY-MM-DD': { name, kind } }  kind: holiday | lunar(명절) | substitute | special | company
export const holidaysOfYear = (year) => {
    if (cache.has(year)) return cache.get(year);
    const map = {};
    const add = (date, name, kind) => {
        if (map[date]) { if (!map[date].name.includes(name)) map[date] = { ...map[date], name: `${map[date].name}·${name}` }; return; }
        map[date] = { name, kind };
    };
    const fixed = [['01-01', '신정'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['06-06', '현충일'], ['08-15', '광복절'], ['10-03', '개천절'], ['10-09', '한글날'], ['12-25', '성탄절']];
    fixed.forEach(([md, name]) => add(`${year}-${md}`, name, 'holiday'));
    const lunar = LUNAR[year];
    let seollal = [];
    let chuseok = [];
    if (lunar) {
        const [s, b, c] = lunar;
        seollal = [addDays(s, -1), s, addDays(s, 1)];
        chuseok = [addDays(c, -1), c, addDays(c, 1)];
        add(seollal[0], '설날 연휴', 'lunar'); add(seollal[1], '설날', 'lunar'); add(seollal[2], '설날 연휴', 'lunar');
        add(b, '부처님오신날', 'holiday');
        add(chuseok[0], '추석 연휴', 'lunar'); add(chuseok[1], '추석', 'lunar'); add(chuseok[2], '추석 연휴', 'lunar');
    }
    Object.entries(SPECIAL).forEach(([d, name]) => { if (d.startsWith(`${year}-`)) add(d, name, 'special'); });

    // 대체공휴일: 겹친 날 다음의 '토·일·공휴일이 아닌' 첫날
    const isOff = (d) => dow(d) === 0 || dow(d) === 6 || !!map[d];
    const nextWorkday = (d) => { let x = addDays(d, 1); while (isOff(x)) x = addDays(x, 1); return x; };
    const subs = [];
    const countOf = (d) => (map[d] ? map[d].name.split('·').length : 0); // 같은 날 겹친 공휴일 수
    [seollal, chuseok].forEach(days => {
        if (!days.length) return;
        // 연휴 중 일요일이 있거나, 연휴 날이 다른 공휴일과 겹치면(이름이 둘 이상) 대체
        if (days.some(d => dow(d) === 0 || countOf(d) > 1)) subs.push({ after: days[2], name: '대체공휴일' });
    });
    const childDay = `${year}-05-05`;
    if (dow(childDay) === 0 || dow(childDay) === 6 || countOf(childDay) > 1) subs.push({ after: childDay, name: '대체공휴일' });
    const weekendRule = [`${year}-03-01`, `${year}-08-15`, `${year}-10-03`, `${year}-10-09`, `${year}-12-25`];
    if (lunar) weekendRule.push(lunar[1]);
    weekendRule.forEach(d => { if ((dow(d) === 0 || dow(d) === 6) && !(d === childDay)) subs.push({ after: d, name: '대체공휴일' }); });
    subs.sort((a, b) => a.after.localeCompare(b.after)).forEach(sub => { const d = nextWorkday(sub.after); if (d.startsWith(`${year}`)) add(d, sub.name, 'substitute'); });

    Object.entries(COMPANY).forEach(([md, name]) => { if (!map[`${year}-${md}`]) map[`${year}-${md}`] = { name, kind: 'company' }; });
    cache.set(year, map);
    return map;
};

// 'YYYY-MM-DD' → { name, kind } | null
export const holidayOf = (date) => (date ? holidaysOfYear(Number(date.slice(0, 4)))[date] || null : null);

// 빨간 날(법정 공휴일·명절·대체·선거일)인지 (회사 휴무 '근로자의 날'은 제외)
export const isPublicHoliday = (date) => { const h = holidayOf(date); return !!h && h.kind !== 'company'; };
