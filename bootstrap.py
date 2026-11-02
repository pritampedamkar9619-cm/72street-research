"""First start on a fresh machine or server.

The server keeps everything it learns in ./data. On a new host (Railway, a teammate's laptop) that folder
is empty, so the starter data in ./seed/seed.zip is unpacked into it once: company fundamentals, peer
tables, sector maps and the logs the track record needs. Files already in ./data are never overwritten,
so a persistent volume keeps its own newer copies."""
import os, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
SEED = os.path.join(ROOT, "seed", "seed.zip")
MARK = os.path.join(DATA, ".seeded")


def run():
    os.makedirs(DATA, exist_ok=True)
    if os.path.exists(MARK) or not os.path.exists(SEED):
        return
    n = 0
    with zipfile.ZipFile(SEED) as z:
        for name in z.namelist():
            if name.endswith("/"):
                continue
            dest = os.path.join(DATA, *name.split("/"))
            if os.path.exists(dest):
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with z.open(name) as src, open(dest, "wb") as out:
                out.write(src.read())
            n += 1
    open(MARK, "w").write(str(n))
    print(f"seeded {n} starter files into data/", flush=True)


run()
