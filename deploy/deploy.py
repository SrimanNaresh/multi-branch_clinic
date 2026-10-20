"""Deploy SmartClinic to a Linux server over SSH (paramiko).

    python deploy/deploy.py                    # defaults below
    python deploy/deploy.py --host 1.2.3.4 --domain clinic.example.com

The SSH password is read from the SSH_PASSWORD environment variable, or asked
for at the prompt. Nothing secret is stored in this file.

What it does on the server (as root):
  - uses the system Node.js if it is 20+, otherwise a private Node 20 under /opt/<name>/node
  - uploads backend + frontend/dist + shared + database to /opt/<name>/app (previous copy kept in app.prev)
  - writes /opt/<name>/app/backend/.env on the first deploy (DB settings copied from your local backend/.env),
    and keeps it on later deploys
  - runs the app as a systemd service <name>.service, bound to 127.0.0.1:<port>
  - adds a reverse-proxy site for the domain to nginx or Apache (whichever owns port 80; installs nginx if none)
  - optionally gets a Let's Encrypt certificate with certbot
It never edits other sites' config; a failing config test rolls the new site back.
"""
import argparse
import getpass
import io
import os
import secrets
import shlex
import sys
import tarfile
import time

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_VERSION = "20.18.1"

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--host", default="156.67.104.242")
ap.add_argument("--user", default="root")
ap.add_argument("--ssh-port", type=int, default=22)
ap.add_argument("--domain", default="abihomoeoclinic.thangaminfotech.com")
ap.add_argument("--name", default="abihomoeoclinic", help="service / folder name on the server")
ap.add_argument("--port", type=int, default=5180, help="preferred local port for the app on the server")
ap.add_argument("--yes", action="store_true", help="do not ask before making changes")
ap.add_argument("--replace", action="store_true",
                help="take over the domain from an existing nginx site (backs up /etc/nginx and disables that site)")
args = ap.parse_args()

class Tee:
    """Also write everything printed to deploy/last-deploy.log (the password is never printed)."""
    def __init__(self, stream, log):
        self.stream, self.log = stream, log

    def write(self, s):
        self.stream.write(s)
        self.log.write(s)
        self.log.flush()

    def flush(self):
        self.stream.flush()

    def __getattr__(self, name):
        return getattr(self.stream, name)


_log = open(os.path.join(ROOT, "deploy", "last-deploy.log"), "w", encoding="utf-8")
sys.stdout, sys.stderr = Tee(sys.stdout, _log), Tee(sys.stderr, _log)
print(f"deploy.py {' '.join(sys.argv[1:])}  ({time.strftime('%Y-%m-%d %H:%M:%S')})")

BASE = f"/opt/{args.name}"
APP = f"{BASE}/app"
SERVICE = args.name
q = shlex.quote


def say(msg):
    print(f"\n==> {msg}", flush=True)


def ask(prompt):
    if args.yes:
        return True
    return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")


def run(cmd, check=True, show=False):
    _, out, err = ssh.exec_command(f"bash -c {q(cmd)}")
    o, e = out.read().decode(errors="replace"), err.read().decode(errors="replace")
    code = out.channel.recv_exit_status()
    if show and o.strip():
        print(o.rstrip())
    if check and code != 0:
        print(f"\nCommand failed ({code}): {cmd}\n{o}{e}", file=sys.stderr)
        sys.exit(1)
    return code, o.strip()


def out(cmd):
    return run(cmd, check=False)[1]


def put_text(path, text, mode=0o644):
    with sftp.open(path, "w") as f:
        f.write(text)
    sftp.chmod(path, mode)


def read_local_env():
    env = {}
    with open(os.path.join(ROOT, "backend", ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def clean(ti):
    # Windows gives no useful modes/owners; make them sane for Linux
    ti.uid = ti.gid = 0
    ti.uname = ti.gname = "root"
    ti.mode = 0o755 if ti.isdir() else 0o644
    return ti


def build_bundle():
    skip_names = {".env", ".db-ready", "__pycache__", ".DS_Store"}
    parts = [
        "backend/src", "backend/scripts", "backend/node_modules", "backend/package.json", "backend/.env.example",
        "frontend/dist", "shared", "database",
    ]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for p in parts:
            full = os.path.join(ROOT, p)
            if not os.path.exists(full):
                sys.exit(f"Missing {p} - run this from a complete copy of the project.")
            tar.add(full, arcname=p, filter=lambda ti: None if os.path.basename(ti.name) in skip_names else clean(ti))
    buf.seek(0)
    return buf


# ---------------------------------------------------------------- connect
password = os.environ.get("SSH_PASSWORD") or getpass.getpass(f"SSH password for {args.user}@{args.host}: ")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
say(f"Connecting to {args.user}@{args.host}:{args.ssh_port}")
ssh.connect(args.host, port=args.ssh_port, username=args.user, password=password, timeout=20,
            look_for_keys=False, allow_agent=False)
del password
sftp = ssh.open_sftp()

# ---------------------------------------------------------------- look around (read-only)
say("Checking the server")
os_name = out(". /etc/os-release 2>/dev/null; echo \"$PRETTY_NAME\"")
arch = {"x86_64": "x64", "aarch64": "arm64"}.get(out("uname -m"), "")
pkg = "apt" if run("command -v apt-get", check=False)[0] == 0 else ("dnf" if run("command -v dnf", check=False)[0] == 0 else "yum")
sys_node = out("command -v node && node -v")
listen80 = out("ss -ltnpH 'sport = :80' 2>/dev/null")
has_nginx = run("command -v nginx", check=False)[0] == 0
has_apache = run("command -v apache2 || command -v httpd", check=False)[0] == 0
first_deploy = run(f"test -f {APP}/backend/.env", check=False)[0] != 0

if "nginx" in listen80:
    web = "nginx"
elif "apache2" in listen80 or "httpd" in listen80:
    web = "apache"
elif listen80:
    sys.exit(f"Port 80 is used by something this script does not know how to configure:\n{listen80}\nNothing was changed.")
else:
    web = "nginx"  # nothing on port 80: use (and if needed install) nginx

node_bin = None
if sys_node:
    path, ver = (sys_node.splitlines() + [""])[:2]
    if ver.startswith("v") and int(ver[1:].split(".")[0]) >= 20:
        node_bin = path
if not node_bin and not arch:
    sys.exit(f"Unsupported CPU ({out('uname -m')}) for the private Node.js download. Nothing was changed.")

# Port: keep the one from an earlier deploy, otherwise the first free one from --port
port = None
if not first_deploy:
    p = out(f"grep -E '^PORT=' {APP}/backend/.env | cut -d= -f2")
    port = int(p) if p.isdigit() else None
if port is None:
    used = out("ss -ltnH | awk '{print $4}' | sed 's/.*://'").split()
    port = next(p for p in range(args.port, args.port + 50) if str(p) not in used)

# Is the domain already configured by another site?
own = {"nginx": [f"/etc/nginx/sites-available/{args.domain}", f"/etc/nginx/sites-enabled/{args.domain}", f"/etc/nginx/conf.d/{args.domain}.conf"],
       "apache": [f"/etc/apache2/sites-available/{args.domain}.conf", f"/etc/apache2/sites-enabled/{args.domain}.conf", f"/etc/httpd/conf.d/{args.domain}.conf"]}[web]
conf_root = "/etc/nginx" if web == "nginx" else "/etc/apache2 /etc/httpd"
others = [f for f in out(f"grep -rlsF {q(args.domain)} {conf_root} 2>/dev/null").splitlines()
          if f and f not in own and not f.startswith("/etc/letsencrypt")]
others = [f for f in others if out(f"readlink -f {q(f)}") not in own]
MARK = f"# managed by deploy.py ({args.name})"
# a file with our name that this script did not write (an older site for the same domain)
own_foreign = [f for f in own if not f.startswith("/etc/nginx/sites-enabled/")
               and run(f"test -f {q(f)} && ! grep -qF {q(MARK)} {q(f)}", check=False)[0] == 0]

# nginx only reads sites-enabled/* and conf.d/*.conf (plus nginx.conf); a file in sites-available
# counts only when something in sites-enabled points at it
enabled = {}
for line in out('for f in /etc/nginx/sites-enabled/*; do [ -e "$f" ] && echo "$f $(readlink -f "$f")"; done').splitlines():
    entry, target = line.split(" ", 1)
    enabled[entry] = target
to_disable = []
for f in others:
    real = out(f"readlink -f {q(f)}")
    if f.startswith("/etc/nginx/sites-available/"):
        to_disable += [e for e, t in enabled.items() if t == real and e not in to_disable]
    elif f not in to_disable:
        to_disable.append(f)

print(f"  OS:           {os_name} ({pkg})")
print(f"  Node.js:      {sys_node.splitlines()[-1] if sys_node else 'none'} -> using {'system ' + node_bin if node_bin else 'private Node ' + NODE_VERSION}")
print(f"  Web server:   {web}{'' if (web == 'nginx' and has_nginx) or (web == 'apache' and has_apache) else ' (will be installed)'}")
print(f"  App folder:   {APP}  ({'first deploy' if first_deploy else 'update, .env kept'})")
print(f"  App service:  {SERVICE}.service on 127.0.0.1:{port}")
print(f"  Site:         http://{args.domain}")
if (to_disable or own_foreign) and not args.replace:
    sys.exit("\nThe domain is already served by another site:\n  " + "\n  ".join(to_disable + own_foreign) +
             "\nRun again with --replace to back it up and take it over. Nothing was changed.")
if to_disable or own_foreign:
    if web != "nginx":
        sys.exit("--replace only supports nginx. Nothing was changed.")
    for f in to_disable:
        names = out(f"grep -hE '^[[:space:]]*server_name' {q(enabled.get(f, f))} | sed -E 's/^[[:space:]]*server_name//; s/;//g'").split()
        extra = sorted(set(n for n in names if n not in (args.domain, "www." + args.domain)))
        if extra or f == "/etc/nginx/nginx.conf":
            sys.exit(f"\n{f} also serves other names ({', '.join(extra) or 'main nginx.conf'}), so it cannot simply be "
                     "disabled. Edit it by hand to remove this domain. Nothing was changed.")
    print("  Replacing:    " + ", ".join(to_disable + own_foreign) + "  (disabled after a full /etc/nginx backup)")
if not ask("\nDeploy now?"):
    sys.exit("Cancelled. Nothing was changed.")

# ---------------------------------------------------------------- Node.js
if not node_bin:
    say(f"Installing private Node.js {NODE_VERSION} in {BASE}/node")
    tarname = f"node-v{NODE_VERSION}-linux-{arch}"
    run(f"mkdir -p {BASE} && cd {BASE} && rm -rf node.tmp && mkdir node.tmp && "
        f"curl -fsSL https://nodejs.org/dist/v{NODE_VERSION}/{tarname}.tar.xz | tar -xJ -C node.tmp --strip-components=1 && "
        f"rm -rf node && mv node.tmp node")
    node_bin = f"{BASE}/node/bin/node"
print("  " + out(f"{node_bin} -v"))

# ---------------------------------------------------------------- code
say("Uploading the app")
run(f"id -u {SERVICE} >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin {SERVICE}")
run(f"mkdir -p {BASE} && rm -rf {BASE}/app.new && mkdir {BASE}/app.new")
sftp.putfo(build_bundle(), f"{BASE}/bundle.tar.gz")
run(f"tar -xzf {BASE}/bundle.tar.gz -C {BASE}/app.new && rm -f {BASE}/bundle.tar.gz")

if first_deploy:
    local = read_local_env()
    keys = ["DB_HOST", "DB_PORT", "DB_INSTANCE", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_ENCRYPT", "DB_TRUST_CERT",
            "JWT_EXPIRES_IN", "APP_TZ", "TZ_OFFSET_MINUTES"]
    lines = ["# SmartClinic server (written by deploy.py; edit here, then: systemctl restart " + SERVICE + ")",
             f"PORT={port}", "HOST=127.0.0.1", f"CORS_ORIGIN=https://{args.domain},http://{args.domain}",
             f"JWT_SECRET={secrets.token_hex(32)}"]
    lines += [f"{k}={local[k]}" for k in keys if k in local]
    put_text(f"{BASE}/app.new/backend/.env", "\n".join(lines) + "\n", 0o600)
else:
    run(f"cp -a {APP}/backend/.env {BASE}/app.new/backend/.env")
run(f"chown -R {SERVICE}:{SERVICE} {BASE}/app.new && chmod 600 {BASE}/app.new/backend/.env")

say("Starting the service")
unit = f"""[Unit]
Description=SmartClinic ({args.domain})
After=network-online.target
Wants=network-online.target

[Service]
User={SERVICE}
WorkingDirectory={APP}/backend
Environment=NODE_ENV=production
ExecStart={node_bin} src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
put_text(f"/etc/systemd/system/{SERVICE}.service", unit)
run(f"systemctl stop {SERVICE} 2>/dev/null; rm -rf {BASE}/app.prev; "
    f"if [ -d {APP} ]; then mv {APP} {BASE}/app.prev; fi; mv {BASE}/app.new {APP}")
run(f"systemctl daemon-reload && systemctl enable --now {SERVICE} >/dev/null 2>&1 && systemctl restart {SERVICE}")

ok = False
for _ in range(15):
    time.sleep(1)
    if run(f"curl -fsS http://127.0.0.1:{port}/api/health", check=False)[0] == 0:
        ok = True
        break
if not ok:
    print(out(f"journalctl -u {SERVICE} -n 40 --no-pager"))
    sys.exit("\nThe app did not start (log above). The previous copy, if any, is in " + f"{BASE}/app.prev")
code = out(f"curl -s -o /dev/null -w '%{{http_code}}' -X POST -H 'Content-Type: application/json' "
           f"-d '{{\"username\":\"__deploy_check__\",\"password\":\"x\"}}' http://127.0.0.1:{port}/api/auth/login")
print(f"  App is up. Database check (login with a fake user): HTTP {code} "
      f"{'(OK - database reachable)' if code in ('400', '401') else '(unexpected - see: journalctl -u ' + SERVICE + ')'}")

# ---------------------------------------------------------------- take over the domain (--replace)
restore = []
stamp = time.strftime("%Y%m%d-%H%M%S")
if to_disable or own_foreign:
    backup = f"/root/nginx-backup-{stamp}.tar.gz"
    say(f"Backing up /etc/nginx to {backup}")
    run(f"tar -czf {backup} -C / etc/nginx")
    print("  " + out(f"ls -lh {backup}"))
    for f in to_disable:
        if f.startswith("/etc/nginx/sites-enabled/") and run(f"test -L {q(f)}", check=False)[0] == 0:
            restore.append(f"ln -s {q(enabled[f])} {q(f)}")
            run(f"rm {q(f)}")
        else:
            restore.append(f"mv {q(f)}.disabled-{stamp} {q(f)}")
            run(f"mv {q(f)} {q(f)}.disabled-{stamp}")
        print(f"  disabled {f}")
    for f in own_foreign:
        run(f"cp -a {q(f)} {q(f)}.old-{stamp}")
        print(f"  old {f} kept as {f}.old-{stamp}")


def restore_old_site():
    for cmd in restore:
        run(cmd, check=False)
    for f in own_foreign:
        run(f"cp -a {q(f)}.old-{stamp} {q(f)}", check=False)
    if restore or own_foreign:
        run("nginx -t && systemctl reload nginx", check=False)
        print("  The old site was put back.")


# ---------------------------------------------------------------- web server
say(f"Configuring {web} for {args.domain}")
proxy_hdrs = "proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        " \
             "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;"
if web == "nginx":
    if not has_nginx:
        run(f"{pkg} install -y nginx" if pkg != "apt" else "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx")
        run("systemctl enable --now nginx")
    debian = run("test -d /etc/nginx/sites-available", check=False)[0] == 0
    site = f"/etc/nginx/sites-available/{args.domain}" if debian else f"/etc/nginx/conf.d/{args.domain}.conf"
    existed = site not in own_foreign and run(f"test -f {site}", check=False)[0] == 0
    if existed:
        # keep the https block; only the upstream port and the upload limit can change
        run(f"cp -a {site} {site}.bak && sed -i -E 's#proxy_pass http://127\\.0\\.0\\.1:[0-9]+#proxy_pass http://127.0.0.1:{port}#' {site}")
        # lab reports / scans are uploaded up to 5 MB: this site's own limit must allow them
        run(f"sed -i -E 's#client_max_body_size [0-9]+[kKmM]?;#client_max_body_size 8m;#g' {site}")
    else:
        put_text(site, f"""{MARK}
server {{
    listen 80;
    listen [::]:80;
    server_name {args.domain};
    client_max_body_size 8m;   # lab reports / scans up to 5 MB

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        {proxy_hdrs}
    }}
}}
""")
        if debian:
            run(f"ln -sf {site} /etc/nginx/sites-enabled/{args.domain}")
    code_t, msg = run("nginx -t 2>&1", check=False)
    if code_t != 0:
        if existed:
            run(f"mv {site}.bak {site}")
        else:
            run(f"rm -f {site} /etc/nginx/sites-enabled/{args.domain}")
        restore_old_site()
        sys.exit(f"nginx config test failed, site rolled back:\n{msg}")
    run(f"systemctl reload nginx && rm -f {site}.bak")
else:
    debian = run("test -d /etc/apache2/sites-available", check=False)[0] == 0
    site = f"/etc/apache2/sites-available/{args.domain}.conf" if debian else f"/etc/httpd/conf.d/{args.domain}.conf"
    if run(f"test -f {site}", check=False)[0] != 0:
        put_text(site, f"""<VirtualHost *:80>
    ServerName {args.domain}
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:{port}/
    ProxyPassReverse / http://127.0.0.1:{port}/
</VirtualHost>
""")
    else:
        run(f"sed -i -E 's#http://127\\.0\\.0\\.1:[0-9]+/#http://127.0.0.1:{port}/#g' {site}")
    if debian:
        run(f"a2enmod -q proxy proxy_http >/dev/null && a2ensite -q {args.domain} >/dev/null")
    ctl = "apache2ctl" if debian else "apachectl"
    code_t, msg = run(f"{ctl} configtest 2>&1", check=False)
    if code_t != 0:
        if debian:
            run(f"a2dissite -q {args.domain} >/dev/null", check=False)
        run(f"rm -f {site}")
        sys.exit(f"Apache config test failed, site rolled back:\n{msg}")
    run("systemctl reload apache2" if debian else "systemctl reload httpd")

http_code = out(f"curl -s -o /dev/null -w '%{{http_code}}' -H 'Host: {args.domain}' http://127.0.0.1/api/health")
print(f"  http://{args.domain}/api/health via {web}: HTTP {http_code}")

# ---------------------------------------------------------------- HTTPS
# nginx: certbot only obtains the certificate ("certonly"); the https block is written into this
# domain's own site file. "certbot --nginx" would edit whichever site's server block it matches first,
# which on a shared server can be another subdomain's file.
live = f"/etc/letsencrypt/live/{args.domain}"
has_cert = run(f"test -f {live}/fullchain.pem", check=False)[0] == 0
if web == "nginx":
    if not has_cert and ask(f"\nGet a free HTTPS certificate from Let's Encrypt for {args.domain}?\n"
                            "(This accepts the Let's Encrypt Subscriber Agreement: https://letsencrypt.org/repository/)"):
        say("Getting the certificate")
        if run("command -v certbot", check=False)[0] != 0:
            run("DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx" if pkg == "apt"
                else f"{pkg} install -y certbot python3-certbot-nginx")
        run(f"certbot certonly --nginx -d {args.domain} --non-interactive --agree-tos --register-unsafely-without-email "
            f"--deploy-hook 'systemctl reload nginx'", check=False, show=True)
        has_cert = run(f"test -f {live}/fullchain.pem", check=False)[0] == 0
    if has_cert and run(f"grep -q 'listen 443' {site}", check=False)[0] != 0:
        say(f"Enabling https in {site}")
        opts = "\n    include /etc/letsencrypt/options-ssl-nginx.conf;" if run("test -f /etc/letsencrypt/options-ssl-nginx.conf", check=False)[0] == 0 else ""
        dh = "\n    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;" if run("test -f /etc/letsencrypt/ssl-dhparams.pem", check=False)[0] == 0 else ""
        run(f"cp -a {site} {site}.bak")
        put_text(site, f"""{MARK}
server {{
    listen 80;
    listen [::]:80;
    server_name {args.domain};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name {args.domain};
    ssl_certificate {live}/fullchain.pem;
    ssl_certificate_key {live}/privkey.pem;{opts}{dh}
    client_max_body_size 8m;   # lab reports / scans up to 5 MB

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        {proxy_hdrs}
    }}
}}
""")
        code_t, msg = run("nginx -t 2>&1", check=False)
        if code_t != 0:
            run(f"mv {site}.bak {site} && systemctl reload nginx", check=False)
            print(f"  nginx rejected the https config, kept http only:\n{msg}")
        else:
            run(f"systemctl reload nginx && rm -f {site}.bak")
            print(f"  https://{args.domain}/api/health: " + out(
                f"curl -s --max-time 10 --resolve {args.domain}:443:127.0.0.1 https://{args.domain}/api/health"))
elif has_cert:
    say("A Let's Encrypt certificate already exists for this domain")
elif ask(f"\nGet a free HTTPS certificate from Let's Encrypt for {args.domain}?\n"
         "(This accepts the Let's Encrypt Subscriber Agreement: https://letsencrypt.org/repository/)"):
    say("Getting the certificate")
    plugin = "nginx" if web == "nginx" else "apache"
    if run("command -v certbot", check=False)[0] != 0:
        if pkg == "apt":
            run(f"DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-{plugin}")
        else:
            run(f"{pkg} install -y certbot python3-certbot-{plugin}")
    c, _ = run(f"certbot --{plugin} -d {args.domain} --non-interactive --agree-tos "
               f"--register-unsafely-without-email --redirect", check=False, show=True)
    if c != 0:
        print("  certbot failed - the site still works over http. Check that ports 80/443 are open in the firewall.")

say("Done")
print(f"  Site:     https://{args.domain}  (http if no certificate)")
print(f"  Logs:     journalctl -u {SERVICE} -f")
print(f"  Restart:  systemctl restart {SERVICE}")
print(f"  Config:   {APP}/backend/.env")
ssh.close()
