import React, { useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import PBShareCard from "./PBShareCard";

type PBShareModalProps = {
  open: boolean;
  onClose: () => void;
  athleteName?: string;
  movement: string;
  metricType: string;
  value: string;
  unit?: string;
  dateLabel?: string;
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
}: PBShareModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!open) return null;

  async function exportPng() {
    if (!cardRef.current) return;

    try {
      setIsExporting(true);

      const dataUrl = await htmlToImage.toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "transparent",
      });

      const link = document.createElement("a");
      link.download = `${movement.toLowerCase().replace(/\s+/g, "-")}-pb.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("Failed to export PB image", error);
    } finally {
      setIsExporting(false);
    }
  }

  async function shareImage() {
    if (!cardRef.current) return;

    try {
      setIsExporting(true);

      const blob = await htmlToImage.toBlob(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "transparent",
      });

      if (!blob) return;

      const file = new File([blob], `${movement}-pb.png`, {
        type: "image/png",
      });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `${movement} PB`,
          text: `New PB: ${movement} ${metricType}`,
          files: [file],
        });
      } else {
        const link = document.createElement("a");
        link.download = `${movement.toLowerCase().replace(/\s+/g, "-")}-pb.png`;
        link.href = URL.createObjectURL(blob);
        link.click();
      }
    } catch (error) {
      console.error("Failed to share PB image", error);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-white">Share PB</h2>
              <p className="mt-1 text-sm text-white/60">
                Export a transparent Zero Alpha PB sticker.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            >
              Close
            </button>
          </div>

            <div className="mb-5 rounded-[24px] border border-white/10 bg-black/40 p-4">
            <div className="relative mx-auto h-[360px] w-full max-w-[320px] overflow-hidden rounded-[20px]">
                <div className="absolute left-1/2 top-0 origin-top -translate-x-1/2 scale-[0.34] sm:scale-[0.4] md:scale-[0.46]">
                <div ref={cardRef}>
                    <PBShareCard
                    athleteName={athleteName}
                    movement={movement}
                    metricType={metricType}
                    value={value}
                    unit={unit}
                    dateLabel={dateLabel}
                    />
                </div>
                </div>
            </div>
            </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={exportPng}
              disabled={isExporting}
              className="rounded-[18px] border border-white/15 bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              {isExporting ? "Exporting..." : "Download PNG"}
            </button>

            <button
              type="button"
              onClick={shareImage}
              disabled={isExporting}
              className="rounded-[18px] border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-60"
            >
              {isExporting ? "Preparing..." : "Share"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}