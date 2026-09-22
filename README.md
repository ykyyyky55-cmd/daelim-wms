# DAELIMOIL SMART WMS PRO (Cloud Realtime)

> **대림오일 스마트 자재·재고·수불 관리 시스템 - Vite & Supabase 실시간 클라우드 에디션**

기존 단일 HTML(약 7,400줄)로 구성되었던 WMS를 최신 **Vite 기반 모던 웹 아키텍처**로 컴포넌트화하고, **Supabase (PostgreSQL + Realtime WebSocket)**를 연동하여 여러 현장 작업자와 관리자가 동시에 실시간으로 협업할 수 있도록 전면 고도화한 프로젝트입니다.

---

## 🚀 빠른 시작 (Quick Start)

### 1. 개발 서버 실행
```bash
# 프로젝트 폴더로 이동 후 실행
npm run dev
```
브라우저에서 `http://localhost:5173`으로 접속하시면 즉시 실행됩니다.

> ※ Supabase 키를 아직 입력하지 않은 상태에서도 **로컬 오프라인/데모 모드**로 모든 화면과 기능(QR 스캔, 엑셀, 라벨 인쇄 등)이 완벽히 작동합니다.

### 2. 프로덕션 빌드
```bash
npm run build
```
`dist/` 디렉터리에 최적화된 정적 파일 번들이 생성됩니다.

---

## 🌐 Supabase 실시간 클라우드 DB 연동 가이드

여러 PC나 현장 스마트폰/태블릿에서 실시간으로 재고 데이터를 공유하려면 아래의 간단한 3단계를 진행하세요:

### 1단계: Supabase 프로젝트 생성
1. [supabase.com](https://supabase.com)에 로그인 후 **[New Project]** 생성 (무료)

### 2단계: 테이블 및 실시간 설정 (SQL 실행)
1. Supabase 대시보드 좌측 메뉴의 **[SQL Editor]**를 클릭합니다.
2. 본 프로젝트의 [`supabase_schema.sql`](./supabase_schema.sql) 파일 내용을 전체 복사하여 붙여넣고 **[RUN]** 버튼을 누릅니다.
3. 모든 테이블(`wms_master_items`, `wms_inventory`, `wms_history_logs` 등)과 보안 정책(RLS), 실시간 WebSocket 구독 채널이 3초 안에 자동 생성됩니다.

### 3단계: 앱에 연결 키 등록
1. 웹 앱 화면 우측 상단의 **[클라우드 DB 설정]** 버튼을 클릭합니다.
2. Supabase 대시보드의 **Project Settings → API**에서 복사한 `Project URL`과 `anon public key`를 입력하고 **[저장 및 실시간 동기화 시작]**을 누릅니다.
3. 상단 뱃지가 `🟢 Supabase 실시간 연결됨`으로 변경되며, 모든 재고 변경이 연결된 모든 기기에 0.1초 만에 자동 동기화됩니다!

---

## 📂 프로젝트 구조 (Project Structure)

```text
C:\code\daelim-wms\
├── index.html                  # 메인 HTML 템플릿 및 폼텍 인쇄 CSS
├── package.json                # 의존성 및 스크립트 정의
├── vite.config.js              # Vite 개발 서버 및 빌드 설정
├── supabase_schema.sql         # Supabase 원클릭 DDL/RLS/시드 SQL
├── .env.example                # 환경변수 템플릿
├── src\
│   ├── main.js                 # 앱 엔트리포인트 및 라우팅/토스트
│   ├── services\
│   │   ├── supabase.js         # Supabase 클라이언트 & 연결 상태 관리
│   │   ├── db.js               # 통합 CRUD & Supabase/LocalStorage 하이브리드 계층
│   │   └── realtime.js         # PostgreSQL Realtime 웹소켓 이벤트 구독
│   └── components\
│       ├── Header.js           # 상단 툴바, 작업자/권한 배지, 탭 네비게이션
│       ├── Dashboard.js        # KPI 요약 카드, 빠른 입출고, 결품 경보 위젯
│       ├── Scanner.js          # 모바일 카메라 QR/바코드 고속 스캔 및 즉시 처리
│       ├── LabelPrinter.js     # 폼텍(Formtec 3120, 3118) A4 대량 인쇄 엔진
│       ├── MasterManager.js    # 품목 마스터 CRUD 및 엑셀 일괄 등록
│       ├── InventoryManager.js # 거점별 재고 현황판 및 안전재고 필터링
│       ├── AuditManager.js     # 현장 재고 실사 및 전산 오차 자동 보정
│       ├── LedgerCalendar.js   # 자재 수불부 원장 및 월간 일정 캘린더
│       ├── Analytics.js        # Chart.js 기반 입출고 추이 및 카테고리 분석
│       ├── HistoryManager.js   # 작업 감사 로그 (Audit Trail)
│       └── Modals.js           # 권한/작업자/거점/분류/엑셀/백업 모달
```

---

## 🎯 주요 핵심 기능

1. **실시간 다중 접속 동기화 (Supabase Realtime)**:
   - 현장에서 작업자가 스마트폰으로 QR을 스캔해 출고 처리하면, 사무실 모니터링 화면에 새로고침 없이 즉시 수량 감소 및 알림 토스트가 표시됩니다.
2. **모바일 QR / 바코드 고속 스캔**:
   - 카메라를 통한 현장 고속 스캐닝 및 비프음 오디오 피드백 제공.
3. **폼텍(Formtec) A4 스티커 라벨 인쇄**:
   - 폼텍 3120(14칸), 3118(18칸) 표준 규격에 맞춘 픽셀 단위 인쇄 정합성 지원 (시작 칸 오프셋 건너뛰기 기능 포함).
4. **엑셀(SheetJS) 대량 등록 및 내보내기**:
   - 수백 개의 자재 품목을 엑셀 파일 업로드로 한 번에 등록하고 전체 재고 현황을 엑셀로 추출.
5. **정기 재고 실사(Audit) 오차 자동 보정**:
   - 전산 수량과 실물 수량 간 오차(초과/손실)를 계산하여 원클릭으로 전산 재고에 반영하고 사유 기록.
