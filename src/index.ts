import { createServer } from 'http';
import { createProxyServer } from 'http-proxy';

const proxy = createProxyServer({
  xfwd: true
});

const server = createServer((req, res) => {
  proxy.web(req, res, {
    target: {
      host: 'localhost',
      port: 8000
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head, {
    target: {
      host: 'localhost',
      port: 8000
    }
  });
});

server.listen(80);
