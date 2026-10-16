import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from './lib/mini-express.js';
import { env } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
// Main Clinic (Admin / Super Admin)
import dashboardRoutes from './routes/main/dashboard.js';
import clinicRoutes from './routes/main/clinics.js';
import { pharmacyRoutes, labRoutes } from './routes/main/units.js';
import employeeRoutes from './routes/main/employees.js';
// Branch clinic modules
import patientRoutes from './routes/branch/patients.js';
import queueRoutes from './routes/branch/queue.js';
import visitRoutes from './routes/branch/visits.js';
import itemRoutes from './routes/branch/items.js';
import supplierRoutes from './routes/branch/suppliers.js';
import dispenseRoutes from './routes/branch/dispense.js';
import billRoutes from './routes/branch/bills.js';

export function createApp() {
  const app = express();
  // CORS for a separately hosted frontend (not needed when the API serves the web pages itself)
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && env.corsOrigin.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Clinic-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);

  // Everything below needs a logged-in user
  app.use('/api', authenticate);

  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/clinics', clinicRoutes);
  app.use('/api/pharmacies', pharmacyRoutes);
  app.use('/api/labs', labRoutes);
  app.use('/api/employees', employeeRoutes);

  app.use('/api/patients', patientRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api/visits', visitRoutes);
  app.use('/api/items', itemRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/dispense', dispenseRoutes);
  app.use('/api/bills', billRoutes);

  app.use('/api', notFoundHandler);

  // The pre-built web app (frontend/dist) is served from the same port
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (fs.existsSync(path.join(web, 'index.html'))) app.use(express.static(web));
  else app.get('/', (_req, res) => res.json({ ok: true, note: 'Web app not built: run "npm run build" in frontend/' }));

  app.use(errorHandler);
  return app;
}
