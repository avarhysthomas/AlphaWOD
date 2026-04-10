import React, { useRef, useState } from "react";
import SessionShareCard, { getSessionShareCardHeight } from "./SessionShareCard";
import styles from "../../../styles/PBShareModal.module.css";
import { exportNodeToPng } from "../../../utils/shareExport";

type SessionShareModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  filename: string;
  shareTitle: string;
  shareText: string;
  dateLabel: string;
  sessionLabel: string;
  sessionTimeLabel?: string;
  sessionType: string;
  sessionStyle: string;
  sessionExtra?: string;
  highlight: string;
  highlightLabel: string;
  stationsLabel: string;
  coachNote?: string;
  items: string[];
};

export default function SessionShareModal({
  open,
  onClose,
  title,
  subtitle,
  filename,
  shareTitle,
  shareText,
  dateLabel,
  sessionLabel,
  sessionTimeLabel,
  sessionType,
  sessionStyle,
  sessionExtra,
  highlight,
  highlightLabel,
  stationsLabel,
  coachNote,
  items,
}: SessionShareModalProps) {
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const cardHeight = getSessionShareCardHeight(items, coachNote);
  const previewScale = Math.max(0.2, Math.min(0.36, 390 / cardHeight));

  if (!open) return null;

  async function shareImage() {
    if (!exportRef.current) return;

    try {
      setIsExporting(true);
      const dataUrl = await exportNodeToPng(exportRef.current, {
        logoOpacity: 0.2,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const file = new File([blob], filename, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          files: [file],
        });
      } else {
        const link = document.createElement("a");
        link.download = filename;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Failed to share session card", error);
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
        aria-labelledby="session-share-title"
      >
        <div className={`${styles.header} ${styles.sessionHeader}`}>
          <div className={styles.copy}>
            <h2 id="session-share-title" className={styles.title}>
              <span className={styles.sessionTitleLine}>Share today&apos;s</span>
              <span className={styles.sessionTitleLine}>session</span>
            </h2>
            <p className={styles.subtitle}>
              Don't forget to tag @zeroalphafitness.
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
                    <SessionShareCard
                      dateLabel={dateLabel}
                      sessionLabel={sessionLabel}
                      sessionTimeLabel={sessionTimeLabel}
                      sessionType={sessionType}
                      sessionStyle={sessionStyle}
                      sessionExtra={sessionExtra}
                      title={title}
                      subtitle={subtitle}
                      highlight={highlight}
                      highlightLabel={highlightLabel}
                      stationsLabel={stationsLabel}
                      coachNote={coachNote}
                      items={items}
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
