import { Queue, QueueEvents, QueueOptions } from 'bullmq';
import * as Logger from 'bunyan';
import IoRedis, { Redis } from 'ioredis';
import { register as globalRegister, Registry } from 'prom-client';

import { logger, logger as globalLogger } from '../utils/logger';
import { getJobCompleteStats, getStats, makeGuages, QueueGauges } from '../queue-gauges';
import { getOptions } from '../utils/options';

export interface QueueData<T = unknown> {
	queue: Queue<T>;
	name: string;
	prefix: string;
	queueEvents: QueueEvents;
}

export class MetricsCollector {
	private readonly logger: Logger;

	private readonly defaultRedisClient: Redis;
	private readonly bullOpts: Pick<QueueOptions, 'prefix'>;
	private readonly queuesByName: Map<string, QueueData<unknown>> = new Map();
	private readonly redisClients: Set<Redis> = new Set(); // Track all Redis clients

	private get queues(): QueueData<unknown>[] {
		return [...this.queuesByName.values()];
	}

	private readonly myListeners: Set<(id: string) => Promise<void>> = new Set();

	private readonly guages: QueueGauges;

	private readonly sentinelConfig: {
		sentinels: Array<{ host: string; port: number }>;
		name: string;
		password?: string;
	};

	constructor(queueNames: string[], registers: Registry[] = [globalRegister]) {
		const opts = getOptions();

		// Create Sentinel configuration
		this.sentinelConfig = {
			sentinels: opts.sentinelHosts.split(',').map(host => {
				const [hostname, port] = host.trim().split(':');
				return { host: hostname, port: parseInt(port) || 26379 };
			}),
			name: opts.sentinelName,
			password: opts.sentinelPassword,
		};

		// Create Redis connection with Sentinel
		const redisOptions = this.createRedisOptions();
		this.defaultRedisClient = new IoRedis(redisOptions);
		this.defaultRedisClient.setMaxListeners(32);

		// Add error logging
		this.defaultRedisClient.on('error', (error) => {
			this.logger.error('Redis client error:', error);
		});

		this.bullOpts = { prefix: opts.prefix };
		this.logger = logger || globalLogger;
		this.addToQueueSet(queueNames);
		this.guages = makeGuages(opts.metricPrefix, registers);
	}

	private createRedisOptions() {
		return {
			sentinels: this.sentinelConfig.sentinels,
			name: this.sentinelConfig.name,
			password: this.sentinelConfig.password,
			db: 0,
			retryDelayOnFailover: 100,
			maxRetriesPerRequest: null,
			connectTimeout: 30000,
			commandTimeout: 15000,
			lazyConnect: true,
			keepAlive: 30000,
			enableReadyCheck: true,
			// Sentinel specific options
			sentinelRetryStrategy: (times: number) => {
				const delay = Math.min(times * 100, 5000);
				return delay;
			},
		};
	}

	private addToQueueSet(names: string[]): void {
		for (const name of names) {
			if (this.queuesByName.has(name)) {
				continue;
			}
			this.logger.info('added queue', name);

			// Create separate Redis connection for QueueEvents
			const queueEventsRedisOptions = this.createRedisOptions();
			const queueEventsRedis = new IoRedis(queueEventsRedisOptions);

			queueEventsRedis.on('error', (error) => {
				this.logger.error(`QueueEvents Redis error for queue ${name}:`, error);
			});

			this.queuesByName.set(name, {
				name,
				queue: new Queue(name, {
					...this.bullOpts,
					connection: this.defaultRedisClient,
				}),
				prefix: this.bullOpts.prefix || 'bull',
				queueEvents: new QueueEvents(name, {
					...this.bullOpts,
					connection: queueEventsRedis, // QueueEvents instances must not reuse Redis connections, see https://docs.bullmq.io/guide/connections
				}),
			});
		}
	}

	public async discoverAll(): Promise<void> {
		const keyPattern = new RegExp(`^${this.bullOpts.prefix}:([^:]+):(id|failed|active|waiting|stalled-check)$`);
		this.logger.info({ pattern: keyPattern.source }, 'running queue discovery');

		try {
			this.logger.info('Starting Redis scan stream...');
			const keyStream = this.defaultRedisClient.scanStream({
				match: `${this.bullOpts.prefix}:*:*`,
			});

			// tslint:disable-next-line:await-promise tslint does not like Readable's here
			for await (const keyChunk of keyStream) {
				this.logger.debug('Processing key chunk:', keyChunk.length, 'keys');
				for (const key of keyChunk) {
					const match = keyPattern.exec(key);
					if (match && match[1]) {
						this.addToQueueSet([match[1]]);
					}
				}
			}
			this.logger.info('Queue discovery completed successfully');
		} catch (error) {
			this.logger.error('Queue discovery failed:', error);
			throw error;
		}
	}

	private async onJobComplete(queue: QueueData, id: string): Promise<void> {
		try {
			const job = await queue.queue.getJob(id);
			if (!job) {
				this.logger.warn({ job: id }, 'unable to find job from id');
				return;
			}
			await getJobCompleteStats(queue.prefix, queue.name, job, this.guages);
		} catch (err) {
			this.logger.error({ err, job: id }, 'unable to fetch completed job');
		}
	}

	public collectJobCompletions(): void {
		for (const q of this.queues) {
			const cb = this.onJobComplete.bind(this, q);
			this.myListeners.add(cb);
			q.queueEvents.on('completed', ({ jobId }) => cb(jobId));
		}
	}

	public async updateAll(): Promise<void> {
		this.logger.debug('Starting metrics update for', this.queues.length, 'queues');
		const updatePromises = this.queues.map(async (q) => {
			try {
				this.logger.debug('Updating metrics for queue:', q.name);
				await getStats(q.prefix, q.name, q.queue, this.guages);
				this.logger.debug('Metrics updated for queue:', q.name);
			} catch (error) {
				this.logger.error('Failed to update metrics for queue:', q.name, error);
				throw error;
			}
		});
		await Promise.all(updatePromises);
		this.logger.debug('All metrics updated successfully');
	}

	public async ping(): Promise<void> {
		try {
			this.logger.debug('Sending Redis ping...');
			await this.defaultRedisClient.ping();
			this.logger.debug('Redis ping successful');
		} catch (error) {
			this.logger.error('Redis ping failed:', error);
			throw error;
		}
	}

	public async close(): Promise<void> {
		this.logger.info('Starting close process...');

		this.logger.info('Removing event listeners...');
		for (const q of this.queues) {
			for (const l of this.myListeners) {
				q.queueEvents.removeListener('completed', l);
			}
		}
		this.logger.info('Event listeners removed.');

		this.logger.info('Closing queues and queue events...');
		const closePromises = this.queues.map(async (q) => {
			try {
				const queueClosePromise = q.queue.close();
				const queueTimeoutPromise = new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Queue close timeout')), 500)
				);
				await Promise.race([queueClosePromise, queueTimeoutPromise]);
			} catch (error) {
				this.logger.warn('Queue close timed out, continuing:', error);
			}
			try {
				const eventsClosePromise = q.queueEvents.close();
				const eventsTimeoutPromise = new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Queue events close timeout')), 500)
				);
				await Promise.race([eventsClosePromise, eventsTimeoutPromise]);
			} catch (error) {
				this.logger.warn('Queue events close timed out, continuing:', error);
			}
		});

		await Promise.all(closePromises);
		this.logger.info('BullMQ objects closed.');

		this.logger.info('Disconnecting Redis clients...');
		this.defaultRedisClient.disconnect();
		this.logger.info('Redis clients disconnected.');

		this.logger.info('Close process completed.');
	}
}
