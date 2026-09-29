// DAELIMOIL SMART WMS PRO Service Worker
const CACHE_NAME = 'daelim-wms-v3';
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png'
];
// 오프라인에서도 캐시로 쓰는 외부 사이트 (index.html의 Tailwind CDN·구글 글꼴)
const OFFLINE_CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Cache prefetch error:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Do not cache Supabase API calls or realtime websockets
    const url = new URL(event.request.url);
    if (url.origin.includes('supabase.co')) return;

    // 화면 모양(Tailwind CDN)·글꼴은 다른 사이트에서 받으므로, 인터넷이 없는 곳에서도 앱이 제 모양으로 열리도록
    // 캐시에 있으면 바로 쓰고 뒤에서 새로 받아 둔다 (다른 사이트 응답은 내용을 볼 수 없는 opaque여도 저장)
    if (OFFLINE_CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => cache.match(event.request).then((cached) => {
                const refresh = fetch(event.request).then((response) => {
                    if (response && (response.ok || response.type === 'opaque')) cache.put(event.request, response.clone());
                    return response;
                });
                if (cached) {
                    refresh.catch(() => { /* 오프라인: 캐시 사용 중이므로 새로 받지 못해도 괜찮음 */ });
                    return cached;
                }
                return refresh;
            }))
        );
        return;
    }

    // 빌드 파일(assets/*)은 파일 이름에 내용 해시가 있어 바뀌지 않으므로 캐시에 있으면 네트워크를 기다리지 않는다
    // (index.html은 아래 네트워크 우선이라 배포하면 새 파일 이름을 받아 온다)
    if (url.origin === self.location.origin && url.pathname.includes('/assets/')) {
        event.respondWith(
            caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                }
                return response;
            }))
        );
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache hit or clone (휴대폰 공유로 연 주소 ?share_text=… 는 매번 달라 캐시하지 않음)
                if (response && response.status === 200 && response.type === 'basic' && !url.search.includes('share_')) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache when offline
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    if (event.request.headers.get('accept')?.includes('text/html')) {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
