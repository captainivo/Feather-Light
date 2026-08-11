# Shard-Lantern

Shard-Lantern is the inhabitant, routine, event, and holder-scoped bond service. This source-only
copy was imported while the VM deployment remained online and unchanged.

Private inhabitants, biographies, routines, events, bonds, and bond history are deliberately absent
from Git. A new empty database may be initialized from a private JSON file mounted at runtime and
selected with `SHARD_LANTERN_SEED_FILE`. The seed is accepted only while the inhabitant and person
tables are empty.

The repository contains synthetic tests only. Runtime databases, seed data, credentials, logs,
dependencies, and generated output must remain outside this directory.
