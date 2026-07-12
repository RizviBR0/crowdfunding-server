import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import { env } from "./env.js";

const createCredential = (config) => {
  if (config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey) {
    return cert({
      projectId: config.firebaseProjectId,
      clientEmail: config.firebaseClientEmail,
      privateKey: config.firebasePrivateKey,
    });
  }

  return applicationDefault();
};

export const getFirebaseAuth = (config = env) => {
  if (getApps().length === 0) {
    initializeApp({
      credential: createCredential(config),
      projectId: config.firebaseProjectId,
    });
  }

  return getAuth();
};
