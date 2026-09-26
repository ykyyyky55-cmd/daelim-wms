import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import * as lucide from 'lucide';

// lucide 아이콘은 1,500여 개(약 1MB)라 전부 넣으면 첫 화면이 느려진다.
// 빌드할 때 src·index.html의 따옴표 문자열 중 아이콘 이름과 같은 것만 모아 'virtual:lucide-used'로 내보낸다.
// (data-lucide="${x.icon}"처럼 변수로 넣어도 그 값이 소스 어딘가에 'x-name' 문자열로 있으면 포함됨)
// 개발 서버는 새 아이콘을 바로 쓸 수 있게 전체를 내보낸다.
const toPascalCase = (s) => s.replace(/(\w)(\w*)(_|-|\s*)/g, (g0, g1, g2) => g1.toUpperCase() + g2.toLowerCase());
const lucideUsedIcons = () => {
  const ID = 'virtual:lucide-used';
  let isBuild = false;
  return {
    name: 'lucide-used-icons',
    configResolved(cfg) { isBuild = cfg.command === 'build'; },
    resolveId(id) { return id === ID ? '\0' + ID : null; },
    load(id) {
      if (id !== '\0' + ID) return null;
      if (!isBuild) return `export { icons as default } from 'lucide';`;
      const files = [path.resolve('index.html')];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(js|html)$/.test(e.name)) files.push(p);
        }
      };
      walk(path.resolve('src'));
      const names = new Set();
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        for (const m of text.matchAll(/['"`]([a-z][a-z0-9-]*)['"`]/g)) {
          const pascal = toPascalCase(m[1]);
          if (lucide.icons[pascal]) names.add(pascal);
        }
      }
      const list = [...names].sort();
      return `import { ${list.join(', ')} } from 'lucide';\nexport default { ${list.join(', ')} };`;
    }
  };
};

export default defineConfig({
  base: './',
  plugins: [lucideUsedIcons()],
  server: {
    port: 5173,
    host: true,
    open: false,
    watch: {
      // 프로젝트 폴더에 작업일지·엑셀 등 자료 폴더가 함께 있으므로 코드 폴더만 감시한다.
      // (다른 프로그램이 잠근 파일(.ipDISK.db 등)을 감시하려다 dev 서버가 EBUSY로 종료되는 것 방지)
      ignored: (p) => {
        const rel = p.replace(/\\/g, '/').split('/daelim-wms/')[1];
        if (rel === undefined || rel === '') return false;
        return !/^(src|public|index\.html|vite\.config\.js|package\.json)(\/|$)/.test(rel);
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
});
