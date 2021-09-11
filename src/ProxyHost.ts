import { ProxyTarget } from 'http-proxy';
import internal, { EventEmitter } from 'stream';
import fetch from 'node-fetch';
import logger from './Logger';
import DockerManager from './DockerManager';

const dockerManager = new DockerManager();

export default class ProxyHost {
  private domain: string;
  private containerName: string;
  private proxyHost: string;
  private proxyPort: number;
  private timeoutSeconds: number;

  private activeSockets: Set<internal.Duplex> = new Set();
  private containerEventEmitter: EventEmitter | null = null;
  private connectionTimeoutId: NodeJS.Timeout | null = null;
  private containerRunning: boolean | undefined = undefined;
  private containerReadyChecking = false;
  private startingHost = false;
  private stoppingHost = false;

  constructor(
    domain: string,
    containerName: string,
    proxyHost: string,
    proxyPort: number,
    timeoutSeconds: number
  ) {
    logger.info({
      host: domain,
      container: containerName,
      proxy: {
        host: proxyHost,
        port: proxyPort
      },
      timeoutSeconds: timeoutSeconds
    }, 'Added proxy host');

    this.domain = domain;
    this.containerName = containerName;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.timeoutSeconds = timeoutSeconds;
    dockerManager.isContainerRunning(this.containerName).then(res => {
      if (res) this.resetConnectionTimeout();
      this.containerRunning = res;
      logger.debug({ container: this.containerName, running: res }, 'Initial docker state check done');
    });

    dockerManager.getContainerEventEmitter(this.containerName).then(eventEmitter => {
      this.containerEventEmitter = eventEmitter;
      eventEmitter.on('update', data => {
        logger.debug({ container: this.containerName, data }, 'Received container event');
        if (data.status === 'stop') {
          this.stopHost();
        } else if (data.status === 'start') {
          this.startHost();
        }
      });
    });
  }

  private async stopHost(): Promise<void> {
    if (this.stoppingHost) return;
    this.stoppingHost = true;

    this.containerRunning = false;
    this.stopConnectionTimeout();

    if (await dockerManager.isContainerRunning(this.containerName)) {
      logger.info({ container: this.containerName }, 'Stopping container');
      await dockerManager.stopContainer(this.containerName);
      logger.debug({ container: this.containerName }, 'Stopping container complete');
    }

    this.stoppingHost = false;
  }

  private async startHost(): Promise<void> {
    if (this.startingHost) return;
    this.startingHost = true;

    if (!(await dockerManager.isContainerRunning(this.containerName))) {
      logger.info({ container: this.containerName }, 'Starting container');
      await dockerManager.startContainer(this.containerName);
      logger.debug({ container: this.containerName }, 'Starting container complete');
    }

    this.checkContainerReady();
    this.startingHost = false;
  }

  private checkContainerReady() {
    if (this.containerReadyChecking) return;

    this.containerReadyChecking = true;
    const checkInterval = setInterval(() => {
      this.resetConnectionTimeout();

      fetch(`http://${this.proxyHost}:${this.proxyPort}`, {
        method: 'HEAD'
      }).then(res => {
        logger.debug({ container: this.containerName, status: res.status, headers: res.headers }, 'Checked if container is ready');
        if (res.status === 200 || (res.status >= 300 && res.status <= 399)) {
          clearInterval(checkInterval);
          this.containerReadyChecking = false;
          this.containerRunning = true;
          logger.debug({ container: this.containerName }, 'Container is ready');
        }
      }).catch(err => logger.debug({ error: err }, 'Container readiness check failed'));
    }, 250);
  }

  private startConnectionTimeout(): void {
    this.connectionTimeoutId = setTimeout(
      () => this.onConnectionTimeout(), this.timeoutSeconds * 1000
    );
  }

  private resetConnectionTimeout(): void {
    logger.debug({ container: this.containerName, timeoutSeconds: this.timeoutSeconds }, 'Resetting connection timeout');
    this.stopConnectionTimeout();
    this.startConnectionTimeout();
  }

  private onConnectionTimeout(): void {
    if (this.activeSockets.size > 0) {
      logger.debug({ container: this.containerName, activeSocketCount: this.activeSockets.size }, 'Reached timeout but there are still active sockets');
      this.resetConnectionTimeout();
      return;
    }

    this.stopHost();
  }

  public getHeaders(): { [header: string]: string; } {
    return {
      'x-container-nursery-container-name': this.containerName
    };
  }

  public getTarget(): ProxyTarget {
    return {
      host: this.containerRunning ? this.proxyHost : 'localhost',
      port: this.containerRunning ? this.proxyPort : 8080
    };
  }

  public newConnection(): void {
    if (!this.containerRunning) {
      this.startHost();
    } else {
      this.resetConnectionTimeout();
    }
  }

  public newSocketConnection(socket: internal.Duplex): void {
    if (!this.containerRunning) {
      this.startHost();
    } else {
      this.resetConnectionTimeout();
    }

    this.activeSockets.add(socket);
    socket.once('close', () => {
      this.resetConnectionTimeout();
      this.activeSockets.delete(socket);
    });
  }

  public stopConnectionTimeout(): void {
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
  }

  public stopContainerEventEmitter(): void {
    if (!this.containerEventEmitter) return;
    this.containerEventEmitter.emit('stop-stream');
    this.containerEventEmitter.removeAllListeners();
  }
}
