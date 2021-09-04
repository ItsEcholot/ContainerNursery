import { ProxyTarget } from 'http-proxy';
import internal from 'stream';
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
    clearTimeout(this.connectionTimeoutId as NodeJS.Timeout);
    this.connectionTimeoutId = null;

    if (await dockerManager.isContainerRunning(this.containerName)) {
      console.log(`🛏 Putting ${this.containerName} to sleep`);
      await dockerManager.stopContainer(this.containerName);
    }
    this.containerRunning = false;
  }

  private async startHost(): Promise<void> {
    if (!(await dockerManager.isContainerRunning(this.containerName))) {
      console.log(`⏰ Waking ${this.containerName} up`);
      await dockerManager.startContainer(this.containerName);
    }

    this.containerRunning = true;
    this.resetConnectionTimeout();
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
      host: this.proxyHost,
      port: this.proxyPort
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
