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
