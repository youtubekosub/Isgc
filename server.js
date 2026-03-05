const express = require('express');
const http = require('http');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const server = http.createServer(app);

const SECRET_KEY = 0xAB; 
const transform = (buf) => Buffer.from(buf).map(b => b ^ SECRET_KEY);

const rewriteResources = (content, targetUrl, contentType) => {
    if (contentType.includes('text/html')) {
        const $ = cheerio.load(content);
        const urlObj = new URL(targetUrl);

        $('head').prepend(`<base href="${urlObj.origin}${urlObj.pathname}">`);

        $('a, img, link, script, source, iframe').each((i, el) => {
            ['href', 'src', 'action'].forEach(attr => {
                const val = $(el).attr(attr);
                if (val && !val.startsWith('data:') && !val.startsWith('#')) {
                    try { $(el).attr(attr, new URL(val, targetUrl).href); } catch (e) {}
                }
            });
        });

        // 検閲回避のためのセキュリティ制限解除
        $('meta[http-equiv="Content-Security-Policy"]').remove();
        $('meta[http-equiv="content-security-policy"]').remove();
        $('meta[name="expected-hostname"]').remove();
        $('meta[http-equiv="X-Frame-Options"]').remove();

        return $.html();
    }
    return content;
};

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

const jar = new Map();

// 標準的なHTTPS POSTに偽装したトンネルエンドポイント
app.post('/api/tunnel', async (req, res) => {
    try {
        const decrypted = transform(Buffer.from(req.body.data, 'base64')).toString();
        const { url, method, headers, data } = JSON.parse(decrypted);
        const host = new URL(url).hostname;

        const response = await axios({
            url,
            method: method || 'GET',
            data: data || null,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                'Cookie': jar.get(host) || '',
                'Referer': 'https://www.google.com/',
                ...headers
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: false
        });

        if (response.headers['set-cookie']) {
            jar.set(host, response.headers['set-cookie'].map(c => c.split(';')[0]).join('; '));
        }

        let bodyData = response.data;
        const contentType = response.headers['content-type'] || '';

        if (contentType.includes('text/html') || contentType.includes('text/css')) {
            bodyData = Buffer.from(rewriteResources(bodyData.toString(), url, contentType));
        }

        const encoded = transform(JSON.stringify({
            body: bodyData.toString('base64'),
            status: response.status,
            contentType: contentType,
            url: url
        })).toString('base64');

        res.json({ d: encoded });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Stealth Engine active on port ${PORT}`));
