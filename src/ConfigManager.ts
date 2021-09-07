import fs from 'fs';
import YAML from 'yaml';
import ProxyHost from './ProxyHost';

export default class ConfigManager {
  private configFile = 'config.yml';
  private proxyHosts: Map<string, ProxyHost>;

  constructor(proxyHosts: Map<string, ProxyHost>) {
    this.proxyHosts = proxyHosts;
    this.createIfNotExist();
    this.parseConfig();
    this.watch();
  }

  private createIfNotExist(): void {
    if (!fs.existsSync(this.configFile)) {
      console.error('config.yml is missing, creating empty file...');
      fs.closeSync(fs.openSync(this.configFile, 'w'));
    }
  }

  private watch(): void {
    fs.watch(this.configFile, (event) => {
      if (event === 'change') {
        console.log('Config changed, reloading');
        this.parseConfig();
      }
    });
  }

  private parseConfig(): void {
    const fileContent = fs.readFileSync(this.configFile, 'utf-8');
    const config = YAML.parse(fileContent);

    if (!config || !config.proxyHosts) {
      console.error('⛔️ config.yml is invalid, \'proxyHosts\' property is missing');
    } else {
      this.loadProxyHosts(config.proxyHosts);
    }
  }

  private loadProxyHosts(proxyHosts: Record<string, unknown>[]): void {
    this.clearOldProxyHosts();
    proxyHosts.forEach((proxyHostConfig: Record<string, unknown>) => {
      if (!ConfigManager.validateProxyHost(proxyHostConfig)) {
        console.error(`⛔️ config.yml contains invalid proxyHost with the following config: \n${YAML.stringify(proxyHostConfig)}`);
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
