import fs from 'fs';
import Chokidar from 'chokidar';
import YAML from 'yaml';
import logger from './Logger';
import ProxyHost from './ProxyHost';

export default class ConfigManager {
  private configFile = 'config/config.yml';
  private proxyHosts: Map<string, ProxyHost>;

  constructor(proxyHosts: Map<string, ProxyHost>) {
    this.proxyHosts = proxyHosts;
    this.createIfNotExist();
    this.parseConfig();
    this.watch();
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
      this.parseConfig();
    });
  }

  private parseConfig(): void {
    const fileContent = fs.readFileSync(this.configFile, 'utf-8');
    const config = YAML.parse(fileContent);

    if (!config || !config.proxyHosts) {
      logger.error({ invalidProperty: 'proxyHosts' }, 'config is invalid, missing property');
    } else {
      this.loadProxyHosts(config.proxyHosts);
    }
  }

  private loadProxyHosts(proxyHosts: Record<string, unknown>[]): void {
    logger.info('(Re)loading hosts, clearing all existing hosts first');
    this.clearOldProxyHosts();
    proxyHosts.forEach((proxyHostConfig: Record<string, unknown>) => {
      if (!ConfigManager.validateProxyHost(proxyHostConfig)) {
        logger.error({ proxyHost: proxyHostConfig }, 'config contains invalid proxyHost object');
      } else {
        this.proxyHosts.set(
          proxyHostConfig.domain as string,
          new ProxyHost( // TODO
            proxyHostConfig.domain as string,
            proxyHostConfig.containerName as string,
            proxyHostConfig.proxyHost as string,
            proxyHostConfig.proxyPort as number,
            proxyHostConfig.timeoutSeconds as number
          )
        );
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
    if (!proxyHostConfig.timeoutSeconds) {
      return false;
    }

    return true;
  }
}
