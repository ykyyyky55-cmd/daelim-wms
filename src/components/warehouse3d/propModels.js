// ==========================================
// 창고 배치도 3D 모형 — 지게차 · 드럼 파렛트 · IBC 탱크 · 화물차 (참고 표시, 재고와 무관)
// ==========================================
// 상자·원기둥(·선)만으로 만든 가벼운 모형. 모두 바닥(y 0) 위에 서 있고 중심이 원점, 앞 = -z (rot 0이면 북쪽을 봄).
// 평면 크기는 services/warehouseZones.js의 PROP_MODELS(평면도 편집기와 같이 씀)와 맞춘다 — 모양을 고치면 그 값도 고친다.

/**
 * 화물차 치수 (m)
 * @typedef {{ L: number, W: number, cabW: number, cabLen: number, roofY: number, beltY: number, deckY: number, gateH: number,
 *   wheelR: number, rearR: number, axleF: number, axleR: number, body: string, gate: string }} TruckSpec
 *   L 전체 길이 · W 적재함 폭 · cabW 캡 폭 · cabLen 캡 길이 · roofY 지붕 높이 · beltY 유리 아래 선 높이 ·
 *   deckY 적재함 바닥 높이 · gateH 옆문 높이 · wheelR·rearR 앞·뒷바퀴 반지름 · axleF·axleR 앞 끝에서 앞·뒤 축까지 · body·gate 캡·적재함 문 색
 */
/** @type {Record<string, TruckSpec>} */
const TRUCKS = {
    // 1톤 (포터·봉고급 초장축): 5.15 × 1.74 × 1.97m, 축거 2.64m, 뒷바퀴는 작은 복륜
    TRUCK_1T: { L: 5.15, W: 1.74, cabW: 1.7, cabLen: 1.7, roofY: 1.97, beltY: 1.1, deckY: 0.8, gateH: 0.36, wheelR: 0.31, rearR: 0.27, axleF: 0.98, axleR: 3.62, body: '#2563eb', gate: '#1d4ed8' },
    // 3.5톤 (마이티급 초장축): 6.72 × 2.17 × 2.36m, 축거 3.78m, 뒷바퀴 복륜
    TRUCK_35T: { L: 6.72, W: 2.17, cabW: 2.0, cabLen: 1.72, roofY: 2.36, beltY: 1.42, deckY: 1.02, gateH: 0.4, wheelR: 0.39, rearR: 0.39, axleF: 1.14, axleR: 4.92, body: '#f8fafc', gate: '#e2e8f0' }
};
// 드럼(200L): 지름 0.57m · 높이 0.88m, 파렛트(1.15 × 1.15 × 0.14m)에 2 × 2로 넷
const DRUM = { r: 0.285, h: 0.88, spots: [[-0.29, -0.29], [0.29, -0.29], [-0.29, 0.29], [0.29, 0.29]] };
// IBC 탱크(1,000L): 폭 1.0 × 길이 1.2 × 높이 1.14m (받침 0.14m + 통 1.0m), 앞(-z) 아래에 밸브
const IBC = { w: 1.0, d: 1.2, baseH: 0.14, tankH: 1.0 };

/**
 * 모형 만들기 도구. 같은 크기의 모양·같은 색 재질은 한 번만 만들어 함께 쓴다.
 * @param {typeof import('three')} THREE
 * @param {<T>(o: T) => T} track 다시 그릴 때 정리(dispose)할 목록에 넣는 함수
 * @returns {(type: string) => import('three').Group|null} 모형 종류(PROP_MODELS의 키) → 묶음 (모르는 종류는 null)
 */
export const createPropBuilder = (THREE, track) => {
    const geos = new Map(), mats = new Map();
    const cached = (map, key, make) => { if (!map.has(key)) map.set(key, track(make())); return map.get(key); };
    const box = (w, h, d) => cached(geos, `B${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
    const cyl = (r, h, seg = 20) => cached(geos, `C${r.toFixed(3)}|${h.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(r, r, h, seg));
    const mat = (color, extra = {}) => cached(mats, `${color}${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...extra }));
    const lineMat = (color) => cached(mats, `L${color}`, () => new THREE.LineBasicMaterial({ color }));
    /** 부품 하나를 묶음에 넣는다 */
    const part = (g, geo, m, x, y, z) => {
        const o = new THREE.Mesh(geo, m);
        o.position.set(x, y, z);
        o.castShadow = true;
        g.add(o);
        return o;
    };
    /** 누운 원기둥(축이 좌우 방향) — 바퀴 */
    const roller = (g, geo, m, x, y, z) => { const o = part(g, geo, m, x, y, z); o.rotation.z = Math.PI / 2; return o; };

    // 지게차 (카운터밸런스형, 길이 약 3.7m(포크 포함) · 폭 1.1m · 헤드가드 2.2m)
    const forklift = () => {
        const g = new THREE.Group();
        const yellow = mat('#f59e0b'), dark = mat('#1f2937'), steel = mat('#64748b', { metalness: 0.6 }), black = mat('#0f172a');
        part(g, box(1.1, 0.6, 1.9), yellow, 0, 0.55, 0.1);          // 차체
        part(g, box(1.1, 0.75, 0.45), dark, 0, 0.62, 1.2);          // 카운터웨이트
        part(g, box(0.5, 0.12, 0.5), black, 0, 0.92, 0.35);         // 시트
        part(g, box(0.5, 0.45, 0.08), black, 0, 1.18, 0.6);         // 등받이
        part(g, box(0.9, 0.35, 0.3), yellow, 0, 1.0, -0.55);        // 계기판·핸들 받침
        [[-0.47, -0.45], [0.47, -0.45], [-0.47, 0.75], [0.47, 0.75]].forEach(([x, z]) => part(g, box(0.06, 1.35, 0.06), dark, x, 1.5, z)); // 헤드가드 기둥
        part(g, box(1.05, 0.05, 1.3), dark, 0, 2.2, 0.15);          // 헤드가드 지붕
        [-0.34, 0.34].forEach(x => part(g, box(0.1, 2.3, 0.12), steel, x, 1.2, -1.05)); // 마스트
        part(g, box(0.8, 0.08, 0.1), steel, 0, 2.3, -1.05);
        part(g, box(0.9, 0.5, 0.06), steel, 0, 0.45, -1.15);        // 캐리지
        [-0.25, 0.25].forEach(x => part(g, box(0.1, 0.05, 1.1), steel, x, 0.13, -1.72)); // 포크
        [[-0.56, -0.62], [0.56, -0.62], [-0.56, 0.78], [0.56, 0.78]].forEach(([x, z]) => roller(g, cyl(0.28, 0.22, 18), black, x, 0.28, z));
        return g;
    };

    // 드럼 파렛트: 나무 파렛트(윗판 + 받침목 세 줄) 위에 파란 드럼 넷 (몸통 + 띠 둘 + 위아래 테 + 뚜껑 + 마개 둘)
    const drumPallet = () => {
        const g = new THREE.Group();
        const wood = mat('#a16207', { roughness: 0.85, metalness: 0.02 });
        const shell = mat('#1d4ed8', { roughness: 0.42, metalness: 0.45 }), band = mat('#1e3a8a', { roughness: 0.42, metalness: 0.5 });
        const lid = mat('#1e40af', { roughness: 0.5, metalness: 0.4 }), plug = mat('#cbd5e1', { roughness: 0.35, metalness: 0.7 });
        part(g, box(1.15, 0.04, 1.15), wood, 0, 0.12, 0);
        [-0.5, 0, 0.5].forEach(x => part(g, box(0.11, 0.1, 1.15), wood, x, 0.05, 0));
        const { r, h } = DRUM, y0 = 0.14;
        DRUM.spots.forEach(([x, z]) => {
            part(g, cyl(r, h, 24), shell, x, y0 + h / 2, z);
            [0.34, 0.66].forEach(k => part(g, cyl(r + 0.012, 0.035, 24), band, x, y0 + h * k, z));
            [0.015, h - 0.015].forEach(y => part(g, cyl(r + 0.008, 0.03, 24), band, x, y0 + y, z));
            part(g, cyl(r - 0.03, 0.008, 24), lid, x, y0 + h + 0.004, z);
            part(g, cyl(0.035, 0.03, 10), plug, x + 0.14, y0 + h + 0.015, z);
            part(g, cyl(0.02, 0.03, 8), plug, x - 0.14, y0 + h + 0.015, z);
        });
        return g;
    };

    // IBC 탱크의 철망: 가로 네 줄 + 0.2m 간격 세로 줄 (선으로 — 한 번에 그린다)
    const ibcCage = () => cached(geos, 'IBC-CAGE', () => {
        const hx = IBC.w / 2, hz = IBC.d / 2, y0 = IBC.baseH, y1 = IBC.baseH + IBC.tankH, pts = [];
        [0.2, 0.4, 0.6, 0.8].forEach(k => {
            const y = y0 + IBC.tankH * k;
            pts.push(-hx, y, -hz, hx, y, -hz, hx, y, -hz, hx, y, hz, hx, y, hz, -hx, y, hz, -hx, y, hz, -hx, y, -hz);
        });
        for (let x = -hx + 0.2; x < hx - 0.01; x += 0.2) [-hz, hz].forEach(z => pts.push(x, y0, z, x, y1, z));
        for (let z = -hz + 0.2; z < hz - 0.01; z += 0.2) [-hx, hx].forEach(x => pts.push(x, y0, z, x, y1, z));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        return geo;
    });
    // IBC 탱크: 받침(판 + 발 여섯) · 흰 플라스틱 통(아래 2/3는 내용물이 비쳐 보이는 색) · 철망 · 뚜껑 · 밸브 · 표지판
    const ibcTank = () => {
        const g = new THREE.Group();
        const { w, d, baseH, tankH } = IBC, top = baseH + tankH;
        const frame = mat('#94a3b8', { roughness: 0.4, metalness: 0.7 }), foot = mat('#334155');
        part(g, box(w, 0.04, d), frame, 0, baseH - 0.02, 0);
        [-w / 2 + 0.08, 0, w / 2 - 0.08].forEach(x => [-d / 2 + 0.08, d / 2 - 0.08].forEach(z => part(g, box(0.14, 0.1, 0.14), foot, x, 0.05, z)));
        const bw = w - 0.07, bd = d - 0.07, fill = tankH * 0.66;
        part(g, box(bw, fill, bd), mat('#e3c88f', { roughness: 0.4, metalness: 0 }), 0, baseH + fill / 2, 0);
        part(g, box(bw, tankH - fill, bd), mat('#f1f5f9', { roughness: 0.4, metalness: 0 }), 0, baseH + fill + (tankH - fill) / 2, 0);
        g.add(new THREE.LineSegments(ibcCage(), lineMat('#64748b')));
        // 굵은 틀: 모서리 기둥 넷 + 위 테두리
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => part(g, box(0.035, tankH, 0.035), frame, sx * (w / 2 - 0.0175), baseH + tankH / 2, sz * (d / 2 - 0.0175))));
        [-1, 1].forEach(s => {
            part(g, box(w, 0.035, 0.035), frame, 0, top, s * (d / 2 - 0.0175));
            part(g, box(0.035, 0.035, d), frame, s * (w / 2 - 0.0175), top, 0);
        });
        part(g, cyl(0.11, 0.05, 20), mat('#1e293b'), 0, top + 0.03, 0);                                   // 뚜껑
        part(g, cyl(0.045, 0.12, 12), mat('#dc2626'), 0, baseH + 0.09, -d / 2 - 0.02).rotation.x = Math.PI / 2; // 밸브
        part(g, box(0.42, 0.3, 0.012), mat('#e2e8f0', { roughness: 0.5, metalness: 0.3 }), 0, baseH + tankH * 0.62, -d / 2 - 0.008); // 표지판
        return g;
    };

    // 화물차 (캡오버 카고): 차대 · 캡(아래 차체 + 위 지붕·기둥 + 유리) · 적재함(바닥판 + 옆문·뒷문 + 앞 보호대) · 바퀴(뒤는 복륜)
    /** @param {TruckSpec} s */
    const truck = (s) => {
        const g = new THREE.Group();
        const body = mat(s.body, { roughness: 0.45, metalness: 0.25 }), gate = mat(s.gate, { roughness: 0.5, metalness: 0.25 });
        const dark = mat('#1f2937'), deck = mat('#64748b', { roughness: 0.7, metalness: 0.3 }), glass = mat('#0f172a', { roughness: 0.15, metalness: 0.5 });
        const tire = mat('#0f172a', { roughness: 0.9, metalness: 0 }), hub = mat('#cbd5e1', { roughness: 0.4, metalness: 0.6 });
        const lamp = mat('#fde68a', { emissive: '#f59e0b', emissiveIntensity: 0.35 }), tail = mat('#dc2626', { emissive: '#991b1b', emissiveIntensity: 0.3 });
        const front = -s.L / 2, rear = s.L / 2;
        const cabBottom = s.wheelR + 0.14;
        [-1, 1].forEach(side => part(g, box(0.1, 0.18, s.L - 0.5), dark, side * s.W * 0.2, s.deckY - 0.125, 0.15)); // 차대(적재함 바로 아래 세로 보 둘)
        // 캡
        const lowerH = s.beltY - cabBottom, upperH = s.roofY - s.beltY, upperLen = s.cabLen - 0.32, upperZ = front + 0.24 + upperLen / 2;
        part(g, box(s.cabW, lowerH, s.cabLen), body, 0, cabBottom + lowerH / 2, front + s.cabLen / 2);
        part(g, box(s.cabW - 0.06, upperH, upperLen), body, 0, s.beltY + upperH / 2, upperZ);
        part(g, box(s.cabW - 0.24, upperH - 0.2, 0.03), glass, 0, s.beltY + upperH / 2 - 0.03, front + 0.228); // 앞 유리
        [-1, 1].forEach(side => part(g, box(0.03, upperH - 0.24, upperLen - 0.4), glass, side * (s.cabW / 2 - 0.026), s.beltY + upperH / 2 - 0.03, upperZ - 0.06)); // 옆 유리
        part(g, box(s.cabW + 0.02, 0.18, 0.12), dark, 0, cabBottom + 0.03, front - 0.02);                 // 범퍼
        [-1, 1].forEach(side => part(g, box(0.28, 0.13, 0.03), lamp, side * (s.cabW / 2 - 0.22), cabBottom + 0.3, front - 0.008)); // 전조등
        part(g, box(s.cabW * 0.42, 0.13, 0.02), dark, 0, cabBottom + 0.3, front - 0.006);                 // 그릴
        [-1, 1].forEach(side => part(g, box(0.07, 0.22, 0.12), dark, side * (s.cabW / 2 + 0.07), s.beltY + 0.2, front + 0.34)); // 사이드 미러
        // 적재함
        const bedFront = front + s.cabLen + 0.08, bedLen = rear - bedFront, bedMid = bedFront + bedLen / 2, deckTop = s.deckY + 0.035;
        part(g, box(s.W, 0.07, bedLen), deck, 0, s.deckY, bedMid);
        [-1, 1].forEach(side => part(g, box(0.045, s.gateH, bedLen), gate, side * (s.W / 2 - 0.0225), deckTop + s.gateH / 2, bedMid));
        [bedFront + 0.0225, rear - 0.0225].forEach(z => part(g, box(s.W, s.gateH, 0.045), gate, 0, deckTop + s.gateH / 2, z));
        const guardH = s.roofY - deckTop - s.gateH - 0.15;                                                 // 앞 보호대(캡 뒤 틀)
        [-1, 1].forEach(side => part(g, box(0.05, guardH, 0.05), dark, side * (s.W / 2 - 0.08), deckTop + s.gateH + guardH / 2, bedFront + 0.025));
        part(g, box(s.W - 0.11, 0.05, 0.05), dark, 0, deckTop + s.gateH + guardH - 0.025, bedFront + 0.025);
        // 뒤: 가로대 + 후미등
        part(g, box(s.W * 0.92, 0.14, 0.05), dark, 0, s.deckY - 0.11, rear - 0.03);
        [-1, 1].forEach(side => part(g, box(0.16, 0.1, 0.03), tail, side * (s.W / 2 - 0.18), s.deckY - 0.11, rear + 0.004));
        // 바퀴: 앞 둘 · 뒤 둘(복륜이라 넓게) + 휠, 축
        const wheel = (x, z, r, width) => { roller(g, cyl(r, width, 20), tire, x, r, z); roller(g, cyl(r * 0.5, width + 0.02, 14), hub, x, r, z); };
        [-1, 1].forEach(side => {
            wheel(side * (s.W / 2 - 0.11), front + s.axleF, s.wheelR, 0.2);
            wheel(side * (s.W / 2 - 0.2), front + s.axleR, s.rearR, 0.38);
        });
        roller(g, cyl(0.06, s.W - 0.3, 10), dark, 0, s.wheelR, front + s.axleF);
        roller(g, cyl(0.08, s.W - 0.5, 10), dark, 0, s.rearR, front + s.axleR);
        return g;
    };

    return (type) => {
        if (type === 'FORKLIFT') return forklift();
        if (type === 'DRUM_PALLET') return drumPallet();
        if (type === 'IBC') return ibcTank();
        return Object.prototype.hasOwnProperty.call(TRUCKS, type) ? truck(TRUCKS[type]) : null;
    };
};
