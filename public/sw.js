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
                // Cache hit or clone
                if (response && response.status === 200 && response.type === 'basic') {
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
