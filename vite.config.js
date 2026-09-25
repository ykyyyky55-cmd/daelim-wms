import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
