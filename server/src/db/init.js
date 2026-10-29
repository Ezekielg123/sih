import 'dotenv/config';
import { initDatabase,db } from './store.js';
if(await initDatabase())console.log('MySQL schema initialized.');else{console.error('Could not initialize MySQL. Set DATABASE_URL and DEMO_MODE=false.');process.exitCode=1;}
if(db.pool)await db.pool.end();
