import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure the logs directory exists
const logsDir = path.join(process.cwd(), 'logs'); // or __dirname + '/logs'
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

export function createAccountLogger(accountName: string) {
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'DD-MM-YYYY | HH:mm:ss' }),
      // Format: [timestamp] [LEVEL] [accountName] message
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `[${timestamp}] [${level.toUpperCase()}] [${accountName}] ${message} ${metaString}`;
      })
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({
        filename: path.join(logsDir, `${accountName.replace(/\s+/g, '_')}.log`),
      }),
    ],
  });
}
