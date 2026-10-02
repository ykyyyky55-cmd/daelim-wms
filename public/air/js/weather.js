import { btnFetchWeather, weatherSelect, tempRangeInput } from './dom.js';
import { markUnsaved } from './saveStatus.js';

// ============================================================
// 김포시 월곶면 날씨 연동 함수 (로컬 서버 및 웹 직접 연동 지원)
// ============================================================
export async function fetchWolgotWeather(targetDate) {
  btnFetchWeather.disabled = true;
  btnFetchWeather.innerHTML = '⏳ 날씨 조회 중...';

  try {
    let weather = '';
    let tempStr = '';

    // 1. 로컬 백엔드 API 우선 호출 시도
    try {
      const res = await fetch(`/api/weather?date=${targetDate}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          weather = data.weather || '맑음';
          tempStr = data.tempStr || `${data.minTemp} ~ ${data.maxTemp}℃`;
        }
      }
    } catch (e) {
      // 로컬 서버가 없는 웹 환경(GitHub Pages 등)에서는 브라우저 직접 조회로 전환
    }

    // 2. 백엔드 응답이 없는 경우 Open-Meteo API 브라우저 직접 호출
    if (!weather) {
      const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=37.6975&longitude=126.5413&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&start_date=${targetDate}&end_date=${targetDate}`;
      const mRes = await fetch(openMeteoUrl);
      if (mRes.ok) {
        const mData = await mRes.json();
        if (mData.daily && mData.daily.weathercode && mData.daily.weathercode.length > 0) {
          const wCode = mData.daily.weathercode[0];
          const maxT = Math.round(mData.daily.temperature_2m_max[0]);
          const minT = Math.round(mData.daily.temperature_2m_min[0]);
          
          // WMO 날씨 코드 한글 변환
          if (wCode === 0) weather = '맑음';
          else if ([1, 2].includes(wCode)) weather = '구름조금';
          else if ([3, 45, 48].includes(wCode)) weather = '흐림';
          else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(wCode)) weather = '비';
          else if ([71, 73, 75, 85, 86].includes(wCode)) weather = '눈';
          else weather = '맑음';

          tempStr = `${minT} ~ ${maxT}℃`;
        }
      }
    }

    if (weather) {
      weatherSelect.value = weather;
      tempRangeInput.value = tempStr;
      markUnsaved();
    } else {
      alert('날씨 연동 안내: 날씨 정보를 불러오지 못했습니다.');
    }
  } catch (err) {
    console.error('날씨 조회 오류:', err);
    alert('날씨 정보를 불러오는 중 오류가 발생했습니다.');
  } finally {
    btnFetchWeather.disabled = false;
    btnFetchWeather.innerHTML = '<span style="font-size:1.1rem;">⛅</span> 월곶면 날씨 연동';
  }
}
