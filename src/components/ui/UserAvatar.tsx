import { useState } from "react";

export default function UserAvatar({
  name,
  photoURL,
  size = 40,
  appearance = "default",
  fallback,
}: {
  name?: string;
  photoURL?: string;
  size?: number;
  appearance?: "default" | "plain";
  fallback?: string;
}) {
  const [failedPhotoURL, setFailedPhotoURL] = useState<string | null>(null);
  const resolvedPhotoURL = photoURL?.trim();
  const initials =
    fallback?.trim() ||
    name
      ?.trim()
      .split(/\s+/)
      .map((part) => Array.from(part)[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() ||
    "M";
  const showPhoto = Boolean(resolvedPhotoURL && resolvedPhotoURL !== failedPhotoURL);
  const label = name ? `${name}'s profile picture` : "Profile picture";

  return (
    <div
      {...(!showPhoto ? { role: "img", "aria-label": label } : {})}
      style={{ width: size, height: size }}
      className={
        appearance === "plain"
          ? "grid shrink-0 place-items-center overflow-hidden rounded-full"
          : "grid shrink-0 place-items-center overflow-hidden rounded-full border border-neutral-800 bg-neutral-900 text-xs font-bold text-white/70"
      }
    >
      {showPhoto ? (
        <img
          src={resolvedPhotoURL}
          alt={name ? label : ""}
          onError={() => setFailedPhotoURL(resolvedPhotoURL || null)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}
