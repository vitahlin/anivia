module.exports = {
  apps: [{
    name: 'anivia',
    script: 'bun',
    args: 'run src/server.ts',
    cwd: './',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    env: {
      NODE_ENV: 'production',
    },
    env_development: {
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug'
    },
    env_production: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    pid_file: './logs/anivia.pid',
    listen_timeout: 10000,
    kill_timeout: 5000,
    ignore_watch: ['node_modules', 'logs', 'dist', '.git', '.env'],
    source_map_support: true,
    instance_var: 'INSTANCE_ID',
    wait_ready: false,
    exp_backoff_restart_delay: 100,
  }]
};

