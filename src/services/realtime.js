import { getSupabase } from './supabase.js';

let channel = null;
const listeners = new Set();

export const registerRealtimeListener = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

export const initRealtimeSubscription = (onNotification) => {
    const supabase = getSupabase();
    if (!supabase) return null;

    if (channel) {
        supabase.removeChannel(channel);
        channel = null;
    }

    try {
        channel = supabase
            .channel('wms-realtime-channel')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'wms_inventory' }, (payload) => {
                console.log('[Realtime] 재고 변동 감지:', payload);
                notifyListeners({ table: 'wms_inventory', eventType: payload.eventType, new: payload.new, old: payload.old });
                if (onNotification) {
                    onNotification(`📦 [실시간 재고 변동] 품목: ${payload.new?.code || payload.old?.code} (위치: ${payload.new?.location || payload.old?.location}) 수량: ${payload.new?.quantity ?? '-'}개`);
                }
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wms_history_logs' }, (payload) => {
                console.log('[Realtime] 신규 작업 이력 감지:', payload);
                notifyListeners({ table: 'wms_history_logs', eventType: 'INSERT', new: payload.new });
                if (onNotification) {
                    const typeKorean = { IN: '입고', OUT: '출고', USE: '생산투입', MOVE: '거점이동', AUDIT: '재고실사보정' }[payload.new.type] || payload.new.type;
                    onNotification(`🔔 [실시간 작업 반영] ${payload.new.worker}님이 ${payload.new.name}(${payload.new.code}) ${payload.new.qty}개 ${typeKorean} 처리 완료`);
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'wms_master_items' }, (payload) => {
                console.log('[Realtime] 품목 마스터 변동 감지:', payload);
                notifyListeners({ table: 'wms_master_items', eventType: payload.eventType, new: payload.new, old: payload.old });
            })
            .subscribe((status) => {
                console.log('[Realtime] 구독 상태:', status);
            });

        return channel;
    } catch (err) {
        console.error('[Realtime] 구독 설정 실패:', err);
        return null;
    }
};

const notifyListeners = (event) => {
    listeners.forEach((listener) => {
        try {
            listener(event);
        } catch (e) {
            console.error('[Realtime] 리스너 호출 오류:', e);
        }
    });
};
