# PRL Poller

External SFTP poller for NC Medicaid PRL (Patient Risk List) bidirectional exchange. Runs on Leonard's DigitalOcean droplet under PM2. Pulls inbound files from health plan / NC DHHS SFTP servers and POSTs them to PracticeOS `prl-ingest-from-sftp` webhook; pushes outbound generated files from `cm_prl_exports` to plan SFTP servers.

## Architecture
+--------------------+
                    |  Health Plan SFTP  |
                    |  (TRIB, CCH, etc)  |
                    +---------+----------+
                              |
                      SSH/SFTP|        (this poller)
                              v
+---------------------+   +----------------------+   +--------------------+
| /opt/prl-poller     |   | DigitalOcean droplet |   | Supabase           |
|  - cron pull tick   +-->|  Node.js + PM2       +-->|  prl-ingest-from   |
|  - cron push tick   |   |  Express admin :3001 |   |    -sftp webhook   |
|  - admin trigger    |<--+                      |<--+  prl-parse, etc.   |
+---------------------+   +----------------------+   +--------------------+
