module.exports = {
  apps: [
    {
      name: "twitchRaid",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false, // Git auto-update handles restarts
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      // Log settings
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      max_size: "10M",
      retain: "10",
      // Restart settings
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
  ],
};
