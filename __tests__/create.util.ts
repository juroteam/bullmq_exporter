import { Processor, Queue, QueueEvents, Worker } from 'bullmq';
import { Registry } from 'prom-client';
import IoRedis from 'ioredis';

import { makeGuages, QueueGauges } from '../src/queue-gauges';

export interface TestData {
	name: string;
	queue: Queue;
	prefix: string;
	guages: QueueGauges;
	registry: Registry;
	events: QueueEvents;
	worker?: Worker;
}

const getSentinelConfig = () => {
	const sentinelHosts = process.env.TEST_SENTINEL_HOSTS || 'redis-sentinel:26379';
	const sentinelName = process.env.TEST_SENTINEL_NAME || 'redis-master';
	const sentinelPassword = process.env.TEST_SENTINEL_PASSWORD;

	return {
		sentinels: sentinelHosts.split(',').map(host => {
			const [hostname, port] = host.trim().split(':');
			return { host: hostname, port: parseInt(port) || 26379 };
		}),
		name: sentinelName,
		password: sentinelPassword,
	};
};

const createRedisOptions = () => {
	const sentinelConfig = getSentinelConfig();
	return {
		sentinels: sentinelConfig.sentinels,
		name: sentinelConfig.name,
		password: sentinelConfig.password,
		db: 0,
		retryDelayOnFailover: 100,
		maxRetriesPerRequest: null,
		connectTimeout: 30000,
		commandTimeout: 15000,
		lazyConnect: true,
		keepAlive: 30000,
		enableReadyCheck: true,
		sentinelRetryStrategy: (times: number) => {
			const delay = Math.min(times * 100, 5000);
			return delay;
		},
	};
};

const redisOptions = createRedisOptions();

async function waitUntilReady(waitable: { waitUntilReady: () => Promise<unknown> }) {
	if (process.env.WAIT_UNTIL_READY === 'TRUE') {
	  await waitable.waitUntilReady();
	}
}

export async function makeQueue(name: string = 'TestQueue', prefix: string = 'test-queue'): Promise<TestData> {
	const registry = new Registry();

	const defaultRedisClient = new IoRedis(redisOptions);
	defaultRedisClient.setMaxListeners(32);

	const eventsRedis = new IoRedis(redisOptions);
	eventsRedis.setMaxListeners(32);

	defaultRedisClient.on('error', (error) => {
		console.error(`Default Redis client error for queue ${name}:`, error.message);
	});

	eventsRedis.on('error', (error) => {
		console.error(`Events Redis error for queue ${name}:`, error.message);
	});

	const queue = new Queue(name, { connection: defaultRedisClient });
	const events = new QueueEvents(name, { connection: eventsRedis });

	console.log(`Waiting for queue ${name} and events to be ready...`);
	try {
		await Promise.all([
			waitUntilReady(queue),
			waitUntilReady(events),
		]);
		console.log(`Queue ${name} and events are ready`);
	} catch (error) {
		console.error(`Failed to initialize queue ${name}:`, error);
		throw error;
	}

	return {
		name,
		queue,
		prefix,
		registry,
		guages: makeGuages('test_stat_', [registry]),
		events,
	};
}

export async function makeWorker(name: string = 'TestQueue', func: Processor): Promise<Worker> {
	const workerRedis = new IoRedis(redisOptions);
	workerRedis.setMaxListeners(32);

	const worker = new Worker(name, func, { connection: workerRedis });
	await waitUntilReady(worker);
	return worker;
}

/**
 * Cleanup function that properly closes all Redis connections and BullMQ objects
 */
export async function cleanupTestData(testData: TestData): Promise<void> {
	console.log(`Cleaning up test data for queue: ${testData.name}`);

	try {
		// Close BullMQ objects first - this will handle Redis connections properly
		console.log('Closing BullMQ objects...');
		await Promise.all([
			testData.queue.close(),
			testData.events.close(),
		]);
		console.log('BullMQ objects closed successfully');

		// Give Redis connections time to close
		await new Promise(resolve => setTimeout(resolve, 200));
		console.log('Cleanup completed with delay');

	} catch (error) {
		console.error(`Error during cleanup for queue ${testData.name}:`, error);
		throw error;
	}
}

/**
 * Cleanup function for workers
 */
export async function cleanupWorker(worker: Worker): Promise<void> {
	console.log(`Cleaning up worker: ${worker.name}`);

	try {
		// Close the worker - this will handle Redis connections properly
		await worker.close();
		console.log(`Worker ${worker.name} closed successfully`);

		// Give Redis connections time to close
		await new Promise(resolve => setTimeout(resolve, 100));
		console.log('Worker cleanup completed with delay');

	} catch (error) {
		console.error(`Error during worker cleanup for ${worker.name}:`, error);
		throw error;
	}
}
