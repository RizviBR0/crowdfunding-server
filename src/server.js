import { createApp } from "./app.js";
import { closeDatabase, connectToDatabase } from "./config/database.js";
import { env } from "./config/env.js";

const app = createApp();

let server;

const shutdown = async (signal) => {
  console.info(`${signal} received. Closing HTTP server and database connection.`);

  if (server) {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    return;
  }

  await closeDatabase();
  process.exit(0);
};

const startServer = async () => {
  await connectToDatabase();

  server = app.listen(env.port, () => {
    console.info(`Crowdfunding API listening on port ${env.port}.`);
  });
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

startServer().catch(async (error) => {
  console.error("Failed to start server.", error);
  await closeDatabase();
  process.exit(1);
});
