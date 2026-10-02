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

/* 엑셀·구글 시트를 불러오면 시트에 놓인 사진을 표준서의 사진 칸에 자동으로 넣는다.
   · 엑셀(.xlsx) 안의 그림 자리(xl/drawings의 anchor — 시트별 행·열)를 읽어, 그 위쪽(또는 왼쪽)에 적힌 머리 글자
     (용기·라벨·인박스·아웃박스·파렛트·스티커)로 어느 칸인지 정한다. 머리 글자 하나에 여러 이름이 있으면('용기 & 라벨 & 인박스 & 아웃박스')
     그 아래 사진을 왼쪽부터 그 순서로 넣고, 머리 글자를 못 찾은 사진은 본문 표 아래에 있는 것만 남은 빈 칸에 차례로 넣는다.
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
                    result[name].push({ src: media[target], name: target.split('/').pop(), row: num(from, 'row'), col: num(from, 'col'), col2: to ? num(to, 'col') : num(from, 'col') });
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

    /** 그 시트의 사진을 표준서 사진 칸에 넣는다. 넣은 장수를 돌려준다 */
    var placeSheetImages = function (sheetName) {
        var images = (sheetToImagesMap && sheetToImagesMap[sheetName]) || [];
        var sheet = globalWorkbookData && globalWorkbookData.Sheets[sheetName];
        if (!images.length || !sheet || userRole !== 'admin') return 0;
        var range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        var cellText = function (r, c) { var cell = sheet[XLSX.utils.encode_cell({ r: r, c: c })]; return cell && cell.v != null ? String(cell.v) : ''; };
        // 본문 표(1~10번 항목)의 마지막 줄: 머리 글자를 못 찾은 사진은 그 아래에 있는 것만 넣는다 (위쪽의 로고·도장은 넣지 않는다)
        var bodyEnd = -1;
        for (var r = range.s.r; r <= range.e.r; r++) for (var c = range.s.c; c <= Math.min(range.e.c, range.s.c + 3); c++) if (ITEM_NO.test(cellText(r, c))) bodyEnd = Math.max(bodyEnd, r);
        // 사진의 머리 글자: 사진 자리에서 위로 올라가며 겹치는 열을 보고, 여러 칸을 합친 머리 글자(왼쪽 첫 칸에만 값이 있다)도 본다
        var headerOf = function (im) {
            for (var r = im.row; r >= Math.max(range.s.r, im.row - 8); r--) {
                for (var c = Math.max(range.s.c, im.col - 1); c <= Math.min(range.e.c, im.col2 + 1); c++) {
                    var text = cellText(r, c), names = zoneNamesIn(text);
                    if (names.length && !ITEM_NO.test(text)) return { key: r + ':' + c, names: names };
                }
                for (var c2 = im.col - 2; c2 >= range.s.c; c2--) {
                    var t = cellText(r, c2);
                    if (!t) continue;
                    var wide = zoneNamesIn(t);
                    if (wide.length > 1 && !ITEM_NO.test(t)) return { key: r + ':' + c2, names: wide };
                    break;
                }
            }
            return null;
        };
        var picked = {}, groups = {}, loose = [];
        images.forEach(function (im) {
            var h = headerOf(im);
            if (!h) { if (im.row > bodyEnd) loose.push(im); return; }
            (groups[h.key] = groups[h.key] || { names: h.names, list: [] }).list.push(im);
        });
        Object.keys(groups).forEach(function (k) {
            var g = groups[k];
            g.list.sort(function (x, y) { return x.col - y.col || x.row - y.row; });
            g.list.forEach(function (im, i) { var id = g.names[i]; if (id && !picked[id]) picked[id] = im; else if (im.row > bodyEnd) loose.push(im); });
        });
        loose.sort(function (x, y) { return x.row - y.row || x.col - y.col; });
        ['bottleImg', 'labelImg', 'innerBoxImg', 'outterBoxImg'].forEach(function (id) { if (!picked[id] && loose.length) picked[id] = loose.shift(); });
        var count = 0;
        Object.keys(picked).forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.src = picked[id].src;
            el.dataset.empty = 'false';
            count += 1;
        });
        if (count) updateEmptyImageVisibility();
        return count;
    };

    /** xlsx 내용(ArrayBuffer)을 읽어 본문과 사진을 표준서에 넣는다 */
    var loadWorkbookBuffer = async function (data) {
        var zip = await JSZip.loadAsync(data);
        var workbook = XLSX.read(data, { type: 'array' });
        globalWorkbookData = workbook;
        sheetToImagesMap = {};
        workbook.SheetNames.forEach(function (name) { sheetToImagesMap[name] = []; });
        try {
            var found = await readSheetImages(zip);
            workbook.SheetNames.forEach(function (name) { if (found[name]) sheetToImagesMap[name] = found[name]; });
        } catch (e) { console.warn('[표준서] 엑셀 사진 자리를 읽지 못했습니다:', e); }
        // '엑셀 추출 이미지' 목록: 시트에 놓인 사진 먼저, 자리를 못 읽은 사진도 빠짐없이
        extractedImagesList = [];
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
        renderSheetTabs(workbook.SheetNames);
        switchSheet(workbook.SheetNames[0]);
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

    // 구글 시트 뷰어의 [표준서에 적용]: 뷰어에 넣은 링크로 같은 동기화를 한다 (사진까지)
    window.applyGSheetToStandardDoc = function () {
        var viewerUrl = document.getElementById('gsheetViewerUrlInput'), target = document.getElementById('googleSheetUrlInput');
        if (viewerUrl && viewerUrl.value.trim() && target) target.value = viewerUrl.value.trim();
        closeGSheetViewerModal();
        window.syncFromGoogleSheetUrl();
    };
})();
