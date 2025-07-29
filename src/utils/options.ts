import yargs from 'yargs';

import { version } from '../../package.json';

export interface Options {
	prefix: string;
	metricPrefix: string;
	once: boolean;
	port: number;
	bindAddress: string;
	autoDiscover: boolean;
	// Sentinel configuration - required
	sentinelHosts: string;
	sentinelName: string;
	sentinelPassword?: string;
	_: string[];
}

let options: Options;

export function getOptions(...args: string[]): Options {
	if (!options) {
		const parsedArgs = yargs
			.version(version)
			.alias('V', 'version')
			.options({
				prefix: {
					alias: 'p',
					default: 'bull',
					demandOption: true,
				},
				metricPrefix: {
					alias: 'm',
					default: 'bull_queue_',
					defaultDescription: 'prefix for all exported metrics',
					demandOption: true,
				},
				once: {
					alias: 'n',
					default: false,
					type: 'boolean',
					description: 'Print stats and exit without starting a server',
				},
				port: {
					default: 9538,
				},
				autoDiscover: {
					default: false,
					alias: 'a',
					type: 'boolean',
				},
				bindAddress: {
					alias: 'b',
					description: 'Address to listen on',
					default: '0.0.0.0',
				},
				// Sentinel configuration options
				sentinelHosts: {
					describe: 'Comma-separated list of Sentinel hosts (e.g., "host1:26379,host2:26379")',
					type: 'string',
					demandOption: true,
				},
				sentinelName: {
					describe: 'Master name configured in Sentinel',
					type: 'string',
					demandOption: true,
				},
				sentinelPassword: {
					describe: 'Password for Sentinel authentication',
					type: 'string',
				},
			})
			.option('string-option', {
				string: true,
			})
			.parse(args);

		options = { ...parsedArgs, _: parsedArgs._ as string[] };
	}

	return options;
}
