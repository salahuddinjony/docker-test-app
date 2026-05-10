# docker-testapp

Small **Express + MongoDB** demo. You can run the API **on the host** (`node server.js`), run **only the database** with Docker Compose while you code, or run the **pre-built image** from Docker Hub together with Compose.

**Table of contents**

- [Core ideas (read this first)](#core-ideas-read-this-first)
- [Project layout](#project-layout)
- [Using this project with Docker](#using-this-project-with-docker)
- [Networking: why `localhost` breaks inside containers](#networking-why-localhost-breaks-inside-containers)
- [Environment variables](#environment-variables)
- [User A (publisher) and User B (consumer)](#user-a-publisher-and-user-b-consumer-on-docker-hub)
- [Volumes in this repo](#volumes-in-this-repo)
- [Docker command reference](#docker-command-reference)
- [Troubleshooting](#troubleshooting)
- [Security and production](#security-and-production)

---

## Core ideas (read this first)

| Term | What it is | Why it matters |
|------|------------|----------------|
| **Image** | Read-only template (layers + metadata) | Built from a Dockerfile or pulled from a registry; **immutable** until you rebuild or pull a new tag. |
| **Container** | Running instance of an image | Has its own filesystem overlay, network namespace, and PIDs. **Deleting a container does not delete the image.** |
| **Dockerfile** | Recipe: base image + `COPY`, `RUN`, `CMD`, … | Reproducible builds; same file should produce the same logical app version (modulo `latest` base drift). |
| **Registry (e.g. Docker Hub)** | Stores images by name `user/repo:tag` | **User A** pushes; **User B** pulls—no need to share the whole git repo for running a released image. |
| **Compose** | YAML file describing several services, networks, volumes | One command starts **Mongo + app + tools** with correct **hostnames** and **env** between containers. |

**Typical flow**

1. **Build** (optional if you pull): `docker build` reads the Dockerfile and creates a local **image**.
2. **Run**: `docker run` (or Compose) creates a **container** from that image and starts the process (`CMD`).
3. **Persist data**: attach a **volume** or **bind mount** so database files survive container removal.
4. **Publish**: tag as `dockerhub-user/repo:tag` and `docker push` so others can `docker pull`.

---

## Project layout

| Path | Role |
|------|------|
| `server.js` | Express app, Mongo connection, routes (`/getUsers`, `/addUser`, static files). |
| `public/` | Static HTML (e.g. forms, dashboard). |
| `Dockerfile` | Builds the Node app image (`COPY` project into `/testapp`, `node testapp/server.js`). |
| `docker-compose.yml` | **app** (Hub image), **mongodb**, **mongo-express**; networks and Mongo bind mount. |
| `package.json` | Dependencies (`express`, `mongodb`). |

**API (high level)**

- `GET /getUsers` — JSON list from `users` collection.
- `GET|POST /addUser` — redirect or insert user from form body.

---

## Using this project with Docker

### When to use what

| Goal | Why | What to run |
|------|-----|-------------|
| Full stack in one command | Compose wires **app → Mongo** with hostname `mongodb` and `MONGO_URL` | `docker compose up -d` |
| Only database + optional UI | You run `node server.js` locally and want real Mongo on **localhost:27018** | `docker compose up -d mongodb` (and optionally `mongo-express`) |
| Only the published app image | No local build; trust Docker Hub | `docker pull …` then `docker run` with correct **Mongo reachability** (see below) |

### Stack overview (Compose)

| Service | Image | Ports (host → container) | Notes |
|---------|--------|---------------------------|--------|
| **app** | `salahuddinjony/testapp:latest` | **5052 → 5050** | `PORT=5050` inside container; browse `http://localhost:5052`. |
| **mongodb** | `mongo:7` | **27018 → 27017** | Host **27018** avoids clashing with a Mongo already on host **27017**. |
| **mongo-express** | `mongo-express:latest` | **8082 → 8081** | Browser UI for Mongo; Basic Auth from compose env. |

**Start everything (detached)**

```bash
docker compose up -d
```

**Watch logs (example: app only)**

```bash
docker compose logs -f app
```

**Stop containers (default: keeps bind-mounted Mongo files on your disk)**

```bash
docker compose down
```

**Also remove anonymous volumes Compose created** (read carefully—may delete data not on bind mounts)

```bash
docker compose down -v
```

This project’s Mongo data for `mongodb` uses a **bind mount** to `/Users/salah/Desktop/mongoData`, so that folder is **not** removed by `down -v` unless you also used a named volume for the same data (this compose file does not).

**Rebuild the app service** (only if your `docker-compose.yml` has a `build:` section; the current file uses `image:` only—rebuild happens on Hub or you build locally and retag)

```bash
docker build -t salahuddinjony/testapp:latest .
docker compose up -d
# or push to Hub after tagging with your namespace
```

### Run the app container without the full Compose stack

**Scenario:** Mongo is already up (e.g. `docker compose up -d mongodb`), and you only want the Node container.

**Why `MONGO_URL` matters:** Inside Docker, `localhost` is **not** your Mac. This repo’s `server.js` detects `/.dockerenv` and defaults to `host.docker.internal:27018` so the app reaches Mongo published on the host at **27018**. You can override with `-e MONGO_URL=...`.

```bash
docker compose up -d mongodb
docker pull salahuddinjony/testapp:latest
docker run --rm -p 5052:5050 \
  -e PORT=5050 \
  -e MONGO_URL='mongodb://admin:qwerty@host.docker.internal:27018/?authSource=admin' \
  salahuddinjony/testapp:latest
```

When the **app** service runs **inside Compose**, compose sets `MONGO_URL` to `mongodb://admin:qwerty@mongodb:27017/?authSource=admin` because all services share a network and the Mongo hostname is the **service name** `mongodb`.

### Build the image locally (before push)

**Why:** You changed code and want to test an image on your machine or tag it for Hub.

```bash
npm install
docker build -t testapp:1.0 .
docker run --rm -p 5052:5050 testapp:1.0
```

This Dockerfile uses `COPY . /testapp`, so dependencies must exist under `node_modules` on the **host** at build time unless you change the Dockerfile to run `npm ci` inside the image.

---

## Networking: why `localhost` breaks inside containers

```mermaid
flowchart LR
  subgraph host [Your Mac - host]
    Browser[Browser localhost:5052]
    Port27018[Host port 27018]
  end
  subgraph bridge [Docker network]
    App[app container]
    MongoC[mongodb container]
  end
  Browser --> Port27018
  App -->|"MONGO_URL host.docker.internal:27018"| Port27018
  App -->|"Compose: mongodb:27017"| MongoC
```

| Where the app runs | Use this Mongo address | Reason |
|--------------------|------------------------|--------|
| **Host** (`node server.js`) | `localhost:27018` (with this compose port map) | Process shares the host network namespace for loopback. |
| **Container** + Mongo **also in Compose** | `mongodb:27017` | Docker **DNS** resolves `mongodb` to the DB container; port is **inside** the network. |
| **Container** + Mongo **only published on host** | `host.docker.internal:27018` (Desktop) or host gateway on Linux | Container’s `localhost` is **itself**, not the host. |

**Linux note:** If `host.docker.internal` is missing, run with:

`--add-host=host.docker.internal:host-gateway`

---

## Environment variables

| Variable | Default in code | Compose `app` service | Meaning |
|----------|-----------------|-------------------------|---------|
| `PORT` | `5052` if unset | `5050` | HTTP port **inside** the container; map with `-p HOST:CONTAINER`. |
| `MONGO_URL` | See `defaultMongoUrl()` in `server.js` | Set to `mongodb://…@mongodb:27017/…` | Full Mongo connection string; **overrides** all defaults when set. |

`authSource=admin` matches the **root user** created by `MONGO_INITDB_ROOT_*` in the official Mongo image on first init.

---

## User A (publisher) and User B (consumer) on Docker Hub

### Roles

| Role | Typical tasks | Needs Docker Hub account? |
|------|----------------|---------------------------|
| **User A** | Build, tag with namespace, push | Yes (owner or collaborator on repo) |
| **User B** | Pull (public) or pull (private after login), run | Only if image is **private** |

### User A — detailed push workflow

1. **Create a repository** on [hub.docker.com](https://hub.docker.com) (e.g. `testapp`) under your user—optional for automated first push but avoids confusion.
2. **`docker login`** — use your **username** and a **Personal Access Token** (recommended) or password. Tokens are safer for CI and can be revoked.
3. **`docker build -t YOUR_USER/testapp:1.0 .`** — `YOUR_USER` must match your Docker Hub **namespace** (usually your username).
4. **`docker tag`** (optional) — same image ID, extra names (e.g. `latest`).
5. **`docker push YOUR_USER/testapp:1.0`** — uploads layers; User B can pin to `:1.0` for repeatable deploys.
6. **`docker push YOUR_USER/testapp:latest`** — convenience tag; **`:latest` is a moving target**—document versions for production.

```bash
docker login
docker build -t YOUR_DOCKERHUB_USERNAME/testapp:1.0 .
docker tag YOUR_DOCKERHUB_USERNAME/testapp:1.0 YOUR_DOCKERHUB_USERNAME/testapp:latest
docker push YOUR_DOCKERHUB_USERNAME/testapp:1.0
docker push YOUR_DOCKERHUB_USERNAME/testapp:latest
```

This repo’s compose references `salahuddinjony/testapp:latest`; substitute your own namespace when you fork.

### User B — detailed pull and run workflow

1. **`docker pull YOUR_USER/testapp:latest`** (or `:1.0`) — updates local cache if a new digest exists.
2. **Start dependencies** — for this project, **Mongo** must be reachable with correct credentials.
3. **`docker run`** — publish `PORT`, pass `MONGO_URL` if defaults are wrong for your layout.

```bash
docker pull YOUR_DOCKERHUB_USERNAME/testapp:latest
docker run --rm -p 5052:5050 YOUR_DOCKERHUB_USERNAME/testapp:latest
```

**Pinning by digest** (maximum reproducibility): after pull, `docker images --digests` shows `IMAGE ID` and digest; in production YAML you can reference `@sha256:…` (advanced; see Docker docs).

---

## Volumes in this repo

| Kind | Where used | Behavior |
|------|------------|----------|
| **Bind mount** | `mongodb`: host `/Users/salah/Desktop/mongoData` → container `/data/db` | Data lives in a **folder you control**; back it up like normal files. Path is **machine-specific**—edit `docker-compose.yml` on other computers. |
| **Named volume** | Not used in current compose for Mongo | Would look like `mongodb_data:/data/db` plus a top-level `volumes: mongodb_data:` block. Good for “Docker manages the path.” |

**Anonymous volumes** — created if you use `-v /container/path` with no host side; harder to find on disk; `docker volume prune` can delete unused ones.

---

## Docker command reference

Long flags use **two dashes**: `--name`, `--no-cache`, `--volume`. Short flags: `-d`, `-p`, `-e`.

### Images

| Command | When | Why |
|---------|------|-----|
| `docker images` | Inspect local cache | See tags, sizes, image IDs |
| `docker rmi IMAGE` | Remove unused tags | Free space; may fail if a container still references it |
| `docker image prune` | Cleanup | Removes **dangling** images (untagged intermediates) |
| `docker image prune -a` | Aggressive cleanup | Unused images not referenced by any container—**double-check** first |
| `docker build -t name:tag PATH` | Build from Dockerfile | `PATH` is build context (often `.`) |
| `docker build --no-cache -t name:tag .` | Cache suspected | Forces re-run of every `RUN` layer |
| `docker build -f Dockerfile.other .` | Non-default filename | Explicit dockerfile path |

### Containers

| Command | When | Why |
|---------|------|-----|
| `docker ps` | Running only | Default view |
| `docker ps -a` | Include exited | Find crashed or stopped containers |
| `docker run IMAGE` | New container | Pulls if missing; attaches stdout |
| `docker run -d IMAGE` | Daemon / server | Runs in background |
| `docker run --rm IMAGE` | One-off jobs | Auto-remove container on exit—good for tests |
| `docker run --name myapp IMAGE` | Stable name | `docker logs myapp`, `docker stop myapp` |
| `docker run -p HOST:CONTAINER IMAGE` | Publish ports | Maps host TCP to container |
| `docker run -e KEY=VALUE IMAGE` | Config | Same image, different environments |
| `docker run --env-file .env IMAGE` | Many variables | Keeps secrets out of shell history |
| `docker start CONTAINER` | Restart existing | Reuses created filesystem + config |
| `docker stop CONTAINER` | Graceful stop | SIGTERM then SIGKILL after timeout |
| `docker restart CONTAINER` | Quick bounce | Stop + start |
| `docker inspect CONTAINER` | Deep debug | JSON: mounts, env, network settings |
| `docker rm CONTAINER` | Delete stopped | Use `docker rm -f` to kill and remove |

### Logs and debugging

| Command | When | Why |
|---------|------|-----|
| `docker logs CONTAINER` | After crash | One-shot stdout/stderr |
| `docker logs -f --tail 100 CONTAINER` | Live tail | Like `tail -f` |
| `docker exec -it CONTAINER sh` | Shell inside | Explore files; `bash` if installed |

### Docker Hub

| Command | When | Why |
|---------|------|-----|
| `docker pull USER/REPO:tag` | Fresh machine / CI | Download image |
| `docker push USER/REPO:tag` | After login + build | Publish |
| `docker login` | Auth | Required for push and private pulls |
| `docker logout` | Shared PC | Clear creds |
| `docker search TERM` | Discovery | Limited; website search is richer |

### Volumes

| Command | When | Why |
|---------|------|-----|
| `docker volume ls` | Inventory | Named + anonymous (some) |
| `docker volume create NAME` | Pre-create | Ensures specific volume exists |
| `docker volume rm NAME` | Unused volume | Fails if still attached |
| `docker volume prune` | Cleanup | **Deletes unused**—data loss risk |
| `docker run -v name:/path IMAGE` | Named mount | Persist data |
| `docker run -v /host/path:/path IMAGE` | Bind mount | Direct host directory |
| `docker run --mount type=bind,src=/host,dst=/path,readonly IMAGE` | Read-only bind | Safer for config dirs |

### Networks

| Command | When | Why |
|---------|------|-----|
| `docker network ls` | See bridges | Compose creates `project_default` |
| `docker network create mynet` | Custom topology | Attach with `docker run --network mynet` |
| `docker network rm mynet` | Unused | |
| `docker network prune` | Cleanup | Removes unused networks |

### Compose

| Command | When | Why |
|---------|------|-----|
| `docker compose up -d` | Start stack | Detached |
| `docker compose up -d --build` | Rebuild + start | When Dockerfile / build section changed |
| `docker compose down` | Stop + remove containers | Networks too; volumes depend on flags |
| `docker compose ps` | Status | Service health / ports |
| `docker compose logs -f SERVICE` | Per-service logs | |
| `docker compose config` | Validate YAML | Catches schema errors before run |

### Host maintenance

| Command | When | Why |
|---------|------|-----|
| `docker system df` | Disk usage | Images, containers, volumes |
| `docker system prune` | General cleanup | Interactive; can remove stopped containers and unused networks |

---

## Troubleshooting

| Symptom | Likely cause | What to try |
|---------|--------------|-------------|
| `Authentication failed` (Mongo) | Connecting to **wrong** Mongo (e.g. host `mongod` on 27017) with `admin`/`qwerty` | Ensure URL points at **this** compose Mongo; check `lsof -iTCP:27017` on host. |
| `ECONNREFUSED 127.0.0.1:27018` in container | `localhost` inside container is not the host | Use `host.docker.internal:27018` or compose `mongodb:27017`. |
| `EADDRINUSE` on app port | Host port already taken | Change left side of `-p` or stop other process. |
| `volumes must be a mapping` / `Additional property … not allowed` | Invalid top-level `volumes:` in compose | Top-level keys must be **volume names**, not host paths; bind mounts go under **services**. |
| App exits immediately | Mongo not ready or wrong `MONGO_URL` | `docker compose logs app`; start `mongodb` first; wait a few seconds. |
| `validating docker-compose.yml` errors | Indentation / tabs / wrong types | Run `docker compose config`. |

---

## Security and production

- Example **Mongo user/password** and **mongo-express Basic Auth** in `docker-compose.yml` are for **local development only**.
- Do not bake real secrets into `ENV` in Dockerfiles if images are shared—prefer **runtime** `docker run -e` or **secrets** (Swarm/Kubernetes) in real deployments.
- Use **specific image tags** (`mongo:7.0.15` or digest) instead of drifting `latest` where reproducibility matters.
- Restrict **bind mount** paths to non-sensitive directories; correct filesystem permissions on host data dirs.

---

## Quick checklist for this repository

1. **Mongo data path:** `/Users/salah/Desktop/mongoData` in compose—adjust per machine.
2. **Credentials:** Development-only; rotate for any shared environment.
3. **App + DB:** Align `MONGO_URL` with where the app runs (host vs Compose vs standalone container).
4. **Build:** Run `npm install` before `docker build` with the current Dockerfile layout.
