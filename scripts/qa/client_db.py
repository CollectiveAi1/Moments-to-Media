#!/usr/bin/env python3
"""
Turns a pgTAP test file into one SQL script that can run against a hosted
project through a plain SQL connection: helpers.psql is inlined, every
assertion's output goes into a temporary table, and the transaction is
rolled back at the end so nothing is left behind.

    python3 scripts/qa/client_db.py supabase/tests/12_client_side.test.sql > /tmp/run.sql
"""
import re
import sys
from pathlib import Path

test = Path(sys.argv[1])
helpers = (test.parent / "helpers.psql").read_text()
sql = test.read_text().replace("\\ir helpers.psql", helpers)
sql = sql.replace("set local search_path to public, extensions, tests;",
                  "set local search_path to public, extensions, tests;\ncreate temp table tap (n serial, line text);\ngrant all on tap to public;\ngrant all on sequence tap_n_seq to public;", 1)
sql = re.sub(r"^select \* from (no_plan|finish)\(\);", r"insert into tap (line) select * from \1();", sql, flags=re.M)
sql = re.sub(r"^select (ok|is|isnt|lives_ok|throws_ok)\(", r"insert into tap (line) select * from \1(", sql, flags=re.M)
sql = sql.replace("\nrollback;", "\nselect string_agg(line, E'\\n' order by n) as tap from tap;\nrollback;")
sys.stdout.write(sql)
