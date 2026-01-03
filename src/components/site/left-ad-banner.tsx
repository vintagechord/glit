import Image from "next/image";

import { createServerSupabase } from "@/lib/supabase/server";

type AdBanner = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

function isBannerActive(banner: AdBanner, now: Date) {
  const startsOk = !banner.starts_at || new Date(banner.starts_at) <= now;
  const endsOk = !banner.ends_at || new Date(banner.ends_at) >= now;
  return startsOk && endsOk;
}

export async function LeftAdBanner() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("ad_banners")
    .select("id, title, image_url, link_url, starts_at, ends_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return null;

  const now = new Date();
  const banner = data.find((item) => isBannerActive(item, now));

  if (!banner) return null;

  const content = (
    <div className="rounded-[28px] border border-border/60 bg-card/90 p-3 shadow-[0_18px_60px_rgba(15,23,42,0.2)]">
      <Image
        src={banner.image_url}
        alt={banner.title}
        width={360}
        height={200}
        className="w-full rounded-2xl object-cover"
      />
      <p className="mt-3 text-xs font-semibold text-foreground">
        {banner.title}
      </p>
    </div>
  );

  return (
    <div className="pointer-events-none fixed left-6 top-28 z-30 hidden w-[180px] xl:block">
      {banner.link_url ? (
        <a
          href={banner.link_url}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto block"
        >
          {content}
        </a>
      ) : (
        <div className="pointer-events-auto">{content}</div>
      )}
    </div>
  );
}
