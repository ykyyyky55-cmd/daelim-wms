// 운영기록 조회 헬퍼 (로컬 서버 / Supabase / localStorage 병합)

// 모든 가용 운영기록 불러오기 (서버 전체 API -> Supabase 클라우드 -> 로컬스토리지 병합 및 자동 캐시)
export async function fetchAllAvailableRecords() {
  const recordsMap = new Map();

  // 1. 로컬 백엔드 서버에서 전체 운영기록 일괄 조회 (/api/records-all)
  try {
    const res = await fetch('/api/records-all');
    if (res.ok) {
      const resJson = await res.json();
      if (resJson.success && resJson.records) {
        Object.entries(resJson.records).forEach(([dateStr, record]) => {
          recordsMap.set(dateStr, record);
          // 브라우저 로컬 스토리지에도 자동 동기화 캐시
          try {
            localStorage.setItem('daelim_air_record_' + dateStr, JSON.stringify(record));
          } catch (e) {}
        });
      }
    }
  } catch (e) {
    console.warn('[Server] /api/records-all 호출 예외 (정적 호스팅 환경일 수 있음):', e);
  }

  // 2. Supabase 클라우드에서 전체 조회
  if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
    try {
      const supaRecords = await window.SupabaseService.fetchSupabaseRecords();
      if (supaRecords && Array.isArray(supaRecords)) {
        supaRecords.forEach(item => {
          const dateStr = item.record_date;
          const fullRecord = {
            date: dateStr,
            status: item.status || 'NORMAL',
            ...item.record_data
          };
          if (!recordsMap.has(dateStr)) {
            recordsMap.set(dateStr, fullRecord);
          }
          try {
            if (!localStorage.getItem('daelim_air_record_' + dateStr)) {
              localStorage.setItem('daelim_air_record_' + dateStr, JSON.stringify(fullRecord));
            }
          } catch (e) {}
        });
      }
    } catch (e) {
      console.warn('[Supabase] 전체 목록 로드 예외:', e);
    }
  }

  // 3. 브라우저 localStorage 캐시 병합
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('daelim_air_record_')) {
        const dateStr = key.replace('daelim_air_record_', '');
        if (!recordsMap.has(dateStr)) {
          const parsed = JSON.parse(localStorage.getItem(key));
          if (parsed) {
            recordsMap.set(dateStr, parsed);
          }
        }
      }
    }
  } catch (e) {}

  return Array.from(recordsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// 단일 일자 운영기록 안전 로드 헬퍼 (로컬스토리지 -> 로컬서버 -> Supabase 순)
export async function fetchSingleRecord(dateStr) {
  if (!dateStr) return null;

  // 0. WMS 사본: 클라우드(WMS DB)가 기준이다. 이 기기에 남은 예전 내용보다 먼저 본다 (다른 PC에서 고친 내용이 보이게)
  if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
    try {
      const cloudRes = await window.SupabaseService.fetchSupabaseRecord(dateStr);
      if (cloudRes && cloudRes.success && cloudRes.data) return cloudRes.data;
    } catch (e) {
      console.warn('[운영기록부] 클라우드 조회 실패, 이 기기의 기록을 봅니다:', e);
    }
  }

  // 1. 브라우저 localStorage 캐시 확인
  try {
    const localData = localStorage.getItem('daelim_air_record_' + dateStr);
    if (localData) {
      const parsed = JSON.parse(localData);
      if (parsed && (parsed.date || parsed.exhaustList)) return parsed;
    }
  } catch (e) {}

  // 2. 로컬 백엔드 서버 확인
  try {
    const res = await fetch(`/api/records/${dateStr}`);
    if (res.ok) {
      const resJson = await res.json();
      if (resJson.success && resJson.data) {
        try {
          localStorage.setItem('daelim_air_record_' + dateStr, JSON.stringify(resJson.data));
        } catch (e) {}
        return resJson.data;
      }
    }
  } catch (e) {}

  // 3. Supabase 클라우드 확인
  if (window.SupabaseService && window.SupabaseService.isSupabaseConfigured()) {
    try {
      const sbRes = await window.SupabaseService.fetchSupabaseRecord(dateStr);
      if (sbRes && sbRes.success && sbRes.data) {
        try {
          localStorage.setItem('daelim_air_record_' + dateStr, JSON.stringify(sbRes.data));
        } catch (e) {}
        return sbRes.data;
      }
    } catch (e) {}
  }

  return null;
}
