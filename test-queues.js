const { Queue } = require('bullmq');
const IoRedis = require('ioredis');

// Create Redis connection with Sentinel
const redis = new IoRedis({
  sentinels: [
    { host: 'redis-sentinel', port: 26379 }
  ],
  name: 'redis-master',
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: null,
  connectTimeout: 10000,
  lazyConnect: true
});

// Test connection
async function testConnection() {
  console.log('Testing Sentinel connection...');

  try {
    await redis.connect();
    console.log('✅ Successfully connected to Redis via Sentinel');

    // Test basic Redis operations
    await redis.set('test', 'hello');
    const result = await redis.get('test');
    console.log('✅ Redis operations working:', result);

    return true;
  } catch (error) {
    console.error('❌ Failed to connect to Redis via Sentinel:', error.message);
    return false;
  }
}

// Create some test queues
async function createTestQueues() {
  console.log('Creating test queues...');

  try {
    // Queue: agentic_pdf_to_html_step (the one expected by the exporter)
    const agenticQueue = new Queue('agentic_pdf_to_html_step', { connection: redis });
    await agenticQueue.add('convert-pdf', { file: 'document1.pdf', format: 'html' });
    await agenticQueue.add('convert-pdf', { file: 'document2.pdf', format: 'html' });
    await agenticQueue.add('convert-pdf', { file: 'document3.pdf', format: 'html' });
    console.log('✅ agentic_pdf_to_html_step queue created with 3 jobs');

    // Additional test queues for variety
    const emailQueue = new Queue('email', { connection: redis });
    await emailQueue.add('send-welcome', { to: 'user@example.com', subject: 'Welcome!' });
    console.log('✅ Email queue created with 1 job');

    const processingQueue = new Queue('processing', { connection: redis });
    await processingQueue.add('process-data', { data: 'test-data-1' });
    console.log('✅ Processing queue created with 1 job');

    console.log('\n🎉 Test queues created successfully!');
    console.log('Now run your BullMQ exporter to see the metrics.');
  } catch (error) {
    console.error('❌ Error creating test queues:', error.message);
    throw error;
  } finally {
    await redis.disconnect();
  }
}

// Main function with retry logic
async function main() {
  console.log('Starting test queue creation...');

  // Try to connect with retries
  let connected = false;
  for (let i = 0; i < 5; i++) {
    console.log(`Attempt ${i + 1}/5 to connect to Sentinel...`);
    connected = await testConnection();
    if (connected) break;

    if (i < 4) {
      console.log('Waiting 5 seconds before retry...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  if (!connected) {
    console.error('❌ Failed to connect after 5 attempts. Exiting.');
    process.exit(1);
  }

  // Create test queues
  await createTestQueues();
}

main().catch(console.error);
