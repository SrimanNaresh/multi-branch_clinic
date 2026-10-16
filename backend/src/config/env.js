import './load-env.js';

export const env = {
  port: Number(process.env.PORT || 5180),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5180').split(',').map((s) => s.trim()),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smartclinic',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  tz: process.env.APP_TZ || 'Asia/Kolkata',
  dbTimeZone: /^[+-]\d{2}:\d{2}$/.test(process.env.DB_TIME_ZONE || '') ? process.env.DB_TIME_ZONE : '+05:30',
};

if (process.env.NODE_ENV === 'production' && env.jwtSecret === 'dev-only-secret') {
  throw new Error('JWT_SECRET must be set in production');
}
