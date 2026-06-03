const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const selfsigned = require('selfsigned');
const { Database, initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3889;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware simples para validar usuário ativo na requisição
function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const user = Database.getUsuarioById(userId);
  if (!user || !user.ativo) {
    return res.status(401).json({ error: 'Usuário inativo ou inexistente' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.perfil !== 'Administrador') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }
    next();
  });
}

// ----------------------------------------------------
// ROTAS DE AUTENTICAÇÃO
// ----------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }
  try {
    const user = Database.authenticate(email, senha);
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    if (!user.ativo) {
      return res.status(403).json({ error: 'Este usuário está inativo.' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/recover', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }
  // Simulando recuperação de senha
  res.json({ message: 'Um e-mail de recuperação de senha foi enviado com instruções.' });
});

// ----------------------------------------------------
// ROTAS DE SETORES
// ----------------------------------------------------

app.get('/api/setores', requireAuth, (req, res) => {
  res.json(Database.getSetores());
});

app.post('/api/setores', requireAdmin, (req, res) => {
  const { nome } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'Nome do setor é obrigatório.' });
  }
  const novo = Database.createSetor(nome);
  res.status(201).json(novo);
});

app.put('/api/setores/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { nome, ativo } = req.body;
  const atualizado = Database.updateSetor(id, nome, ativo);
  if (!atualizado) {
    return res.status(404).json({ error: 'Setor não encontrado.' });
  }
  res.json(atualizado);
});

// ----------------------------------------------------
// ROTAS DE USUÁRIOS
// ----------------------------------------------------

app.get('/api/usuarios', requireAuth, (req, res) => {
  // Retorna todos os usuários (para escolha do responsável ao abrir solicitação)
  res.json(Database.getUsuarios());
});

app.post('/api/usuarios', requireAdmin, (req, res) => {
  const { nome, email, senha, setor_id, cargo, perfil, ativo } = req.body;
  if (!nome || !email || !senha || !setor_id || !cargo || !perfil) {
    return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }
  try {
    const novo = Database.createUsuario(nome, email, senha, setor_id, cargo, perfil, ativo);
    res.status(201).json(novo);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/usuarios/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  try {
    const atualizado = Database.updateUsuario(id, req.body);
    if (!atualizado) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json(atualizado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/usuarios/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  
  // Impede de se excluir a si mesmo
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode excluir a sua própria conta.' });
  }

  const excluido = Database.deleteUsuario(id);
  if (!excluido) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  res.json({ message: 'Usuário excluído com sucesso.' });
});

// ----------------------------------------------------
// ROTAS DE SOLICITAÇÕES
// ----------------------------------------------------

app.get('/api/solicitacoes', requireAuth, (req, res) => {
  let list = Database.getSolicitacoes();
  
  // Se não for administrador, filtra somente as que ele abriu ou é responsável
  if (req.user.perfil !== 'Administrador') {
    list = list.filter(s => s.solicitante_id === req.user.id || s.responsavel_id === req.user.id);
  }

  res.json(list);
});

app.post('/api/solicitacoes', requireAuth, (req, res) => {
  const { responsavel_id, assunto, descricao, urgencia, tempo_estimado, local, observacao, data_desejada } = req.body;
  if (!responsavel_id || !assunto || !urgencia) {
    return res.status(400).json({ error: 'Responsável, assunto e urgência são obrigatórios.' });
  }

  const nova = Database.createSolicitacao({
    solicitante_id: req.user.id,
    responsavel_id,
    assunto,
    descricao,
    urgencia,
    tempo_estimado,
    local,
    observacao,
    data_desejada
  });

  res.status(201).json(nova);
});

// Atualização de status da solicitação
app.put('/api/solicitacoes/:id/status', requireAuth, (req, res) => {
  const { id } = req.params;
  const { status, data_agendada, motivo_cancelamento } = req.body;
  
  const solicitacao = Database.getSolicitacaoById(id);
  if (!solicitacao) {
    return res.status(404).json({ error: 'Solicitação não encontrada.' });
  }

  // Validações de permissão
  const isSolicitante = solicitacao.solicitante_id === req.user.id;
  const isResponsavel = solicitacao.responsavel_id === req.user.id;
  const isAdmin = req.user.perfil === 'Administrador';

  if (!isSolicitante && !isResponsavel && !isAdmin) {
    return res.status(403).json({ error: 'Você não tem permissão para alterar esta solicitação.' });
  }

  let extras = {};
  let logsDesc = '';

  if (status === 'Agendado' || status === 'Reagendado') {
    if (!isResponsavel && !isAdmin) {
      return res.status(403).json({ error: 'Apenas o responsável ou administrador pode agendar/reagendar.' });
    }
    if (!data_agendada) {
      return res.status(400).json({ error: 'Data agendada é obrigatória.' });
    }
    extras.data_agendada = data_agendada;
    const formattedDate = new Date(data_agendada).toLocaleString('pt-BR');
    logsDesc = `${req.user.nome} agendou para ${formattedDate}`;
  }

  if (status === 'Concluído') {
    if (!isResponsavel && !isAdmin) {
      return res.status(403).json({ error: 'Apenas o responsável ou administrador pode concluir a conversa.' });
    }
    logsDesc = `${req.user.nome} concluiu o atendimento.`;
  }

  if (status === 'Em atendimento') {
    if (!isResponsavel && !isAdmin) {
      return res.status(403).json({ error: 'Apenas o responsável ou administrador pode iniciar o atendimento.' });
    }
    logsDesc = `${req.user.nome} iniciou o atendimento presencial.`;
  }

  if (status === 'Pendente') {
    if (!isResponsavel && !isAdmin) {
      return res.status(403).json({ error: 'Apenas o responsável ou administrador pode marcar como pendente.' });
    }
    logsDesc = `${req.user.nome} marcou o status como pendente.`;
  }

  if (status === 'Cancelado') {
    // Solicitante pode cancelar se ainda não foi atendida
    if (isSolicitante && solicitacao.status !== 'Aguardando aceite' && solicitacao.status !== 'Agendado' && !isAdmin) {
      return res.status(400).json({ error: 'Solicitações em andamento não podem ser canceladas por solicitantes.' });
    }
    if (isResponsavel || isAdmin) {
      if (!motivo_cancelamento) {
        return res.status(400).json({ error: 'A justificativa do cancelamento é obrigatória para o responsável.' });
      }
      extras.motivo_cancelamento = motivo_cancelamento;
    }
    logsDesc = `${req.user.nome} cancelou a solicitação. ${motivo_cancelamento ? 'Motivo: ' + motivo_cancelamento : ''}`;
  }

  extras.descricaoHistorico = logsDesc;
  const atualizada = Database.updateSolicitacaoStatus(id, status, req.user.id, extras);
  res.json(atualizada);
});

// ----------------------------------------------------
// ROTAS DE ANOTAÇÕES & HISTÓRICO
// ----------------------------------------------------

app.get('/api/solicitacoes/:id/anotacoes', requireAuth, (req, res) => {
  const { id } = req.params;
  const solicitacao = Database.getSolicitacaoById(id);
  if (!solicitacao) {
    return res.status(404).json({ error: 'Solicitação não encontrada.' });
  }

  // Filtrar se for interna e o usuário for apenas solicitante
  let list = Database.getAnotacoes(id);
  if (req.user.id === solicitacao.solicitante_id && req.user.perfil !== 'Administrador') {
    list = list.filter(a => a.tipo === 'publica');
  }

  res.json(list);
});

app.post('/api/solicitacoes/:id/anotacoes', requireAuth, (req, res) => {
  const { id } = req.params;
  const { tipo, texto } = req.body; // tipo: 'interna' ou 'publica'

  if (!texto) {
    return res.status(400).json({ error: 'Texto da anotação é obrigatório.' });
  }

  const solicitacao = Database.getSolicitacaoById(id);
  if (!solicitacao) {
    return res.status(404).json({ error: 'Solicitação não encontrada.' });
  }

  // Solicitante só pode criar anotação pública (comentário)
  const finalTipo = req.user.id === solicitacao.solicitante_id ? 'publica' : (tipo || 'publica');

  const nova = Database.createAnotacao(id, req.user.id, finalTipo, texto);
  
  // Registrar no histórico
  const tipoLabel = finalTipo === 'interna' ? 'interna' : 'visível para o solicitante';
  Database.createHistorico(id, req.user.id, 'anotacao', `${req.user.nome} adicionou uma anotação ${tipoLabel}.`);

  res.status(201).json(nova);
});

app.get('/api/solicitacoes/:id/historico', requireAuth, (req, res) => {
  const { id } = req.params;
  const solicitacao = Database.getSolicitacaoById(id);
  if (!solicitacao) {
    return res.status(404).json({ error: 'Solicitação não encontrada.' });
  }
  res.json(Database.getHistorico(id));
});

// ----------------------------------------------------
// RELATÓRIOS ESTATÍSTICOS
// ----------------------------------------------------

app.get('/api/relatorios', requireAdmin, (req, res) => {
  const solicitacoes = Database.getSolicitacoes();
  const usuarios = Database.getUsuarios();
  const setores = Database.getSetores();

  // 1. Total de solicitações por dia
  const porDia = {};
  solicitacoes.forEach(s => {
    const dia = s.data_abertura.split('T')[0];
    porDia[dia] = (porDia[dia] || 0) + 1;
  });

  // 2. Total por usuário (como solicitante e como responsável)
  const porUsuario = {};
  usuarios.forEach(u => {
    porUsuario[u.nome] = { solicitadas: 0, recebidas: 0 };
  });
  solicitacoes.forEach(s => {
    const sol = usuarios.find(u => u.id === s.solicitante_id);
    const resp = usuarios.find(u => u.id === s.responsavel_id);
    if (sol) {
      porUsuario[sol.nome] = porUsuario[sol.nome] || { solicitadas: 0, recebidas: 0 };
      porUsuario[sol.nome].solicitadas++;
    }
    if (resp) {
      porUsuario[resp.nome] = porUsuario[resp.nome] || { solicitadas: 0, recebidas: 0 };
      porUsuario[resp.nome].recebidas++;
    }
  });

  // 3. Total por setor do solicitante
  const porSetor = {};
  setores.forEach(set => {
    porSetor[set.nome] = 0;
  });
  solicitacoes.forEach(s => {
    const sol = usuarios.find(u => u.id === s.solicitante_id);
    if (sol) {
      const set = setores.find(st => st.id === sol.setor_id);
      if (set) {
        porSetor[set.nome] = (porSetor[set.nome] || 0) + 1;
      }
    }
  });

  // 4. Solicitações por status
  const porStatus = {
    'Aguardando aceite': 0,
    'Agendado': 0,
    'Em atendimento': 0,
    'Pendente': 0,
    'Concluído': 0,
    'Cancelado': 0,
    'Reagendado': 0
  };
  solicitacoes.forEach(s => {
    if (porStatus[s.status] !== undefined) {
      porStatus[s.status]++;
    }
  });

  // 5. Tempo médio de atendimento (em minutos) entre abertura e conclusão
  const concluidas = solicitacoes.filter(s => s.status === 'Concluído' && s.data_conclusao);
  let tempoTotalMinutos = 0;
  concluidas.forEach(s => {
    const abertura = new Date(s.data_abertura);
    const conclusao = new Date(s.data_conclusao);
    const diff = (conclusao - abertura) / (1000 * 60); // min
    tempoTotalMinutos += diff;
  });
  const tempoMedioConclusao = concluidas.length > 0 ? Math.round(tempoTotalMinutos / concluidas.length) : 0;

  // 6. Assuntos mais recorrentes
  const assuntos = {};
  solicitacoes.forEach(s => {
    const assuntoNorm = s.assunto.trim();
    assuntos[assuntoNorm] = (assuntos[assuntoNorm] || 0) + 1;
  });
  const assuntosOrdenados = Object.entries(assuntos)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(entry => ({ assunto: entry[0], total: entry[1] }));

  res.json({
    totalSolicitacoes: solicitacoes.length,
    porDia,
    porUsuario,
    porSetor,
    porStatus,
    tempoMedioConclusao,
    assuntosMaisRecorrentes: assuntosOrdenados
  });
});

// Captura qualquer outra rota e entrega o index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configuração de HTTPS com certificado autoassinado (assíncrono) ou HTTP para ambientes de nuvem (Render, etc.)
async function startServer() {
  // Inicializa o banco de dados (carrega db.json local ou conecta no Postgres remoto)
  await initializeDatabase();

  const useHttp = process.env.RENDER || process.env.NODE_ENV === 'production' || process.env.USE_HTTP === 'true';

  if (useHttp) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Servidor HTTP rodando na porta ${PORT} (SSL gerenciado pelo proxy/load balancer)`);
    });
  } else {
    let key, cert;
    const certPath = path.join(__dirname, 'cert.pem');
    const keyPath = path.join(__dirname, 'key.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      key = fs.readFileSync(keyPath, 'utf8');
      cert = fs.readFileSync(certPath, 'utf8');
    } else {
      console.log('Gerando certificados SSL autoassinados...');
      const attrs = [{ name: 'commonName', value: '192.168.200.133' }];
      const pems = await selfsigned.generate(attrs, { days: 365 });
      key = pems.private;
      cert = pems.cert;
      fs.writeFileSync(keyPath, key, 'utf8');
      fs.writeFileSync(certPath, cert, 'utf8');
    }

    const credentials = { key, cert };
    https.createServer(credentials, app).listen(PORT, '0.0.0.0', () => {
      console.log(`Servidor HTTPS rodando em https://localhost:${PORT}`);
      console.log(`Acesse via IP na rede: https://192.168.200.133:${PORT}`);
    });
  }
}

startServer().catch(err => {
  console.error('Erro ao iniciar o servidor:', err);
});
