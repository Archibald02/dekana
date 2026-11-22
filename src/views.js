const app = document.querySelector('#app');
const paths = {
  home:'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  schedule:'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2-2v4m10-4v4M3 10h18m-12 5h.1m5.9 0h.1',
  grades:'M4 19v-5m5 5V9m6 10v-8m5 8V5M3 22h18',
  requests:'M5 3h9l5 5v13H5zM14 3v6h5m-10 4h6m-6 4h6',
  notices:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
  profile:'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  exit:'M10 4H4v16h6m4-12 4 4-4 4m-5-4h9',
  plus:'M12 5v14M5 12h14',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  pin:'M19 9c0 5-7 11-7 11S5 14 5 9a7 7 0 0 1 14 0Zm-4.5 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  check:'m5 12 4 4L19 6',
};
const icon = name => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[name]+'"/></svg>';
const nav = {home:'Главная',schedule:'Расписание',grades:'Учёба',requests:'Заявки',notices:'Новости',profile:'Профиль'};
const escapeText = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalDate = value => new Date(typeof value === 'number' ? value : value+'T12:00:00Z');
const date = (value, options = {day:'numeric',month:'long'}) => new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'Europe/Moscow'}).format(normalDate(value));
const addDays = (value,offset) => {const n=normalDate(value); n.setUTCDate(n.getUTCDate()+offset); return n.toISOString().slice(0,10);};
const dateMonday = value => addDays(value,-((normalDate(value).getUTCDay()+6)%7));
let data, day, detail, navigation = 0;
const brand = '<span class="brand"><span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>декана<span class="brand-period">.</span><small>Цифровой деканат</small></span></span>';

async function api(path,body) {
  const options = body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  let response, json;
  try {
    response = await fetch('/api/'+path,options);
    json = await response.json();
  } catch {throw new Error('Не удалось связаться с кабинетом. Попробуйте ещё раз.');}
  if (!response.ok) throw Object.assign(new Error(json.error),{status:response.status});
  return json;
}
function activePage() {
  if (data?.role==='staff') return 'staff';
  const route = location.hash.slice(1).split('/')[0];
  return Object.hasOwn(nav,route) ? route : 'home';
}
function go(route) {
  if (location.hash === '#'+route) return window.dispatchEvent(new Event('hashchange'));
  else location.hash=route;
}
function alertText(node,message) { if(node) node.textContent = message; }
function login(message='') {
  data = null;
  day = null;
  detail = null;
  app.innerHTML = '<main class="login"><section class="login-art">'+brand+'<div class="orbit"></div><div class="login-copy"><span class="eyebrow">СТУДЕНЧЕСКИЙ КАБИНЕТ</span><h1>Всё по&nbsp;учёбе.<br>В одном месте.</h1><p>Пары, оценки, заявки и новости деканата под рукой.</p></div><p class="login-caption">Конкурсный концепт · Вымышленные данные</p></section><section class="login-area"><div class="login-card"><span class="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span><h2>Войти в Декану</h2><p class="muted">Введите данные тестового аккаунта.</p><form id="login-form"><label for="login">Логин</label><input id="login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="80" placeholder="student.nord" required><label for="password">Пароль</label><input id="password" name="password" autocomplete="current-password" type="password" maxlength="128" placeholder="Введите пароль" required><p class="error" role="alert">'+escapeText(message)+'</p><button class="button primary" type="submit">Войти</button></form><button class="button secondary demo-login" data-action="demo-start">Открыть режим жюри</button><button class="button secondary demo-login" data-action="tour-start">Автопоказ для жюри · 1 минута</button><p class="login-legal">Конкурсный прототип цифрового деканата. Используются вымышленные данные.</p></div></section></main>';
  app.querySelector('.demo-login').insertAdjacentHTML('beforebegin',
    '<p class="jury-help muted">В режиме жюри откройте конфликт на главной Леи. Предложите замену за сотрудника деканата и подтвердите её за Лею.</p>');
  app.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('button'), values=new FormData(form);
    button.disabled=true;
    button.textContent='Входим…';
    alertText(form.querySelector('.error'),'');
    try {
      await api('login',Object.fromEntries(values));
      await start();
    } catch (e) {
      alertText(form.querySelector('.error'),e.message);
      button.disabled=false;
      button.textContent='Войти';
    }
  });
}

function pageHeading(title,copy,action='') {
  return '<header class="page-heading"><div><h1 tabindex="-1" id="page-title">'+title+'</h1><p>'+copy+'</p></div>'+action+'</header>';
}
const scheduleLink = '<a class="text-link" href="#schedule">Всё расписание</a>';
const newRequest = '<button class="button primary" data-action="new">'+icon('plus')+'Новая заявка</button>';
function lessonRows(lessons, selectedTime) {
  return lessons.length ? '<ul class="lessons">'+lessons.map(item=>'<li id="lesson-'+item.key.replace(':','')+'" class="lesson'+(selectedTime===item.key?' spotlight':'')+'" tabindex="-1"><div class="lesson-time"><strong>'+item.start+'</strong><small>'+item.end+'</small></div><div class="lesson-main"><strong>'+escapeText(item.name)+'</strong><small>'+escapeText(item.form)+' · '+escapeText(item.teacher)+'</small>'+(item.resolved?'<span class="chip good">Замена подтверждена</span>':item.change?'<span class="chip warn">'+escapeText(item.key===item.start?item.change+' → '+item.room:item.key+' → '+item.start)+'</span>':'')+'</div><button class="room map-link" data-action="map" data-room="'+escapeText(item.room)+'" aria-label="Схема, аудитория '+escapeText(item.room)+'">'+escapeText(item.room)+'</button></li>').join('')+'</ul>' : '<div class="empty"><span class="empty-icon">'+icon('schedule')+'</span><strong>Пар по расписанию нет</strong><p>Выберите другой день или посмотрите планы на неделю.</p></div>';
}
function conflictPanel(onlyDay) {
  const [conflict]=onlyDay?data.conflicts.filter(event=>event.day===onlyDay):data.conflicts;
  if(!conflict) return '';
  const {moved,other,day:conflictDay}=conflict;
  const existing=data.applications.find(record=>record.open && record.conflictEvent===conflict.event);
  return '<section class="panel conflict" aria-labelledby="conflict-title"><span class="chip warn">Конфликт расписания</span>'+
    '<h2 id="conflict-title">'+escapeText(moved.name)+' пересекается с другим занятием</h2>'+
    '<p>'+date(conflictDay)+' · '+escapeText(moved.name)+' '+moved.start+'–'+moved.end+' · '+escapeText(other.name)+' '+other.start+'–'+other.end+'</p>'+
    '<div class="toolbar"><a class="button secondary" href="#schedule/'+conflictDay+'/'+moved.key+'">Посмотреть занятие</a>'+
    (existing?'<a class="button primary" href="#requests/'+existing.id+'">Открыть обращение</a>':'<button class="button primary" data-action="conflict">Сообщить деканату</button>')+'</div></section>';
}
const upcomingSteps = () => data.grades.flatMap(g=>g.steps.map(step=>({...step,subject:g.name,grade:g.id})))
  .filter(step=>!data.checks.includes(step.id)).sort((a,b)=>a.date.localeCompare(b.date));
function prepCard() {
  const [first]=upcomingSteps();
  return '<section class="panel sidecard"><header class="card-head"><span class="tile">'+icon('grades')+'</span><a class="text-link" href="#grades'+(first?'/'+first.grade:'')+'">План сессии</a></header><h2>Ближайший срок</h2>'+
    (first?'<p><strong>'+escapeText(first.label)+'</strong></p><p class="muted">'+escapeText(first.subject)+' · '+date(first.date)+'</p>':'<p class="muted">В ближайшем плане задач нет.</p>')+'</section>';
}
function consultation() {
  const current=data.booking;
  const body=current?
    '<div class="consult-confirmed"><span class="chip good">Запись подтверждена</span><p><strong>'+date(current.day)+' · '+current.start+'–'+current.end+'</strong><br>'+escapeText(current.teacher)+' · '+escapeText(current.room)+'</p><div class="toolbar"><a class="text-link" href="/api/calendar/consultation" download>В календарь</a><button class="button secondary" data-action="map" data-room="'+escapeText(current.room)+'">Схема корпуса</button><button class="button secondary" data-action="consult" data-kind="cancel">Отменить запись</button></div></div>'
    : data.slots.length?'<ul class="records">'+data.slots.map(slot=>'<li><div><strong>'+date(slot.day)+' · '+slot.start+'</strong><small>'+escapeText(slot.teacher)+' · '+escapeText(slot.room)+'</small></div><button class="button secondary" data-action="consult" data-slot="'+slot.id+'">Записаться</button></li>').join('')+'</ul>'
    : '<p class="muted">Подходящих слотов пока нет.</p>';
  return '<section id="consultation" class="panel"><header class="card-head"><div><h2>Консультация перед сессией</h2><p>Выберите свободное время.</p></div></header>'+body+'</section>';
}
function juryBar(staffMode) {
  if(!data.demo) return '';
  const active=staffMode?'staff.demo':data.demoStudent;
  const roles=[['student.nord','Лея'],['staff.demo','Деканат'],['student.vega','Марк']];
  return '<section class="jury-bar" aria-label="Демо для жюри"><div><strong>Демо для жюри</strong><small>Откройте конфликт на главной Леи. В деканате предложите замену, затем вернитесь к Лее и подтвердите её.</small></div><div class="toolbar">'+
    roles.map(([role,label])=>'<button class="button '+(role===active?'primary':'secondary')+'" data-action="demo-role" data-role="'+role+'" aria-pressed="'+(role===active)+'" '+(role===active?'disabled':'')+'>'+label+'</button>').join('')+
    '<button class="button secondary" data-action="demo-start">Начать заново</button>'+(tour?'':'<button class="button secondary" data-action="tour-start">Автопоказ</button>')+'</div></section>';
}
const moscowTime = () => new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow',hourCycle:'h23'}).format(new Date());
function attention(upcoming, now) {
  const move=data.notices.find(n=>{
    if (!n.id.startsWith('room-') || n.read) return false;
    const [,target,start]=n.to.split('/');
    const lesson=data.schedule.find(d=>d.day===target)?.lessons.find(l=>l.key===start);
    return target>data.today || (target===data.today && lesson?.end>now);
  });
  const cards=[];
  const pending=data.applications.find(record=>record.awaitingStudent || (record.open && record.offer));
  const ready=data.applications.find(record=>record.documentReady);
  const primary=pending || ready || data.applications[0];
  for(const application of [primary,pending?ready:null].filter(Boolean)) {
    const {id,title,status,documentReady,awaitingStudent,offer,reply,type}=application;
    const action=awaitingStudent?'Ответить деканату':application.open && offer?'Посмотреть предложенную замену':
      documentReady?(type==='study'?'Скачать справку':'Скачать выписку'):reply?'Прочитать ответ':'Открыть заявку';
    cards.push({tag:status,title,body:action,href:documentReady?'/api/applications/'+id+'/document':'#requests/'+id,
      download:documentReady,style:application===pending?'warn':'good'});
  }
  if(move) cards.push({tag:'Перенос пары',title:move.title.slice('Перенос · '.length),body:move.body,to:move.to,style:'warn'});
  if(upcoming) cards.push({tag:upcoming.form,title:upcoming.name,body:date(upcoming.date)+' · '+upcoming.time+' · '+upcoming.room,to:'grades/'+upcoming.id,style:'neutral'});
  if (!cards.length) return '';
  return '<section class="panel"><header class="card-head"><h2>Что требует внимания</h2></header><div class="attention-grid">'+cards.map(card=>
    '<a class="attention-item" href="'+escapeText(card.href || '#'+card.to)+'"'+(card.download?' download':'')+'><span class="chip '+card.style+'">'+escapeText(card.tag)+'</span><strong>'+escapeText(card.title)+'</strong><small>'+escapeText(card.body)+'</small></a>'
  ).join('')+'</div></section>';
}
function home() {
  const now = moscowTime();
  const nextDay = data.schedule.find(d=>d.day>=data.today && d.lessons.some(l=>d.day>data.today || l.end>now));
  const current = nextDay?.lessons.find(l=>nextDay.day>data.today || l.end>now);
  const todayLessons = data.schedule.find(d=>d.day===data.today).lessons;
  const latest = data.applications[0];
  const upcoming = data.grades.filter(g=>!g.grade).sort((a,b)=>a.date.localeCompare(b.date))[0];
  return '<header class="welcome"><div class="eyebrow">'+date(data.today,{weekday:'long',day:'numeric',month:'long'}).toUpperCase()+'</div><h1 tabindex="-1" id="page-title">Привет, '+escapeText(data.profile.first)+'!</h1><p>Вот что у тебя по учёбе.</p></header>'+
    '<section class="hero"><div class="orbit"></div><div class="hero-content"><span class="eyebrow">'+(current && nextDay.day===data.today && current.start<=now?'ПАРА СЕЙЧАС':'БЛИЖАЙШАЯ ПАРА')+'</span><h2>'+escapeText(current?.name || 'В расписании пока свободно')+'</h2>'+(current?'<div class="hero-meta"><span>'+icon('clock')+date(nextDay.day,{weekday:'short',day:'numeric',month:'short'})+' · '+current.start+'–'+current.end+'</span><span>'+icon('pin')+escapeText(current.room)+'</span></div>'+(current.change?'<p class="hero-change">'+escapeText(current.change)+' → '+escapeText(current.room)+'</p>':''):'')+'<a class="button light" href="#schedule'+(nextDay?'/'+nextDay.day+'/'+current.key:'')+'">Открыть расписание</a></div></section>'+
    conflictPanel()+'<div id="home-attention">'+attention(upcoming,now)+'</div><div class="dashboard"><section class="panel"><header class="card-head"><div><h2>Сегодня</h2><p>'+date(data.today,{weekday:'long',day:'numeric',month:'long'})+'</p></div>'+scheduleLink+'</header>'+lessonRows(todayLessons)+'</section>'+
    prepCard()+
    '<section class="panel sidecard"><header class="card-head"><span class="tile">'+icon('requests')+'</span><a class="text-link" href="#requests">Все заявки</a></header><h2>Справки и заявления</h2>'+(latest?'<p><strong>'+escapeText(latest.title)+'</strong> <span class="chip good">'+escapeText(latest.status)+'</span></p>':'<p class="muted">Закажите справку или задайте вопрос деканату.</p>')+newRequest+'</section>'+
    '<section class="panel sidecard"><header class="card-head"><span class="tile">'+icon('notices')+'</span><a class="text-link" href="#notices">Все новости</a></header><h2>'+escapeText(data.notices.find(n=>!n.read)?.title || 'Все новости прочитаны')+'</h2><p class="muted">'+data.notices.filter(n=>!n.read).length+' из '+data.notices.length+' объявлений ожидают прочтения</p></section></div>';
}
function schedule() {
  const [,target,targetTime] = location.hash.slice(1).split('/');
  const selected = data.schedule.some(d=>d.day===target) ? target : day || data.today;
  const start = dateMonday(selected);
  const days = Array.from({length:7},(_,i)=>addDays(start,i));
  const valid = v=>data.schedule.some(d=>d.day===v);
  const prev = addDays(selected,-7), next=addDays(selected,7);
  const lessons = data.schedule.find(d=>d.day===selected)?.lessons || [];
  return pageHeading('Расписание','Пары, аудитории и изменения на неделю.')+conflictPanel(selected)+
    '<section class="panel"><div class="card-head"><div><h2>'+date(days[0])+' — '+date(days[6])+'</h2><p>Учебная неделя</p></div><button class="button secondary" data-day="'+data.today+'">Сегодня</button></div><div class="week-controls"><button class="button secondary" data-day="'+prev+'" '+(valid(prev)?'':'disabled')+'>Предыдущая</button><button class="button secondary" data-day="'+next+'" '+(valid(next)?'':'disabled')+'>Следующая</button></div>'+
    '<div class="week" aria-label="Дни недели">'+days.map(v=>'<button class="weekday" data-day="'+v+'" aria-pressed="'+(v===selected)+'" '+(valid(v)?'':'disabled')+'><span>'+date(v,{weekday:'short'})+'</span><strong>'+Number(v.slice(-2))+'</strong>'+(v===data.today?'<span class="sr-only">Сегодня</span>':'')+'</button>').join('')+'</div><div class="day-heading"><h3>'+date(selected,{weekday:'long',day:'numeric',month:'long'})+'</h3><span>'+lessons.length+' в расписании</span></div>'+lessonRows(lessons,targetTime)+'</section>';
}
function grades() {
  const done=data.grades.filter(g=>g.grade).length;
  const [,selected]=location.hash.slice(1).split('/');
  return pageHeading('Успеваемость','План подготовки, зачёты и даты аттестации.')+
    '<section class="panel progress-card"><div><span class="eyebrow">ТЕКУЩИЙ СЕМЕСТР</span><h2>Закрыто '+done+' из '+data.grades.length+'</h2></div><progress max="'+data.grades.length+'" value="'+done+'" aria-label="Закрытые дисциплины"></progress></section>'+
    '<section class="panel"><header class="card-head"><h2>Подготовка по дисциплинам</h2></header><ul class="records grade-list">'+data.grades.map(g=>
      '<li id="grade-'+g.id+'" tabindex="-1" class="'+(selected===g.id?'spotlight':'')+'"><div><strong>'+escapeText(g.name)+'</strong><small>'+escapeText(g.form)+(g.grade?'':' · '+date(g.date)+' · '+g.time+' · '+escapeText(g.room))+'</small>'+
      (g.grade?'':'<ul class="prep-steps">'+g.steps.map(step=>'<li>'+
        (step.id?'<label><input type="checkbox" data-step="'+step.id+'" '+(data.checks.includes(step.id)?'checked':'')+'>'+escapeText(step.label)+'</label>':'<span>'+escapeText(step.label)+'</span>')+
        '<small>'+date(step.date)+'</small></li>').join('')+'</ul><div class="toolbar"><a class="text-link" href="/api/calendar/'+g.id+'" download>В календарь</a><button class="button secondary" data-action="map" data-room="'+escapeText(g.room)+'">Схема корпуса</button></div>')+
      '</div><span class="chip '+(g.grade?'good':'neutral')+'">'+escapeText(g.grade || 'Предстоит')+'</span></li>'
    ).join('')+'</ul></section>'+consultation();
}
function requests() {
  const records=data.applications;
  return pageHeading('Заявки','Заказывайте документы и следите за статусом.','<div class="toolbar">'+newRequest+'<button class="button secondary" data-action="reload">Обновить</button></div>')+
    '<section class="panel"><header class="card-head"><h2>Мои заявки</h2></header>'+
    (records.length?'<ul class="records">'+records.map(r=>'<li><div><a class="record-link" href="#requests/'+r.id+'">'+escapeText(r.title)+'</a><small>'+(r.offer?date(r.offer.day)+' · '+r.offer.start+' · '+escapeText(r.offer.room):date(r.created))+'</small></div><span class="chip good">'+escapeText(r.status)+'</span></li>').join('')+'</ul>':'<div class="empty"><span class="empty-icon">'+icon('requests')+'</span><strong>Заявок пока нет</strong><p>Создайте заявку на справку, выписку или вопрос деканату.</p></div>')+'</section>'+
    '<section class="panel"><header class="card-head"><h2>Что можно запросить</h2></header><div class="service-grid">'+Object.entries(data.types).map(([key,t])=>'<button class="service" data-action="new" data-type="'+key+'">'+icon('requests')+'<strong>'+escapeText(t.title)+'</strong><small>'+escapeText(t.time)+'</small></button>').join('')+'</div></section>';
}
function notices() {
  return pageHeading('Уведомления','Объявления деканата, переносы и напоминания.')+
    '<div class="notice-list">'+data.notices.map(n=>'<article class="panel notice"><div class="notice-top"><span class="chip '+(n.read?'neutral':'good')+'">'+escapeText(n.tag)+'</span><span class="muted">'+date(n.day)+(n.read?'':' · Новое')+'</span></div><h2>'+escapeText(n.title)+'</h2><p>'+escapeText(n.body)+'</p><div class="notice-actions"><a class="text-link" href="#'+escapeText(n.to)+'">'+escapeText(n.action)+'</a>'+(n.read?'<span class="muted">Прочитано</span>':'<button class="button secondary" data-action="read" data-id="'+n.id+'">Отметить прочитанным</button>')+'</div></article>').join('')+'</div>';
}
function profile() {
  const p=data.profile;
  return pageHeading('Профиль','Ваши данные в студенческом кабинете.')+
    '<section class="panel profile-card"><span class="avatar large">'+escapeText(p.initials)+'</span><h2>'+escapeText(p.name)+'</h2><dl>'+Object.entries({'Факультет':p.faculty,'Направление':p.program,'Курс':p.year,'Группа':p.group}).map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+escapeText(v)+'</dd></div>').join('')+'</dl><button class="button secondary" data-action="logout">'+icon('exit')+'Выйти из кабинета</button></section>';
}
function demoScheduleForm() {
  return '<section class="panel"><header class="card-head"><div><h2>Перенос пары</h2><p>Перенос появится на главной и в расписании выбранной группы.</p></div></header>'+
    '<form id="demo-schedule"><div class="schedule-form-grid"><label>Группа<select name="owner">'+data.groups.map(group=>
      '<option value="'+escapeText(group.value)+'">'+escapeText(group.label)+'</option>'
    ).join('')+'</select></label><label>Дата<input name="day" type="date" min="'+data.today+'" required></label>'+
    '<label>Начало<select name="start"><option>09:00</option><option>10:45</option><option>12:30</option></select></label>'+
    '<label>Новое время<input name="newStart" type="time"></label><label>Новая аудитория<input name="room" placeholder="Б–312" maxlength="7" required></label></div>'+
    '<p role="status" class="form-result"></p><button class="button primary">Опубликовать перенос</button></form></section>';
}
function staff() {
  const pending=data.applications.filter(record=>record.open).sort((a,b)=>(a.conflictDay||'9999').localeCompare(b.conflictDay||'9999') || a.created-b.created);
  const queue=[...pending,...data.applications.filter(record=>!pending.includes(record))];
  const actions='<div class="toolbar"><button class="button secondary" data-action="reload">Обновить очередь</button><button class="button secondary" data-action="logout">Выйти</button></div>';
  return pageHeading('Очередь деканата','Демонстрационный кабинет сотрудника. В работе: '+pending.length+'.',actions)+
    '<section class="panel"><header class="card-head"><h2>Заявки студентов</h2></header>'+
    (queue.length?'<ul class="records">'+queue.map(r=>'<li><div><button class="plain-link" data-action="staff-detail" data-id="'+r.id+'">'+escapeText(r.title)+'</button><small>'+escapeText(r.student)+' · '+(r.conflictDay?'Конфликт '+date(r.conflictDay):date(r.created))+'</small></div><span class="chip '+(r.open?'neutral':'good')+'">'+escapeText(r.status)+'</span></li>').join('')+'</ul>':'<p class="muted">Заявок нет. Подайте первую из кабинета студента.</p>')+'</section>'+demoScheduleForm();
}
const pages={home,schedule,grades,requests,notices,profile,staff};
function render(focus=false) {
  if(!data) return;
  const page=activePage();
  const staffMode=page==='staff';
  const sections=staffMode ? {staff:'Очередь'} : nav;
  const links=Object.entries(sections).map(([key,label])=>'<a class="nav-item" href="#'+key+'" '+(key===page?'aria-current="page"':'')+'>'+icon(key==='staff'?'requests':key)+'<span>'+label+'</span>'+(key==='notices' && data.notices.some(n=>!n.read)?'<i class="unread" aria-label="Есть непрочитанные"></i>':'')+'</a>').join('');
  app.innerHTML='<a class="skip" href="#main-content">К содержанию</a><div class="layout"><aside class="sidebar"><a class="brand-link" href="#home" aria-label="Декана, главная">'+brand+'</a><nav aria-label="Разделы кабинета">'+links+'</nav><div class="sidebar-note">Конкурсный концепт<br>Вымышленные данные</div></aside><div class="work"><header class="topbar"><a class="mobile-brand" href="#home">'+brand+'</a><span class="crumb">Личный кабинет <span>/</span> '+sections[page]+'</span>'+(staffMode?'':'<button class="button secondary help-button" data-action="help">Помощник</button>')+'<a class="top-profile" href="'+(staffMode?'#staff':'#profile')+'" aria-label="Открыть профиль"><span class="avatar">'+escapeText(data.profile.initials)+'</span><span><strong>'+escapeText(data.profile.first)+'</strong><small>'+escapeText(data.profile.group)+'</small></span></a></header><main id="main-content" class="content">'+(juryBar(staffMode))+tourBanner()+pages[page]()+'<footer>Декана · конкурсный концепт · вымышленные данные</footer></main></div></div><nav class="mobile-nav" aria-label="Разделы кабинета">'+links+'</nav><p id="toast" class="toast" role="status"></p><dialog id="dialog" aria-labelledby="dialog-title"></dialog>';
  document.title=sections[page]+' · Декана';
  if (focus) document.querySelector('#page-title').focus();
}
