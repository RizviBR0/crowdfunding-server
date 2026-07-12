import { ApiError } from "../errors/ApiError.js";

const ROLE_GRANTS = {
  supporter: 50,
  creator: 20,
};

const normalizeEmail = (email) => email.trim().toLowerCase();

const publicUser = (user) => ({
  id: user._id?.toString(),
  firebaseUid: user.firebaseUid,
  displayName: user.displayName,
  email: user.email,
  photoUrl: user.photoUrl,
  role: user.role,
  credits: user.credits,
  creatorBalance: user.creatorBalance,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const runInTransaction = async (database, operation) => {
  const session = database.client?.startSession ? database.client.startSession() : null;

  if (!session) {
    return operation(undefined);
  }

  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
};

const getRoleForNewUser = ({ email, intendedRole, adminBootstrapEmails }) => {
  if (adminBootstrapEmails.includes(email)) {
    return "admin";
  }

  if (!intendedRole) {
    throw new ApiError(400, "ROLE_REQUIRED", "Select Supporter or Creator before first sign-in.");
  }

  if (!Object.hasOwn(ROLE_GRANTS, intendedRole)) {
    throw new ApiError(400, "INVALID_ROLE", "Registration role must be supporter or creator.");
  }

  return intendedRole;
};

const createUserDocument = ({ decodedToken, email, role, now }) => {
  const grant = ROLE_GRANTS[role] ?? 0;
  const grantKey = grant > 0 ? `registration:${decodedToken.uid}` : undefined;

  return {
    firebaseUid: decodedToken.uid,
    displayName: decodedToken.name?.trim() || decodedToken.email?.split("@")[0] || "FundBloom User",
    email,
    photoUrl: decodedToken.picture || "",
    role,
    credits: grant,
    creatorBalance: {
      lifetimeRaised: 0,
      reservedForWithdrawal: 0,
      withdrawn: 0,
    },
    status: "active",
    initialCreditGrantKey: grantKey,
    createdAt: now,
    updatedAt: now,
  };
};

const createGrantLedger = ({ userId, role, amount, grantKey, now }) => ({
  userId,
  type: "registration_grant",
  amount,
  balanceType: "credits",
  referenceType: "user",
  referenceId: userId.toString(),
  idempotencyKey: grantKey,
  balanceAfter: amount,
  createdAt: now,
  metadata: {
    role,
    reason: "initial_registration_credit",
  },
});

export const exchangeFirebaseSession = async ({
  firebaseIdToken,
  intendedRole,
  database,
  firebaseAuth,
  adminBootstrapEmails = [],
  now = new Date(),
}) => {
  let decodedToken;

  try {
    decodedToken = await firebaseAuth.verifyIdToken(firebaseIdToken);
  } catch {
    throw new ApiError(401, "INVALID_FIREBASE_TOKEN", "Firebase identity token is invalid or expired.");
  }

  if (!decodedToken.email) {
    throw new ApiError(400, "EMAIL_REQUIRED", "Firebase identity must include an email address.");
  }

  const email = normalizeEmail(decodedToken.email);
  const normalizedAdminEmails = adminBootstrapEmails.map(normalizeEmail);
  const users = database.collection("users");
  const ledger = database.collection("creditTransactions");

  const user = await runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;
    const existingUser = await users.findOne(
      { $or: [{ firebaseUid: decodedToken.uid }, { email }] },
      sessionOption,
    );

    if (existingUser) {
      if (existingUser.firebaseUid && existingUser.firebaseUid !== decodedToken.uid) {
        throw new ApiError(409, "AUTH_IDENTITY_CONFLICT", "This email is already linked to another identity.");
      }

      if (!existingUser.firebaseUid) {
        await users.updateOne(
          { _id: existingUser._id },
          {
            $set: {
              firebaseUid: decodedToken.uid,
              updatedAt: now,
            },
          },
          sessionOption,
        );

        return { ...existingUser, firebaseUid: decodedToken.uid, updatedAt: now };
      }

      return existingUser;
    }

    const role = getRoleForNewUser({
      email,
      intendedRole,
      adminBootstrapEmails: normalizedAdminEmails,
    });
    const newUser = createUserDocument({ decodedToken, email, role, now });

    try {
      const insertResult = await users.insertOne(newUser, sessionOption);
      const insertedUser = { ...newUser, _id: insertResult.insertedId };

      if (newUser.initialCreditGrantKey) {
        await ledger.insertOne(
          createGrantLedger({
            userId: insertResult.insertedId,
            role,
            amount: newUser.credits,
            grantKey: newUser.initialCreditGrantKey,
            now,
          }),
          sessionOption,
        );
      }

      return insertedUser;
    } catch (error) {
      if (error?.code === 11000) {
        const recoveredUser = await users.findOne(
          { $or: [{ firebaseUid: decodedToken.uid }, { email }] },
          sessionOption,
        );

        if (recoveredUser) {
          return recoveredUser;
        }
      }

      throw error;
    }
  });

  return {
    user: publicUser(user),
    isNewUser: user.createdAt?.getTime?.() === now.getTime(),
  };
};
