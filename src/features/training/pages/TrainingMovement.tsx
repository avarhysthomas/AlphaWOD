import React from "react";
import { useParams, Navigate } from "react-router-dom";
import { getMovementBySlug } from "../../../lib/training";
import TrainingStandardMovement from "./TrainingStandardMovement";

export default function TrainingMovement() {
  const { category, movementSlug } = useParams<{
    category: string;
    movementSlug: string;
  }>();

  const result = getMovementBySlug(category, movementSlug);

  if (!result) {
    return <Navigate to="/training" replace />;
  }

  return <TrainingStandardMovement />;
}
