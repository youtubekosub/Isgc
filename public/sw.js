self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // 自分のドメインへのリクエスト、またはdata:プロトコルは無視
    if (url.includes(location.host) || url.startsWith('data:')) return;

    event.respondWith(
        new Promise((resolve) => {
            const mc = new MessageChannel();
            mc.port1.onmessage = (msg) => {
                const res = msg.data;
                const binary = atob(res.body);
                const array = new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
                resolve(new Response(array, {
                    headers: { 'Content-Type': res.contentType || 'application/octet-stream' }
                }));
            };

            // メインウィンドウにURLの取得を依頼
            self.clients.matchAll().then(clients => {
                if (clients && clients.length) {
                    clients[0].postMessage({ type: 'fetch', url: url }, [mc.port2]);
                }
            });
        })
    );
});
