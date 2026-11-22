function demoStudent(profile, subjects, room, teacher, notices) {
  return { profile, subjects, room, teacher, notices };
}

const students = {
  'student.nord': demoStudent(
    {name:'Лея Тимуровна Нордова', first:'Лея', initials:'ЛН', faculty:'Факультет цифровой экономики', program:'Прикладная экономика', year:2, group:'ПЭ-24-02'},
    [
      ['Эконометрика','Экзамен',null,26],
      ['Анализ данных','Зачёт','Зачтено',20],
      ['Микроэкономика','Экзамен','5',23],
      ['Английский язык','Зачёт','Зачтено',19],
      ['Финансы','Экзамен','4',22],
      ['Управление проектами','Зачёт',null,29],
    ],
    'Б', ['Злата Арденова','Тимофей Вельтов','Мира Ветлинская'],
    ['Консультации по эконометрике','Подборка вопросов для консультации размещена в учебной группе. Дату экзамена можно проверить в разделе «Учёба».']
  ),
  'student.vega': demoStudent(
    {name:'Марк Эльдарович Вегов', first:'Марк', initials:'МВ', faculty:'Факультет технологий и дизайна', program:'Цифровой дизайн', year:3, group:'ЦД-23-01'},
    [
      ['Типографика','Экзамен','5',23],
      ['Проектирование интерфейсов','Экзамен',null,26],
      ['Моушн-дизайн','Зачёт',null,22],
      ['История дизайна','Зачёт','Зачтено',21],
      ['Проектный практикум','Зачёт',null,29],
    ],
    'Д', ['Майя Остренова','Лев Таренский','Яна Эльвина'],
    ['Защита проектов по дизайну','Для просмотра проектов потребуется PDF и короткое описание вашей работы.']
  )
};

const types = {
  study: {title:'Справка об обучении', time:'2 рабочих дня'},
  transcript: {title:'Выписка об успеваемости', time:'3 рабочих дня'},
  request: {title:'Вопрос деканату', time:'3 рабочих дня'},
};

const staffLogin = 'staff.demo';
const staffProfile = {name:'Саша Руднева', first:'Саша', initials:'СР', group:'Демо-деканат'};
const changes = {
  'student.nord': {day:'2026-11-23', start:'10:45', previous:'Б–208', room:'Б–312'},
  'student.vega': {day:'2026-11-24', start:'12:30', previous:'Д–110', room:'Д–108'},
};
const period = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'});
function today() { return period.format(new Date()); }
function plus(day, offset) {
  const result = new Date(day + 'T12:00:00Z');
  result.setUTCDate(result.getUTCDate()+offset);
  return result.toISOString().slice(0,10);
}
const defaultRooms = [204,208,110];
const lessonStarts = ['09:00','10:45','12:30'];
function academicData(student, change) {
  const date = today();
  const nextMonth = new Date(date + 'T12:00:00Z');
  nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1, 1);
  const month = nextMonth.toISOString().slice(0,7);
  const grades = student.subjects.map(([name,form,grade,day], index)=>({id:String(index+1),name,form,grade,date:month+'-'+day,time:'10:00',room:student.room+'–204'}));
  const weekdayToday = new Date(date + 'T12:00:00Z').getUTCDay();
  const start = plus(date, -((weekdayToday + 6) % 7) - 7);
  return {
    today: date,
    profile: student.profile,
    grades,
    schedule: Array.from({length:21}, (_, index) => {
      const day = plus(start, index);
      const weekday = new Date(day +'T12:00:00Z').getUTCDay();
      if (weekday === 0 || weekday === 6) return {day, lessons:[]};
      const count = weekday === 3 ? 2 : 3;
      const lessons = Array.from({length:count},(_, n)=>({
        name: student.subjects[(weekday+n-1)%student.subjects.length][0],
        teacher: student.teacher[n],
        start: lessonStarts[n],
        end: ['10:30','12:15','14:00'][n],
        form:['Лекция','Семинар','Практика'][n],
        room: day===change.day && lessonStarts[n]===change.start ? change.room : student.room+'–'+defaultRooms[n],
        change: day===change.day && lessonStarts[n]===change.start ? change.previous : '',
      }));
      return {day, lessons};
    }),
  };
}
function noticesFor(student, read, academic, change) {
  const lesson = academic.schedule.find(d=>d.day===change.day)?.lessons.find(l=>l.start===change.start);
  const upcoming = academic.grades.filter(g=>!g.grade).sort((a,b)=>a.date.localeCompare(b.date))[0];
  const notices = [
    {id:'session', tag:'Сессия', title:student.notices[0], body:student.notices[1], to:upcoming ? 'grades/'+upcoming.id : 'grades', action:'К аттестации', day:'2026-11-21'},
    {id:'services', tag:'Деканат', title:'Справки можно заказать онлайн', body:'Выберите документ или отправьте вопрос деканату. Статус появится в разделе «Заявки».', to:'requests', action:'Открыть заявки', day:'2026-11-19'},
  ];
  if (lesson) {
    const displayDay = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(new Date(change.day+'T12:00:00Z'));
    notices.unshift({
      id:'room-'+(change.event_id || change.day), tag:'Расписание', title:'Перенос · '+lesson.name,
      body:displayDay+', '+change.start+' · из '+change.previous+' в '+change.room,
      to:'schedule/'+change.day+'/'+change.start, action:'К изменённой паре', day:change.published || '2026-11-22',
    });
  }
  return notices.map(notice => ({...notice, read:read.has(notice.id)}));
}

const credentials = {
  "student.nord": ["de5944520cb0968c781ec170c24594f3","c4b5f65a911d7b060536d66816c844ffd023e714e1c7010ed1ebd7b41ccfc4c9"],
  "student.vega": ["6107d1038b6c8d6bb7c24b7eba2a6d48","ba4dbf5c7be27ce807e5f0e7f020edadb521e95dc21794c2ed15883ec2543e0d"],
  "dummy": ["cd3234271e12dbc944741974ae86fbb6","a0843d60f37e7725b9f91d89eb98880f8bfe1fbd2aa19866c501462f9218b697"],
};
credentials["staff.demo"] = ["355b33c5148641005bb9bc8c280be247","edd4737f6430d1b8b9f878bd7002948183a36c2ad8de07dd6663b76d9bdd81fa"];
