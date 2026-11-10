import { createApp } from './app.js';
import { config, DEFAULT_JWT_SECRET } from './config/index.js';
import { getDb } from './db/index.js';
import { seed } from './db/seed.js';
import { userRepository } from './repositories/userRepository.js';

// The development fallback secret must never reach production.
if (config.nodeEnv === 'production' && config.jwtSecret === DEFAULT_JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is unset in production. Refusing to start.');
  process.exit(1);
}

getDb();

// Seed on first run so the prototype is usable immediately. INSERT OR IGNORE
// makes this idempotent.
if (process.env.SEED_ON_START !== 'false') {
  seed({ quiet: true });
}

if (userRepository.countActiveAdmins() === 0) {
  console.warn(
    'WARNING: there is no active administrator. Set ADMIN_EMAIL and ADMIN_PASSWORD\n' +
    '         in backend/.env, then run: npm run seed:admin'
  );
}

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`RPL API listening on http://localhost:${config.port}`);
  console.log(`  environment: ${config.nodeEnv}`);
  console.log(`  database:    ${config.dbPath}`);
  console.log(`  evidence:    ${config.uploadDir} (not web-served)`);
});

const shutdown = (signal) => {
  console.log(`\n${signal} received, closing server.`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
