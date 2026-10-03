// ==========================================
// 창고 배치도 3D 모형 (2) — 방(칸막이) · 가구·가전 · 설비·시설 (참고 표시, 재고와 무관)
// ==========================================
// propModels.js의 도구(상자·원기둥·재질·부품 넣기)를 받아 모형을 만든다. 모두 바닥(y 0) 위, 중심이 원점, 앞 = -z.
// 평면 크기는 services/warehouseZones.js의 PROP_MODELS·propSize와 맞춘다 — 모양을 고치면 그 값도 고친다.
// 평면도의 모양은 propPlanShapes.js에 있다 (모형 종류를 더하면 PROP_MODELS · 여기 · propPlanShapes.js 세 곳에 넣는다).
import { PROP_MODELS, STAIR_STEP, stairElevatorLayout } from '../../services/warehouseZones.js';

const WALL = 0.1;        // 칸막이 벽 두께 (m)
const DOOR_WIDTH = 0.9;  // 방 문 자리 폭
const DOOR_HEIGHT = 2.1;

/**
 * @param {typeof import('three')} THREE
 * @param {{ box: Function, cyl: Function, cone: Function, mat: Function, part: Function, roller: Function, track: Function }} tools propModels.js의 도구 (track = 다시 그릴 때 정리할 목록에 넣기)
 * @returns {Record<string, (size: { h?: number, wide?: number, deep?: number, dia?: number, holes?: object[], gaps?: object }) => import('three').Group>} 모형 종류 → 만드는 함수
 */
export const createExtraProps = (THREE, { box, cyl, cone, mat, part, roller, track }) => {
    const group = () => new THREE.Group();
    const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
    const steel = () => mat('#64748b', { roughness: 0.55, metalness: 0.5 });
    const dark = () => mat('#1f2937');
    const white = () => mat('#f1f5f9', { roughness: 0.5, metalness: 0.05 });
    const wood = () => mat('#c8a26b', { roughness: 0.8, metalness: 0.02 });

    // ---------- 방: 바닥 색 + 칸막이 벽 넷 (앞 벽 가운데에 문 자리) ----------
    const room = (type, size) => {
        const model = PROP_MODELS[type];
        const wide = num(size.wide, model.params.wide), deep = num(size.deep, model.params.deep), h = num(size.h, model.params.h);
        const g = group();
        const wall = mat('#e2e8f0', { roughness: 0.9, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false });
        part(g, box(wide, 0.02, deep), mat(model.color, { roughness: 0.9, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.012, 0).castShadow = false;
        const add = (w, wallH, d, x, y, z) => { part(g, box(w, wallH, d), wall, x, y, z).castShadow = false; };
        add(wide, h, WALL, 0, h / 2, deep / 2 - WALL / 2);                       // 뒤 벽
        [-1, 1].forEach(side => add(WALL, h, deep, side * (wide / 2 - WALL / 2), h / 2, 0)); // 옆 벽
        // 앞 벽: 문 자리(가운데) 양옆 + 문 위
        const doorW = Math.min(DOOR_WIDTH, wide * 0.5), doorH = Math.min(DOOR_HEIGHT, h * 0.8), sideW = (wide - doorW) / 2;
        [-1, 1].forEach(side => add(sideW, h, WALL, side * (doorW / 2 + sideW / 2), h / 2, -deep / 2 + WALL / 2));
        add(doorW, h - doorH, WALL, 0, doorH + (h - doorH) / 2, -deep / 2 + WALL / 2);
        // 벽 위 테두리(방 색) — 위에서 봐도 방이 구분되게
        const rim = mat(model.color, { roughness: 0.7, metalness: 0.1 });
        [-1, 1].forEach((side) => {
            part(g, box(wide, 0.05, WALL), rim, 0, h + 0.025, side * (deep / 2 - WALL / 2)).castShadow = false;
            part(g, box(WALL, 0.05, deep), rim, side * (wide / 2 - WALL / 2), h + 0.025, 0).castShadow = false;
        });
        return g;
    };

    // ---------- 가구·가전 ----------
    const chairInto = (g, x, z, facing = 0) => {
        // facing = 의자가 바라보는 쪽 (0 = 앞(-z), Math.PI = 뒤)
        const seat = mat('#334155'), sx = Math.sin(facing), cz = Math.cos(facing);
        part(g, cyl(0.03, 0.42, 8), dark(), x, 0.21, z);
        part(g, cyl(0.24, 0.04, 12), dark(), x, 0.03, z);
        part(g, box(0.46, 0.07, 0.46), seat, x, 0.46, z);
        const back = part(g, box(0.44, 0.48, 0.06), seat, x + sx * 0.21, 0.75, z + cz * 0.21);
        back.rotation.y = facing;
    };
    const desk = () => {
        const g = group();
        part(g, box(1.4, 0.04, 0.7), wood(), 0, 0.72, 0);
        [-0.66, 0.66].forEach(x => part(g, box(0.05, 0.7, 0.64), steel(), x, 0.35, 0));
        part(g, box(0.4, 0.5, 0.6), white(), 0.45, 0.42, 0);                 // 서랍
        part(g, box(0.52, 0.32, 0.03), dark(), -0.15, 1.02, 0.18);          // 모니터
        part(g, box(0.06, 0.12, 0.06), dark(), -0.15, 0.8, 0.2);
        part(g, box(0.4, 0.02, 0.14), dark(), -0.15, 0.75, -0.12);          // 자판
        return g;
    };
    const chair = () => { const g = group(); chairInto(g, 0, 0, 0); return g; };
    const meetingTable = () => {
        const g = group();
        part(g, box(2.0, 0.05, 0.9), wood(), 0, 0.72, 0);
        [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach(([x, z]) => part(g, box(0.06, 0.7, 0.06), steel(), x, 0.35, z));
        [-0.65, 0, 0.65].forEach((x) => { chairInto(g, x, -0.78, Math.PI); chairInto(g, x, 0.78, 0); });
        return g;
    };
    const sofa = () => {
        const g = group();
        const fabric = mat('#475569', { roughness: 0.95, metalness: 0 });
        part(g, box(1.8, 0.4, 0.84), fabric, 0, 0.22, 0);
        part(g, box(1.8, 0.45, 0.2), fabric, 0, 0.62, 0.32);
        [-0.82, 0.82].forEach(x => part(g, box(0.16, 0.26, 0.84), fabric, x, 0.55, 0));
        return g;
    };
    const cabinet = () => {
        const g = group();
        part(g, box(0.9, 1.8, 0.45), mat('#cbd5e1', { roughness: 0.5, metalness: 0.4 }), 0, 0.9, 0);
        part(g, box(0.012, 1.7, 0.01), dark(), 0, 0.9, -0.228);              // 문 사이 틈
        [-0.06, 0.06].forEach(x => part(g, box(0.02, 0.14, 0.02), dark(), x, 0.95, -0.235));
        return g;
    };
    const locker = () => {
        const g = group();
        part(g, box(0.9, 1.8, 0.5), mat('#93c5fd', { roughness: 0.5, metalness: 0.4 }), 0, 0.9, 0);
        [-0.15, 0.15].forEach(x => part(g, box(0.012, 1.74, 0.01), dark(), x, 0.9, -0.253));
        [-0.3, 0, 0.3].forEach(x => part(g, box(0.1, 0.03, 0.01), dark(), x, 1.5, -0.255)); // 환기 틈
        return g;
    };
    const shelf = () => {
        const g = group();
        [[-0.58, -0.23], [0.58, -0.23], [-0.58, 0.23], [0.58, 0.23]].forEach(([x, z]) => part(g, box(0.04, 1.8, 0.04), steel(), x, 0.9, z));
        [0.15, 0.6, 1.05, 1.5, 1.78].forEach(y => part(g, box(1.2, 0.03, 0.5), mat('#e2e8f0', { roughness: 0.6, metalness: 0.3 }), 0, y, 0));
        return g;
    };
    const fridge = () => {
        const g = group();
        part(g, box(0.7, 1.8, 0.7), mat('#e5e7eb', { roughness: 0.35, metalness: 0.5 }), 0, 0.9, 0);
        part(g, box(0.68, 0.012, 0.01), dark(), 0, 1.15, -0.353);            // 위·아래 문 사이
        [1.4, 0.9].forEach(y => part(g, box(0.03, 0.3, 0.03), steel(), -0.26, y, -0.365));
        return g;
    };
    const water = () => {
        const g = group();
        part(g, box(0.32, 1.1, 0.36), white(), 0, 0.55, 0);
        part(g, box(0.26, 0.16, 0.02), dark(), 0, 0.78, -0.185);             // 물 나오는 곳
        part(g, box(0.26, 0.03, 0.12), steel(), 0, 0.66, -0.2);
        return g;
    };
    const aircon = () => {
        const g = group();
        part(g, box(0.5, 1.85, 0.36), white(), 0, 0.925, 0);
        part(g, box(0.4, 0.5, 0.012), mat('#94a3b8'), 0, 1.5, -0.185);       // 바람 나오는 곳
        part(g, box(0.4, 0.3, 0.012), mat('#cbd5e1'), 0, 0.3, -0.185);
        return g;
    };
    const copier = () => {
        const g = group();
        part(g, box(0.6, 0.75, 0.6), mat('#e5e7eb', { roughness: 0.5, metalness: 0.2 }), 0, 0.375, 0);
        part(g, box(0.62, 0.22, 0.62), mat('#475569'), 0, 0.86, 0);
        part(g, box(0.5, 0.05, 0.4), white(), 0, 1.0, 0.05);                 // 원고대
        part(g, box(0.2, 0.03, 0.12), dark(), 0.15, 0.99, -0.24);            // 조작판
        return g;
    };
    const sink = () => {
        const g = group();
        part(g, box(1.2, 0.82, 0.6), white(), 0, 0.41, 0);
        part(g, box(1.22, 0.04, 0.62), mat('#94a3b8', { roughness: 0.3, metalness: 0.7 }), 0, 0.84, 0);
        part(g, box(0.5, 0.02, 0.36), mat('#475569', { roughness: 0.3, metalness: 0.7 }), -0.25, 0.862, 0); // 개수대
        part(g, cyl(0.015, 0.25, 8), steel(), -0.25, 0.98, 0.22);            // 수도꼭지
        return g;
    };
    const toiletSeat = () => {
        const g = group();
        const china = mat('#f8fafc', { roughness: 0.25, metalness: 0.05 });
        part(g, box(0.38, 0.36, 0.18), china, 0, 0.6, 0.24);                 // 물탱크
        part(g, cyl(0.19, 0.4, 16), china, 0, 0.2, -0.05);                   // 변기 몸통
        part(g, cyl(0.2, 0.04, 16), mat('#e2e8f0'), 0, 0.42, -0.05);         // 뚜껑
        return g;
    };
    const washbasin = () => {
        const g = group();
        const china = mat('#f8fafc', { roughness: 0.25, metalness: 0.05 });
        part(g, cyl(0.07, 0.75, 10), china, 0, 0.375, 0.05);
        part(g, box(0.5, 0.14, 0.42), china, 0, 0.8, 0);
        part(g, cyl(0.015, 0.14, 8), steel(), 0, 0.93, 0.16);
        part(g, box(0.45, 0.6, 0.02), mat('#bae6fd', { roughness: 0.1, metalness: 0.6 }), 0, 1.5, 0.2); // 거울
        return g;
    };

    // ---------- 설비·시설 ----------
    // 엘리베이터: 승강로(반투명 벽) + 앞의 문 둘 + 문틀 + 호출 단추 + 위 기계실
    const elevator = (size) => {
        const model = PROP_MODELS.ELEVATOR;
        const wide = num(size.wide, model.params.wide), deep = num(size.deep, model.params.deep), h = num(size.h, model.params.h);
        const g = group();
        const shaft = mat('#cbd5e1', { roughness: 0.7, metalness: 0.2, transparent: true, opacity: 0.75, depthWrite: false });
        part(g, box(wide, h, deep), shaft, 0, h / 2, 0);
        const doorW = Math.min(1.1, wide * 0.55), frame = mat('#475569', { metalness: 0.6 });
        part(g, box(doorW + 0.16, 2.2, 0.05), frame, 0, 1.1, -deep / 2 - 0.02);
        [-1, 1].forEach(side => part(g, box(doorW / 2 - 0.01, 2.05, 0.04), mat('#e2e8f0', { roughness: 0.3, metalness: 0.7 }), side * doorW / 4, 1.04, -deep / 2 - 0.05));
        part(g, box(0.1, 0.18, 0.03), dark(), doorW / 2 + 0.22, 1.15, -deep / 2 - 0.02); // 호출 단추
        part(g, box(wide * 0.8, 0.5, deep * 0.8), frame, 0, h + 0.25, 0);                 // 기계실
        return g;
    };
    // 계단실: 벽(뒤·옆 — 앞은 열림) 안에 꺾인 계단 — 왼쪽 반으로 올라가 뒤쪽 참에서 돌아 오른쪽 반으로 올라온다
    const stairwell = (size) => {
        const model = PROP_MODELS.STAIRWELL;
        const wide = num(size.wide, model.params.wide), deep = num(size.deep, model.params.deep), h = num(size.h, model.params.h);
        const g = group();
        const wall = mat('#e2e8f0', { roughness: 0.9, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
        const add = (w, wallH, d, x, z) => { part(g, box(w, wallH, d), wall, x, wallH / 2, z).castShadow = false; };
        add(wide, h + 1.1, WALL, 0, deep / 2 - WALL / 2);
        [-1, 1].forEach(side => add(WALL, h + 1.1, deep, side * (wide / 2 - WALL / 2), 0));
        const plate = mat('#94a3b8', { roughness: 0.6, metalness: 0.4 }), rail = mat('#f59e0b', { roughness: 0.5, metalness: 0.3 });
        const landing = Math.min(1.2, deep * 0.25), run = deep - landing - WALL - 0.3, flightW = (wide - WALL * 2 - 0.1) / 2;
        const steps = Math.max(2, Math.ceil(h / 2 / STAIR_STEP.rise)), rise = h / 2 / steps, tread = run / steps;
        const z0 = -deep / 2 + 0.3; // 앞쪽 첫 단
        for (let i = 0; i < steps; i += 1) {
            part(g, box(flightW, 0.04, tread), plate, -(flightW / 2 + 0.05), rise * (i + 1) - 0.02, z0 + tread * (i + 0.5));           // 올라가는 쪽(왼쪽)
            part(g, box(flightW, 0.04, tread), plate, flightW / 2 + 0.05, h / 2 + rise * (i + 1) - 0.02, z0 + run - tread * (i + 0.5)); // 돌아 올라오는 쪽(오른쪽)
        }
        part(g, box(wide - WALL * 2, 0.08, landing), plate, 0, h / 2 - 0.04, deep / 2 - WALL - landing / 2);                             // 중간 참
        part(g, box(0.05, 0.9, run), rail, 0, h / 2 + 0.45, z0 + run / 2);                                                             // 가운데 난간
        return g;
    };
    // ㄷ자 계단실 + 가운데 엘리베이터 (칸 나누기 = warehouseZones.js stairElevatorLayout). 층마다: 홀(앞) → 왼쪽 계단(뒤쪽으로 반 층)
    // → 뒤쪽 참 → 오른쪽 계단(앞쪽으로 반 층) → 위층 홀 — 위에서 볼 때 시계 반대 방향. 승강로는 반투명 벽 + 층마다 홀 쪽 문.
    // size.showTop = 이 높이(모형 바닥에서 잰 m)까지만 그린다 — 3D에서 아래층을 골라 위층 건물을 감췄을 때 계단실도 그 층까지만
    const stairElevator = (size) => {
        const L = stairElevatorLayout(size);
        const total = L.h * L.floors, showTop = Number.isFinite(Number(size.showTop)) ? Math.min(total, Number(size.showTop)) : total;
        const g = group();
        const wall = mat('#e2e8f0', { roughness: 0.9, metalness: 0, transparent: true, opacity: 0.4, depthWrite: false });
        const plate = mat('#94a3b8', { roughness: 0.6, metalness: 0.4 }), slab = mat('#cbd5e1', { roughness: 0.85, metalness: 0.05 });
        const rail = mat('#f59e0b', { roughness: 0.5, metalness: 0.3 }), steelDark = mat('#475569', { roughness: 0.5, metalness: 0.6 });
        const add = (geo, m, x, y, z, noShadow = false) => { const o = part(g, geo, m, x, y, z); if (noShadow) o.castShadow = false; return o; };
        const innerW = L.ix1 - L.ix0;
        // 바깥 벽: 뒤·옆은 통으로, 앞은 층마다 가운데 출입구(폭 1.2m · 높이 2.1m)를 비운다
        const wallH = showTop;
        add(box(L.W, wallH, WALL), wall, 0, wallH / 2, L.D / 2 - WALL / 2, true);
        [-1, 1].forEach(side => add(box(WALL, wallH, L.D), wall, side * (L.W / 2 - WALL / 2), wallH / 2, 0, true));
        const doorW = Math.min(1.2, L.W * 0.3), doorH = Math.min(2.1, L.h * 0.75), sideW = (L.W - doorW) / 2;
        for (let f = 0; f < L.floors && f * L.h < showTop - 0.05; f += 1) {
            const y0 = f * L.h, fh = Math.min(L.h, showTop - y0);
            [-1, 1].forEach(side => add(box(sideW, fh, WALL), wall, side * (doorW / 2 + sideW / 2), y0 + fh / 2, -L.D / 2 + WALL / 2, true));
            if (fh > doorH) add(box(doorW, fh - doorH, WALL), wall, 0, y0 + doorH + (fh - doorH) / 2, -L.D / 2 + WALL / 2, true);
        }
        // 계단 한 줄 (반 층): x 가운데, y0에서 시작, 디딤판이 dir(+1 = 뒤쪽 · -1 = 앞쪽)으로 오른다 + 아래 경사판 + 승강로 쪽 손잡이
        const slope = Math.atan2(L.h / 2, L.run), length = Math.hypot(L.run, L.h / 2), midZ = (L.zA + L.zB) / 2;
        const flight = (x, y0, dir, innerX) => {
            for (let i = 0; i < L.steps; i += 1) {
                const z = dir > 0 ? L.zA + L.tread * (i + 0.5) : L.zB - L.tread * (i + 0.5);
                add(box(L.sw, 0.05, L.tread + 0.01), plate, x, y0 + L.rise * (i + 1) - 0.025, z);
            }
            add(box(L.sw, 0.1, length), steelDark, x, y0 + L.h / 4 - 0.12, midZ).rotation.x = -dir * slope;           // 아래 경사판
            add(box(0.04, 0.04, length), rail, innerX, y0 + L.h / 4 + 0.9, midZ).rotation.x = -dir * slope;           // 손잡이
            [0, 0.5, 1].forEach(k => add(box(0.04, 0.9, 0.04), rail, innerX, y0 + (L.h / 2) * k + 0.45, dir > 0 ? L.zA + L.run * k : L.zB - L.run * k));
        };
        for (let k = 0; k < L.floors - 1; k += 1) {
            const y0 = k * L.h;
            if (y0 >= showTop - 0.05) break;
            flight(L.ix0 + L.sw / 2, y0, 1, L.ix0 + L.sw - 0.03);                                                        // 왼쪽: 뒤쪽으로
            add(box(innerW, 0.14, L.landing), slab, 0, y0 + L.h / 2 - 0.07, L.zB + L.landing / 2);                      // 뒤쪽 참 (반 층)
            add(box(innerW - L.sw * 2 - 0.2, 0.04, 0.04), rail, 0, y0 + L.h / 2 + 0.9, L.zB + 0.03);                    // 참 앞 난간 (승강로 쪽)
            if (y0 + L.h / 2 < showTop - 0.05) flight(L.ix1 - L.sw / 2, y0 + L.h / 2, -1, L.ix1 - L.sw + 0.03);         // 오른쪽: 앞쪽으로
            if (y0 + L.h <= showTop + 0.01) add(box(innerW, 0.15, L.hall), slab, 0, y0 + L.h - 0.075, L.iz0 + L.hall / 2); // 위층 홀
        }
        // 엘리베이터 승강로: 반투명 벽 + 꼭대기 기계실 + 층마다 홀 쪽 문(틀 + 두 짝 + 호출 단추) + 1층에 선 카
        const { x0, x1, z0, z1 } = L.shaft, sx = (x0 + x1) / 2, sz = (z0 + z1) / 2, shaftW = x1 - x0, shaftD = z1 - z0;
        const shaft = mat('#cbd5e1', { roughness: 0.7, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false });
        add(box(shaftW, showTop, shaftD), shaft, sx, showTop / 2, sz, true);
        if (showTop >= total - 0.01) add(box(shaftW * 0.85, 0.6, shaftD * 0.85), steelDark, sx, total + 0.3, sz);
        add(box(shaftW - 0.2, 2.2, shaftD - 0.2), mat('#64748b', { roughness: 0.4, metalness: 0.6 }), sx, 1.15, sz);
        const eDoor = Math.min(1.0, shaftW * 0.6), leaf = mat('#e2e8f0', { roughness: 0.3, metalness: 0.7 });
        for (let f = 0; f < L.floors && f * L.h < showTop - 0.05; f += 1) {
            const y0 = f * L.h;
            add(box(eDoor + 0.16, 2.2, 0.05), steelDark, sx, y0 + 1.1, z0 - 0.03);
            [-1, 1].forEach(side => add(box(eDoor / 2 - 0.01, 2.05, 0.04), leaf, sx + side * eDoor / 4, y0 + 1.04, z0 - 0.06));
            add(box(0.08, 0.16, 0.03), dark(), sx + eDoor / 2 + 0.2, y0 + 1.15, z0 - 0.04);
        }
        return g;
    };
    // 철골 2층 구조물(메자닌): 기둥(3m 간격) + 보 + 철판 바닥 + 노란 난간. h = 바닥 높이.
    // size.holes = 철판을 뚫고 지나가는 계단 자리(구조물 기준 외곽선 + 계단 위쪽 끝인 변 entry — openings.js slabHoles) → 철판을 비우고 둘레에 난간,
    // size.gaps = 계단이 구조물 가장자리로 올라와 닿는 곳(openings.js deckRailGaps) → 둘레 난간을 그 구간만 비운다
    const steelDeck = (size) => {
        const model = PROP_MODELS.STEEL_DECK;
        const wide = num(size.wide, model.params.wide), deep = num(size.deep, model.params.deep), h = num(size.h, model.params.h);
        const holes = Array.isArray(size.holes) ? size.holes : [];
        const gaps = size.gaps || {};
        const g = group();
        const beam = mat('#475569', { roughness: 0.5, metalness: 0.6 }), deck = mat('#94a3b8', { roughness: 0.6, metalness: 0.5 }), rail = mat('#f59e0b', { roughness: 0.5, metalness: 0.3 });
        const spans = (len) => Math.max(1, Math.round(len / 3));
        const nx = spans(wide), nz = spans(deep);
        for (let i = 0; i <= nx; i += 1) {
            for (let j = 0; j <= nz; j += 1) part(g, box(0.15, h - 0.2, 0.15), beam, -wide / 2 + 0.075 + ((wide - 0.15) * i) / nx, (h - 0.2) / 2, -deep / 2 + 0.075 + ((deep - 0.15) * j) / nz);
        }
        for (let j = 0; j <= nz; j += 1) part(g, box(wide, 0.2, 0.12), beam, 0, h - 0.2, -deep / 2 + 0.075 + ((deep - 0.15) * j) / nz);
        for (let i = 0; i <= nx; i += 1) part(g, box(0.12, 0.2, deep), beam, -wide / 2 + 0.075 + ((wide - 0.15) * i) / nx, h - 0.2, 0);
        if (holes.length) {
            // 계단 자리를 비운 철판: 외곽 사각형 + 구멍들을 0.08m 두께로 세운다 (도형의 y = -z)
            const v = ([x, z]) => new THREE.Vector2(x, -z);
            const shape = new THREE.Shape([[-wide / 2, -deep / 2], [wide / 2, -deep / 2], [wide / 2, deep / 2], [-wide / 2, deep / 2]].map(v));
            holes.forEach(hole => shape.holes.push(new THREE.Path(hole.pts.map(v))));
            const plate = track(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }));
            plate.rotateX(-Math.PI / 2);
            part(g, plate, deck, 0, h - 0.085, 0);
        } else part(g, box(wide, 0.08, deep), deck, 0, h - 0.045, 0); // 윗면을 5mm 낮춰 그 위에 놓은 구획 바닥(칠한 면·칸 선)과 겹쳐 번쩍이지 않게
        // 난간 한 줄 (a → b): 기둥 1.5m 간격 + 위·가운데 가로대
        const railLine = ([ax, az], [bx, bz]) => {
            const len = Math.hypot(bx - ax, bz - az);
            if (len < 0.1) return;
            const posts = Math.max(1, Math.round(len / 1.5)), angle = Math.atan2(-(bz - az), bx - ax);
            for (let i = 0; i <= posts; i += 1) part(g, box(0.04, 1.1, 0.04), rail, ax + ((bx - ax) * i) / posts, h + 0.55, az + ((bz - az) * i) / posts);
            [1.1, 0.55].forEach((y) => { part(g, box(len, 0.04, 0.04), rail, (ax + bx) / 2, h + y, (az + bz) / 2).rotation.y = angle; });
        };
        // 둘레 난간: 변마다 계단이 닿는 구간(gaps)을 빼고 남은 구간만
        const sideRails = (from, to, cuts, at) => {
            let cur = from;
            [...(cuts || [])].sort((p, q) => p[0] - q[0]).forEach(([lo, hi]) => {
                if (lo > cur) at(cur, Math.min(lo, to));
                cur = Math.max(cur, hi);
            });
            if (cur < to) at(cur, to);
        };
        const ex = wide / 2 - 0.02, ez = deep / 2 - 0.02;
        sideRails(-ex, ex, gaps.z0, (a, b) => railLine([a, -ez], [b, -ez]));
        sideRails(-ex, ex, gaps.z1, (a, b) => railLine([a, ez], [b, ez]));
        sideRails(-ez, ez, gaps.x0, (a, b) => railLine([-ex, a], [-ex, b]));
        sideRails(-ez, ez, gaps.x1, (a, b) => railLine([ex, a], [ex, b]));
        // 계단 자리 둘레 난간: 계단 위쪽 끝(올라와 내리는 쪽)과 철판 가장자리에 붙은 변은 빼고
        const isOnRim = ([x, z], [x2, z2]) => (Math.abs(x - x2) < 0.01 && Math.abs(Math.abs(x) - wide / 2) < 0.05) || (Math.abs(z - z2) < 0.01 && Math.abs(Math.abs(z) - deep / 2) < 0.05);
        holes.forEach(hole => hole.pts.forEach((p, i) => {
            const q = hole.pts[(i + 1) % hole.pts.length];
            if (!hole.entry?.[i] && !isOnRim(p, q)) railLine(p, q);
        }));
        return g;
    };
    // 혼합탱크: 다리 넷 + 원뿔 바닥 + 몸통(띠) + 접시 뚜껑 + 교반기 모터·축 + 맨홀 + 아래 배출 밸브
    const mixTank = (size) => {
        const model = PROP_MODELS.MIX_TANK;
        const dia = num(size.dia, model.params.dia), h = num(size.h, model.params.h);
        const g = group();
        const r = dia / 2, legH = Math.min(1, h * 0.28), coneH = Math.min(0.5, r * 0.5), motorH = 0.45;
        const bodyH = Math.max(0.4, h - legH - coneH - motorH - 0.15);
        const shell = mat('#d1d5db', { roughness: 0.3, metalness: 0.75 }), band = mat('#9ca3af', { roughness: 0.35, metalness: 0.7 });
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => part(g, box(0.1, legH + coneH, 0.1), steel(), sx * r * 0.68, (legH + coneH) / 2, sz * r * 0.68));
        part(g, cone(r, r * 0.15, coneH), shell, 0, legH + coneH / 2, 0);
        part(g, cyl(r, bodyH, 28), shell, 0, legH + coneH + bodyH / 2, 0);
        [0.03, 0.5, 0.97].forEach(k => part(g, cyl(r + 0.02, 0.05, 28), band, 0, legH + coneH + bodyH * k, 0));
        const top = legH + coneH + bodyH;
        part(g, cone(r * 0.3, r, 0.15), shell, 0, top + 0.075, 0);
        part(g, box(0.34, motorH, 0.34), mat('#2563eb', { roughness: 0.5, metalness: 0.4 }), 0, top + 0.15 + motorH / 2, 0);  // 교반기 모터
        part(g, cyl(0.04, 0.3, 10), steel(), 0, top + 0.05, 0);
        part(g, cyl(Math.min(0.25, r * 0.3), 0.08, 14), dark(), r * 0.55, top + 0.12, 0);                                    // 맨홀
        part(g, cyl(0.05, 0.3, 10), mat('#dc2626'), 0, legH * 0.6, 0);                                                       // 아래 배출 밸브
        return g;
    };
    // 보일러: 받침 + 누운 원통 몸통 + 앞의 버너 + 굴뚝
    const boiler = () => {
        const g = group();
        const shell = mat('#b91c1c', { roughness: 0.5, metalness: 0.4 });
        part(g, box(1.2, 0.2, 2.0), dark(), 0, 0.1, 0);
        const body = part(g, cyl(0.6, 2.0, 24), shell, 0, 0.85, 0);
        body.rotation.x = Math.PI / 2;
        [-0.7, 0.7].forEach((z) => { const ring = part(g, cyl(0.62, 0.06, 24), mat('#7f1d1d'), 0, 0.85, z); ring.rotation.x = Math.PI / 2; });
        part(g, box(0.5, 0.5, 0.35), mat('#1e3a8a'), 0, 0.75, -1.1);         // 버너
        part(g, cyl(0.14, 1.4, 12), steel(), 0, 2.1, 0.7);                   // 굴뚝
        part(g, box(0.3, 0.4, 0.08), mat('#e2e8f0'), 0.62, 1.0, -0.4);       // 제어반
        return g;
    };
    const compressor = () => {
        const g = group();
        const tank = part(g, cyl(0.3, 1.3, 20), mat('#1d4ed8', { roughness: 0.45, metalness: 0.5 }), 0, 0.45, 0);
        tank.rotation.x = Math.PI / 2;
        [-0.45, 0.45].forEach(z => part(g, box(0.5, 0.15, 0.08), dark(), 0, 0.08, z));
        part(g, box(0.4, 0.35, 0.5), mat('#334155'), 0, 0.93, -0.2);         // 모터·펌프
        part(g, cyl(0.16, 0.06, 14), steel(), 0.22, 0.95, 0.3).rotation.z = Math.PI / 2;
        return g;
    };
    // 컨베이어: 다리(1.5m 간격) + 옆 틀 + 벨트 + 양 끝 롤러. deep = 길이, h = 벨트 높이
    const conveyor = (size) => {
        const model = PROP_MODELS.CONVEYOR;
        const wide = num(size.wide, model.params.wide), len = num(size.deep, model.params.deep), h = num(size.h, model.params.h);
        const g = group();
        const legs = Math.max(1, Math.round(len / 1.5));
        for (let i = 0; i <= legs; i += 1) [-1, 1].forEach(side => part(g, box(0.05, h, 0.05), steel(), side * (wide / 2 - 0.025), h / 2, -len / 2 + 0.05 + ((len - 0.1) * i) / legs));
        [-1, 1].forEach(side => part(g, box(0.04, 0.12, len), steel(), side * (wide / 2 - 0.02), h, 0));
        part(g, box(wide - 0.08, 0.03, len - 0.06), mat('#111827', { roughness: 0.95, metalness: 0 }), 0, h + 0.03, 0);
        [-1, 1].forEach(end => roller(g, cyl(0.05, wide - 0.08, 12), steel(), 0, h, end * (len / 2 - 0.05)));
        return g;
    };
    // 충진기: 받침대 + 작은 컨베이어 + 기둥 + 노즐 머리(노즐 넷) + 제어반
    const filler = () => {
        const g = group();
        part(g, box(1.4, 0.8, 0.9), mat('#e5e7eb', { roughness: 0.4, metalness: 0.5 }), 0, 0.4, 0.1);
        part(g, box(1.4, 0.03, 0.3), mat('#111827'), 0, 0.83, -0.3);         // 벨트
        [-0.6, 0.6].forEach(x => part(g, box(0.08, 1.1, 0.08), steel(), x, 1.35, 0.3));
        part(g, box(1.3, 0.3, 0.4), mat('#2563eb', { roughness: 0.5, metalness: 0.4 }), 0, 1.75, 0.0);
        [-0.42, -0.14, 0.14, 0.42].forEach(x => part(g, cyl(0.025, 0.4, 8), steel(), x, 1.4, -0.28));
        part(g, box(0.3, 0.4, 0.08), dark(), 0.85, 1.4, 0.2);                // 제어반
        part(g, box(0.05, 1.2, 0.05), steel(), 0.85, 0.6, 0.2);
        return g;
    };
    const scale = () => {
        const g = group();
        part(g, box(1.2, 0.1, 1.2), mat('#94a3b8', { roughness: 0.5, metalness: 0.6 }), 0, 0.05, -0.075);
        part(g, box(0.06, 1.0, 0.06), steel(), 0, 0.5, 0.62);
        part(g, box(0.3, 0.2, 0.08), dark(), 0, 1.05, 0.62);                 // 표시기
        return g;
    };
    const panel = () => {
        const g = group();
        part(g, box(0.8, 1.7, 0.25), mat('#d1d5db', { roughness: 0.5, metalness: 0.5 }), 0, 0.95, 0);
        part(g, box(0.012, 1.6, 0.01), dark(), 0, 0.95, -0.128);
        part(g, box(0.16, 0.12, 0.01), mat('#facc15'), -0.2, 1.5, -0.13);    // 전기 주의 표지
        return g;
    };
    const fireExt = () => {
        const g = group();
        part(g, cyl(0.075, 0.42, 14), mat('#dc2626', { roughness: 0.4, metalness: 0.3 }), 0, 0.21, 0);
        part(g, cyl(0.03, 0.08, 10), dark(), 0, 0.46, 0);
        part(g, box(0.12, 0.03, 0.03), dark(), 0.04, 0.5, 0);
        part(g, box(0.3, 0.3, 0.012), mat('#fef2f2'), 0, 0.9, 0.13);         // 벽의 표지
        return g;
    };
    // 핸드 파렛트 트럭: 포크 둘 + 유압 몸통 + 손잡이
    const handPallet = () => {
        const g = group();
        const body = mat('#f97316', { roughness: 0.5, metalness: 0.3 });
        [-0.19, 0.19].forEach(x => part(g, box(0.16, 0.05, 1.15), body, x, 0.09, -0.2));
        part(g, box(0.55, 0.3, 0.22), body, 0, 0.2, 0.5);
        const handle = part(g, box(0.04, 1.0, 0.04), dark(), 0, 0.75, 0.62);
        handle.rotation.x = -0.25;
        part(g, box(0.36, 0.04, 0.04), dark(), 0, 1.22, 0.74);
        [-0.19, 0.19].forEach(x => roller(g, cyl(0.04, 0.1, 10), dark(), x, 0.04, -0.7));
        roller(g, cyl(0.09, 0.14, 12), dark(), 0, 0.09, 0.55);
        return g;
    };

    const builders = {
        DESK: desk, CHAIR: chair, MEETING_TABLE: meetingTable, SOFA: sofa, CABINET: cabinet, LOCKER: locker, SHELF: shelf, FRIDGE: fridge,
        WATER: water, AIRCON: aircon, COPIER: copier, SINK: sink, TOILET_SEAT: toiletSeat, WASHBASIN: washbasin,
        ELEVATOR: elevator, STAIRWELL: stairwell, STAIR_ELEVATOR: stairElevator, STEEL_DECK: steelDeck, MIX_TANK: mixTank, BOILER: boiler, COMPRESSOR: compressor,
        CONVEYOR: conveyor, FILLER: filler, SCALE: scale, PANEL: panel, FIRE_EXT: fireExt, HAND_PALLET: handPallet
    };
    Object.keys(PROP_MODELS).filter(type => PROP_MODELS[type].group === 'ROOM').forEach((type) => { builders[type] = (size) => room(type, size); });
    return builders;
};
