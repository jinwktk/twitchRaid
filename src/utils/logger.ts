import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";

const LOG_DIR = path.resolve(__dirname, "../../logs");

const formatMessage = ({ level, message }: { level: string; message: unknown }) =>
  `[${level.toUpperCase()}] ${message}`;

const dailyLogFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(
    ({ timestamp, level, message }) =>
      `${timestamp} ${formatMessage({ level, message })}`
  )
);

const excludeFileOnly = winston.format((info) =>
  info.fileOnly === true ? false : info
);

const consoleLogFormat = winston.format.combine(
  excludeFileOnly(),
  winston.format.printf(formatMessage)
);

const dailyRotate = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: "bot_%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "10",
  format: dailyLogFormat,
});

const levels = {
  error: 0,
  warn: 1,
  success: 2,
  info: 3,
  debug: 4,
};

const logger = winston.createLogger({
  levels,
  level: "info",
  transports: [
    dailyRotate,
    new winston.transports.Console({ format: consoleLogFormat }),
  ],
});

export default logger;
