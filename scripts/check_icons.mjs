// 아이콘 점검: 소스에서 쓰는 lucide 아이콘 이름이 실제로 있는지, 메뉴(TAB_META·NAV_TREE)에 아이콘이 빠진 곳이 없는지 본다.
//   node scripts/check_icons.mjs
// 없는 이름을 data-lucide에 쓰면 화면에 아무것도 그려지지 않는다(오류도 나지 않음) — 메뉴·버튼을 더한 뒤 돌려 본다.
import fs from 'node:fs';
import path from 'node:path';
import * as lucide from 'lucide';
import { TAB_META, NAV_TREE } from '../src/components/navMenu.js';

const toPascal = (s) => s.replace(/(\w)(\w*)(_|-|\s*)/g, (g0, g1, g2) => g1.toUpperCase() + g2.toLowerCase());
const hasIcon = (name) => !!lucide.icons[toPascal(name)];

const files = [path.resolve('index.html')];
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|html)$/.test(e.name)) files.push(p);
    }
};
walk(path.resolve('src'));
walk(path.resolve('public/air'));

// 1) data-lucide="이름" (글자로 적힌 것만 — ${변수}로 넣는 곳은 아래 2·3에서 본다)
const missing = new Map();
for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-lucide=\\?["']([a-z0-9-]+)\\?["']/g)) {
        if (!hasIcon(m[1])) missing.set(m[1], [...(missing.get(m[1]) || []), path.relative('.', file)]);
    }
    // icon: '이름' · icon = '이름' 꼴로 넘기는 값
    for (const m of text.matchAll(/\bicon\s*[:=]\s*['"]([a-z0-9-]+)['"]/g)) {
        if (!hasIcon(m[1])) missing.set(m[1], [...(missing.get(m[1]) || []), path.relative('.', file)]);
    }
}

// 2) 메뉴 정의: 탭마다 아이콘이 있고 실제로 있는 이름인지
const menuProblems = [];
for (const [tab, meta] of Object.entries(TAB_META)) {
    if (!meta.icon) menuProblems.push(`${tab} (${meta.label || ''}): 아이콘 없음`);
    else if (!hasIcon(meta.icon)) menuProblems.push(`${tab} (${meta.label || ''}): 없는 아이콘 '${meta.icon}'`);
}
// 3) 상단 메뉴 묶음·하위 메뉴: 묶음 아이콘, TAB_META에 없는 탭
const inMenu = new Set();
NAV_TREE.forEach((node) => {
    if (!node.items) {
        inMenu.add(node.tab);
        if (!TAB_META[node.tab]) menuProblems.push(`${node.tab}: TAB_META에 없음`);
        return;
    }
    if (!node.icon) menuProblems.push(`묶음 ${node.label}: 아이콘 없음`);
    else if (!hasIcon(node.icon)) menuProblems.push(`묶음 ${node.label}: 없는 아이콘 '${node.icon}'`);
    node.items.filter(item => typeof item !== 'string').forEach((head) => {
        if (!head.icon) menuProblems.push(`${node.label} › 소제목 '${head.heading}': 아이콘 없음`);
        else if (!hasIcon(head.icon)) menuProblems.push(`${node.label} › 소제목 '${head.heading}': 없는 아이콘 '${head.icon}'`);
    });
    node.items.filter(item => typeof item === 'string').forEach((tab) => {
        inMenu.add(tab);
        if (!TAB_META[tab]) menuProblems.push(`${node.label} › ${tab}: TAB_META에 없음`);
    });
});
// 메뉴 줄 어디에도 없는 탭 (TAB_META에만 있음)
Object.keys(TAB_META).filter(tab => !inMenu.has(tab)).forEach(tab => menuProblems.push(`${tab} (${TAB_META[tab].label}): 상단 메뉴(NAV_TREE)에 없음`));

// 4) 같은 아이콘을 쓰는 메뉴 (아이콘만 보고 구분할 수 없다)
const byIcon = new Map();
Object.entries(TAB_META).forEach(([tab, meta]) => byIcon.set(meta.icon, [...(byIcon.get(meta.icon) || []), meta.label || tab]));
[...byIcon].filter(([, tabs]) => tabs.length > 1).forEach(([icon, tabs]) => menuProblems.push(`아이콘 '${icon}'이 겹침: ${tabs.join(' · ')}`));

if (missing.size) {
    console.log(`없는 아이콘 이름 ${missing.size}개:`);
    for (const [name, where] of missing) console.log(`  ${name}  ← ${[...new Set(where)].join(', ')}`);
} else console.log('소스의 아이콘 이름은 모두 있습니다.');
if (menuProblems.length) {
    console.log(`메뉴 아이콘 문제 ${menuProblems.length}건:`);
    menuProblems.forEach(line => console.log(`  ${line}`));
} else console.log(`메뉴 ${Object.keys(TAB_META).length}개에 아이콘이 모두 있습니다.`);
process.exitCode = missing.size || menuProblems.length ? 1 : 0;
