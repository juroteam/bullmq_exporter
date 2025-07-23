import * as crypto from 'crypto';

export function getCurrentTestHash(): string {
  return crypto.createHash('md5')
    .update(expect.getState().currentTestName)
    .digest('hex')
    .slice(0, 16);
}

// Global error handler for tests
process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.warn('Uncaught Exception:', error);
});
