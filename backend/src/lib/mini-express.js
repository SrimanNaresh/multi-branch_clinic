// A small, dependency-free subset of Express used by SmartClinic.
// Supports: app.use / Router().use with mount paths, get/post/put/patch/delete with :params,
// async handlers (rejections go to error handlers), 4-argument error handlers,
// req.get/query/params/body/path/ip, res.status/json/set, express.json(), and static files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function compile(p, end) {
  const keys = [];
  const src = (p === '/' ? '' : p.replace(/\/+$/, ''))
    .replace(/[.+*?^${}()|[\]\\]/g, (c) => (c === ':' ? c : '\\' + c))
    .replace(/:([A-Za-z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp('^' + src + (end ? '/?$' : '(?=/|$)')), keys };
}

class RouterImpl {
  constructor() { this.stack = []; }

  use(...args) {
    const mount = typeof args[0] === 'string' ? args.shift() : '/';
    for (const h of args.flat()) this.stack.push({ ...compile(mount, false), method: null, handle: h });
    return this;
  }

  _route(method, p, handlers) {
    for (const h of handlers.flat()) this.stack.push({ ...compile(p, true), method, handle: h });
    return this;
  }

  get(p, ...h) { return this._route('GET', p, h); }
  post(p, ...h) { return this._route('POST', p, h); }
  put(p, ...h) { return this._route('PUT', p, h); }
  patch(p, ...h) { return this._route('PATCH', p, h); }
  delete(p, ...h) { return this._route('DELETE', p, h); }

  handle(req, res, out) {
    let i = 0;
    const next = (err) => {
      while (i < this.stack.length) {
        const layer = this.stack[i++];
        if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) continue;
        const m = layer.re.exec(req.path);
        if (!m) continue;
        const isErrorHandler = layer.handle.length === 4;
        if (!!err !== isErrorHandler) continue;

        const params = { ...req.params };
        layer.keys.forEach((k, j) => { params[k] = decodeURIComponent(m[j + 1]); });
        req.params = params;

        if (layer.handle instanceof RouterImpl) {
          const prevPath = req.path;
          const rest = req.path.slice(m[0].length) || '/';
          req.path = rest.startsWith('/') ? rest : '/' + rest;
          return layer.handle.handle(req, res, (e) => { req.path = prevPath; next(e); });
        }
        try {
          const r = isErrorHandler ? layer.handle(err, req, res, next) : layer.handle(req, res, next);
          if (r && typeof r.then === 'function') r.then(undefined, (e) => next(e || new Error('Request failed')));
        } catch (e) {
          next(e);
        }
        return;
      }
      out(err);
    };
    next();
  }
}

/** Router() works with or without `new`, like Express. */
export function Router() { return new RouterImpl(); }

export function json({ limit = '1mb' } = {}) {
  const max = /mb$/i.test(limit) ? parseFloat(limit) * 1024 * 1024 : /kb$/i.test(limit) ? parseFloat(limit) * 1024 : Number(limit) || 1048576;
  return (req, _res, next) => {
    req.body = {};
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!String(req.headers['content-type'] || '').includes('application/json')) return next();
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return next();
      try {
        req.body = JSON.parse(raw);
        next();
      } catch {
        next(Object.assign(new Error('Invalid JSON body'), { type: 'entity.parse.failed', status: 400 }));
      }
    });
    req.on('error', next);
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

/** Serve files from `dir`; unknown paths fall back to index.html (the app uses #routes). */
export function serveStatic(dir) {
  const root = path.resolve(dir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel = decodeURIComponent(req.path);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root)) return next();
    fs.stat(file, (err, st) => {
      const target = !err && st.isFile() ? file : path.join(root, 'index.html');
      fs.readFile(target, (e, data) => {
        if (e) return next();
        res.setHeader('Content-Type', MIME[path.extname(target)] || 'application/octet-stream');
        res.setHeader('Cache-Control', target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
  };
}

export default function express() {
  const router = new RouterImpl();
  const app = (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    req.path = u.pathname;
    req.originalUrl = req.url;
    req.query = Object.fromEntries(u.searchParams);
    req.params = {};
    req.body = req.body || {};
    req.ip = req.socket.remoteAddress;
    req.get = (h) => req.headers[String(h).toLowerCase()];
    res.status = (code) => { res.statusCode = code; return res; };
    res.set = (k, v) => { res.setHeader(k, v); return res; };
    res.json = (obj) => {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
      return res;
    };
    router.handle(req, res, (err) => {
      if (res.headersSent) return res.end();
      res.statusCode = err ? 500 : 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { message: err ? 'Something went wrong' : 'Not found' } }));
      if (err) console.error(err);
    });
  };
  app.use = (...a) => { router.use(...a); return app; };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) app[m] = (...a) => { router[m](...a); return app; };
  app.set = () => app;
  app.listen = (...a) => http.createServer(app).listen(...a);
  return app;
}

express.Router = Router;
express.json = json;
express.static = serveStatic;
