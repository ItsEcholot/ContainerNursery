import fs from 'fs';
import Chokidar from 'chokidar';
import YAML from 'yaml';
import logger from './Logger';
import ProxyHost from './ProxyHost';
import EventEmitter from 'events';

const defaultProxyListeningPort = 80;
const placeholderServerListeningPort = 8080;

type ProxyHostConfig = {
  domain: string | string[]
  containerName: string | string[]
  proxyHost: string
  proxyPort: number
  proxyUseHttps: boolean
  timeoutSeconds: number
  stopOnTimeoutIfCpuUsageBelow?: number
}
type ApplicationConfig = {
  proxyListeningPort: number,
  proxyHosts: ProxyHostConfig[]
}

export default class ConfigManager {
  private configFile = 'config/config.yml';
  private proxyHosts: Map<string, ProxyHost>;
  private proxyListeningPort: number | null;
  private eventEmitter: EventEmitter;

  constructor(proxyHosts: Map<string, ProxyHost>) {
    this.proxyHosts = proxyHosts;
    this.proxyListeningPort = null;
    this.eventEmitter = new EventEmitter();
    this.createIfNotExist();
    this.parseConfig();
    this.watch();
  }

  private static parsePort(p: number): number | null {
    if (Number.isInteger(p) && p >= 0 && p <= 49151) {
      return p;
    }

    logger.warn({ portString: p }, 'Parsing proxy listening port failed! Is a valid value used (0-49151)?');
    return null;
  }

  // eslint-disable-next-line no-unused-vars
  public on(event: string, cb: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, cb);
  }

  public getProxyListeningPort(): number {
    if (this.proxyListeningPort
      && this.proxyListeningPort !== placeholderServerListeningPort) {
      return this.proxyListeningPort;
    }
    if (this.proxyListeningPort === placeholderServerListeningPort) {
      logger.warn({ placeholderServerListeningPort, desiredProxyListeningPort: this.proxyListeningPort }, "Can't use the same port as the internal placeholder server uses");
    }

    if (process.env.CN_PORT) {
      this.proxyListeningPort = ConfigManager.parsePort(parseInt(process.env.CN_PORT, 10));
      if (this.proxyListeningPort
        && this.proxyListeningPort !== placeholderServerListeningPort) {
        return this.proxyListeningPort;
      }
    }

    logger.warn({ port: defaultProxyListeningPort }, 'Using default proxy listening port');
    this.proxyListeningPort = defaultProxyListeningPort;
    return this.proxyListeningPort;
  }

  private createIfNotExist(): void {
    if (!fs.existsSync(this.configFile)) {
      fs.closeSync(fs.openSync(this.configFile, 'w'));
      logger.error('config.yml is missing, empty config file was created');
    }
  }

  private watch(): void {
    Chokidar.watch(this.configFile).on('change', () => {
      logger.info('Config changed, reloading hosts');
      setTimeout(() => this.parseConfig(), 500);
    });
  }

  private parseConfig(): void {
    const fileContent = fs.readFileSync(this.configFile, 'utf-8');
    const config: ApplicationConfig = YAML.parse(fileContent);

    if (!config || !config.proxyHosts) {
      logger.error({ invalidProperty: 'proxyHosts' }, 'Config is invalid, missing property');
    } else {
      this.loadProxyHosts(config.proxyHosts);
      if (config.proxyListeningPort) {
        const prevPort = this.proxyListeningPort;
        this.proxyListeningPort = ConfigManager.parsePort(config.proxyListeningPort);
        if (prevPort !== null && prevPort !== this.proxyListeningPort) {
          this.eventEmitter.emit('port-update');
        }
      }
    }
  }

  private loadProxyHosts(proxyHosts: ProxyHostConfig[]): void {
    logger.info('(Re)loading hosts, clearing all existing hosts first');
    this.clearOldProxyHosts();
    proxyHosts.forEach(proxyHostConfig => {
      if (!ConfigManager.validateProxyHost(proxyHostConfig)) {
        logger.error({ proxyHost: proxyHostConfig }, 'Config contains invalid proxyHost object');
      } else {
        const proxyHost = new ProxyHost( // TODO
          proxyHostConfig.domain instanceof Array
            ? proxyHostConfig.domain
            : [proxyHostConfig.domain],
          proxyHostConfig.containerName instanceof Array
            ? proxyHostConfig.containerName
            : [proxyHostConfig.containerName],
          proxyHostConfig.proxyHost,
          proxyHostConfig.proxyPort,
          proxyHostConfig.timeoutSeconds
        );

        if (proxyHostConfig.proxyUseHttps) {
          proxyHost.proxyUseHttps = proxyHostConfig.proxyUseHttps;
        }

        if (proxyHostConfig.stopOnTimeoutIfCpuUsageBelow) {
          proxyHost.stopOnTimeoutIfCpuUsageBelow = proxyHostConfig.stopOnTimeoutIfCpuUsageBelow as number;
        }

        if (proxyHostConfig.domain instanceof Array) {
          proxyHostConfig.domain.forEach(domain => {
            this.proxyHosts.set(
              domain,
              proxyHost
            );
          });
        } else {
          this.proxyHosts.set(
            proxyHostConfig.domain as string,
            proxyHost
          );
        }
      }
    });
  }

  private clearOldProxyHosts(): void {
    this.proxyHosts.forEach(proxyHost => {
      proxyHost.stopConnectionTimeout();
      proxyHost.stopContainerEventEmitter();
    });
    this.proxyHosts.clear();
  }

  private static validateProxyHost(proxyHostConfig: Record<string, unknown>): boolean {
    // TODO
    if (!proxyHostConfig.domain) return false;
    if (!proxyHostConfig.containerName) return false;
    if (!proxyHostConfig.proxyHost) return false;
    if (!proxyHostConfig.proxyPort) return false;
    if (!proxyHostConfig.timeoutSeconds) return false;

    return true;
  }
}
