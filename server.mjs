/**
 * Lexora Orbit optional AI gateway + static server (Node.js 20+, zero dependencies).
 * Start: node server/server.mjs
 * Never expose API keys in GitHub or build bundles.
 * This gateway accepts user-supplied API keys over HTTPS when self-hosted; it does NOT store them.
 * Public deployments: set ORIGIN_ALLOWLIST + configure additional authentication/rate limiting upstream.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 16 * 1024;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_COMPLETION_TOKENS = 750;
const rate = new Map();
const HEADERS = {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; object-src 'none'; base-uri 'self'"};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon'};
const providers={
  openai:{host:'api.openai.com',url:'https://api.openai.com/v1/chat/completions',env:'OPENAI_API_KEY'},
  openrouter:{host:'openrouter.ai',url:'https://openrouter.ai/api/v1/chat/completions',env:'OPENROUTER_API_KEY'},
  deepseek:{host:'api.deepseek.com',url:'https://api.deepseek.com/chat/completions',env:'DEEPSEEK_API_KEY'},
  groq:{host:'api.groq.com',url:'https://api.groq.com/openai/v1/chat/completions',env:'GROQ_API_KEY'},
  together:{host:'api.together.xyz',url:'https://api.together.xyz/v1/chat/completions',env:'TOGETHER_API_KEY'},
  gemini:{host:'generativelanguage.googleapis.com',env:'GEMINI_API_KEY'},
  cloudflare:{host:'api.cloudflare.com',env:'CLOUDFLARE_API_TOKEN'},
  custom:{env:'CUSTOM_AI_KEY'}
};
function json(res,status,data){res.writeHead(status,{...HEADERS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function validateText(str,max=12000){return typeof str==='string'&&str.length<=max}
function allowedCustom(url){
  try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return false;
    const allowed=(process.env.CUSTOM_AI_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    return allowed.includes(u.hostname.toLowerCase());
  }catch{return false}
}
function getIP(req){return String(req.socket.remoteAddress||'unknown')}
function rateLimit(req){const now=Date.now(),ip=getIP(req);let item=rate.get(ip);if(!item||now-item.start>60000){item={start:now,count:0};rate.set(ip,item)}item.count++;if(rate.size>2000)for(const [k,v] of rate){if(now-v.start>120000)rate.delete(k)}return item.count<=18}
async function bodyJSON(req){let size=0,parts=[];for await (const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Error('Слишком большой запрос');parts.push(chunk)}try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Error('Неверный JSON')}}
function extractionPrompt(b){if(b.kind==='test')return [{role:'system',content:'You are a helpful assistant. Reply with the word OK only.'},{role:'user',content:'Reply OK.'}];if(b.kind==='check')return [
 {role:'system',content:`You are a meticulous English teacher for Russian-speaking learners. Assess one learner sentence using target expression. Be fair: do not punish optional spelling style (US vs UK). Reply with ONLY a JSON object: {"score":number from 0 to 100,"corrected":"correct grammatical English sentence","explanation":"brief correction explanation in Russian","suggestion":"one short tip in Russian"}. No extra prose.`},
 {role:'user',content:`Target expression: ${String(b.expression||'').slice(0,180)}\nTranslation: ${String(b.translation||'').slice(0,180)}\nLearner level: ${String(b.level||'B1').slice(0,3)}\nLearner sentence: ${b.message}`}];
 return [{role:'system',content:'You are Lexora Orbit, a supportive English teacher. Answer concisely in Russian, give clear English examples when useful, avoid pretending you checked knowledge you did not check.'},{role:'user',content:b.message}]
}
function getKey(provider,b){const env=process.env[providers[provider]?.env||''];return String(b.apiKey||env||'').trim()}
function checkOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{const u=new URL(origin);const host=(req.headers['x-forwarded-host']||req.headers.host||'');return u.host===host||((process.env.ORIGIN_ALLOWLIST||'').split(',').map(s=>s.trim()).includes(origin))}catch{return false}}
function parseAIReply(text,kind){let parsed=null;if(kind==='check'){try{let raw=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();parsed=JSON.parse(raw);if(typeof parsed.score!=='number')parsed.score=null;else parsed.score=Math.max(0,Math.min(100,Math.round(parsed.score)));}catch{parsed=null}}
 return {text:String(text||''),...(parsed?{feedback:parsed}:{})}}
async function callAI(b){const provider=String(b.provider||'');if(!providers[provider])throw new Error('Неизвестный провайдер');const model=String(b.model||'').trim();if(!model||model.length>170||/\r|\n/.test(model))throw Error('Неверный идентификатор модели');const key=getKey(provider,b);if(!key)throw Error('Нет API-ключа. Добавь его в настройках модели или на сервере.');const messages=extractionPrompt(b);let url,headers={'Content-Type':'application/json','Accept':'application/json'},body;
 if(provider==='gemini'){
  url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';headers['x-goog-api-key']=key;
  body={systemInstruction:{parts:[{text:messages[0].content}]},contents:[{role:'user',parts:[{text:messages[1].content}]}],generationConfig:{temperature:.25,maxOutputTokens:MAX_COMPLETION_TOKENS}};
 } else if(provider==='cloudflare'){
  const account=String(b.accountId||process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();if(!/^[a-f0-9]{32}$/i.test(account))throw Error('Нужен корректный Cloudflare Account ID');
  if(!/^@[\w.-]+\/[\w./:-]+$/.test(model))throw Error('Неверное имя Cloudflare-модели');
  url='https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/'+model.split('/').map(encodeURIComponent).join('/');
  headers.Authorization='Bearer '+key;body={messages,max_tokens:MAX_COMPLETION_TOKENS};
 }else{
  if(provider==='custom'){
    url=String(b.endpoint||'').trim();if(!allowedCustom(url))throw Error('Этот адрес API не разрешён сервером. Добавь его хост в CUSTOM_AI_HOSTS на своём сервере.');
  }else url=providers[provider].url;
  headers.Authorization='Bearer '+key;body={model,messages,temperature:.25,max_tokens:MAX_COMPLETION_TOKENS};
 }
 const resp=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),redirect:'error'});
 let json;try{json=await resp.json()}catch{throw Error('Провайдер вернул не-JSON ответ')}
 if(!resp.ok){const message=String(json?.error?.message||json?.errors?.[0]?.message||json?.error||'Ошибка провайдера');throw Error('Ошибка API '+resp.status+': '+message.slice(0,400))}
 let text;
 if(provider==='gemini')text=json?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n');
 else if(provider==='cloudflare')text=json?.result?.response??json?.result?.text??json?.response;
 else text=json?.choices?.[0]?.message?.content;
 if(Array.isArray(text))text=text.map(x=>x?.text||'').join('\n');
 if(!text||typeof text!=='string')throw Error('Модель не вернула текст. Возможно, этот API не поддерживает чат.');
 return parseAIReply(text,b.kind);
}
async function serveStatic(req,res,path){let rel;
 try{rel=decodeURIComponent(path).replace(/^\/+/, '')}catch{return json(res,400,{error:'Неверный URL'})}
 if(!rel)rel='index.html';const absolute=resolve(ROOT,rel);
 if(absolute!==ROOT&&!absolute.startsWith(ROOT+'/'))return json(res,403,{error:'Access denied'});
 if(rel.startsWith('.')||rel.includes('/.')||rel.startsWith('server/')||rel.startsWith('data/vocabulary.json')||rel.startsWith('README')||rel.endsWith('.zip'))return json(res,404,{error:'Not found'});
 try{const st=await stat(absolute);if(!st.isFile())return json(res,404,{error:'Not found'});const data=await readFile(absolute);res.writeHead(200,{...HEADERS,'Content-Type':types[extname(absolute)]||'application/octet-stream','Cache-Control':rel.startsWith('data/vocabulary.')?'public, max-age=3600':'no-cache'});res.end(data)}catch{json(res,404,{error:'Not found'})}
}
const app=createServer(async(req,res)=>{
 let path;try{path=new URL(req.url,'http://localhost').pathname}catch{return json(res,400,{error:'Bad request'})}
 if(path==='/api/health')return json(res,200,{ok:true,service:'Lexora Orbit',vocabulary:5000});
 if(path==='/api/ai'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(!checkOrigin(req))return json(res,403,{error:'Разрешены запросы только с этого сайта'});
  if(!rateLimit(req))return json(res,429,{error:'Слишком много запросов. Попробуй через минуту.'});
  try{const b=await bodyJSON(req);if(!b||!['test','check','chat'].includes(b.kind)||!validateText(b.message,8000))return json(res,400,{error:'Недопустимые параметры'});return json(res,200,await callAI(b))}
  catch(err){const msg=err?.name==='TimeoutError'?'ИИ не ответил за 30 секунд':String(err?.message||'Ошибка');return json(res,400,{error:msg.slice(0,500)})}
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
 await serveStatic(req,res,path);
});
app.listen(PORT,'0.0.0.0',()=>console.log(`Lexora Orbit available on http://localhost:${PORT}`));
