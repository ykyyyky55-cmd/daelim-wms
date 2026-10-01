// ==========================================
// 창고 배치도 좌표 계산 — 3D 화면(Warehouse3D.js)과 평면도 편집기(planEditor.js) 공용
// ==========================================
// 좌표: x = 동쪽(+), z = 남쪽(+) (도면 위쪽이 z 작은 쪽), 단위 m. 각도는 도, 위에서 볼 때 시계 방향이 +.
// 창고·구획은 저마다 기준 좌표가 있다: 그 물체의 (x, z) 모서리가 원점이고 rot만큼 돌아 있다.

/** 구획 바닥 높이 (m, 0 = 창고 바닥 — 2층처럼 위에 뜬 구획이면 그 높이) */
export const zoneBaseY = (z) => Math.max(0, Number(z.y) || 0);

/**
 * 기준 좌표 변환: 그 물체 기준(local) ↔ 그 물체가 놓인 바깥 기준(world).
 * (x, z) 모서리를 축으로 rot도 — 위에서 볼 때 시계 방향 — 돌아 앉은 물체
 * @param {{ x: number, z: number, rot?: number }} o
 */
export const frameOf = (o) => {
    const angle = ((Number(o.rot) || 0) * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    return {
        rotY: -angle, // three.js의 y축 회전은 위에서 볼 때 반시계 방향이 +
        toWorld: (lx, lz) => ({ x: o.x + lx * cos - lz * sin, z: o.z + lx * sin + lz * cos }),
        toLocal: (wx, wz) => { const dx = wx - o.x, dz = wz - o.z; return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos }; },
        toWorldDir: (vx, vz) => ({ x: vx * cos - vz * sin, z: vx * sin + vz * cos }),
        toLocalDir: (vx, vz) => ({ x: vx * cos + vz * sin, z: -vx * sin + vz * cos })
    };
};

/** 두 좌표 변환을 이어 붙인다: inner 기준 → outer 기준 → 전체 (창고 안에서 돌려 놓은 구획) */
export const joinFrames = (outer, inner) => ({
    rotY: outer.rotY + inner.rotY,
    toWorld: (lx, lz) => { const p = inner.toWorld(lx, lz); return outer.toWorld(p.x, p.z); },
    toLocal: (wx, wz) => { const p = outer.toLocal(wx, wz); return inner.toLocal(p.x, p.z); },
    toWorldDir: (vx, vz) => { const p = inner.toWorldDir(vx, vz); return outer.toWorldDir(p.x, p.z); },
    toLocalDir: (vx, vz) => { const p = outer.toLocalDir(vx, vz); return inner.toLocalDir(p.x, p.z); }
});

/** 외곽선 한가운데 (넓이 중심, 넓이가 0이면 점들의 평균) */
export const outlineCenter = (pts) => {
    let area = 0, cx = 0, cz = 0;
    pts.forEach(([x, z], i) => {
        const [x2, z2] = pts[(i + 1) % pts.length], cross = x * z2 - x2 * z;
        area += cross; cx += (x + x2) * cross; cz += (z + z2) * cross;
    });
    if (Math.abs(area) < 1e-6) return { x: pts.reduce((s, p) => s + p[0], 0) / pts.length, z: pts.reduce((s, p) => s + p[1], 0) / pts.length };
    return { x: cx / (3 * area), z: cz / (3 * area) };
};

/** 외곽선을 바깥으로 t만큼 넓힌 선 (모서리는 두 변을 그대로 이어 붙인 점) — 벽 두께 자리 */
export const offsetOutline = (pts, t) => {
    const n = pts.length;
    const area = pts.reduce((s, [x, z], i) => { const [x2, z2] = pts[(i + 1) % n]; return s + x * z2 - x2 * z; }, 0);
    const sign = area >= 0 ? 1 : -1;
    const normal = (i) => {
        const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
        const len = Math.hypot(x2 - x1, z2 - z1) || 1;
        return [(sign * (z2 - z1)) / len, (-sign * (x2 - x1)) / len];
    };
    return pts.map(([x, z], i) => {
        const a = normal((i + n - 1) % n), b = normal(i);
        const k = t / Math.max(0.2, 1 + a[0] * b[0] + a[1] * b[1]);
        return [x + (a[0] + b[0]) * k, z + (a[1] + b[1]) * k];
    });
};

/**
 * 외곽선에서 그 점에 가장 가까운 변과 그 변 위의 가장 가까운 점 (출입문을 찍은 자리에 붙일 때).
 * @param {number[][]} pts 외곽선 [x, z] 점 목록
 * @returns {{ index: number, dist: number, x: number, z: number, along: number, length: number, angle: number }|null}
 *   index = 변 번호(점 index → index + 1), dist = 점에서 변까지 거리, (x, z) = 변 위의 가장 가까운 점,
 *   along = 변 시작점에서 그 점까지 거리, length = 변 길이, angle = 변 방향(도) — 건물 바깥이 그 방향의 왼쪽이 되게 잡는다(0이면 바깥 = 북쪽)
 */
export const nearestEdge = (pts, x, z) => {
    const n = pts.length;
    // 넓이가 +면 위에서 볼 때 시계 방향 외곽선 — 변 방향 그대로 두면 바깥이 왼쪽이다. 반시계 방향이면 뒤집는다
    const area = pts.reduce((s, [x1, z1], i) => { const [x2, z2] = pts[(i + 1) % n]; return s + x1 * z2 - x2 * z1; }, 0);
    const turn = area >= 0 ? 1 : -1;
    let best = null;
    pts.forEach(([x1, z1], i) => {
        const [x2, z2] = pts[(i + 1) % n];
        const dx = x2 - x1, dz = z2 - z1, len2 = dx * dx + dz * dz;
        if (len2 < 1e-9) return;
        const t = Math.min(1, Math.max(0, ((x - x1) * dx + (z - z1) * dz) / len2));
        const px = x1 + dx * t, pz = z1 + dz * t, dist = Math.hypot(x - px, z - pz);
        if (best && dist >= best.dist) return;
        const length = Math.sqrt(len2);
        best = { index: i, dist, x: px, z: pz, along: t * length, length, angle: (Math.atan2(dz * turn, dx * turn) * 180) / Math.PI };
    });
    return best;
};

/** 점이 외곽선(다각형) 안에 있는지 */
export const isInOutline = (pts, x, z) => {
    let isInside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
        const [xi, zi] = pts[i], [xj, zj] = pts[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) isInside = !isInside;
    }
    return isInside;
};
