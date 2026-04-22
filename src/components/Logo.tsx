import Image from "next/image";

type Variant = "full" | "mark";
type Size = "sm" | "md" | "lg" | "xl";

const dims: Record<Variant, Record<Size, { w: number; h: number }>> = {
  full: {
    sm: { w: 132, h: 32 },
    md: { w: 180, h: 44 },
    lg: { w: 240, h: 58 },
    xl: { w: 720, h: 174 },
  },
  mark: {
    sm: { w: 28, h: 28 },
    md: { w: 36, h: 36 },
    lg: { w: 48, h: 48 },
    xl: { w: 96, h: 96 },
  },
};

export function Logo({
  variant = "full",
  size = "sm",
  className = "",
  priority = false,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  priority?: boolean;
}) {
  const { w, h } = dims[variant][size];
  const src = variant === "full" ? "/logo.png" : "/logo-mark.png";
  return (
    <Image
      src={src}
      alt="LeadFlow"
      width={w}
      height={h}
      priority={priority}
      className={className}
      style={{ width: "auto", height: h, maxWidth: "100%" }}
    />
  );
}
