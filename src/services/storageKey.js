// Supabase Storage 경로(키)에 쓸 파일 이름
// 저장소는 경로에 한글 등 ASCII 밖 글자가 있으면 400(Invalid key)으로 거절하므로 영문·숫자·._- 만 남긴다.
// 원래 파일 이름은 각 기능이 따로 보관한다(첨부 목록의 name). 예: '품질회의_2월.pptx' → '_2.pptx' 가 아니라 'file_2.pptx'
export const storageSafeName = (name) => {
    const s = String(name || 'file');
    const m = s.match(/(\.[A-Za-z0-9]{1,8})$/);
    const ext = m ? m[1].toLowerCase() : '';
    const stem = (m ? s.slice(0, -m[1].length) : s)
        .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(-60);
    return `${/[A-Za-z0-9]/.test(stem) ? stem : 'file'}${ext}`;
};
/** 경로 한 칸(폴더 이름)용: 품목코드처럼 한글이 섞일 수 있는 값 */
export const storageSafeSegment = (v) => String(v || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'x';
