import { MongoClient } from "mongodb";

import { env } from "./env.js";
import { ApiError } from "../errors/ApiError.js";

let client;
let database;
let status = {
  state: "not_configured",
  lastError: null,
};

export const connectToDatabase = async ({
  mongoUri = env.mongoUri,
  mongoDbName = env.mongoDbName,
} = {}) => {
  if (database) {
    return database;
  }

  if (!mongoUri) {
    status = { state: "not_configured", lastError: null };
    return null;
  }

  status = { state: "connecting", lastError: null };
  client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await client.connect();
    database = client.db(mongoDbName);
    database.client = client;
    await database.command({ ping: 1 });
    status = { state: "connected", lastError: null };
    return database;
  } catch (error) {
    status = { state: "error", lastError: error.message };
    await client.close();
    client = null;
    database = null;
    throw error;
  }
};

export const getDatabase = () => {
  if (!database) {
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Database connection is not available.");
  }

  return database;
};

export const getDatabaseStatus = () => ({
  status: status.state,
  lastError: status.lastError,
});

export const closeDatabase = async () => {
  if (client) {
    await client.close();
  }

  client = null;
  database = null;
  status = { state: "not_configured", lastError: null };
};
