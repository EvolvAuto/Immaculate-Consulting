// PM2 config for prl-poller.
//
// Deploy:
//   cd /opt/prl-poller
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup   (one-time, follow printed instructions)
//
// Logs:
//   pm2 logs prl-poller
//   pm2 logs prl-poller --lines 200

module.exports = {
  apps: [
    {
      name: 'prl-poller',
      script: './index.js',
      cwd: '/opt/prl-poller',
      instances: 1,            // single instance - cron triggers must not duplicate
      exec_mode: 'fork',       // not cluster - we hold cron state in-process
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      max_memory_restart: '500M',

      // Output
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Watch is OFF in production - cron-driven processes shouldn't restart
      // on file change.
      watch: false,
    },
  ],
};
