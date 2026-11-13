#!/usr/bin/env python3
"""upload-smoke - the first time this pipeline speaks to R2.

A 20 MiB file in three parts, start to finish: seed the rows an upload needs,
sign in as the contractor, open the upload, PUT every part straight to R2,
record the ledger, complete, and read back what the database decided. It is
docs/upload-proof.md in miniature, and it exists so that signing, the
completion XML and the checksum path fail in two minutes rather than two
hours into a 50 GB run.

Python, and only the standard library, because the Node builds on this
machine are x86_64 and the machine is arm64. /usr/bin/python3 is universal.

    export SUPABASE_URL=https://<ref>.supabase.co
    export SUPABASE_ANON_KEY=<publishable / anon key>
    export SUPABASE_SERVICE_ROLE_KEY=<service role key>
    python3 scripts/upload_smoke.py

The service role key never leaves the machine this runs on. It seeds, and
nothing else: every call that matters to the proof goes through the
contractor's own token, because that is the thing being tested.
"""

import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

FILE_BYTES = 20 * 1024 * 1024          # 20 MiB -> 8 + 8 + 4
EXPECTED_PART_SIZE = 8 * 1024 * 1024   # what app.plan_part_size picks for this
SLUG = "mtm-smoke"

PRODUCER_EMAIL = os.environ.get("SMOKE_PRODUCER_EMAIL", "smoke-producer@moments-to-media.app")
CONTRACTOR_EMAIL = os.environ.get("SMOKE_CONTRACTOR_EMAIL", "smoke-contractor@moments-to-media.app")

_step = 0


def say(msg):
    global _step
    _step += 1
    print("\n[%02d] %s" % (_step, msg))


def detail(msg):
    for line in str(msg).splitlines():
        print("     " + line)


def die(what, extra=None):
    print("\n  FAILED: %s" % what, file=sys.stderr)
    if extra is not None:
        if not isinstance(extra, str):
            extra = json.dumps(extra, indent=2)
        print(extra, file=sys.stderr)
    sys.exit(1)


def need(name):
    v = (os.environ.get(name) or "").strip()
    if not v:
        print("\nMissing %s.\n" % name, file=sys.stderr)
        print("Set all three and re-run:", file=sys.stderr)
        print("  export SUPABASE_URL=https://<ref>.supabase.co", file=sys.stderr)
        print("  export SUPABASE_ANON_KEY=<publishable / anon key>", file=sys.stderr)
        print("  export SUPABASE_SERVICE_ROLE_KEY=<service role key>\n", file=sys.stderr)
        sys.exit(1)
    return v


URL_BASE = need("SUPABASE_URL").rstrip("/")
ANON = need("SUPABASE_ANON_KEY")
SERVICE = need("SUPABASE_SERVICE_ROLE_KEY")


# ------------------------------------------------------------------- http

def request(url, method="GET", headers=None, body=None, timeout=300):
    """Returns (status, headers, raw bytes). Never raises on an HTTP status."""
    data = body
    if isinstance(data, (dict, list)):
        data = json.dumps(data).encode()
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except urllib.error.URLError as e:
        die("could not reach %s" % url, str(e.reason))


def as_json(raw):
    if not raw:
        return None
    try:
        return json.loads(raw.decode())
    except Exception:
        return raw.decode(errors="replace")


SVC = {
    "apikey": SERVICE,
    "Authorization": "Bearer " + SERVICE,
    "content-type": "application/json",
}


def rest(path, method="GET", body=None, prefer=None):
    """PostgREST as the service role. Seeding only."""
    headers = dict(SVC)
    if prefer:
        headers["Prefer"] = prefer
    status, _, raw = request("%s/rest/v1/%s" % (URL_BASE, path), method, headers, body)
    parsed = as_json(raw)
    if status >= 300:
        die("%s %s -> %s" % (method, path, status), parsed)
    return parsed


def rpc_as_caller(token, name, args):
    """An RPC as the contractor. This is the path the real client takes."""
    headers = {"apikey": ANON, "Authorization": "Bearer " + token, "content-type": "application/json"}
    status, _, raw = request("%s/rest/v1/rpc/%s" % (URL_BASE, name), "POST", headers, args)
    parsed = as_json(raw)
    if status >= 300:
        die("rpc %s -> %s" % (name, status), parsed)
    return parsed


def call_function(token, name, body):
    headers = {"Authorization": "Bearer " + token, "content-type": "application/json"}
    status, _, raw = request("%s/functions/v1/%s" % (URL_BASE, name), "POST", headers, body)
    return status, as_json(raw)


# -------------------------------------------------------------------- auth

def ensure_user(email):
    status, _, raw = request("%s/auth/v1/admin/users?per_page=200" % URL_BASE, "GET", SVC)
    if status < 300:
        for u in (as_json(raw) or {}).get("users", []):
            if (u.get("email") or "").lower() == email.lower():
                return {"id": u["id"], "email": email, "password": None, "existing": True}

    # A fresh password per run, generated here and never written down. The app
    # itself is passwordless; this exists only so the script can get a session
    # without a mailbox.
    password = "smoke-" + str(uuid.uuid4())
    status, _, raw = request(
        "%s/auth/v1/admin/users" % URL_BASE, "POST", SVC,
        {"email": email, "password": password, "email_confirm": True},
    )
    parsed = as_json(raw)
    if status >= 300:
        die("could not create %s" % email, parsed)
    return {"id": parsed["id"], "email": email, "password": password, "existing": False}


def reset_password(user_id):
    password = "smoke-" + str(uuid.uuid4())
    status, _, raw = request(
        "%s/auth/v1/admin/users/%s" % (URL_BASE, user_id), "PUT", SVC,
        {"password": password, "email_confirm": True},
    )
    if status >= 300:
        die("could not set a password for the existing smoke user", as_json(raw))
    return password


def sign_in(email, password):
    headers = {"apikey": ANON, "content-type": "application/json"}
    status, _, raw = request(
        "%s/auth/v1/token?grant_type=password" % URL_BASE, "POST", headers,
        {"email": email, "password": password},
    )
    parsed = as_json(raw)
    if status >= 300:
        die("sign-in failed for %s" % email, parsed)
    return parsed["access_token"]


# --------------------------------------------------------------- checksums

def sha256(b):
    return hashlib.sha256(b).digest()


def b64(b):
    return base64.b64encode(b).decode()


def composite_checksum(parts):
    """The checksum S3 and R2 report for a multipart object: the digest of the
    concatenated part digests, with the part count suffixed. The client can
    compute it before the first byte moves, which is what lets the database
    refuse an upload that does not match what was declared."""
    joined = b"".join(sha256(p) for p in parts)
    return "%s-%d" % (b64(sha256(joined)), len(parts))


def slice_parts(buf, size):
    return [buf[i:i + size] for i in range(0, len(buf), size)]


# -------------------------------------------------------------------- main

def main():
    print("\nupload-smoke -> %s" % URL_BASE)

    say("Seeding the two users")
    producer = ensure_user(PRODUCER_EMAIL)
    contractor = ensure_user(CONTRACTOR_EMAIL)
    if contractor["existing"]:
        contractor["password"] = reset_password(contractor["id"])
    detail("producer   %s %s" % (producer["id"], "(existing)" if producer["existing"] else "(created)"))
    detail("contractor %s %s" % (contractor["id"], "(existing)" if contractor["existing"] else "(created)"))

    say("Seeding the organization, event and slot")
    found = rest("organizations?slug=eq.%s&select=*" % SLUG)
    if found:
        org = found[0]
    else:
        org = rest("organizations", "POST", {"name": "Moments to Media (smoke)", "slug": SLUG},
                   prefer="return=representation")[0]
    detail("org %s" % org["id"])

    for user, role in ((producer, "producer"), (contractor, "contractor")):
        existing = rest("memberships?org_id=eq.%s&user_id=eq.%s&select=user_id" % (org["id"], user["id"]))
        if not existing:
            rest("memberships", "POST", {"org_id": org["id"], "user_id": user["id"], "role": role})

    now = time.time()
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
    event = rest("events", "POST", {
        "org_id": org["id"],
        "producer_id": producer["id"],
        "title": "Smoke run %s" % iso(now),
        "starts_at": iso(now),
        "ends_at": iso(now + 4 * 3600),
        "time_zone": "America/New_York",
    }, prefer="return=representation")[0]
    detail("event %s" % event["id"])

    slot = rest("slots", "POST", {
        "org_id": org["id"],
        "event_id": event["id"],
        "role": "Videographer",
        "rate_type": "flat",
        "rate_amount_cents": 50000,
        "call_time": iso(now),
    }, prefer="return=representation")[0]
    detail("slot %s" % slot["id"])

    # checked_in, not confirmed: start_upload opens uploads at check-in and
    # keeps them open through the review loop.
    assignment = rest("assignments", "POST", {
        "org_id": org["id"], "slot_id": slot["id"],
        "user_id": contractor["id"], "status": "checked_in",
    }, prefer="return=representation")[0]
    detail("assignment %s (%s)" % (assignment["id"], assignment["status"]))

    say("Signing in as the contractor")
    token = sign_in(contractor["email"], contractor["password"])
    detail("got an access token")

    say("Building a %d MiB file of random bytes" % (FILE_BYTES // 1024 // 1024))
    file_bytes = os.urandom(FILE_BYTES)
    detail("sha256 of the whole file: %s" % b64(sha256(file_bytes)))

    say("upload-start")
    declared_parts = slice_parts(file_bytes, EXPECTED_PART_SIZE)
    declared = composite_checksum(declared_parts)
    detail("declaring %d parts, checksum %s" % (len(declared_parts), declared))

    status, plan = call_function(token, "upload-start", {
        "slot_id": slot["id"],
        "filename": "smoke-%d.mov" % int(now),
        "bytes": FILE_BYTES,
        "checksum": declared,
    })
    if status != 201:
        die("upload-start returned %s" % status, plan)

    detail("upload_id   %s" % plan["upload_id"])
    detail("storage_key %s" % plan["storage_key"])
    detail("part plan   %s x %s bytes" % (plan["part_count"], plan["part_size_bytes"]))
    detail("presigned   %d URLs" % len(plan["presigned"]))

    if plan["part_size_bytes"] != EXPECTED_PART_SIZE:
        die("the database chose a part size of %s, but the checksum was computed for %s"
            % (plan["part_size_bytes"], EXPECTED_PART_SIZE))

    parts = slice_parts(file_bytes, plan["part_size_bytes"])

    say("PUTting the parts straight to R2")
    header_accepted = None

    for p in plan["presigned"]:
        body = parts[p["part_number"] - 1]
        if len(body) != p["bytes"]:
            die("part %s is %d bytes, the plan says %s" % (p["part_number"], len(body), p["bytes"]))
        part_checksum = b64(sha256(body))

        # The multipart was opened with x-amz-checksum-algorithm: SHA256, so R2
        # wants a checksum per part. The URL is query-signed over the host
        # alone, so an extra header may or may not be accepted. Try it, fall
        # back, and say which worked -- that answer is the point of this run.
        st, hdrs, raw = request(p["url"], "PUT", {"x-amz-checksum-sha256": part_checksum}, body)
        if st >= 300:
            if header_accepted is None:
                detail("part %s with checksum header -> %s; retrying without it"
                       % (p["part_number"], st))
                detail("R2 said: %s" % raw.decode(errors="replace")[:200])
            header_accepted = False
            st, hdrs, raw = request(p["url"], "PUT", {}, body)
        elif header_accepted is None:
            header_accepted = True

        if st >= 300:
            die("part %s PUT -> %s" % (p["part_number"], st), raw.decode(errors="replace"))

        etag = hdrs.get("ETag") or hdrs.get("etag")
        if not etag:
            die("part %s landed but R2 returned no ETag" % p["part_number"])

        rpc_as_caller(token, "record_upload_part", {
            "p_upload": plan["upload_id"],
            "p_part_number": p["part_number"],
            "p_etag": etag,
            "p_checksum": hdrs.get("x-amz-checksum-sha256") or part_checksum,
        })
        detail("part %s/%s ok  etag %s" % (p["part_number"], plan["part_count"], etag))

    detail("per-part checksum header was %s"
           % ("accepted" if header_accepted else "rejected (fell back without it)"))

    say("upload_resume_plan")
    resume = rpc_as_caller(token, "upload_resume_plan", {"p_upload": plan["upload_id"]})
    detail("status %s, %s bytes received, %d missing"
           % (resume["status"], resume["bytes_received"], len(resume["missing"])))
    if resume["missing"]:
        die("parts are still outstanding after every PUT succeeded", resume["missing"])

    say("upload-complete")
    status, completed = call_function(token, "upload-complete", {"upload_id": plan["upload_id"]})
    if status != 200:
        die("upload-complete returned %s" % status, completed)
    detail(json.dumps(completed, indent=2))

    say("upload-complete again (rule 8: a retry is not an error)")
    status, again = call_function(token, "upload-complete", {"upload_id": plan["upload_id"]})
    if status != 200 or not (isinstance(again, dict) and again.get("already")):
        die("a repeated completion was not treated as already done", again)
    detail("second call returned already: true")

    say("The row, as the database sees it")
    row = rest("uploads?id=eq.%s&select=status,bytes,verified_bytes,checksum,verified_checksum,completed_at"
               % plan["upload_id"])[0]
    detail(json.dumps(row, indent=2))

    ok = (row["status"] == "completed"
          and str(row["verified_bytes"]) == str(row["bytes"])
          and row["verified_checksum"] == row["checksum"])

    print("\nPASS - 20 MiB landed in R2, verified against what was declared "
          "before the first byte moved.\n" if ok else
          "\nFAIL - the row completed but the verification columns disagree.\n")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
