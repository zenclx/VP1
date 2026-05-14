/**
 * keepalive.js
 * Starts a tiny HTTP server so Render's health checks pass
 * and the free instance doesn't spin down mid-match.
 */
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive 🤖');
});

server.listen(PORT, () => {
  console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

module.exports = server;
