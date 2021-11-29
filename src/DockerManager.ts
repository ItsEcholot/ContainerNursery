import EventEmitter from 'events';
import Docker from 'dockerode';
import logger from './Logger';

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

  public async getContainerEventEmitter(names: string[]): Promise<EventEmitter> {
    const eventEmitter = new EventEmitter();
    const readableStream = await this.docker.getEvents({
      filters: {
        container: names
      }
    });

    readableStream.on('data', chunk => {
      try {
        eventEmitter.emit('update', JSON.parse(chunk.toString('utf-8')));
      } catch (err) {
        logger.error(err, 'JSON parsing of Docker Event failed');
      }
    });

    eventEmitter.on('stop-stream', () => {
      readableStream.removeAllListeners();
    });

    return eventEmitter;
  }

  public async getContainerStatsEventEmitter(name: string): Promise<EventEmitter> {
    const eventEmitter = new EventEmitter();
    const statsStream = await this.findContainerByName(name)
      .stats({ stream: true }) as unknown as NodeJS.ReadableStream;

    statsStream.on('data', chunk => {
      try {
        eventEmitter.emit('update', JSON.parse(chunk.toString('utf-8')));
      } catch (err) {
        logger.error(err, 'JSON parsing of Docker Event failed');
      }
    });

    eventEmitter.on('stop-stream', () => {
      statsStream.removeAllListeners();
    });

    return eventEmitter;
  }
}
