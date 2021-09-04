import { ProxyTarget } from 'http-proxy';
import internal from 'stream';

export default class ProxyHost {
  private domain: string;
  private containerName: string;
  private proxyHost: string;
  private proxyPort: number;
  private timeoutSeconds: number;

  private activeSockets: Set<internal.Duplex> = new Set();
  private connectionTimeoutId: NodeJS.Timeout | null = null;

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
  }

  private stopHost(): void {
    console.log(`🛏 Putting ${this.containerName} to sleep`);
    // TODO
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
    this.resetConnectionTimeout();
  }

  public newSocketConnection(socket: internal.Duplex): void {
    this.resetConnectionTimeout();

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
