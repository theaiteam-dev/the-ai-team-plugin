# Infrastructure Patterns

Examples of good and bad practices for Ansible, shell scripts, YAML configuration, and Docker.

---

## Ansible Tasks

### Bad
```yaml
# Using command/shell when a module exists
- name: Install nginx
  command: apt-get install -y nginx

# No changed_when — always reports "changed"
- name: Check cluster status
  command: patronictl list
  register: cluster_status

# Bare variables in conditionals (deprecated)
- name: Start service
  service:
    name: postgres
    state: started
  when: enable_postgres

# Hardcoded values that should be variables
- name: Configure PgBouncer
  template:
    src: pgbouncer.ini.j2
    dest: /etc/pgbouncer/pgbouncer.ini
    owner: root
    group: root
    mode: 0644

# Using shell with inline pipes when a module would work
- name: Get disk usage
  shell: df -h / | tail -1 | awk '{print $5}'
  register: disk_usage
```

### Good
```yaml
# Use the appropriate module
- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present

# Mark read-only commands as not changing anything
- name: Check cluster status
  ansible.builtin.command: patronictl list
  register: cluster_status
  changed_when: false

# Proper boolean test in conditionals
- name: Start service
  ansible.builtin.service:
    name: postgres
    state: started
  when: enable_postgres | bool

# Variables for ownership and permissions
- name: Configure PgBouncer
  ansible.builtin.template:
    src: pgbouncer.ini.j2
    dest: "{{ pgbouncer_config_dir }}/pgbouncer.ini"
    owner: "{{ pgbouncer_user }}"
    group: "{{ pgbouncer_group }}"
    mode: "0640"

# Use stat module instead of shell parsing
- name: Get disk usage
  ansible.builtin.stat:
    path: /
  register: root_partition
```

**What to flag:**
- `command`/`shell` when an Ansible module exists for the operation
- Missing `changed_when` on commands that don't modify state
- Bare variables in `when` conditionals (use `| bool` or compare explicitly)
- Hardcoded paths, users, or permissions that should be role variables
- Missing `mode` on file/template/copy tasks (defaults may be too permissive)
- FQCN (fully qualified collection names) not used — prefer `ansible.builtin.x` over bare `x`

---

## Ansible Variables & Secrets

### Bad
```yaml
# Secrets in plain text in group_vars
db_password: supersecret123

# Overly broad variable scope — defined in group_vars/all when only one role needs it
patroni_replication_slot_count: 10

# Variable name collision — generic names across roles
port: 5432
user: postgres
```

### Good
```yaml
# Secrets in vault-encrypted file
db_password: "{{ vault_db_password }}"

# Scoped to role defaults with clear prefix
patroni_replication_slot_count: 10  # in roles/patroni/defaults/main.yml

# Namespaced variable names
postgres_port: 5432
postgres_user: postgres
pgbouncer_port: 6432
pgbouncer_user: pgbouncer
```

**What to flag:** Plain-text secrets anywhere outside vault files. Variables without role-name prefixes. Secrets passed on the command line (visible in process list). Default passwords left unchanged.

---

## Shell Scripts

### Bad
```bash
#!/bin/bash

# No error handling
cd /opt/backups
rm -rf old/*
cp -r /data/* .

# Unquoted variables
filename=$1
cat $filename | grep error

# No input validation
mysql -u root -p$PASSWORD $DATABASE < $1
```

### Good
```bash
#!/usr/bin/env bash
set -euo pipefail

# Validate inputs
readonly BACKUP_DIR="/opt/backups"
readonly DATA_DIR="/data"

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "ERROR: Data directory ${DATA_DIR} does not exist" >&2
  exit 1
fi

# Quote all variable expansions
cd "${BACKUP_DIR}"
rm -rf "${BACKUP_DIR}/old/"*
cp -r "${DATA_DIR}/"* .

# Use arrays for commands with dynamic arguments
readonly filename="${1:?Usage: $0 <filename>}"
grep "error" "${filename}"

# No passwords on command line
mysql --defaults-file=/etc/mysql/backup.cnf "${DATABASE}" < "${filename}"
```

**What to flag:**
- Missing `set -euo pipefail` at the top
- Unquoted variable expansions (word splitting, glob expansion bugs)
- `cd` without error handling (script continues in wrong directory)
- Passwords passed as command-line arguments (visible in `ps`)
- `cat file | grep` instead of `grep file` (useless use of cat)
- Missing input validation on positional parameters
- `rm -rf` with variables that could be empty (deletes wrong things)

---

## Docker & Compose

### Bad
```yaml
# Running as root
services:
  app:
    image: myapp:latest    # mutable tag
    privileged: true
    volumes:
      - /:/host             # full host filesystem access
    environment:
      DB_PASSWORD: hunter2  # secret in compose file

# No health checks
# No resource limits
```

### Good
```yaml
services:
  app:
    image: myapp:1.4.2      # pinned version
    user: "1000:1000"
    read_only: true
    security_opt:
      - no-new-privileges:true
    volumes:
      - app-data:/app/data   # named volume, minimal scope
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'

secrets:
  db_password:
    external: true
```

**What to flag:**
- `:latest` tags (non-reproducible builds)
- `privileged: true` or excessive capabilities
- Host filesystem mounts (especially `/` or `/var/run/docker.sock`)
- Secrets in environment variables or compose files (use Docker secrets or external vault)
- Missing health checks on services
- Missing resource limits (memory/CPU) on production services
- Running as root when the application doesn't require it

---

## YAML Hygiene

### Bad
```yaml
# Inconsistent quoting
name: my-service
port: "5432"
enabled: "true"
path: /etc/config

# Deeply nested with no anchors for repetition
services:
  db1:
    config:
      max_connections: 100
      shared_buffers: 256MB
      wal_level: replica
  db2:
    config:
      max_connections: 100
      shared_buffers: 256MB
      wal_level: replica
```

### Good
```yaml
# Consistent typing — strings are strings, numbers are numbers
name: "my-service"
port: 5432
enabled: true
path: "/etc/config"

# Use anchors for repeated config
_db_defaults: &db_defaults
  max_connections: 100
  shared_buffers: "256MB"
  wal_level: replica

services:
  db1:
    config:
      <<: *db_defaults
  db2:
    config:
      <<: *db_defaults
      max_connections: 200  # override where needed
```

**What to flag:** Inconsistent quoting style. Duplicated config blocks that should use YAML anchors. Strings that look like booleans or numbers without quotes (`yes`, `no`, `on`, `off` are booleans in YAML 1.1). Jinja2 expressions not quoted in Ansible (`{{ var }}` must be quoted when it starts a value).
