const ttl = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2,'0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const own = (record, key) => Object.hasOwn(record,key);
const security = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
function respond(data,status=200,headers={}) {
  return new Response(JSON.stringify(data),{status, headers:{...security,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
}
const error = (message,status) => respond({error:message},status);
const query = (env,sql,...values) => env.DB.prepare(sql).bind(...values);

function cookie(value, maxAge, env) {
  return 'dekana_session='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(env.LOCAL_HTTP === '1' ? '' : '; Secure');
}

async function signedIn(request,env) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)dekana_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await query(env,'SELECT student,demo_scope FROM sessions WHERE token_hash = ? AND expires > ?',tokenHash,Date.now()).first();
  return row && (own(students,row.student) || row.student === staffLogin) ? {student:row.student,scope:row.demo_scope||'',tokenHash} : null;
}
async function body(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let input = '';
  for (;;) {
    const {value,done} = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > 4096) {
      await reader.cancel();
      return null;
    }
    input += decoder.decode(value,{stream:true});
  }
  try {
    const result = JSON.parse(input + decoder.decode());
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch { return null; }
}
async function login(request,env) {
  const input = await body(request);
  if (!input || typeof input.login !== 'string' || typeof input.password !== 'string' || input.login.length > 80 || input.password.length > 128) return error('Проверьте логин и пароль.',400);
  const login = input.login.trim().toLowerCase();
  const source = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const window = Math.floor(now / 600000) * 600000;
  const bucket = await digest(source + ':' + window);
  const limit = await query(env,'INSERT INTO login_limits(bucket,attempts,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 30 RETURNING attempts',bucket,window+600000).first();
  if (!limit) return error('Слишком много попыток. Повторите вход через несколько минут.',429);
  const known = own(students,login) || login === staffLogin;
  const [salt, expected] = known ? credentials[login] : credentials.dummy;
  const key = await crypto.subtle.importKey('raw',encoder.encode(input.password),'PBKDF2',false,['deriveBits']);
  const actual = hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256));
  let mismatch = 0;
  for (let i=0;i<expected.length;i++) mismatch |= actual.charCodeAt(i)^expected.charCodeAt(i);
  if (!known || mismatch) return error('Логин или пароль не подошли.',401);
  const old = await signedIn(request,env);
  if (old) await query(env,'DELETE FROM sessions WHERE token_hash = ?',old.tokenHash).run();
  await query(env,'DELETE FROM sessions WHERE expires <= ?',now).run();
  await query(env,'DELETE FROM login_limits WHERE expires <= ?',now).run();
  return issueSession(env,login);
}
async function issueSession(env, login, scope=null) {
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await query(env,'INSERT INTO sessions(token_hash,student,expires,demo_scope) VALUES (?,?,?,?)',await digest(token),login,Date.now()+ttl,scope).run();
  return respond({ok:true},200,{'Set-Cookie':cookie(token,ttl/1000,env)});
}
const storedOwner = (scope,login) => scope ? scope+':'+login : login;
const lastMessage = "(SELECT kind FROM application_messages WHERE application_id=applications.id ORDER BY id DESC LIMIT 1)";
const fields = 'id,type,note,created,started_at,resolved_at,reply,conflict_event,conflict_day,conflict_lesson,offer_start,offer_room,offer_at,accepted_at,'+lastMessage+' AS latest_message';
const applicationId = '[a-f0-9-]{36}';
function present(row) {
  const {id,type,note,created,started_at,resolved_at,reply} = row;
  const status=row.accepted_at?'Замена подтверждена':resolved_at?(type==='request'?'Есть ответ':'Готово'):row.offer_at?'Предложена замена':row.latest_message==='question'?'Нужно уточнение':started_at?'На рассмотрении':'Принята';
  const history = [{at:created, label:'Заявка принята'}];
  if (started_at) history.push({at:started_at,label:'Взята на рассмотрение'});
  if(row.offer_at) history.push({at:row.offer_at,label:'Деканат предложил замену'});
  if(row.accepted_at) history.push({at:row.accepted_at,label:'Студент подтвердил замену'});
  else if (resolved_at) history.push({at:resolved_at,label:type==='request'?'Деканат ответил':'Документ готов'});
  return {id,type,note,created,history,reply:reply || '',status,open:!resolved_at,inProgress:Boolean(started_at),
    awaitingStudent:!resolved_at && !row.offer_at && row.latest_message==='question',
    conflictEvent:row.conflict_event||null,conflictDay:row.conflict_day||null,
    offer:row.offer_at ? {day:row.conflict_day,lesson:row.conflict_lesson,start:row.offer_start,room:row.offer_room,accepted:Boolean(row.accepted_at)} : null,title:types[type].title,time:types[type].time,
    documentReady:Boolean(resolved_at && type!=='request')};
}
function attachment(file,mime,name) {
  return new Response(file,{headers:{...security,'Content-Type':mime,'Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'no-store'}});
}
function calendar(item,owner) {
  const day=item.day.replaceAll('-','');
  const stamp=new Date().toISOString().replace(/[-:]|\.\d{3}/g,'');
  const utc=time=>new Date(item.day+'T'+time+':00+03:00').toISOString().replace(/[-:]|\.\d{3}/g,'');
  return attachment([
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dekana//Student Portal//RU','CALSCALE:GREGORIAN',
    'BEGIN:VEVENT','UID:'+owner+'-'+item.id+'-'+day+'@dekana.example','DTSTAMP:'+stamp,
    'DTSTART:'+utc(item.start),'DTEND:'+utc(item.end),'SUMMARY:'+item.name,
    'LOCATION:'+item.room,'DESCRIPTION:Демособытие','END:VEVENT','END:VCALENDAR',''
  ].join('\r\n'),'text/calendar; charset=utf-8','dekana-event.ics');
}
async function bookingFor(env,scope,owner) {
  const row=await query(env,'SELECT slot FROM consultation_bookings WHERE scope=? AND owner=? AND slot>=?',scope,owner,students[owner].room+'-'+today()).first();
  return row ? consultationSlot(students[owner],row.slot.slice(2)) : null;
}
async function messagesFor(env,id) {
  return (await query(env,'SELECT kind,message,created FROM application_messages WHERE application_id=? ORDER BY id',id).all()).results;
}
async function addMessage(env,row,kind,message) {
  if (typeof message!=='string' || !message.trim() || message.trim().length>500) return error('Напишите сообщение до 500 символов.',400);
  const predicate=kind==='question' ? "COALESCE("+lastMessage+",'')<>'question'" : lastMessage+"='question'";
  const saved=await query(env,'INSERT INTO application_messages(application_id,kind,message,created) SELECT id,?,?,? FROM applications WHERE id=? AND owner=? AND started_at IS NOT NULL AND resolved_at IS NULL AND offer_at IS NULL AND '+predicate+' AND (SELECT COUNT(*) FROM application_messages WHERE application_id=applications.id)<30 RETURNING id',
    kind,message.trim(),Date.now(),row.id,row.owner).first();
  return saved ? null : error('Статус изменился или достигнут предел сообщений. Обновите карточку.',409);
}
async function scheduleChange(env,owner,scope) {
  const replacement=await query(env,'SELECT event_id,day,start,new_start,room,published FROM demo_schedule_changes WHERE owner=?',storedOwner(scope,owner)).first();
  if(replacement) return {...replacement,saved:true};
  if (scope && owner==='student.nord') {
    const next=baseSchedule(students[owner]).find(d=>d.day>today() && d.lessons.length>=2);
    if(next) return {day:next.day,start:'09:00',new_start:'11:00',room:'Б–312',published:today(),event_id:'jury-'+next.day};
  }
  return changes[owner];
}
async function academicFor(env,scope,owner) {
  const storage=storedOwner(scope,owner);
  const [change,booking,resolutions]=await Promise.all([
    scheduleChange(env,owner,scope),
    bookingFor(env,scope,owner),
    query(env,'SELECT conflict_event,conflict_day,conflict_lesson,offer_start,offer_room FROM applications WHERE owner=? AND accepted_at IS NOT NULL ORDER BY accepted_at,id',storage).all()
  ]);
  return {change,booking,academic:academicData(students[owner],change,booking,resolutions.results)};
}
function optionsFor(academic,row,room) {
  const conflict=academic.conflicts.find(item=>item.event===row.conflict_event);
  if(!conflict) return [];
  const busy=academic.schedule.find(day=>day.day===conflict.day).lessons.filter(item=>item!==conflict.moved);
  const duration=minutes(conflict.moved.end)-minutes(conflict.moved.start);
  return ['14:30','16:00','17:45'].map(start=>({start,end:shiftTime(start,duration),room:room+'–204'})).filter(item=>!busy.some(lesson=>overlaps(lesson,item)));
}
async function offerFor(env,scope,row) {
  if(!row.conflict_event || row.resolved_at || row.offer_at) return [];
  const owner=row.owner.split(':').at(-1);
  const {academic}=await academicFor(env,scope,owner);
  return optionsFor(academic,row,students[owner].room);
}
async function acceptOffer(env,scope,owner,row) {
  const storage=storedOwner(scope,owner);
  const {change,booking,academic}=await academicFor(env,scope,owner);
  const valid=optionsFor(academic,row,students[owner].room).some(item=>item.start===row.offer_start && item.room===row.offer_room);
  if(!valid) return error('Предложенное время больше не подходит. Попросите деканат проверить замену.',409);
  const now=Date.now();
  const updated=await query(env,`UPDATE applications SET accepted_at=?,resolved_at=?
    WHERE owner=? AND id=? AND resolved_at IS NULL AND offer_at=?
    AND COALESCE((SELECT event_id FROM demo_schedule_changes WHERE owner=?),'')=?
    AND COALESCE((SELECT slot FROM consultation_bookings WHERE scope=? AND owner=? AND slot>=?),'')=?
    AND NOT EXISTS(SELECT 1 FROM applications AS prior WHERE prior.owner=? AND prior.conflict_event=? AND prior.accepted_at IS NOT NULL)
    RETURNING id`,now,now,storage,row.id,row.offer_at,storage,change?.saved?change.event_id:'',
    scope,owner,students[owner].room+'-'+today(),booking?.id||'',storage,row.conflict_event).first();
  return updated?respond({ok:true}):error('Расписание или статус уже изменились. Обновите заявку.',409);
}
async function publishDemoChange(request,env,scope) {
  const input=await body(request);
  if (!input || typeof input.owner!=='string' || !own(students,input.owner) || !lessonStarts.includes(input.start) ||
      typeof input.room!=='string' || !/^[А-ЯA-Z][– -]?[0-9]{2,4}$/u.test(input.room.trim())) return error('Проверьте группу, время и аудиторию.',400);
  const newStart=input.newStart || input.start;
  if (typeof newStart!=='string' || !/^(0[8-9]|1[0-9]|20):[0-5][0-9]$/.test(newStart)) return error('Укажите новое время с 08:00 до 20:59.',400);
  const target=baseSchedule(students[input.owner]).find(d=>d.day===input.day && d.day>=today());
  const lesson=target?.lessons.find(l=>l.key===input.start);
  if(!lesson) return error('В этот день и время занятия нет.',400);
  const room=input.room.trim().replace(/^([А-ЯA-Z])[-– ]?/u,'$1–');
  if(room===lesson.room && newStart===lesson.start) return error('Измените время или аудиторию.',400);
  await query(env,'INSERT INTO demo_schedule_changes(owner,event_id,day,start,new_start,room,published) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET event_id=excluded.event_id,day=excluded.day,start=excluded.start,new_start=excluded.new_start,room=excluded.room,published=excluded.published',
    storedOwner(scope,input.owner),crypto.randomUUID(),target.day,lesson.key,newStart,room,today()).run();
  return respond({ok:true,day:target.day,start:newStart,room},201);
}
function staffRecord(row,messages,options) {
  const login=row.owner.split(':').at(-1);
  return {...present(row),messages,options,student:students[login]?.profile.name || 'Студент'};
}
async function staffApi(request,env,path,scope) {
  const owners=Object.keys(students).map(login=>storedOwner(scope,login));
  if(path==='/api/home' && request.method==='GET') {
    const {results}=await query(env,'SELECT owner,'+fields+' FROM applications WHERE owner IN (?,?) ORDER BY created DESC LIMIT 200',...owners).all();
    const groups=Object.entries(students).map(([value,student])=>({value,label:student.profile.group}));
    return respond({role:'staff',profile:staffProfile,today:today(),groups,demo:Boolean(scope),applications:results.map(row=>staffRecord(row))});
  }
  if(path==='/api/staff/schedule' && request.method==='POST') return publishDemoChange(request,env,scope);
  const id=path.match(new RegExp('^/api/staff/applications/('+applicationId+')$'))?.[1];
  if(!id) return error('Страница не найдена.',404);
  const select=()=>query(env,'SELECT owner,'+fields+' FROM applications WHERE id=? AND owner IN (?,?)',id,...owners).first();
  const current=await select();
  if(!current) return error('Заявка не найдена.',404);
  const detail=async row=>staffRecord(row,await messagesFor(env,id),await offerFor(env,scope,row));
  if(request.method==='GET') return respond(await detail(current));
  if(request.method!=='POST') return error('Страница не найдена.',404);
  const input=await body(request);
  if(!['start','complete','question','offer','withdraw'].includes(input?.action)) return error('Выберите действие.',400);
  if(input.action==='question') {
    const issue=await addMessage(env,current,'question',input.reply);
    return issue || respond(await detail(await select()));
  }
  const now=Date.now();
  let updated;
  if(input.action==='start') {
    updated=await query(env,'UPDATE applications SET started_at=? WHERE id=? AND owner=? AND started_at IS NULL AND resolved_at IS NULL RETURNING id',now,id,current.owner).first();
  } else if(input.action==='offer') {
    const options=await offerFor(env,scope,current);
    const option=options.find(item=>item.start===input.start);
    if(!option) return error('Это время больше недоступно. Обновите заявку.',409);
    updated=await query(env,"UPDATE applications SET offer_start=?,offer_room=?,offer_at=? WHERE id=? AND owner=? AND started_at IS NOT NULL AND resolved_at IS NULL AND offer_at IS NULL AND COALESCE("+lastMessage+",'')<>'question' RETURNING id",
      option.start,option.room,now,id,current.owner).first();
  } else if(input.action==='withdraw') {
    updated=await query(env,'UPDATE applications SET offer_start=NULL,offer_room=NULL,offer_at=NULL WHERE id=? AND owner=? AND resolved_at IS NULL AND offer_at IS NOT NULL RETURNING id',id,current.owner).first();
  } else {
    const reply=typeof input.reply==='string'?input.reply.trim():'';
    if(reply.length>500 || (current.type==='request' && !reply)) return error('Для вопроса нужен ответ до 500 символов.',400);
    updated=await query(env,"UPDATE applications SET resolved_at=?, reply=? WHERE id=? AND owner=? AND started_at IS NOT NULL AND resolved_at IS NULL AND offer_at IS NULL AND COALESCE("+lastMessage+",'')<>'question' RETURNING id",now,reply,id,current.owner).first();
  }
  if(!updated) return error('Статус уже изменился. Обновите очередь.',409);
  return respond(await detail(await select()));
}
async function beginDemo(request,env,session) {
  const now=Date.now(), window=Math.floor(now/600000)*600000;
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const bucket=await digest('jury:'+ip+':'+window);
  const limit=await query(env,'INSERT INTO login_limits(bucket,attempts,expires) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 WHERE attempts<25 RETURNING attempts',bucket,1,window+600000).first();
  if(!limit) return error('Слишком много пробных входов. Повторите позже.',429);
  if(session) await query(env,'DELETE FROM sessions WHERE token_hash=?',session.tokenHash).run();
  return issueSession(env,'student.nord',crypto.randomUUID());
}
async function api(request,env,url) {
  const path = url.pathname;
  const method = request.method;
  if (method === 'POST' && request.headers.get('origin') !== url.origin) return error('Запрос отклонён.',403);
  if (path === '/api/login' && method === 'POST') return login(request,env);
  const session = await signedIn(request,env);
  if (path==='/api/demo/start' && method==='POST') return beginDemo(request,env,session);
  if (!session) return error('Войдите в кабинет.',401);
  const {scope,student:owner}=session;
  const storage=storedOwner(scope,owner);
  if(path==='/api/demo/switch' && method==='POST') {
    const input=await body(request);
    if(!scope || typeof input?.role!=='string' || (!own(students,input.role) && input.role!==staffLogin)) return error('Переключение доступно в деморежиме.',403);
    const changed=await query(env,'UPDATE sessions SET student=? WHERE token_hash=? AND demo_scope=? AND expires>? RETURNING student',input.role,session.tokenHash,scope,Date.now()).first();
    return changed ? respond({ok:true}) : error('Сессия закончилась.',401);
  }
  if (path === '/api/logout' && method === 'POST') {
    await query(env,'DELETE FROM sessions WHERE token_hash = ?',session.tokenHash).run();
    return respond({ok:true},200,{'Set-Cookie':cookie('',0,env)});
  }
  if (owner === staffLogin) return staffApi(request,env,path,scope);
  if (path.startsWith('/api/staff/')) return error('Недоступно для этого аккаунта.',403);
  if (path === '/api/home' && method === 'GET') {
    const student = students[owner];
    const [applications,read,snapshot,checks]=await Promise.all([
      query(env,'SELECT '+fields+' FROM applications WHERE owner = ? ORDER BY created DESC LIMIT 100',storage).all(),
      query(env,'SELECT notice FROM notices_read WHERE owner = ?',storage).all(),
      academicFor(env,scope,owner),
      query(env,'SELECT step FROM study_checks WHERE owner=?',storage).all(),
    ]);
    const {academic,change,booking}=snapshot;
    const available=academic.slots.filter(slot=>!academic.schedule.find(d=>d.day===slot.day)?.lessons.some(lesson=>lesson.key!=='consultation' && overlaps(lesson,slot)));
    return respond({role:'student',demo:Boolean(scope),demoStudent:scope?owner:null,...academic,slots:available,booking,types,checks:checks.results.map(row=>row.step),
      applications:applications.results.map(present),notices:noticesFor(student,new Set(read.results.map(row=>row.notice)),academic,change)});
  }
  if (path === '/api/applications' && method === 'POST') {
    const input = await body(request);
    const note = typeof input?.note === 'string' ? input.note.trim() : '';
    if (typeof input?.type !== 'string' || !own(types,input.type) || typeof input.note !== 'string' || note.length > 500 || (input.type === 'request' && !note)) return error('Укажите вид заявки и проверьте комментарий.',400);
    const {type}=input;
    const conflictKey=typeof input.conflictEvent==='string' && type==='request' ? input.conflictEvent : null;
    let conflict;
    if(conflictKey) {
      const {academic}=await academicFor(env,scope,owner);
      conflict=academic.conflicts.find(item=>item.event===conflictKey);
      if(!conflict) return error('Конфликт больше не актуален. Обновите расписание.',409);
    }
    const id=crypto.randomUUID();
    const created=Date.now();
    const row=await query(env,'INSERT INTO applications(id,owner,type,note,created,conflict_event,conflict_day,conflict_lesson) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM applications WHERE owner=?)<100 ON CONFLICT DO NOTHING RETURNING id',
      id,storage,type,note,created,conflictKey,conflict?.day||null,conflict?.moved.key||null,storage).first();
    if(!row && conflictKey) {
      const existing=await query(env,'SELECT '+fields+' FROM applications WHERE owner=? AND conflict_event=? AND resolved_at IS NULL',storage,conflictKey).first();
      if(existing) return respond(present(existing));
    }
    if(!row) return error('В демоверсии доступно до 100 заявок на аккаунт.',409);
    return respond(present({id,type,note,created,conflict_event:conflictKey}),201);
  }
  const record = path.match(new RegExp('^/api/applications/('+applicationId+')(/document)?$'));
  if (method === 'GET' && record) {
    const row = await query(env,'SELECT '+fields+' FROM applications WHERE id = ? AND owner = ?',record[1],storage).first();
    if (!row) return error('Заявка не найдена.',404);
    if (!record[2]) return respond({...present(row),messages:await messagesFor(env,row.id)});
    const bytes = row.resolved_at && documents[owner+':'+row.type];
    return bytes ? attachment(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)),'application/pdf','dekana-demo.pdf') : error('Документ ещё недоступен.',404);
  }
  if (method==='POST' && record && !record[2]) {
    const input=await body(request);
    const row=await query(env,'SELECT owner,'+fields+' FROM applications WHERE id=? AND owner=?',record[1],storage).first();
    if (!row) return error('Заявка не найдена.',404);
    if(input?.action==='accept') {
      if(row.accepted_at) return respond({ok:true});
      if(!row.offer_at || row.resolved_at) return error('Активного предложения нет.',409);
      return acceptOffer(env,scope,owner,row);
    }
    const issue=await addMessage(env,row,'answer',input?.reply);
    return issue || respond({ok:true},201);
  }
  if(path==='/api/study/check' && method==='POST') {
    const input=await body(request);
    const valid=typeof input?.step==='string' && academicData(students[owner]).grades.some(g=>g.steps.some(step=>step.id===input.step));
    if(!valid || typeof input.done!=='boolean') return error('Учебная задача не найдена.',404);
    const sql=input.done?'INSERT OR IGNORE INTO study_checks(owner,step) VALUES (?,?)':'DELETE FROM study_checks WHERE owner=? AND step=?';
    await query(env,sql,storage,input.step).run();
    return respond({ok:true});
  }
  if (path==='/api/consultation' && method==='POST') {
    const input=await body(request);
    if(input?.action==='cancel') {
      await query(env,'DELETE FROM consultation_bookings WHERE scope=? AND owner=?',scope,owner).run();
      return respond({ok:true});
    }
    const {academic}=await academicFor(env,scope,owner);
    const slot=academic.slots.find(item=>item.id===input?.slot);
    if(!slot || academic.schedule.find(day=>day.day===slot.day)?.lessons.some(lesson=>overlaps(lesson,slot))) return error('Слот уже недоступен.',409);
    await query(env,'DELETE FROM consultation_bookings WHERE scope=? AND owner=? AND slot<?',scope,owner,students[owner].room+'-'+today()).run();
    const booked=await query(env,'INSERT INTO consultation_bookings(scope,slot,owner) VALUES (?,?,?) ON CONFLICT DO NOTHING RETURNING slot',scope,slot.id,owner).first();
    return booked ? respond({ok:true},201) : error('Уже есть запись или слот занят.',409);
  }
  if(path==='/api/calendar/consultation' && method==='GET') {
    const booked=await bookingFor(env,scope,owner);
    return booked ? calendar({...booked,name:'Консультация перед сессией'},owner) : error('Запись на консультацию не найдена.',404);
  }
  const event=path.match(/^\/api\/calendar\/([1-9][0-9]*)$/);
  if (method==='GET' && event) {
    const item=academicData(students[owner]).grades.find(g=>g.id===event[1] && !g.grade);
    return item ? calendar({...item,day:item.date,start:item.time,end:shiftTime(item.time,60),name:item.form+' · '+item.name},owner) : error('Предстоящая аттестация не найдена.',404);
  }
  if (path === '/api/notices/read' && method === 'POST') {
    const input = await body(request);
    const change = await scheduleChange(env,owner,scope);
    if (!['room-'+(change.event_id || change.day),'session','services'].includes(input?.id)) return error('Объявление не найдено.',404);
    await query(env,'INSERT OR IGNORE INTO notices_read(owner,notice) VALUES (?,?)',storage,input.id).run();
    return respond({ok:true});
  }
  return error('Страница не найдена.',404);
}
const assetRoutes = {'/':[0,'text/html'], '/styles.css':[1,'text/css'], '/views.js':[2,'text/javascript'], '/app.js':[3,'text/javascript']};
export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request,env,url);
      if (request.method === 'GET' && own(juryFiles,url.pathname)) {
        const {name,mime,base64} = juryFiles[url.pathname];
        return new Response(Uint8Array.from(atob(base64), ch => ch.charCodeAt(0)), {headers:{
          ...security, 'Content-Type':mime, 'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control':'public, max-age=300'
        }});
      }
      if (request.method === 'GET' && own(assetRoutes,url.pathname)) {
        const [index,type] = assetRoutes[url.pathname];
        return new Response(assets[index],{headers:{...security,'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'}});
      }
      return error('Страница не найдена.',404);
    } catch (err) {
      console.error('Dekana request failed', url.pathname, err.message);
      return error('Сервис временно недоступен. Попробуйте ещё раз.',503);
    }
  }
};
