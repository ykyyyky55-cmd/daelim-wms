# Supabase Auth 전환 가이드 (로그인 보안)

아이디/평문 비밀번호 로그인을 **Supabase Auth(실제 이메일 + 비밀번호, Google 로그인)** 로 바꾸고,
데이터베이스를 **로그인·승인된 사용자만, 역할에 맞는 작업만** 할 수 있게 잠그는 절차입니다.

- 가입은 누구나 할 수 있지만, 메일 인증 후 **관리자가 승인(역할 부여)** 해야 사용할 수 있습니다.
- **master 계정**: `ps05@daelimoil.co.kr` (DB 설정 `wms_app_settings.master_email`). 앱에서 다른 계정으로 이전할 수 있습니다.
- 역할: `MASTER > ADMIN > MANAGER > OPERATOR > VIEWER > PENDING(승인 대기)`.
  자기보다 낮은 역할의 사용자를, 자기보다 낮은 역할로만 바꿀 수 있습니다 (예: ADMIN 부여·회수는 master만).

## 파일

| 파일 | 단계 | 기존 앱 영향 |
|---|---|---|
| `01_auth_setup.sql` | 프로필·master 설정 테이블, 가입 트리거, 역할/승인/master 이전 함수 | 없음 |
| `02_lock_down_policies.sql` | 익명 접근 차단, 역할별 권한 적용 | **예전 로그인·비로그인 접근 차단** |
| `03_cleanup_legacy_users.sql` | 예전 `wms_users`(평문 비밀번호) 테이블 삭제 | 없음 (02 이후) |
| `04_create_schedules.sql` | 일정 테이블(`wms_schedules`) 생성 + 같은 권한 정책 (운영 DB에 없던 테이블) | 없음 |
| `05_sites_buildings.sql` | 거점 개편: `방산 창고`→`방산공장`, `대림오일 창고`→`본사 창고`(같은 품목 수량 합산), `김포2공장` 등록. 재고·이력·위치 목록 변경 | 없음 (거점 개편 앱 배포 직후 실행) |
| `06_create_raw_ledger.sql` | 원료수불부 테이블(`wms_raw_ledger`) 생성 + 같은 권한 정책. 테이블이 비어 있으면 OPERATOR 이상이 처음 로그인할 때 그 브라우저의 원료수불부 전체를 올림 | 없음 (운영 DB 적용 완료) |
| `08_secure_work_orders.sql` | 원액생산 작업지시서(특별보안): `wms_recipes`·`wms_secure_work_orders` 테이블, `wms_profiles.worklog_manager`(작업일지 관리자, 마스터만 지정), RLS `wms_has_worklog_access()` | 없음 (운영 DB 적용 완료) |
| `07_create_item_ledger.sql` | 제품·자재 수불부 테이블(`wms_item_ledger`, `kind`=product/material) 생성 + 같은 권한 정책. 테이블이 비어 있으면 OPERATOR 이상이 처음 로그인할 때 이관한 전표를 올림 | 없음 |
| `42_work_order_user.sql` | 작업지시서 사용자(`wms_profiles.wo_user`, 역할에 더하는 권한, 마스터만 지정): 테이블 직접 접근 없이 `wms_wo_orders()`(원료 실명·배합비·품목코드 뺀 작업지시서)·`wms_wo_set_qty()`(생산량·단위만)로 열람·수정 | 없음 (운영 DB 적용 완료) |
| `43_site_layout.sql` | 거점·창고 개편: 방산공장 → `본사 / 본사2A`, 김포2공장 → 김포공장, 예전 김포 건물명(`김포1A동`) → 창고코드, 원료수불부 지역 방산·김포2 → 본사·김포, 제품·자재 수불부 누적 재고 재계산, 새 거점 2개·창고 13개 등록. 바뀌는 표는 `wms_backup.*_before_43`에 백업 | 없음 (운영 DB 적용 완료) |
| `45_attach_approval_ext.sql` | 문서 첨부파일 `wms_attachments`(문서 키별, 올리기 OPERATOR·경영자 / 지우기 올린 사람·MANAGER, 경영자는 Storage `attach/`에만 올림) + `wms_approvals` 결재선(`base_roles`·`custom_roles`)·수신·참조·공유 칸, 바꾸기 함수 `wms_approval_meta`(기본 칸·서명된 칸은 못 뺌) | 없음 (운영 DB 적용 완료) |
| `46_quality.sql` | 품질관리 `wms_qc_records`(검사·불량 기록·설비·점검 이력·MSDS·설정, data JSONB). 조회 VIEWER·경영자 / 쓰기 OPERATOR / 설정(CFG) MANAGER / 삭제 쓴 사람·MANAGER | 없음 (운영 DB 적용 완료) |
| `47_approval_comments_reject.sql` | 결재 첨언 `wms_approval_comments`(작성자 트리거 고정) · 반려 상태(`wms_approvals.status`·`rejected`)와 함수 `wms_reject`(반려·재상신) · `wms_sign` 교체(반려 문서·참조/공유로만 받은 사람 서명 막음, `wms_approval_review_only`) | 없음 (운영 DB 적용 완료) |
| `48_work_forms.sql` | 생산 작업 양식 `wms_work_forms`(초·중·종물 검사 및 작업일지 INSPECT_LOG · 포장수율표 YIELD, 작업장·날짜마다 한 장, data JSONB). 조회 VIEWER·경영자 / 작성 OPERATOR / 삭제 쓴 사람·MANAGER | 없음 (운영 DB 적용 완료) |
| `49_revoke_anon_definer.sql` | 비로그인(anon)이 SECURITY DEFINER 함수 `wms_documents_reg_no`·`wms_scan_slips_reg_no`(트리거)·`wms_set_primary_image`를 RPC로 부르지 못하게 EXECUTE 회수 (Supabase 보안 점검 0028) | 없음 (운영 DB 적용 완료) |
| `50_offline_ops.sql` | 오프라인 작업 반영: 기록 테이블 `wms_offline_ops`(작업 id, RLS 조회·입력 OPERATOR) + 함수 `wms_apply_offline_op(op_id, label, created_at, stock, logs)`(SECURITY INVOKER, 작업 id로 한 번만 반영, 재고 증감 delta 또는 실사 set + 이력 입력을 한 트랜잭션으로). 앱 `services/offlineQueue.js`가 연결되면 부름 | 없음 (운영 DB 적용 완료) |
| `51_quality_kinds.sql` | 품질 기록 종류 추가: `COA`(원부자재 성적서) · `TEST_REPORT`(제품시험성적서) · `PCHECK`(공정 관리기준 점검표) · `NCR`(불량 발생 및 조치보고서, 사진 포함). `wms_qc_records.kind` 제약만 넓힘, 권한은 46번 그대로 | 없음 (운영 DB 적용 완료) |
| `52_drum_labels.sql` | 드럼 라벨(폼텍 3120) 목록·출력 이력 PC 공유: `wms_drum_labels`(라벨 한 줄 = 한 행, data·sort_order) · `wms_drum_label_prints`(출력 한 번 = 한 행, 인쇄한 사람). 조회 VIEWER·경영자 / 쓰기 OPERATOR / 출력 이력 지우기 MANAGER. 앱 `services/drumLabels.js` | 없음 (운영 DB 적용 완료) |
| `53_qc_blend_tests.sql` | 품질 기록 종류 추가: `BTEST`(원액 검사 기록, 공정관리 원액생산 관리도) · `QCSPEC`(제품 규격: 작업지시서 구분·종류·검사항목 + KS·SAE·API·ACEA·DOT4). `wms_qc_records.kind` 제약만 넓힘, 권한은 46번 그대로. 앱 `services/qcProductSpecs.js` | 없음 (운영 DB 적용 완료) |
| `44_library.sql` | 자료실 `wms_library`(분류·제목·설명·files jsonb·고정, RLS 조회 VIEWER·경영자 / 올리기 OPERATOR / 수정·삭제 올린 사람·MANAGER) + 첫 자료 '대림 로고'(앱 public 파일 링크) | 없음 (운영 DB 적용 완료) |
| `09_recipe_revisions.sql` | 제조시방서 개정이력 테이블(`wms_recipe_revisions`): 저장할 때마다 직전 내용을 스냅샷으로 남기고, 화면에서 열람·되돌리기. 같은 권한 정책(`wms_has_worklog_access()`) | 없음 |
| `77_msds_authoring.sql` | 혼합물 MSDS 작성: 물질 정보 `wms_chem_substances`(CAS 번호별 분류·독성값·규제 글) · 작성 문서 `wms_msds_docs`(구성성분 함유량 = 배합 자료, `CFG:SUPPLIER` 줄 = 공급자 기본값). 두 표 모두 RLS 조회·INSERT·UPDATE·DELETE = 마스터·작업일지 관리자(`wms_has_worklog_access`). 안전보건공단 MSDS 조회 인증키는 `wms_notify_secret`(id `KOSHA_API_KEY`)에 두고 `wms_set_kosha_key`(저장·지우기)·`wms_kosha_key_set`(설정 여부)로만 다룸 — Edge Function `kosha-msds`가 서비스 키로 읽음 | 없음 |
| `78_menu_permissions.sql` | 메뉴별 권한 설정 `wms_menu_permissions`: 역할별(`ROLE:<역할>`)·사용자별(`USER:<uuid>`)로 열 수 있는 메뉴를 기본값과 다르게 바꾼 것만 적는다(`data.tabs`). 화면을 여는 권한만 다루고 자료의 조회·저장은 각 표의 RLS가 그대로 막는다. RLS: 조회 = 역할 줄은 승인된 사용자 모두·사용자 줄은 본인과 매니저 이상, 쓰기 = 총괄 관리자 이상 |
| `79_equip_forms.sql` | 설비관리의 제조설비 점검기록부·윤활관리카드: 품질 기록 표(`wms_qc_records`)에 종류 `EQ_TPL`(설비별 양식)·`EQ_FORM`(달·해마다 한 장의 기록)을 더함. 권한은 46번 정책 그대로 |
| `80_air_records.sql` | 생산관리 → 환경관리(대기): 대기배출시설 운영기록부 표 `wms_air_records`(하루 한 줄). 조회는 승인된 사용자 모두, 작성·수정·삭제는 매니저 이상 |
| `81_air_auto_daily.sql` | 운영기록부 매일 18:00 자동 작성(pg_cron 작업 `wms-air-daily-18`, `http` 확장으로 날씨) + 업무일지(김포) 원액생산작업의 line(BT-1·2·3·5·6 → 배출구 1·2·3·4·5)을 09:00 ~ 18:00 가동으로 반영. 화면용 RPC `wms_air_auto_fill()`은 매니저 이상 |
| `82_item_pack_specs.sql` | 창고 배치도: 품목 적재 규격 표 `wms_item_pack_specs`(포장 종류·파렛트 한 단의 가로×세로·단 수·포장당 수량 — 3D 짐 모양과 파렛트 수 계산). 조회는 승인된 사용자·경영자, 쓰기는 현장 작업자 이상 |
| `83_zone_color.sql` | 창고 배치도: 구획 색 칸 `wms_warehouse_zones.color`(`#rrggbb`, 빈 칸 = 종류별 기본색). 정책은 그대로 |

모든 SQL은 여러 번 실행해도 안전하며, 로컬 Postgres(PGlite)에서 70개 항목으로 검증했습니다.

## 1. Supabase 대시보드 설정 (먼저)

### 1-1. 이메일 로그인
- **Authentication → Sign In / Providers → Email**: 켜짐, **Confirm email: 켜짐** (메일 인증을 해야 master로 인정되고 로그인할 수 있음)

### 1-2. 앱 주소 (인증 메일·Google 로그인이 돌아올 주소)
- **Authentication → URL Configuration**
  - Site URL: `https://ykyyyky55-cmd.github.io/daelim-wms/`
  - Redirect URLs에 추가: `https://ykyyyky55-cmd.github.io/daelim-wms/`, `http://localhost:5173/` (개발용)

### 1-3. 메일 발송 (권장)
Supabase 기본 메일 서버는 시간당 발송 수가 매우 적어 테스트용입니다. 여러 명이 가입하면
**Authentication → Emails → SMTP Settings**에서 회사 메일(SMTP)을 연결하세요.

### 1-4. Google 로그인 (선택)
1. [Google Cloud Console](https://console.cloud.google.com/) → API 및 서비스 → **OAuth 동의 화면** 설정
   (회사 Google Workspace 계정이면 사용자 유형 **내부**를 고르면 daelimoil.co.kr 계정만 로그인 가능)
2. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** → 애플리케이션 유형 **웹 애플리케이션**
   - 승인된 리디렉션 URI: `https://hapvzqyfikctcbxurxal.supabase.co/auth/v1/callback`
3. 발급된 **클라이언트 ID / 클라이언트 보안 비밀번호**를
   Supabase **Authentication → Sign In / Providers → Google**에 입력하고 켭니다.

Google 로그인을 켜지 않으면 로그인 화면의 Google 버튼은 "설정되지 않았습니다" 안내를 표시합니다.

## 2. 적용 순서

1. **SQL Editor에서 `01_auth_setup.sql` 실행** — 반드시 새 앱 배포 전에 실행 (새 앱은 이 함수들로 로그인 역할을 확인함)
2. **새 앱 배포** (`main`에 push → GitHub Pages 자동 배포)
   - 이때부터 예전 아이디/비밀번호로는 로그인할 수 없습니다. 모든 사용자는 새로 가입합니다.
3. **master 가입**: `ps05@daelimoil.co.kr`로 [신규 계정 생성] 또는 [Google 계정으로 로그인] → 메일 인증
4. **사용자 가입·승인**: 각자 실제 이메일로 가입 → master(또는 관리자)가 [환경설정 → 계정] 화면에서 역할 부여
5. 모두 새 로그인으로 사용 중인지 확인한 뒤 **`02_lock_down_policies.sql` 실행**
6. 며칠 문제없이 사용한 뒤 **`03_cleanup_legacy_users.sql` 실행**

## 3. 운영

- **master 변경**: master 계정으로 로그인 → [환경설정 → 계정 → master 계정]에 새 이메일 입력 → 이전.
  받는 계정은 메일 인증을 마친 가입 계정이어야 하고, 이전 후 기존 master는 ADMIN이 됩니다.
- **master 계정을 잃어버린 경우** (대시보드 소유자만): SQL Editor에서
  `UPDATE public.wms_app_settings SET master_email = '새이메일@daelimoil.co.kr';`
- **사용자 접근 차단**: [환경설정 → 계정]에서 역할을 "접근 차단(승인 대기)"으로 변경 (즉시 적용)
- **계정 완전 삭제**: Supabase **Authentication → Users**에서 삭제 (프로필도 함께 삭제됨)
- **비밀번호 분실**: 로그인 화면 [비밀번호 재설정] → 메일 링크 → 새 비밀번호 입력
