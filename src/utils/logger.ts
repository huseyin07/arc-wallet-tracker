type Fields = Record<string, unknown>;
function write(level: string, message: string, fields: Fields = {}) {
  const normalized = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Error ? v.message : v]));
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...normalized }));
}
export const logger = { info: (m: string, f?: Fields) => write('info', m, f), warn: (m: string, f?: Fields) => write('warn', m, f), error: (m: string, f?: Fields) => write('error', m, f) };
