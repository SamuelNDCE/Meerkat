// Fixture: a stub "sync server" that is slow and fails writes, so the k6 thresholds MUST break.
import http from 'node:http';
const s = http.createServer((req, res) => {
  const health = req.url.startsWith('/health');
  setTimeout(() => { res.statusCode = health ? 200 : 500; res.end('{}'); }, health ? 0 : 900);
});
s.listen(0, '127.0.0.1', () => console.log('PORT ' + s.address().port));
