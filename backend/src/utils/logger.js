const winston = require('winston');
const path = require('path');
const fs = require('fs');
const {
  LOG_MAX_SIZE_BYTES,
  LOG_MAX_FILES,
  LOG_RETENTION_DAYS,
  startLogRetentionCleanup,
} = require('./logRetention');

// Ensure logs directory exists.
//
// LOG_DIR lets a deployment put logs somewhere other than <backend>/logs. The
// all-in-one image (#1042) mounts one volume at /data and points this at
// /data/logs, so logs survive a container replacement like everything else.
// Unset — every existing compose and native install — keeps the old path.
const logDir = process.env.LOG_DIR || path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Keep three 10 MiB generations per log and prune rotated files older than
// 14 days once a day, including when traffic is too low to trigger rotation.

// Custom format for production logs
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(info => {
    // Ensure all security events are properly formatted
    if (info.level === 'warn' && (info.message.includes('rate limit') || 
                                   info.message.includes('auth') ||
                                   info.message.includes('login') ||
                                   info.message.includes('JWT'))) {
      return JSON.stringify({
        timestamp: info.timestamp,
        level: info.level,
        message: info.message,
        security: true,
        ...info
      });
    }
    return JSON.stringify(info);
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: productionFormat,
  transports: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: LOG_MAX_SIZE_BYTES,
      maxFiles: LOG_MAX_FILES,
      tailable: true
    }),
    new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log'),
      maxsize: LOG_MAX_SIZE_BYTES,
      maxFiles: LOG_MAX_FILES,
      tailable: true
    }),
    // Separate security log for authentication and rate limiting
    new winston.transports.File({
      filename: path.join(logDir, 'security.log'),
      level: 'warn',
      maxsize: LOG_MAX_SIZE_BYTES,
      maxFiles: LOG_MAX_FILES,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.json(),
        winston.format.printf(info => {
          // Only log security-related warnings
          if (info.message.includes('rate limit') || 
              info.message.includes('auth') ||
              info.message.includes('login') ||
              info.message.includes('JWT') ||
              info.message.includes('lockout') ||
              info.message.includes('suspicious')) {
            return JSON.stringify(info);
          }
          return null;
        })
      )
    })
  ].filter(Boolean)
});

startLogRetentionCleanup({ logDir, logger, retentionDays: LOG_RETENTION_DAYS });

// Add console logging for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(info => {
        return `[${info.timestamp}] ${info.level}: ${info.message} ${info.stack || ''}`;
      })
    )
  }));
} else {
  // In production, also log to console for container environments
  if (process.env.LOG_TO_CONSOLE === 'true') {
    logger.add(new winston.transports.Console({
      format: productionFormat
    }));
  }
}

module.exports = logger;
