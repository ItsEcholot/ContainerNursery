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
  private startingHost = false;
  private stoppingHost = false;

  constructor(
    domain: string,
    containerName: string,
    proxyHost: string,
    proxyPort: number,
    timeoutSeconds: number
  ) {
    console.log(`Added proxy host for domain ${domain} (container: ${containerName}, proxy: ${proxyHost}:${proxyPort}, timeout after ${timeoutSeconds}s)`);

    this.domain = domain;
    this.containerName = containerName;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.timeoutSeconds = timeoutSeconds;
    dockerManager.isContainerRunning(this.containerName).then(res => {
      if (res) this.resetConnectionTimeout();
      this.containerRunning = res;
    });
  }

  private async stopHost(): Promise<void> {
    if (this.stoppingHost) return;
    this.stoppingHost = true;

    this.containerRunning = false;
    this.stopConnectionTimeout();

    if (await dockerManager.isContainerRunning(this.containerName)) {
      console.log(`🛏  Putting ${this.containerName} to sleep`);
      await dockerManager.stopContainer(this.containerName);
    }

    this.stoppingHost = false;
  }

  private async startHost(): Promise<void> {
    if (this.startingHost) return;
    this.startingHost = true;

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

    this.startingHost = false;
  }

  private startConnectionTimeout(): void {
    this.connectionTimeoutId = setTimeout(
      () => this.onConnectionTimeout(), this.timeoutSeconds * 1000
    );
  }

  private resetConnectionTimeout(): void {
    this.stopConnectionTimeout();
    this.startConnectionTimeout();
  }

  private onConnectionTimeout(): void {
    if (this.activeSockets.size > 0) {
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
}
