// lucide 아이콘: 빌드 때는 소스에서 쓰는 아이콘만 들어간다 (vite.config.js의 lucideUsedIcons).
// 'lucide'에서 icons를 직접 import하면 전체 아이콘이 번들에 들어가므로 항상 이 파일을 쓴다.
import { createIcons } from 'lucide';
import usedIcons from 'virtual:lucide-used';

export const icons = usedIcons;
export { createIcons };
