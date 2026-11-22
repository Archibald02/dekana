const closeDialog = '<button class="close" data-action="close" aria-label="Закрыть">×</button>';
function timeline(result) {
  return '<ol class="timeline" aria-label="История заявки">'+result.history.map(entry=>
    '<li><strong>'+escapeText(entry.label)+'</strong><small>'+date(entry.at,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+'</small></li>'
  ).join('')+'</ol>';
}
function showDetail(result) {
  const dialog=document.querySelector('#dialog');
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+escapeText(result.title)+'</h2>'+closeDialog+'</div>'+
    '<p><span class="chip good">'+escapeText(result.status)+'</span></p>'+
    timeline(result)+(result.note?'<p class="request-note">'+escapeText(result.note)+'</p>':'')+
    (result.reply?'<p class="request-note"><strong>Ответ деканата</strong><br>'+escapeText(result.reply)+'</p>':'')+
    (result.history.length<3?'<p class="muted">Ориентир по сроку: '+escapeText(result.time)+'.</p>':'')+
    '<div class="toolbar">'+(result.documentReady?'<a class="button primary" href="/api/applications/'+result.id+'/document" download>Скачать демо-PDF</a>':'')+
    '<button class="button secondary" data-action="refresh-detail">Обновить статус</button></div>';
  if(!dialog.open) dialog.showModal();
}
function staffDetail(record) {
  const dialog=document.querySelector('#dialog');
  const commands = record.history.length===1
    ? '<button type="submit" class="button primary">Взять на рассмотрение</button>'
    : (record.type==='request'?'<label for="staff-reply">Ответ студенту</label><textarea id="staff-reply" name="reply" rows="3" maxlength="500" required></textarea>':'')+
      '<button type="submit" class="button primary">'+(record.type==='request'?'Отправить ответ':'Выдать демо-PDF')+'</button>';
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+escapeText(record.title)+'</h2>'+closeDialog+'</div>'+
    '<p class="muted">'+escapeText(record.student)+'</p>'+timeline(record)+
    (record.note?'<p class="request-note">'+escapeText(record.note)+'</p>':'')+
    (record.reply?'<p class="request-note">'+escapeText(record.reply)+'</p>':'')+
    (record.history.length<3?'<form><p class="error" role="alert"></p>'+commands+'</form>':'');
  if(!dialog.open) dialog.showModal();
  dialog.querySelector('form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('button[type=submit]');
    button.disabled=true;
    try {
      const payload={action:record.history.length===1?'start':'complete',reply:new FormData(form).get('reply') || ''};
      const updated=await api('staff/applications/'+record.id,payload);
      const position=data?.applications.findIndex(r=>r.id===record.id) ?? -1;
      if(position<0 || !dialog.isConnected) return;
      data.applications[position]=updated;
      render();
      staffDetail(updated);
    } catch(e) {
      if(e.status===401) return login('Сессия закончилась. Войдите снова.');
      alertText(form.querySelector('.error'),e.message);
      button.disabled=false;
    }
  });
}
function help() {
  const dialog=document.querySelector('#dialog');
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">Помощник Деканы</h2>'+closeDialog+'</div>'+
    '<p>Спросите про пары, аттестацию, справки или статус заявки.</p>'+
    '<div class="help-choices"><button class="button secondary" data-topic="Где пара?">Где пара?</button><button class="button secondary" data-topic="Когда экзамен?">Когда экзамен?</button><button class="button secondary" data-topic="Статус заявки">Статус заявки</button></div>'+
    '<div class="help-result" role="status"></div><form><label for="help-question">Ваш вопрос</label><input id="help-question" name="question" maxlength="150" required><button class="button primary">Спросить</button></form>';
  const answer = (question) => {
    let reply='Могу подсказать про расписание, экзамены и заявки. Например, спросите «Где пара?».';
    let link='', label='';
    const latest=data.applications[0];
    const upcoming=data.grades.filter(g=>!g.grade).sort((a,b)=>a.date.localeCompare(b.date))[0];
    const move=data.notices.find(n=>n.id.startsWith('room-') && n.to.split('/')[1]>=data.today);
    if (/где.*(пар|занят)|распис|перенос|пары|пара|заняти/.test(question)) {
      reply=move ? move.title+'. '+move.body+'.' : 'Актуальные пары и аудитории есть в расписании.';
      link=move?.to || 'schedule'; label='Открыть расписание';
    } else if (/сесси|экзам|зач[её]т|оценк|аттестаци/.test(question)) {
      reply=upcoming ? upcoming.name+' · '+date(upcoming.date)+' в '+upcoming.time+', '+upcoming.room+'.' : 'Все дисциплины закрыты.';
      link=upcoming?'grades/'+upcoming.id:'grades'; label='Открыть успеваемость';
    } else if (/статус|готов|ответ|где.*заяв/.test(question)) {
      reply=latest ? latest.title+' · '+latest.status+'.' : 'Заявок пока нет.';
      link=latest?'requests/'+latest.id:'requests'; label='Открыть заявки';
    } else if (/справк|выписк|заявк|документ|деканат/.test(question)) {
      reply='В «Заявках» можно заказать справку, выписку или задать вопрос деканату.';
      link='requests'; label='Открыть заявки';
    }
    dialog.querySelector('.help-result').innerHTML='<p>'+escapeText(reply)+'</p>'+(link?'<a class="text-link" href="#'+escapeText(link)+'">'+label+'</a>':'');
  };
  dialog.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();
    answer(event.currentTarget.elements.question.value.toLowerCase());
  });
  for(const button of dialog.querySelectorAll('button[data-topic]')) button.addEventListener('click',()=>answer(button.dataset.topic.toLowerCase()));
  dialog.querySelector('.help-result').addEventListener('click',event=>{
    const link=event.target.closest('a');
    if(link){event.preventDefault();dialog.close();go(link.getAttribute('href').slice(1));}
  });
  dialog.showModal();
}
function newApplication(initial='') {
  const dialog=document.querySelector('#dialog');
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">Новая заявка</h2><button class="close" data-action="close" aria-label="Закрыть">×</button></div><form id="application-form"><label for="type">Что нужно</label><select id="type" name="type" required>'+Object.entries(data.types).map(([k,t])=>'<option value="'+k+'" '+(k===initial?'selected':'')+'>'+escapeText(t.title)+'</option>').join('')+'</select><p id="estimate" class="muted"></p><label for="note">Комментарий</label><textarea id="note" name="note" maxlength="500" rows="3" placeholder="Только вымышленные сведения"></textarea><p class="error" role="alert"></p><button class="button primary" type="submit">Отправить заявку</button></form>';
  dialog.showModal();
  const form=dialog.querySelector('form');
  function update() {
    const type=form.elements.type.value;
    form.elements.note.required=type==='request';
    dialog.querySelector('#estimate').textContent='Ориентир по сроку: '+data.types[type].time+(type==='request'?'. Напишите ваш вопрос.':'. Комментарий по желанию.');
  }
  update();
  form.elements.type.addEventListener('change',update);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type=submit]');
    button.disabled=true;
    button.textContent='Отправляем…';
    try{
      const result=await api('applications',Object.fromEntries(new FormData(form)));
      data.applications.unshift(result);
      dialog.close();
      go('requests/'+result.id);
    }catch(e){
      if(e.status===401) return login('Сессия закончилась. Войдите снова.');
      alertText(form.querySelector('.error'),e.message);
      button.disabled=false;
      button.textContent='Отправить заявку';
    }
  });
}
async function openDetail(id,version=navigation) {
  try {
    const result=await api('applications/'+id);
    if(version!==navigation || !data) return;
    detail=result;
    const index=data.applications.findIndex(r=>r.id===id);
    if(index>=0) data.applications[index]=result;
    showDetail(result);
  }catch(e) {
    if(version!==navigation) return;
    if(e.status===401) return login('Сессия закончилась. Войдите снова.');
    const toast=document.querySelector('#toast');
    alertText(toast,e.message);
  }
}
async function route(focus=true) {
  const version=++navigation;
  detail=null;
  render(focus);
  if(focus) window.scrollTo(0,0);
  const highlighted=document.querySelector('.spotlight');
  if(highlighted) {
    highlighted.focus({preventScroll:true});
    highlighted.scrollIntoView({block:'nearest'});
  }
  const id=location.hash.match(/^#requests\/([a-f0-9-]{36})$/)?.[1];
  if (id && data) await openDetail(id,version);
}
async function start() {
  try {data=await api('home'); await route(false);}
  catch(e) {
    if(e.status===401) return login();
    app.innerHTML='<main class="boot"><p role="alert">'+escapeText(e.message)+'</p><button class="button primary" data-action="retry">Повторить</button></main>';
  }
}
app.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action], [data-day], .skip');
  if(!target) return;
  if(target.classList.contains('skip')) {event.preventDefault();document.querySelector('#page-title')?.focus();return;}
  if(target.dataset.day) {
    day=target.dataset.day;
    if(target.tagName==='A') {event.preventDefault();go('schedule');}
    else {history.replaceState(null,'','#schedule');render();document.querySelector('.weekday[aria-pressed=true]')?.focus();}
    return;
  }
  const action=target.dataset.action;
  if(action==='retry' || action==='reload') return start();
  if(action==='help') return help();
  if(action==='staff-detail') {
    const record=data.applications.find(r=>r.id===target.dataset.id);
    if(record) staffDetail(record);
    return;
  }
  if(action==='new') return newApplication(target.dataset.type);
  if(action==='close') return document.querySelector('#dialog').close();
  if(action==='refresh-detail' && detail) return openDetail(detail.id);
  if(action!=='read' && action!=='logout') return;
  target.disabled=true;
  try {
    if(action==='logout') {
      await api('logout',{});
      ++navigation;
      history.replaceState(null,'',location.pathname);
      return login();
    }
    await api('notices/read',{id:target.dataset.id});
    data.notices.find(n=>n.id===target.dataset.id).read=true;
    render();
    alertText(document.querySelector('#toast'),'Отмечено прочитанным.');
  }catch(e) {
    if(e.status===401) return login('Сессия закончилась. Войдите снова.');
    target.disabled=false;
    alertText(document.querySelector('#toast'),e.message);
  }
});
app.addEventListener('close',event=>{
  if(event.target.id==='dialog' && detail) {
    history.replaceState(null,'','#requests');
    route(false);
  }
},true);
window.addEventListener('hashchange',()=>route());
start();

app.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.id!=='demo-schedule') return;
  event.preventDefault();
  const button=form.querySelector('button');
  const result=form.querySelector('.form-result');
  button.disabled=true;
  try {
    const saved=await api('staff/schedule',Object.fromEntries(new FormData(form)));
    result.textContent='Перенос опубликован: '+date(saved.day)+', '+saved.start+' · '+saved.room+'.';
  } catch(e) {
    if(e.status===401) return login('Сессия закончилась. Войдите снова.');
    result.textContent=e.message;
  } finally {
    button.disabled=false;
  }
});
