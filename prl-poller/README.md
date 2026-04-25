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
