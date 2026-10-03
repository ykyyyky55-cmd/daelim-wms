// ==========================================
// 창고 배치도 3D — 파렛트 위의 짐 모양 (품목 적재 규격 services/packSpecs.js)
// ==========================================
// 드럼 2×2 · 페일 4×4×3단 · IBC 1개 · 박스 3×4×4단 · 포대처럼, 그 품목이 실제로 실리는 포장 모양과 개수대로 그린다.
// 마지막 파렛트는 남은 수량만큼만(아래 단부터 차례로) 쌓인다. 색은 품목 분류 색 그대로(범례와 같게) — 모양만 바뀐다.
// 통(IBC·드럼·페일)은 내용물의 양을 보인다: 남은 양을 10칸으로 나눠(1,000 L IBC면 100 L씩 모자랄 때마다 한 칸 내려감)
// 그 높이까지만 분류 색으로 칠하고, 빈 통(공토트·공드럼)은 내용물 없이 뚜껑만 초록이다.
// IBC는 배치도의 IBC 모형(propModels.js)처럼 반투명 흰 통 + 철망 + 철 틀 + 뚜껑 + 밸브로 그린다.
// 같은 역할(내용물·통·틀·철망·뚜껑…)의 부품은 하나의 모양으로 합쳐(mergeGeometries) 파렛트 하나에 몇 덩어리만 그린다.
// 같은 규격·개수·크기·남은 양은 한 번만 만든다.
import { PACK_TYPES } from '../../services/packSpecs.js';

const GAP = 0.94;        // 포장 사이 틈 (칸 크기에 대한 비율)
const ROUND_SEGMENTS = 12;
/** 내용물 칸 수 — 1,000 L IBC면 100 L 한 칸 */
export const FILL_STEPS = 10;
const LIQUID_TYPES = new Set(['IBC', 'DRUM', 'PAIL']);

/**
 * 남은 양의 비율(0~1) → 칠할 높이의 비율: 10칸으로 올림 (950 L = 가득, 900 L = 9칸, 350 L = 4칸, 0 = 빈 통)
 * @param {number} ratio
 */
export const fillLevel = (ratio) => {
    if (!(ratio > 0)) return 0;
    return Math.min(1, Math.ceil(ratio * FILL_STEPS - 1e-9) / FILL_STEPS);
};

/**
 * 짐을 이루는 부품의 역할 — 부르는 쪽(Warehouse3D.js)이 역할마다 재질을 정한다.
 * body = 포장 자체(분류 색) · liquid = 통 안의 내용물(분류 색) · shell = IBC 반투명 통 · emptyPart = 드럼·페일의 빈 부분 ·
 * frame = IBC 철 틀 · cage = IBC 철망(선) · band = 드럼 띠 · lid = 뚜껑 · lidEmpty = 빈 통의 뚜껑(초록) · valve = IBC 밸브
 * @typedef {'body'|'liquid'|'shell'|'emptyPart'|'frame'|'cage'|'band'|'lid'|'lidEmpty'|'valve'} CargoRole
 * @typedef {{ role: CargoRole, geometry: import('three').BufferGeometry }} CargoPart
 * @typedef {{ empty?: boolean, last?: number }} CargoFill 빈 통 품목인지 · 마지막 통에 든 양의 비율(0~1)
 */

/**
 * @param {typeof import('three')} THREE
 * @param {(geometries: import('three').BufferGeometry[]) => import('three').BufferGeometry} mergeGeometries three/examples의 BufferGeometryUtils.mergeGeometries
 * @param {<T>(o: T) => T} track 다시 그릴 때 정리(dispose)할 목록에 넣는 함수
 * @returns {(spec: { type: string, cols: number, rows: number, layers: number }, count: number, sx: number, sz: number, maxH: number, fill?: CargoFill) => { parts: CargoPart[], height: number }}
 *   적재 규격 · 실린 포장 수 · 짐이 차지할 바닥 크기(sx × sz) · 쌓을 수 있는 높이 · 남은 양 → 역할별 합친 모양(바닥 가운데가 원점, 위로 쌓임)과 그 높이
 */
export const createCargoBuilder = (THREE, mergeGeometries, track) => {
    const cache = new Map();

    /** 부품 모으기: 역할 → 모양 목록. 끝나면 역할마다 하나로 합친다 */
    const collector = () => {
        const byRole = new Map();
        const add = (role, geometry) => { if (!byRole.has(role)) byRole.set(role, []); byRole.get(role).push(geometry); };
        const finish = () => [...byRole.entries()].map(([role, list]) => {
            const geometry = track(mergeGeometries(list));
            list.forEach(g => g.dispose());
            return { role, geometry };
        });
        return { add, finish };
    };
    const boxAt = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const cylAt = (r, h, x, y, z, seg = ROUND_SEGMENTS) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z);

    // IBC 하나: 바닥 가운데 (px, y0, pz), 크기 ux × th × uz. f = 내용물 높이 비율 (0 = 빈 통)
    const ibcInto = (out, px, y0, pz, ux, th, uz, f) => {
        const post = 0.035, hx = ux / 2, hz = uz / 2;
        out.add('shell', boxAt(ux - 0.03, th, uz - 0.03, px, y0 + th / 2, pz));
        if (f > 0) {
            const lh = Math.max(0.02, (th - 0.03) * f);
            out.add('liquid', boxAt(ux - 0.07, lh, uz - 0.07, px, y0 + 0.01 + lh / 2, pz));
        }
        // 굵은 틀: 모서리 기둥 넷 + 위 테두리
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => out.add('frame', boxAt(post, th, post, px + sx * (hx - post / 2), y0 + th / 2, pz + sz * (hz - post / 2)))));
        [-1, 1].forEach((s) => {
            out.add('frame', boxAt(ux, post, post, px, y0 + th, pz + s * (hz - post / 2)));
            out.add('frame', boxAt(post, post, uz, px + s * (hx - post / 2), y0 + th, pz));
        });
        // 철망: 가로 세 줄 + 0.2m 간격 세로 줄, 앞(-z) 왼쪽에 10칸 눈금 (남은 양을 읽는 자)
        const pts = [], y1 = y0 + th;
        [0.25, 0.5, 0.75].forEach((k) => {
            const y = y0 + th * k;
            pts.push(px - hx, y, pz - hz, px + hx, y, pz - hz, px + hx, y, pz - hz, px + hx, y, pz + hz,
                px + hx, y, pz + hz, px - hx, y, pz + hz, px - hx, y, pz + hz, px - hx, y, pz - hz);
        });
        for (let x = -hx + 0.2; x < hx - 0.05; x += 0.2) [-hz, hz].forEach(z => pts.push(px + x, y0, pz + z, px + x, y1, pz + z));
        for (let z = -hz + 0.2; z < hz - 0.05; z += 0.2) [-hx, hx].forEach(x => pts.push(px + x, y0, pz + z, px + x, y1, pz + z));
        for (let i = 1; i < FILL_STEPS; i += 1) {
            const y = y0 + 0.01 + (th - 0.03) * (i / FILL_STEPS), len = i % 5 ? 0.06 : 0.12;
            pts.push(px - hx, y, pz - hz - 0.004, px - hx + len, y, pz - hz - 0.004);
        }
        const cage = new THREE.BufferGeometry();
        cage.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        out.add('cage', cage);
        // 뚜껑(빈 통이면 초록) · 앞 아래 밸브
        out.add(f > 0 ? 'lid' : 'lidEmpty', cylAt(Math.min(0.11, ux * 0.13), 0.05, px, y1 + 0.025, pz, 16));
        out.add('valve', new THREE.CylinderGeometry(0.04, 0.04, 0.1, 10).rotateX(Math.PI / 2).translate(px, y0 + 0.07, pz - hz - 0.03));
    };

    // 드럼·페일 하나: 아래 f만큼 내용물(분류 색), 그 위는 빈 부분(옅은 회색), 뚜껑(빈 통이면 초록). 드럼은 띠 둘
    const canInto = (out, px, y0, pz, r, th, f, hasBands) => {
        const h = th * 0.97;
        if (f >= 1) out.add('body', cylAt(r, h, px, y0 + h / 2, pz));
        else {
            const lh = h * f;
            if (lh > 0.005) out.add('liquid', cylAt(r, lh, px, y0 + lh / 2, pz));
            out.add('emptyPart', cylAt(r * 0.995, h - lh, px, y0 + lh + (h - lh) / 2, pz));
        }
        if (hasBands) [1 / 3, 2 / 3].forEach(k => out.add('band', cylAt(r * 1.03, Math.min(0.025, h * 0.04), px, y0 + h * k, pz)));
        out.add(f > 0 ? 'lid' : 'lidEmpty', cylAt(r * 0.86, 0.014, px, y0 + h + 0.007, pz));
    };

    return (spec, count, sx, sz, maxH, fill = {}) => {
        const type = PACK_TYPES[spec.type] || PACK_TYPES.BOX;
        const perLayer = spec.cols * spec.rows;
        const packs = Math.max(1, Math.min(count, perLayer * spec.layers));
        const isLiquid = LIQUID_TYPES.has(spec.type);
        // 통마다 칠할 높이: 빈 통 품목은 모두 0, 그 밖은 가득 — 마지막 통만 남은 양
        const isEmpty = isLiquid && !!fill.empty;
        const lastLevel = isLiquid && !isEmpty ? fillLevel(fill.last ?? 1) : 1;
        const key = `${spec.type}|${spec.cols}|${spec.rows}|${spec.layers}|${packs}|${sx.toFixed(2)}|${sz.toFixed(2)}|${maxH.toFixed(2)}|${isEmpty ? 'E' : lastLevel}`;
        const hit = cache.get(key);
        if (hit) return hit;
        // 포장 하나의 크기: 바닥 칸(sx ÷ cols, sz ÷ rows)과 실제 크기 가운데 작은 쪽, 높이는 실제 높이(쌓을 수 있는 높이를 넘으면 줄임)
        const cellX = sx / spec.cols, cellZ = sz / spec.rows;
        const layerH = Math.min(type.unitSize[2], maxH / spec.layers);
        const unitX = Math.min(cellX * GAP, type.unitSize[0] * 1.15), unitZ = Math.min(cellZ * GAP, type.unitSize[1] * 1.15);
        const radius = Math.min(unitX, unitZ) / 2;
        const out = collector();
        const unit = !isLiquid && (type.round
            ? new THREE.CylinderGeometry(radius, radius, layerH * 0.97, ROUND_SEGMENTS)
            : new THREE.BoxGeometry(unitX, layerH * 0.96, unitZ));
        for (let i = 0; i < packs; i += 1) {
            const layer = Math.floor(i / perLayer), inLayer = i % perLayer;
            const col = inLayer % spec.cols, row = Math.floor(inLayer / spec.cols);
            const px = -sx / 2 + cellX * (col + 0.5), pz = -sz / 2 + cellZ * (row + 0.5), y0 = layerH * layer;
            const f = isEmpty ? 0 : i === packs - 1 ? lastLevel : 1;
            if (spec.type === 'IBC') ibcInto(out, px, y0, pz, unitX, layerH * 0.97, unitZ, f);
            else if (isLiquid) canInto(out, px, y0, pz, radius, layerH, f, spec.type === 'DRUM');
            else out.add('body', unit.clone().translate(px, y0 + layerH * 0.5, pz));
        }
        if (unit) unit.dispose();
        const result = { parts: out.finish(), height: layerH * Math.ceil(packs / perLayer) };
        cache.set(key, result);
        return result;
    };
};
