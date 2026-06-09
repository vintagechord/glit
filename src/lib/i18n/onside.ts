export type Locale = "ko" | "en";

type Messages = Record<string, string>;

export const onsideMessages: Record<Locale, Messages> = {
  ko: {
    "site.title": "온사이드",
    "site.description": "음반·뮤직비디오 방송심의 접수 지원 서비스",
    "nav.home": "홈",
    "nav.services": "서비스",
    "nav.apply": "신청",
    "nav.pricing": "가격",
    "nav.faq": "FAQ",
    "nav.login": "로그인",
    "nav.my_requests": "나의 접수",
    "hero.title": "음반·뮤직비디오 방송심의 접수 지원",
    "hero.subtitle": "온사이드는 국내 방송심의 접수 진행을 지원합니다.",
    "hero.cta_primary": "신청 시작",
    "hero.cta_secondary": "요건 보기",
    "notice.no_guarantee":
      "온사이드는 국내 방송심의 접수 진행을 지원하는 서비스입니다. 심의 통과, 방송 송출, 편성, 플레이리스트 반영, 방송 보상금 발생을 보장하지 않습니다.",
    "footer.disclaimer":
      "심의 요건은 방송사, 콘텐츠 유형, 언어, 제출 자료에 따라 달라질 수 있습니다.",
  },
  en: {
    "site.title": "Onside",
    "site.description":
      "Korean Broadcast Review Submission Service for global artists, labels, and distributors.",
    "nav.home": "Home",
    "nav.services": "Services",
    "nav.apply": "Apply",
    "nav.pricing": "Pricing",
    "nav.faq": "FAQ",
    "nav.login": "Login",
    "nav.my_requests": "My Requests",
    "hero.title": "Korean Broadcast Review Submission for Global Artists",
    "hero.subtitle":
      "Onside helps overseas artists, labels, and distributors prepare and submit music materials for Korean broadcast review.",
    "hero.cta_primary": "Start Submission",
    "hero.cta_secondary": "View Requirements",
    "service.album_review.title": "Korean Broadcast Music Review Submission",
    "service.album_review.description":
      "For singles, albums, and music releases that need guided submission support for Korean broadcast review.",
    "service.mv_review.title": "Korean Broadcast MV Review Submission",
    "service.mv_review.description":
      "For music videos that need video material checks, metadata organization, and broadcast review submission support.",
    "service.translation_addon.title": "Korean Lyric Translation Add-on",
    "service.translation_addon.description":
      "Preparation support for Korean lyric translations when non-Korean lyrics need to be reviewed with supporting materials.",
    "form.artist_name": "Artist name",
    "form.artist_country": "Country",
    "form.label_name": "Label / Company name",
    "form.contact_email": "Contact email",
    "form.song_title": "Song title",
    "form.album_title": "Album title",
    "form.release_date": "Release date",
    "form.content_type": "Content type",
    "form.lyrics_original": "Original lyrics",
    "form.lyrics_korean_translation": "Korean lyric translation",
    "form.audio_file": "Audio file link",
    "form.cover_image": "Cover image link",
    "form.music_video_url": "Music video URL",
    "form.rights_holder": "Rights holder name",
    "form.distributor": "Distributor name",
    "form.notes": "Notes",
    "payment.method": "Payment method",
    "payment.paypal": "PayPal",
    "payment.total": "Total",
    "payment.currency": "Currency",
    "payment.status": "Payment status",
    "notice.no_guarantee":
      "Onside provides submission support for Korean broadcast review. Approval, broadcast airplay, programming, playlisting, and royalty collection are not guaranteed.",
    "notice.not_distribution":
      "This service is not music distribution, playlist pitching, or a promise of airplay.",
    "notice.translation_required":
      "Broadcasters may request Korean lyric translations depending on language and submitted materials.",
    "faq.title": "Frequently Asked Questions",
    "faq.q1": "Does this service guarantee approval or airplay?",
    "faq.a1":
      "No. Onside supports the submission process for Korean broadcast review only. Approval, broadcast airplay, programming, playlisting, and royalty collection are not guaranteed.",
    "footer.disclaimer":
      "Broadcast review requirements may vary depending on broadcaster, content type, language, and submitted materials.",
  },
};

export const getOnsideMessage = (locale: Locale, key: string) =>
  onsideMessages[locale][key] ?? onsideMessages.en[key] ?? key;
