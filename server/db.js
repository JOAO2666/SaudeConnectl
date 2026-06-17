import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'saudeconnect.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const now = () => new Date().toISOString();

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    provider: user.provider,
    createdAt: user.created_at,
    lastLogin: user.last_login,
  };
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')) DEFAULT 'user',
      avatar TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      google_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL,
      services TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      specialty TEXT NOT NULL,
      professional TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')) DEFAULT 'pending',
      reason TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      unit TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL,
      result_url TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patient_profiles (
      user_id TEXT PRIMARY KEY,
      cpf TEXT,
      birth_date TEXT,
      phone TEXT,
      sus_card TEXT,
      address TEXT,
      emergency_contact TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS triage_cases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symptoms TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
      status TEXT NOT NULL CHECK (status IN ('waiting', 'in_service', 'resolved')) DEFAULT 'waiting',
      recommendation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS queue_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      service TEXT NOT NULL,
      position INTEGER NOT NULL,
      estimated_minutes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('waiting', 'called', 'done', 'cancelled')) DEFAULT 'waiting',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'resolved')) DEFAULT 'open',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      audience TEXT NOT NULL CHECK (audience IN ('all', 'users', 'admins')) DEFAULT 'all',
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('online', 'degraded', 'offline')) DEFAULT 'online',
      last_sync TEXT NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  ensureColumn('units', 'distance_km', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('units', 'hours', "TEXT NOT NULL DEFAULT 'Seg-Sex: 7h às 17h'");
  ensureColumn('units', 'lat', 'REAL NOT NULL DEFAULT -23.5505');
  ensureColumn('units', 'lng', 'REAL NOT NULL DEFAULT -46.6333');

  seedDb();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedDb() {
  const seedTime = now();
  upsertUser({
    id: 'usr_admin',
    name: 'Administradora SaúdeConnect',
    email: 'admin@saudeconnect.com',
    password_hash: bcrypt.hashSync('Admin@12345', 12),
    role: 'admin',
    avatar: 'AS',
    created_at: seedTime,
    last_login: seedTime,
  });

  upsertUser({
    id: 'usr_paciente',
    name: 'Marina Costa',
    email: 'paciente@saudeconnect.com',
    password_hash: bcrypt.hashSync('Paciente@12345', 12),
    role: 'user',
    avatar: 'MC',
    created_at: seedTime,
    last_login: seedTime,
  });

  [
    {
      id: 'unit_ubs_centro',
      name: 'UBS Centro',
      type: 'Unidade Básica de Saúde',
      city: 'São Paulo',
      district: 'Centro',
      address: 'Rua da Consolação, 123 - Centro',
      phone: '(11) 3333-1111',
      status: 'Aberto',
      distance_km: 0.5,
      hours: 'Seg-Sex: 7h às 17h',
      lat: -23.5489,
      lng: -46.6388,
      services: ['Clínica geral', 'Vacinação', 'Enfermagem', 'Farmácia'],
    },
    {
      id: 'unit_ama_leste',
      name: 'AMA Leste Integrada',
      type: 'Assistência Médica Ambulatorial',
      city: 'São Paulo',
      district: 'Tatuapé',
      address: 'Rua Serra de Bragança, 890 - Tatuapé',
      phone: '(11) 3333-2222',
      status: 'Aberto',
      distance_km: 2.1,
      hours: 'Todos os dias: 7h às 19h',
      lat: -23.5401,
      lng: -46.5767,
      services: ['Pediatria', 'Ortopedia', 'Curativos', 'Triagem'],
    },
    {
      id: 'unit_clinica_norte',
      name: 'Clínica Norte Digital',
      type: 'Clínica parceira',
      city: 'São Paulo',
      district: 'Santana',
      address: 'Rua Voluntários da Pátria, 1440 - Santana',
      phone: '(11) 3333-5555',
      status: 'Alta demanda',
      distance_km: 2.8,
      hours: 'Seg-Sex: 8h às 20h',
      lat: -23.5024,
      lng: -46.6247,
      services: ['Cardiologia', 'Pediatria', 'Teleconsulta'],
    },
    {
      id: 'unit_lab_viva',
      name: 'Laboratório Viva Saúde',
      type: 'Laboratório',
      city: 'São Paulo',
      district: 'Bela Vista',
      address: 'Av. Paulista, 980 - Bela Vista',
      phone: '(11) 3333-3333',
      status: 'Coleta até 16h',
      distance_km: 1.3,
      hours: 'Seg-Sáb: 6h às 16h',
      lat: -23.5652,
      lng: -46.6524,
      services: ['Hemograma', 'Imagem', 'Resultados digitais'],
    },
    {
      id: 'unit_caps_oeste',
      name: 'CAPS Oeste',
      type: 'Atenção Psicossocial',
      city: 'São Paulo',
      district: 'Pinheiros',
      address: 'Rua Cardeal Arcoverde, 440 - Pinheiros',
      phone: '(11) 3333-4444',
      status: 'Plantão reduzido',
      distance_km: 3.4,
      hours: 'Seg-Sex: 8h às 18h',
      lat: -23.5617,
      lng: -46.6816,
      services: ['Psicologia', 'Psiquiatria', 'Acolhimento'],
    },
  ].forEach(upsertUnit);

  upsertProfile({
    user_id: 'usr_paciente',
    cpf: '123.456.789-00',
    birth_date: '1991-04-18',
    phone: '(11) 98888-2026',
    sus_card: '898 0011 2222 3333',
    address: 'Rua Augusta, 500 - Consolação',
    emergency_contact: 'João Costa - (11) 97777-1010',
    updated_at: seedTime,
  });

  seedOnce('appointments', 'apt_001', () =>
    db.prepare(`
      INSERT INTO appointments (id, user_id, unit_id, specialty, professional, scheduled_at, status, reason, notes, created_at)
      VALUES (@id, @user_id, @unit_id, @specialty, @professional, @scheduled_at, @status, @reason, @notes, @created_at)
    `).run({
      id: 'apt_001',
      user_id: 'usr_paciente',
      unit_id: 'unit_ubs_centro',
      specialty: 'Clínica geral',
      professional: 'Dra. Ana Ribeiro',
      scheduled_at: new Date(Date.now() + 86400000 * 2).toISOString(),
      status: 'confirmed',
      reason: 'Acompanhamento de pressão arterial',
      notes: 'Chegar 15 minutos antes.',
      created_at: seedTime,
    }),
  );

  seedOnce('appointments', 'apt_002', () =>
    db.prepare(`
      INSERT INTO appointments (id, user_id, unit_id, specialty, professional, scheduled_at, status, reason, notes, created_at)
      VALUES (@id, @user_id, @unit_id, @specialty, @professional, @scheduled_at, @status, @reason, @notes, @created_at)
    `).run({
      id: 'apt_002',
      user_id: 'usr_paciente',
      unit_id: 'unit_ama_leste',
      specialty: 'Cardiologia',
      professional: 'Dr. Felipe Torres',
      scheduled_at: new Date(Date.now() + 86400000 * 9).toISOString(),
      status: 'pending',
      reason: 'Avaliar exame de rotina',
      notes: '',
      created_at: seedTime,
    }),
  );

  [
    ['exam_001', 'Hemograma completo', 'Laboratório Viva Saúde', 'Resultado disponível', '#'],
    ['exam_002', 'Eletrocardiograma', 'AMA Leste Integrada', 'Em análise', null],
  ].forEach(([id, title, unit, status, result_url], index) =>
    seedOnce('exams', id, () =>
      db.prepare(`
        INSERT INTO exams (id, user_id, title, unit, requested_at, status, result_url)
        VALUES (@id, @user_id, @title, @unit, @requested_at, @status, @result_url)
      `).run({
        id,
        user_id: 'usr_paciente',
        title,
        unit,
        requested_at: new Date(Date.now() - 86400000 * (index + 4)).toISOString(),
        status,
        result_url,
      }),
    ),
  );

  [
    ['rec_001', 'Receita', 'Losartana 50mg', 'Tomar 1 comprimido pela manhã por 60 dias.'],
    ['rec_002', 'Histórico', 'Consulta de enfermagem', 'Orientações sobre sono, hidratação e aferição semanal.'],
    ['rec_003', 'Vacina', 'Influenza', 'Dose registrada na UBS Centro.'],
  ].forEach(([id, category, title, description], index) =>
    seedOnce('records', id, () =>
      db.prepare(`
        INSERT INTO records (id, user_id, category, title, description, created_at)
        VALUES (@id, @user_id, @category, @title, @description, @created_at)
      `).run({
        id,
        user_id: 'usr_paciente',
        category,
        title,
        description,
        created_at: new Date(Date.now() - 86400000 * (index + 2)).toISOString(),
      }),
    ),
  );

  seedOnce('triage_cases', 'tri_001', () =>
    db.prepare(`
      INSERT INTO triage_cases (id, user_id, symptoms, risk_level, status, recommendation, created_at)
      VALUES (@id, @user_id, @symptoms, @risk_level, @status, @recommendation, @created_at)
    `).run({
      id: 'tri_001',
      user_id: 'usr_paciente',
      symptoms: 'Dor de cabeça persistente e pressão elevada.',
      risk_level: 'medium',
      status: 'waiting',
      recommendation: 'Prioridade amarela. Comparecer à UBS Centro ou aguardar chamada da equipe.',
      created_at: seedTime,
    }),
  );

  seedOnce('queue_entries', 'queue_001', () =>
    db.prepare(`
      INSERT INTO queue_entries (id, user_id, unit_id, service, position, estimated_minutes, status, created_at)
      VALUES (@id, @user_id, @unit_id, @service, @position, @estimated_minutes, @status, @created_at)
    `).run({
      id: 'queue_001',
      user_id: 'usr_paciente',
      unit_id: 'unit_ubs_centro',
      service: 'Clínica geral',
      position: 3,
      estimated_minutes: 28,
      status: 'waiting',
      created_at: seedTime,
    }),
  );

  seedOnce('support_tickets', 'tic_001', () =>
    db.prepare(`
      INSERT INTO support_tickets (id, user_id, subject, message, status, priority, created_at)
      VALUES (@id, @user_id, @subject, @message, @status, @priority, @created_at)
    `).run({
      id: 'tic_001',
      user_id: 'usr_paciente',
      subject: 'Atualizar telefone cadastrado',
      message: 'Preciso alterar meu telefone de contato para receber lembretes.',
      status: 'in_review',
      priority: 'medium',
      created_at: seedTime,
    }),
  );

  [
    ['ann_001', 'Campanha de vacinação aberta', 'Novos horários foram liberados nas unidades integradas.', 'all'],
    ['ann_002', 'Fila digital atualizada', 'Administradores já podem acompanhar prioridades em tempo real.', 'admins'],
  ].forEach(([id, title, body, audience]) =>
    seedOnce('announcements', id, () =>
      db.prepare(`
        INSERT INTO announcements (id, title, body, audience, published_at)
        VALUES (@id, @title, @body, @audience, @published_at)
      `).run({ id, title, body, audience, published_at: seedTime }),
    ),
  );

  [
    ['int_001', 'Cadastro Nacional de Usuários', 'online', 128],
    ['int_002', 'Agenda municipal', 'online', 214],
    ['int_003', 'Laboratórios parceiros', 'degraded', 680],
    ['int_004', 'Notificações SMS', 'online', 190],
  ].forEach(([id, name, status, latency_ms]) =>
    seedOnce('integrations', id, () =>
      db.prepare(`
        INSERT INTO integrations (id, name, status, last_sync, latency_ms)
        VALUES (@id, @name, @status, @last_sync, @latency_ms)
      `).run({ id, name, status, last_sync: seedTime, latency_ms }),
    ),
  );
}

function seedOnce(table, id, insert) {
  const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!exists) insert();
}

function upsertUser(user) {
  const exists = db.prepare('SELECT id FROM users WHERE id = ? OR email = ?').get(user.id, user.email);
  if (exists) {
    db.prepare(`
      UPDATE users
      SET name = @name, role = @role, avatar = @avatar
      WHERE id = @id OR email = @email
    `).run(user);
    return;
  }

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, avatar, provider, created_at, last_login)
    VALUES (@id, @name, @email, @password_hash, @role, @avatar, 'local', @created_at, @last_login)
  `).run(user);
}

function upsertUnit(unit) {
  db.prepare(`
    INSERT INTO units (id, name, type, city, district, address, phone, status, services, distance_km, hours, lat, lng, created_at)
    VALUES (@id, @name, @type, @city, @district, @address, @phone, @status, @services, @distance_km, @hours, @lat, @lng, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      city = excluded.city,
      district = excluded.district,
      address = excluded.address,
      phone = excluded.phone,
      status = excluded.status,
      services = excluded.services,
      distance_km = excluded.distance_km,
      hours = excluded.hours,
      lat = excluded.lat,
      lng = excluded.lng
  `).run({
    ...unit,
    services: JSON.stringify(unit.services),
    created_at: now(),
  });
}

function upsertProfile(profile) {
  db.prepare(`
    INSERT INTO patient_profiles (user_id, cpf, birth_date, phone, sus_card, address, emergency_contact, updated_at)
    VALUES (@user_id, @cpf, @birth_date, @phone, @sus_card, @address, @emergency_contact, @updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      cpf = excluded.cpf,
      birth_date = excluded.birth_date,
      phone = excluded.phone,
      sus_card = excluded.sus_card,
      address = excluded.address,
      emergency_contact = excluded.emergency_contact,
      updated_at = excluded.updated_at
  `).run(profile);
}

export function logAudit(actorId, action, entity, entityId) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, created_at)
    VALUES (@id, @actor_id, @action, @entity, @entity_id, @created_at)
  `).run({
    id: crypto.randomUUID(),
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    created_at: now(),
  });
}
