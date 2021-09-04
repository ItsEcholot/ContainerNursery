import { createServer } from 'http';
import { createProxyServer } from 'http-proxy';
import ConfigManager from './ConfigManager';
import ProxyHost from './ProxyHost';

const proxyHosts: Map<string, ProxyHost> = new Map();
// eslint-disable-next-line no-unused-vars
const configManager = new ConfigManager(proxyHosts);
const proxy = createProxyServer({
  xfwd: true
});

const server = createServer((req, res) => {
  if (!req.headers.host) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.write('Error: Request header host wasn\t specified');
    res.end();
    return;
  }
  const proxyHost = proxyHosts.get(req.headers.host);
  if (!proxyHost) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.write(`Error: Proxy configuration is missing for ${req.headers.host}`);
    res.end();
    return;
  }

  proxyHost.newConnection();
  proxy.web(req, res, {
    target: proxyHost.getTarget()
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.headers.host) {
    console.error('Socket Upgrade Error: Request header host wasn\'t specified');
    return;
  }
  const proxyHost = proxyHosts.get(req.headers.host);
  if (!proxyHost) {
    console.error(`Socket Upgrade Error: Proxy configuration is missing for ${req.headers.host}`);
    return;
  }

  proxyHost.newSocketConnection(socket);
  proxy.ws(req, socket, head, {
    target: proxyHost.getTarget()
  });
});

proxy.on('error', (err, req, res) => {
  if (!req.headers.host) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.write('Error: Request header host wasn\t specified');
    res.end();
    return;
  }
  const proxyHost = proxyHosts.get(req.headers.host as string);
  if (res.writeHead) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.write(`Error: Host is not reachable ${JSON.stringify(proxyHost?.getTarget())}`);
    res.end();
  }
});

server.listen(80);
