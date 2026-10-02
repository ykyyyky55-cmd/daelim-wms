// 영상 가이드 대본·장면 (scripts/make_video.mjs가 읽음)
// - say: 내레이션(= 자막). 한국어 신경망 음성(ko-KR-SunHiNeural)으로 읽는다.
// - show: 장면 그림들. 'v-…' = capture_manual.mjs(MANUAL_SET=video)가 찍은 화면, 'card:title|end', 'phone:<화면>', 'devices:<PC 화면>|<폰 화면>'
//   그림이 여러 개면 장면 길이를 나눠 차례로 보여 준다(겹쳐 바뀜).
// 화면은 모두 가짜 예시 데이터로 채운 앱이다 (실제 업무 자료 없음).
export const VIDEOS = {
    intro: {
        file: 'intro', title: '대림오일 스마트 WMS 소개', desc: '생산·재고·수불·품질·결재까지 앱 전체를 짧게 소개합니다.',
        scenes: [
            { show: ['card:title'], say: '대림오일 스마트 WMS를 소개합니다.', caption: false },
            { show: ['v-home'], say: '생산, 재고, 수불, 품질, 결재까지. 흩어져 있던 공장 업무를 한 화면에서 관리합니다.' },
            { show: ['v-worklog', 'v-worklog-edit'], say: '본사와 김포의 매일 업무일지를 앱에서 작성하면, 지난 일지를 참고해 빠르게 채우고 버튼 한 번으로 재고와 수불부에 반영됩니다.' },
            { show: ['phone:v-scan-mobile', 'v-production'], say: '현장에서는 스마트폰으로 QR을 찍어 입고, 출고, 이동, 생산 실적을 바로 기록합니다.' },
            { show: ['v-raw-ledger', 'v-inventory'], say: '원료, 제품, 자재 수불부가 자동으로 쌓이고, 창고별 재고를 실시간으로 확인합니다.' },
            { show: ['v-prod-plan', 'v-slip'], say: '생산계획과 구매계획, 생산요청서와 출하 전표까지 주문의 흐름을 한 번에 이어 줍니다.' },
            { show: ['v-analytics', 'v-qc-monthly'], say: '월간 실적과 불량률은 현황판으로 모아 보고, 회의 자료도 앱에서 바로 만듭니다.' },
            { show: ['v-e-approval', 'v-chat'], say: '전자결재와 담당자 알림, 사내 채팅으로 종이 없이 보고하고 확인합니다.' },
            { show: ['devices:v-home|v-scan-mobile'], say: 'PC, 스마트폰, 태블릿 어디서나 설치해 쓸 수 있습니다.' },
            { show: ['card:end'], say: '대림오일 스마트 WMS. 현장의 일을 더 쉽고 정확하게.', caption: false }
        ]
    },
    'guide-worklog': {
        file: 'guide-worklog', title: '업무일지 작성', sub: '본사 · 김포 생산공급망 일일 업무일지', desc: '일지 입력, 지난 일지 참조, 수불부 반영, 인쇄·시트 보내기',
        scenes: [
            { show: ['card:guide'], say: '업무일지 작성 방법을 알아보겠습니다.', caption: false },
            { show: ['v-worklog'], say: '상단 메뉴 생산업무에서 업무일지 본사 또는 김포를 엽니다. 작업 일자를 고르거나, 새 일자 일지 버튼으로 오늘 일지를 만듭니다.' },
            { show: ['v-wl-expand'], say: '일지는 제품포장, 원액생산, 라벨부착, 이동제품, 입고와 출고, 택배, 기타업무의 일곱 항목입니다. 탭으로 하나씩 보거나, 전체 펼치기로 한 화면에서 봅니다.' },
            { show: ['v-worklog-edit'], say: '항목마다 추가 버튼을 누르면 입력 창이 열립니다. 지난 일지에 있던 품명을 고르면 규격, 라인, 카테고리가 채워지고, 시간과 인원을 넣으면 공수가 자동으로 계산됩니다.' },
            { show: ['v-wl-copy'], say: '매일 반복되는 기타업무나 이동은 지난 일지 참조로 한꺼번에 가져옵니다. 가져온 뒤 연필 버튼으로 수량만 고치면 됩니다.' },
            { show: ['v-worklog'], say: '다 적었으면 일지 저장을 누르고, WMS 재고 및 수불부 자동 반영 버튼으로 포장, 원액, 이동, 입출고 실적을 재고와 수불부에 올립니다. 반영한 일지는 초록색으로 표시됩니다.' },
            { show: ['v-wl-print'], say: '공식 A4 일지 인쇄로 결재란이 있는 양식을 출력하고, 구글 시트로 보내기로 회사 업무일지 시트에도 날짜 탭을 만들어 넣을 수 있습니다.' },
            { show: ['v-wl-upload'], say: '예전 엑셀이나 구글 시트 일지는 파일 업로드로 날짜별로 한 번에 가져옵니다.' },
            { show: ['card:end'], say: '업무일지를 매일 작성하면 실적과 재고가 자동으로 정리됩니다.', caption: false }
        ]
    },
    'guide-scan': {
        file: 'guide-scan', title: '생산입고 · 현장 스캔', sub: 'QR로 입고 · 출고 · 이동 · 생산 기록', desc: '제품생산/입고, 스마트폰 QR 스캔, 위치·출하 검수, 라인 집계, QR 인쇄',
        scenes: [
            { show: ['card:guide'], say: '생산입고와 현장 스캔 사용법을 알아보겠습니다.', caption: false },
            { show: ['v-production'], say: '제품생산 입고는 본사와 김포 메뉴가 따로 있습니다. 만든 곳의 메뉴에서 제품과 수량, LOT 번호를 넣으면 그 거점 창고에 입고되고, 투입한 원료와 부자재는 포장사용기준서대로 자동 차감됩니다.' },
            { show: ['phone:v-scan-mobile'], say: '현장에서는 스마트폰으로 현장 스캔을 엽니다. 품목 QR을 찍고 입고, 출고, 사용, 이동 가운데 작업을 골라 수량만 넣으면 기록됩니다.' },
            { show: ['v-scan-location'], say: '창고 위치 QR을 찍으면 그 위치의 재고가 보이고, 그 자리에서 입출고나 재고실사를 바로 할 수 있습니다.' },
            { show: ['v-scan-slip'], say: '출하할 때는 전표 QR을 찍은 뒤 제품 QR을 하나씩 찍어 전표와 맞는지 확인합니다. 모자라거나 전표에 없는 제품은 바로 알려 줍니다.' },
            { show: ['v-line-count'], say: '포장 라인에서는 라인 스캔 집계로 제품 바코드를 찍은 개수를 세고, 그대로 생산 실적으로 올립니다.' },
            { show: ['v-field-qr', 'v-qr-store'], say: '위치, 탱크, 사원증 QR과 품목별 작업 QR은 라벨 메뉴에서 폼텍 용지에 맞춰 인쇄합니다.' },
            { show: ['v-inventory'], say: '스캔한 기록은 창고 재고와 수불부에 바로 반영됩니다.' },
            { show: ['card:end'], say: 'QR 한 번으로 현장 기록을 빠르고 정확하게.', caption: false }
        ]
    },
    'guide-order': {
        file: 'guide-order', title: '전표 · 주문 · 출하', sub: '생산요청부터 출하 검수까지', desc: '주문관리, 생산요청서, 생산계획·스케줄, 전표 발행·관리, 출하 검수',
        scenes: [
            { show: ['card:guide'], say: '주문부터 출하까지의 흐름을 알아보겠습니다.', caption: false },
            { show: ['v-order-board'], say: '주문관리 현황에서는 주문마다 요청, 계획, 생산, 출하 단계가 어디까지 왔는지 한눈에 봅니다.' },
            { show: ['v-prod-request'], say: '영업이나 현장에서 생산요청서를 작성하면 요청서 번호가 붙고, 담당자에게 할일과 알림이 갑니다.' },
            { show: ['v-prod-plan'], say: '요청서는 주간 생산계획에 자동으로 반영되고, 부족한 원료와 부자재는 구매계획으로 이어집니다.' },
            { show: ['v-prod-schedule'], say: '생산 포장 스케줄에서는 작성일자별로 주문의 포장 계획과 원부자재 준비 상태를 관리합니다.' },
            { show: ['v-slip'], say: '출고할 때는 전표발행에서 출고요청서나 이동전표를 만듭니다. 품목과 수량, 출고 시간과 담당자를 넣고 발행합니다.' },
            { show: ['v-slip-print'], say: '전표는 받는 곳과 보내는 곳 보관용 두 장으로 인쇄되고, 출하 검수용 QR과 결재란이 들어갑니다.' },
            { show: ['v-slip-manage', 'v-scan-slip'], say: '발행한 전표는 전표관리에서 찾고 다시 인쇄합니다. 출하 때 QR로 검수하면 출고 완료와 재고 차감이 함께 처리됩니다.' },
            { show: ['card:end'], say: '요청부터 출하까지 한 흐름으로 이어집니다.', caption: false }
        ]
    },
    'guide-board': {
        file: 'guide-board', title: '현황판 · 품질 · 결재', sub: '실적 확인 · 품질 기록 · 전자결재', desc: '종합현황판, 월간 실적, 월례회의 자료, 품질관리, 품질회의, 전자결재',
        scenes: [
            { show: ['card:guide'], say: '현황판과 품질관리, 전자결재 사용법을 알아보겠습니다.', caption: false },
            { show: ['v-overview'], say: '종합현황판은 생산, 원료 입고, 주문, 품질, 재고, 일정을 한 화면에 모으고, 먼저 확인할 일을 알려 줍니다.' },
            { show: ['v-analytics'], say: '월간 실적 현황판에서는 업무일지를 모아 월별 포장, 원액, 공수와 생산성을 그래프로 봅니다.' },
            { show: ['v-meeting-dialog'], say: '월례회의 자료 버튼을 누르면 실적과 계획을 모은 발표 자료와 PDF 보고서가 자동으로 만들어집니다.' },
            { show: ['v-qc-records'], say: '품질관리에서는 제품, 공정, 원부자재 검사 결과와 불량 수량을 기록합니다.' },
            { show: ['v-qc-monthly', 'v-quality-meeting'], say: '월간 불량률 현황으로 추이와 원인을 보고, 품질회의 메뉴에는 달마다 회의 자료를 올려 함께 봅니다.' },
            { show: ['v-approval-box'], say: '계획서, 전표, 일지, 보고서에는 결재 칸이 있습니다. 빈 칸을 누르면 내 전자서명이 들어가고, 수신과 참조, 첨부도 붙일 수 있습니다.' },
            { show: ['v-e-approval'], say: '전자결재 메뉴에서 내 서명을 관리하고, 결재할 문서와 받은 문서를 모아 봅니다.' },
            { show: ['card:end'], say: '숫자로 보고, 종이 없이 결재합니다.', caption: false }
        ]
    }
};
