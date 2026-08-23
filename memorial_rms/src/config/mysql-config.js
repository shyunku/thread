function loadConfig() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const database = process.env.DB_DATABASE;
  const password = process.env.DB_PASSWORD;
  const port = process.env.DB_PORT;

  if (!host || !user || !database || !password || !port) {
    throw new Error("Missing database configuration");
  }

  return {
    host: host,
    user: user,
    database: database,
    password: password,
    port: port,
    multipleStatements: true,
  };
}

module.exports = loadConfig();
