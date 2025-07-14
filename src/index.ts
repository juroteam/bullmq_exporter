import promClient from 'prom-client';

import { logger } from './utils/logger';
import { getOptions } from './utils/options';
import { startServer } from './app';
import CollectorApi from './collector/api';

export async function printOnce(): Promise<void> {
	const opts = getOptions();

	const collector = CollectorApi.getCollector();
	logger.info('Collector obtained successfully');

	if (opts.autoDiscover) {
		logger.info('Starting auto-discovery...');
		await collector.discoverAll();
		logger.info('Auto-discovery completed');
	}

	logger.info('Updating metrics...');
	await collector.updateAll();
	logger.info('Metrics updated successfully');

	logger.info('Closing collector...');
	const closePromise = collector.close();
	const timeoutPromise = new Promise((_, reject) =>
		setTimeout(() => reject(new Error('Close timeout')), 2000)
	);

	try {
		await Promise.race([closePromise, timeoutPromise]);
		logger.info('Collector closed successfully');
	} catch (error) {
		logger.warn('Collector close timed out or failed:', error);
		// Force disconnect the Redis client
		logger.info('Force disconnecting Redis client...');
		collector['defaultRedisClient'].disconnect();
		logger.info('Redis client force disconnected');
	}

	logger.info('Outputting metrics...');
	logger.info(promClient.register.metrics());
}

export async function runServer(): Promise<void> {
	const { done } = await startServer();
	await done;
}

export async function main(...args: string[]): Promise<void> {
	const opts = getOptions(...args);
	logger.info('Main function started with options:', { once: opts.once, autoDiscover: opts.autoDiscover });

	if (opts.once) {
		logger.info('Running in printOnce mode...');
		await printOnce();
		logger.info('printOnce completed, forcing exit...');
		process.exit(0); // Force exit immediately after printOnce
	} else {
		logger.info('Running in server mode...');
		await runServer();
	}
	logger.info('Main function completed');
}

if (require.main === module) {
	const args = process.argv.slice(2);
	logger.info('Application starting with args:', args);

	let exitCode = 0;
	main(...args)
		.catch((error) => {
			logger.error('Main function failed:', error);
			process.exitCode = exitCode = 1;
		})
		.then(() => {
			logger.info('Main function completed successfully, setting up exit timeout...');
			setTimeout(() => {
				logger.error('No clean exit after 5 seconds, force exit');
				process.exit(exitCode);
			}, 5000).unref();
		})
		.catch((err) => {
			console.error('Double error');
			console.error(err.stack);
			process.exit(-1);
		});
}
