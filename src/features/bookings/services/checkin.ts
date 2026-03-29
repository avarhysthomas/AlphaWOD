import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "europe-west1");

export const checkInBooking = httpsCallable(functions, "checkInBooking");