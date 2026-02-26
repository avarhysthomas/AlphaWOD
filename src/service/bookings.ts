import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "europe-west1");

export const bookClass = httpsCallable(functions, "bookClass");
export const cancelBooking = httpsCallable(functions, "cancelBooking");