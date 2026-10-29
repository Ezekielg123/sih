import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { initDatabase, db, ensureDemoUsers, persistComplaint, persistHistory, persistProposal, persistRun, persistRecommendation } from './store.js';
if(process.env.NODE_ENV==='production')throw new Error('Demo seeding is disabled in production.');
const connected=await initDatabase();
await ensureDemoUsers();
if(!connected){console.log('Demo accounts and 50 fictional cases are generated in memory when the server starts. Configure MySQL for durable seeding.');process.exit(0);}
for(const i of db.institutions)await db.pool.execute('INSERT IGNORE INTO institutions(id,name,code) VALUES (?,?,?)',[i.id,i.name,i.code]);
for(const u of db.users){const roleId=u.role==='admin'?1:2;await db.pool.execute('INSERT INTO users(id,name,email,password_hash,role_id) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),password_hash=VALUES(password_hash)',[u.id,u.name,u.email,u.passwordHash,roleId]);}
for(const c of db.complaints){await persistComplaint(c);for(const event of c.timeline)await persistHistory(c,event);}
for(const [category,policy] of Object.entries(db.policies))await db.pool.execute('INSERT INTO sla_policies(category,bureau,hours,active) VALUES (?,\'\',?,TRUE) ON DUPLICATE KEY UPDATE hours=VALUES(hours),active=TRUE',[category,policy.hours]);
for(const n of db.notifications)await db.pool.execute('INSERT IGNORE INTO notifications(id,complaint_id,kind,message) VALUES (?,?,?,?)',[n.id,n.complaintId,n.kind,n.message]);
for(const p of db.proposals)await persistProposal(p);
for(const run of db.runs)await persistRun(run);
for(const rec of db.recommendations)await persistRecommendation(rec);
for(const ev of db.audit)await db.pool.execute('INSERT IGNORE INTO audit_logs(id,user_id,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?,?)',[ev.id,ev.userId,ev.action,ev.entityType,String(ev.entityId),JSON.stringify(ev.details||{})]);
console.log(`Seeded ${db.complaints.length} synthetic cases and development demo accounts.`);
await db.pool.end();
