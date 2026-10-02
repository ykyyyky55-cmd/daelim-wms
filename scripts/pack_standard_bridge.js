/* 대림 스마트 WMS 연동: 이 편집기는 WMS의 생산업무 → 포장작업표준서 화면(iframe) 안에서만 쓴다.
   저장소·권한은 부모 창의 window.__packStdBridge (src/components/PackStandard.js)가 준다. */
(function () {
    var bridge = null;
    try { bridge = window.parent !== window ? window.parent.__packStdBridge : null; } catch (e) { bridge = null; }

    if (!bridge) {
        // 단독으로 열면 아무것도 저장·표시하지 않는다 (문서는 로그인한 사람만)
        window.addEventListener('DOMContentLoaded', function () {
            document.body.className = '';
            document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;background:#f1f5f9">' +
                '<div style="background:#fff;padding:32px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,.08);text-align:center;max-width:420px">' +
                '<div style="font-size:40px">📘</div><h2 style="margin:8px 0">포장작업표준서</h2>' +
                '<p style="color:#475569;font-size:14px;line-height:1.6">대림 스마트 WMS에 로그인한 뒤<br><b>생산업무 → 포장작업표준서</b>에서 엽니다.</p>' +
                '<a href="../#packStandard" style="display:inline-block;margin-top:12px;background:#2563eb;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">WMS 열기</a></div></div>';
        });
        return;
    }

    // ---------- 화면 모드(라이트·다크·눈 편한 모드): WMS(부모 창)를 따라간다 ----------
    // 종이(A4 양식 #a4Container)와 엑셀·구글 시트 보기 창은 문서 그대로 보여야 하므로 밝게 둔다.
    // 그래서 <html>이 아니라 종이 밖의 영역(머리글·도구 줄, 창)에만 data-theme를 붙인다 — WMS의 다크 보정 CSS
    // (부모 창의 style#dark-theme-extra: [data-theme="dark"] 아래의 Tailwind 색 클래스를 덮어씀)를 그대로 가져와 쓴다.
    var PAPER_LIKE_MODALS = ['excelViewerModal', 'gsheetViewerModal', 'imageZoomModal'];
    var themedElements = function () {
        var list = Array.prototype.slice.call(document.querySelectorAll('#appView > header, body > div.fixed'));
        return list.filter(function (el) { return el.id !== 'homeScreen' && el.id !== 'toast' && PAPER_LIKE_MODALS.indexOf(el.id) < 0; });
    };
    var parentTheme = function () {
        try { return window.parent.document.documentElement.getAttribute('data-theme') || 'light'; } catch (e) { return 'light'; }
    };
    var applyTheme = function () {
        var theme = parentTheme();
        document.body.setAttribute('data-pack-theme', theme);
        themedElements().forEach(function (el) { el.setAttribute('data-theme', theme); });
    };
    var installTheme = function () {
        var css = '';
        try {
            var extra = window.parent.document.getElementById('dark-theme-extra');
            css = extra ? extra.textContent : '';
        } catch (e) { css = ''; }
        var style = document.createElement('style');
        style.id = 'wms-theme';
        style.textContent = css + '\n' + [
            // 다크: data-theme가 붙은 요소 자신(머리글)과 종이 바깥 바탕, 입력 칸
            'body[data-pack-theme="dark"] #appView > header{background-color:#131b2e !important;border-color:#243048 !important;color:#f1f5f9}',
            'body[data-pack-theme="dark"] #appView > main{background-color:#0b0f19 !important}',
            '[data-theme="dark"] input:not([type="checkbox"]):not([type="radio"]),[data-theme="dark"] select,[data-theme="dark"] textarea{background-color:#1e293b !important;border-color:#334155 !important;color:#f8fafc !important}',
            // 눈 편한 모드
            'body[data-pack-theme="warm"] #appView > header{background-color:#fdfbf7 !important;border-color:#e8e0d1 !important}',
            'body[data-pack-theme="warm"] #appView > main{background-color:#f6f1e8 !important}',
            '[data-theme="warm"] [class~="bg-white"]{background-color:#fdfbf7 !important;border-color:#e8e0d1 !important}',
            '[data-theme="warm"] [class~="bg-slate-50"],[data-theme="warm"] [class~="bg-slate-100"]{background-color:#efe8da !important;border-color:#e2d8c3 !important}',
            '[data-theme="warm"] [class~="border-slate-100"],[data-theme="warm"] [class~="border-slate-200"],[data-theme="warm"] [class~="border-slate-300"]{border-color:#e5dbc8 !important}',
            '[data-theme="warm"] input:not([type="checkbox"]):not([type="radio"]),[data-theme="warm"] select,[data-theme="warm"] textarea{background-color:#fffefb !important;border-color:#d8cdb8 !important}'
        ].join('\n');
        document.head.appendChild(style);
        applyTheme();
        try {
            // WMS에서 화면 모드를 바꾸면 바로 따라간다
            new window.parent.MutationObserver(applyTheme).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        } catch (e) { /* 부모 창을 지켜보지 못하면 열 때의 모드로 둔다 */ }
        // 나중에 만들어지는 창(사진 찾기 등)에도 붙인다
        new MutationObserver(applyTheme).observe(document.body, { childList: true });
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', installTheme);
    else installTheme();

    var canEdit = !!bridge.canEdit;
    var listCache = [];
    var toast = function (m) { try { showToast(m); } catch (e) { try { bridge.toast(m); } catch (e2) { /* 무시 */ } } };
    var currentId = function () { return new URLSearchParams(location.search).get('cloudId') || ''; };
    var setCurrentId = function (id) { try { history.replaceState({}, '', location.pathname + '?cloudId=' + encodeURIComponent(id)); } catch (e) { /* 무시 */ } };
    var cellText = function (id) { var el = document.getElementById(id); return el ? el.innerText.trim() : ''; };
    var snapshot = function () {
        var a4 = document.getElementById('a4Container'); var hs = document.getElementById('historyContainer');
        return { a4Html: a4 ? a4.innerHTML : '', historyHtml: hs ? hs.innerHTML : '' };
    };
    var copyText = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        var d = document.createElement('input'); document.body.appendChild(d); d.value = text; d.select(); document.execCommand('copy'); document.body.removeChild(d);
        return Promise.resolve();
    };

    // ---------- 권한: 비밀번호 대신 WMS 역할 ----------
    var origSetUserRole = window.setUserRole;
    window.setUserRole = function (role) { origSetUserRole(canEdit ? role : 'viewer'); };
    window.promptAdminFromHome = function () {
        if (!canEdit) { toast('표준서 편집은 자재 관리자 이상만 할 수 있습니다. (열람은 뷰어 모드)'); return; }
        var home = document.getElementById('homeScreen'); if (home) home.classList.add('hidden');
        window.setUserRole('admin');
    };
    window.openAdminModal = window.promptAdminFromHome;
    window.submitAdminLogin = window.promptAdminFromHome;
    window.openPwChangeModal = function () { toast('비밀번호 대신 WMS 계정 권한을 씁니다.'); };
    window.logoutAdmin = function () { window.setUserRole('viewer'); toast('뷰어 모드로 바꿨습니다.'); };

    // ---------- 저장소: WMS DB ----------
    window.getCloudDocs = function () { return listCache; };
    window.setCloudDocs = function () { /* 저장은 bridge.save로 */ };
    var reloadList = function () {
        return bridge.list().then(function (l) { listCache = l || []; }).catch(function (e) { toast(e.message); })
            .then(function () { try { refreshCloudDocList(); } catch (e) { /* 목록 창이 없음 */ } });
    };

    var saveDoc = function (productName, category, buyer) {
        if (!canEdit) { toast('표준서 저장은 자재 관리자 이상만 할 수 있습니다.'); return Promise.resolve(null); }
        var same = listCache.find(function (d) { return d.product === productName && d.category === category; });
        var id = same ? same.id : ('doc_' + Date.now());
        return bridge.save({ id: id, title: productName, product: productName, buyer: buyer, category: category, content: snapshot() })
            .then(function (saved) { setCurrentId(id); updateQRCode(); return reloadList().then(function () { return saved; }); })
            .catch(function (e) { toast(e.message); return null; });
    };

    window.quickSaveToCloud = function () {
        var productName = cellText('cell_product');
        if (!productName) { toast('제품명 칸을 먼저 채워 주세요.'); return; }
        var category = cellText('cell_category') || '기타';
        saveDoc(productName, category, cellText('cell_buyer')).then(function (s) { if (s) toast('☁️ [' + productName + '] 회사 저장소에 저장했습니다.'); });
    };

    window.saveCurrentDocToCloud = function () {
        var titleInput = document.getElementById('cloudSaveDocTitle');
        var catSelect = document.getElementById('cloudSaveDocCategory');
        var productName = (titleInput ? titleInput.value.trim() : '') || cellText('cell_product');
        if (!productName) { toast('저장할 제품명을 입력해 주세요.'); if (titleInput) titleInput.focus(); return; }
        var category = catSelect ? catSelect.value : '기타';
        var prodCell = document.getElementById('cell_product'); if (prodCell) prodCell.innerText = productName;
        var catCell = document.getElementById('cell_category'); if (catCell) catCell.innerText = category;
        saveDoc(productName, category, cellText('cell_buyer')).then(function (s) { if (s) toast('☁️ [' + category + '] ' + productName + ' 표준서를 저장했습니다.'); });
    };

    window.loadDocFromCloud = function (docId, autoCloseModal) {
        if (autoCloseModal === undefined) autoCloseModal = true;
        return bridge.get(docId).then(function (target) {
            if (!target || !target.content) { toast('표준서를 찾을 수 없습니다 (삭제되었거나 권한이 없음).'); return; }
            var home = document.getElementById('homeScreen'); if (home) home.classList.add('hidden');
            saveState();
            var a4 = document.getElementById('a4Container');
            if (target.content.a4Html && a4) a4.innerHTML = target.content.a4Html;
            // 변경이력 표는 A4 영역 안에 있어 A4를 바꾸면 새로 생긴다 → A4를 바꾼 뒤에 찾는다 (원래 코드는 바뀌기 전 칸을 잡아 이력이 안 들어감)
            var hs = document.getElementById('historyContainer');
            if (target.content.historyHtml && hs) hs.innerHTML = target.content.historyHtml;
            rebindEvents(); initTableResizing();
            setCurrentId(docId); updateQRCode(); updateEmptyImageVisibility(); window.setUserRole(userRole);
            if (autoCloseModal) closeCloudModal();
            toast('📂 [' + (target.product || target.title) + '] 표준서를 불러왔습니다.');
        }).catch(function (e) { toast(e.message); });
    };

    window.deleteCloudDoc = function (docId) {
        if (!canEdit) { toast('표준서 삭제는 자재 관리자 이상만 할 수 있습니다.'); return; }
        var d = listCache.find(function (x) { return x.id === docId; });
        if (!confirm('[' + (d ? d.product : docId) + '] 표준서를 삭제할까요? 되돌릴 수 없습니다.')) return;
        bridge.remove(docId).then(function () { toast('표준서를 삭제했습니다.'); return reloadList(); }).catch(function (e) { toast(e.message); });
    };

    window.copyCloudDocUrl = function (docId) {
        copyText(bridge.link(docId)).then(function () { toast('📋 표준서 링크를 복사했습니다 (WMS 로그인 후 열림).'); });
    };

    // QR: WMS 주소로 (로그인한 사람만 열람)
    window.updateQRCode = function () {
        currentQRTargetUrl = bridge.link(currentId());
        var container = document.getElementById('documentQRCode');
        if (container) {
            container.innerHTML = '';
            try {
                if (typeof QRCode !== 'undefined') {
                    docQRInstance = new QRCode(container, { text: currentQRTargetUrl, width: 64, height: 64, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
                }
            } catch (e) { /* 무시 */ }
        }
        var urlDisplay = document.getElementById('qrUrlDisplay'); if (urlDisplay) urlDisplay.value = currentQRTargetUrl;
    };

    // 전체 백업: 목록의 모든 문서 내용을 받아 한 파일로
    window.backupAllCloudDocsToFile = function () {
        if (!listCache.length) { toast('백업할 작업표준서가 없습니다.'); return; }
        toast('표준서 ' + listCache.length + '건을 모으는 중…');
        Promise.all(listCache.map(function (m) { return bridge.get(m.id).then(function (d) { return d ? Object.assign({}, m, { content: d.content }) : null; }).catch(function () { return null; }); }))
            .then(function (docs) {
                docs = docs.filter(Boolean);
                var now = new Date(); var p = function (n) { return String(n).padStart(2, '0'); };
                var stamp = now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '_' + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
                var pkg = { service: 'DAELIM_SPEC_STUDIO', backupType: 'ALL_CLOUD_DOCUMENTS', version: '2.6-wms', exportedAt: now.toISOString(), totalCount: docs.length, documents: docs };
                var url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json;charset=utf-8' }));
                var a = document.createElement('a'); a.href = url; a.download = 'DAELIM_SPEC_ALL_BACKUP_' + stamp + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                toast('📦 [총 ' + docs.length + '건] 전체 백업 파일을 저장했습니다.');
            });
    };

    // 백업 파일 복원 (예전 단독 편집기에서 받은 전체 백업도 이 방법으로 회사 저장소에 옮긴다)
    window.restoreCloudDocsFromFile = function (event) {
        var file = event.target.files[0]; if (!file) return;
        if (!canEdit) { toast('복원은 자재 관리자 이상만 할 수 있습니다.'); event.target.value = ''; return; }
        var reader = new FileReader();
        reader.onload = function (e) {
            var incoming = [];
            try {
                var parsed = JSON.parse(e.target.result);
                if (parsed.backupType === 'ALL_CLOUD_DOCUMENTS' && Array.isArray(parsed.documents)) incoming = parsed.documents;
                else if (Array.isArray(parsed)) incoming = parsed;
                else if (parsed.id && (parsed.title || parsed.product)) incoming = [parsed];
            } catch (err) { toast('백업 파일 형식이 올바르지 않습니다.'); event.target.value = ''; return; }
            incoming = incoming.filter(function (d) { return d && d.id && (d.product || d.title) && d.content && d.content.a4Html; });
            if (!incoming.length) { toast('내용이 있는 표준서가 없습니다.'); event.target.value = ''; return; }
            var ok = 0, fail = 0;
            incoming.reduce(function (p, d) {
                return p.then(function () {
                    return bridge.save({ id: String(d.id), title: d.title || d.product, product: d.product || d.title, buyer: d.buyer || '', category: d.category || '', content: d.content })
                        .then(function () { ok++; }).catch(function () { fail++; });
                });
            }, Promise.resolve()).then(function () {
                toast('🎉 복원 완료: ' + ok + '건' + (fail ? ' (실패 ' + fail + '건)' : ''));
                event.target.value = '';
                return reloadList();
            });
        };
        reader.readAsText(file);
    };

    // 큰 사진은 긴 변 1400px JPEG로 줄인다 (표준서 한 건이 DB에 통째로 저장되므로)
    var shrink = function (img) {
        var s = img.getAttribute('src') || '';
        if (s.indexOf('data:image/') !== 0 || s.indexOf('data:image/svg') === 0 || s.length < 400000) return;
        if (img.dataset.shrinking || img.dataset.shrunk === String(s.length)) return;
        img.dataset.shrinking = '1';
        var im = new Image();
        im.onload = function () {
            var r = Math.min(1, 1400 / Math.max(im.width, im.height));
            var c = document.createElement('canvas'); c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
            var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
            var out = c.toDataURL('image/jpeg', 0.82);
            delete img.dataset.shrinking;
            if (out.length < s.length) { img.dataset.shrunk = String(out.length); img.setAttribute('src', out); } else { img.dataset.shrunk = String(s.length); }
        };
        im.onerror = function () { delete img.dataset.shrinking; };
        im.src = s;
    };
    window.addEventListener('DOMContentLoaded', function () {
        new MutationObserver(function (ms) {
            ms.forEach(function (m) {
                if (m.type === 'attributes' && m.target.tagName === 'IMG') shrink(m.target);
                (m.addedNodes || []).forEach(function (n) { if (n.tagName === 'IMG') shrink(n); else if (n.querySelectorAll) n.querySelectorAll('img').forEach(shrink); });
            });
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['src'], childList: true });
        reloadList();
    });
})();

/* 엑셀·구글 시트를 불러오면 시트에 놓인 사진을 표준서의 사진 칸에 엑셀과 같은 자리로 넣는다.
   · 엑셀(.xlsx) 안의 그림 자리(xl/drawings의 anchor — 시트별 행·열·칸 안 위치)를 읽는다.
   · 아래쪽 사진('[완성 제품 및 부자재 이미지]' 줄 아래, 없으면 본문 1~10번 표 아래): 왼쪽부터 용기 → 라벨 → 인박스 → 아웃박스.
     본문에 '없음'이라고 적힌 칸(예: '5. 인박스: 없음')은 건너뛰고, 사진 바로 위에 이름이 적혀 있으면('용기 & 라벨 & 아웃박스' 한 줄, 또는 사진마다 한 칸) 그 이름을 따른다.
   · 본문 표 오른쪽의 사진: 위에 적힌 제목(식별 스티커 / 파렛트 적재 방법)으로 스티커·파렛트 칸에 넣는다.
   · 그 밖의 사진(위쪽 로고·도장, 자리를 정하지 못한 사진)은 넣지 않고 이미지 목록에 남긴다.
   · 구글 시트는 CSV 대신 xlsx로 받아(사진이 함께 온다) 같은 방법으로 처리한다. 셀 안에 넣은 그림(셀에 삽입)은 xlsx에 실리지 않아 옮기지 못한다. */
(function () {
    var ZONES = [
        ['bottleImg', /용기|BOTTLE|보틀/i], ['labelImg', /라벨|LABEL/i], ['innerBoxImg', /인\s*박스|INNER/i],
        ['outterBoxImg', /아웃\s*박스|OUTT?ER|외박스|카톤/i], ['palletImg', /파렛트|팔레트|파레트|PALLET|적재/i], ['stickerImg', /스티커|STICKER|식별/i]
    ];
    var ITEM_NO = /^\s*(10|[1-9])\s*[.)]/; // 본문 표의 '1.' ~ '10.' 항목 이름
    var REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
    var parseXml = function (text) { return new DOMParser().parseFromString(text, 'application/xml'); };
    var byTag = function (node, name) { // 접두사(xdr:·a:)와 상관없이 이름으로 찾는다
        var out = [], all = node.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
        return out;
    };
    var relAttr = function (el, name) { return el.getAttribute('r:' + name) || el.getAttributeNS(REL_NS, name); };
    var resolvePath = function (base, target) { // base 파일 기준 상대 경로 → zip 안 경로
        if (target.charAt(0) === '/') return target.slice(1);
        var parts = base.split('/'); parts.pop();
        target.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
        return parts.join('/');
    };
    var relsOf = async function (zip, file) { // 그 파일의 관계 목록 { rId: 대상 경로 }
        var i = file.lastIndexOf('/'), relFile = zip.file(file.slice(0, i) + '/_rels/' + file.slice(i + 1) + '.rels');
        var map = {};
        if (!relFile) return map;
        byTag(parseXml(await relFile.async('string')), 'Relationship').forEach(function (r) { map[r.getAttribute('Id')] = resolvePath(file, r.getAttribute('Target')); });
        return map;
    };

    /** 시트 이름 → 그 시트에 놓인 사진 [{ src, name, row, col, col2 }] (행·열은 0부터) */
    var readSheetImages = async function (zip) {
        var result = {}, media = {};
        var wbFile = zip.file('xl/workbook.xml');
        if (!wbFile) return result;
        var wbRels = await relsOf(zip, 'xl/workbook.xml');
        var sheets = byTag(parseXml(await wbFile.async('string')), 'sheet');
        var num = function (node, tag) { var el = node && byTag(node, tag)[0]; return el ? Number(el.textContent) || 0 : 0; };
        for (var s = 0; s < sheets.length; s++) {
            var name = sheets[s].getAttribute('name'), sheetPath = wbRels[relAttr(sheets[s], 'id')];
            result[name] = [];
            if (!sheetPath || !zip.file(sheetPath)) continue;
            var sheetRels = await relsOf(zip, sheetPath);
            var drawings = Object.keys(sheetRels).map(function (k) { return sheetRels[k]; }).filter(function (p) { return /drawings\/drawing[^/]*\.xml$/.test(p); });
            for (var d = 0; d < drawings.length; d++) {
                if (!zip.file(drawings[d])) continue;
                var dRels = await relsOf(zip, drawings[d]);
                var doc = parseXml(await zip.file(drawings[d]).async('string'));
                var anchors = byTag(doc, 'twoCellAnchor').concat(byTag(doc, 'oneCellAnchor'));
                for (var a = 0; a < anchors.length; a++) {
                    var blip = byTag(anchors[a], 'blip')[0], from = byTag(anchors[a], 'from')[0], to = byTag(anchors[a], 'to')[0];
                    if (!blip || !from) continue;
                    var target = dRels[relAttr(blip, 'embed')];
                    var ext = String(target || '').split('.').pop().toLowerCase();
                    if (!target || !zip.file(target) || !MIME[ext]) continue;
                    if (!media[target]) media[target] = 'data:' + MIME[ext] + ';base64,' + await zip.file(target).async('base64');
                    // x·y = 열·행 번호 + 칸 안에서 밀린 만큼(EMU, 한 칸을 넘지 않게 0~0.99로) — 같은 칸에서 시작한 사진끼리도 엑셀에 보이는 순서대로
                    var off = function (tag) { return Math.min(0.99, num(from, tag) / 3000000); };
                    result[name].push({ src: media[target], name: target.split('/').pop(), row: num(from, 'row'), col: num(from, 'col'), col2: to ? num(to, 'col') : num(from, 'col'), x: num(from, 'col') + off('colOff'), y: num(from, 'row') + off('rowOff') });
                }
            }
            result[name].sort(function (x, y) { return x.row - y.row || x.col - y.col; });
        }
        return result;
    };

    var zoneNamesIn = function (text) { // 글자에 들어 있는 사진 칸들 (글자에 나온 순서대로)
        var hits = [];
        ZONES.forEach(function (z) { var m = z[1].exec(text); if (m) hits.push([m.index, z[0]]); });
        return hits.sort(function (x, y) { return x[0] - y[0]; }).map(function (h) { return h[1]; });
    };
    var BOTTOM_ZONES = ['bottleImg', 'labelImg', 'innerBoxImg', 'outterBoxImg'];
    var ALL_ZONES = ['stickerImg', 'palletImg'].concat(BOTTOM_ZONES);
    var NONE_TEXT = /^\s*(없음|無|해당\s*없음|미사용|N\s*\/?\s*A|X|-+)\s*$/i; // 본문에 '쓰지 않음'으로 적은 칸
    var IMAGE_TITLE = /이미지|사진|IMAGE|PHOTO/i; // '[완성 제품 및 부자재 이미지]' 제목 줄
    var EMPTY_SRC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>";

    /**
     * 그 시트의 사진이 들어갈 칸을 정한다 (화면을 바꾸지 않는 계산만).
     * @param {Array<{row:number,col:number,col2:number,x:number,y:number}>} images 시트에 놓인 사진
     * @param {function(number, number): string} cellText (행, 열) → 글자
     * @param {{s:{r:number,c:number}, e:{r:number,c:number}}} range 시트 범위
     * @returns {Object<string, Object>} 사진 칸 id → 사진
     */
    var planSheetImages = function (images, cellText, range) {
        var lastRow = Math.min(range.e.r, range.s.r + 300), lastCol = Math.min(range.e.c, range.s.c + 60);
        // 본문 표: '1.' ~ '10.' 항목 이름이 있는 줄과 그 열, 항목마다 적힌 값
        var bodyStart = -1, bodyEnd = -1, itemCol = range.s.c, noneZones = {};
        for (var r = range.s.r; r <= lastRow; r++) {
            for (var c = range.s.c; c <= Math.min(lastCol, range.s.c + 3); c++) {
                var label = cellText(r, c);
                if (!ITEM_NO.test(label)) continue;
                if (bodyStart < 0) { bodyStart = r; itemCol = c; }
                bodyEnd = Math.max(bodyEnd, r);
                var names = zoneNamesIn(label);
                if (names.length === 1 && NONE_TEXT.test(cellText(r, c + 1))) noneZones[names[0]] = true;
                break;
            }
        }
        // 사진 영역이 시작하는 줄: 본문 표 아래의 '… 이미지' 제목 줄, 없으면 본문 표 바로 아래
        var sectionRow = bodyEnd + 1;
        for (var r2 = bodyEnd + 1; r2 <= Math.min(lastRow, bodyEnd + 6); r2++) {
            var title = '';
            for (var c2 = range.s.c; c2 <= lastCol; c2++) title += cellText(r2, c2);
            if (IMAGE_TITLE.test(title) && !zoneNamesIn(title).length) { sectionRow = r2; break; }
        }
        var picked = {};
        var bottom = images.filter(function (im) { return im.row >= sectionRow; }).sort(function (a, b) { return a.x - b.x || a.y - b.y; });
        var side = images.filter(function (im) { return im.row < sectionRow && im.row >= bodyStart && bodyStart >= 0 && im.col >= itemCol + 2; });

        // 본문 표 오른쪽 사진: 위로 올라가며 겹치는 열의 제목(식별 스티커 / 파렛트 적재)을 찾는다 — 항목 이름·값 열은 보지 않는다
        side.forEach(function (im) {
            for (var r = im.row; r >= Math.max(range.s.r, bodyStart - 1); r--) {
                for (var c = Math.max(itemCol + 2, im.col - 2); c <= Math.min(lastCol, im.col2 + 1); c++) {
                    var id = zoneNamesIn(cellText(r, c)).filter(function (n) { return n === 'stickerImg' || n === 'palletImg'; })[0];
                    if (!id) continue;
                    if (!picked[id]) picked[id] = im;
                    return;
                }
            }
        });

        // 아래쪽 사진 위에 적힌 이름: 제목 줄과 사진 사이의 글자
        var named = {}, wide = null; // named: 사진 번호 → 칸, wide: 한 칸에 여러 이름('용기 & 라벨 & 인박스 & 아웃박스')
        if (bottom.length) {
            var lowest = Math.max.apply(null, bottom.map(function (im) { return im.row; }));
            for (var r3 = sectionRow; r3 <= lowest; r3++) {
                for (var c3 = range.s.c; c3 <= lastCol; c3++) {
                    var found = zoneNamesIn(cellText(r3, c3)).filter(function (n) { return BOTTOM_ZONES.indexOf(n) >= 0; });
                    if (found.length > 1) { if (!wide || found.length > wide.length) wide = found; continue; }
                    if (found.length !== 1) continue;
                    bottom.forEach(function (im, i) { if (named[i] == null && im.row >= r3 && c3 >= im.col - 1 && c3 <= im.col2 + 1) named[i] = found[0]; });
                }
            }
        }
        var isAllNamed = bottom.length > 0 && bottom.every(function (im, i) { return named[i]; }) &&
            bottom.map(function (im, i) { return named[i]; }).filter(function (n, i, all) { return all.indexOf(n) === i; }).length === bottom.length;
        if (isAllNamed) {
            bottom.forEach(function (im, i) { picked[named[i]] = im; });
        } else {
            // 왼쪽부터 용기 → 라벨 → 인박스 → 아웃박스. 본문에 '없음'인 칸은 건너뛰되, 사진이 더 많으면 그 칸도 쓴다
            var order = (wide && wide.length >= bottom.length ? wide : BOTTOM_ZONES).filter(function (id) { return !noneZones[id]; });
            if (order.length < bottom.length) order = wide && wide.length >= bottom.length ? wide : BOTTOM_ZONES;
            bottom.forEach(function (im, i) { if (order[i]) picked[order[i]] = im; });
        }
        return picked;
    };

    /** 그 시트의 사진을 표준서 사진 칸에 넣는다(사진이 없는 칸은 비운다 — 앞에 불러온 시트의 사진이 남지 않게). 넣은 장수를 돌려준다 */
    var placeSheetImages = function (sheetName) {
        var images = (sheetToImagesMap && sheetToImagesMap[sheetName]) || [];
        var sheet = globalWorkbookData && globalWorkbookData.Sheets[sheetName];
        if (!images.length || !sheet || userRole !== 'admin') return 0;
        var range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        var cellText = function (r, c) { var cell = sheet[XLSX.utils.encode_cell({ r: r, c: c })]; return cell && cell.v != null ? String(cell.v) : ''; };
        var picked = planSheetImages(images, cellText, range);
        var count = Object.keys(picked).length;
        if (!count) return 0;
        ALL_ZONES.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.src = picked[id] ? picked[id].src : EMPTY_SRC;
            el.dataset.empty = picked[id] ? 'false' : 'true';
        });
        updateEmptyImageVisibility();
        return count;
    };
    window.__packStdPlanImages = planSheetImages; // 배치 규칙 점검용

    /** xlsx 내용(ArrayBuffer)을 읽어 본문과 사진을 표준서에 넣는다 */
    var loadWorkbookBuffer = async function (data) {
        var workbook = XLSX.read(data, { type: 'array' });
        globalWorkbookData = workbook;
        await readWorkbookImages(data, workbook);
        renderSheetTabs(workbook.SheetNames);
        switchSheet(workbook.SheetNames[0]);
    };

    /** 엑셀 내용에서 시트별 사진 자리(sheetToImagesMap)와 이미지 목록(extractedImagesList)을 채운다. xlsx가 아니면(xls·csv) 사진 없이 비운다 */
    var readWorkbookImages = async function (data, workbook) {
        sheetToImagesMap = {};
        extractedImagesList = [];
        workbook.SheetNames.forEach(function (name) { sheetToImagesMap[name] = []; });
        var zip;
        try { zip = await JSZip.loadAsync(data); } catch (e) { return; }
        try {
            var found = await readSheetImages(zip);
            workbook.SheetNames.forEach(function (name) { if (found[name]) sheetToImagesMap[name] = found[name]; });
        } catch (e) { console.warn('[표준서] 엑셀 사진 자리를 읽지 못했습니다:', e); }
        // '엑셀 추출 이미지' 목록: 시트에 놓인 사진 먼저, 자리를 못 읽은 사진도 빠짐없이
        var seen = {};
        workbook.SheetNames.forEach(function (name) {
            sheetToImagesMap[name].forEach(function (im) { if (!seen[im.src]) { seen[im.src] = 1; extractedImagesList.push({ src: im.src, name: im.name, sheet: name }); } });
        });
        var files = Object.keys(zip.files).filter(function (f) { return f.indexOf('xl/media/') === 0; });
        for (var i = 0; i < files.length; i++) {
            var ext = files[i].split('.').pop().toLowerCase();
            if (!MIME[ext]) continue;
            var src = 'data:' + MIME[ext] + ';base64,' + await zip.files[files[i]].async('base64');
            if (!seen[src]) { seen[src] = 1; extractedImagesList.push({ src: src, name: files[i].split('/').pop(), sheet: '엑셀추출' }); }
        }
    };

    var originalSwitchSheet = window.switchSheet;
    window.switchSheet = function (name) {
        originalSwitchSheet(name);
        var placed = placeSheetImages(name);
        var total = ((sheetToImagesMap && sheetToImagesMap[name]) || []).length;
        if (placed) showToast('[' + name + '] 본문과 사진 ' + placed + '장을 자동으로 넣었습니다' + (total > placed ? ' (나머지 ' + (total - placed) + '장은 이미지 목록에서 넣으세요)' : '') + '.');
        else if (total) showToast('[' + name + '] 사진 ' + total + '장의 자리를 정하지 못했습니다 — 이미지 목록에서 넣으세요.');
    };

    window.handleExcelUpload = async function (event) {
        var file = event.target.files[0];
        if (!file) return;
        showToast('엑셀 본문과 사진을 읽는 중...');
        try { await loadWorkbookBuffer(await file.arrayBuffer()); } catch (err) { console.error(err); showToast('엑셀 로딩 실패. .xlsx 파일인지 확인하고 다시 시도하세요.'); }
        event.target.value = ''; // 같은 파일을 다시 골라도 불러오게
    };

    window.syncFromGoogleSheetUrl = async function () {
        var input = document.getElementById('googleSheetUrlInput');
        var url = input ? input.value.trim() : '';
        if (!url) { showToast('구글 스프레드시트 링크를 입력하세요.'); return; }
        localStorage.setItem(GSHEET_URL_KEY, url);
        var match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!match) { showToast('올바른 구글 스프레드시트 링크가 아닙니다.'); return; }
        showToast('구글 시트에서 본문과 사진을 가져오는 중...');
        try {
            // xlsx로 받아야 시트 위에 놓인 사진이 함께 온다 (CSV에는 글자만 있다)
            var res = await fetch('https://docs.google.com/spreadsheets/d/' + match[1] + '/export?format=xlsx');
            if (!res.ok) throw new Error('시트 읽기 권한을 확인하세요.');
            await loadWorkbookBuffer(await res.arrayBuffer());
            closeGoogleSyncModal();
        } catch (err) {
            console.warn(err);
            showToast('동기화 실패: 시트가 "링크가 있는 모든 사용자(뷰어)"로 공유되었는지 확인하세요.');
        }
    };

    // 엑셀 뷰어: 파일을 열 때 사진 자리도 읽어 두고, [표준서에 적용]을 누르면 보고 있는 시트의 본문과 사진을 함께 넣는다
    var originalViewerUpload = window.handleExcelViewerUpload;
    window.handleExcelViewerUpload = async function (event) {
        var file = event.target.files[0];
        var data = file ? await file.arrayBuffer() : null;
        await originalViewerUpload(event);
        if (!data || !excelViewerWorkbook) return;
        try { await readWorkbookImages(data, excelViewerWorkbook); } catch (e) { console.warn('[표준서] 엑셀 사진 자리를 읽지 못했습니다:', e); }
    };
    var originalViewerApply = window.applyExcelViewerToStandardDoc;
    window.applyExcelViewerToStandardDoc = function () {
        var name = excelViewerCurrentSheetName;
        originalViewerApply();
        if (!excelViewerWorkbook || !name) return;
        globalWorkbookData = excelViewerWorkbook;
        var placed = placeSheetImages(name);
        var total = ((sheetToImagesMap && sheetToImagesMap[name]) || []).length;
        if (placed) showToast('[' + name + '] 본문과 사진 ' + placed + '장을 자동으로 넣었습니다' + (total > placed ? ' (나머지 ' + (total - placed) + '장은 이미지 목록에서 넣으세요)' : '') + '.');
        renderModalGallery();
    };

    // 구글 시트 뷰어의 [표준서에 적용]: 뷰어에 넣은 링크로 같은 동기화를 한다 (사진까지)
    window.applyGSheetToStandardDoc = function () {
        var viewerUrl = document.getElementById('gsheetViewerUrlInput'), target = document.getElementById('googleSheetUrlInput');
        if (viewerUrl && viewerUrl.value.trim() && target) target.value = viewerUrl.value.trim();
        closeGSheetViewerModal();
        window.syncFromGoogleSheetUrl();
    };
})();

/* 웹 저장소(파일 저장소 → 품목 사진)에 등록된 사진을 찾아 표준서 사진 칸에 넣는다.
   이미지 창(사진 칸의 [변경] · 위쪽 이미지 버튼)에 '엑셀 추출 이미지 / 웹 저장소 사진' 탭을 붙인다.
   목록·사진은 부모 창의 window.__packStdBridge.photos / photoData (src/components/PackStandard.js)가 준다.
   저장소 주소는 1시간 뒤 끊기므로 고른 사진은 dataURL로 받아 표준서에 넣는다. */
(function () {
    var bridge = null;
    try { bridge = window.parent !== window ? window.parent.__packStdBridge : null; } catch (e) { bridge = null; }
    if (!bridge || !bridge.photos) return;

    var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
    var tab = 'excel', results = [], searchSeq = 0, searchTimer = null;
    var zoneLabel = function () {
        var img = lastActiveDropZone && lastActiveDropZone.querySelector('img');
        return img ? (img.getAttribute('alt') || '') : '';
    };

    var drawResults = function (note) {
        var box = document.getElementById('storeImageList');
        if (!box) return;
        if (note) { box.innerHTML = '<div class="w-full text-center py-12 text-slate-400 text-xs font-medium">' + esc(note) + '</div>'; return; }
        if (!results.length) { box.innerHTML = '<div class="w-full text-center py-12 text-slate-400 text-xs font-medium">찾은 사진이 없습니다. 품목코드·품명·파일 이름으로 찾아보세요.<br>사진은 WMS의 파일 저장소 → 품목 사진에서 올립니다.</div>'; return; }
        box.innerHTML = results.map(function (p, i) {
            return '<div class="bg-white rounded-xl border border-slate-200 shadow-sm p-2.5 flex flex-col gap-2">' +
                '<div class="w-full h-40 bg-slate-50 rounded-lg flex items-center justify-center p-2 overflow-hidden border border-slate-100 cursor-pointer" data-store-zoom="' + i + '">' +
                '<img src="' + esc(p.url) + '" loading="lazy" class="max-w-full max-h-full object-contain" draggable="false" alt=""></div>' +
                '<div class="flex items-center justify-between gap-1.5">' +
                '<span class="text-[11px] text-slate-600 min-w-0"><b class="block truncate text-slate-800">' + esc(p.itemName || p.code) + (p.primary ? ' <span class="text-blue-600">★대표</span>' : '') + '</b>' +
                '<span class="block truncate">' + esc(p.code) + (p.spec ? ' · ' + esc(p.spec) : '') + (p.memo ? ' · ' + esc(p.memo) : '') + '</span></span>' +
                '<button data-store-apply="' + i + '" class="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold px-2.5 py-1 rounded shadow-sm">적용</button></div></div>';
        }).join('');
    };

    var search = function () {
        var input = document.getElementById('storeImageQuery');
        var seq = ++searchSeq;
        drawResults('사진을 찾는 중…');
        bridge.photos({ query: input ? input.value : '' }).then(function (res) {
            if (seq !== searchSeq) return;
            results = (res && res.list) || [];
            drawResults();
            var count = document.getElementById('storeImageCount');
            if (count) count.textContent = '웹 저장소 사진 ' + ((res && res.total) || 0) + '장 중 ' + results.length + '장' + (res && res.total > results.length ? ' (검색으로 좁히세요)' : '');
        }).catch(function (e) { if (seq === searchSeq) drawResults(e.message || '사진 목록을 불러오지 못했습니다.'); });
    };

    var apply = function (photo) {
        if (userRole !== 'admin') { showToast('편집 모드에서만 사진을 바꿀 수 있습니다.'); return; }
        if (!lastActiveDropZone) { showToast('먼저 표준서에서 바꿀 사진 칸을 누르세요.'); return; }
        showToast('사진을 가져오는 중…');
        bridge.photoData(photo).then(function (dataUrl) { applyImageToActiveZone(dataUrl); })
            .catch(function (e) { showToast(e.message || '사진을 가져오지 못했습니다.'); });
    };

    var setTab = function (next) {
        tab = next;
        var excelList = document.getElementById('modalImageList'), storePane = document.getElementById('storeImagePane');
        var excelCount = document.getElementById('extractedCount'), storeCount = document.getElementById('storeImageCount');
        if (excelList) excelList.style.display = tab === 'excel' ? '' : 'none';
        if (storePane) storePane.style.display = tab === 'store' ? 'flex' : 'none';
        if (excelCount) excelCount.style.display = tab === 'excel' ? '' : 'none';
        if (storeCount) storeCount.style.display = tab === 'store' ? '' : 'none';
        document.querySelectorAll('[data-image-tab]').forEach(function (b) {
            var on = b.getAttribute('data-image-tab') === tab;
            b.className = 'flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition ' + (on ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900');
        });
        var target = document.getElementById('storeImageTarget');
        if (target) target.textContent = zoneLabel() ? '바꿀 칸: ' + zoneLabel() : '표준서에서 바꿀 사진 칸을 먼저 누르세요.';
        if (tab === 'store' && !results.length) {
            // 처음 열 때는 표준서의 제품명으로 찾아 둔다
            var input = document.getElementById('storeImageQuery'), product = document.getElementById('cell_product');
            if (input && !input.value && product) input.value = product.innerText.trim().split(/\s+/).slice(0, 2).join(' ');
            search();
        }
    };

    window.addEventListener('DOMContentLoaded', function () {
        var modal = document.getElementById('imageModal'), list = document.getElementById('modalImageList');
        if (!modal || !list) return;
        var title = modal.querySelector('h3');
        if (title) title.textContent = '🖼️ 이미지 고르기';
        var tabs = document.createElement('div');
        tabs.className = 'px-4 pt-3 bg-white';
        tabs.innerHTML = '<div class="flex gap-1 p-1 bg-slate-100 rounded-xl"><button data-image-tab="excel"></button><button data-image-tab="store"></button></div>';
        tabs.querySelector('[data-image-tab="excel"]').textContent = '엑셀 추출 이미지';
        tabs.querySelector('[data-image-tab="store"]').textContent = '웹 저장소 사진';
        list.parentNode.insertBefore(tabs, list);
        var pane = document.createElement('div');
        pane.id = 'storeImagePane';
        pane.className = 'flex-1 min-h-0 flex-col bg-slate-100';
        pane.style.display = 'none';
        pane.innerHTML = '<div class="px-4 pt-3 space-y-1.5">' +
            '<input id="storeImageQuery" type="search" placeholder="품목코드 · 품명 · 규격 · 파일 이름으로 찾기" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white">' +
            '<p id="storeImageTarget" class="text-[11px] font-bold text-blue-700"></p></div>' +
            '<div id="storeImageList" class="p-4 overflow-y-auto flex flex-col gap-3 flex-1"></div>';
        list.parentNode.insertBefore(pane, list.nextSibling);
        var excelCount = document.getElementById('extractedCount');
        if (excelCount) {
            var storeCount = document.createElement('span');
            storeCount.id = 'storeImageCount';
            storeCount.style.display = 'none';
            excelCount.parentNode.insertBefore(storeCount, excelCount.nextSibling);
        }
        tabs.addEventListener('click', function (e) { var b = e.target.closest('[data-image-tab]'); if (b) setTab(b.getAttribute('data-image-tab')); });
        pane.addEventListener('input', function (e) {
            if (e.target.id !== 'storeImageQuery') return;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(search, 300);
        });
        pane.addEventListener('click', function (e) {
            var a = e.target.closest('[data-store-apply]'), z = e.target.closest('[data-store-zoom]');
            if (a) apply(results[Number(a.getAttribute('data-store-apply'))]);
            else if (z) {
                var p = results[Number(z.getAttribute('data-store-zoom'))];
                openImageZoom(p.url, p.itemName || p.code);
                var btn = document.getElementById('zoomApplyBtn');
                if (btn) btn.onclick = function () { closeImageZoom(); apply(p); };
            }
        });
        setTab('excel');
    });

    // 이미지 창을 열 때: 엑셀에서 뽑은 이미지가 없으면 웹 저장소 탭부터 보여 준다
    var originalToggle = window.toggleImageModal;
    window.toggleImageModal = function (show) {
        originalToggle(show);
        if (show) setTab(extractedImagesList && extractedImagesList.length ? tab : 'store');
    };
})();
