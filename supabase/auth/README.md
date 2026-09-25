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
