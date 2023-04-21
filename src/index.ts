import 'dotenv/config';
import { createServer } from 'http';
import { createProxyServer } from 'http-proxy';
import express from 'express';
import logger from './Logger';
import ConfigManager from './ConfigManager';
import ProxyHost from './ProxyHost';

// Disable TLS certificate verification for the targets of the proxy server
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const proxyHosts: Map<string, ProxyHost> = new Map();
// eslint-disable-next-line no-unused-vars
const configManager = new ConfigManager(proxyHosts);
const proxy = createProxyServer({
  xfwd: true,
  secure: false
});

let proxyListeningPort = configManager.getProxyListeningPort();
const placeholderServerListeningPort = 8080;
const placeholderServerListeningHost = '127.0.0.1';

// Remove secure tag from cookies
proxy.on('proxyRes', (proxyRes) => {
  const sc = proxyRes.headers['set-cookie'];
  if (Array.isArray(sc)) {
    // eslint-disable-next-line no-param-reassign
    proxyRes.headers['set-cookie'] = sc.map(str => {
      return str.split(';')
        .filter(v => v.trim().toLowerCase() !== 'secure')
        .join('; ');
    });
  }
});

const stripPortHostHeader = (host: string | undefined): string | undefined => {
  if (!host) return host;
  return host.replace(/(:\d+)/i, '');
};

proxy.on('error', (err, req, res) => {
  req.headers.host = stripPortHostHeader(req.headers.host);
  logger.debug({ host: req.headers.host, error: err }, 'Error in proxying request');
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
  logger.warn({ host: req.headers.host, target: proxyHost?.getTarget() }, 'Host not reachable');
});

const proxyServer = createServer((req, res) => {
  req.headers.host = stripPortHostHeader(req.headers.host);

  if (!req.headers.host) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.write('Error: Request header host wasn\t specified');
    res.end();
    return;
  }

  let proxyHost;
  const urlParts = req.url ? req.url.split('/') : [''];

  for (let i = urlParts.length - 1; i >= 0; i -= 1) {
    proxyHost = proxyHosts.get(req.headers.host + urlParts.filter((_, j) => j <= i).join('/'));
    if (proxyHost) break;
  }

  if (!proxyHost) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.write(`Error: Proxy configuration is missing for ${req.headers.host}`);
    res.end();
    logger.warn({ host: req.headers.host, url: req.url }, 'Proxy configuration missing');
    return;
  }

  proxyHost.newConnection();
  proxy.web(req, res, {
    target: proxyHost.getTarget(),
    headers: proxyHost.getHeaders()
  });
  logger.debug({ host: req.headers.host, target: proxyHost.getTarget(), headers: proxyHost.getHeaders() }, 'Proxied request');
});

proxyServer.on('upgrade', (req, socket, head) => {
  req.headers.host = stripPortHostHeader(req.headers.host);
  if (!req.headers.host) {
    logger.warn('Socket upgrade failed, request header host not specified');
    return;
  }

  let proxyHost;
  const urlParts = req.url ? req.url.split('/') : [''];

  for (let i = urlParts.length - 1; i >= 0; i -= 1) {
    proxyHost = proxyHosts.get(req.headers.host + urlParts.filter((_, j) => j <= i).join('/'));
    if (proxyHost) break;
  }

  if (!proxyHost) {
    logger.warn({ host: req.headers.host, url: req.url }, 'Socket upgrade failed, proxy configuration missing');
    return;
  }

  proxyHost.newSocketConnection(socket);
  proxy.ws(req, socket, head, {
    target: proxyHost.getTarget(),
    headers: proxyHost.getHeaders()
  });
  logger.debug({
    host: req.headers.host, url: req.url, target: proxyHost.getTarget(), headers: proxyHost.getHeaders()
  }, 'Proxied Upgrade request');
});

proxyServer.listen(proxyListeningPort);
logger.info({ port: proxyListeningPort }, 'Proxy listening');

configManager.on('port-update', () => {
  proxyListeningPort = configManager.getProxyListeningPort();
  proxyServer.close(() => {
    proxyServer.listen(proxyListeningPort);
    logger.info({ port: proxyListeningPort }, 'Proxy listening');
  });
});

const placeholderServer = express();
placeholderServer.set('views', 'views');
placeholderServer.set('view engine', 'ejs');
placeholderServer.use((_, res, next) => {
  res.setHeader('x-powered-by', 'ContainerNursery');
  next();
});
placeholderServer.get('*', (req, res) => {
  res.render('placeholder', { containerName: req.headers['x-container-nursery-container-name'] });
});
placeholderServer.listen(placeholderServerListeningPort, placeholderServerListeningHost);
logger.info({ port: placeholderServerListeningPort, host: placeholderServerListeningHost }, 'Proxy placeholder server listening');

process.on('SIGTERM', () => {
  process.exit(0);
});
