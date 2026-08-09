// Keep `npm start` portable: `NODE_ENV=value command` is POSIX shell syntax and
// fails in PowerShell/cmd. Deployment may still provide an explicit environment;
// this only supplies the production default before configuration is imported.
process.env.NODE_ENV ||= 'production';

await import('../server.mjs');
