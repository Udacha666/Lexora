/* LEXORA / ORBIT — static-first, responsive English training interface.
   All words/phrases are bundled in data/vocabulary.js. No network required to study.
   AI requests require a running first-party server; credentials stay in memory/session only. */
(() => {
  'use strict';
  const WORDS = Array.isArray(window.LEXORA_VOCAB) ? window.LEXORA_VOCAB : [];
  const WORD_BY_ID = new Map(WORDS.map(x => [x.id, x]));
  const DATA_KEY = 'lexora-orbit-state-v1';
  const KEYS_SESSION = 'lexora-orbit-credentials-session-v1';
  const CLOUD_SETTINGS_KEY = 'lexora-orbit-cloud-settings';
  const CLOUD_LAST_USER_KEY = 'lexora-orbit-cloud-user';
  const MAIN = document.getElementById('main-content');
  const TODAY = new Date().toLocaleDateString('en-CA');
  const PROVIDERS = {
    openai: {label:'OpenAI', defaultModel:'gpt-4.1-mini',hint:'Обычный API-ключ OpenAI. Поддерживаются модели Chat Completions.'},
    openrouter: {label:'OpenRouter',defaultModel:'openai/gpt-4.1-mini',hint:'Доступ к разным моделям по одному ключу OpenRouter.'},
    deepseek: {label:'DeepSeek',defaultModel:'deepseek-chat',hint:'Официальный API DeepSeek.'},
    groq: {label:'Groq',defaultModel:'llama-3.3-70b-versatile',hint:'Быстрые модели через GroqCloud.'},
    gemini: {label:'Google Gemini',defaultModel:'gemini-2.5-flash',hint:'Gemini API через Google AI Studio.'},
    cloudflare: {label:'Cloudflare Workers AI',defaultModel:'@cf/meta/llama-3.1-8b-instruct',hint:'Для Cloudflare понадобится Account ID и Workers AI API-токен.'},
    together: {label:'Together AI',defaultModel:'meta-llama/Llama-3.3-70B-Instruct-Turbo',hint:'Together.ai, OpenAI-совместимый API.'},
    custom: {label:'Свой OpenAI-совместимый API',defaultModel:'your-model-id',hint:'Укажи полный HTTPS-адрес /chat/completions. Сервер должен разрешать его домен.'}
  };
  const fallbackStorage = {getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  function safeStorage(type){try{return window[type]||fallbackStorage}catch{return fallbackStorage}}
  const LOCAL=safeStorage('localStorage'),SESSION=safeStorage('sessionStorage');
  let state = load();
  let route = location.hash.replace('#','') || 'home';
  if (!['home','learn','dictionary','ai','profile'].includes(route)) route='home';
  let dictFilters = { query:'', level:'ALL', topic:'ALL', shown:40, learned:'all' };
  let lessonFeedback = null;
  let aiFeedback = null;
  let chat = [];
  let busyAI = false;
  let editingModel = null;
  let secrets = Object.assign({}, readJSON(SESSION, KEYS_SESSION, {}));
  let toastTimer;
  let cloudClient=null, cloudUser=null, cloudReady=false, cloudStatus='Локальный режим', cloudError='', cloudTimer=null, cloudWriting=false, cloudDirty=false, cloudVersion=0;
  const $ = s => document.querySelector(s);
  const el = (tag, props={}, children=[]) => { const node=document.createElement(tag); Object.assign(node,props); children.forEach(c=>node.append(c)); return node; };
  const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=(name,extra='')=>`<svg class="i ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const wordsCount=WORDS.length.toLocaleString('ru-RU');
  const dayStamp=() => new Date().toLocaleDateString('en-CA');
  function readJSON(store,key,def){try{const data=JSON.parse(store.getItem(key));return data??def}catch{return def}}
  function load(){ const saved=readJSON(LOCAL,DATA_KEY,{});return {
    username:typeof saved.username==='string'?saved.username:'Космический исследователь',
    level:['B1','B2','C1'].includes(saved.level)?saved.level:'B1',
    goal:[10,12,15].includes(Number(saved.goal))?Number(saved.goal):15,
    learned:(saved.learned && typeof saved.learned==='object')?saved.learned:{},
    daily:(saved.daily && typeof saved.daily==='object')?saved.daily:{},
    lesson:(saved.lesson && typeof saved.lesson==='object')?saved.lesson:null,
    models:Array.isArray(saved.models)?saved.models:[],
    activeModel:saved.activeModel||null,
    totalXP:Number(saved.totalXP)||0,
    lastStudy:saved.lastStudy||null,
    streak:Number(saved.streak)||0,
    profileUpdatedAt:Number(saved.profileUpdatedAt)||0,
    modelsUpdatedAt:Number(saved.modelsUpdatedAt)||0,
    revision:1,
  }}
  function save(){try{LOCAL.setItem(DATA_KEY,JSON.stringify(state))}catch{toast('Не удалось сохранить прогресс: память браузера заполнена')}scheduleCloudSave()}
  // Supabase stores *study state only*. Provider credentials never leave the browser through cloud sync.
  function localPersist(){try{LOCAL.setItem(DATA_KEY,JSON.stringify(state))}catch{}}
  function cloudConfig(){const stored=readJSON(LOCAL,CLOUD_SETTINGS_KEY,{});const defaults=window.LEXORA_CLOUD_CONFIG||{};return {url: String(defaults.url||stored.url||'').trim().replace(/\/$/,''),key:String(defaults.publishableKey||stored.publishableKey||'').trim()}}
  function cloudConfigured(){const cfg=cloudConfig();return /^https:\/\/[^/]+\.supabase\.co$/.test(cfg.url)&&cfg.key.length>16}
  function cloudSnapshot(){return {username:state.username,level:state.level,goal:state.goal,learned:state.learned,daily:state.daily,lesson:state.lesson,models:state.models,activeModel:state.activeModel,totalXP:state.totalXP,lastStudy:state.lastStudy,streak:state.streak,profileUpdatedAt:state.profileUpdatedAt,modelsUpdatedAt:state.modelsUpdatedAt,version:1}}
  function mergeCloud(remote,local){
    if(!remote||typeof remote!=='object')return local;
    const safe=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
    const learned={...safe(remote.learned)};
    for(const [id,item] of Object.entries(safe(local.learned)))if(!learned[id]||Number(item?.last||0)>Number(learned[id]?.last||0))learned[id]=item;
    const daily={...safe(remote.daily)};
    for(const [date,items] of Object.entries(safe(local.daily)))daily[date]=[...new Set([...(Array.isArray(daily[date])?daily[date]:[]),...(Array.isArray(items)?items:[])])];
    const preferLocal=Number(local.profileUpdatedAt||0)>Number(remote.profileUpdatedAt||0);
    const latest=preferLocal?local:remote;
    const lesson=local.lesson?.date===dayStamp()?local.lesson:(remote.lesson?.date===dayStamp()?remote.lesson:null);
    const pickModels=Number(local.modelsUpdatedAt||0)>Number(remote.modelsUpdatedAt||0)?local:remote;
    return {...local,username:latest.username||local.username,level:['B1','B2','C1'].includes(latest.level)?latest.level:local.level,goal:[10,12,15].includes(Number(latest.goal))?Number(latest.goal):local.goal,learned,daily,lesson,models:Array.isArray(pickModels.models)?pickModels.models:local.models,activeModel:pickModels.activeModel||null,totalXP:Math.max(Number(remote.totalXP)||0,Number(local.totalXP)||0),lastStudy:[remote.lastStudy,local.lastStudy].filter(Boolean).sort().at(-1)||null,streak:Math.max(Number(remote.streak)||0,Number(local.streak)||0),profileUpdatedAt:Math.max(Number(remote.profileUpdatedAt)||0,Number(local.profileUpdatedAt)||0),modelsUpdatedAt:Math.max(Number(remote.modelsUpdatedAt)||0,Number(local.modelsUpdatedAt)||0)};
  }
  function scheduleCloudSave(){if(!cloudUser||!cloudReady||!cloudClient)return;cloudDirty=true;cloudVersion++;clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>{pushCloud().catch(()=>{})},1100)}
  async function pushCloud(){
    if(!cloudClient||!cloudUser||!cloudReady||cloudWriting)return;
    cloudWriting=true;const startVersion=cloudVersion;cloudStatus='Синхронизация…';
    try{
      const {data:row,error:readErr}=await cloudClient.from('lexora_progress').select('payload').eq('user_id',cloudUser.id).maybeSingle();if(readErr)throw readErr;
      if(row?.payload){state=mergeCloud(row.payload,state);localPersist()}
      const payload=cloudSnapshot();const {error}=await cloudClient.from('lexora_progress').upsert({user_id:cloudUser.id,payload,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;
      cloudStatus='Облако синхронизировано';cloudError='';if(cloudVersion===startVersion)cloudDirty=false;
      if(route==='profile')render();
    }catch(err){cloudStatus='Не удалось синхронизировать';cloudError=String(err.message||err);cloudDirty=true;if(route==='profile')render()}
    finally{cloudWriting=false;if(cloudDirty&&cloudVersion!==startVersion)scheduleCloudSave()}
  }
  async function loadCloudProfile(){
    if(!cloudClient||!cloudUser)return;
    cloudReady=false;cloudStatus='Загрузка прогресса…';if(route==='profile')render();
    try{
      const id=cloudUser.id;const oldUser=LOCAL.getItem(CLOUD_LAST_USER_KEY);
      if(oldUser&&oldUser!==id){state=mergeCloud(null,{...state,learned:{},daily:{},lesson:null,models:[],activeModel:null,totalXP:0,streak:0,lastStudy:null,profileUpdatedAt:0,modelsUpdatedAt:0})}
      const {data:row,error}=await cloudClient.from('lexora_progress').select('payload').eq('user_id',id).maybeSingle();if(error)throw error;
      if(row?.payload)state=mergeCloud(row.payload,state);
      LOCAL.setItem(CLOUD_LAST_USER_KEY,id);localPersist();
      cloudReady=true;cloudStatus='Облако подключено';cloudError='';cloudVersion++;cloudDirty=true;await pushCloud();
      if(route==='profile')render();
    }catch(err){cloudError=String(err.message||err);cloudStatus='Ошибка базы данных';cloudReady=false;if(route==='profile')render()}
  }
  async function handleCloudSession(session){
    const user=session?.user||null;
    if(!user){cloudUser=null;cloudReady=false;cloudStatus=cloudConfigured()?'Вход не выполнен':'Облачный аккаунт не настроен';if(route==='profile')render();return}
    if(cloudUser?.id===user.id&&cloudReady)return;
    cloudUser=user;await loadCloudProfile();
  }
  async function initCloud(){
    if(!cloudConfigured())return;
    if(!window.supabase?.createClient){cloudStatus='Не загрузилась библиотека Supabase (нужен интернет)';return}
    const cfg=cloudConfig();
    try{
      cloudClient=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      cloudStatus='Проверка входа…';
      cloudClient.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{handleCloudSession(session)},0)});
      const {data,error}=await cloudClient.auth.getSession();if(error)throw error;
      await handleCloudSession(data.session);
    }catch(err){cloudError=String(err.message||err);cloudStatus='Ошибка подключения';if(route==='profile')render()}
  }
  async function cloudAccountAction(e){
    e.preventDefault();if(!cloudClient)return toast('Сначала настрой базу Supabase.');
    const form=e.target, email=form.elements.email?.value.trim(),password=form.elements.password?.value;
    if(!email||!password)return toast('Нужны email и пароль');
    const action=e.submitter?.value||'login';cloudStatus='Выполняется вход…';
    try{
      const result=action==='signup'?await cloudClient.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname+'#profile'}}):await cloudClient.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      toast(action==='signup'&&!result.data.session?'Аккаунт создан. Подтверди email, если Supabase запросил подтверждение.':'Успешно! Загружаю облачный прогресс.');
      if(result.data.session)await handleCloudSession(result.data.session);
    }catch(err){cloudError=String(err.message||err);cloudStatus='Ошибка входа';toast('Не удалось войти: '+cloudError)}
    if(route==='profile')render();
  }
  async function cloudSignOut(){if(!cloudClient)return;clearTimeout(cloudTimer);if(cloudDirty&&cloudReady)await pushCloud();if(cloudDirty){toast('Не удалось сохранить последние изменения в облаке. Выйти можно после успешной синхронизации.');return}await cloudClient.auth.signOut();cloudUser=null;cloudReady=false;cloudDirty=false;LOCAL.removeItem(DATA_KEY);LOCAL.removeItem(CLOUD_LAST_USER_KEY);SESSION.removeItem(KEYS_SESSION);secrets={};state=load();render();toast('Вы вышли. Данные аккаунта остались в облаке.')}
  async function clearCloudProgress(){if(!cloudUser||!cloudReady||!cloudClient)return;clearTimeout(cloudTimer);cloudVersion++;cloudDirty=false;try{const {error}=await cloudClient.from('lexora_progress').upsert({user_id:cloudUser.id,payload:cloudSnapshot(),updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;cloudStatus='Прогресс сброшен и в облаке'}catch(err){cloudStatus='Ошибка облачного сброса';cloudError=String(err.message||err);toast(cloudError)}}
  function renderCloudPanel(){
    const configured=cloudConfigured();const user=cloudUser;
    return `<div class="panel cloud-panel"><div class="tiny-label">CLOUD / SUPABASE</div><h3>Единый аккаунт на ПК и iPhone</h3><p class="privacy-note">${escape(cloudStatus)}${cloudError?' · '+escape(cloudError):''}</p>
      ${!configured?`<p class="footnote">Чтобы включить регистрацию, открой cloud-config.js и укажи Project URL и Publishable key из Supabase. Или введи их здесь один раз на этом устройстве.</p>
      <form id="cloud-config-form" class="cloud-form"><label class="field-label">Project URL</label><input class="field" name="url" type="url" required placeholder="https://xxxx.supabase.co"><label class="field-label">Publishable key (не secret!)</label><input class="field" name="key" required placeholder="sb_publishable_..."><button class="btn btn-primary" type="submit">${icon('check')} Подключить облако</button></form>`:
      user?`<div class="cloud-user"><div><span class="chip chip-green">АККАУНТ ПОДКЛЮЧЁН</span><p style="margin:10px 0 0">${escape(user.email||'Аккаунт')}</p></div><div class="form-actions"><button class="btn btn-small" data-action="cloud-sync">${icon('refresh')} Обновить</button><button class="btn btn-small" data-action="cloud-logout">Выйти</button></div></div>
      <p class="footnote">Синхронизируются слова, XP, настройки и названия ИИ-моделей. Секретные API-ключи ИИ остаются в браузере и при входе на новом устройстве вводятся заново. На другом устройстве войди с теми же email и паролем.</p>`:
      `<form id="cloud-auth-form" class="cloud-form"><label class="field-label">Email</label><input class="field" type="email" name="email" autocomplete="email" required placeholder="you@example.com"><label class="field-label">Пароль (от 6 символов)</label><input class="field" type="password" name="password" autocomplete="current-password" minlength="6" required placeholder="••••••••"><div class="form-actions"><button class="btn btn-primary" type="submit" value="login">Войти</button><button class="btn" type="submit" value="signup">Создать аккаунт</button></div></form>
      <p class="footnote">После регистрации может потребоваться подтверждение адреса в письме. Никогда не вставляй пароль или ключ service_role в исходный код сайта.</p>`}
    </div>`;
  }
  function notifySuccess(){const n=document.querySelector('#offline-status');if(n)n.textContent='PROGRESS SAVED'}
  function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3300)}
  function stats(){let learned=0,due=0,byLevel={B1:0,B2:0,C1:0};const now=Date.now();for(const [id,item] of Object.entries(state.learned)){if(!WORD_BY_ID.has(id))continue;if(item.mastered){learned++;byLevel[WORD_BY_ID.get(id).level]++}if(item.next&&item.next<=now)due++}const daily=state.daily[dayStamp()]||[];return{learned,due,byLevel,done:daily.filter(id=>WORD_BY_ID.has(id)).length,ratio:Math.min(100,Math.round((daily.length/state.goal)*100))}}
  function formatNum(n){return Number(n).toLocaleString('ru-RU')}
  function getWord(id){return WORD_BY_ID.get(id)}
  function activeModel(){return state.models.find(m=>m.id===state.activeModel)||null}
  function providerName(key){return PROVIDERS[key]?.label||key}
  function setRoute(v){if(!['home','learn','dictionary','ai','profile'].includes(v))return;route=v;location.hash=v;render();window.scrollTo({top:0,behavior:'smooth'})}
  function lessonValid(){return state.lesson&&state.lesson.date===dayStamp()&&Array.isArray(state.lesson.ids)&&state.lesson.ids.length>0}
  function shuffleDeterministic(items,seed){let a=items.slice();let x=seed>>>0;for(let i=a.length-1;i>0;i--){x=(Math.imul(1664525,x)+1013904223)>>>0;const j=x%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a}
  function createLesson(singleId){
    if(singleId&&WORD_BY_ID.has(singleId)){state.lesson={date:dayStamp(),ids:[singleId],index:0,stage:'discover',mode:'single'};lessonFeedback=null;save();setRoute('learn');return}
    const seed=Array.from(dayStamp()+state.level).reduce((a,c)=>Math.imul(a^c.charCodeAt(),16777619)>>>0,2166136261);
    const due=WORDS.filter(w=>state.learned[w.id]?.next<=Date.now()).sort((a,b)=>(state.learned[a.id].next||0)-(state.learned[b.id].next||0));
    // Start with editorially written entries; mix in themed collocations gradually.
    const curated=shuffleDeterministic(WORDS.filter(w=>w.level===state.level&&w.origin==='curated'&&!state.learned[w.id]?.mastered),seed);
    const composed=shuffleDeterministic(WORDS.filter(w=>w.level===state.level&&w.origin!=='curated'&&!state.learned[w.id]?.mastered),seed^0x9e3779b9);
    const pool=[];
    for(let i=0;i<state.goal*2;i++){
      let item = (i%3!==2&&curated.length) ? curated.shift() : (composed.shift()||curated.shift());
      if(item)pool.push(item);
    }
    const list=[...due,...pool].map(w=>w.id);
    const unique=[...new Set(list)].slice(0,state.goal);
    if(!unique.length){toast('Все карточки уровня изучены. Попробуй другой уровень.');return}
    state.lesson={date:dayStamp(),ids:unique,index:0,stage:'discover',mode:'daily'};lessonFeedback=null;save();setRoute('learn');
  }
  function completeWord(word){
    if(!word)return;
    const old=state.learned[word.id]||{interval:0,tries:0};
    const intervals=[1,3,7,14,30,60,120];
    const nextStep=Math.min(6,(old.tries||0));
    state.learned[word.id]={mastered:true,tries:nextStep+1,last:Date.now(),next:Date.now()+intervals[nextStep]*86400000,interval:intervals[nextStep]};
    if(!state.daily[dayStamp()])state.daily[dayStamp()]=[];
    if(!state.daily[dayStamp()].includes(word.id)&&state.lesson?.mode==='daily')state.daily[dayStamp()].push(word.id);
    state.totalXP+=20;
    if(state.lastStudy!==dayStamp()){
      const prev=new Date();prev.setDate(prev.getDate()-1);const prevString=prev.toLocaleDateString('en-CA');
      state.streak=state.lastStudy===prevString?(state.streak||0)+1:1;
      state.lastStudy=dayStamp();
    }
    save();notifySuccess();
  }
  function nextLesson(){const l=state.lesson;if(!l)return;l.index++;l.stage='discover';lessonFeedback=null;save();render()}
  function resetMistake(word){const rec=state.learned[word.id];if(rec){rec.tries=0;rec.next=Date.now();save()}}
  function showPageHeading(eyebrow,title,description,action=''){return `<div class="page-heading fade-in"><div><div class="eyebrow">${escape(eyebrow)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div>${action}</div>`}
  function renderHome(){const s=stats();return `<section class="hero fade-in">
      <div class="hero-copy"><span class="eyebrow">MISSION 001 &nbsp; / &nbsp; ENGLISH EXPLORATION</span>
        <h1 class="display-heading">Твой язык.<br>Твоя <em>вселенная.</em></h1>
        <p class="hero-description">Выйди за пределы привычного. ${wordsCount} слов и выражений, ежедневные миссии, интервальные повторения и твой личный ИИ-наставник. Английский без границ.</p>
        <div class="hero-actions"><button class="btn btn-primary" data-action="start-lesson">Начать миссию ${icon('arrow')}</button><button class="btn" data-route="dictionary">Исследовать словарь ${icon('layers')}</button></div>
        <div class="hero-note"><span>● &nbsp; LEVEL ${escape(state.level)}</span><span>•</span><span>DAY ${String(Math.max(state.streak,1)).padStart(2,'0')}</span><span>•</span><span>MISSION ACTIVE</span></div></div>
      <div class="planet-stage" aria-hidden="true"><div class="orbit-caption top">OBJECT / SINGULARITY 01</div><div class="planet-coordinate">COORD. 37° 44′ 28″ N</div>
        <div class="cosmos-orb"><div class="orb-outer"></div><div class="orb-disk"></div><div class="orb-ring"></div><div class="orb-hole"></div><div class="orb-line"></div><div class="orb-cross"></div></div>
        <div class="orbit-caption bottom">THE UNIVERSE IS NOT THE LIMIT.</div><div class="orbit-caption right">∞ EXPLORE</div></div>
    </section>
    <div class="metric-grid fade-in">
      ${metric('Изучено',formatNum(s.learned),'/ '+formatNum(WORDS.length),'book')}
      ${metric('Серия дней',formatNum(state.streak),'дней','flame')}
      ${metric('Повторить',formatNum(s.due),'карточек','refresh')}
      ${metric('Опыт',formatNum(state.totalXP),'XP','target')}
    </div>
    <div class="section-head"><div><div class="tiny-label">YOUR FLIGHT PATH</div><h2>Бортовой журнал</h2></div><span class="chip">${escape(state.level)} · ${state.goal} карточек / день</span></div>
    <div class="dashboard-grid"><div class="panel mission-card"><span class="eyebrow">DAILY MISSION</span><h3>Сегодняшняя экспедиция</h3><p>Продолжай путь от новых слов к уверенной речи: изучи значение, составь предложение и напиши выражение по памяти.</p>
      <div class="mission-progress-row"><span>Прогресс миссии</span><strong>${s.done} / ${state.goal}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${s.ratio}%"></div></div>
      <div class="lesson-actions"><button class="btn btn-primary" data-action="start-lesson">${lessonValid()?'Продолжить урок':'Начать урок'} ${icon('arrow')}</button></div></div>
      <div class="panel sidebar-card"><div><span class="tiny-label">TRANSMISSION / 001</span><h3>Сигнал из будущего</h3><p class="quote">“The only way to learn a language is to use it.”</p></div><div class="subfoot">МАЛЕНЬКИЕ ШАГИ. БОЛЬШАЯ ДИСТАНЦИЯ.</div></div></div>
    <div class="section-head"><div><div class="tiny-label">CHOOSE A DESTINATION</div><h2>Центр управления</h2></div></div>
    <div class="gallery-strip"><button class="panel gallery-card" data-route="learn" style="text-align:left;color:inherit">${icon('book')}<h3>Обучение</h3><p>Карточки · Практика · Правописание</p></button><button class="panel gallery-card" data-route="dictionary" style="text-align:left;color:inherit">${icon('layers')}<h3>Библиотека знаний</h3><p>Поиск по ${wordsCount} карточкам</p></button><button class="panel gallery-card" data-route="ai" style="text-align:left;color:inherit">${icon('stars')}<h3>ИИ-наставник</h3><p>Добавляй модели без обновления сайта</p></button></div>`}
  function metric(label,value,suffix,ic){return `<div class="panel metric"><div class="metric-header"><span class="tiny-label">${escape(label)}</span>${icon(ic,'metric-icon')}</div><div class="metric-value">${value}<span class="metric-suffix">${suffix}</span></div></div>`}
  function renderLearn(){const l=state.lesson;
    if(!l||l.date!==dayStamp()||!Array.isArray(l.ids)||!l.ids.length){return showPageHeading('TRAINING MODULE','Тренировочная миссия','Каждый день — новые выражения, практика письма и повторения.')+`<div class="dashboard-grid"><div class="panel mission-card"><span class="eyebrow">READY FOR LAUNCH</span><h3>${state.goal} новых карточек</h3><p>Текущий уровень ${escape(state.level)}. Сначала изучи выражение, затем составь с ним предложение и напиши его по памяти.</p><button class="btn btn-primary" data-action="new-lesson">Начать миссию ${icon('arrow')}</button></div><div class="panel sidebar-card"><div class="tiny-label">TRAINING PROTOCOL</div><h3>01 / 02 / 03</h3><p>Запомнить · Составить предложение · Написать без подсказки</p></div></div>`}
    if(l.index>=l.ids.length){const finished=l.ids.length;return showPageHeading('MISSION COMPLETE','Орбита достигнута','Ежедневная миссия завершена. Следующие повторения появятся по расписанию.')+`<div class="panel lesson-complete fade-in"><div><div class="complete-orb">${icon('check')}</div><h2 class="section-title">Миссия выполнена!</h2><p class="section-subtitle">${finished} карточек · +${finished*20} XP · Продолжай завтра</p><div class="lesson-actions" style="justify-content:center"><button class="btn btn-primary" data-route="home">На главную ${icon('arrow')}</button><button class="btn" data-action="new-lesson">Новая миссия</button></div></div></div>`}
    let word=getWord(l.ids[l.index]);if(!word){l.index++;save();return renderLearn()}
    let stage=l.stage||'discover';const pct=Math.round(100*(l.index+(stage==='sentence'?.35:stage==='spelling'?.75:0))/l.ids.length);
    const display=stage==='spelling'?'Восстанови из памяти':stage==='sentence'?'Используй в контексте':'Новая координата';
    let inner='';
    if(stage==='discover')inner=`<div class="lesson-target">${escape(word.en)}</div><div class="lesson-translation">${escape(word.ru)}</div>${word.example?`<div class="lesson-example">${escape(word.example)}</div>`:`<div class="lesson-example">${word.origin==='composed'?'Учебная фраза из тематического шаблона.':'Запомни значение и попробуй произнести вслух.'}</div>`}<div class="lesson-actions"><button class="btn btn-primary" data-action="lesson-to-sentence">Составить предложение ${icon('arrow')}</button><button class="btn" data-action="speak" data-word="${escape(word.id)}">${icon('volume')} Произнести</button></div>`;
    if(stage==='sentence')inner=`<div class="lesson-target">${escape(word.en)}</div><p class="lesson-translation">${escape(word.ru)}</p><label class="field-label" for="sentence-answer" style="margin-top:23px">Составь своё английское предложение с этим выражением</label><textarea id="sentence-answer" class="field textarea" autocomplete="off" spellcheck="false" placeholder="Например: I believe that ..."></textarea><div class="lesson-actions"><button class="btn btn-primary" data-action="check-sentence">Базовая проверка ${icon('check')}</button><button class="btn" data-action="ai-check-sentence" ${activeModel()?'':'disabled title="Сначала добавь модель в ИИ-центре"'}>${icon('stars')} Проверить с ИИ</button><button class="btn btn-minimal" data-action="lesson-to-spelling">Пропустить ${icon('arrow')}</button></div>`;
    if(stage==='spelling')inner=`<div class="tiny-label" style="margin-top:36px">Переведи на английский без подсказки</div><div class="lesson-target" style="color:#e8d0af">${escape(word.ru)}</div><label class="field-label" for="spelling-answer">Напиши слово или выражение по памяти</label><input id="spelling-answer" class="field" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Твой ответ на английском"><div class="lesson-actions"><button class="btn btn-primary" data-action="check-spelling">Проверить написание ${icon('check')}</button><button class="btn" data-action="reveal-answer">Показать ответ</button></div>`;
    return showPageHeading('MISSION / LIVE','Твой сегодняшний урок','Неспешно, но каждый день. Три этапа на каждую карточку.',`<span class="chip">${l.index+1} / ${l.ids.length} &nbsp; · &nbsp; ${pct}%</span>`)+
      `<div class="lesson-layout"><div class="panel lesson-card fade-in"><div class="lesson-header"><span class="eyebrow">${escape(display)} &nbsp; · &nbsp; ${escape(word.level)}</span><span class="chip chip-blue">${word.type==='phrase'?'Фраза':'Слово'}</span></div>
      <div class="lesson-tabs"><span class="${stage==='discover'?'active':'done'}">01 &nbsp; Узнать</span><span class="${stage==='sentence'?'active':stage==='spelling'?'done':''}">02 &nbsp; Применить</span><span class="${stage==='spelling'?'active':''}">03 &nbsp; Написать</span></div>${inner}
      <div id="lesson-feedback">${lessonFeedback?feedbackHTML(lessonFeedback):''}</div></div>
      <div class="panel lesson-side"><span class="tiny-label">FLIGHT TELEMETRY</span><h3>Точка прогресса</h3><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="side-stat"><span>Карточка</span><strong>${l.index+1} / ${l.ids.length}</strong></div><div class="side-stat"><span>Уровень</span><strong>${escape(word.level)}</strong></div><div class="side-stat"><span>Всего знаний</span><strong>${formatNum(stats().learned)}</strong></div><p>ИИ проверяет грамматику только после подключения модели. Обычная проверка оценивает структуру и употребление фразы, но не полноценную грамматику.</p></div></div>`;
  }
  function feedbackHTML(f){return `<div class="feedback ${escape(f.type||'')}">${escape(f.text)}</div>`}
  const TOPIC_LABELS={GENERAL:'Все темы',FOUNDATIONS:'Основы',EDUCATION:'Учёба',CAREER:'Карьера',TECHNOLOGY:'Технологии',ENVIRONMENT:'Экология',SOCIETY:'Общество',COMMUNICATION:'Общение',LIFESTYLE:'Жизнь',TRAVEL:'Путешествия',SCIENCE:'Наука',HEALTH:'Здоровье',CULTURE:'Культура',FINANCE:'Финансы',ACTION:'Действия','REAL-LIFE':'Фразы в речи',IELTS:'IELTS'};
  function renderDictionary(){const q=dictFilters.query.toLowerCase().trim();let pool=WORDS.filter(w=>(dictFilters.level==='ALL'||w.level===dictFilters.level)&&(dictFilters.topic==='ALL'||w.topic===dictFilters.topic)&&(dictFilters.learned==='all'||(dictFilters.learned==='mastered'?!!state.learned[w.id]?.mastered:!state.learned[w.id]?.mastered))&&(!q||w.en.toLowerCase().includes(q)||w.ru.toLowerCase().includes(q)));
    let found=pool.length;return showPageHeading('DATA ARCHIVE','Библиотека знаний',`${wordsCount} уникальных учебных карточек: отдельные слова и тематические выражения. Часть выражений составлена по шаблонам.`,`<span class="chip">${formatNum(found)} / ${wordsCount}</span>`)+
    `<div class="dictionary-tools"><div class="search-wrap">${icon('search')}<input id="dict-search" class="field" type="search" placeholder="Поиск по слову или переводу..." value="${escape(dictFilters.query)}"></div><select class="select" id="dict-level" style="max-width:135px"><option value="ALL">Все уровни</option>${['B1','B2','C1'].map(x=>`<option ${x===dictFilters.level?'selected':''}>${x}</option>`).join('')}</select>
    <select class="select" id="dict-topic" style="max-width:205px">${Object.entries(TOPIC_LABELS).map(([k,v])=>`<option value="${k}" ${dictFilters.topic===k?'selected':''}>${escape(v)}</option>`).join('')}</select><select class="select" id="dict-learned" style="max-width:160px"><option value="all" ${dictFilters.learned==='all'?'selected':''}>Все</option><option value="mastered" ${dictFilters.learned==='mastered'?'selected':''}>Изученные</option><option value="new" ${dictFilters.learned==='new'?'selected':''}>Новые</option></select></div>
    <div id="dict-results"><div class="dict-list">${pool.slice(0,dictFilters.shown).map((w,i)=>renderWordRow(w,i)).join('')}</div>
    ${found?`<div class="search-results-foot"><span class="dict-count">Показано ${Math.min(dictFilters.shown,found)} из ${found}</span>${found>dictFilters.shown?`<button class="btn" data-action="more-words">Показать ещё 40 ${icon('arrow')}</button>`:''}</div>`:`<div class="panel blank-state">Ничего не найдено. Попробуй другое слово или убери фильтры.</div>`}</div>`}
  function renderWordRow(w,i){return `<div class="panel word-row"><span class="word-index">${String(i+1).padStart(3,'0')}</span><div class="word-main"><h3>${escape(w.en)}</h3><p>${escape(w.ru)}</p><div class="word-meta"><span>${escape(w.level)}</span><span>•</span><span>${escape(TOPIC_LABELS[w.topic]||'Словарь')}</span>${state.learned[w.id]?.mastered?'<span class="learned-dot" title="Изучено">✓</span>':''}</div></div><button class="icon-btn" data-action="study-word" data-id="${w.id}" aria-label="Изучить выражение">${icon('arrow')}</button></div>`}
  function renderAI(){const model=activeModel();return showPageHeading('INTELLIGENCE CENTER','ИИ-центр','Подключай сколько угодно собственных моделей и совместимых API без пересборки сайта.',`<button class="btn btn-primary" data-action="add-model">${icon('plus')} Добавить модель</button>`)+
    `<div class="ai-top"><div class="panel ai-status-card"><span class="eyebrow">MODEL NETWORK</span><h2>${model?escape(model.name):'Ожидаем подключение'}</h2><p>${model?`${escape(providerName(model.provider))} · ${escape(model.model)}. Для запроса нужен подключённый сервер и ключ доступа.`:'Подключи OpenAI, Gemini, Cloudflare, OpenRouter или собственный совместимый API. Все модели будут доступны в одном интерфейсе.'}</p><div style="margin-top:18px"><span class="chip ${model?'chip-green':'chip-blue'}">${model?'МОДЕЛЬ ВЫБРАНА':'МОДЕЛЬ НЕ ВЫБРАНА'}</span></div></div>
    <div class="panel model-count-card"><span class="tiny-label">TOTAL INTEGRATIONS</span><strong>${state.models.length.toString().padStart(2,'0')}</strong><span class="text-muted">Добавляй и переключай модели в любой момент</span></div></div>
    <div class="section-head"><div><div class="tiny-label">YOUR AI CONSTELLATION</div><h2>Мои модели</h2></div></div>
    <div class="model-grid">${state.models.length?state.models.map(m=>`<div class="panel model-card ${model?.id===m.id?'active':''}"><div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><h3>${escape(m.name)}</h3><p>${escape(providerName(m.provider))} / ${escape(m.model)}</p></div><span class="chip ${model?.id===m.id?'chip-green':'chip-blue'}">${model?.id===m.id?'ACTIVE':'SAVED'}</span></div><div class="model-actions"><button class="btn btn-small ${model?.id===m.id?'':'btn-primary'}" data-action="use-model" data-id="${m.id}">${model?.id===m.id?'Выбрана':'Выбрать'}</button><button class="btn btn-small" data-action="edit-model" data-id="${m.id}">${icon('pencil')} Изменить</button><button class="btn btn-small" data-action="test-model" data-id="${m.id}">Тест</button><button class="icon-btn" data-action="delete-model" data-id="${m.id}" aria-label="Удалить">${icon('trash')}</button></div></div>`).join(''):`<div class="panel blank-state" style="grid-column:1/-1"><h3>Пока ни одной модели</h3><p>Добавь первую модель через кнопку сверху. Можно подключить как официальные, так и свои совместимые API.</p><button class="btn btn-primary" data-action="add-model">${icon('plus')} Добавить модель</button></div>`}</div>
    <div class="panel ai-chat"><div><div class="tiny-label">COMMUNICATION CHANNEL</div><h3 style="margin:5px 0 2px;font:400 27px var(--serif)">Чат с преподавателем</h3><p class="privacy-note">Учебный чат подключается к выбранной модели через твой сервер. Токены не сохраняются в базе сайта.</p></div>
    <div class="chat-messages" id="chat-messages">${chat.length?chat.map(m=>`<div class="chat-bubble ${m.role==='user'?'user':''}">${escape(m.text)}</div>`).join(''):`<div class="chat-bubble">Привет! Я твой языковой навигатор. Подключи модель и задай вопрос по английской грамматике, словам или IELTS. 🌌</div>`}</div>
    <form class="chat-compose" id="chat-form"><input class="field" id="chat-input" autocomplete="off" placeholder="Спроси что-нибудь на английском..." ${busyAI?'disabled':''}><button class="btn btn-primary" type="submit" ${busyAI?'disabled':''}>${icon('arrow')}</button></form></div>
    <div class="feedback models-tip"><strong>Безопасность:</strong> API-ключи по умолчанию живут только в текущей вкладке. При желании их можно сохранить до закрытия вкладки. На публичном статическом хостинге ИИ недоступен без своего серверного посредника; ключи нельзя выкладывать в GitHub. Подключай только сервисы, к которым у тебя есть законный доступ.</div>`}
  function renderProfile(){const s=stats();return showPageHeading('COMMANDER PROFILE','Мой профиль','Достижения, маршрут обучения и личные настройки.')+
    `<div class="profile-layout"><div class="panel profile-card"><div class="profile-identity"><div class="profile-avatar">${escape((state.username||'L').slice(0,1).toUpperCase())}</div><div><div class="tiny-label">FLIGHT COMMANDER</div><h2>${escape(state.username)}</h2><p>Explorer · ${escape(state.level)} · ${cloudUser?'Облачный профиль':'Локальный профиль'}</p></div></div>
    <div class="profile-stats"><div class="panel"><span>Изучено</span><strong>${formatNum(s.learned)}</strong><span>карточек</span></div><div class="panel"><span>Серия</span><strong>${state.streak}</strong><span>дней</span></div><div class="panel"><span>Опыт</span><strong>${formatNum(state.totalXP)}</strong><span>XP</span></div></div>
    <div class="card-separator"></div><div class="tiny-label">YOUR CEFR ROUTE</div><div class="level-journey">${['B1','B2','C1'].map(l=>`<div class="level-tile ${state.level===l?'active':''}"><strong>${l}</strong><small>${formatNum(s.byLevel[l])} изучено</small></div>`).join('')}</div>
    <p class="footnote" style="margin-top:18px">Уровень B1/B2/C1 выбирается вручную. Число карточек не является официальной оценкой твоего уровня английского.</p></div>
    <div class="panel profile-settings"><div class="tiny-label">MISSION PREFERENCES</div><h3>Настройки полёта</h3>
    <div class="field-group"><label class="field-label" for="profile-name">Имя исследователя</label><input class="field" id="profile-name" maxlength="28" value="${escape(state.username)}"></div>
    <div class="field-group"><label class="field-label" for="profile-level">Твой уровень</label><select class="select" id="profile-level">${['B1','B2','C1'].map(l=>`<option ${state.level===l?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="field-group"><label class="field-label" for="profile-goal">Цель на день</label><select class="select" id="profile-goal">${[10,12,15].map(v=>`<option value="${v}" ${state.goal===v?'selected':''}>${v} слов и выражений</option>`).join('')}</select></div>
    <button class="btn btn-primary" data-action="save-profile">Сохранить настройки ${icon('check')}</button>
    <div class="card-separator"></div><p class="privacy-note">Прогресс хранится на устройстве и при включённом Supabase синхронизируется с облаком.</p>
    <div class="form-actions" style="margin:10px 0 20px"><button class="btn btn-small" data-action="export-data">${icon('arrow')} Экспорт прогресса</button><button class="btn btn-small" data-action="import-data">Импорт прогресса</button><input id="import-progress-file" type="file" accept="application/json,.json" style="display:none"></div>
    <button class="btn btn-danger btn-small" data-action="reset-data">Сбросить прогресс</button></div></div>${renderCloudPanel()}`}
  function render(){if(!MAIN)return;MAIN.innerHTML={home:renderHome,learn:renderLearn,dictionary:renderDictionary,ai:renderAI,profile:renderProfile}[route]();document.querySelectorAll('[data-route]').forEach(b=>{b.classList.toggle('is-active',b.dataset.route===route)});const c=$('#chat-messages');if(c)c.scrollTop=c.scrollHeight;}
  function normal(s){return s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z\s'-]/g,' ').replace(/\s+/g,' ').trim()}
  function meaningfulTokens(s){const stop=new Set(['the','a','an','i','you','he','she','they','we','it','to','my','our','your','is','are','was','were','for','in','of','on','and','that','be','it','with','do','can','have','would','will']);return normal(s).split(' ').filter(x=>x.length>2&&!stop.has(x))}
  function checkSentenceOffline(sentence,expression){if(!sentence||sentence.trim().length<9)return{type:'warn',text:'Напиши полное предложение — хотя бы несколько слов.'};const target=meaningfulTokens(expression);const text=normal(sentence);const hits=target.filter(w=>text.split(' ').includes(w));const threshold=target.length<=2?target.length:Math.max(2,Math.ceil(target.length*.65));if(hits.length<threshold)return{type:'warn',text:`Используй выражение в предложении. Найдено ключевых слов: ${hits.length} из ${target.length}.`};let hints=[];if(!/^[A-Z]/.test(sentence.trim()))hints.push('Начни с большой буквы.');if(!/[.!?]$/.test(sentence.trim()))hints.push('Добавь точку, вопросительный или восклицательный знак.');return{type:'success',text:`Выражение использовано в предложении. ${hints.join(' ')} Это базовая проверка, а не полноценная оценка грамматики. Для неё подключи ИИ. Продолжай к написанию.`}}
  function setLessonFeedback(f){lessonFeedback=f;const target=$('#lesson-feedback');if(target)target.innerHTML=feedbackHTML(f)}
  function speech(word){if(!('speechSynthesis' in window)){toast('Произношение не поддерживается браузером.');return}try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(word.en);u.lang='en-US';u.rate=.85;window.speechSynthesis.speak(u)}catch{toast('Не удалось воспроизвести произношение')}}
  function getSecret(id){return secrets[id]||''}
  function modelById(id){return state.models.find(x=>x.id===id)}
  function modelDialog(model){editingModel=model?.id||null;const current=model||{name:'',provider:'openai',model:PROVIDERS.openai.defaultModel,endpoint:'',accountId:''};const div=el('div',{className:'dialog-backdrop',id:'model-dialog'});div.innerHTML=`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="model-dialog-title"><div class="dialog-header"><h2 id="model-dialog-title">${model?'Настроить модель':'Новая модель ИИ'}</h2><button class="icon-btn" data-action="close-dialog" aria-label="Закрыть">${icon('close')}</button></div>
    <form id="model-form" class="form-grid" autocomplete="off"><div class="field-group"><label class="field-label" for="model-name">Название</label><input class="field" id="model-name" maxlength="70" required placeholder="Мой GPT" value="${escape(current.name)}"></div>
    <div class="field-group"><label class="field-label" for="model-provider">Провайдер</label><select id="model-provider" class="select">${Object.entries(PROVIDERS).map(([k,p])=>`<option value="${k}" ${current.provider===k?'selected':''}>${escape(p.label)}</option>`).join('')}</select></div>
    <div class="field-group form-wide"><label class="field-label" for="model-id">Идентификатор модели</label><input class="field" id="model-id" required placeholder="gpt-4.1-mini" value="${escape(current.model)}"></div>
    <div class="field-group form-wide"><label class="field-label" for="model-key">API-ключ / токен</label><input class="field" type="password" id="model-key" placeholder="${getSecret(model?.id)?'Токен уже задан в этой сессии':'Вставь токен сюда'}" value="" autocomplete="off"></div>
    <div class="field-group form-wide" id="model-account-group" style="${current.provider==='cloudflare'?'':'display:none'}"><label class="field-label" for="model-account">Cloudflare Account ID</label><input class="field" id="model-account" value="${escape(current.accountId||'')}" placeholder="Cloudflare Account ID"></div>
    <div class="field-group form-wide" id="model-endpoint-group" style="${current.provider==='custom'?'':'display:none'}"><label class="field-label" for="model-endpoint">Полный URL Chat Completions</label><input class="field" id="model-endpoint" type="url" value="${escape(current.endpoint||'')}" placeholder="https://api.example.com/v1/chat/completions"></div>
    <div class="form-wide"><label class="checkbox-line"><input type="checkbox" id="model-remember" ${getSecret(model?.id)?'checked':''}> Сохранить токен до закрытия этой вкладки (sessionStorage)</label><p class="dialog-help" id="model-provider-hint">${escape(PROVIDERS[current.provider]?.hint||'')}</p><p class="privacy-note">Ключ не будет записан в основной профиль или ZIP. Для безопасности используй свой HTTPS-сервер; любая передача ключа его владельцу требует доверия.</p></div>
    <div class="form-wide form-actions"><button class="btn btn-primary" type="submit">${icon('check')} Сохранить модель</button><button class="btn" type="button" data-action="close-dialog">Отмена</button></div></form></div>`;
    document.body.appendChild(div);div.addEventListener('click',e=>{if(e.target===div)div.remove()});$('#model-provider').addEventListener('change',e=>{const p=e.target.value;$('#model-account-group').style.display=p==='cloudflare'?'':'none';$('#model-endpoint-group').style.display=p==='custom'?'':'none';$('#model-provider-hint').textContent=PROVIDERS[p]?.hint||'';$('#model-id').value=PROVIDERS[p]?.defaultModel||'';});$('#model-form').addEventListener('submit',saveModelForm);$('#model-name').focus();
  }
  function saveModelForm(e){e.preventDefault();const id=editingModel||'m-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);const provider=$('#model-provider').value;const name=$('#model-name').value.trim();const model=$('#model-id').value.trim();const endpoint=$('#model-endpoint').value.trim();const accountId=$('#model-account').value.trim();if(!name||!model)return toast('Название и идентификатор модели обязательны.');if(provider==='custom'&&!/^https:\/\//i.test(endpoint))return toast('Нужен корректный HTTPS URL API.');if(provider==='cloudflare'&&!accountId)return toast('Cloudflare требует Account ID.');const old=modelById(id);const entry={id,name,provider,model,endpoint:provider==='custom'?endpoint:'',accountId:provider==='cloudflare'?accountId:''};if(old)Object.assign(old,entry);else state.models.push(entry);if(!state.activeModel)state.activeModel=id;state.modelsUpdatedAt=Date.now();const key=$('#model-key').value.trim();if(key)secrets[id]=key;if(!$('#model-remember').checked){const remembered=readJSON(SESSION,KEYS_SESSION,{});delete remembered[id];SESSION.setItem(KEYS_SESSION,JSON.stringify(remembered))}else if(secrets[id]){const remembered=readJSON(SESSION,KEYS_SESSION,{});remembered[id]=secrets[id];SESSION.setItem(KEYS_SESSION,JSON.stringify(remembered))}save();$('#model-dialog').remove();render();toast('Модель добавлена. Выбери её и проверь подключение.')}
  async function aiRequest(model,kind,message,extra={}){
    if(!model)throw Error('Сначала выбери модель в ИИ-центре.');
    const key=getSecret(model.id);
    const body={provider:model.provider,model:model.model,endpoint:model.endpoint||'',accountId:model.accountId||'',apiKey:key,kind,message,...extra};
    const response=await fetch('./api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout?AbortSignal.timeout(35000):undefined});
    let parsed;
    try{parsed=await response.json()}catch{throw Error('Сервер ИИ недоступен. На GitHub Pages нужен отдельный Node.js-сервер. См. README.')} 
    if(!response.ok)throw Error(parsed.error||`Ошибка ${response.status}`);
    return parsed;
  }
  async function testModel(id){const model=modelById(id);if(!model)return;toast('Отправляю тестовый запрос...');try{const r=await aiRequest(model,'test','Ответь одним словом: OK');toast('Ответ модели: '+(r.text||'Подключение работает').slice(0,130))}catch(err){toast('Тест не пройден: '+err.message)}}
  function renderAIResult(result){let f;if(typeof result==='object'&&result.feedback){const x=result.feedback;f={type:(x.score>=70?'success':'warn'),text:`Оценка: ${x.score??'—'}/100\n${x.corrected?'Исправленный вариант: '+x.corrected+'\n':''}${x.explanation||result.text||''}${x.suggestion?'\nСовет: '+x.suggestion:''}`}}else f={type:'warn',text:String(result.text||'Модель не вернула ответа.')};setLessonFeedback(f)}
  async function checkSentenceAI(){const model=activeModel();if(!model)return toast('Сначала подключи модель в ИИ-центре.');const answer=$('#sentence-answer')?.value?.trim();const l=state.lesson;const w=getWord(l?.ids[l.index]);if(!w||!answer)return toast('Сначала напиши предложение.');const btn=$('[data-action="ai-check-sentence"]');if(btn){btn.disabled=true;btn.textContent='Проверяю...'}try{renderAIResult(await aiRequest(model,'check',answer,{expression:w.en,translation:w.ru,level:w.level}));}catch(err){setLessonFeedback({type:'error',text:'ИИ недоступен: '+err.message})}finally{if(btn){btn.disabled=false;btn.innerHTML=icon('stars')+' Проверить с ИИ'}}}
  async function sendChat(e){e.preventDefault();if(busyAI)return;const message=$('#chat-input')?.value.trim();if(!message)return;const model=activeModel();if(!model){toast('Добавь и выбери модель.');return}chat.push({role:'user',text:message});busyAI=true;render();try{const r=await aiRequest(model,'chat',message);chat.push({role:'assistant',text:r.text||'Нет ответа'})}catch(err){chat.push({role:'assistant',text:'Ошибка подключения: '+err.message})}finally{busyAI=false;render()}}
  function handleClicks(e){const btn=e.target.closest('[data-action],[data-route]');if(!btn)return;const action=btn.dataset.action;const targetRoute=btn.dataset.route;if(targetRoute){setRoute(targetRoute);return}const l=state.lesson;const w=l&&getWord(l.ids?.[l.index]);switch(action){
    case 'start-lesson':if(lessonValid()&&l.index<l.ids.length){setRoute('learn')}else createLesson();break;
    case 'new-lesson':createLesson();break;
    case 'lesson-to-sentence':l.stage='sentence';lessonFeedback=null;save();render();$('#sentence-answer')?.focus();break;
    case 'lesson-to-spelling':l.stage='spelling';lessonFeedback=null;save();render();$('#spelling-answer')?.focus();break;
    case 'check-sentence':{const a=$('#sentence-answer')?.value||'';const f=checkSentenceOffline(a,w.en);setLessonFeedback(f);if(f.type==='success'){const footer=$('#lesson-feedback');footer.insertAdjacentHTML('beforeend',`<div class="lesson-actions"><button class="btn btn-primary" data-action="lesson-to-spelling">К диктанту ${icon('arrow')}</button></div>`)}break}
    case 'ai-check-sentence':checkSentenceAI();break;
    case 'check-spelling':{const typed=normal($('#spelling-answer')?.value||'');const correct=normal(w.en);if(!typed)return toast('Введите свой ответ.');if(typed===correct){completeWord(w);setLessonFeedback({type:'success',text:'Верно! +20 XP. Эта карточка появится в повторении позже.'});const f=$('#lesson-feedback');f.insertAdjacentHTML('beforeend',`<div class="lesson-actions"><button class="btn btn-primary" data-action="next-word">${l.index===l.ids.length-1?'Завершить миссию':'Следующая карточка'} ${icon('arrow')}</button></div>`);$('#spelling-answer').disabled=true;btn.disabled=true}else{resetMistake(w);setLessonFeedback({type:'warn',text:'Пока неверно. Проверь пробелы и написание. Можешь попробовать ещё раз или открыть ответ.'});}break}
    case 'reveal-answer':setLessonFeedback({type:'warn',text:'Правильный ответ: '+w.en+'\nПерепиши выражение самостоятельно, чтобы закрепить написание.'});break;
    case 'next-word':nextLesson();break;
    case 'speak':{const word=getWord(btn.dataset.word);if(word)speech(word);break}
    case 'study-word':createLesson(btn.dataset.id);break;
    case 'more-words':dictFilters.shown+=40;render();break;
    case 'add-model':modelDialog(null);break;
    case 'edit-model':modelDialog(modelById(btn.dataset.id));break;
    case 'use-model':state.activeModel=btn.dataset.id;state.modelsUpdatedAt=Date.now();save();render();toast('Модель выбрана');break;
    case 'test-model':testModel(btn.dataset.id);break;
    case 'delete-model':if(confirm('Удалить эту модель?')){state.models=state.models.filter(m=>m.id!==btn.dataset.id);delete secrets[btn.dataset.id];const k=readJSON(SESSION,KEYS_SESSION,{});delete k[btn.dataset.id];SESSION.setItem(KEYS_SESSION,JSON.stringify(k));if(state.activeModel===btn.dataset.id)state.activeModel=state.models[0]?.id||null;state.modelsUpdatedAt=Date.now();save();render()}break;
    case 'close-dialog':$('#model-dialog')?.remove();break;
    case 'save-profile':{const name=$('#profile-name')?.value.trim();if(name)state.username=name;const level=$('#profile-level')?.value,goal=Number($('#profile-goal')?.value);if(level!==state.level||goal!==state.goal)state.lesson=null;state.level=level;state.goal=goal;state.profileUpdatedAt=Date.now();save();render();toast('Настройки сохранены');break}
    case 'export-data':{const snapshot={app:'lexora-orbit',exportedAt:new Date().toISOString(),profile:{username:state.username,level:state.level,goal:state.goal,learned:state.learned,daily:state.daily,totalXP:state.totalXP,streak:state.streak,lastStudy:state.lastStudy},models:state.models,activeModel:state.activeModel};const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=el('a',{href:url,download:'lexora-orbit-progress.json'});document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Резервная копия создана. API-ключи в неё не включены.');break;}
    case 'import-data':$('#import-progress-file')?.click();break;
    case 'cloud-sync':pushCloud();toast('Проверяю синхронизацию');break;
    case 'cloud-logout':cloudSignOut();break;
    case 'reset-data':if(confirm('Удалить ВСЕ изученные слова, уровень и статистику? Это нельзя отменить.')){state.learned={};state.daily={};state.lesson=null;state.totalXP=0;state.streak=0;state.lastStudy=null;save();render();toast('Прогресс сброшен')}break;
  }}
  function initEvents(){document.addEventListener('click',handleClicks);document.addEventListener('submit',e=>{if(e.target.id==='chat-form')sendChat(e);if(e.target.id==='cloud-auth-form')cloudAccountAction(e);if(e.target.id==='cloud-config-form'){e.preventDefault();const url=e.target.elements.url.value.trim(),key=e.target.elements.key.value.trim();if(!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url)||key.length<16)return toast('Неверный Supabase URL или publishable key');LOCAL.setItem(CLOUD_SETTINGS_KEY,JSON.stringify({url,publishableKey:key}));initCloud();render();toast('Настройки Supabase сохранены на устройстве.')}});document.addEventListener('input',e=>{if(e.target.id==='dict-search'){const p=e.target.selectionStart;dictFilters.query=e.target.value;dictFilters.shown=40;const result=$('#dict-results');if(result){const tmp=document.createElement('div');tmp.innerHTML=renderDictionary();const next=tmp.querySelector('#dict-results');const count=tmp.querySelector('.page-heading .chip');if(next)result.innerHTML=next.innerHTML;if(count){const chip=$('.page-heading .chip');if(chip)chip.textContent=count.textContent}}}});document.addEventListener('change',async e=>{if(e.target.id==='import-progress-file'){
    const f=e.target.files?.[0];if(!f)return;
    if(f.size>5_000_000)return toast('Файл слишком большой.');
    try{const backup=JSON.parse(await f.text());if(backup.app!=='lexora-orbit'||!backup.profile||typeof backup.profile.learned!=='object')throw Error('Это не резервная копия Lexora');
      if(!confirm('Заменить прогресс в этом браузере данными из файла?'))return;
      const p=backup.profile;
      state.username=String(p.username||'Исследователь').slice(0,28);
      state.level=['B1','B2','C1'].includes(p.level)?p.level:'B1';
      state.goal=[10,12,15].includes(p.goal)?p.goal:15;
      state.learned=Object.fromEntries(Object.entries(p.learned).filter(([id,x])=>WORD_BY_ID.has(id)&&x&&typeof x==='object'));
      state.daily=p.daily&&typeof p.daily==='object'?p.daily:{};
      state.totalXP=Math.max(0,Number(p.totalXP)||0);state.streak=Math.max(0,Number(p.streak)||0);state.lastStudy=p.lastStudy||null;
      state.models=Array.isArray(backup.models)?backup.models.filter(m=>m&&typeof m.id==='string'&&PROVIDERS[m.provider]).slice(0,500):[];
      state.activeModel=state.models.some(m=>m.id===backup.activeModel)?backup.activeModel:null;state.modelsUpdatedAt=Date.now();state.profileUpdatedAt=Date.now();
      state.lesson=null;save();render();toast('Прогресс загружен. Токены подключи заново.');
    }catch(err){toast('Не удалось импортировать: '+err.message)}finally{e.target.value=''}return;
   }if(e.target.id==='dict-level')dictFilters.level=e.target.value;else if(e.target.id==='dict-topic')dictFilters.topic=e.target.value;else if(e.target.id==='dict-learned')dictFilters.learned=e.target.value;else return;dictFilters.shown=40;render()});document.addEventListener('focusin',e=>{if(e.target.matches('input:not([type=checkbox]):not([type=file]), textarea')){document.body.classList.add('keyboard-open')}});
    document.addEventListener('focusout',e=>{if(e.target.matches('input:not([type=checkbox]):not([type=file]), textarea'))setTimeout(()=>{if(!document.activeElement?.matches('input:not([type=checkbox]):not([type=file]), textarea'))document.body.classList.remove('keyboard-open')},180)});
    window.addEventListener('hashchange',()=>{const r=location.hash.replace('#','');if(['home','learn','dictionary','ai','profile'].includes(r)&&r!==route){route=r;render()}})}
  function starfield(){const c=$('#stars');if(!c)return;const ctx=c.getContext('2d');if(!ctx)return;let points=[],W=0,H=0,frame=0;const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;function reset(){const dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;c.width=W*dpr;c.height=H*dpr;c.style.width=W+'px';c.style.height=H+'px';ctx.setTransform(dpr,0,0,dpr,0,0);const n=W<700?75:160;points=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,r:.3+Math.random()*1.2,a:.12+Math.random()*.6,s:Math.random()*6.28}))}function draw(){ctx.clearRect(0,0,W,H);for(const p of points){const a=p.a*(reduce?1:.75+.25*Math.sin(frame*.008+p.s));ctx.fillStyle=`rgba(232,233,239,${a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.2832);ctx.fill()}frame++;if(!reduce)requestAnimationFrame(draw)}addEventListener('resize',reset,{passive:true});reset();draw()}
  if(!WORDS.length)console.error('Vocabulary file failed to load');
  initEvents();render();starfield();initCloud();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudReady)pushCloud()});
  if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
