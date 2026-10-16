"""One-off repair after the first deploy of abihomoeoclinic.thangaminfotech.com.

"certbot --nginx" installed this domain's certificate into another site's file (it picked the first
matching server block), so https for the domain reached that other site. This script:
  1. lists every file under /etc/nginx that differs from the backup taken before the deploy
  2. puts back the other site's file from that backup - only if every changed line is certbot's for this domain
  3. writes this domain's own https server block (in its own site file only)
  4. tests nginx (rolls everything back on failure), reloads, and checks the result
Output is also saved to deploy/last-fix.log.
"""
import difflib
import getpass
import os
import re
import shlex
import sys
import time

import paramiko

HOST, USER = "156.67.104.242", "root"
DOMAIN = "abihomoeoclinic.thangaminfotech.com"
NAME = "abihomoeoclinic"
BACKUP = "/root/nginx-backup-20261016-231845.tar.gz"   # taken by deploy.py before it changed anything
SITE = f"/etc/nginx/sites-available/{DOMAIN}"
MARK = f"# managed by deploy.py ({NAME})"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
q = shlex.quote


class Tee:
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


_log = open(os.path.join(ROOT, "deploy", "last-fix.log"), "w", encoding="utf-8")
sys.stdout, sys.stderr = Tee(sys.stdout, _log), Tee(sys.stderr, _log)
print(f"fix-ssl.py  ({time.strftime('%Y-%m-%d %H:%M:%S')})")


def say(msg):
    print(f"\n==> {msg}", flush=True)


def run(cmd, check=True):
    _, o, e = ssh.exec_command(f"bash -c {q(cmd)}")
    out, err = o.read().decode(errors="replace"), e.read().decode(errors="replace")
    code = o.channel.recv_exit_status()
    if check and code != 0:
        sys.exit(f"\nCommand failed ({code}): {cmd}\n{out}{err}")
    return code, out


def put_text(path, text, mode=0o644):
    with sftp.open(path, "w") as f:
        f.write(text)
    sftp.chmod(path, mode)


password = os.environ.get("SSH_PASSWORD") or getpass.getpass(f"SSH password for {USER}@{HOST}: ")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
say(f"Connecting to {USER}@{HOST}")
ssh.connect(HOST, username=USER, password=password, timeout=20, look_for_keys=False, allow_agent=False)
del password
sftp = ssh.open_sftp()

# ---------------------------------------------------------------- look (read-only)
say("Changes under /etc/nginx since the pre-deploy backup")
run(f"test -f {BACKUP}")
tmp = run("mktemp -d")[1].strip()
run(f"tar -xzf {BACKUP} -C {tmp}")
print(run(f"diff -rq --no-dereference {tmp}/etc/nginx /etc/nginx", check=False)[1].rstrip() or "  (none)")

ours = {SITE, f"/etc/nginx/sites-enabled/{DOMAIN}"}
changed = []
for line in run(f"diff -rq --no-dereference {tmp}/etc/nginx /etc/nginx", check=False)[1].splitlines():
    m = re.match(rf"Files {re.escape(tmp)}(/etc/nginx/\S+) and /etc/nginx/\S+ differ", line)
    if m and m.group(1) not in ours:
        changed.append(m.group(1))

CERTBOT_LINE = re.compile(r"^\s*$|managed by Certbot|" + re.escape(DOMAIN) +
                          r"|^\s*(server\s*\{|\}|listen\s[^;]*;|return\s+404;|return\s+30[18]\s+https://\$host\$request_uri;)\s*$")
CERT_LINE = re.compile(r"^\s*ssl_certificate(_key)?\s+/etc/letsencrypt/live/[^/\s]+/(fullchain|privkey)\.pem;\s*$")
restore_files = {}
for path in changed:
    if os.path.basename(path) == "abihomoeoclinic.conf":
        continue  # the old site for this same domain, disabled on purpose
    orig = run(f"cat {q(tmp + path)}")[1]
    cur = run(f"cat {q(path)}")[1]
    diff = [l for l in difflib.unified_diff(orig.splitlines(), cur.splitlines(), lineterm="", n=0)
            if l[:1] in "+-" and not l.startswith(("+++", "---"))]
    print(f"\n  {path} - lines changed since the backup:\n    " + "\n    ".join(diff))
    # certbot also removes the site's own certificate lines when it puts ours in their place
    ok = [CERTBOT_LINE.search(l[1:]) or (l[0] == "-" and CERT_LINE.search(l[1:])) for l in diff]
    if DOMAIN in orig or not all(ok):
        run(f"rm -rf {tmp}", check=False)
        sys.exit(f"\n{path} has changes that are not certbot's for {DOMAIN}. Not touching it. Nothing was changed.")
    restore_files[path] = orig

cert = f"/etc/letsencrypt/live/{DOMAIN}"
if run(f"test -f {cert}/fullchain.pem", check=False)[0] != 0:
    sys.exit(f"No certificate at {cert}. Nothing was changed.")
port = run(f"grep -E '^PORT=' /opt/{NAME}/app/backend/.env | cut -d= -f2")[1].strip()
print(f"\n  App port: {port}   Certificate: {cert}")
print("  Will put back: " + (", ".join(restore_files) or "(nothing)"))
print(f"  Will rewrite:  {SITE} (this domain only)")
if input("\nApply? [y/N] ").strip().lower() not in ("y", "yes"):
    sys.exit("Cancelled. Nothing was changed.")

# ---------------------------------------------------------------- apply
stamp = time.strftime("%Y%m%d-%H%M%S")
keep = f"/root/nginx-fix-{stamp}"
say(f"Saving current copies in {keep}")
run(f"mkdir -p {keep} && cp -a {SITE} {keep}/ && " + " && ".join(f"cp -a {q(p)} {keep}/" for p in restore_files) if restore_files
    else f"mkdir -p {keep} && cp -a {SITE} {keep}/")

for path, text in restore_files.items():
    put_text(path, text)
    print(f"  restored {path} from the pre-deploy backup")

opts = "\n    include /etc/letsencrypt/options-ssl-nginx.conf;" if run("test -f /etc/letsencrypt/options-ssl-nginx.conf", check=False)[0] == 0 else ""
dh = "\n    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;" if run("test -f /etc/letsencrypt/ssl-dhparams.pem", check=False)[0] == 0 else ""
put_text(SITE, f"""{MARK}
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name {DOMAIN};
    ssl_certificate {cert}/fullchain.pem;
    ssl_certificate_key {cert}/privkey.pem;{opts}{dh}
    client_max_body_size 2m;

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
}}
""")
run(f"ln -sf {SITE} /etc/nginx/sites-enabled/{DOMAIN}")

code, msg = run("nginx -t 2>&1", check=False)
if code != 0:
    run(f"cp -a {keep}/{os.path.basename(SITE)} {SITE}")
    for p in restore_files:
        run(f"cp -a {keep}/{q(os.path.basename(p))} {q(p)}")
    sys.exit(f"nginx config test failed - everything put back as it was:\n{msg}")
run("systemctl reload nginx")
run(f"rm -rf {tmp}", check=False)
print("  nginx reloaded")

# ---------------------------------------------------------------- check
say("Checking")
time.sleep(1)
print("  " + DOMAIN + " /api/health: " +
      run(f"curl -s --max-time 10 --resolve {DOMAIN}:443:127.0.0.1 https://{DOMAIN}/api/health", check=False)[1])
for path in restore_files:
    names = run(f"grep -hE '^[[:space:]]*server_name' {q(path)} | sed -E 's/^[[:space:]]*server_name//; s/;//g'", check=False)[1].split()
    for n in sorted(set(names)):
        if "*" in n or n == "_" or n.startswith("~"):
            continue
        c = run(f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 10 --resolve {n}:443:127.0.0.1 https://{n}/", check=False)[1]
        print(f"  {n} (other site, unchanged): https {c}")

say("Done")
print(f"  Previous copies: {keep}")
ssh.close()
