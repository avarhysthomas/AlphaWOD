import { getFirestore } from 'firebase/firestore';
import app, { auth } from "./firebaseApp";

const db = getFirestore(app);

export { auth, db };
export default app;
