// ==========================================
// 창고 배치도 — 계단 자리 · 바닥 구멍 · 철골 구조물 위 (3D와 평면도 편집기가 같이 쓰는 순수 계산)
// ==========================================
// 계단(STAIRS)·계단실(STAIRWELL) 모형이 지나가는 바닥판(철골 2층 구조물의 철판 · 2층 구역의 바닥판 · 위층 창고의 바닥)에는
// 계단 자리만큼 구멍을 낸다 — 위에서 보면 계단이 보이고, 계단이 바닥판을 뚫고 나오지 않는다.
// 좌표는 모두 m. 모형 기준 = 모형 가운데가 원점, 앞(rot 방향) = -z (propModels.js와 같음).
import { PROP_MODELS, propSize } from '../../services/warehouseZones.js';
import { frameOf, joinFrames } from './geometry.js';

/** 바닥을 뚫는 모형 */
export const STAIR_PROP_TYPES = ['STAIRS', 'STAIRWELL'];
/** 철골 2층 구조물 */
export const DECK_TYPE = 'STEEL_DECK';
/** 바닥 높이를 같은 것으로 보는 차이 (m) */
const LEVEL_TOLERANCE = 0.06;

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);

/** 모형 바닥의 네 모서리 (모형 기준): 앞 왼쪽부터 시계 방향 — 첫 변(0→1)이 앞(계단의 위쪽 끝) */
export const propCorners = (prop) => {
    const { w, front, back } = propSize(prop);
    return [[-w / 2, -front], [w / 2, -front], [w / 2, back], [-w / 2, back]];
};
/** 모형의 오르는 높이 (계단·계단실은 h, 그 밖은 0) */
const riseOf = (prop) => num(prop.h, PROP_MODELS[prop.type]?.params?.h || 0);

/** 다각형 넓이 (부호 있음) */
const signedArea = (pts) => pts.reduce((s, [x, z], i) => { const [x2, z2] = pts[(i + 1) % pts.length]; return s + x * z2 - x2 * z; }, 0) / 2;

/**
 * 볼록 다각형을 사각형 [x0, z0, x1, z1] 안으로 자른다 (Sutherland–Hodgman)
 * @param {Array<[number, number]>} pts
 * @param {[number, number, number, number]} rect
 */
export const clipToRect = (pts, [x0, z0, x1, z1]) => {
    const edges = [
        { inside: ([x]) => x >= x0, cut: (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; } },
        { inside: ([x]) => x <= x1, cut: (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; } },
        { inside: ([, z]) => z >= z0, cut: (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z0]; } },
        { inside: ([, z]) => z <= z1, cut: (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z1]; } }
    ];
    return edges.reduce((poly, edge) => {
        if (!poly.length) return poly;
        const out = [];
        poly.forEach((cur, i) => {
            const prev = poly[(i + poly.length - 1) % poly.length];
            const isIn = edge.inside(cur), wasIn = edge.inside(prev);
            if (isIn) { if (!wasIn) out.push(edge.cut(prev, cur)); out.push(cur); } else if (wasIn) out.push(edge.cut(prev, cur));
        });
        return out;
    }, pts);
};

/**
 * @typedef {{ prop: object, poly: Array<[number, number]>, frame: ReturnType<typeof frameOf>, bottom: number, top: number, front: number }} StairSpot
 *   poly = 바닥 네 모서리(전체 좌표) · frame = 모형 기준 ↔ 전체 · bottom·top = 오르기 시작하는 높이·다 오른 높이(지면에서 잰 m) · front = 가운데에서 위쪽 끝까지
 */
/**
 * 계단 자리 목록 (전체 좌표)
 * @param {object[]} props 주변 표시의 모형 줄
 * @param {(whId: string) => ({ frame: ReturnType<typeof frameOf>, base: number } | null)} homeOf 창고 id → 그 창고 기준 좌표와 바닥 높이 ('' = 공장 기준)
 * @returns {StairSpot[]}
 */
export const stairSpots = (props, homeOf) => (props || []).filter(p => STAIR_PROP_TYPES.includes(p.type)).map((prop) => {
    const home = homeOf(prop.warehouse || '');
    if (!home) return null;
    const frame = joinFrames(home.frame, frameOf({ x: prop.x, z: prop.z, rot: prop.rot }));
    const bottom = home.base + num(prop.y);
    return {
        prop, frame, bottom, top: bottom + riseOf(prop), front: propSize(prop).front,
        poly: propCorners(prop).map(([x, z]) => { const p = frame.toWorld(x, z); return [p.x, p.z]; })
    };
}).filter(Boolean);

/**
 * 바닥판을 지나가는 계단 → 그 바닥판 기준 좌표의 구멍들.
 * 계단이 그 판보다 아래에서 시작해 판 높이(35cm 덜 미쳐도)까지 오르면 구멍을 낸다. 판 밖으로 나간 부분은 잘라 내고, 판 가장자리에는 2cm를 남긴다.
 * @param {StairSpot[]} spots
 * @param {number} slabY 판 윗면 높이 (지면에서 잰 m)
 * @param {{ toLocal: (wx: number, wz: number) => { x: number, z: number }, toWorld: (lx: number, lz: number) => { x: number, z: number } }} slabFrame 판 기준 ↔ 전체 좌표
 * @param {[number, number, number, number]} rect 판의 범위 (판 기준 [x0, z0, x1, z1])
 * @returns {Array<{ pts: Array<[number, number]>, entry: boolean[] }>} pts = 구멍 외곽선(판 기준),
 *   entry[i] = i번째 변(i → i+1)이 계단 위쪽 끝(올라와 내리는 쪽 — 난간을 두지 않음)
 */
export const slabHoles = (spots, slabY, slabFrame, rect) => {
    const inner = [rect[0] + 0.02, rect[1] + 0.02, rect[2] - 0.02, rect[3] - 0.02];
    return spots.filter(s => s.bottom < slabY - 0.05 && s.top >= slabY - 0.35).map((spot) => {
        const local = spot.poly.map(([x, z]) => { const p = slabFrame.toLocal(x, z); return [p.x, p.z]; });
        const pts = clipToRect(local, inner);
        if (pts.length < 3 || Math.abs(signedArea(pts)) < 0.05) return null;
        // 변의 가운데가 계단의 위쪽 끝(모형 기준 z = -front) 위에 있으면 올라와 내리는 쪽
        const entry = pts.map(([x, z], i) => {
            const [x2, z2] = pts[(i + 1) % pts.length];
            const mid = slabFrame.toWorld((x + x2) / 2, (z + z2) / 2);
            const p = spot.frame.toLocal(mid.x, mid.z);
            return Math.abs(p.z + spot.front) < 0.08;
        });
        return { pts, entry };
    }).filter(Boolean);
};

/**
 * 철골 2층 구조물 목록: 바닥 범위(모형 기준 사각형)·좌표 변환·윗면 높이(지면에서 잰 m)
 * @param {object[]} props
 * @param {(whId: string) => ({ frame: ReturnType<typeof frameOf>, base: number } | null)} homeOf
 */
export const deckSpots = (props, homeOf) => (props || []).filter(p => p.type === DECK_TYPE).map((prop) => {
    const home = homeOf(prop.warehouse || '');
    if (!home) return null;
    const { w, front, back } = propSize(prop);
    return {
        prop, frame: joinFrames(home.frame, frameOf({ x: prop.x, z: prop.z, rot: prop.rot })),
        rect: /** @type {[number, number, number, number]} */ ([-w / 2, -front, w / 2, back]),
        top: home.base + num(prop.y) + riseOf(prop), whBase: home.base
    };
}).filter(Boolean);

/**
 * 구조물 둘레 난간에서 비울 자리: 구조물 밖에서 올라온 계단이 가장자리에 닿는 곳
 * (계단 한가운데가 구조물 밖 · 위쪽 끝이 둘레에서 안팎 60cm 안 · 높이가 철판과 40cm 안). 구조물 안에 놓은 계단은 철판 구멍(slabHoles)으로 올라오므로 둘레 난간을 그대로 둔다
 * @returns {{ z0: Array<[number, number]>, z1: Array<[number, number]>, x0: Array<[number, number]>, x1: Array<[number, number]> }}
 *   변 → 비울 구간(그 변을 따라 잰 구조물 기준 좌표). z0 = 앞(-z) 변, z1 = 뒤 변, x0 = 왼쪽, x1 = 오른쪽
 */
export const deckRailGaps = (deck, spots) => {
    const gaps = { z0: [], z1: [], x0: [], x1: [] };
    const [x0, z0, x1, z1] = deck.rect;
    spots.filter(s => Math.abs(s.top - deck.top) < 0.4).forEach((spot) => {
        const mid = spot.frame.toWorld(0, 0), c = deck.frame.toLocal(mid.x, mid.z);
        if (c.x > x0 && c.x < x1 && c.z > z0 && c.z < z1) return; // 구조물 안의 계단
        // 계단 위쪽 끝(모형 기준 앞 변)의 두 끝 → 구조물 기준
        const [a, b] = [spot.poly[0], spot.poly[1]].map(([x, z]) => deck.frame.toLocal(x, z));
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const isNear = (v, edge, outward) => Math.abs(v - edge) <= 0.6 && (v - edge) * outward >= -0.6; // 둘레에서 안팎 60cm
        const span = (p, q) => [Math.min(p, q) - 0.05, Math.max(p, q) + 0.05];
        if (isNear(mz, z0, -1) && mx > x0 && mx < x1) gaps.z0.push(span(a.x, b.x));
        else if (isNear(mz, z1, 1) && mx > x0 && mx < x1) gaps.z1.push(span(a.x, b.x));
        else if (isNear(mx, x0, -1) && mz > z0 && mz < z1) gaps.x0.push(span(a.z, b.z));
        else if (isNear(mx, x1, 1) && mz > z0 && mz < z1) gaps.x1.push(span(a.z, b.z));
    });
    return gaps;
};

/** 전체 좌표 (x, z)가 그 구조물 바닥 위인지 (margin만큼 안쪽) */
export const isOnDeck = (deck, x, z, margin = 0) => {
    const p = deck.frame.toLocal(x, z), [x0, z0, x1, z1] = deck.rect;
    return p.x >= x0 + margin && p.x <= x1 - margin && p.z >= z0 + margin && p.z <= z1 - margin;
};
/** 구획 바닥이 그 구조물 철판 위에 놓였는지: 한가운데가 철판 안 + 바닥 높이가 철판 윗면과 같음 */
export const sitsOnDeck = (deck, x, z, baseY) => Math.abs(baseY - deck.top) < LEVEL_TOLERANCE && isOnDeck(deck, x, z);
