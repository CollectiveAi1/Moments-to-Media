#!/usr/bin/env python3
"""upload_large.py - the 50 GB proof client (docs/upload-proof.md, step 4).

scripts/upload_smoke.py proved the pipeline at 20 MiB with the whole file in
memory and one batch of signed URLs. Nothing about that run exercised the
things a 50 GB upload actually has to survive: reading from disk instead of
RAM, outliving a 15-minute URL, being killed and resumed, and losing the
network mid-part. This client does.

What it is built around:

  * The file is never held in memory. One pass hashes it, a second pass
    streams it part by part, and the download check streams too, so the disk
    only ever holds the source.
  * The SERVER decides what is still missing. Every batch begins with
    upload_resume_plan, so a part the client thinks it sent but the ledger
    never recorded is simply sent again, and a part the ledger has is never
    overwritten. Resuming after a kill is the same code path as the normal
    one, which is the only way to be sure it works.
  * Part checksums are computed once and kept in the state file. R2 verifies
    each part against the checksum signed into its URL, so a corrupt part
    fails on arrival rather than at the end of 50 GB.

    export SUPABASE_URL=https://<ref>.supabase.co
    export SUPABASE_ANON_KEY=<publishable / anon key>
    export SUPABASE_SERVICE_ROLE_KEY=<service role key>

    python3 scripts/upload_large.py generate /tmp/proof.bin --bytes 50G
    python3 scripts/upload_large.py run      /tmp/proof.bin --limit 20
    python3 scripts/upload_large.py verify   /tmp/proof.bin     # needs R2_*
    python3 scripts/upload_large.py status   /tmp/proof.bin

`run` is safe to kill and re-run at any point; that is the point of it.
"""

import argparse
import datetime
import hashlib
import hmac
import http.client
import json
import os
import random
import socket
import ssl
import sys
import time
import urllib.parse
import urllib.request

# The proven pieces - auth, seeding, PostgREST and the CRC-64/NVME
# implementation - live in the smoke script and are not duplicated here. The
# import requires the three Supabase variables, which this needs anyway.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import upload_smoke as smoke  # noqa: E402

CRC64_MASK = 0xFFFFFFFFFFFFFFFF
assert CRC64_MASK == smoke._CRC64_MASK, "the two CRC implementations disagree"

# ------------------------------------------------------------ crc, faster
#
# The smoke script's CRC walks one byte at a time, which is fine for 20 MiB
# and is ~50 minutes of pure Python for 50 GB. This is the same algorithm
# slice-by-eight: eight bytes are folded in per iteration through eight
# tables. It is kept deliberately separate from smoke's version rather than
# replacing it, because having two independent implementations that must agree
# -- checked in `selftest` against each other AND against the published vector
# -- is worth more than the few lines it costs.
#
# This is a harness limitation, not a design one. The contractor app computes
# this checksum in a native module where it runs at memory speed; nothing about
# CRC-64/NVME is inherently slow.

_T0 = smoke._CRC64_TABLE
_TABLES = [_T0]
for _ in range(7):
    _prev = _TABLES[-1]
    _TABLES.append([(v >> 8) ^ _T0[v & 0xFF] for v in _prev])
_T1, _T2, _T3, _T4, _T5, _T6, _T7 = _TABLES[1:]


def crc64(data, crc=CRC64_MASK):
    """Running CRC-64/NVME, not finalised. Pass the result back in to continue."""
    n = len(data)
    limit = n - (n % 8)
    i = 0
    frm = int.from_bytes
    t0, t1, t2, t3 = _T0, _T1, _T2, _T3
    t4, t5, t6, t7 = _T4, _T5, _T6, _T7
    while i < limit:
        crc ^= frm(data[i:i + 8], "little")
        crc = (t7[crc & 0xFF] ^ t6[(crc >> 8) & 0xFF] ^ t5[(crc >> 16) & 0xFF]
               ^ t4[(crc >> 24) & 0xFF] ^ t3[(crc >> 32) & 0xFF]
               ^ t2[(crc >> 40) & 0xFF] ^ t1[(crc >> 48) & 0xFF] ^ t0[crc >> 56])
        i += 8
    for b in data[i:]:
        crc = t0[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc & CRC64_MASK


def crc64_b64(crc):
    """Finalise a running CRC into the base64 form R2 expects."""
    return smoke.b64((crc ^ CRC64_MASK).to_bytes(8, "big"))


# ------------------------------------------------- combining part checksums
#
# The whole-file checksum is the one declared to R2, and the per-part ones are
# what R2 checks each part against. Computing both directly means folding every
# byte into a CRC twice, which at pure-Python speed is about forty minutes on a
# 50 GB file. It is not necessary: a CRC over a concatenation can be derived
# from the parts' CRCs and their lengths, because the CRC of a message is a
# linear function over GF(2). This is zlib's crc32_combine at 64 bits.
#
# The saving is real but the risk is a wrong declaration discovered only after
# 50 GB has been uploaded, so `selftest` checks the combined value against the
# directly computed one over randomly split data before any run starts.

_GF2_DIM = 64


def _gf2_times(mat, vec):
    total = 0
    index = 0
    while vec:
        if vec & 1:
            total ^= mat[index]
        vec >>= 1
        index += 1
    return total


def _gf2_square(mat):
    return [_gf2_times(mat, mat[n]) for n in range(_GF2_DIM)]


def crc64_combine(crc1, crc2, len2):
    """The finalised CRC of a + b, from the finalised CRCs of each and len(b)."""
    if len2 <= 0:
        return crc1

    odd = [0] * _GF2_DIM
    odd[0] = smoke._CRC64_POLY          # the reflected polynomial
    row = 1
    for n in range(1, _GF2_DIM):
        odd[n] = row
        row <<= 1

    even = _gf2_square(odd)
    odd = _gf2_square(even)

    while True:
        even = _gf2_square(odd)
        if len2 & 1:
            crc1 = _gf2_times(even, crc1)
        len2 >>= 1
        if len2 == 0:
            break
        odd = _gf2_square(even)
        if len2 & 1:
            crc1 = _gf2_times(odd, crc1)
        len2 >>= 1
        if len2 == 0:
            break

    return (crc1 ^ crc2) & CRC64_MASK

MIN_PART_BYTES = 5 * 1024 * 1024
MAX_PART_BYTES = 5 * 1024 * 1024 * 1024
MAX_PARTS = 10_000
DEFAULT_PART_BYTES = 8 * 1024 * 1024

READ_CHUNK = 1024 * 1024          # what we read from disk and push at once
BATCH = 100                       # parts signed per upload-presign call
URL_LIFETIME = 900                # must match DEFAULT_PRESIGN_SECONDS
RESIGN_AFTER = 780                # re-sign a batch before it can expire mid-part
MAX_ATTEMPTS = 6

SLUG = "mtm-proof"


# ------------------------------------------------------------------ output

def log(msg=""):
    print(msg, flush=True)


def die(what, extra=None):
    smoke.die(what, extra)


def human(n):
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(n) < 1024 or unit == "TiB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0


def parse_size(text):
    text = str(text).strip().upper()
    mult = 1
    for suffix, factor in (("K", 1024), ("M", 1024 ** 2), ("G", 1024 ** 3), ("T", 1024 ** 4)):
        if text.endswith(suffix) or text.endswith(suffix + "B") or text.endswith(suffix + "IB"):
            mult = factor
            text = text.rstrip("B").rstrip("I").rstrip(suffix)
            break
    return int(float(text) * mult)


# ------------------------------------------------------------- part plan

def plan_part_bytes(total):
    """Mirrors app.plan_part_size and packages/shared planPartBytes. If this
    and the database ever disagree the run stops rather than uploading a file
    cut the wrong way; see the check after upload-start."""
    if total <= 0:
        die("an upload needs a positive size, got %s" % total)
    size = DEFAULT_PART_BYTES
    while -(-total // size) > MAX_PARTS:
        size *= 2
        if size > MAX_PART_BYTES:
            die("%d bytes cannot be split into %d parts" % (total, MAX_PARTS))
    return size


def part_ranges(total, part_size):
    offset = 0
    number = 1
    while offset < total:
        length = min(part_size, total - offset)
        yield number, offset, length
        offset += length
        number += 1


# ------------------------------------------------------------- state file

def state_path(path):
    return path + ".mtm-upload.json"


def load_state(path):
    try:
        with open(state_path(path), "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except ValueError as e:
        die("the state file is corrupt: %s" % state_path(path), str(e))


def save_state(path, state):
    """Atomic: a kill during a write must not destroy a resumable upload."""
    tmp = state_path(path) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, state_path(path))


# --------------------------------------------------------------- throttle

class Throttle:
    """A token bucket over the bytes actually written to the socket. The point
    is not politeness: a 50 GB upload that finishes in minutes never has a URL
    expire under it, so without this the proof cannot show the re-sign path."""

    def __init__(self, bytes_per_second):
        self.rate = bytes_per_second
        self.allowance = float(bytes_per_second or 0)
        self.last = time.monotonic()

    def consume(self, n):
        if not self.rate:
            return
        while n > 0:
            now = time.monotonic()
            self.allowance = min(self.rate, self.allowance + (now - self.last) * self.rate)
            self.last = now
            if self.allowance >= 1:
                take = int(min(n, self.allowance))
                self.allowance -= take
                n -= take
            if n > 0:
                time.sleep(min(0.1, max(0.001, (1.0 - self.allowance) / self.rate)))


# ------------------------------------------------------------- pass one

class Hasher:
    """Accumulates everything the upload has to declare, in one pass over the
    bytes, whether they come off disk or are being generated.

    The whole-file CRC and the per-part CRCs are computed together rather than
    separately: the running whole-file value is carried straight through the
    part boundaries, so each byte is folded into the CRC twice rather than
    four times. For 50 GB in pure Python that difference is about half an hour.
    """

    def __init__(self, part_size):
        self.part_size = part_size
        self.sha = hashlib.sha256()
        self.part = CRC64_MASK
        self.part_number = 1
        self.part_filled = 0
        self.checksums = {}
        self.whole = None             # built up by combining finished parts
        self.total = 0

    def update(self, buf):
        self.sha.update(buf)
        pos = 0
        size = len(buf)
        while pos < size:
            room = self.part_size - self.part_filled
            left = size - pos
            take = left if left <= room else room
            # No copy in the common case, where the whole buffer fits the part.
            chunk = buf if (pos == 0 and take == size) else buf[pos:pos + take]
            self.part = crc64(chunk, self.part)
            self.part_filled += take
            self.total += take
            pos += take
            if self.part_filled == self.part_size:
                self._close_part()

    def _close_part(self):
        final = self.part ^ CRC64_MASK
        self.checksums[str(self.part_number)] = smoke.b64(final.to_bytes(8, "big"))
        self.whole = final if self.whole is None else crc64_combine(
            self.whole, final, self.part_filled)
        self.part_number += 1
        self.part = CRC64_MASK
        self.part_filled = 0

    def finish(self):
        if self.part_filled:          # the ragged last part
            self._close_part()
        if self.whole is None:
            die("nothing was hashed")
        return {
            "bytes": self.total,
            "sha256": smoke.b64(self.sha.digest()),
            "crc64nvme": smoke.b64(self.whole.to_bytes(8, "big")),
            "part_size": self.part_size,
            "part_checksums": self.checksums,
        }


def hash_file(path, part_size):
    """The declaration, computed before the first byte moves. That ordering is
    the property the whole design rests on, so the cost of reading 50 GB an
    extra time is the price of it -- unless `generate` already did this pass
    while writing the file, in which case there is no extra read at all."""
    smoke.check_crc64_implementation()

    total = os.path.getsize(path)
    hasher = Hasher(part_size)
    started = time.monotonic()
    nudge = 0

    with open(path, "rb") as f:
        while True:
            buf = f.read(READ_CHUNK)
            if not buf:
                break
            hasher.update(buf)
            nudge += len(buf)
            if nudge >= 512 * 1024 * 1024:
                nudge = 0
                rate = hasher.total / max(0.001, time.monotonic() - started)
                left = (total - hasher.total) / rate if rate else 0
                log("     hashed %s / %s  (%s/s, ~%s left)"
                    % (human(hasher.total), human(total), human(rate),
                       time.strftime("%H:%M:%S", time.gmtime(left))))

    if hasher.total != total:
        die("read %d bytes from a %d byte file" % (hasher.total, total))
    return hasher.finish()


# ------------------------------------------------------- streaming PUT

def put_part(url, checksum, path, offset, length, throttle):
    """Streams one part straight to R2 from disk. Returns (status, headers,
    body). Never reads the part into memory, and never retries internally -
    the caller decides, because a 403 means re-sign and a socket error means
    try again."""
    parts = urllib.parse.urlsplit(url)
    target = parts.path + ("?" + parts.query if parts.query else "")
    conn = http.client.HTTPSConnection(
        parts.hostname, parts.port or 443, timeout=120, context=ssl.create_default_context()
    )
    try:
        conn.putrequest("PUT", target, skip_accept_encoding=True)
        conn.putheader("Content-Length", str(length))
        # Exactly the value the server signed. Anything else is
        # SignatureDoesNotMatch.
        conn.putheader("x-amz-checksum-crc64nvme", checksum)
        conn.endheaders()

        with open(path, "rb") as f:
            f.seek(offset)
            remaining = length
            while remaining:
                buf = f.read(min(READ_CHUNK, remaining))
                if not buf:
                    raise IOError("short read at offset %d" % (offset + length - remaining))
                throttle.consume(len(buf))
                conn.send(buf)
                remaining -= len(buf)

        res = conn.getresponse()
        return res.status, dict(res.getheaders()), res.read()
    finally:
        conn.close()


# --------------------------------------------------- SigV4 for the read-back

def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def presign_get(account, bucket, key, access_key, secret, expires=3600,
                region="auto", host=None, stamp=None):
    """A presigned GET, so the read-back streams without the credentials ever
    going near a header we log. Operator-side only: the app never holds these.

    `region`, `host` and `stamp` exist so the signer can be checked against
    AWS's published presigned-URL example rather than trusted. A wrong signer
    here would only announce itself after 50 GB had already been uploaded."""
    if host is None:
        host = "%s.r2.cloudflarestorage.com" % account
    if stamp is None:
        stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    datestamp = stamp[:8]
    scope = "%s/%s/s3/aws4_request" % (datestamp, region)
    canonical_uri = "/" + urllib.parse.quote(bucket) + "/" + urllib.parse.quote(key)
    if not bucket:
        canonical_uri = "/" + urllib.parse.quote(key)

    query = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": "%s/%s" % (access_key, scope),
        "X-Amz-Date": stamp,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": "host",
    }
    canonical_query = "&".join(
        "%s=%s" % (urllib.parse.quote(k, safe=""), urllib.parse.quote(query[k], safe=""))
        for k in sorted(query)
    )
    canonical_request = "\n".join(
        ["GET", canonical_uri, canonical_query, "host:%s\n" % host, "host", "UNSIGNED-PAYLOAD"]
    )
    to_sign = "\n".join([
        "AWS4-HMAC-SHA256", stamp, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    k_date = _sign(("AWS4" + secret).encode(), datestamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, "s3")
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, to_sign.encode(), hashlib.sha256).hexdigest()

    return "https://%s%s?%s&X-Amz-Signature=%s" % (host, canonical_uri, canonical_query, signature)


# ------------------------------------------------------------- commands

def cmd_generate(args):
    """Writes the file and computes the declaration in the same pass, so a
    proof run never reads 50 GB twice."""
    total = parse_size(args.bytes)
    if os.path.exists(args.path) and not args.force:
        die("%s already exists; pass --force to overwrite it" % args.path)

    smoke.check_crc64_implementation()
    part_size = plan_part_bytes(total)
    log("\nWriting %s to %s" % (human(total), args.path))
    log("  %d parts of %s, hashed as it is written" % (-(-total // part_size), human(part_size)))

    rng = random.Random(args.seed)
    hasher = Hasher(part_size)
    started = time.monotonic()
    nudge = 0

    with open(args.path, "wb") as f:
        while hasher.total < total:
            n = min(READ_CHUNK * 4, total - hasher.total)
            buf = rng.randbytes(n)
            f.write(buf)
            hasher.update(buf)
            nudge += n
            if nudge >= 512 * 1024 * 1024:
                nudge = 0
                rate = hasher.total / max(0.001, time.monotonic() - started)
                left = (total - hasher.total) / rate if rate else 0
                log("     %s / %s  (%s/s, ~%s left)"
                    % (human(hasher.total), human(total), human(rate),
                       time.strftime("%H:%M:%S", time.gmtime(left))))
        f.flush()
        os.fsync(f.fileno())

    plan = hasher.finish()
    plan["file"] = os.path.abspath(args.path)
    save_state(args.path, plan)
    log("\n  wrote      %s in %s" % (human(plan["bytes"]),
                                      time.strftime("%H:%M:%S",
                                                    time.gmtime(time.monotonic() - started))))
    log("  sha256     %s" % plan["sha256"])
    log("  crc64nvme  %s   <- what will be declared to R2" % plan["crc64nvme"])
    log("\n  The plan is written; `run` will not need to read the file again.")


def ensure_plan(path, state):
    """The hashing pass, kept in the state file. Re-done only if the file
    itself has changed underneath it."""
    size = os.path.getsize(path)
    if state and state.get("bytes") == size and state.get("part_checksums"):
        return state

    part_size = plan_part_bytes(size)
    count = -(-size // part_size)
    log("\n[plan] hashing %s in %d parts of %s" % (human(size), count, human(part_size)))
    log("       one pass for the SHA-256, the full-object CRC-64 and every part's CRC-64")
    fresh = hash_file(path, part_size)
    fresh["file"] = os.path.abspath(path)
    if state:
        for carry in ("upload_id", "storage_key", "slot_id", "contractor_email"):
            if state.get(carry):
                fresh[carry] = state[carry]
    save_state(path, fresh)
    log("       sha256     %s" % fresh["sha256"])
    log("       crc64nvme  %s   <- declared to R2" % fresh["crc64nvme"])
    return fresh


def seed(state):
    """The same rows the smoke test seeds, in their own organization so a
    proof run never touches smoke data."""
    log("\n[seed] producer, contractor, org, event, slot, assignment")
    producer = smoke.ensure_user(os.environ.get("PROOF_PRODUCER_EMAIL",
                                                "proof-producer@moments-to-media.app"))
    contractor = smoke.ensure_user(os.environ.get("PROOF_CONTRACTOR_EMAIL",
                                                  "proof-contractor@moments-to-media.app"))
    if contractor["existing"]:
        contractor["password"] = smoke.reset_password(contractor["id"])

    found = smoke.rest("organizations?slug=eq.%s&select=*" % SLUG)
    org = found[0] if found else smoke.rest(
        "organizations", "POST", {"name": "Moments to Media (50 GB proof)", "slug": SLUG},
        prefer="return=representation")[0]

    for user, role in ((producer, "producer"), (contractor, "contractor")):
        if not smoke.rest("memberships?org_id=eq.%s&user_id=eq.%s&select=user_id"
                          % (org["id"], user["id"])):
            smoke.rest("memberships", "POST",
                       {"org_id": org["id"], "user_id": user["id"], "role": role})

    now = time.time()
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
    event = smoke.rest("events", "POST", {
        "org_id": org["id"], "producer_id": producer["id"],
        "title": "50 GB proof %s" % iso(now),
        "starts_at": iso(now), "ends_at": iso(now + 12 * 3600),
        "time_zone": "America/New_York",
    }, prefer="return=representation")[0]

    slot = smoke.rest("slots", "POST", {
        "org_id": org["id"], "event_id": event["id"], "role": "Videographer",
        "rate_type": "flat", "rate_amount_cents": 50000, "call_time": iso(now),
    }, prefer="return=representation")[0]

    smoke.rest("assignments", "POST", {
        "org_id": org["id"], "slot_id": slot["id"],
        "user_id": contractor["id"], "status": "checked_in",
    }, prefer="return=representation")

    log("       slot %s" % slot["id"])
    return slot["id"], contractor


def contractor_token():
    email = os.environ.get("PROOF_CONTRACTOR_EMAIL", "proof-contractor@moments-to-media.app")
    user = smoke.ensure_user(email)
    password = smoke.reset_password(user["id"])
    return smoke.sign_in(email, password)


def checksums_for(state, numbers):
    return [{"part_number": n, "checksum": state["part_checksums"][str(n)]} for n in numbers]


def cmd_run(args):
    path = args.path
    if not os.path.exists(path):
        die("no such file: %s" % path)

    state = ensure_plan(path, load_state(path))
    token = None

    if not state.get("upload_id"):
        slot_id = args.slot_id or state.get("slot_id")
        if not slot_id:
            slot_id, _ = seed(state)
            state["slot_id"] = slot_id
            save_state(path, state)
        token = contractor_token()

        first = sorted(int(n) for n in state["part_checksums"])[:BATCH]
        log("\n[start] upload-start, declaring %s in %d parts"
            % (human(state["bytes"]), len(state["part_checksums"])))
        status, plan = smoke.call_function(token, "upload-start", {
            "slot_id": slot_id,
            "filename": os.path.basename(path),
            "bytes": state["bytes"],
            "checksum": state["crc64nvme"],
            "part_checksums": checksums_for(state, first),
            "presign_count": BATCH,
        })
        if status != 201:
            die("upload-start returned %s" % status, plan)

        if plan["part_size_bytes"] != state["part_size"]:
            die("the database planned %d-byte parts, the file was hashed at %d"
                % (plan["part_size_bytes"], state["part_size"]))
        if plan["checksum"] != state["crc64nvme"]:
            die("the database recorded a different checksum than was declared")

        state["upload_id"] = plan["upload_id"]
        state["storage_key"] = plan["storage_key"]
        save_state(path, state)
        log("        upload_id   %s" % plan["upload_id"])
        log("        storage_key %s" % plan["storage_key"])
    else:
        log("\n[resume] upload %s" % state["upload_id"])

    # The URLs upload-start just handed back are deliberately dropped. Every
    # batch below, including the first, is signed by upload-presign after
    # asking upload_resume_plan what is still missing. That costs one wasted
    # round of signing and buys something worth more: the resume path is the
    # only path, so it is exercised 64 times in a 50 GB run rather than only
    # when something has already gone wrong.

    if token is None:
        token = contractor_token()

    throttle = Throttle(int(args.limit * 1024 * 1024) if args.limit else 0)
    part_size = state["part_size"]
    total_parts = len(state["part_checksums"])
    started = time.monotonic()
    sent_bytes = 0
    sent_parts = 0
    resigns = 0
    retries = 0

    while True:
        resume = smoke.rpc_as_caller(token, "upload_resume_plan",
                                     {"p_upload": state["upload_id"]})
        if resume["status"] == "completed":
            log("\n[done] the upload is already complete")
            break
        if resume["status"] != "in_progress":
            die("upload is %s, so it cannot be continued" % resume["status"])

        missing = resume["missing"]
        if not missing:
            log("\n[complete] every part has landed; assembling")
            status, done = smoke.call_function(token, "upload-complete",
                                               {"upload_id": state["upload_id"]})
            if status != 200:
                die("upload-complete returned %s" % status, done)
            log(json.dumps(done, indent=2))
            if done.get("checksum") != state["crc64nvme"]:
                die("R2 reported %s, the client declared %s"
                    % (done.get("checksum"), state["crc64nvme"]))
            state["completed"] = done
            save_state(path, state)
            break

        batch = [p["part_number"] for p in missing[:BATCH]]
        log("\n[batch] %d of %d parts outstanding; signing %d"
            % (len(missing), total_parts, len(batch)))

        status, signed = smoke.call_function(token, "upload-presign", {
            "upload_id": state["upload_id"],
            "part_numbers": batch,
            "part_checksums": checksums_for(state, batch),
            "count": len(batch),
        })
        if status != 200:
            die("upload-presign returned %s" % status, signed)
        signed_at = time.monotonic()
        urls = {p["part_number"]: p for p in signed["presigned"]}

        if args.force_expiry and resigns == 0 and sent_parts == 0:
            wait = URL_LIFETIME + 15
            log("        --force-expiry: waiting %ds so this batch expires before use" % wait)
            time.sleep(wait)

        for number in batch:
            entry = urls.get(number)
            if entry is None:
                continue

            # Re-sign rather than discover the expiry halfway through a part.
            if time.monotonic() - signed_at > RESIGN_AFTER:
                log("        batch is %ds old; re-signing the rest"
                    % int(time.monotonic() - signed_at))
                resigns += 1
                break

            offset = (number - 1) * part_size
            length = min(part_size, state["bytes"] - offset)
            if length != entry["bytes"]:
                die("part %d is %d bytes here and %d in the plan"
                    % (number, length, entry["bytes"]))

            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    code, headers, body = put_part(
                        entry["url"], entry["checksum"], path, offset, length, throttle)
                except (socket.error, OSError, http.client.HTTPException) as e:
                    if attempt == MAX_ATTEMPTS:
                        die("part %d failed after %d attempts" % (number, attempt), str(e))
                    retries += 1
                    wait = min(30, 2 ** attempt)
                    log("        part %d: %s; retrying in %ds" % (number, e, wait))
                    time.sleep(wait)
                    continue

                if code == 403:
                    log("        part %d: URL expired; re-signing this batch" % number)
                    resigns += 1
                    entry = None
                    break
                if code >= 300:
                    if attempt == MAX_ATTEMPTS:
                        die("part %d PUT -> %s" % (number, code),
                            body.decode(errors="replace"))
                    retries += 1
                    wait = min(30, 2 ** attempt)
                    log("        part %d -> %s; retrying in %ds" % (number, code, wait))
                    time.sleep(wait)
                    continue

                etag = headers.get("ETag") or headers.get("etag")
                if not etag:
                    die("part %d landed but R2 returned no ETag" % number)
                echoed = headers.get("x-amz-checksum-crc64nvme")
                if echoed and echoed != entry["checksum"]:
                    die("part %d: R2 stored %s, not %s" % (number, echoed, entry["checksum"]))

                smoke.rpc_as_caller(token, "record_upload_part", {
                    "p_upload": state["upload_id"],
                    "p_part_number": number,
                    "p_etag": etag,
                    "p_checksum": entry["checksum"],
                })
                sent_bytes += length
                sent_parts += 1
                break
            else:
                die("part %d exhausted its attempts" % number)

            if entry is None:      # expired mid-batch; go round for fresh URLs
                break

            if sent_parts % 10 == 0 or sent_parts == len(missing):
                elapsed = max(0.001, time.monotonic() - started)
                rate = sent_bytes / elapsed
                left = state["bytes"] - (resume["bytes_received"] + sent_bytes)
                eta = left / rate if rate else 0
                log("        %d parts, %s sent, %s/s, ~%s left (%s)"
                    % (sent_parts, human(sent_bytes), human(rate), human(left),
                       time.strftime("%H:%M:%S", time.gmtime(eta))))

    elapsed = time.monotonic() - started
    log("\n[summary]")
    log("  parts sent this run   %d" % sent_parts)
    log("  bytes sent this run   %s" % human(sent_bytes))
    log("  re-signs              %d" % resigns)
    log("  retries               %d" % retries)
    log("  wall clock            %s" % time.strftime("%H:%M:%S", time.gmtime(elapsed)))
    if state.get("completed"):
        log("\n  Completed. Now run:  python3 %s verify %s" % (sys.argv[0], path))


def cmd_verify(args):
    state = load_state(args.path)
    if not state or not state.get("storage_key"):
        die("no completed upload recorded for %s" % args.path)

    missing = [n for n in ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID",
                           "R2_SECRET_ACCESS_KEY") if not os.environ.get(n)]
    if missing:
        die("verify reads the object back from R2 directly and needs: %s"
            % ", ".join(missing))

    url = presign_get(
        os.environ["R2_ACCOUNT_ID"], os.environ["R2_BUCKET"], state["storage_key"],
        os.environ["R2_ACCESS_KEY_ID"], os.environ["R2_SECRET_ACCESS_KEY"],
    )

    log("\n[verify] streaming the object back and hashing it")
    log("         %s" % state["storage_key"])
    sha = hashlib.sha256()
    crc = CRC64_MASK
    read = 0
    started = time.monotonic()
    with urllib.request.urlopen(url, timeout=300) as res:
        if res.status != 200:
            die("GET returned %s" % res.status)
        while True:
            buf = res.read(READ_CHUNK)
            if not buf:
                break
            sha.update(buf)
            crc = smoke.crc64nvme(buf, crc)
            read += len(buf)
            if read % (1024 ** 3) < READ_CHUNK:
                rate = read / max(0.001, time.monotonic() - started)
                log("         %s read (%s/s)" % (human(read), human(rate)))

    got_sha = smoke.b64(sha.digest())
    got_crc = smoke.b64((crc ^ CRC64_MASK).to_bytes(8, "big"))

    log("\n  bytes      %d %s" % (read, "OK" if read == state["bytes"] else "MISMATCH"))
    log("  crc64nvme  %s %s" % (got_crc, "OK" if got_crc == state["crc64nvme"] else "MISMATCH"))
    log("  sha256     %s %s" % (got_sha, "OK" if got_sha == state["sha256"] else "MISMATCH"))

    if read == state["bytes"] and got_sha == state["sha256"] and got_crc == state["crc64nvme"]:
        log("\nPASS - what came back is byte-for-byte what went up.")
        log("       The SHA-256 is the cryptographic check; R2 only ever verified the CRC.")
        return
    die("the object read back does not match the file that was uploaded")


def cmd_selftest(args):
    """Everything that can be checked without a network or a 50 GB file."""
    ok = True

    def check(label, got, expected):
        nonlocal ok
        good = got == expected
        ok = ok and good
        log("  %-46s %s" % (label, "OK" if good else "FAIL  got %r want %r" % (got, expected)))

    log("\n[selftest] CRC-64/NVME against the published vector, both implementations")
    smoke.check_crc64_implementation()
    check("byte-at-a-time (smoke)",
          "%016x" % (smoke.crc64nvme(b"123456789") ^ CRC64_MASK), "ae8b14860a799888")
    check("slice-by-eight (here)",
          "%016x" % (crc64(b"123456789") ^ CRC64_MASK), "ae8b14860a799888")

    blob = os.urandom(1024 * 1024 + 37)          # deliberately not a multiple of 8
    check("the two agree on 1 MiB + 37 bytes", crc64(blob), smoke.crc64nvme(blob))
    split = 999_983                              # and across a chunk boundary
    check("slice-by-eight resumes mid-stream",
          crc64(blob[split:], crc64(blob[:split])), smoke.crc64nvme(blob))

    log("\n[selftest] the hasher splits parts exactly as slicing does")
    h = Hasher(1024)
    for step in (100, 1, 1023, 2048, len(blob)):  # ragged feeds, not aligned ones
        pos = 0
        h = Hasher(1024)
        while pos < len(blob):
            h.update(blob[pos:pos + step])
            pos += step
        plan = h.finish()
        slices = [blob[i:i + 1024] for i in range(0, len(blob), 1024)]
        same = (len(plan["part_checksums"]) == len(slices)
                and all(plan["part_checksums"][str(i)] == crc64_b64(crc64(c))
                        for i, c in enumerate(slices, 1))
                and plan["crc64nvme"] == crc64_b64(crc64(blob)))
        check("fed in %d-byte chunks" % step, same, True)

    log("\n[selftest] combining part CRCs equals hashing the whole thing")
    rng = random.Random(7)
    for trial in range(5):
        pieces = [os.urandom(rng.randint(1, 40_000)) for _ in range(rng.randint(2, 6))]
        joined = b"".join(pieces)
        combined = None
        for piece in pieces:
            final = crc64(piece) ^ CRC64_MASK
            combined = final if combined is None else crc64_combine(combined, final, len(piece))
        check("trial %d: %d pieces, %d bytes" % (trial + 1, len(pieces), len(joined)),
              combined, crc64(joined) ^ CRC64_MASK)

    log("\n[selftest] the part planner, mirroring app.plan_part_size")
    check("20 MiB", plan_part_bytes(20 * 1024 ** 2), 8 * 1024 ** 2)
    check("50 GB  -> 6400 parts of 8 MiB", plan_part_bytes(50 * 1024 ** 3), 8 * 1024 ** 2)
    check("50 GB  part count", -(-(50 * 1024 ** 3) // plan_part_bytes(50 * 1024 ** 3)), 6400)
    # 80 GiB is the first size where 8 MiB parts no longer fit in 10,000.
    check("100 GiB -> 16 MiB parts", plan_part_bytes(100 * 1024 ** 3), 16 * 1024 ** 2)
    check("100 GiB part count",
          -(-(100 * 1024 ** 3) // plan_part_bytes(100 * 1024 ** 3)), 6400)

    log("\n[selftest] SigV4 presigner against AWS's published example")
    # docs.aws.amazon.com, \"Signature calculation for a presigned URL\":
    # GET examplebucket/test.txt, us-east-1, 20130524T000000Z, 86400s.
    url = presign_get(
        # Virtual-hosted style in the example: the bucket is in the host, so
        # the canonical URI is just the key.
        account=None, bucket="", key="test.txt",
        access_key="AKIAIOSFODNN7EXAMPLE",
        secret="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        expires=86400, region="us-east-1", host="examplebucket.s3.amazonaws.com",
        stamp="20130524T000000Z",
    )
    signature = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["X-Amz-Signature"][0]
    check("signature",
          signature, "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")

    log("\n[selftest] the throttle")
    t = Throttle(4 * 1024 * 1024)
    began = time.monotonic()
    for _ in range(8):
        t.consume(1024 * 1024)
    took = time.monotonic() - began
    # 8 MiB through a 4 MiB/s bucket that starts full: about one second.
    check("8 MiB at 4 MiB/s takes 0.6-2.0s", 0.6 < took < 2.0, True)

    log("")
    if not ok:
        die("the self-test failed; do not start a 50 GB run")
    log("All self-tests passed.")


def cmd_status(args):
    state = load_state(args.path)
    if not state:
        die("no state file for %s" % args.path)
    log(json.dumps({k: v for k, v in state.items() if k != "part_checksums"},
                   indent=2, sort_keys=True))
    log("  part_checksums: %d parts" % len(state.get("part_checksums", {})))

    if state.get("upload_id"):
        token = contractor_token()
        resume = smoke.rpc_as_caller(token, "upload_resume_plan",
                                     {"p_upload": state["upload_id"]})
        log("\n  server says: %s, %s received, %d parts missing"
            % (resume["status"], human(resume["bytes_received"]), len(resume["missing"])))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    g = sub.add_parser("generate", help="write a file of pseudo-random bytes")
    g.add_argument("path")
    g.add_argument("--bytes", default="50G")
    g.add_argument("--seed", type=int, default=20261116)
    g.add_argument("--force", action="store_true")
    g.set_defaults(func=cmd_generate)

    r = sub.add_parser("run", help="upload, or resume uploading, the file")
    r.add_argument("path")
    r.add_argument("--limit", type=float, default=0,
                   help="throttle in MiB/s; 0 means as fast as the link allows")
    r.add_argument("--slot-id", default=None)
    r.add_argument("--force-expiry", action="store_true",
                   help="wait past the URL lifetime before the first PUT, to "
                        "prove the re-sign path rather than hope for it")
    r.set_defaults(func=cmd_run)

    v = sub.add_parser("verify", help="read the object back and compare SHA-256")
    v.add_argument("path")
    v.set_defaults(func=cmd_verify)

    t = sub.add_parser("selftest", help="check the CRC, the planner and the signer")
    t.set_defaults(func=cmd_selftest)

    s = sub.add_parser("status", help="what the client and the server each think")
    s.add_argument("path")
    s.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
