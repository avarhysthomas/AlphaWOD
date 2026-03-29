export default function UserAvatar({
  name,
  photoURL,
  size = 40,
}: {
  name?: string;
  photoURL?: string;
  size?: number;
}) {
  const initials =
    name?.split(" ").map(n => n[0]).slice(0,2).join("").toUpperCase() || "M";

  return photoURL ? (
    <img
      src={photoURL}
      alt={name ? `${name}'s profile picture` : ""}
      style={{ width: size, height: size }}
      className="rounded-full object-cover border border-neutral-800"
    />
  ) : (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-neutral-900 grid place-items-center border border-neutral-800 text-xs font-bold text-white/70"
    >
      {initials}
    </div>
  );
}