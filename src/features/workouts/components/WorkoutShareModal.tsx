import React, { useLayoutEffect, useRef, useState } from "react";
import styles from "../../../styles/PBShareModal.module.css";
import { exportNodeToPng } from "../../../utils/shareExport";
import type { WorkoutSession } from "../types";
import WorkoutShareCard, { getWorkoutShareCardHeight } from "./WorkoutShareCard";

type WorkoutShareModalProps = {
  open: boolean;
  onClose: () => void;
  workout: WorkoutSession;
  saluteCount?: number;
};

export default function WorkoutShareModal({
  open,
  onClose,
  workout,
  saluteCount = 0,
}: WorkoutShareModalProps) {
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const estimatedHeight = getWorkoutShareCardHeight(workout, saluteCount);
  const [cardHeight, setCardHeight] = useState(estimatedHeight);
  const previewScale = Math.max(0.18, Math.min(0.36, 390 / cardHeight));

  useLayoutEffect(() => {
    if (!open) return;

    setCardHeight(estimatedHeight);

    if (!exportRef.current) return;

    const measure = () => {
      if (!exportRef.current) return;
      const cardNode = exportRef.current.firstElementChild as HTMLElement | null;
      const nextHeight = Math.ceil(
        cardNode?.offsetHeight ||
          exportRef.current.scrollHeight ||
          exportRef.current.offsetHeight
      );
      if (nextHeight > 0) {
        setCardHeight(nextHeight);
      }
    };

    measure();

    const animationId = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(animationId);
  }, [estimatedHeight, open]);

  if (!open) return null;

  async function shareImage() {
    if (!exportRef.current) return;

    try {
      setIsExporting(true);
      const dataUrl = await exportNodeToPng(exportRef.current);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const fileName = `${workout.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workout"}-share.png`;
      const file = new File([blob], fileName, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `${workout.title} workout`,
          text: `${workout.userName} logged ${workout.title}`,
          files: [file],
        });
      } else {
        const link = document.createElement("a");
        link.download = fileName;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Failed to share workout card", error);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workout-share-title"
      >
        <div className={`${styles.header} ${styles.sessionHeader}`}>
          <div className={styles.copy}>
            <h2 id="workout-share-title" className={styles.title}>
              <span className={styles.sessionTitleLine}>Share your</span>
              <span className={styles.sessionTitleLine}>workout</span>
            </h2>
            <p className={styles.subtitle}>
              Full workout detail, ready to post.
            </p>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className={styles.previewSection}>
          <p className={styles.previewLabel}>Preview</p>

          <div className={styles.previewFrame}>
            <div className={`${styles.previewStage} ${styles.sessionPreviewStage}`}>
              <div
                className={styles.sessionPreviewScale}
                style={{
                  ["--session-card-height" as string]: `${cardHeight}px`,
                  ["--session-preview-scale" as string]: `${previewScale}`,
                }}
              >
                <div className={styles.sessionPreviewViewport}>
                  <div ref={exportRef} className={styles.exportSurface}>
                    <WorkoutShareCard
                      workout={workout}
                      saluteCount={saluteCount}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={shareImage}
            disabled={isExporting}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
