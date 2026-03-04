const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 難読化キー（Shadowsocks等の概念に基づき、パケットの特徴を消すために使用）
const SECRET_KEY = 0xAB;

// データの難読化・復元処理
const transform = (buffer) => Buffer.from(buffer).map(b => b ^ SECRET_KEY);

// HTML内のリソースパスを絶対URLに書き換えるリライター
const rewriteHTML = (html, targetUrl) => {
    return html.replace(/(href|src)=["']([^"']+)["']/g, (match, p1, p2) => {
        try {
            if (p2.startsWith('http') || p2.startsWith('data:') || p2.startsWith('#')) return match;
            const absolute = new URL(p2, targetUrl).href;
            return `${p1}="${absolute}"`;
        } catch (e) {
            return match;
        }
    });
};

app.use(express.static('public'));

wss.on('connection', (ws) => {
    const jar = new Map(); // ドメインごとのCookie管理

    ws.on('message', async (msg) => {
        try {
            // 1. 難読化されたリクエストを復元
            const decrypted = transform(msg).toString();
            const { url, method, headers } = JSON.parse(decrypted);
            const host = new URL(url).hostname;

            // 2. ターゲットサイトへの代理アクセス
            const res = await axios({
                url,
                method: method || 'GET',
                headers: {
                    ...headers,
                    'Cookie': jar.get(host) || '',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                },
                responseType: 'arraybuffer',
                validateStatus: false
            });

            // 3. Cookieの永続化
            if (res.headers['set-cookie']) {
                jar.set(host, res.headers['set-cookie'].map(c => c.split(';')[0]).join('; '));
            }

            let bodyData = res.data;
            const contentType = res.headers['content-type'] || '';

            // 4. HTMLの場合はリソースパスを修正
            if (contentType.includes('text/html')) {
                bodyData = Buffer.from(rewriteHTML(bodyData.toString(), url));
            }

            // 5. 結果をBase64化し、さらに難読化して返却
            const result = JSON.stringify({
                body: bodyData.toString('base64'),
                status: res.status,
                contentType: contentType,
                url: url
            });
            
            ws.send(transform(Buffer.from(result)));
        } catch (e) {
            ws.send(transform(Buffer.from(JSON.stringify({ error: e.message }))));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Stealth Research Server active on port ${PORT}`));
