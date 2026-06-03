const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DB_FILE = process.env.DATABASE_PATH || path.join(__dirname, 'db.json');

// Estado em memória local para sincronização síncrona
let localDb = null;
let pgClient = null;

// Função auxiliar para gerar hash SHA256 simples
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Obter estrutura inicial padrão do banco de dados (Seed Data)
function getDefaultDatabase() {
  return {
    setores: [
      { id: 1, nome: 'Tecnologia', ativo: true },
      { id: 2, nome: 'Recursos Humanos', ativo: true },
      { id: 3, nome: 'Comercial', ativo: true },
      { id: 4, nome: 'Financeiro', ativo: true },
      { id: 5, nome: 'Suporte', ativo: true }
    ],
    usuarios: [
      {
        id: 1,
        nome: 'Administrador Principal',
        email: 'admin@chamanamesa.com.br',
        senha_hash: hashPassword('admin'),
        setor_id: 1,
        cargo: 'Gerente de TI',
        perfil: 'Administrador',
        ativo: true,
        criado_em: new Date('2026-06-01T08:00:00Z').toISOString()
      },
      {
        id: 2,
        nome: 'Ana Silva',
        email: 'ana@chamanamesa.com.br',
        senha_hash: hashPassword('123'),
        setor_id: 1,
        cargo: 'Desenvolvedora Frontend',
        perfil: 'Comum',
        ativo: true,
        criado_em: new Date('2026-06-01T09:00:00Z').toISOString()
      },
      {
        id: 3,
        nome: 'Leonardo Santos',
        email: 'leonardo@chamanamesa.com.br',
        senha_hash: hashPassword('123'),
        setor_id: 1,
        cargo: 'Líder Técnico',
        perfil: 'Comum',
        ativo: true,
        criado_em: new Date('2026-06-01T09:10:00Z').toISOString()
      },
      {
        id: 4,
        nome: 'Mariana Costa',
        email: 'mariana@chamanamesa.com.br',
        senha_hash: hashPassword('123'),
        setor_id: 2,
        cargo: 'Coordenadora de RH',
        perfil: 'Comum',
        ativo: true,
        criado_em: new Date('2026-06-01T09:20:00Z').toISOString()
      },
      {
        id: 5,
        nome: 'Pedro Mendes',
        email: 'pedro@chamanamesa.com.br',
        senha_hash: hashPassword('123'),
        setor_id: 3,
        cargo: 'Analista Comercial',
        perfil: 'Comum',
        ativo: true,
        criado_em: new Date('2026-06-01T09:30:00Z').toISOString()
      },
      {
        id: 6,
        nome: 'Mateus Schiavo',
        email: 'mateusschiavoprofissional@gmail.com',
        senha_hash: hashPassword('amathe12345'),
        setor_id: 1,
        cargo: 'Diretor / Master',
        perfil: 'Administrador',
        ativo: true,
        criado_em: new Date('2026-06-01T10:00:00Z').toISOString()
      }
    ],
    solicitacoes: [],
    anotacoes: [],
    historico: [],
    config: {
      nextIds: {
        setores: 6,
        usuarios: 7,
        solicitacoes: 1,
        anotacoes: 1,
        historico: 1
      }
    }
  };
}

// Inicializar banco de dados remoto ou local de forma assíncrona antes do servidor Express rodar
async function initializeDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    console.log('Conectando ao banco de dados PostgreSQL remoto...');
    pgClient = new Client({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });
    await pgClient.connect();
    
    // Criar tabela se não existir
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS json_db (
        id INT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
    
    // Buscar dados existentes
    const res = await pgClient.query('SELECT data FROM json_db WHERE id = 1');
    if (res.rows.length > 0) {
      localDb = res.rows[0].data;
      console.log('Banco de dados carregado com sucesso do PostgreSQL remoto.');
    } else {
      console.log('Inicializando banco de dados com dados padrão no PostgreSQL...');
      const seedData = getDefaultDatabase();
      await pgClient.query('INSERT INTO json_db (id, data) VALUES (1, $1)', [JSON.stringify(seedData)]);
      localDb = seedData;
    }
  } else {
    // Modo local via arquivo JSON
    console.log('Carregando banco de dados local via db.json...');
    if (fs.existsSync(DB_FILE)) {
      try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        localDb = JSON.parse(data);
      } catch (e) {
        console.error('Erro ao ler banco de dados local. Recriando...', e);
      }
    }
    if (!localDb) {
      localDb = getDefaultDatabase();
      saveDatabase(localDb);
    }
  }
}

// Carregar dados (usado de forma síncrona pelo resto da lógica do app)
function loadDatabase() {
  if (!localDb) {
    // Fallback de contingência caso chamado antes da inicialização
    if (fs.existsSync(DB_FILE)) {
      try {
        localDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      } catch (e) {}
    }
    if (!localDb) {
      localDb = getDefaultDatabase();
    }
  }
  return localDb;
}

// Salvar dados
function saveDatabase(db) {
  localDb = db;
  if (pgClient) {
    // Gravação assíncrona no Postgres remoto
    pgClient.query('UPDATE json_db SET data = $1 WHERE id = 1', [JSON.stringify(db)])
      .catch(err => console.error('Erro ao salvar no PostgreSQL remoto:', err));
  } else {
    // Gravação síncrona local
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
      console.error('Erro ao salvar o banco de dados local:', e);
    }
  }
}

// Operações do Banco
const Database = {
  // Config
  getNextId(db, table) {
    if (!db.config) {
      db.config = { nextIds: {} };
    }
    if (!db.config.nextIds) {
      db.config.nextIds = {};
    }
    const currentId = db.config.nextIds[table] || 1;
    db.config.nextIds[table] = currentId + 1;
    return currentId;
  },

  // Setores
  getSetores() {
    const db = loadDatabase();
    return db.setores;
  },

  createSetor(nome) {
    const db = loadDatabase();
    const id = this.getNextId(db, 'setores');
    const novo = { id, nome, ativo: true };
    db.setores.push(novo);
    saveDatabase(db);
    return novo;
  },

  updateSetor(id, nome, ativo) {
    const db = loadDatabase();
    const idx = db.setores.findIndex(s => s.id === parseInt(id));
    if (idx !== -1) {
      db.setores[idx].nome = nome;
      db.setores[idx].ativo = ativo;
      saveDatabase(db);
      return db.setores[idx];
    }
    return null;
  },

  // Usuarios
  getUsuarios() {
    const db = loadDatabase();
    return db.usuarios.map(u => {
      const uCopy = { ...u };
      delete uCopy.senha_hash; // remover senha das queries padrão
      return uCopy;
    });
  },

  getUsuarioById(id) {
    const db = loadDatabase();
    const u = db.usuarios.find(u => u.id === parseInt(id));
    if (u) {
      const uCopy = { ...u };
      delete uCopy.senha_hash;
      return uCopy;
    }
    return null;
  },

  authenticate(email, password) {
    const db = loadDatabase();
    const hash = hashPassword(password);
    const u = db.usuarios.find(u => u.email.toLowerCase() === email.toLowerCase() && u.senha_hash === hash);
    if (u) {
      const uCopy = { ...u };
      delete uCopy.senha_hash;
      return uCopy;
    }
    return null;
  },

  createUsuario(nome, email, senha, setor_id, cargo, perfil, ativo) {
    const db = loadDatabase();
    if (db.usuarios.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('E-mail já cadastrado.');
    }
    const id = this.getNextId(db, 'usuarios');
    const novo = {
      id,
      nome,
      email: email.toLowerCase(),
      senha_hash: hashPassword(senha),
      setor_id: parseInt(setor_id),
      cargo,
      perfil,
      ativo: ativo !== undefined ? ativo : true,
      criado_em: new Date().toISOString()
    };
    db.usuarios.push(novo);
    saveDatabase(db);
    const uCopy = { ...novo };
    delete uCopy.senha_hash;
    return uCopy;
  },

  updateUsuario(id, dados) {
    const db = loadDatabase();
    const idx = db.usuarios.findIndex(u => u.id === parseInt(id));
    if (idx !== -1) {
      const current = db.usuarios[idx];
      
      // Checar e-mail duplicado
      if (dados.email && dados.email.toLowerCase() !== current.email.toLowerCase()) {
        if (db.usuarios.some(u => u.id !== current.id && u.email.toLowerCase() === dados.email.toLowerCase())) {
          throw new Error('E-mail já cadastrado para outro usuário.');
        }
      }

      db.usuarios[idx] = {
        ...current,
        nome: dados.nome !== undefined ? dados.nome : current.nome,
        email: dados.email !== undefined ? dados.email.toLowerCase() : current.email,
        setor_id: dados.setor_id !== undefined ? parseInt(dados.setor_id) : current.setor_id,
        cargo: dados.cargo !== undefined ? dados.cargo : current.cargo,
        perfil: dados.perfil !== undefined ? dados.perfil : current.perfil,
        ativo: dados.ativo !== undefined ? dados.ativo : current.ativo
      };

      if (dados.senha && dados.senha.trim() !== '') {
        db.usuarios[idx].senha_hash = hashPassword(dados.senha);
      }

      saveDatabase(db);
      const uCopy = { ...db.usuarios[idx] };
      delete uCopy.senha_hash;
      return uCopy;
    }
    return null;
  },

  deleteUsuario(id) {
    const db = loadDatabase();
    const idx = db.usuarios.findIndex(u => u.id === parseInt(id));
    if (idx !== -1) {
      db.usuarios.splice(idx, 1);
      saveDatabase(db);
      return true;
    }
    return false;
  },

  // Solicitações
  getSolicitacoes() {
    const db = loadDatabase();
    return db.solicitacoes;
  },

  getSolicitacaoById(id) {
    const db = loadDatabase();
    return db.solicitacoes.find(s => s.id === parseInt(id));
  },

  createSolicitacao(dados) {
    const db = loadDatabase();
    const id = this.getNextId(db, 'solicitacoes');
    const nova = {
      id,
      solicitante_id: parseInt(dados.solicitante_id),
      responsavel_id: parseInt(dados.responsavel_id),
      assunto: dados.assunto,
      descricao: dados.descricao || '',
      urgencia: dados.urgencia, // Pode esperar, Hoje ainda, Urgente
      tempo_estimado: dados.tempo_estimado || '',
      local: dados.local || '',
      observacao: dados.observacao || '',
      status: 'Aguardando aceite',
      data_abertura: new Date().toISOString(),
      data_desejada: dados.data_desejada || null,
      data_agendada: null,
      data_conclusao: null,
      cancelada_por: null,
      motivo_cancelamento: null
    };

    db.solicitacoes.push(nova);
    saveDatabase(db);

    // Adiciona log inicial ao histórico
    this.createHistorico(id, dados.solicitante_id, 'abertura', 'Solicitação de conversa aberta');

    return nova;
  },

  updateSolicitacaoStatus(id, status, usuario_id, extras = {}) {
    const db = loadDatabase();
    const idx = db.solicitacoes.findIndex(s => s.id === parseInt(id));
    if (idx !== -1) {
      const s = db.solicitacoes[idx];
      s.status = status;

      if (status === 'Agendado' || status === 'Reagendado') {
        s.data_agendada = extras.data_agendada || new Date().toISOString();
      }
      if (status === 'Concluído') {
        s.data_conclusao = new Date().toISOString();
      }
      if (status === 'Cancelado') {
        s.cancelada_por = parseInt(usuario_id);
        s.motivo_cancelamento = extras.motivo_cancelamento || '';
      }

      db.solicitacoes[idx] = s;
      saveDatabase(db);

      // Logar no Histórico
      let descricaoHistorico = `Status alterado para ${status}`;
      if (extras.descricaoHistorico) {
        descricaoHistorico = extras.descricaoHistorico;
      }
      this.createHistorico(id, usuario_id, status.toLowerCase().replace(' ', '_'), descricaoHistorico);

      return s;
    }
    return null;
  },

  // Anotações
  getAnotacoes(solicitacao_id) {
    const db = loadDatabase();
    return db.anotacoes.filter(a => a.solicitacao_id === parseInt(solicitacao_id));
  },

  createAnotacao(solicitacao_id, usuario_id, tipo, texto) {
    const db = loadDatabase();
    const id = this.getNextId(db, 'anotacoes');
    const nova = {
      id,
      solicitacao_id: parseInt(solicitacao_id),
      usuario_id: parseInt(usuario_id),
      tipo, // 'interna' ou 'publica'
      texto,
      criado_em: new Date().toISOString()
    };
    db.anotacoes.push(nova);
    saveDatabase(db);
    return nova;
  },

  // Histórico
  getHistorico(solicitacao_id) {
    const db = loadDatabase();
    return db.historico.filter(h => h.solicitacao_id === parseInt(solicitacao_id));
  },

  createHistorico(solicitacao_id, usuario_id, acao, descricao) {
    const db = loadDatabase();
    const id = this.getNextId(db, 'historico');
    const novo = {
      id,
      solicitacao_id: parseInt(solicitacao_id),
      usuario_id: parseInt(usuario_id),
      acao,
      descricao,
      criado_em: new Date().toISOString()
    };
    db.historico.push(novo);
    saveDatabase(db);
    return novo;
  }
};

// Inicializa no carregamento do arquivo
loadDatabase();

module.exports = { Database, hashPassword, initializeDatabase };
