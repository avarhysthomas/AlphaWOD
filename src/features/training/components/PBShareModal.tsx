import React, { useRef, useState } from "react";
import PBShareCard from "./PBShareCard";
import styles from "../../../styles/PBShareModal.module.css";
import { exportNodeToPng } from "../../../utils/shareExport";
import type { TrainingCategoryKey } from "../../../lib/training";

type PBShareModalProps = {
  open: boolean;
  onClose: () => void;
  athleteName?: string;
  movement: string;
  metricType: string;
  value: string;
  unit?: string;
  dateLabel?: string;
  categoryKey?: TrainingCategoryKey | null;
};

export default function PBShareModal({
  open,
  onClose,
  athleteName,
  movement,
  metricType,
  value,
  unit,
  dateLabel,
  categoryKey,
}: PBShareModalProps) {
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!open) return null;

  async function shareImage() {
    if (!exportRef.current) return;

    try {
      setIsExporting(true);
      const dataUrl = await exportNodeToPng(exportRef.current, {
        logoOpacity: 0.22,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const file = new File(
        [blob],
        `${movement.toLowerCase().replace(/\s+/g, "-")}-pb.png`,
        { type: "image/png" }
      );

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `${movement} PB`,
          text: `New PB: ${movement} - ${value}${unit ? ` ${unit}` : ""}`,
          files: [file],
        });
      } else {
        const link = document.createElement("a");
        link.download = `${movement.toLowerCase().replace(/\s+/g, "-")}-pb.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Failed to share PB card", error);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.pbModal}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pb-share-title"
      >
        <div className={`${styles.header} ${styles.pbHeader}`}>
          <div className={styles.copy}>
            <h2 id="pb-share-title" className={styles.title}>
              <span className={styles.pbTitleLine}>Share your</span>
              <span className={styles.pbTitleLine}>stats</span>
            </h2>
            <p className={styles.subtitle}>
              Don't forget to tag @zeroalphafitness.
            </p>
          </div>

          <button
            type="button"
            className={`${styles.closeButton} ${styles.pbCloseButton}`}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className={styles.previewSection}>
          <p className={styles.previewLabel}>Preview</p>

          <div className={styles.previewFrame}>
            <div className={styles.previewStage}>
              <div className={styles.previewScale}>
                <div ref={exportRef} className={styles.exportSurface}>
                  <PBShareCard
                    athleteName={athleteName}
                    movement={movement}
                    metricType={metricType}
                    value={value}
                    unit={unit}
                    dateLabel={dateLabel}
                    categoryKey={categoryKey}
                  />
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
