/* Controlled transport fixture. Never logs headers, bodies, URLs or credentials. */
const http = require('node:http');
const port = Number(process.env.NOVEL_PROBE_PORT || 8765);
let sinkRequests = 0;
let sinkWithAuth = 0;
let abortedHolds = 0;
const fixture = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (path === '/stats') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ sinkRequests, sinkWithAuth, abortedHolds }));
  } else if (/^\/redirect\/(301|302|307|308)$/.test(path)) {
    res.writeHead(Number(path.split('/').pop()), { Location: `http://127.0.0.1:${port + 1}/sink` });
    res.end();
  } else if (path === '/stream' || path === '/hold') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.flushHeaders();
    res.write(Buffer.from('甲🌊').subarray(0, 4));
    const second = setTimeout(() => res.write(Buffer.from('甲🌊').subarray(4)), 250);
    const finish = path === '/stream' ? setTimeout(() => res.end('乙'), 650) : null;
    res.on('close', () => {
      clearTimeout(second);
      if (finish) clearTimeout(finish);
      if (path === '/hold') abortedHolds++;
    });
  } else {
    res.writeHead(404); res.end();
  }
});
const sink = http.createServer((req, res) => {
  sinkRequests++;
  if (req.headers.authorization || req.headers['x-api-key']) sinkWithAuth++;
  res.end('sink');
});
fixture.listen(port, '0.0.0.0', () => console.log(`Probe fixture listening on ${port}; statistics only at /stats`));
sink.listen(port + 1, '0.0.0.0');
function stop() { fixture.closeAllConnections(); sink.closeAllConnections(); fixture.close(); sink.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
