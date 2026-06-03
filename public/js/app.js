// ==================== ESTADO GLOBAL ====================
let currentUser = null;
let usersList = [];
let sectorsList = [];
let requestsList = [];
let notifiedRequestIds = new Set();
let currentRequestDetail = null;

let activeView = 'cards'; // cards, lista, kanban, agenda
let activeFilters = {
  status: 'todos',
  periodo: 'todos',
  urgencia: 'todos',
  setor: 'todos',
  busca: ''
};

// Intervalo de Polling para Notificações
let pollingInterval = null;

// Variáveis para Controle da Agenda / Google Calendar
let activeCalendarMode = 'mes'; // mes, semana, dia
let calendarReferenceDate = new Date();

// ==================== INICIALIZAÇÃO ====================
let swRegistration = null;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuth();
  
  // Verifica e gerencia o banner de permissão de notificação
  checkNotificationPermission();

  // Registra o Service Worker para Notificações do Sistema (Central do Windows)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('Service Worker registrado com sucesso:', reg);
        swRegistration = reg;
      })
      .catch(err => {
        console.error('Falha ao registrar Service Worker:', err);
      });

    // Escuta cliques vindos da notificação do Service Worker (Central do Windows)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        const { action, id } = event.data;
        window.focus();
        
        // Garante que os requests estão atualizados e então executa a ação correspondente
        fetchRequests().then(() => {
          if (action === 'atender') {
            atenderNotif(id);
          } else if (action === 'agendar') {
            agendarNotif(id);
          } else {
            openDetalhesModal(id);
          }
        });
      }
    });
  }
});

function checkNotificationPermission() {
  const banner = document.getElementById('notif-permission-banner');
  if (!banner) return;
  
  if ('Notification' in window) {
    if (Notification.permission === 'denied') {
      banner.style.display = 'flex';
      // Esconde o botão porque está bloqueado nas configurações do navegador
      const btn = banner.querySelector('button');
      if (btn) btn.style.display = 'none';
      // Altera o texto para orientar como ativar nas configurações do navegador
      banner.querySelector('span').innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 1.1rem;"></i> <span><strong>Notificações do Sistema Bloqueadas:</strong> Para que os chamados apareçam por cima de outros apps, clique no ícone de <strong>cadeado</strong> na barra de endereços do navegador e ative a permissão de "Notificações".</span>`;
    } else if (Notification.permission === 'default') {
      banner.style.display = 'flex';
      const btn = banner.querySelector('button');
      if (btn) btn.style.display = 'inline-block';
    } else {
      banner.style.display = 'none';
    }
  }
}

async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    checkNotificationPermission();
  }
}

// Expõe globalmente para o onclick do HTML funcionar
window.requestNotificationPermission = requestNotificationPermission;

// Verifica se o usuário já está logado
function checkAuth() {
  const savedUser = localStorage.getItem('chama_na_mesa_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showApp();
    } catch (e) {
      localStorage.removeItem('chama_na_mesa_user');
      showLogin();
    }
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-layout').classList.remove('active');
  if (pollingInterval) clearInterval(pollingInterval);
}

async function showApp() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-layout').classList.add('active');
  
  // Atualiza infos do cabeçalho
  document.getElementById('header-user-name').innerText = currentUser.nome;
  document.getElementById('header-user-badge').innerText = `${currentUser.cargo} (${currentUser.perfil})`;
  
  // Se for Administrador, exibe botão do painel administrativo
  if (currentUser.perfil === 'Administrador') {
    document.getElementById('btn-admin-panel').style.display = 'inline-flex';
  } else {
    document.getElementById('btn-admin-panel').style.display = 'none';
  }

  // Reseta visualização garantindo que a tela administrativa fique fechada e a barra de ações visível
  document.getElementById('view-admin').classList.remove('active');
  document.getElementById('view-dashboard').classList.add('active');
  document.querySelector('.quick-actions-bar').style.display = 'flex';

  // Carrega dados iniciais
  await Promise.all([
    fetchSectors(),
    fetchUsers()
  ]);

  // Carrega solicitações
  await fetchRequests();

  // Inicia Polling de Atualizações a cada 5 segundos
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(pollUpdates, 5000);

  // Verifica permissão de notificação
  checkNotificationPermission();
}

// Cabeçalho de autorização padrão
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-user-id': currentUser ? currentUser.id : ''
  };
}

// ==================== ENDPOINTS DE API (FETCH) ====================

async function fetchSectors() {
  try {
    const res = await fetch('/api/setores', { headers: getHeaders() });
    sectorsList = await res.json();
    populateSectorsDropdowns();
  } catch (err) {
    console.error('Erro ao buscar setores', err);
  }
}

async function fetchUsers() {
  try {
    const res = await fetch('/api/usuarios', { headers: getHeaders() });
    usersList = await res.json();
    populateUsersDropdowns();
  } catch (err) {
    console.error('Erro ao buscar usuários', err);
  }
}

async function fetchRequests() {
  try {
    const res = await fetch('/api/solicitacoes', { headers: getHeaders() });
    requestsList = await res.json();
    renderRequests();
  } catch (err) {
    console.error('Erro ao buscar solicitações', err);
  }
}

async function pollUpdates() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/solicitacoes', { headers: getHeaders() });
    const freshList = await res.json();
    
    // Identificar novas solicitações destinadas ao usuário logado (Aguardando aceite)
    freshList.forEach(req => {
      const isNew = !requestsList.some(r => r.id === req.id);
      const isForMe = req.responsavel_id === currentUser.id;
      const isAwaitingAcceptance = req.status === 'Aguardando aceite';

      if ((isNew || (requestsList.find(r => r.id === req.id)?.status !== req.status)) && isForMe && isAwaitingAcceptance) {
        if (!notifiedRequestIds.has(req.id)) {
          showNotificationToast(req);
        }
      }
    });

    requestsList = freshList;
    renderRequests();
    
    // Se o modal de detalhes estiver aberto com essa solicitação, atualiza a info em tempo real
    if (currentRequestDetail) {
      const updatedDetail = requestsList.find(r => r.id === currentRequestDetail.id);
      if (updatedDetail && JSON.stringify(updatedDetail) !== JSON.stringify(currentRequestDetail)) {
        openDetalhesModal(updatedDetail.id);
      }
    }
  } catch (err) {
    console.error('Erro no polling', err);
  }
}

// ==================== RENDERIZAÇÃO DA SPA ====================

function populateSectorsDropdowns() {
  // Dropdown de filtro
  const filterSetor = document.getElementById('filter-setor');
  filterSetor.innerHTML = '<option value="todos">Todos os setores</option>';
  
  // Dropdown de cadastro de usuário
  const usrSetor = document.getElementById('usr-setor');
  usrSetor.innerHTML = '';

  sectorsList.forEach(s => {
    if (s.ativo) {
      filterSetor.innerHTML += `<option value="${s.id}">${s.nome}</option>`;
      usrSetor.innerHTML += `<option value="${s.id}">${s.nome}</option>`;
    }
  });
}

function populateUsersDropdowns() {
  // Dropdown do modal solicitar conversa (apenas usuários ativos e responsáveis/admins, exceto eu)
  const reqResp = document.getElementById('solicitacao-responsavel');
  reqResp.innerHTML = '<option value="" disabled selected>Selecione um colega...</option>';
  
  usersList.forEach(u => {
    if (u.ativo && u.id !== currentUser.id) {
      const setorNome = getSectorName(u.setor_id);
      reqResp.innerHTML += `<option value="${u.id}">${u.nome} - ${u.cargo} (${setorNome})</option>`;
    }
  });
}

function getSectorName(sectorId) {
  const s = sectorsList.find(sect => sect.id === sectorId);
  return s ? s.nome : 'Sem setor';
}

function getUserName(userId) {
  const u = usersList.find(usr => usr.id === userId);
  return u ? u.nome : 'Desconhecido';
}

function getUserSectorName(userId) {
  const u = usersList.find(usr => usr.id === userId);
  return u ? getSectorName(u.setor_id) : 'Desconhecido';
}

// Renderiza a lista principal com filtros aplicados
function renderRequests() {
  const pageScroll = window.scrollY || document.documentElement.scrollTop;
  const filtered = requestsList.filter(req => {
    // Filtro por Status
    if (activeFilters.status !== 'todos' && req.status !== activeFilters.status) {
      return false;
    }
    // Filtro por Urgência
    if (activeFilters.urgencia !== 'todos' && req.urgencia !== activeFilters.urgencia) {
      return false;
    }
    // Filtro por Setor (do solicitante)
    if (activeFilters.setor !== 'todos') {
      const sol = usersList.find(u => u.id === req.solicitante_id);
      if (!sol || sol.setor_id !== parseInt(activeFilters.setor)) {
        return false;
      }
    }
    // Filtro por Busca textual
    if (activeFilters.busca.trim() !== '') {
      const solName = getUserName(req.solicitante_id).toLowerCase();
      const subject = req.assunto.toLowerCase();
      const term = activeFilters.busca.toLowerCase();
      if (!solName.includes(term) && !subject.includes(term)) {
        return false;
      }
    }
    // Filtro por Período (data de abertura)
    if (activeFilters.periodo !== 'todos') {
      const dataAbert = new Date(req.data_abertura);
      const hoje = new Date();
      hoje.setHours(0,0,0,0);
      const amanha = new Date(hoje);
      amanha.setDate(hoje.getDate() + 1);
      const fimSemana = new Date(hoje);
      fimSemana.setDate(hoje.getDate() + 7);

      if (activeFilters.periodo === 'hoje') {
        const d = new Date(dataAbert);
        d.setHours(0,0,0,0);
        if (d.getTime() !== hoje.getTime()) return false;
      } else if (activeFilters.periodo === 'amanha') {
        const d = new Date(dataAbert);
        d.setHours(0,0,0,0);
        if (d.getTime() !== amanha.getTime()) return false;
      } else if (activeFilters.periodo === 'semana') {
        if (dataAbert < hoje || dataAbert > fimSemana) return false;
      }
    }
    return true;
  });

  // Dividir em Enviadas e Recebidas (ordenadas por id descrescente para que as mais recentes fiquem no topo)
  const enviadas = filtered.filter(s => s.solicitante_id === currentUser.id).sort((a, b) => b.id - a.id);
  const recebidas = filtered.filter(s => s.responsavel_id === currentUser.id).sort((a, b) => b.id - a.id);

  // Renderizar Enviadas (sempre em Cards ou Lista)
  const envContainer = document.getElementById('enviadas-container');
  envContainer.className = `solicitacoes-grid view-mode-${activeView === 'kanban' || activeView === 'agenda' ? 'cards' : activeView}`;
  envContainer.innerHTML = '';
  if (enviadas.length === 0) {
    envContainer.innerHTML = '<div class="no-data"><i class="fa-solid fa-mug-hot"></i> Nenhuma solicitação enviada encontrada.</div>';
  } else {
    enviadas.forEach(req => {
      envContainer.innerHTML += createRequestCardHTML(req, 'enviada');
    });
  }

  const sectionRecebidas = document.getElementById('section-recebidas');
  sectionRecebidas.style.display = 'block';
  document.getElementById('view-toggles-container').style.display = 'flex';

  // Renderizar Recebidas de acordo com a visualização ativa
  const recContainer = document.getElementById('recebidas-container');
  const kanbanView = document.getElementById('kanban-view');
  const agendaView = document.getElementById('agenda-view');

  if (activeView === 'cards' || activeView === 'lista') {
    recContainer.style.display = 'grid';
    kanbanView.style.display = 'none';
    agendaView.style.display = 'none';

    recContainer.className = `solicitacoes-grid view-mode-${activeView}`;
    recContainer.innerHTML = '';
    if (recebidas.length === 0) {
      recContainer.innerHTML = '<div class="no-data"><i class="fa-solid fa-inbox"></i> Nenhuma solicitação recebida encontrada.</div>';
    } else {
      recebidas.forEach(req => {
        recContainer.innerHTML += createRequestCardHTML(req, 'recebida');
      });
    }
  } else if (activeView === 'kanban') {
    recContainer.style.display = 'none';
    kanbanView.style.display = 'grid';
    agendaView.style.display = 'none';

    // Popular colunas do Kanban
    const statuses = ['Aguardando aceite', 'Agendado', 'Em atendimento', 'Pendente', 'Concluído'];
    statuses.forEach(status => {
      const colCards = recebidas.filter(r => r.status === status);
      const colId = status === 'Aguardando aceite' ? 'count-aguardando' : 
                    status === 'Agendado' ? 'count-agendado' :
                    status === 'Em atendimento' ? 'count-atendimento' :
                    status === 'Pendente' ? 'count-pendente' : 'count-concluido';
      
      document.getElementById(colId).innerText = colCards.length;
      
      const listDiv = document.querySelector(`.kanban-column[data-status="${status}"] .kanban-cards-list`);
      listDiv.innerHTML = '';
      if (colCards.length === 0) {
        listDiv.innerHTML = '<div class="no-data-sm">Vazio</div>';
      } else {
        colCards.forEach(req => {
          listDiv.innerHTML += createRequestCardHTML(req, 'recebida', true);
        });
      }
    });
  } else if (activeView === 'agenda') {
    recContainer.style.display = 'none';
    kanbanView.style.display = 'none';
    agendaView.style.display = 'block';

    const agendadas = recebidas.filter(r => r.data_agendada);
    renderGoogleCalendar(agendadas);
  }

  // Restaura rolagem geral da página para evitar pulos quando os dados atualizam
  window.scrollTo(window.scrollX, pageScroll);
}

// ==================== RENDERING GOOGLE CALENDAR ====================

function adjustCalendarDate(direction) {
  if (activeCalendarMode === 'mes') {
    calendarReferenceDate.setMonth(calendarReferenceDate.getMonth() + direction);
  } else if (activeCalendarMode === 'semana') {
    calendarReferenceDate.setDate(calendarReferenceDate.getDate() + (direction * 7));
  } else if (activeCalendarMode === 'dia') {
    calendarReferenceDate.setDate(calendarReferenceDate.getDate() + direction);
  }
  renderRequests();
}

function renderGoogleCalendar(solicitacoes) {
  const monthGrid = document.getElementById('calendar-month-grid');
  const weekGrid = document.getElementById('calendar-week-grid');
  const dayGrid = document.getElementById('calendar-day-grid');
  const label = document.getElementById('calendar-current-label');

  // Save scroll positions
  const pageScroll = window.scrollY || document.documentElement.scrollTop;
  const oldWeekBody = document.querySelector('.week-grid-body');
  const weekScroll = oldWeekBody ? oldWeekBody.scrollTop : 0;
  const oldDayBody = document.querySelector('.day-view-body');
  const dayScroll = oldDayBody ? oldDayBody.scrollTop : 0;

  // Hide all grids
  monthGrid.style.display = 'none';
  weekGrid.style.display = 'none';
  dayGrid.style.display = 'none';

  const mesesNom = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  if (activeCalendarMode === 'mes') {
    monthGrid.style.display = 'grid';
    const year = calendarReferenceDate.getFullYear();
    const month = calendarReferenceDate.getMonth();
    label.innerText = `${mesesNom[month]} ${year}`;

    // Primeiro dia do mês e total de dias
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0: Dom, 1: Seg, ...
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevTotalDays = new Date(year, month, 0).getDate();

    let gridHTML = `
      <div class="calendar-day-header">Dom</div>
      <div class="calendar-day-header">Seg</div>
      <div class="calendar-day-header">Ter</div>
      <div class="calendar-day-header">Qua</div>
      <div class="calendar-day-header">Qui</div>
      <div class="calendar-day-header">Sex</div>
      <div class="calendar-day-header">Sáb</div>
    `;

    // Dias do mês anterior para preenchimento do grid (cinzas)
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = prevTotalDays - i;
      gridHTML += `<div class="calendar-cell outside-month"><span class="day-number">${dayNum}</span></div>`;
    }

    // Dias do mês atual
    const hoje = new Date();
    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(year, month, day);
      const isHoje = cellDate.toDateString() === hoje.toDateString() ? 'today' : '';
      
      // Filtrar solicitações agendadas para este dia
      const diaSols = solicitacoes.filter(s => {
        const d = new Date(s.data_agendada);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
      }).sort((a,b) => new Date(a.data_agendada) - new Date(b.data_agendada));

      let itemsHTML = '';
      diaSols.forEach(s => {
        const t = new Date(s.data_agendada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        itemsHTML += `
          <div class="cal-event-badge ${getStatusClass(s.status)}" onclick="event.stopPropagation(); openDetalhesModal(${s.id})">
            <span class="event-time">${t}</span>
            <span class="event-title">${s.assunto}</span>
          </div>
        `;
      });

      gridHTML += `
        <div class="calendar-cell ${isHoje}">
          <span class="day-number">${day}</span>
          <div class="cal-events-container">${itemsHTML}</div>
        </div>
      `;
    }

    // Completar o grid com dias do próximo mês
    const totalCellsSoFar = firstDayIndex + totalDays;
    const remainingCells = (totalCellsSoFar % 7 === 0) ? 0 : 7 - (totalCellsSoFar % 7);
    for (let i = 1; i <= remainingCells; i++) {
      gridHTML += `<div class="calendar-cell outside-month"><span class="day-number">${i}</span></div>`;
    }

    monthGrid.innerHTML = gridHTML;

  } else if (activeCalendarMode === 'semana') {
    weekGrid.style.display = 'block';
    
    // Encontrar domingo da semana de referência
    const startOfWeek = new Date(calendarReferenceDate);
    startOfWeek.setDate(calendarReferenceDate.getDate() - calendarReferenceDate.getDay());
    startOfWeek.setHours(0,0,0,0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    label.innerText = `${startOfWeek.getDate()} de ${mesesNom[startOfWeek.getMonth()]} - ${endOfWeek.getDate()} de ${mesesNom[endOfWeek.getMonth()]} ${endOfWeek.getFullYear()}`;

    let headerHTML = '<div class="week-grid-header"><div class="time-column-header">Hora</div>';
    const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const hoje = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const isHoje = d.toDateString() === hoje.toDateString() ? 'today' : '';
      headerHTML += `
        <div class="week-day-col-header ${isHoje}">
          <span class="week-day-name">${diasSemana[i]}</span>
          <span class="week-day-num">${d.getDate()}</span>
        </div>
      `;
    }
    headerHTML += '</div>';

    // Grid de Horários da semana (de 08:00 às 18:00)
    let bodyHTML = '<div class="week-grid-body">';
    for (let hour = 8; hour <= 18; hour++) {
      bodyHTML += `<div class="week-hour-row"><div class="time-label">${hour.toString().padStart(2, '0')}:00</div>`;
      
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + dayOffset);
        
        // Filtrar chamados para este dia e hora específica
        const horaSols = solicitacoes.filter(s => {
          const sDate = new Date(s.data_agendada);
          return sDate.getFullYear() === d.getFullYear() && 
                 sDate.getMonth() === d.getMonth() && 
                 sDate.getDate() === d.getDate() && 
                 sDate.getHours() === hour;
        });

        let eventsHTML = '';
        horaSols.forEach(s => {
          const min = new Date(s.data_agendada).getMinutes().toString().padStart(2, '0');
          eventsHTML += `
            <div class="cal-event-badge week-view-event ${getStatusClass(s.status)}" onclick="openDetalhesModal(${s.id})">
              <strong>${hour}:${min}</strong> - ${s.assunto}
            </div>
          `;
        });

        bodyHTML += `<div class="week-cell-hour">${eventsHTML}</div>`;
      }
      
      bodyHTML += '</div>';
    }
    bodyHTML += '</div>';

    weekGrid.innerHTML = headerHTML + bodyHTML;

    // Restore scroll position for week body
    const newWeekBody = weekGrid.querySelector('.week-grid-body');
    if (newWeekBody) {
      newWeekBody.scrollTop = weekScroll;
    }

  } else if (activeCalendarMode === 'dia') {
    dayGrid.style.display = 'block';
    const hoje = new Date();
    label.innerText = `${calendarReferenceDate.getDate()} de ${mesesNom[calendarReferenceDate.getMonth()]} de ${calendarReferenceDate.getFullYear()}`;

    let dayHTML = `
      <div class="day-view-container">
        <div class="day-view-header ${calendarReferenceDate.toDateString() === hoje.toDateString() ? 'today' : ''}">
          <h3>${calendarReferenceDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</h3>
        </div>
        <div class="day-view-body">
    `;

    // Horários do dia (de 08:00 às 18:00)
    for (let hour = 8; hour <= 18; hour++) {
      const horaSols = solicitacoes.filter(s => {
        const sDate = new Date(s.data_agendada);
        return sDate.getFullYear() === calendarReferenceDate.getFullYear() && 
               sDate.getMonth() === calendarReferenceDate.getMonth() && 
               sDate.getDate() === calendarReferenceDate.getDate() && 
               sDate.getHours() === hour;
      }).sort((a,b) => new Date(a.data_agendada) - new Date(b.data_agendada));

      let eventsHTML = '';
      horaSols.forEach(s => {
        const min = new Date(s.data_agendada).getMinutes().toString().padStart(2, '0');
        const solNome = getUserName(s.solicitante_id);
        const solSetor = getUserSectorName(s.solicitante_id);
        eventsHTML += `
          <div class="day-event-card ${getStatusClass(s.status)}" onclick="openDetalhesModal(${s.id})">
            <div class="day-event-time"><i class="fa-regular fa-clock"></i> ${hour}:${min}</div>
            <div class="day-event-details">
              <strong>${s.assunto}</strong>
              <span>Com: ${solNome} (${solSetor}) | Local: ${s.local || 'Mesa do Solicitante'}</span>
            </div>
          </div>
        `;
      });

      dayHTML += `
        <div class="day-hour-row">
          <div class="day-time-label">${hour.toString().padStart(2, '0')}:00</div>
          <div class="day-events-column">${eventsHTML}</div>
        </div>
      `;
    }

    dayHTML += `
        </div>
      </div>
    `;

    dayGrid.innerHTML = dayHTML;

    // Restore scroll position for day body
    const newDayBody = dayGrid.querySelector('.day-view-body');
    if (newDayBody) {
      newDayBody.scrollTop = dayScroll;
    }
  }

  // Restore page scroll to prevent jumping when content updates
  window.scrollTo(window.scrollX, pageScroll);
}

// Auxiliares de estilização
function getStatusClass(status) {
  switch (status) {
    case 'Aguardando aceite': return 'aguardando';
    case 'Agendado': return 'agendado';
    case 'Em atendimento': return 'atendimento';
    case 'Pendente': return 'pendente';
    case 'Concluído': return 'concluido';
    case 'Cancelado': return 'cancelado';
    case 'Reagendado': return 'reagendado';
    default: return 'aguardando';
  }
}

function getUrgenciaClass(urgencia) {
  switch (urgencia) {
    case 'Pode esperar': return 'pode-esperar';
    case 'Hoje ainda': return 'hoje-ainda';
    case 'Urgente': return 'urgente';
    default: return 'pode-esperar';
  }
}

// Criação do card HTML
function createRequestCardHTML(req, tipoFluxo, isKanban = false) {
  const isEnviada = tipoFluxo === 'enviada';
  const interlocutorNome = isEnviada ? getUserName(req.responsavel_id) : getUserName(req.solicitante_id);
  const interlocutorSetor = isEnviada ? getUserSectorName(req.responsavel_id) : getUserSectorName(req.solicitante_id);
  
  const statusClass = getStatusClass(req.status);
  const urgenciaClass = getUrgenciaClass(req.urgencia);
  const dataAbertStr = new Date(req.data_abertura).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  
  let acoesHTML = '';
  
  if (!isKanban) {
    if (!isEnviada) {
      // Recebidas
      if (req.status === 'Aguardando aceite') {
        if (req.data_desejada) {
          acoesHTML += `
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); aceitarHorarioSugerido(${req.id}, '${req.data_desejada}')">Aceitar Horário</button>
          `;
        }
        acoesHTML += `
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); updateStatus(${req.id}, 'Em atendimento')">Atender agora</button>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openAgendarModal(${req.id}, 'agendar')">Agendar</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); openCancelarModal(${req.id})">Recusar</button>
        `;
      } else if (req.status === 'Agendado' || req.status === 'Reagendado') {
        acoesHTML += `
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); updateStatus(${req.id}, 'Em atendimento')">Iniciar Conversa</button>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openAgendarModal(${req.id}, 'reagendar')">Reagendar</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); openCancelarModal(${req.id})">Cancelar</button>
        `;
      } else if (req.status === 'Em atendimento' || req.status === 'Pendente') {
        acoesHTML += `
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openConcluirRapido(${req.id})">Concluir</button>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); updateStatus(${req.id}, 'Pendente')">Pendente</button>
        `;
      }
    } else {
      // Enviadas
      if (req.status === 'Aguardando aceite' || req.status === 'Agendado' || req.status === 'Reagendado') {
        acoesHTML += `
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); updateStatus(${req.id}, 'Cancelado')">Cancelar</button>
        `;
      }
    }
  }

  // Bloco de horário agendado se houver
  let agendaBlock = '';
  if (req.data_agendada && (req.status === 'Agendado' || req.status === 'Reagendado')) {
    const formattedAgenda = new Date(req.data_agendada).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    agendaBlock = `
      <div class="sol-card-time-info">
        <i class="fa-regular fa-clock"></i> Agendado para: <strong>${formattedAgenda}</strong>
      </div>
    `;
  } else if (req.data_desejada && req.status === 'Aguardando aceite') {
    const formattedDesejada = new Date(req.data_desejada).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    agendaBlock = `
      <div class="sol-card-time-info" style="border-left-color: var(--status-aguardando); background-color: var(--status-aguardando-bg);">
        <i class="fa-regular fa-clock"></i> Sugerido para: <strong>${formattedDesejada}</strong>
      </div>
    `;
  }

  return `
    <div class="solicitacao-card" onclick="openDetalhesModal(${req.id})">
      <div class="status-indicator" style="background-color: var(--status-${statusClass})"></div>
      
      <div class="sol-card-header">
        <div>
          <span class="badge-status ${statusClass}">${req.status}</span>
          <span class="badge-urgencia ${urgenciaClass}">${req.urgencia}</span>
          <h3 class="sol-card-title" style="margin-top: 8px;">${req.assunto}</h3>
          <div class="sol-card-meta">
            ${isEnviada ? 'Para' : 'De'}: <strong>${interlocutorNome}</strong> (${interlocutorSetor})<br>
            Aberto em: ${dataAbertStr}
          </div>
        </div>
      </div>

      ${req.local ? `<div class="sol-card-meta"><i class="fa-solid fa-location-dot"></i> Local: <strong>${req.local}</strong></div>` : ''}

      ${agendaBlock}

      ${acoesHTML ? `<div class="sol-card-actions">${acoesHTML}</div>` : ''}
    </div>
  `;
}

// ==================== NOTIFICAÇÃO TOAST VISUAL ====================
let toastQueue = [];
let isToastActive = false;

function showNotificationToast(req) {
  // Evita duplicados na fila caso o polling traga o mesmo request novamente
  if (notifiedRequestIds.has(req.id)) return;
  notifiedRequestIds.add(req.id);

  toastQueue.push(req);
  if (!isToastActive) {
    displayToast(toastQueue.shift());
  }
}

function displayToast(req) {
  isToastActive = true;
  const toast = document.getElementById('realtime-notification-toast');
  const solNome = getUserName(req.solicitante_id);
  const solSetor = getUserSectorName(req.solicitante_id);
  
  const formattedDesejada = req.data_desejada 
    ? new Date(req.data_desejada).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  toast.innerHTML = `
    <div class="notif-header">
      <span><i class="fa-solid fa-bell"></i> Nova Chamada Presencial</span>
      <button onclick="closeNotificationToast()">&times;</button>
    </div>
    <div class="notif-body">
      <div style="margin-bottom: 8px;"><strong>${solNome}</strong> (${solSetor}) quer falar com você.</div>
      <div style="margin-bottom: 4px;"><strong>Assunto:</strong> <em>"${req.assunto}"</em></div>
      ${req.descricao ? `<div style="margin-bottom: 4px;"><strong>Descrição:</strong> ${req.descricao}</div>` : ''}
      <div style="margin-bottom: 4px;"><strong>Urgência:</strong> <span class="badge-urgencia ${getUrgenciaClass(req.urgencia)}">${req.urgencia}</span></div>
      ${req.local ? `<div style="margin-bottom: 4px;"><strong>Local:</strong> ${req.local}</div>` : ''}
      ${req.tempo_estimado ? `<div style="margin-bottom: 4px;"><strong>Tempo Estimado:</strong> ${req.tempo_estimado} min</div>` : ''}
      ${formattedDesejada ? `<div style="margin-bottom: 4px; color: var(--primary);"><strong>Horário Sugerido:</strong> ${formattedDesejada}</div>` : ''}
      ${req.observacao ? `<div style="margin-bottom: 4px; font-style: italic; color: #666;"><strong>Aviso/Obs:</strong> ${req.observacao}</div>` : ''}
    </div>
    <div class="notif-actions" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;">
      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); atenderNotif(${req.id})">Atender agora</button>
      ${req.data_desejada ? `<button class="btn btn-success btn-sm" style="background-color: #22c55e; border-color: #22c55e; color: white;" onclick="event.stopPropagation(); aceitarHorarioSugerido(${req.id}, '${req.data_desejada}'); closeNotificationToast();">Aceitar Horário</button>` : ''}
      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); agendarNotif(${req.id})">Agendar</button>
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); recusarNotif(${req.id})">Recusar</button>
    </div>
  `;
  
  // Injeta overlay escuro por trás para bloquear a tela e focar atenção total
  let overlay = document.getElementById('notif-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'notif-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:9998;';
    document.body.appendChild(overlay);
  }

  toast.classList.add('active');
  
  // Envia Notificação Nativa do Sistema Operacional (Windows/Linux/Mac) - Silenciosa
  if ('Notification' in window && Notification.permission === 'granted') {
    if (swRegistration) {
      const title = `🔔 CHAMA NA MESA - ${req.urgencia || 'Nova Chamada'}`;
      const options = {
        body: `${solNome} (${solSetor}) quer falar com você sobre: "${req.assunto}".`,
        icon: '/img/logo.png',
        badge: '/img/logo.png',
        tag: `chamada-${req.id}`,
        requireInteraction: true,
        silent: true,
        data: { id: req.id, url: window.location.origin + '/' },
        actions: [
          { action: 'atender', title: '✅ Atender agora' },
          { action: 'agendar', title: '📅 Agendar' }
        ]
      };
      swRegistration.showNotification(title, options).catch(err => {
        console.error('Erro ao exibir notificação via Service Worker:', err);
      });
    } else {
      // Fallback para notificação padrão se o Service Worker não estiver pronto
      const systemNotif = new Notification("CHAMA NA MESA - NOVA CHAMADA!", {
        body: `${solNome} (${solSetor}) quer falar com você sobre: "${req.assunto}". Clique para abrir.`,
        icon: '/img/logo.png',
        requireInteraction: true,
        silent: true
      });
      
      systemNotif.onclick = function() {
        window.focus();
        openDetalhesModal(req.id);
        systemNotif.close();
      };
    }
  }

  // Toca um som ou vibra de forma simulada
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function closeNotificationToast() {
  document.getElementById('realtime-notification-toast').classList.remove('active');
  // Remove overlay escuro
  const overlay = document.getElementById('notif-overlay');
  if (overlay) overlay.remove();

  isToastActive = false;
  // Processa a próxima notificação acumulada na fila, se houver
  if (toastQueue.length > 0) {
    setTimeout(() => {
      displayToast(toastQueue.shift());
    }, 400); // Pequeno delay visual para suavidade na troca de toasts
  }
}

function atenderNotif(id) {
  updateStatus(id, 'Em atendimento');
  closeNotificationToast();
}

function agendarNotif(id) {
  closeNotificationToast();
  openAgendarModal(id, 'agendar');
}

function recusarNotif(id) {
  closeNotificationToast();
  openCancelarModal(id);
}

// Aceitar o horário sugerido pelo solicitante
async function aceitarHorarioSugerido(id, dataDesejada) {
  await updateStatus(id, 'Agendado', { data_agendada: dataDesejada });
}

// ==================== OPERAÇÕES DE MUDANÇA DE STATUS ====================

async function updateStatus(id, status, extraData = {}) {
  try {
    const res = await fetch(`/api/solicitacoes/${id}/status`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status, ...extraData })
    });
    
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Erro ao atualizar status.');
      return;
    }

    const updated = await res.json();
    await fetchRequests();
    
    // Se o modal de detalhes estiver aberto, atualiza-o
    if (currentRequestDetail && currentRequestDetail.id === id) {
      openDetalhesModal(id);
    }
  } catch (err) {
    console.error('Erro ao atualizar status', err);
  }
}

// ==================== MODAL DE DETALHES, ANOTAÇÕES E HISTÓRICO ====================

async function openDetalhesModal(id) {
  const req = requestsList.find(r => r.id === id);
  if (!req) return;

  currentRequestDetail = req;
  const solNome = getUserName(req.solicitante_id);
  const solSetor = getUserSectorName(req.solicitante_id);
  const respNome = getUserName(req.responsavel_id);
  const respSetor = getUserSectorName(req.responsavel_id);
  const statusClass = getStatusClass(req.status);
  const urgClass = getUrgenciaClass(req.urgencia);

  // Título e infos básicas
  document.getElementById('detalhes-titulo').innerHTML = `<span class="badge-status ${statusClass}">${req.status}</span> ${req.assunto}`;
  document.getElementById('detalhes-solicitante').innerText = `${solNome} (${solSetor})`;
  document.getElementById('detalhes-responsavel').innerText = `${respNome} (${respSetor})`;
  document.getElementById('detalhes-urgencia').innerHTML = `<span class="badge-urgencia ${urgClass}">${req.urgencia}</span>`;
  document.getElementById('detalhes-status').innerText = req.status;

  // Bloco de tempos e local
  const horáriosBlock = document.getElementById('detalhes-horarios-block');
  horáriosBlock.innerHTML = `
    <span class="label">Linha de tempo</span>
    <div class="val text-box" style="font-size:0.85rem;">
      Abertura: ${new Date(req.data_abertura).toLocaleString('pt-BR')}<br>
      ${req.data_agendada ? `Agendado para: ${new Date(req.data_agendada).toLocaleString('pt-BR')}<br>` : ''}
      ${req.data_conclusao ? `Concluído em: ${new Date(req.data_conclusao).toLocaleString('pt-BR')}<br>` : ''}
      ${req.motivo_cancelamento ? `<span style="color:var(--status-cancelado);">Cancelamento: ${req.motivo_cancelamento}</span>` : ''}
    </div>
  `;

  const localBlock = document.getElementById('detalhes-local-block');
  localBlock.innerHTML = `
    <span class="label">Local e Estimativa</span>
    <div class="val text-box" style="font-size:0.85rem;">
      Mesa/Local: <strong>${req.local || 'Não informado'}</strong><br>
      Tempo Estimado: <strong>${req.tempo_estimado ? req.tempo_estimado + ' minutos' : 'Não informado'}</strong>
      ${req.observacao ? `<br>Aviso: <em>${req.observacao}</em>` : ''}
    </div>
  `;

  // Descrição
  document.getElementById('detalhes-descricao').innerText = req.descricao || 'Nenhuma descrição detalhada informada.';

  // Exibir/Esconder formulário de anotação interna se eu for o solicitante
  const isSolicitante = req.solicitante_id === currentUser.id;
  const isResponsavel = req.responsavel_id === currentUser.id;
  const isAdmin = currentUser.perfil === 'Administrador';

  const checkInterna = document.getElementById('anotacao-interna-label');
  if (isSolicitante && !isAdmin) {
    checkInterna.style.display = 'none';
  } else {
    checkInterna.style.display = 'block';
  }

  // Carrega Anotações e Histórico
  loadDetalhesTabs(req.id);

  // Renderiza botões rápidos de ação no painel de detalhes
  const actionsContainer = document.getElementById('detalhes-actions-container');
  actionsContainer.innerHTML = '';
  
  if (isResponsavel || isAdmin) {
    if (req.status === 'Aguardando aceite') {
      if (req.data_desejada) {
        actionsContainer.innerHTML += `
          <button class="btn btn-primary" onclick="aceitarHorarioSugerido(${req.id}, '${req.data_desejada}'); closeModal('modal-detalhes');">Aceitar Horário Sugerido</button>
        `;
      }
      actionsContainer.innerHTML += `
        <button class="btn btn-primary" onclick="updateStatus(${req.id}, 'Em atendimento')">Atender Agora</button>
        <button class="btn btn-secondary" onclick="openAgendarModal(${req.id}, 'agendar')">Agendar Horário</button>
        <button class="btn btn-danger" onclick="openCancelarModal(${req.id})">Recusar Conversa</button>
      `;
    } else if (req.status === 'Agendado' || req.status === 'Reagendado') {
      actionsContainer.innerHTML += `
        <button class="btn btn-primary" onclick="updateStatus(${req.id}, 'Em atendimento')">Iniciar Atendimento</button>
        <button class="btn btn-secondary" onclick="openAgendarModal(${req.id}, 'reagendar')">Reagendar Horário</button>
        <button class="btn btn-danger" onclick="openCancelarModal(${req.id})">Cancelar Conversa</button>
      `;
    } else if (req.status === 'Em atendimento' || req.status === 'Pendente') {
      actionsContainer.innerHTML += `
        <button class="btn btn-primary" onclick="openConcluirRapido(${req.id})">Concluir Conversa</button>
        <button class="btn btn-secondary" onclick="updateStatus(${req.id}, 'Pendente')">Marcar como Pendente</button>
      `;
    }
  } else if (isSolicitante) {
    if (req.status === 'Aguardando aceite' || req.status === 'Agendado' || req.status === 'Reagendado') {
      actionsContainer.innerHTML += `
        <button class="btn btn-danger" onclick="updateStatus(${req.id}, 'Cancelado')">Cancelar Solicitação</button>
      `;
    }
  }

  openModal('modal-detalhes');
}

async function loadDetalhesTabs(id) {
  try {
    // 1. Anotações
    const resAnot = await fetch(`/api/solicitacoes/${id}/anotacoes`, { headers: getHeaders() });
    const anotacoes = await resAnot.json();
    
    document.getElementById('count-anotacoes-badge').innerText = anotacoes.length;
    const anotList = document.getElementById('anotacoes-list-container');
    anotList.innerHTML = '';
    
    if (anotacoes.length === 0) {
      anotList.innerHTML = '<div class="no-data-sm">Nenhuma anotação registrada ainda.</div>';
    } else {
      anotacoes.forEach(a => {
        const dataStr = new Date(a.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        anotList.innerHTML += `
          <div class="anotacao-item ${a.tipo === 'interna' ? 'interna' : ''}">
            <div class="anotacao-meta">
              <span class="anotacao-author">${getUserName(a.usuario_id)} ${a.tipo === 'interna' ? '(Interna)' : ''}</span>
              <span>${dataStr}</span>
            </div>
            <div class="anotacao-text">${a.texto}</div>
          </div>
        `;
      });
    }

    // 2. Histórico
    const resHist = await fetch(`/api/solicitacoes/${id}/historico`, { headers: getHeaders() });
    const historico = await resHist.json();

    const histList = document.getElementById('historico-timeline-container');
    histList.innerHTML = '';
    
    historico.reverse().forEach(h => {
      const dataStr = new Date(h.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      histList.innerHTML += `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-content" style="padding: 8px 12px; margin-bottom:12px;">
            <div class="timeline-time">${dataStr}</div>
            <div>${h.descricao}</div>
          </div>
        </div>
      `;
    });

  } catch (err) {
    console.error('Erro ao carregar tabs', err);
  }
}

// Enviar Anotação
document.getElementById('form-adicionar-anotacao').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRequestDetail) return;
  
  const texto = document.getElementById('anotacao-texto').value;
  const isInterna = document.getElementById('anotacao-interna-check').checked;
  const tipo = isInterna ? 'interna' : 'publica';

  try {
    const res = await fetch(`/api/solicitacoes/${currentRequestDetail.id}/anotacoes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ tipo, texto })
    });
    
    if (res.ok) {
      document.getElementById('anotacao-texto').value = '';
      document.getElementById('anotacao-interna-check').checked = false;
      loadDetalhesTabs(currentRequestDetail.id);
      fetchRequests();
    }
  } catch (err) {
    console.error('Erro ao salvar anotação', err);
  }
});

// Anotações rápidas sugestões
document.querySelectorAll('.btn-quick-note').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('anotacao-texto').value = btn.innerText;
  });
});

// Alternar Abas internas do modal de detalhes
document.querySelectorAll('[data-tab-detail]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab-detail]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab-detail');
    document.getElementById(`detail-tab-${tabName}`).classList.add('active');
  });
});

// ==================== MODAIS DE AGENDAMENTO E CANCELAMENTO ====================

function openAgendarModal(id, tipo) {
  document.getElementById('agendar-solicitacao-id').value = id;
  document.getElementById('agendar-tipo').value = tipo;
  document.getElementById('agendar-modal-titulo').innerText = tipo === 'reagendar' ? 'Reagendar Conversa' : 'Agendar Conversa';
  
  // Limpar campo de horário personalizado
  document.getElementById('agendar-horario').value = '';
  
  openModal('modal-agendar');
}

// Configura botões rápidos de agendamento
document.querySelectorAll('.btn-quick-time').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = document.getElementById('agendar-solicitacao-id').value;
    const tipo = document.getElementById('agendar-tipo').value;
    const min = btn.getAttribute('data-minutos');
    const periodo = btn.getAttribute('data-periodo');
    
    let targetDate = new Date();

    if (min) {
      targetDate.setMinutes(targetDate.getMinutes() + parseInt(min));
    } else if (periodo === 'tarde') {
      // Define para hoje às 15:00
      targetDate.setHours(15, 0, 0, 0);
    } else if (periodo === 'manha-amanha') {
      // Define para amanhã às 09:30
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(9, 30, 0, 0);
    }

    updateStatus(id, tipo === 'reagendar' ? 'Reagendado' : 'Agendado', {
      data_agendada: targetDate.toISOString()
    });

    closeModal('modal-agendar');
    closeModal('modal-detalhes');
  });
});

document.getElementById('form-agendar').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('agendar-solicitacao-id').value;
  const tipo = document.getElementById('agendar-tipo').value;
  const dataInput = document.getElementById('agendar-horario').value;

  updateStatus(id, tipo === 'reagendar' ? 'Reagendado' : 'Agendado', {
    data_agendada: new Date(dataInput).toISOString()
  });

  closeModal('modal-agendar');
  closeModal('modal-detalhes');
});

function openCancelarModal(id) {
  document.getElementById('cancelar-solicitacao-id').value = id;
  document.getElementById('cancelar-motivo').value = '';
  openModal('modal-cancelar');
}

document.getElementById('form-cancelar').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('cancelar-solicitacao-id').value;
  const motivo = document.getElementById('cancelar-motivo').value;

  updateStatus(id, 'Cancelado', {
    motivo_cancelamento: motivo
  });

  closeModal('modal-cancelar');
  closeModal('modal-detalhes');
});

// Ação de conclusão rápida
function openConcluirRapido(id) {
  // Abre o modal de detalhes caso não esteja aberto, e coloca no foco da anotação
  openDetalhesModal(id);
  document.querySelectorAll('[data-tab-detail]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
  
  const anotBtn = document.querySelector('[data-tab-detail="anotacoes"]');
  anotBtn.classList.add('active');
  document.getElementById('detail-tab-anotacoes').classList.add('active');
  
  // Foca o texto da anotação
  document.getElementById('anotacao-texto').focus();
  document.getElementById('anotacao-texto').value = 'Resolvido';

  // Altera o botão de ação principal do modal temporariamente
  const actionsContainer = document.getElementById('detalhes-actions-container');
  actionsContainer.innerHTML = `
    <button class="btn btn-primary" onclick="confirmarConclusaoComAnotacao(${id})">Confirmar Conclusão</button>
    <button class="btn btn-secondary" onclick="openDetalhesModal(${id})">Voltar</button>
  `;
}

async function confirmarConclusaoComAnotacao(id) {
  const anotTexto = document.getElementById('anotacao-texto').value;
  
  // Salva anotação se houver texto
  if (anotTexto) {
    await fetch(`/api/solicitacoes/${id}/anotacoes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ tipo: 'publica', texto: anotTexto })
    });
  }

  // Atualiza status para concluído
  await updateStatus(id, 'Concluído');
  closeModal('modal-detalhes');
}

// ==================== EVENT LISTENERS & UI ROUTING ====================

function setupEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });
      
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Falha no login.');
        return;
      }

      const data = await res.json();
      localStorage.setItem('chama_na_mesa_user', JSON.stringify(data.user));
      currentUser = data.user;
      showApp();
    } catch (err) {
      console.error(err);
      alert('Erro de conexão com o servidor.');
    }
  });

  // Recuperar senha
  document.getElementById('btn-forgot-password').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value;
    if (!email) {
      alert('Digite o seu e-mail corporativo no campo correspondente para recuperar.');
      return;
    }
    const res = await fetch('/api/auth/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    alert(data.message);
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('chama_na_mesa_user');
    currentUser = null;
    showLogin();
  });

  // Botões de Abrir Modais
  document.getElementById('btn-nova-solicitacao').addEventListener('click', () => {
    // Reset formulário
    document.getElementById('form-solicitar').reset();
    openModal('modal-solicitar');
  });

  // Enviar Nova Solicitação
  document.getElementById('form-solicitar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const respId = document.getElementById('solicitacao-responsavel').value;
    const assunto = document.getElementById('solicitacao-assunto').value;
    const urgencia = document.querySelector('input[name="urgencia"]:checked').value;
    const descricao = document.getElementById('solicitacao-descricao').value;
    const tempo = document.getElementById('solicitacao-tempo').value;
    const local = document.getElementById('solicitacao-local').value;
    const observacao = document.getElementById('solicitacao-observacao').value;

    const dataDesejada = document.getElementById('solicitacao-data-desejada').value;

    try {
      const res = await fetch('/api/solicitacoes', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          responsavel_id: respId,
          assunto,
          urgencia,
          descricao,
          tempo_estimado: tempo,
          local,
          observacao,
          data_desejada: dataDesejada ? new Date(dataDesejada).toISOString() : null
        })
      });

      if (res.ok) {
        closeModal('modal-solicitar');
        fetchRequests();
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao enviar solicitação.');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Configuração de Fechamento de Modais
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = btn.getAttribute('data-modal') || btn.closest('.modal').id;
      closeModal(modalId);
    });
  });

  // Toggles de visualização das solicitações
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.getAttribute('data-view');
      renderRequests();
    });
  });

  // FILTROS LISTENERS
  document.getElementById('filter-status').addEventListener('change', (e) => {
    activeFilters.status = e.target.value;
    renderRequests();
  });
  document.getElementById('filter-periodo').addEventListener('change', (e) => {
    activeFilters.periodo = e.target.value;
    renderRequests();
  });
  document.getElementById('filter-urgencia').addEventListener('change', (e) => {
    activeFilters.urgencia = e.target.value;
    renderRequests();
  });
  document.getElementById('filter-setor').addEventListener('change', (e) => {
    activeFilters.setor = e.target.value;
    renderRequests();
  });
  document.getElementById('filter-busca').addEventListener('input', (e) => {
    activeFilters.busca = e.target.value;
    renderRequests();
  });
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('filter-status').value = 'todos';
    document.getElementById('filter-periodo').value = 'todos';
    document.getElementById('filter-urgencia').value = 'todos';
    document.getElementById('filter-setor').value = 'todos';
    document.getElementById('filter-busca').value = '';
    
    activeFilters = { status: 'todos', periodo: 'todos', urgencia: 'todos', setor: 'todos', busca: '' };
    renderRequests();
  });

  // ADMIN LAYOUT NAVIGATION
  document.getElementById('btn-admin-panel').addEventListener('click', () => {
    if (currentUser.perfil !== 'Administrador') return;
    document.getElementById('view-dashboard').classList.remove('active');
    document.getElementById('view-admin').classList.add('active');
    document.querySelector('.quick-actions-bar').style.display = 'none';
    
    // Inicia na aba usuários
    switchAdminTab('usuarios');
  });

  document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    document.getElementById('view-admin').classList.remove('active');
    document.getElementById('view-dashboard').classList.add('active');
    document.querySelector('.quick-actions-bar').style.display = 'flex';
  });

  // Alternar abas do Admin
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabName = btn.getAttribute('data-tab');
      switchAdminTab(tabName);
    });
  });

  // Admin modais criadores
  document.getElementById('btn-create-usuario-modal').addEventListener('click', () => {
    document.getElementById('form-usuario-admin').reset();
    document.getElementById('usuario-admin-id').value = '';
    document.getElementById('usuario-admin-titulo').innerText = 'Cadastrar Usuário';
    document.getElementById('usr-senha-label').innerText = 'Senha *';
    document.getElementById('usr-senha').required = true;
    openModal('modal-usuario-admin');
  });

  document.getElementById('btn-create-setor-modal').addEventListener('click', () => {
    document.getElementById('form-setor-admin').reset();
    document.getElementById('setor-admin-id').value = '';
    document.getElementById('setor-admin-titulo').innerText = 'Cadastrar Setor';
    openModal('modal-setor-admin');
  });

  // Calendar Controls Click Handlers
  document.getElementById('cal-prev-btn').addEventListener('click', () => {
    adjustCalendarDate(-1);
  });
  document.getElementById('cal-next-btn').addEventListener('click', () => {
    adjustCalendarDate(1);
  });
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    calendarReferenceDate = new Date();
    renderRequests();
  });

  document.querySelectorAll('[data-cal-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-cal-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCalendarMode = btn.getAttribute('data-cal-mode');
      renderRequests();
    });
  });

  // Salvar Usuário Admin
  document.getElementById('form-usuario-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('usuario-admin-id').value;
    const nome = document.getElementById('usr-nome').value;
    const email = document.getElementById('usr-email').value;
    const senha = document.getElementById('usr-senha').value;
    const setor_id = document.getElementById('usr-setor').value;
    const perfil = document.getElementById('usr-perfil').value;
    const cargo = document.getElementById('usr-cargo').value;
    const ativo = document.getElementById('usr-ativo').checked;

    const payload = { nome, email, setor_id, perfil, cargo, ativo };
    if (senha) payload.senha = senha;

    try {
      let res;
      if (id) {
        res = await fetch(`/api/usuarios/${id}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify(payload)
        });
      } else {
        payload.senha = senha; // obrigatório ao criar
        res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(payload)
        });
      }

      if (res.ok) {
        closeModal('modal-usuario-admin');
        await fetchUsers();
        switchAdminTab('usuarios');
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao salvar colaborador.');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Salvar Setor Admin
  document.getElementById('form-setor-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('setor-admin-id').value;
    const nome = document.getElementById('set-nome').value;
    const ativo = document.getElementById('set-ativo').checked;

    try {
      let res;
      if (id) {
        res = await fetch(`/api/setores/${id}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ nome, ativo })
        });
      } else {
        res = await fetch('/api/setores', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ nome })
        });
      }

      if (res.ok) {
        closeModal('modal-setor-admin');
        await fetchSectors();
        switchAdminTab('setores');
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao salvar setor.');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Atualizar Relatórios
  document.getElementById('btn-update-reports').addEventListener('click', () => {
    loadReportsData();
  });
}

// Utilitários de Modal
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (id === 'modal-detalhes') {
    currentRequestDetail = null;
  }
}

// ==================== TABS E FLUXOS DO ADMINISTRADOR ====================

function switchAdminTab(tabName) {
  // Proteção extra de perfil no frontend
  if (currentUser.perfil !== 'Administrador') {
    document.getElementById('view-admin').classList.remove('active');
    document.getElementById('view-dashboard').classList.add('active');
    document.querySelector('.quick-actions-bar').style.display = 'flex';
    return;
  }

  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');

  if (tabName === 'usuarios') {
    renderAdminUsuarios();
  } else if (tabName === 'setores') {
    renderAdminSetores();
  } else if (tabName === 'relatorios') {
    loadReportsData();
  }
}

function renderAdminUsuarios() {
  const tbody = document.getElementById('usuarios-table-body');
  tbody.innerHTML = '';
  
  usersList.forEach(u => {
    const setorNome = getSectorName(u.setor_id);
    tbody.innerHTML += `
      <tr>
        <td><strong>${u.nome}</strong></td>
        <td>${u.email}</td>
        <td>${setorNome}</td>
        <td>${u.cargo}</td>
        <td><span class="user-badge">${u.perfil}</span></td>
        <td>
          <span style="color:${u.ativo ? 'var(--status-concluido)' : 'var(--status-cancelado)'}; font-weight:700;">
            ${u.ativo ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editUsuario(${u.id})">Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUsuario(${u.id})">Excluir</button>
        </td>
      </tr>
    `;
  });
}

async function deleteUsuario(id) {
  if (currentUser && currentUser.id === id) {
    alert('Você não pode excluir a sua própria conta.');
    return;
  }
  if (!confirm('Tem certeza que deseja excluir permanentemente este usuário?')) {
    return;
  }

  try {
    const res = await fetch(`/api/usuarios/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });

    if (res.ok) {
      await fetchUsers();
      renderAdminUsuarios();
    } else {
      const err = await res.json();
      alert(err.error || 'Erro ao excluir colaborador.');
    }
  } catch (err) {
    console.error(err);
  }
}

function editUsuario(id) {
  const u = usersList.find(usr => usr.id === id);
  if (!u) return;

  document.getElementById('usuario-admin-id').value = u.id;
  document.getElementById('usr-nome').value = u.nome;
  document.getElementById('usr-email').value = u.email;
  
  // Senha não é obrigatória na edição
  document.getElementById('usr-senha').value = '';
  document.getElementById('usr-senha-label').innerText = 'Nova Senha (deixe em branco para manter)';
  document.getElementById('usr-senha').required = false;

  document.getElementById('usr-setor').value = u.setor_id;
  document.getElementById('usr-perfil').value = u.perfil;
  document.getElementById('usr-cargo').value = u.cargo;
  document.getElementById('usr-ativo').checked = u.ativo;

  document.getElementById('usuario-admin-titulo').innerText = 'Editar Colaborador';
  openModal('modal-usuario-admin');
}

function renderAdminSetores() {
  const tbody = document.getElementById('setores-table-body');
  tbody.innerHTML = '';

  sectorsList.forEach(s => {
    tbody.innerHTML += `
      <tr>
        <td>${s.id}</td>
        <td><strong>${s.nome}</strong></td>
        <td>
          <span style="color:${s.ativo ? 'var(--status-concluido)' : 'var(--status-cancelado)'}; font-weight:700;">
            ${s.ativo ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editSetor(${s.id})">Editar</button>
        </td>
      </tr>
    `;
  });
}

function editSetor(id) {
  const s = sectorsList.find(sect => sect.id === id);
  if (!s) return;

  document.getElementById('setor-admin-id').value = s.id;
  document.getElementById('set-nome').value = s.nome;
  document.getElementById('set-ativo').checked = s.ativo;

  document.getElementById('setor-admin-titulo').innerText = 'Editar Setor';
  openModal('modal-setor-admin');
}

// Buscar dados e renderizar relatórios
async function loadReportsData() {
  try {
    const res = await fetch('/api/relatorios', { headers: getHeaders() });
    const data = await res.json();

    // Valores Rápidos
    document.getElementById('metric-total-solicitacoes').innerText = data.totalSolicitacoes;
    document.getElementById('metric-tempo-medio').innerText = `${data.tempoMedioConclusao}m`;
    document.getElementById('metric-concluidas').innerText = data.porStatus['Concluído'] || 0;
    document.getElementById('metric-canceladas').innerText = (data.porStatus['Cancelado'] || 0) + (data.porStatus['Pendente'] || 0);

    // Detalhado: Setores
    const setorUl = document.getElementById('report-setores-list');
    setorUl.innerHTML = '';
    Object.entries(data.porSetor).forEach(([setor, total]) => {
      setorUl.innerHTML += `<li><span>${setor}</span><strong>${total} chamados</strong></li>`;
    });

    // Detalhado: Assuntos
    const assuntoUl = document.getElementById('report-assuntos-list');
    assuntoUl.innerHTML = '';
    data.assuntosMaisRecorrentes.forEach(item => {
      assuntoUl.innerHTML += `<li><span>"${item.assunto}"</span><strong>${item.total} vezes</strong></li>`;
    });

    // Detalhado: Usuários
    const colabUl = document.getElementById('report-colaboradores-list');
    colabUl.innerHTML = '';
    Object.entries(data.porUsuario).forEach(([nome, stats]) => {
      colabUl.innerHTML += `<li><span>${nome}</span><strong>${stats.solicitadas} env. / ${stats.recebidas} rec.</strong></li>`;
    });

  } catch (err) {
    console.error('Erro ao buscar relatórios', err);
  }
}
