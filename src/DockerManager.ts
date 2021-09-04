import Docker from 'dockerode';

export default class DockerManager {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  private findContainerByName(name: string): Docker.Container {
    return this.docker.getContainer(name);
  }

  public async isContainerRunning(name: string): Promise<boolean> {
    return (await this.findContainerByName(name).inspect()).State.Running;
  }

  public async startContainer(name: string): Promise<void> {
    return this.findContainerByName(name).start();
  }

  public async stopContainer(name: string): Promise<void> {
    return this.findContainerByName(name).stop();
  }
}
