import Pino from 'pino';

const transport = Pino.transport({
  target: 'pino-pretty',
  options: {
    destination: 1,
    levelFirst: true,
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname'
  }
});

export default Pino({
  level: process.env.LOG_LEVEL || 'info'
}, process.env.LOG_JSON === 'true' ? undefined : transport);
