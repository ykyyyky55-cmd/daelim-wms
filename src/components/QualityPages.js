// 품질관리 메뉴 탭 → 화면 (main.js TAB_MODULES가 이 파일 하나를 불러온다)
import { renderQualityArea } from './quality/QualityDefects.js';
import { renderQualityEquipment } from './quality/QualityEquipment.js';
import { renderQualityMsds } from './quality/QualityMsds.js';

export const renderQcProduct = (container, opts) => renderQualityArea(container, { ...opts, area: 'PRODUCT' });
export const renderQcProcess = (container, opts) => renderQualityArea(container, { ...opts, area: 'PROCESS' });
export const renderQcMaterial = (container, opts) => renderQualityArea(container, { ...opts, area: 'MATERIAL' });
export const renderQcEquipment = (container, opts) => renderQualityEquipment(container, opts);
export const renderQcMsds = (container, opts) => renderQualityMsds(container, opts);
