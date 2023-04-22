import { ProxyTarget } from 'http-proxy';
import internal, { EventEmitter } from 'stream';
import fetch from 'node-fetch';
import logger from './Logger';
import DockerManager from './DockerManager';

const dockerManager = new DockerManager();

export default class ProxyHost {
  private domain: string[];
  private containerName: string[];
  private proxyHost: string;
  private proxyPort: number;
  public proxyUseHttps = false;
  private timeoutSeconds: number;
  public stopOnTimeoutIfCpuUsageBelow = Infinity;

  private activeSockets: Set<internal.Duplex> = new Set();
  private containerEventEmitter: EventEmitter | null = null;
  private connectionTimeoutId: NodeJS.Timeout | null = null;
  private containerRunning: boolean | undefined = undefined;
  private containerReadyChecking = false;
  private startingHost = false;
  private stoppingHost = false;

  private cpuAverage = 0;
  private cpuAverageCounter = 0;
  private lastContainerCPUUsage = 0;
  private lastSystemCPUUsage = 0;

  constructor(
    domain: string[],
    containerName: string[],
    proxyHost: string,
    proxyPort: number,
    timeoutSeconds: number
  ) {
    logger.info({
      host: domain,
      container: containerName,
      proxy: {
        host: proxyHost,
        port: proxyPort,
        useHttps: this.proxyUseHttps
      },
      timeoutSeconds: timeoutSeconds
    }, 'Added proxy host');

    this.domain = domain;
    this.containerName = containerName;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.timeoutSeconds = timeoutSeconds;
    dockerManager.isContainerRunning(this.containerName[0]).then(async (res) => {
      if (res) this.resetConnectionTimeout();
      this.containerRunning = res;

      const otherContainers = this.containerName.slice(1);
      const otherContainerChecks: Promise<boolean>[] = [];
      otherContainers.forEach(otherContainerName => {
        otherContainerChecks.push(dockerManager.isContainerRunning(otherContainerName));
      });
      (await Promise.all(otherContainerChecks)).forEach((otherContainerRunning, i) => {
        if (this.containerRunning === otherContainerRunning) return;
        if (otherContainerRunning) {
          logger.debug({ mainContainer: otherContainers[i], container: otherContainers[i] }, 'Stopping other container because main container isn\'t running');
          dockerManager.stopContainer(otherContainers[i]);
        } else {
          logger.debug({ mainContainer: otherContainers[i], container: otherContainers[i] }, 'Starting other container because main container is running');
          dockerManager.startContainer(otherContainers[i]);
        }
      });

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

    dockerManager.getContainerStatsEventEmitter(this.containerName[0]).then(eventEmitter => {
      eventEmitter.on('update', data => {
        if (!this.containerRunning || !data.cpu_stats.cpu_usage.percpu_usage) return;

        this.calculateCPUAverage(
          data.cpu_stats.cpu_usage.total_usage,
          data.cpu_stats.system_cpu_usage,
          data.cpu_stats.cpu_usage.percpu_usage.length
        );
      });
    });
  }

  private async stopHost(): Promise<void> {
    if (this.stoppingHost) return;
    this.stoppingHost = true;

    this.containerRunning = false;
    this.stopConnectionTimeout();

    await Promise.all(this.containerName.map(async (container) => {
      if (await dockerManager.isContainerRunning(container)) {
        logger.info({ container, cpuUsageAverage: container === this.containerName[0] ? this.cpuAverage : undefined }, 'Stopping container');
        await dockerManager.stopContainer(container);
        logger.debug({ container }, 'Stopping container complete');
      }
    }));

    this.stoppingHost = false;
  }

  private async startHost(): Promise<void> {
    if (this.startingHost) return;
    this.startingHost = true;

    await Promise.all(this.containerName.map(async (container) => {
      if (!(await dockerManager.isContainerRunning(container))) {
        logger.info({ container }, 'Starting container');
        await dockerManager.startContainer(container);
        logger.debug({ container }, 'Starting container complete');
      }
    }));

    this.checkContainerReady();
    this.startingHost = false;
  }

  private checkContainerReady() {
    if (this.containerReadyChecking) return;

    this.containerReadyChecking = true;
    const checkInterval = setInterval(() => {
      this.resetConnectionTimeout();

      fetch(`http${this.proxyUseHttps ? 's' : ''}://${this.proxyHost}:${this.proxyPort}`, {
        method: 'HEAD'
      }).then(res => {
        logger.debug({
          domain: this.domain,
          proxyHost: this.proxyHost,
          proxyPort: this.proxyPort,
          status: res.status,
          headers: res.headers
        }, 'Checked if target is ready');

        if (res.status === 200 || (res.status >= 300 && res.status <= 399) || res.status === 404) {
          clearInterval(checkInterval);
          this.containerReadyChecking = false;
          this.containerRunning = true;

          logger.debug({
            domain: this.domain,
            proxyHost: this.proxyHost,
            proxyPort: this.proxyPort
          }, 'Target is ready');
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
    logger.debug({
      domain: this.domain,
      timeoutSeconds: this.timeoutSeconds
    }, 'Resetting connection timeout');
    this.stopConnectionTimeout();
    this.startConnectionTimeout();
    this.resetCPUAverage();
  }

  private onConnectionTimeout(): void {
    if (this.activeSockets.size > 0) {
      logger.debug({
        domain: this.domain,
        activeSocketCount: this.activeSockets.size
      }, 'Reached timeout but there are still active sockets');
      this.resetConnectionTimeout();
      return;
    }
    if (this.cpuAverage > this.stopOnTimeoutIfCpuUsageBelow) {
      logger.debug({
        domain: this.domain,
        container: this.containerName[0],
        cpuUsageAverage: this.cpuAverage
      }, 'Reached timeout but the container cpu usage is above the minimum configured');
      this.resetConnectionTimeout();
      return;
    }

    this.stopHost();
  }

  private calculateCPUAverage(cpuUsage: number, systemCPUUsage: number, cpuCount: number): void {
    let cpuPercentage = 0;
    const cpuDelta = cpuUsage - this.lastContainerCPUUsage;
    const systemDelta = systemCPUUsage - this.lastSystemCPUUsage;

    if (cpuDelta > 0 && systemDelta > 0) {
      cpuPercentage = (cpuDelta / systemDelta) * cpuCount * 100;

      // using exponential weighted moving average
      const factor = 30; // if 1, then average = current value
      this.cpuAverageCounter += 1;
      this.cpuAverage += (cpuPercentage - this.cpuAverage) / Math.min(this.cpuAverageCounter, factor);
    }

    this.lastContainerCPUUsage = cpuUsage;
    this.lastSystemCPUUsage = systemCPUUsage;
  }

  private resetCPUAverage(): void {
    this.cpuAverage = 0;
    this.cpuAverageCounter = 0;
  }

  public getHeaders(): { [header: string]: string; } {
    return {
      'x-container-nursery-container-name': this.containerName[0]
    };
  }

  public getTarget(): ProxyTarget {
    return {
      protocol: this.proxyUseHttps && this.containerRunning ? 'https:' : 'http:',
      host: this.containerRunning ? this.proxyHost : '127.0.0.1',
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
