const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET_KEY = 0xAB; // 難読化用キー

// バイナリXOR変換
const transform = (buffer) => Buffer.from(buffer).map(b => b ^ SECRET_KEY);

// HTML内のリンクを絶対パスに書き換える（簡易リライター）
const rewriteHTML = (html, targetUrl) => {
    return html.replace(/(href|src)=["']([^"']+)["']/g, (match, p1, p2) => {
        try {
            if (p2.startsWith('http') || p2.startsWith('data:')) return match;
            const absolute = new URL(p2, targetUrl).href;
            return `${p1}="${absolute}"`;
        } catch (e) {
            return match;
        }
    });
};

app.use(express.static('public'));

wss.on('connection', (ws) => {
    const jar = new Map();

    ws.on('message', async (msg) => {
        try {
            const decrypted = transform(msg).toString();
            const { url, method, headers } = JSON.parse(decrypted);
            const host = new URL(url).hostname;

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

            if (res.headers['set-cookie']) {
                jar.set(host, res.headers['set-cookie'].map(c => c.split(';')[0]).join('; '));
            }

            let bodyData = res.data;
            const contentType = res.headers['content-type'] || '';

            if (contentType.includes('text/html')) {
                bodyData = Buffer.from(rewriteHTML(bodyData.toString(), url));
            }

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
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));
