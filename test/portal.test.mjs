import '../scripts/build.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localDB} from '../scripts/local-db.mjs';
const {default: worker} = await import('../dist/server/index.js');
const origin='https://dekana.example';
const server=(database,path,{body,cookie,source=origin}={}) => worker.fetch(new Request(origin+path,{
  method:body===undefined?'GET':'POST',
  headers:{'content-type':'application/json',cookie:cookie??'',origin:source},
  body:body===undefined?undefined:JSON.stringify(body)
}),{DB:database});

test('Вход и изоляция аккаунтов, хранение и выход',async t=>{
  const nord=process.env.DEKANA_NORD_PASSWORD;
  const vega=process.env.DEKANA_VEGA_PASSWORD;
  const staff=process.env.DEKANA_STAFF_PASSWORD;
  if(!nord || !vega || !staff) return t.skip('Задайте тестовые пароли через переменные окружения.');
  const dir=await mkdtemp(join(tmpdir(),'dekana-test-'));
  const file=join(dir,'portal.sqlite');
  let db=localDB(file);
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const call=(...args)=>server(db,...args);
  assert.equal((await call('/api/home')).status,401);
  assert.equal((await call('/api/login',{body:{login:'student.nord',password:'wrong-test-value'}})).status,401);
  async function login(name,password){
    const result=await call('/api/login',{body:{login:name,password}});
    assert.equal(result.status,200);
    const cookie=result.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
    return cookie.split(';')[0];
  }
  const a=await login('student.nord',nord);
  const b=await login('student.vega',vega);
  const employee=await login('staff.demo',staff);
  const studentA=await (await call('/api/home',{cookie:a})).json();
  const studentB=await (await call('/api/home',{cookie:b})).json();
  assert.notEqual(studentA.profile.group,studentB.profile.group);
  assert.notEqual(studentA.grades[0].name,studentB.grades[0].name);
  assert.equal(studentA.schedule.length,21);
  assert.equal((await call('/api/applications',{cookie:a,source:'https://other.example',body:{type:'study',note:''}})).status,403);
  assert.equal((await call('/api/applications',{cookie:a,body:{type:'request',note:''}})).status,400);
  const submission=await call('/api/applications',{cookie:a,body:{type:'study',note:'Демо',owner:'student.vega'}});
  assert.equal(submission.status,201);
  const record=await submission.json();
  assert.equal(record.status,'Принята');
  assert.equal((await call('/api/applications/'+record.id,{cookie:b})).status,404);
  assert.equal((await call('/api/profiles/student.nord',{cookie:b})).status,404);
  const roomNotice=studentA.notices.find(n=>n.id.startsWith('room-'));
  if (roomNotice) assert.equal((await call('/api/notices/read',{cookie:a,body:{id:roomNotice.id}})).status,200);
  const edit='/api/staff/applications/'+record.id;
  const doc='/api/applications/'+record.id+'/document';
  assert.equal((await call(doc,{cookie:a})).status,404);
  assert.equal((await call(edit,{cookie:a,body:{action:'start'}})).status,403);
  assert.equal((await call(edit,{cookie:employee,body:{action:'complete'}})).status,409);
  assert.equal((await call(edit,{cookie:employee,body:{action:'start'}})).status,200);
  assert.equal((await call(edit,{cookie:employee,body:{action:'start'}})).status,409);
  assert.equal((await call(edit,{cookie:employee,body:{action:'complete'}})).status,200);
  assert.equal((await call(doc,{cookie:b})).status,404);
  const report=await call(doc,{cookie:a});
  assert.equal(report.headers.get('Content-Type'),'application/pdf');
  assert.equal((await report.text()).slice(0,4),'%PDF');
  const assessment=studentA.grades.find(g=>!g.grade);
  const event=await call('/api/calendar/'+assessment.id,{cookie:a});
  assert.match(await event.text(),/BEGIN:VEVENT/);
  const future=studentA.schedule.find(d=>d.day>studentA.today && d.lessons.length);
  const change={owner:'student.nord',day:future.day,start:future.lessons[0].start,room:'Б-777'};
  assert.equal((await call('/api/staff/schedule',{cookie:a,body:change})).status,403);
  assert.equal((await call('/api/staff/schedule',{cookie:employee,body:change})).status,201);
  db.close();
  db=localDB(file);
  const reloaded=await (await call('/api/home',{cookie:a})).json();
  assert.equal(reloaded.applications[0].id,record.id);
  assert.equal(reloaded.applications[0].status,'Готово');
  assert.equal(reloaded.applications[0].history.length,3);
  assert.equal(reloaded.notices[0].to,'schedule/'+change.day+'/'+change.start);
  assert.equal(reloaded.schedule.find(d=>d.day===change.day).lessons[0].room,'Б–777');
  assert.equal(reloaded.notices[0].read,false);
  const other=await (await call('/api/home',{cookie:b})).json();
  assert.equal(other.applications.length,0);
  assert.equal(other.notices[0].read,false);
  assert.notEqual(other.schedule.find(d=>d.day===change.day).lessons[0].room,'Б–777');
  assert.equal((await call('/api/logout',{cookie:a,body:{}})).status,200);
  assert.equal((await call('/api/home',{cookie:a})).status,401);
});

test('Публичные ресурсы не включают учебные данные и хеши паролей',async()=>{
  const db=localDB();
  try {
    for(const route of ['/','/styles.css','/views.js','/app.js']){
      const result=await server(db,route);
      assert.equal(result.status,200);
      assert.doesNotMatch(await result.text(),/Нордова|Вегов|const credentials/);
    }
  } finally {db.close();}
});

test('Демопроходы изолированы, а конфликт и уточнение проходят через обе роли',async t=>{
  const db=localDB();
  t.after(()=>db.close());
  const call=(...args)=>server(db,...args);
  async function demo(){
    const result=await call('/api/demo/start',{body:{}});
    assert.equal(result.status,200);
    return result.headers.get('set-cookie').split(';')[0];
  }
  const one=await demo(), two=await demo();
  const home=async cookie=>await (await call('/api/home',{cookie})).json();
  const switchRole=async (cookie,role)=>assert.equal((await call('/api/demo/switch',{cookie,body:{role}})).status,200);
  const student=await home(one);
  assert.equal(student.demo,true);
  const [conflict]=student.conflicts;
  assert.ok(conflict && conflict.moved.start<conflict.other.end);
  const step=student.grades.find(g=>g.steps.length).steps[0].id;
  assert.equal((await call('/api/study/check',{cookie:one,body:{step,done:true}})).status,200);
  assert.deepEqual((await home(one)).checks,[step]);
  assert.deepEqual((await home(two)).checks,[]);
  const slot=student.slots[0].id;
  assert.equal((await call('/api/consultation',{cookie:one,body:{slot}})).status,201);
  assert.equal((await call('/api/consultation',{cookie:one,body:{slot}})).status,409);
  assert.equal((await call('/api/consultation',{cookie:two,body:{slot}})).status,201);
  assert.match(await (await call('/api/calendar/consultation',{cookie:one})).text(),/BEGIN:VEVENT/);
  assert.equal((await call('/api/consultation',{cookie:two,body:{action:'cancel'}})).status,200);
  assert.equal((await home(one)).booking.id,slot);
  assert.equal((await home(two)).booking,null);
  const submitted=await call('/api/applications',{cookie:one,body:{type:'request',note:'Пересечение двух занятий.'}});
  assert.equal(submitted.status,201);
  const {id}=await submitted.json();
  const application='/api/applications/'+id;
  const staff='/api/staff/applications/'+id;
  assert.equal((await call(application,{cookie:two})).status,404);
  await switchRole(two,'staff.demo');
  assert.equal((await call(staff,{cookie:two})).status,404);
  await switchRole(one,'staff.demo');
  assert.equal((await home(one)).applications[0].id,id);
  assert.equal((await call(staff,{cookie:one,body:{action:'start'}})).status,200);
  assert.equal((await call(staff,{cookie:one,body:{action:'question',reply:'Какую пару вы сможете посетить?'}})).status,200);
  assert.equal((await call(staff,{cookie:one,body:{action:'complete',reply:'Преждевременно'}})).status,409);
  await switchRole(one,'student.vega');
  assert.equal((await call(application,{cookie:one,body:{reply:'Чужой ответ'}})).status,404);
  await switchRole(one,'student.nord');
  const waiting=await (await call(application,{cookie:one})).json();
  assert.equal(waiting.status,'Нужно уточнение');
  assert.equal(waiting.messages[0].kind,'question');
  assert.equal((await call(application,{cookie:one,body:{reply:'Могу прийти на семинар.'}})).status,201);
  assert.equal((await call(application,{cookie:one,body:{reply:'Повтор'}})).status,409);
  await switchRole(one,'staff.demo');
  assert.equal((await call(staff,{cookie:one,body:{action:'complete',reply:'Согласовано.'}})).status,200);
  await switchRole(one,'student.nord');
  const finished=await (await call(application,{cookie:one})).json();
  assert.equal(finished.status,'Есть ответ');
  assert.deepEqual(finished.messages.map(message=>message.kind),['question','answer']);
  const fresh=await demo();
  assert.deepEqual((await home(fresh)).applications,[]);
});
