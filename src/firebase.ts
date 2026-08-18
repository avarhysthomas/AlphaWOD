import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
import app, { auth, useEmulators } from "./firebaseApp";

const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Connected here rather than in firebaseApp.ts because it must happen on this
// exact instance, immediately after it is created and before any read.
if (useEmulators) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export { auth, db };
export default app;
