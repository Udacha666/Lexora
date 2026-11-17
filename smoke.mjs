import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../data/vocabulary.js',import.meta.url),'utf8');const context={window:{}};vm.createContext(context);vm.runInContext(src,context);
const d=context.window.LEXORA_VOCAB;
assert.equal(d.length,5000,'5000 vocabulary entries expected');assert.equal(new Set(d.map(x=>x.en.toLowerCase())).size,5000,'English vocabulary entries unique');assert.equal(new Set(d.map(x=>x.id)).size,5000,'IDs unique');
for(const x of d){assert.ok(x.id&&x.en&&x.ru&&x.level&&x.topic);assert.ok(['B1','B2','C1'].includes(x.level));assert.ok(/[а-яё]/i.test(x.ru))}
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');for(const s of ['app.js','styles.css','data/vocabulary.js','mobile-nav'])assert.ok(html.includes(s),s+' in HTML');
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');for(const s of ['renderHome','renderLearn','renderDictionary','renderAI','renderProfile','checkSentenceOffline','check-spelling','modelDialog','aiRequest'])assert.ok(app.includes(s),s+' in JS');
console.log('OK — 5000 unique bilingual cards, CEFR B1/B2/C1, UI navigation and learning/AI code present.');
