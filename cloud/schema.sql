-- Banco D1 do GATES! TV (assinantes, webhooks já processados, pareamentos de TV, limite de tentativas).
CREATE TABLE IF NOT EXISTS customers (email TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pairs (id TEXT PRIMARY KEY, code TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pairs_code ON pairs (code);
CREATE TABLE IF NOT EXISTS hits (k TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS hits_k ON hits (k, at);
CREATE TABLE IF NOT EXISTS downloads (code TEXT PRIMARY KEY, file TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS crests (k TEXT PRIMARY KEY, url TEXT, at INTEGER NOT NULL);
-- Dados de cada assinante sincronizados entre aparelhos (perfis, favoritos, histórico, lembretes).
CREATE TABLE IF NOT EXISTS userdata (email TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (email, k));
-- O que cada perfil assistiu (uma linha por sessão; guardado por 90 dias).
CREATE TABLE IF NOT EXISTS watchlog (email TEXT NOT NULL, sid TEXT NOT NULL, profile TEXT, data TEXT NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (email, sid));
CREATE INDEX IF NOT EXISTS watchlog_recent ON watchlog (email, updated_at);
-- Conta do YouTube ligada por assinante (comentar e mandar mensagens no chat pelo app). Tokens do Google cifrados.
CREATE TABLE IF NOT EXISTS ytlinks (email TEXT PRIMARY KEY, refresh TEXT NOT NULL, access TEXT, access_exp INTEGER NOT NULL DEFAULT 0, channel TEXT NOT NULL, updated_at INTEGER NOT NULL);
-- Entradas no YouTube pelo QR code da TV (valem 10 min).
CREATE TABLE IF NOT EXISTS ytlogins (id TEXT PRIMARY KEY, email TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL);
