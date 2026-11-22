let tour=null;
const tourCopy=[
  ['Студент видит конфликт','Две пары пересекаются. Из карточки конфликта можно отправить обращение с заполненными данными.'],
  ['Деканат получает обращение','Заявка появилась в очереди сотрудника. Её можно взять на рассмотрение и выбрать свободное время.'],
  ['Студент получает предложение','Деканат предложил занятие с резервной группой. Студент сам подтверждает замену.'],
  ['Расписание обновилось','Занятие стоит на новом времени. Конфликт исчез, решение осталось в истории заявки.'],
];
function tourBanner() {
  if(!tour || !data?.demo) return '';
  const step=tourCopy[tour.step];
  const control=tour.step===3?'':tour.paused?'<button class="button secondary" data-action="tour-resume">Продолжить</button><button class="button secondary" data-action="tour-next">Следующий шаг</button>':'<button class="button secondary" data-action="tour-pause">Пауза</button>';
  return '<section class="tour-banner" aria-label="Автопоказ"><small>Автопоказ · '+(tour.step+1)+' из 4</small><strong>'+step[0]+'</strong><p>'+step[1]+'</p>'+
    '<div class="toolbar">'+control+'<button class="button secondary" data-action="tour-stop">Управлять самому</button></div></section>';
}
function repaintTour() {
  const previous=document.querySelector('.tour-banner');
  if(previous) previous.outerHTML=tourBanner();
}
function stopTour() {
  if(!tour) return;
  clearTimeout(tour.timer);
  tour=null;
  document.querySelector('.tour-banner')?.remove();
}
function planTour(state) {
  if(state && tour===state && !state.paused && state.step<3) state.timer=setTimeout(()=>{if(!state.paused) advanceTour(state);},15000);
}
async function tourPage(hash) {
  history.replaceState(null,'',location.pathname+hash);
  window.scrollTo(0,0);
  await start();
}
async function advanceTour(state) {
  if(tour!==state || state.busy) return;
  state.busy=true;
  try {
    if(state.step===0) {
      const [conflict]=data.conflicts;
      if(!conflict) throw Error('В активном расписании нет конфликта.');
      const draft=await api('applications',{type:'request',conflictEvent:conflict.event,note:conflictNote(conflict)});
      if(tour!==state) return;
      state.id=draft.id;
      await api('demo/switch',{role:'staff.demo'});
      if(tour!==state) return;
      state.step=1;
      await tourPage('#staff');
    } else if(state.step===1) {
      const endpoint='staff/applications/'+state.id;
      const record=await api(endpoint,{action:'start'});
      if(tour!==state) return;
      if(!record.options?.length) throw Error('Свободных вариантов не осталось.');
      const proposed=await api(endpoint,{action:'offer',start:record.options[0].start});
      if(tour!==state) return;
      state.offer=proposed.offer;
      await api('demo/switch',{role:'student.nord'});
      if(tour!==state) return;
      state.step=2;
      await tourPage('#requests');
    } else {
      await api('applications/'+state.id,{action:'accept'});
      if(tour!==state) return;
      state.step=3;
      await tourPage('#schedule/'+state.offer.day+'/'+state.offer.lesson);
      window.scrollTo(0,0);
    }
    planTour(state);
  } catch(e) {
    stopTour();
    alertText(document.querySelector('#toast'),e.message);
  } finally {
    state.busy=false;
  }
}
async function startTour(button) {
  stopTour();
  button.disabled=true;
  try {
    await api('demo/start',{});
    day=null;
    tour={step:0,paused:false};
    await tourPage('#home');
    planTour(tour);
  } catch(e) {
    alertText(document.querySelector('#toast')||document.querySelector('.login .error'),e.message);
    button.disabled=false;
  }
}
function conflictNote({moved,other,day:conflictDay}) {
  return 'Прошу помочь с пересечением занятий '+date(conflictDay)+': '+moved.name+' ('+moved.start+'–'+moved.end+', '+moved.room+') и '+other.name+' ('+other.start+'–'+other.end+', '+other.room+').';
}
const closeDialog = '<button class="close" data-action="close" aria-label="Закрыть">×</button>';
function timeline(result) {
  return '<ol class="timeline" aria-label="История заявки">'+result.history.map(entry=>
    '<li><strong>'+escapeText(entry.label)+'</strong><small>'+date(entry.at,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+'</small></li>'
  ).join('')+'</ol>';
}
function messageThread(result) {
  if(!result.messages?.length) return '';
  return '<section aria-label="Уточнения" class="thread">'+result.messages.map(entry=>
    '<article><small>'+(entry.kind==='question'?'Деканат':'Студент')+' · '+date(entry.created,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+'</small><p>'+
    escapeText(entry.message)+'</p></article>'
  ).join('')+'</section>';
}
function replacementDetails(record,staff=false) {
  if(!record.offer) return '';
  const offer=record.offer;
  const dateLine=date(offer.day)+' · '+offer.start+' · '+escapeText(offer.room);
  return '<section class="replacement"><h3>'+(offer.accepted?'Замена внесена в расписание':'Занятие с резервной группой')+'</h3><p>'+dateLine+'</p>'+
    (!staff && offer.accepted?'<a class="button secondary" href="#schedule/'+offer.day+'/'+offer.lesson+'">Открыть расписание</a>':
     !staff?'<button class="button primary" data-action="accept-offer">Подтвердить замену</button><p class="error" role="alert"></p>':'')+'</section>';
}
function showDetail(result) {
  const dialog=document.querySelector('#dialog');
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+escapeText(result.title)+'</h2>'+closeDialog+'</div>'+
    '<p><span class="chip '+(result.awaitingStudent?'warn':'good')+'">'+escapeText(result.status)+'</span></p>'+
    timeline(result)+replacementDetails(result)+(result.note?'<p class="request-note">'+escapeText(result.note)+'</p>':'')+messageThread(result)+
    (result.reply?'<p class="request-note"><strong>Ответ деканата</strong><br>'+escapeText(result.reply)+'</p>':'')+
    (result.awaitingStudent?'<form id="answer-form"><label for="student-reply">Уточнение для деканата</label><textarea id="student-reply" name="reply" rows="3" maxlength="500" required></textarea><p class="error" role="alert"></p><button class="button primary">Отправить уточнение</button></form>':'')+
    (result.open?'<p class="muted">Ориентир по сроку: '+escapeText(result.time)+'.</p>':'')+
    '<div class="toolbar">'+(result.documentReady?'<a class="button primary" href="/api/applications/'+result.id+'/document" download>Скачать демо-PDF</a>':'')+
    '<button class="button secondary" data-action="refresh-detail">Обновить статус</button></div>';
  if(!dialog.open) dialog.showModal();
  dialog.querySelector('#answer-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('button');
    button.disabled=true;
    try {
      await api('applications/'+result.id,Object.fromEntries(new FormData(form)));
      await openDetail(result.id);
    } catch(e) {
      if(e.status===401) return login('Сессия закончилась. Войдите снова.');
      alertText(form.querySelector('.error'),e.message);
      button.disabled=false;
    }
  });
}
async function openStaffDetail(id) {
  const currentNavigation=navigation;
  try {
    const record=await api('staff/applications/'+id);
    if (navigation===currentNavigation && data?.role==='staff') staffDetail(record);
  } catch (e) {
    if(e.status===401) return login('Сессия закончилась. Войдите снова.');
    alertText(document.querySelector('#toast'),e.message);
  }
}
function staffDetail(record) {
  const dialog=document.querySelector('#dialog');
  const editForm=!record.open?'':record.offer?'<form><p class="error" role="alert"></p><button type="submit" value="withdraw" class="button secondary">Отозвать предложение</button></form>':record.awaitingStudent?'<p class="muted">Ожидается уточнение от студента.</p>':
    '<form><p class="error" role="alert"></p>'+(!record.inProgress
    ?'<button type="submit" value="start" class="button primary">Взять на рассмотрение</button>'
    :'<label for="staff-reply">'+(record.type==='request'?'Ответ или вопрос студенту':'Текст уточнения, если нужен')+'</label><textarea id="staff-reply" name="reply" rows="3" maxlength="500"></textarea>'+
      (record.options?.length?'<label for="staff-slot">Свободное занятие с резервной группой</label><select id="staff-slot" name="start">'+record.options.map(item=>'<option value="'+item.start+'">'+item.start+'–'+item.end+' · '+escapeText(item.room)+'</option>').join('')+'</select><button type="submit" value="offer" class="button primary">Предложить замену</button>':'')+
      '<div class="toolbar"><button type="submit" value="question" class="button secondary">Запросить уточнение</button>'+
      '<button type="submit" value="complete" class="button primary">'+(record.type==='request'?'Отправить ответ':'Выдать демо-PDF')+'</button></div>')+'</form>';
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+escapeText(record.title)+'</h2>'+closeDialog+'</div>'+
    '<p class="muted">'+escapeText(record.student)+' · '+escapeText(record.status)+'</p>'+timeline(record)+replacementDetails(record,true)+
    (record.note?'<p class="request-note">'+escapeText(record.note)+'</p>':'')+messageThread(record)+
    (record.reply?'<p class="request-note">'+escapeText(record.reply)+'</p>':'')+editForm;
  if(!dialog.open) dialog.showModal();
  dialog.querySelector('form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const buttons=form.querySelectorAll('button[type=submit]');
    const action=event.submitter?.value || (record.inProgress?'complete':'start');
    for(const button of buttons) button.disabled=true;
    try {
      const values=new FormData(form);
      const payload={action,reply:values.get('reply') || '',start:values.get('start')};
      const updated=await api('staff/applications/'+record.id,payload);
      const position=data?.applications.findIndex(r=>r.id===record.id) ?? -1;
      if(position<0 || !dialog.isConnected) return;
      data.applications[position]=updated;
      const keepOpen=dialog.open;
      render();
      if(keepOpen) staffDetail(updated);
    } catch(e) {
      if(e.status===401) return login('Сессия закончилась. Войдите снова.');
      alertText(form.querySelector('.error'),e.message);
      for(const button of buttons) button.disabled=false;
    }
  });
}
function campusMap(value) {
  const room=/^([БД])–([1-3][0-9]{2})$/.exec(value);
  const dialog=document.querySelector('#dialog');
  const floor=Number(room?.[2]?.[0]);
  const known={
    1:['Вход','Вахта',room?.[1]==='Д'?'108 / 110':'110'],
    2:['Лестница','204','208'],
    3:['Лестница','312','Зона ожидания'],
  };
  let directions='<p>Для этой аудитории подробной демосхемы нет. Уточните маршрут у стойки в корпусе.</p>';
  if(room) {
    const target=room[2];
    const labels=known[floor];
    const index=labels.findIndex(label=>label.split(' / ').includes(target));
    const instruction=floor===1?'Войдите через главный вход и пройдите мимо вахты.':'От главного входа пройдите к лестнице и поднимитесь на '+floor+' этаж.';
    const side=index===1?' Аудитория находится сразу у лестницы.':index===2?' Аудитория находится в конце коридора.':' Номера на этаже уточняйте по указателям.';
    directions='<p>'+instruction+side+'</p><div class="map-floor" role="group" aria-label="Схема этажа">'+labels.map((label,n)=>
      '<span'+(n===index?' class="map-target"':'')+'>'+escapeText(label)+'</span>'
    ).join('')+'<span class="map-hall">Коридор</span></div><p class="muted">Схема демонстрационного корпуса.</p>';
  }
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">Аудитория '+escapeText(value)+'</h2>'+closeDialog+'</div>'+directions;
  dialog.showModal();
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
function newApplication(initial='',prefill='',conflictEvent=null) {
  const dialog=document.querySelector('#dialog');
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">Новая заявка</h2><button class="close" data-action="close" aria-label="Закрыть">×</button></div><form id="application-form"><label for="type">Что нужно</label><select id="type" name="type" required>'+Object.entries(data.types).map(([k,t])=>'<option value="'+k+'" '+(k===initial?'selected':'')+'>'+escapeText(t.title)+'</option>').join('')+'</select><p id="estimate" class="muted"></p><label for="note">Комментарий</label><textarea id="note" name="note" maxlength="500" rows="3" placeholder="Только вымышленные сведения">'+escapeText(prefill)+'</textarea><p class="error" role="alert"></p><button class="button primary" type="submit">Отправить заявку</button></form>';
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
      const payload=Object.fromEntries(new FormData(form));
      const result=await api('applications',{...payload,conflictEvent});
      if(!data.applications.some(item=>item.id===result.id)) data.applications.unshift(result);
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
  const control=target?.dataset.action;
  if(control==='tour-start') return startTour(target);
  if(control==='tour-pause' && tour) {
    clearTimeout(tour.timer);
    tour.paused=true;
    return repaintTour();
  }
  if(control==='tour-next' && tour?.paused) return advanceTour(tour);
  if(control==='tour-resume' && tour) {
    tour.paused=false;
    planTour(tour);
    return repaintTour();
  }
  if(tour && (target || event.target.closest('a'))) stopTour();
  if(control==='tour-stop' || !target) return;
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
  if(action==='map') return campusMap(target.dataset.room);
  if(action==='staff-detail') return openStaffDetail(target.dataset.id);
  if(action==='conflict') {
    const activeDay=location.hash.startsWith('#schedule') ? location.hash.split('/')[1] || day || data.today : null;
    const conflict=data.conflicts.find(item=>!activeDay || item.day===activeDay);
    if(conflict){
      return newApplication('request',conflictNote(conflict),conflict.event);
    }
  }
  if(action==='demo-start' || action==='demo-role' || action==='consult') {
    target.disabled=true;
    try {
      if(action==='consult') await api('consultation',{slot:target.dataset.slot,action:target.dataset.kind});
      else {
        await api(action==='demo-start'?'demo/start':'demo/switch',{role:target.dataset.role});
        day=null;
        history.replaceState(null,'',location.pathname);
        window.scrollTo(0,0);
      }
      await start();
    } catch(e) {
      const message=document.querySelector('#toast') || document.querySelector('.login .error');
      alertText(message,e.message);
      target.disabled=false;
    }
    return;
  }
  if(action==='accept-offer' && detail) {
    const record=detail;
    target.disabled=true;
    try {
      await api('applications/'+record.id,{action:'accept'});
      await start();
    } catch(e) {
      alertText(target.parentElement.querySelector('.error'),e.message);
      target.disabled=false;
    }
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

app.addEventListener('change',async event=>{
  const checkbox=event.target;
  const step=checkbox.dataset.step;
  if(!step) return;
  checkbox.disabled=true;
  try {
    await api('study/check',{step,done:checkbox.checked});
    data.checks=data.checks.filter(id=>id!==step);
    if(checkbox.checked) data.checks.push(step);
  } catch(e) {
    checkbox.checked=!checkbox.checked;
    alertText(document.querySelector('#toast'),e.message);
  } finally {
    checkbox.disabled=false;
  }
});
