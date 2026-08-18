import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebaseApp";

const functions = getFunctions(app, "europe-west1");

type BootstrapUserProfileRequest = {
  displayName: string;
};

type CallableSuccess = {
  ok: boolean;
};

export type AcceptCurrentWaiverRequest = {
  acceptedName: string;
  waiverVersion: string;
  acknowledgements: string[];
  mediaConsent: boolean;
};

type AcceptCurrentWaiverCallableRequest = {
  signedName: string;
  version: string;
  acknowledgements: string[];
  mediaConsent: boolean;
};

export async function bootstrapUserProfile(name: string) {
  const callable = httpsCallable<BootstrapUserProfileRequest, CallableSuccess>(
    functions,
    "bootstrapUserProfile"
  );
  const response = await callable({ displayName: name.trim() });
  return response.data;
}

export async function acceptCurrentWaiver(
  acceptance: AcceptCurrentWaiverRequest
) {
  const callable = httpsCallable<AcceptCurrentWaiverCallableRequest, CallableSuccess>(
    functions,
    "acceptCurrentWaiver"
  );
  const response = await callable({
    signedName: acceptance.acceptedName,
    version: acceptance.waiverVersion,
    acknowledgements: acceptance.acknowledgements,
    mediaConsent: acceptance.mediaConsent,
  });
  return response.data;
}
