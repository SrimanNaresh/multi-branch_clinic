import { createApp } from './app.js';
import { env } from './config/env.js';

const server = createApp().listen(env.port, env.host, () => {
  console.log(`SmartClinic is running:  http://localhost:${env.port}`);
  console.log('Keep this window open while you use the app. Press Ctrl+C to stop.');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${env.port} is already in use. Close the other app or change PORT in backend/.env`);
  else console.error(err);
  process.exit(1);
});
