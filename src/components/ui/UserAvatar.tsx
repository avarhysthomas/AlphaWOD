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
  const [loadedPhotoURL, setLoadedPhotoURL] = useState<string | null>(null);
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
          ? "relative grid shrink-0 place-items-center overflow-hidden rounded-full"
          : "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-neutral-800 bg-neutral-900 text-xs font-bold text-white/70"
      }
    >
      <span aria-hidden="true">{initials}</span>
      {showPhoto ? (
        <img
          src={resolvedPhotoURL}
          alt={name ? label : ""}
          decoding="async"
          onLoad={() => setLoadedPhotoURL(resolvedPhotoURL || null)}
          onError={() => {
            setLoadedPhotoURL(null);
            setFailedPhotoURL(resolvedPhotoURL || null);
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 motion-reduce:transition-none ${
            loadedPhotoURL === resolvedPhotoURL ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </div>
  );
}
