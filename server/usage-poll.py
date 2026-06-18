#!/usr/bin/env python3
# Studio Pixel — Claude usage poller.
# Reads the Claude desktop app's session cookie (decrypted via the macOS Keychain key),
# calls the same claude.ai usage API the app's Settings>Usage panel uses (past Cloudflare
# via curl_cffi Chrome impersonation), and POSTs the real % limits to the dashboard backend.
#
#   python3 usage-poll.py        (started automatically by start-all.mjs)
# Needs: curl_cffi  ->  python3 -m pip install curl_cffi
# Everything is the user's own account, read locally. Nothing leaves the machine except the
# normal claude.ai API call the app already makes.

import sqlite3, os, shutil, tempfile, hashlib, subprocess, json, time, urllib.request

STUDIO = os.environ.get("STUDIO_URL", "http://localhost:8787")
COOKIES = os.path.expanduser("~/Library/Application Support/Claude/Cookies")
IVHEX = "20" * 16
INTERVAL = 60

# The macOS "Claude Safe Storage" Keychain key (used to decrypt the app's cookies).
# We do NOT call `security` at runtime — from a background process it pops a blocking GUI prompt.
# Default is read once; override with env CLAUDE_SAFE_KEY if your Keychain key ever changes:
#   security find-generic-password -w -s "Claude Safe Storage" -a "Claude Key"
def keychain_key():
    k = os.environ.get("CLAUDE_SAFE_KEY")
    if k:
        return k
    # local-only secret (gitignored) so the key NEVER ships to GitHub
    try:
        p = os.path.join(os.path.dirname(__file__), "secret.local.json")
        return json.load(open(p))["CLAUDE_SAFE_KEY"]
    except Exception:
        raise SystemExit('[usage-poll] no key. Set env CLAUDE_SAFE_KEY or create server/secret.local.json '
                         '{"CLAUDE_SAFE_KEY":"..."}  — get it: '
                         'security find-generic-password -w -s "Claude Safe Storage" -a "Claude Key"')

def derive(pw):
    return hashlib.pbkdf2_hmac("sha1", pw.encode(), b"saltysalt", 1003, 16).hex()

def decrypt_cookies(keyhex):
    tmp = tempfile.mktemp(); shutil.copy(COOKIES, tmp)
    con = sqlite3.connect(tmp); cur = con.cursor()
    want = ["sessionKey", "lastActiveOrg", "cf_clearance", "__cf_bm", "__ssid", "anthropic-device-id"]
    out = {}
    for n in want:
        cur.execute("select encrypted_value from cookies where host_key like '%claude.ai%' and name=?", (n,))
        r = cur.fetchone()
        if not r:
            continue
        b = r[0]
        if b[:3] in (b"v10", b"v11"):
            b = b[3:]
        p = subprocess.run(["openssl", "enc", "-d", "-aes-128-cbc", "-K", keyhex, "-iv", IVHEX, "-nopad"],
                           input=b, capture_output=True).stdout
        if p and p[-1] <= 16:
            p = p[:-p[-1]]
        out[n] = p[32:].decode("utf-8", "replace")  # strip 32-byte domain-hash prefix
    con.close()
    try: os.remove(tmp)
    except Exception: pass
    return out

def post(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(STUDIO + "/api/event", data=data, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass

def main():
    try:
        from curl_cffi import requests
    except ImportError:
        print("[usage-poll] curl_cffi not installed — run: python3 -m pip install curl_cffi. Sleeping.")
        time.sleep(600); return
    keyhex = derive(keychain_key())
    print("[usage-poll] started")
    while True:
        try:
            ck = decrypt_cookies(keyhex)
            org = ck.get("lastActiveOrg")
            if org and ck.get("sessionKey"):
                r = requests.get(f"https://claude.ai/api/organizations/{org}/usage",
                                 cookies=ck, impersonate="chrome", timeout=15)
                if r.status_code == 200 and "Just a moment" not in r.text:
                    d = r.json()
                    post({"kind": "limits", "limits": d})
                else:
                    print(f"[usage-poll] http {r.status_code} (cf challenge? open the Claude app to refresh)")
        except Exception as e:
            print("[usage-poll] err", str(e)[:120])
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
