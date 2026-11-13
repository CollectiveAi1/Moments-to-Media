#!/usr/bin/env python3
"""r2_check - do these R2 credentials actually work, and for what?

The upload pipeline has a lot of moving parts, and "Unauthorized" from R2
could be the token, the bucket scope, the permission level, or the wrong
Cloudflare account entirely. This talks to R2 directly with the same SigV4
signing the Edge Function uses, one operation at a time, and prints exactly
what R2 says to each. No Supabase, no Edge Functions, no presigning.

    export R2_ACCOUNT_ID=...
    export R2_BUCKET=moments-to-media-footage
    export R2_ACCESS_KEY_ID=...
    export R2_SECRET_ACCESS_KEY=...
    python3 scripts/r2_check.py

Nothing is written that is not immediately removed: the write test opens a
multipart upload and aborts it in the next call.
"""

import datetime
import hashlib
import hmac
import os
import sys
import urllib.error
import urllib.request


def need(name):
    v = (os.environ.get(name) or "").strip()
    if not v:
        sys.exit("Missing %s" % name)
    return v


ACCOUNT = need("R2_ACCOUNT_ID")
BUCKET = need("R2_BUCKET")
KEY_ID = need("R2_ACCESS_KEY_ID")
SECRET = need("R2_SECRET_ACCESS_KEY")

HOST = "%s.r2.cloudflarestorage.com" % ACCOUNT
REGION = "auto"
SERVICE = "s3"
EMPTY_SHA = hashlib.sha256(b"").hexdigest()


def sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def signing_key(datestamp):
    k = sign(("AWS4" + SECRET).encode(), datestamp)
    k = sign(k, REGION)
    k = sign(k, SERVICE)
    return sign(k, "aws4_request")


def call(method, path, query="", body=b""):
    """Signed request. path begins with '/', query is already canonical."""
    now = datetime.datetime.utcnow()
    amzdate = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest() if body else EMPTY_SHA

    canonical_headers = "host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n" % (
        HOST, payload_hash, amzdate)
    signed_headers = "host;x-amz-content-sha256;x-amz-date"

    canonical_request = "\n".join(
        [method, path, query, canonical_headers, signed_headers, payload_hash])

    scope = "%s/%s/%s/aws4_request" % (datestamp, REGION, SERVICE)
    to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amzdate, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    signature = hmac.new(signing_key(datestamp), to_sign.encode(), hashlib.sha256).hexdigest()

    authorization = (
        "AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s"
        % (KEY_ID, scope, signed_headers, signature))

    url = "https://%s%s" % (HOST, path)
    if query:
        url += "?" + query

    req = urllib.request.Request(url, data=body or None, method=method)
    req.add_header("Host", HOST)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("x-amz-date", amzdate)
    req.add_header("Authorization", authorization)

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, res.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except urllib.error.URLError as e:
        return 0, "could not reach %s: %s" % (HOST, e.reason)


def tag(xml, name):
    start, end = "<%s>" % name, "</%s>" % name
    if start in xml and end in xml:
        return xml.split(start, 1)[1].split(end, 1)[0]
    return None


def report(label, status, body):
    verdict = "OK  " if 200 <= status < 300 else "FAIL"
    print("\n%s  %-28s HTTP %s" % (verdict, label, status))
    code, message = tag(body, "Code"), tag(body, "Message")
    if code or message:
        print("      R2 said: %s - %s" % (code, message))
    return 200 <= status < 300


def main():
    print("endpoint: https://%s" % HOST)
    print("bucket:   %s" % BUCKET)
    print("key id:   %s...%s (%d chars)" % (KEY_ID[:4], KEY_ID[-4:], len(KEY_ID)))
    print("secret:   %d chars" % len(SECRET))

    # 1. Does the key work at all, and what can it see?
    status, body = call("GET", "/")
    listed = report("ListBuckets", status, body)
    if listed:
        names = []
        rest = body
        while "<Name>" in rest:
            names.append(tag(rest, "Name"))
            rest = rest.split("</Name>", 1)[1]
        print("      buckets visible: %s" % (", ".join(names) if names else "(none)"))
        if BUCKET not in names:
            print("      NOTE: %s is not among them." % BUCKET)

    # 2. Can it see this bucket specifically?
    status, body = call("HEAD", "/%s" % BUCKET)
    report("HeadBucket", status, body)

    # 3. Can it read objects?
    status, body = call("GET", "/%s" % BUCKET, query="list-type=2&max-keys=1")
    report("ListObjectsV2 (read)", status, body)

    # 4. Can it write? Open a multipart and abort it straight away.
    key = "r2-check/permission-probe.bin"
    status, body = call("POST", "/%s/%s" % (BUCKET, key), query="uploads=")
    wrote = report("CreateMultipartUpload (write)", status, body)

    if wrote:
        upload_id = tag(body, "UploadId")
        status, body = call("DELETE", "/%s/%s" % (BUCKET, key), query="uploadId=%s" % upload_id)
        report("AbortMultipartUpload (cleanup)", status, body)

    print("""
How to read this:
  all OK                      -> the credentials are fine; the fault is ours
  ListBuckets 401/403         -> wrong key pair, or the wrong Cloudflare account
  ListBuckets OK, bucket absent-> the token is scoped to other buckets
  read OK, write FAIL         -> the token is Object Read only, not Read & Write
""")


if __name__ == "__main__":
    main()
