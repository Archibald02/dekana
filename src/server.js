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
  const row = await query(env,'SELECT student FROM sessions WHERE token_hash = ? AND expires > ?',tokenHash,Date.now()).first();
  return row && (own(students,row.student) || row.student === staffLogin) ? { student:row.student, tokenHash } : null;
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
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await query(env,'INSERT INTO sessions(token_hash,student,expires) VALUES (?,?,?)',await digest(token),login,now+ttl).run();
  return respond({ok:true},200,{'Set-Cookie':cookie(token,ttl/1000,env)});
}
const fields = 'id,type,note,created,started_at,resolved_at,reply';
const applicationId = '[a-f0-9-]{36}';
function present(row) {
  const {id,type,note,created,started_at,resolved_at,reply} = row;
  const status = resolved_at ? (type==='request' ? 'Есть ответ' : 'Готово') : started_at ? 'На рассмотрении' : 'Принята';
  const history = [{at:created, label:'Заявка принята'}];
  if (started_at) history.push({at:started_at,label:'Взята на рассмотрение'});
  if (resolved_at) history.push({at:resolved_at,label:type==='request'?'Деканат ответил':'Документ готов'});
  return {id,type,note,created,history,reply:reply || '',status,title:types[type].title,time:types[type].time,
    documentReady:Boolean(resolved_at && type!=='request')};
}
function attachment(file,mime,name) {
  return new Response(file,{headers:{...security,'Content-Type':mime,'Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'no-store'}});
}
function calendar(item,owner) {
  const day=item.date.replaceAll('-','');
  const stamp=new Date().toISOString().replace(/[-:]|\.\d{3}/g,'');
  return attachment([
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dekana//Student Portal//RU','CALSCALE:GREGORIAN',
    'BEGIN:VEVENT','UID:'+owner+'-'+item.id+'-'+day+'@dekana.example','DTSTAMP:'+stamp,
    'DTSTART:'+day+'T070000Z','DTEND:'+day+'T080000Z','SUMMARY:'+item.form+' · '+item.name,
    'LOCATION:'+item.room,'DESCRIPTION:Демособытие','END:VEVENT','END:VCALENDAR',''
  ].join('\r\n'),'text/calendar; charset=utf-8','dekana-assessment.ics');
}
async function scheduleChange(env, owner) {
  const replacement = await query(env,'SELECT event_id,day,start,room,published FROM demo_schedule_changes WHERE owner = ?',owner).first();
  if (!replacement) return changes[owner];
  return {...replacement,previous:students[owner].room+'–'+defaultRooms[lessonStarts.indexOf(replacement.start)]};
}
async function publishDemoChange(request,env) {
  const input = await body(request);
  if (!input || typeof input.owner!=='string' || !own(students,input.owner) || !lessonStarts.includes(input.start) ||
      typeof input.room!=='string' || !/^[А-ЯA-Z]([-– ])?[0-9]{2,4}$/u.test(input.room.trim())) return error('Проверьте группу, время и аудиторию.',400);
  const student=students[input.owner];
  const target=academicData(student,{}).schedule.find(d=>d.day===input.day && d.day>=today());
  const lesson=target?.lessons.find(l=>l.start===input.start);
  if (!lesson) return error('В этот день и время занятия нет.',400);
  const room=input.room.trim().replace(/^([А-ЯA-Z])[-– ]?/u,'$1–');
  if (room===lesson.room) return error('Выберите новую аудиторию.',400);
  await query(env,'INSERT INTO demo_schedule_changes(owner,event_id,day,start,room,published) VALUES (?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET event_id=excluded.event_id,day=excluded.day,start=excluded.start,room=excluded.room,published=excluded.published',
    input.owner,crypto.randomUUID(),target.day,lesson.start,room,today()).run();
  return respond({ok:true,day:target.day,start:lesson.start,room},201);
}
async function staffApi(request,env,path) {
  if (path === '/api/home' && request.method === 'GET') {
    const {results} = await query(env,'SELECT owner,'+fields+' FROM applications ORDER BY created DESC LIMIT 200').all();
    const groups=Object.entries(students).map(([value,student])=>({value,label:student.profile.group}));
    return respond({role:'staff',profile:staffProfile,today:today(),groups,applications:results.map(row=>({...present(row),student:students[row.owner]?.profile.name || 'Студент'}))});
  }
  if(path==='/api/staff/schedule' && request.method==='POST') return publishDemoChange(request,env);
  const id = path.match(new RegExp('^/api/staff/applications/('+applicationId+')$'))?.[1];
  if (!id || request.method !== 'POST') return error('Страница не найдена.',404);
  const input = await body(request);
  if (!['start','complete'].includes(input?.action)) return error('Выберите действие.',400);
  const current = await query(env,'SELECT owner,'+fields+' FROM applications WHERE id = ?',id).first();
  if (!current) return error('Заявка не найдена.',404);
  const now = Date.now();
  let updated;
  if (input.action === 'start') {
    updated = await query(env,'UPDATE applications SET started_at = ? WHERE id = ? AND started_at IS NULL AND resolved_at IS NULL RETURNING owner,'+fields,now,id).first();
  } else {
    const reply = typeof input.reply==='string' ? input.reply.trim() : '';
    if (reply.length>500 || (current.type==='request' && !reply)) return error('Для вопроса нужен ответ до 500 символов.',400);
    updated = await query(env,'UPDATE applications SET resolved_at = ?, reply = ? WHERE id = ? AND started_at IS NOT NULL AND resolved_at IS NULL RETURNING owner,'+fields,now,reply,id).first();
  }
  if (!updated) return error('Статус уже изменился. Обновите очередь.',409);
  return respond({...present(updated),student:students[updated.owner]?.profile.name || 'Студент'});
}
async function api(request,env,url) {
  const path = url.pathname;
  const method = request.method;
  if (method === 'POST' && request.headers.get('origin') !== url.origin) return error('Запрос отклонён.',403);
  if (path === '/api/login' && method === 'POST') return login(request,env);
  const session = await signedIn(request,env);
  if (!session) return error('Войдите в кабинет.',401);
  const owner = session.student;
  if (path === '/api/logout' && method === 'POST') {
    await query(env,'DELETE FROM sessions WHERE token_hash = ?',session.tokenHash).run();
    return respond({ok:true},200,{'Set-Cookie':cookie('',0,env)});
  }
  if (owner === staffLogin) return staffApi(request,env,path);
  if (path.startsWith('/api/staff/')) return error('Недоступно для этого аккаунта.',403);
  if (path === '/api/home' && method === 'GET') {
    const student = students[owner];
    const [applications,read,change] = await Promise.all([
      query(env,'SELECT '+fields+' FROM applications WHERE owner = ? ORDER BY created DESC LIMIT 100',owner).all(),
      query(env,'SELECT notice FROM notices_read WHERE owner = ?',owner).all(),
      scheduleChange(env,owner),
    ]);
    const academic = academicData(student,change);
    return respond({role:'student',...academic,types,applications:applications.results.map(present),notices:noticesFor(student,new Set(read.results.map(row=>row.notice)),academic,change)});
  }
  if (path === '/api/applications' && method === 'POST') {
    const input = await body(request);
    const note = typeof input?.note === 'string' ? input.note.trim() : '';
    if (typeof input?.type !== 'string' || !own(types,input.type) || typeof input.note !== 'string' || note.length > 500 || (input.type === 'request' && !note)) return error('Укажите вид заявки и проверьте комментарий.',400);
    const {type} = input;
    const id = crypto.randomUUID();
    const created = Date.now();
    const row = await query(env,'INSERT INTO applications(id,owner,type,note,created) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM applications WHERE owner = ?) < 100 RETURNING id',id,owner,type,note,created,owner).first();
    if (!row) return error('В демоверсии доступно до 100 заявок на аккаунт.',409);
    return respond(present({id,type,note,created}),201);
  }
  const record = path.match(new RegExp('^/api/applications/('+applicationId+')(/document)?$'));
  if (method === 'GET' && record) {
    const row = await query(env,'SELECT '+fields+' FROM applications WHERE id = ? AND owner = ?',record[1],owner).first();
    if (!row) return error('Заявка не найдена.',404);
    if (!record[2]) return respond(present(row));
    const bytes = row.resolved_at && documents[owner+':'+row.type];
    return bytes ? attachment(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)),'application/pdf','dekana-demo.pdf') : error('Документ ещё недоступен.',404);
  }
  const event = path.match(/^\/api\/calendar\/([1-9][0-9]*)$/);
  if (method === 'GET' && event) {
    const item = academicData(students[owner],changes[owner]).grades.find(g=>g.id===event[1] && !g.grade);
    return item ? calendar(item,owner) : error('Предстоящая аттестация не найдена.',404);
  }
  if (path === '/api/notices/read' && method === 'POST') {
    const input = await body(request);
    const change = await scheduleChange(env,owner);
    if (!['room-'+(change.event_id || change.day),'session','services'].includes(input?.id)) return error('Объявление не найдено.',404);
    await query(env,'INSERT OR IGNORE INTO notices_read(owner,notice) VALUES (?,?)',owner,input.id).run();
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
