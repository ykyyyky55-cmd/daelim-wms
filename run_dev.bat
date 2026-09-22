@echo off
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
echo ==============================================================
echo   DAELIMOIL SMART WMS PRO - 로컬 개발 서버를 실행합니다...
echo   브라우저 주소: http://localhost:5173
echo   (종료하려면 이 창에서 Ctrl + C를 누르세요)
echo ==============================================================
npm run dev
pause
