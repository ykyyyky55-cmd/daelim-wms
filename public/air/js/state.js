// 편집 화면의 공유 가변 상태
// ES 모듈의 import 바인딩은 재할당할 수 없으므로 한 객체의 속성으로 보관한다.
export const state = {
  // 작업시간
  currentWorkHours: '09:00 ~ 18:00',

  // 전자결재 서명 상태 (Base64 이미지 문자열)
  currentManagerSign: '',
  currentTechnicianSign: '',

  // 1. 배출구 기본 목록 (1~4번 혼합시설, 평일 미가동 기본 적용)
  currentExhaustList: [
    { id: '1', facility: '혼합시설', opTime: '-', note: '미가동' },
    { id: '2', facility: '혼합시설', opTime: '-', note: '미가동' },
    { id: '3', facility: '혼합시설', opTime: '-', note: '미가동' },
    { id: '4', facility: '혼합시설', opTime: '-', note: '미가동' }
  ],

  // 2. 방지시설 운전사항 데이터 목록 (기본 '면제'로 설정)
  isPreventionExempt: true,
  currentPreventionOpRows: [
    {
      facility: '여과집진시설',
      location: '옥외',
      power: '15',
      capacity: '120',
      pollutant: '입자상물질(먼지)',
      density: '20',
      efficiency: '95',
      chemName: '-',
      chemAmount: '-'
    }
  ],

  // 3. 방지시설 보수사항 데이터 목록
  currentMaintenanceRows: [
    {
      facility: '-',
      exhaustNo: '-',
      period: '-',
      worker: '-',
      details: '특이사항 없음'
    }
  ],

  // 4. 자가측정사항 결과 데이터 목록 (기본 빈칸 설정)
  currentMeasurementRows: [
    {
      exhaustNo: '',
      facilityName: '',
      item: '',
      density: '',
      dailyFlow: '',
      dailyEmission: '',
      device: '',
      method: ''
    }
  ],
};
