import { ProxyTarget } from 'http-proxy';
import internal from 'stream';
import fetch from 'node-fetch';
import DockerManager from './DockerManager';

const dockerManager = new DockerManager();

export default class ProxyHost {
  private domain: string;
  private containerName: string;
  private proxyHost: string;
  private proxyPort: number;
  private timeoutSeconds: number;

  private activeSockets: Set<internal.Duplex> = new Set();
  private connectionTimeoutId: NodeJS.Timeout | null = null;
  private containerRunning: boolean | undefined = undefined;
  private containerRunningChecking = false;

  constructor(
    domain: string,
    containerName: string,
    proxyHost: string,
    proxyPort: number,
    timeoutSeconds: number
  ) {
    this.domain = domain;
    this.containerName = containerName;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.timeoutSeconds = timeoutSeconds;
    this.resetConnectionTimeout();
    dockerManager.isContainerRunning(this.containerName).then(res => {
      this.containerRunning = res;
    });
  }

  private async stopHost(): Promise<void> {
    this.containerRunning = false;
    clearTimeout(this.connectionTimeoutId as NodeJS.Timeout);
    this.connectionTimeoutId = null;

    if (await dockerManager.isContainerRunning(this.containerName)) {
      console.log(`🛏  Putting ${this.containerName} to sleep`);
      await dockerManager.stopContainer(this.containerName);
    }
  }

  private async startHost(): Promise<void> {
    if (!this.containerRunningChecking
        && !(await dockerManager.isContainerRunning(this.containerName))) {
      console.log(`⏰ Waking ${this.containerName} up`);
      await dockerManager.startContainer(this.containerName);
      this.containerRunningChecking = true;
      const checkInterval = setInterval(() => {
        this.resetConnectionTimeout();

        fetch(`http://${this.proxyHost}:${this.proxyPort}`, {
          method: 'HEAD'
        }).then(res => {
          if (res.status === 200 || (res.status >= 300 && res.status <= 399)) {
            clearInterval(checkInterval);
            this.containerRunningChecking = false;
            this.containerRunning = true;
          }
        }).catch(() => null);
      }, 250);
    }
  }

  private resetConnectionTimeout(): void {
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }

    this.connectionTimeoutId = setTimeout(
      () => this.onConnectionTimeout(), this.timeoutSeconds * 1000
    );
  }

  private onConnectionTimeout(): void {
    if (this.activeSockets.size > 0) {
      this.resetConnectionTimeout();
      return;
    }

    this.stopHost();
  }

  public getTarget(): ProxyTarget {
    return {
      host: this.containerRunning ? this.proxyHost : 'localhost',
      port: this.containerRunning ? this.proxyPort : 8080,
      path: this.containerRunning ? undefined : `/${this.containerName}`
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
}
