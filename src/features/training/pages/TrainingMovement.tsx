import React from "react";
import { useParams, Navigate } from "react-router-dom";
import { getMovementBySlug } from "../../../lib/training";
import TrainingStandardMovement from "./TrainingStandardMovement";
import TrainingLinkedMovement from "../pages/TrainingLinkedMovement";

export default function TrainingMovement() {
  const { category, movementSlug } = useParams<{
    category: string;
    movementSlug: string;
  }>();

  const result = getMovementBySlug(category, movementSlug);

  if (!result) {
    return <Navigate to="/training" replace />;
  }

  const { movement } = result;

  // 🔥 KEY LOGIC
  if (movement.pageMode === "linked") {
    return <TrainingLinkedMovement />;
  }

  return <TrainingStandardMovement />;
}