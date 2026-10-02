// 운영기록부 자동 작성 (WMS 사본 전용)
// 자동 작성은 DB가 한다: 매일 18:00(한국 시각) 예약 작업이 그날 기록을 만들고(supabase/auth/81_air_auto_daily.sql),
// 업무일지(김포)의 원액생산작업 line(BT-1·2·3·5·6 → 배출구 1·2·3·4·5)을 09:00 ~ 18:00 가동으로 반영한다.
// 여기서는 저장 권한이 있는 사람이 화면을 열 때 같은 DB 함수를 한 번 불러, 예약 작업이 놓친 날짜를 메우고
// 손대지 않은 자동 작성 기록을 그 뒤 바뀐 업무일지에 다시 맞춘다. 18시 전에는 어제까지만 다룬다(오늘 기록은 18시에 만들어진다).

/**
 * @returns {Promise<{ filled: string[], updated: string[] }>} filled = 새로 만든 날짜, updated = 업무일지에 다시 맞춘 날짜
 */
export async function fillMissingRecords() {
  const service = window.SupabaseService;
  const nothing = { filled: [], updated: [] };
  if (!service || !service.isSupabaseConfigured() || !service.canEdit()) return nothing;

  const res = await service.runAutoFill();
  if (!res.success) {
    console.warn('[운영기록부] 자동 작성을 실행하지 못했습니다:', res.message);
    return nothing;
  }
  return { filled: res.filled, updated: res.updated };
}

/**
 * 자동 작성 결과를 한 줄 안내로 (할 일이 없었으면 빈 글)
 * @param {{ filled: string[], updated: string[] }} outcome
 * @returns {string}
 */
export function describeAutoFill({ filled, updated }) {
  const parts = [];
  if (filled.length) parts.push(`빠진 날짜 ${filled.length}일(${filled[0]} ~ ${filled[filled.length - 1]})의 운영기록부를 자동 작성했습니다.`);
  if (updated.length) parts.push(`업무일지(김포) 원액생산작업을 반영해 ${updated.length}일(${updated.join(', ')})의 배출구 가동을 고쳤습니다.`);
  return parts.join(' ');
}
