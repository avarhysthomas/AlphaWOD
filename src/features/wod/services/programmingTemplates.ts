import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import {
  SessionPlan,
  cleanSessionPlan,
  normalizeSessionPlan,
} from "../utils/programming";

export type ProgrammingTemplate = {
  id: string;
  name: string;
  plan: SessionPlan;
  createdAtMs: number | null;
};

const COLLECTION = "wodTemplates";

export async function listTemplates(): Promise<ProgrammingTemplate[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTION), orderBy("createdAt", "desc"))
  );

  return snap.docs.map((docSnap) => {
    const data = docSnap.data() as any;
    return {
      id: docSnap.id,
      name: String(data?.name ?? "Untitled template"),
      plan: normalizeSessionPlan(data),
      createdAtMs: data?.createdAt?.toMillis?.() ?? null,
    };
  });
}

export async function saveTemplate(name: string, plan: SessionPlan) {
  const cleaned = cleanSessionPlan(plan);

  await addDoc(collection(db, COLLECTION), {
    name: name.trim() || cleaned.wodName || "Untitled template",
    wodName: cleaned.wodName,
    blocks: cleaned.blocks,
    createdAt: serverTimestamp(),
  });
}

export async function deleteTemplate(templateId: string) {
  await deleteDoc(doc(db, COLLECTION, templateId));
}
