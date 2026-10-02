// ==========================================
// 창고 배치도 3D — 파렛트 위의 짐 모양 (품목 적재 규격 services/packSpecs.js)
// ==========================================
// 드럼 2×2 · 페일 4×4×3단 · IBC 1개 · 박스 3×4×4단 · 포대처럼, 그 품목이 실제로 실리는 포장 모양과 개수대로 그린다.
// 마지막 파렛트는 남은 수량만큼만(아래 단부터 차례로) 쌓인다. 색은 품목 분류 색 그대로(범례와 같게) — 모양만 바뀐다.
// 파렛트 하나의 짐은 포장들을 하나로 합친 모양(geometry) 하나라 그리는 횟수가 늘지 않는다. 같은 규격·개수·크기는 한 번만 만든다.
import { PACK_TYPES } from '../../services/packSpecs.js';

const GAP = 0.94;        // 포장 사이 틈 (칸 크기에 대한 비율)
const ROUND_SEGMENTS = 12;

/**
 * @param {typeof import('three')} THREE
 * @param {(geometries: import('three').BufferGeometry[]) => import('three').BufferGeometry} mergeGeometries three/examples의 BufferGeometryUtils.mergeGeometries
 * @param {<T>(o: T) => T} track 다시 그릴 때 정리(dispose)할 목록에 넣는 함수
 * @returns {(spec: { type: string, cols: number, rows: number, layers: number }, count: number, sx: number, sz: number, maxH: number) => { geometry: import('three').BufferGeometry, height: number }}
 *   적재 규격 · 실린 포장 수 · 짐이 차지할 바닥 크기(sx × sz) · 쌓을 수 있는 높이 → 합친 모양(바닥 가운데가 원점, 위로 쌓임)과 그 높이
 */
export const createCargoBuilder = (THREE, mergeGeometries, track) => {
    const cache = new Map();
    return (spec, count, sx, sz, maxH) => {
        const type = PACK_TYPES[spec.type] || PACK_TYPES.BOX;
        const perLayer = spec.cols * spec.rows;
        const packs = Math.max(1, Math.min(count, perLayer * spec.layers));
        const key = `${spec.type}|${spec.cols}|${spec.rows}|${spec.layers}|${packs}|${sx.toFixed(2)}|${sz.toFixed(2)}|${maxH.toFixed(2)}`;
        const hit = cache.get(key);
        if (hit) return hit;
        // 포장 하나의 크기: 바닥 칸(sx ÷ cols, sz ÷ rows)과 실제 크기 가운데 작은 쪽, 높이는 실제 높이(쌓을 수 있는 높이를 넘으면 줄임)
        const cellX = sx / spec.cols, cellZ = sz / spec.rows;
        const layerH = Math.min(type.unitSize[2], maxH / spec.layers);
        const unitX = Math.min(cellX * GAP, type.unitSize[0] * 1.15), unitZ = Math.min(cellZ * GAP, type.unitSize[1] * 1.15);
        const radius = Math.min(unitX, unitZ) / 2;
        const unit = type.round
            ? new THREE.CylinderGeometry(radius, radius, layerH * 0.97, ROUND_SEGMENTS)
            : new THREE.BoxGeometry(unitX, layerH * 0.96, unitZ);
        const parts = [];
        for (let i = 0; i < packs; i += 1) {
            const layer = Math.floor(i / perLayer), inLayer = i % perLayer;
            const col = inLayer % spec.cols, row = Math.floor(inLayer / spec.cols);
            const part = unit.clone();
            const px = -sx / 2 + cellX * (col + 0.5), pz = -sz / 2 + cellZ * (row + 0.5);
            part.translate(px, layerH * (layer + 0.5), pz);
            parts.push(part);
            if (spec.type === 'IBC') {
                // IBC 토트는 위의 주입구 뚜껑으로 알아본다 (그냥 상자와 구분)
                const lid = new THREE.CylinderGeometry(0.11, 0.11, 0.06, ROUND_SEGMENTS);
                lid.translate(px, layerH * (layer + 1) + 0.01, pz);
                parts.push(lid);
            }
        }
        const geometry = track(mergeGeometries(parts));
        parts.forEach(part => part.dispose());
        unit.dispose();
        const result = { geometry, height: layerH * Math.ceil(packs / perLayer) };
        cache.set(key, result);
        return result;
    };
};
