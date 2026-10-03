// ==========================================
// 평면도 편집기 — 모형의 평면 모양 (2): 방(칸막이) · 가구·가전 · 설비·시설
// ==========================================
// 모형 기준 좌표(m): 중심이 원점, 앞(rot이 가리키는 쪽)이 위쪽(-y). 크기는 services/warehouseZones.js의 propSize와 같다.
// 지게차·드럼 파렛트·IBC·화물차·계단·저장 탱크는 planEditor.js의 propShape에 있고, 그 밖의 모형을 여기서 그린다.
// 3D 모양은 propModelsExtra.js (모형 종류를 더하면 PROP_MODELS · propModelsExtra.js · 여기 세 곳에 넣는다).
import { PROP_MODELS, stairElevatorLayout } from '../../services/warehouseZones.js';

const DOOR_WIDTH = 0.9; // 방 문 자리 폭 (3D와 같음)
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ type: string }} prop 모형 줄
 * @param {{ w: number, front: number, back: number }} size 평면 크기 (propSize)
 * @param {string} edge 테두리 속성 글자 (stroke · stroke-width · 선 굵기 고정)
 * @param {string} thin 가는 선 속성 글자 (선 굵기 고정)
 * @returns {string} SVG 조각 (모르는 종류면 '')
 */
export const planShapeOf = (prop, size, edge, thin) => {
    const model = PROP_MODELS[prop.type];
    if (!model) return '';
    const x = -size.w / 2, y = -size.front, len = size.front + size.back, w = size.w;
    const rect = (fill, more = '') => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(len)}" fill="${fill}" ${more} ${edge}/>`;
    const line = (d, color = '#64748b', width = 1) => `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" ${thin}/>`;

    if (model.group === 'ROOM') {
        // 바닥 색 + 벽(방 색 굵은 선) + 앞 벽 가운데 문 자리(흰 틈 + 문이 열리는 호)
        const door = Math.min(DOOR_WIDTH, w * 0.5);
        return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(len)}" fill="${model.color}" fill-opacity="0.14" stroke="${model.color}" stroke-width="4" ${thin}/>
            <rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(len)}" fill="none" ${edge} stroke-dasharray="2 3"/>
            <path d="M${r2(-door / 2)} ${r2(y)}H${r2(door / 2)}" stroke="#ffffff" stroke-width="6" ${thin}/>
            ${line(`M${r2(-door / 2)} ${r2(y)}V${r2(y + door)}A${r2(door)} ${r2(door)} 0 0 0 ${r2(door / 2)} ${r2(y)}`, model.color, 1.5)}`;
    }
    switch (prop.type) {
        case 'DESK': // 상판 + 뒤쪽 모니터
            return `${rect('#e7d3b0', 'rx="0.04"')}<rect x="-0.4" y="0.1" width="0.5" height="0.06" fill="#1f2937"/>`;
        case 'CHAIR':
            return `<rect x="${r2(x + 0.03)}" y="${r2(y + 0.03)}" width="${r2(w - 0.06)}" height="${r2(len - 0.12)}" rx="0.1" fill="#64748b" ${edge}/><rect x="${r2(x + 0.03)}" y="${r2(-y - 0.1)}" width="${r2(w - 0.06)}" height="0.08" rx="0.03" fill="#334155"/>`;
        case 'MEETING_TABLE': // 탁자 + 앞뒤 의자 셋씩
            return `<rect x="-1" y="-0.45" width="2" height="0.9" rx="0.08" fill="#e7d3b0" ${edge}/>
                ${[-0.65, 0, 0.65].map(cx => `<rect x="${r2(cx - 0.22)}" y="-1" width="0.44" height="0.44" rx="0.1" fill="#94a3b8"/><rect x="${r2(cx - 0.22)}" y="0.56" width="0.44" height="0.44" rx="0.1" fill="#94a3b8"/>`).join('')}`;
        case 'SOFA':
            return `${rect('#94a3b8', 'rx="0.1"')}<rect x="${r2(x)}" y="${r2(-y - 0.2)}" width="${r2(w)}" height="0.2" rx="0.06" fill="#475569"/>`;
        case 'CABINET':
            return `${rect('#cbd5e1')}${line(`M0 ${r2(y)}V${r2(-y)}`)}`;
        case 'LOCKER':
            return `${rect('#bfdbfe')}${line(`M-0.15 ${r2(y)}V${r2(-y)}M0.15 ${r2(y)}V${r2(-y)}`)}`;
        case 'SHELF':
            return `${rect('#e2e8f0')}${line(`M${r2(x)} ${r2(y)}L${r2(-x)} ${r2(-y)}M${r2(-x)} ${r2(y)}L${r2(x)} ${r2(-y)}`, '#94a3b8')}`;
        case 'FRIDGE':
            return `${rect('#f1f5f9', 'rx="0.05"')}<circle cx="0.2" cy="${r2(y + 0.1)}" r="0.04" fill="#64748b"/>`;
        case 'WATER':
            return `${rect('#e0f2fe', 'rx="0.04"')}<circle r="0.08" fill="#38bdf8"/>`;
        case 'AIRCON':
            return `${rect('#f1f5f9', 'rx="0.04"')}${line(`M${r2(x + 0.06)} ${r2(y + 0.08)}H${r2(-x - 0.06)}`, '#94a3b8', 2)}`;
        case 'COPIER':
            return `${rect('#e5e7eb', 'rx="0.04"')}<rect x="-0.25" y="-0.15" width="0.5" height="0.35" fill="#f8fafc" stroke="#94a3b8" stroke-width="1" ${thin}/>`;
        case 'SINK':
            return `${rect('#e2e8f0')}<rect x="-0.5" y="-0.18" width="0.5" height="0.36" rx="0.05" fill="#94a3b8"/><circle cx="-0.25" cy="0.2" r="0.04" fill="#475569"/>`;
        case 'TOILET_SEAT':
            return `<rect x="-0.19" y="0.13" width="0.38" height="0.2" rx="0.03" fill="#f8fafc" ${edge}/><ellipse cx="0" cy="-0.08" rx="0.19" ry="0.25" fill="#f8fafc" ${edge}/>`;
        case 'WASHBASIN':
            return `${rect('#f8fafc', 'rx="0.08"')}<ellipse rx="0.16" ry="0.12" fill="#bae6fd"/>`;
        case 'ELEVATOR': // 승강로 + 대각선 + 앞의 문
            return `${rect('#e2e8f0')}${line(`M${r2(x)} ${r2(y)}L${r2(-x)} ${r2(-y)}M${r2(-x)} ${r2(y)}L${r2(x)} ${r2(-y)}`, '#94a3b8')}
                <path d="M${r2(-Math.min(0.55, w * 0.28))} ${r2(y)}H${r2(Math.min(0.55, w * 0.28))}" stroke="#f97316" stroke-width="5" ${thin}/>`;
        case 'STAIRWELL': { // 벽(뒤·옆) + 가운데 난간 + 디딤판 선 + 오르는 화살표
            const steps = Math.max(4, Math.round((len - 1.5) / 0.3));
            const treads = Array.from({ length: steps }, (_, i) => `M${r2(x)} ${r2(y + 0.3 + ((len - 1.5) * i) / steps)}H${r2(-x)}`).join('');
            return `${rect('#f1f5f9')}${line(treads, '#94a3b8')}${line(`M0 ${r2(y + 0.3)}V${r2(-y - 1.2)}`, '#f59e0b', 2.5)}
                ${line(`M${r2(x / 2)} ${r2(y + 0.4)}V${r2(-y - 1.4)}M${r2(x / 2 - 0.15)} ${r2(-y - 1.6)}L${r2(x / 2)} ${r2(-y - 1.35)}L${r2(x / 2 + 0.15)} ${r2(-y - 1.6)}`, '#f59e0b', 2)}`;
        }
        case 'STAIR_ELEVATOR': { // ㄷ자: 앞 홀 · 왼쪽 계단(뒤로) · 뒤 참 · 오른쪽 계단(앞으로) + 가운데 승강로(대각선) · 홀 쪽 엘리베이터 문 — 화살표 = 시계 반대 방향으로 오름
            const L = stairElevatorLayout(prop);
            const treads = (x0, x1) => Array.from({ length: L.steps + 1 }, (_, i) => `M${r2(x0)} ${r2(L.zA + L.tread * i)}H${r2(x1)}`).join('');
            const head = (x, yy, dx, dy) => `M${r2(x - dy * 0.18 - dx * 0.25)} ${r2(yy - dx * 0.18 - dy * 0.25)}L${r2(x)} ${r2(yy)}L${r2(x + dy * 0.18 - dx * 0.25)} ${r2(yy + dx * 0.18 - dy * 0.25)}`;
            const lx = L.ix0 + L.sw / 2, rx = L.ix1 - L.sw / 2, ly = L.zB + L.landing / 2, s = L.shaft;
            const door = Math.min(1.0, (s.x1 - s.x0) * 0.6);
            return `${rect('#f8fafc')}
                <rect x="${r2(L.ix0)}" y="${r2(L.iz0)}" width="${r2(L.ix1 - L.ix0)}" height="${r2(L.hall)}" fill="#e2e8f0"/>
                <rect x="${r2(L.ix0)}" y="${r2(L.zB)}" width="${r2(L.ix1 - L.ix0)}" height="${r2(L.landing)}" fill="#e2e8f0"/>
                ${line(treads(L.ix0, L.ix0 + L.sw) + treads(L.ix1 - L.sw, L.ix1), '#94a3b8')}
                <rect x="${r2(s.x0)}" y="${r2(s.z0)}" width="${r2(s.x1 - s.x0)}" height="${r2(s.z1 - s.z0)}" fill="#cbd5e1" stroke="#475569" stroke-width="1.5" ${thin}/>
                ${line(`M${r2(s.x0)} ${r2(s.z0)}L${r2(s.x1)} ${r2(s.z1)}M${r2(s.x1)} ${r2(s.z0)}L${r2(s.x0)} ${r2(s.z1)}`, '#94a3b8')}
                <path d="M${r2(-door / 2)} ${r2(s.z0)}H${r2(door / 2)}" stroke="#f97316" stroke-width="5" ${thin}/>
                ${line(`M${r2(lx)} ${r2(L.zA - 0.3)}V${r2(ly)}H${r2(rx)}V${r2(L.zA - 0.3)}${head(rx, L.zA - 0.3, 0, -1)}`, '#f59e0b', 2)}
                <circle cx="${r2(lx)}" cy="${r2(L.zA - 0.3)}" r="0.12" fill="#f59e0b"/>`;
        }
        case 'STEEL_DECK': { // 바닥 테두리(끊긴 선) + 빗금 + 모서리 기둥
            const hatch = [];
            for (let t = -len; t < w; t += 0.8) hatch.push(`M${r2(x + Math.max(0, t))} ${r2(y + Math.max(0, -t))}L${r2(x + Math.min(w, t + len))} ${r2(y + Math.min(len, len - (t + len - Math.min(w, t + len))))}`);
            const post = (px, py) => `<rect x="${r2(px - 0.09)}" y="${r2(py - 0.09)}" width="0.18" height="0.18" fill="#475569"/>`;
            return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(len)}" fill="#94a3b8" fill-opacity="0.18" ${edge} stroke-dasharray="7 4"/>${line(hatch.join(''), '#94a3b8')}
                ${post(x + 0.09, y + 0.09)}${post(-x - 0.09, y + 0.09)}${post(x + 0.09, -y - 0.09)}${post(-x - 0.09, -y - 0.09)}`;
        }
        case 'MIX_TANK': // 위에서 본 탱크 + 가운데 교반기 모터 + 날개
            return `<circle r="${r2(w / 2)}" fill="#e5e7eb" ${edge}/><circle r="${r2(w * 0.36)}" fill="none" stroke="#9ca3af" stroke-width="1" ${thin}/>
                ${line(`M${r2(-w * 0.3)} 0H${r2(w * 0.3)}M0 ${r2(-w * 0.3)}V${r2(w * 0.3)}`, '#64748b', 1.5)}<rect x="-0.17" y="-0.17" width="0.34" height="0.34" fill="#2563eb"/>`;
        case 'BOILER':
            return `${rect('#fca5a5', 'rx="0.5"')}<rect x="-0.25" y="${r2(y)}" width="0.5" height="0.3" fill="#1e3a8a"/><circle cx="0" cy="0.7" r="0.14" fill="#64748b"/>`;
        case 'COMPRESSOR':
            return `${rect('#93c5fd', 'rx="0.28"')}<rect x="-0.2" y="-0.45" width="0.4" height="0.5" fill="#334155"/>`;
        case 'CONVEYOR': { // 벨트 + 롤러 선
            const rollers = [];
            for (let t = y + 0.25; t < -y - 0.1; t += 0.5) rollers.push(`M${r2(x)} ${r2(t)}H${r2(-x)}`);
            return `${rect('#374151')}${line(rollers.join(''), '#9ca3af')}`;
        }
        case 'FILLER':
            return `${rect('#e5e7eb')}<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="0.3" fill="#374151"/>${[-0.42, -0.14, 0.14, 0.42].map(cx => `<circle cx="${cx}" cy="${r2(y + 0.15)}" r="0.05" fill="#2563eb"/>`).join('')}`;
        case 'SCALE':
            return `<rect x="-0.6" y="${r2(y)}" width="1.2" height="1.2" fill="#cbd5e1" ${edge}/><rect x="-0.15" y="${r2(-y - 0.14)}" width="0.3" height="0.1" fill="#1f2937"/>`;
        case 'PANEL':
            return `${rect('#d1d5db')}<path d="M-0.06 ${r2(y + 0.04)}L0.03 ${r2(y + 0.12)}H-0.03L0.06 ${r2(-y - 0.04)}" stroke="#ca8a04" stroke-width="1.5" fill="none" ${thin}/>`;
        case 'FIRE_EXT':
            return `<circle r="${r2(w / 2)}" fill="#dc2626" ${edge}/><circle r="0.04" fill="#1f2937"/>`;
        case 'HAND_PALLET': // 포크 둘 + 몸통 + 손잡이
            return `<rect x="-0.27" y="${r2(y)}" width="0.16" height="1.15" fill="#f97316" ${edge}/><rect x="0.11" y="${r2(y)}" width="0.16" height="1.15" fill="#f97316" ${edge}/>
                <rect x="${r2(x)}" y="${r2(y + 1.1)}" width="${r2(w)}" height="0.25" fill="#f97316" ${edge}/>${line(`M0 ${r2(y + 1.35)}V${r2(-y)}M-0.18 ${r2(-y)}H0.18`, '#1f2937', 2.5)}`;
        default:
            return '';
    }
};
