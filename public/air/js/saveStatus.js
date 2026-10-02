import { saveStatusBadge, cloudStatusBadge } from './dom.js';

// 저장 상태 업데이트 헬퍼
export function markUnsaved() {
  saveStatusBadge.textContent = '수정됨 (저장 필요)';
  saveStatusBadge.className = 'status-badge status-unsaved';
  if (cloudStatusBadge) {
    cloudStatusBadge.textContent = '☁️ 수정중 (저장 시 클라우드 동기화)';
    cloudStatusBadge.style.background = '#64748b';
  }
}

export function markSaved(cloudSynced = true) {
  saveStatusBadge.textContent = '저장됨';
  saveStatusBadge.className = 'status-badge status-saved';
  if (cloudStatusBadge) {
    cloudStatusBadge.textContent = cloudSynced ? '☁️ 클라우드 영구보관 완료' : '☁️ 클라우드 동기화 대기';
    cloudStatusBadge.style.background = cloudSynced ? '#0284c7' : '#eab308';
  }
}
