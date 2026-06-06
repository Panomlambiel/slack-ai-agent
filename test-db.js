import dotenv from 'dotenv';
dotenv.config();
import { initDatabase, closeDatabase } from './db.js';

(async () => {
  try {
    await initDatabase({ retries: 3, delay: 2000 });
    console.log('DB init succeeded');
  } catch (e) {
    console.error('DB init failed:', e.message);
  } finally {
    await closeDatabase();
    process.exit(0);
  }
})();
