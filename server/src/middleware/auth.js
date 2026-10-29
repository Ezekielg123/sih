import jwt from 'jsonwebtoken';
import { db } from '../db/store.js';
export function auth(req,res,next){ const h=req.headers.authorization; const token=h?.startsWith('Bearer ')?h.slice(7):null; if(!token)return res.status(401).json({error:'Authentication required'}); try{if(db.revokedTokens.has(token))return res.status(401).json({error:'Session has been logged out'});req.user=jwt.verify(token,process.env.JWT_SECRET||'dev-only-secret-change-me');req.authToken=token;next();}catch{return res.status(401).json({error:'Invalid or expired session'});} }
export const allow=(...roles)=>(req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'Insufficient permissions'});
