const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const buildDir = path.join(__dirname, 'build');
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url || '/');
  const requestPath = decodeURIComponent(parsedUrl.pathname || '/');
  const safePath = path.normalize(requestPath).replace(/^([.]{2}[\/\\])+/, '');
  const filePath = path.join(buildDir, safePath);

  if (safePath !== '/' && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  const assetPath = path.join(buildDir, safePath, 'index.html');
  if (safePath !== '/' && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    sendFile(res, assetPath);
    return;
  }

  sendFile(res, path.join(buildDir, 'index.html'));
});

server.listen(port, host, () => {
  console.log(`Serving frontend build on http://${host}:${port}`);
});
