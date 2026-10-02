// ==============================================================================
// 대기배출시설 운영기록부 - 클라우드 저장 (WMS에 넣은 사본)
// ==============================================================================
// 원래 앱(daelim-air)은 운영기록부 전용 Supabase 프로젝트에 따로 붙었지만, WMS 안에서는
// WMS가 로그인해 둔 Supabase 클라이언트를 그대로 쓴다 (같은 출처의 부모 창 window.parent.__airBridge,
// components/AirRecords.js). 기록은 WMS DB의 wms_air_records 표에 있고 권한은 그 표의 RLS를 따른다
// (조회: 승인된 사용자 모두 / 저장: 매니저 이상 — supabase/auth/80_air_records.sql).
// WMS 밖에서 이 파일만 따로 열면 연결이 없으므로 이 기기의 브라우저 저장소로만 동작한다.

(function(window) {
  'use strict';

  const TABLE = 'wms_air_records';
  const NO_EDIT_MESSAGE = '운영기록부 저장은 매니저 이상만 할 수 있습니다.';

  /**
   * WMS(부모 창)가 넘겨 준 연결 정보
   * @returns {{ client: object|null, canEdit: boolean, userName: string }|null}
   */
  function getBridge() {
    try {
      return (window.parent && window.parent !== window && window.parent.__airBridge) || null;
    } catch (err) {
      // 다른 출처의 창 안에 들어가 있으면 부모를 볼 수 없다 → 연결 없음으로 본다
      console.warn('[운영기록부] WMS 연결 정보를 읽지 못했습니다:', err);
      return null;
    }
  }

  /** WMS가 로그인해 둔 Supabase 클라이언트 (로컬 모드·WMS 밖이면 null) */
  function getSupabase() {
    const bridge = getBridge();
    return (bridge && bridge.client) || null;
  }

  /** 클라우드(WMS DB)에 연결되어 있는가 */
  function isSupabaseConfigured() {
    return Boolean(getSupabase());
  }

  /** 지금 계정이 기록을 저장할 수 있는가 (연결이 없으면 이 기기에만 저장하므로 true) */
  function canEdit() {
    const bridge = getBridge();
    return !bridge || !bridge.client || Boolean(bridge.canEdit);
  }

  // ---- 예전 앱의 연결 설정 창이 부르던 함수: WMS 안에서는 연결을 따로 설정하지 않는다 ----
  function getSupabaseConfig() {
    return { url: '', key: '' };
  }
  function saveSupabaseConfig() {
    return getSupabase();
  }
  function initSupabaseClient() {
    return getSupabase();
  }
  async function testSupabaseConnection() {
    return isSupabaseConfigured()
      ? { success: true, message: 'WMS 데이터베이스에 연결되어 있습니다.' }
      : { success: false, message: 'WMS에 클라우드 로그인이 되어 있지 않아 이 기기에만 저장합니다.' };
  }

  /**
   * 특정 일자의 운영기록 조회
   * @param {string} dateStr - YYYY-MM-DD
   * @returns {Promise<{ success: boolean, data?: object|null, notFound?: boolean, message?: string }>}
   */
  async function fetchSupabaseRecord(dateStr) {
    const sb = getSupabase();
    if (!sb) {
      return { success: false, message: '클라우드 미연동' };
    }

    try {
      const { data, error } = await sb
        .from(TABLE)
        .select('*')
        .eq('record_date', dateStr)
        .maybeSingle();

      if (error) {
        console.warn(`[운영기록부] ${dateStr} 조회 오류:`, error);
        return { success: false, message: error.message };
      }

      if (data && data.record_data) {
        return {
          success: true,
          data: {
            date: data.record_date,
            status: data.status || 'NORMAL',
            ...data.record_data
          }
        };
      }

      return { success: false, notFound: true, message: '해당 일자 기록 없음' };
    } catch (err) {
      console.error(`[운영기록부] ${dateStr} 로드 예외:`, err);
      return { success: false, message: err.message };
    }
  }

  /**
   * 특정 일자의 운영기록 저장 또는 업데이트 (Upsert)
   * @param {string} dateStr - YYYY-MM-DD
   * @param {object} recordData - 일일 운영기록 데이터
   * @param {string} status - NORMAL / IDLE / HOLIDAY
   * @returns {Promise<{ success: boolean, message?: string }>}
   */
  async function saveSupabaseRecord(dateStr, recordData, status = 'NORMAL') {
    const sb = getSupabase();
    if (!sb) {
      return { success: false, message: '클라우드 미연동' };
    }
    if (!canEdit()) {
      return { success: false, message: NO_EDIT_MESSAGE };
    }

    try {
      const bridge = getBridge();
      const payload = {
        record_date: dateStr,
        record_data: recordData,
        status: status,
        updated_by_name: (bridge && bridge.userName) || '',
        updated_at: new Date().toISOString()
      };

      const { error } = await sb
        .from(TABLE)
        .upsert(payload, { onConflict: 'record_date' })
        .select('record_date');

      if (error) {
        console.error(`[운영기록부] ${dateStr} 저장 실패:`, error);
        return { success: false, message: error.message };
      }

      return { success: true, message: '클라우드 저장 완료' };
    } catch (err) {
      console.error(`[운영기록부] ${dateStr} 저장 예외:`, err);
      return { success: false, message: err.message };
    }
  }

  /**
   * 그 일자에 기록이 없을 때만 넣는다 (빠진 날짜 자동 작성용 — 이미 있는 기록은 덮어쓰지 않는다)
   * @param {string} dateStr - YYYY-MM-DD
   * @param {object} recordData - 일일 운영기록 데이터
   * @param {string} status - NORMAL / IDLE / HOLIDAY
   * @returns {Promise<{ success: boolean, message?: string }>}
   */
  async function insertSupabaseRecordIfMissing(dateStr, recordData, status = 'NORMAL') {
    const sb = getSupabase();
    if (!sb) {
      return { success: false, message: '클라우드 미연동' };
    }
    if (!canEdit()) {
      return { success: false, message: NO_EDIT_MESSAGE };
    }

    try {
      const { error } = await sb
        .from(TABLE)
        .upsert({
          record_date: dateStr,
          record_data: recordData,
          status: status,
          updated_by_name: '자동 작성',
          updated_at: new Date().toISOString()
        }, { onConflict: 'record_date', ignoreDuplicates: true });

      if (error) {
        console.error(`[운영기록부] ${dateStr} 자동 작성 실패:`, error);
        return { success: false, message: error.message };
      }
      return { success: true };
    } catch (err) {
      console.error(`[운영기록부] ${dateStr} 자동 작성 예외:`, err);
      return { success: false, message: err.message };
    }
  }

  /**
   * 저장된 전체 기록 일자 목록 조회
   * @returns {Promise<string[]>}
   */
  async function fetchSupabaseRecordDates() {
    const sb = getSupabase();
    if (!sb) return [];

    try {
      const { data, error } = await sb
        .from(TABLE)
        .select('record_date')
        .order('record_date', { ascending: false });

      if (error || !data) return [];
      return data.map(item => item.record_date);
    } catch (err) {
      console.warn('[운영기록부] 날짜 목록 조회 실패:', err);
      return [];
    }
  }

  /**
   * 저장된 전체 운영기록 목록 조회 (데이터 포함)
   * @returns {Promise<Array<{ record_date: string, record_data: object, status: string }>>}
   */
  async function fetchSupabaseRecords() {
    const sb = getSupabase();
    if (!sb) return [];

    try {
      const { data, error } = await sb
        .from(TABLE)
        .select('*')
        .order('record_date', { ascending: true });

      if (error || !data) {
        console.warn('[운영기록부] 전체 기록 조회 오류:', error);
        return [];
      }
      return data;
    } catch (err) {
      console.warn('[운영기록부] 전체 기록 조회 예외:', err);
      return [];
    }
  }

  // 전역 서비스 객체 등록 (이름은 예전 앱의 모듈들이 부르는 그대로 둔다)
  window.SupabaseService = {
    getSupabaseConfig,
    saveSupabaseConfig,
    initSupabaseClient,
    getSupabase,
    isSupabaseConfigured,
    canEdit,
    testSupabaseConnection,
    fetchSupabaseRecord,
    fetchSupabaseRecordByDate: fetchSupabaseRecord, // 별칭 등록
    saveSupabaseRecord,
    insertSupabaseRecordIfMissing,
    fetchSupabaseRecordDates,
    fetchSupabaseRecords
  };

})(window);
