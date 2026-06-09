"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const exactTranslations: Record<string, string> = {
  "심의 신청": "Apply",
  "진행/결과 조회": "Progress / Results",
  "이용가이드": "Guide",
  "고객센터": "Support",
  "로그인": "Login",
  "로그아웃": "Logout",
  "마이페이지": "My Page",
  "지금 신청": "Apply Now",
  "다크": "Dark",
  "라이트": "Light",
  "결과 조회": "Results",
  "심의 신청부터": "From Submission",
  "결과 확인까지": "to Result Check",
  "음반·뮤직비디오 심의를 온라인으로 접수하고, 진행 현황과 결과 파일을 한 곳에서 확인하세요.":
    "Submit album and music video reviews online, then check progress and result files in one place.",
  "신청 유형": "Review Type",
  "필요한 심의만 선택하세요": "Choose the Review You Need",
  "온라인 접수가 어렵다면 구버전 신청서 작성 방식 안내 →":
    "If online submission is difficult, see the legacy form guide →",
  "방송국별 음반 심의": "Broadcaster Album Review",
  "음반 심의": "Album Review",
  "TV·라디오 송출용 음원 심의.": "For TV and radio broadcast music review.",
  "온라인 유통/업로드": "Online Distribution / Upload",
  "뮤직비디오 온라인 심의": "Music Video Online Review",
  "유통사 제출·온라인 업로드용.": "For distributor submission and online upload.",
  "TV 송출 목적": "TV Broadcast",
  "뮤직비디오 TV 송출 심의": "Music Video TV Broadcast Review",
  "방송국별 조건 확인 후 접수.": "Submit after checking broadcaster requirements.",
  "시작": "Start",
  "무엇을 신청하시나요?": "What would you like to submit?",
  "비회원도 접수할 수 있습니다.": "Guest submissions are available.",
  "로그인하면 접수 내역이 마이페이지에 저장됩니다.":
    "If you log in, submissions are saved to My Page.",
  "TV·라디오 송출용 음원 심의입니다.": "Music review for TV and radio broadcast.",
  "유통사 제출과 온라인 업로드용입니다.":
    "For distributor submission and online upload.",
  "방송국별 조건을 확인한 뒤 접수합니다.":
    "Submit after checking each broadcaster's requirements.",
  "바로 시작": "Start",
  "파일 업로드가 안 될 경우, 신청은 사이트에서 진행하고 파일만 이메일로 보내주세요.":
    "If file upload does not work, submit the application on the site and send only the files by email.",
  "구버전 신청서 작성 방식 안내": "Legacy form guide",
  "진행상황": "Progress",
  "접수 현황": "Submission Status",
  "접수한 심의의 현재 상태를 확인할 수 있습니다.":
    "Check the current status of your submitted reviews.",
  "나의 심의 내역": "My Review History",
  "심의 기록을 발매 음원 단위로 확인합니다.":
    "View review records by release.",
  "조회 방식을 선택하세요": "Choose a Lookup Method",
  "비회원 진행/결과 조회": "Guest Progress / Result Lookup",
  "회원은 로그인 후 접수 현황으로 이동하고, 비회원은 조회 코드로 진행 상태와 결과를 확인합니다.":
    "Members can log in to view submission status. Guests can check progress and results with a lookup code.",
  "접수 시 발급받은 조회 코드를 입력하면 진행 상태와 결과를 확인할 수 있습니다.":
    "Enter the lookup code issued after submission to check progress and results.",
  "조회 코드": "Lookup Code",
  "비회원 조회 코드 입력": "Enter guest lookup code",
  "진행상황 조회": "Check Progress",
  "조회 코드 찾기": "Find Lookup Code",
  "조회 코드를 잊은 경우 접수자 이름과 이메일로 조회 코드를 확인할 수 있습니다.":
    "If you forgot the lookup code, you can find it with the applicant name and email.",
  "접수자 이름": "Applicant Name",
  "접수자 이메일": "Applicant Email",
  "조회 중...": "Searching...",
  "확인 중...": "Checking...",
  "회원 조회": "Member Lookup",
  "비회원 조회": "Guest Lookup",
  "로그인한 계정의 접수 현황과 심의 내역을 바로 확인합니다.":
    "Log in to view saved submissions and review history.",
  "로그인한 계정의 접수 현황과 심의 내역으로 이동합니다.":
    "Go to the submission status and review history saved in your account.",
  "접수 시 발급받은 조회 코드 또는 이름/이메일로 진행 결과를 확인합니다.":
    "Use the lookup code, name, or email issued at submission to check results.",
  "비회원 조회 코드 화면": "Guest Lookup Code Screen",
  "방송국별 진행 현황 예시": "Broadcaster Progress Example",
  "뮤직비디오 결과 수령 예시": "Music Video Result Example",
  "온라인 유통 심의": "Online Distribution Review",
  "나의 심의": "My Reviews",
  "진행 현황 예시": "Progress Example",
  "진행 현황": "Progress",
  "앨범": "Album",
  "온사이드 로그인": "Onside Login",
  "온사이드 회원가입": "Onside Sign Up",
  "회원가입": "Sign Up",
  "회원가입이 완료되었습니다. 로그인 후 접수와 결과 확인을 이어서 진행할 수 있습니다.":
    "Sign up is complete. Log in to continue submission and result checking.",
  "이메일": "Email",
  "비밀번호": "Password",
  "이메일 주소": "Email Address",
  "비밀번호 확인": "Confirm Password",
  "계정 만들기": "Create Account",
  "이미 계정이 있으신가요?": "Already have an account?",
  "으로 이동하세요.": "to continue.",
  "결제하기": "Payment",
  "결제 상태": "Payment Status",
  "결제 금액": "Payment Amount",
  "결제 방식": "Payment Method",
  "카드 결제": "Card Payment",
  "무통장 입금": "Bank Transfer",
  "무통장 입금 안내": "Bank Transfer Information",
  "결제가 완료된 접수입니다.": "Payment is complete for this submission.",
  "카드": "Card",
  "미결제": "Unpaid",
  "결제 대기": "Payment Pending",
  "은행": "Bank",
  "계좌번호": "Account Number",
  "예금주": "Account Holder",
  "문의하기": "Contact",
  "나의 심의 내역으로": "Go to My Review History",
  "방송국 패키지 선택": "Broadcaster Package",
  "신청서 작성": "Application Form",
  "파일 업로드": "File Upload",
  "결제": "Payment",
  "패키지": "Package",
  "선택됨": "Selected",
  "가장 많이 선택": "Most Selected",
  "아티스트명": "Artist Name",
  "앨범 제목": "Album Title",
  "곡명": "Song Title",
  "발매일": "Release Date",
  "장르": "Genre",
  "유통사": "Distributor",
  "제작사": "Production Company",
  "신청자명": "Applicant Name",
  "연락처": "Phone",
  "회사명": "Company",
  "담당자": "Contact Person",
  "가사": "Lyrics",
  "번역": "Translation",
  "메모": "Memo",
  "저장": "Save",
  "임시 저장": "Save Draft",
  "다음": "Next",
  "이전": "Previous",
  "제출": "Submit",
  "접수하기": "Submit",
  "신청하기": "Apply",
  "현재 파일": "Current File",
  "다운로드": "Download",
  "심의 상세": "Review Detail",
  "접수 정보": "Submission Information",
  "방송국별 진행표": "Broadcaster Progress",
  "심의 진행 상황": "Review Progress",
  "심의 결과": "Review Result",
  "필증": "Certificate",
  "심의 등급": "Review Rating",
  "가이드": "Guide",
  "결과": "Result",
  "상태": "Status",
  "업데이트": "Updated",
  "방송국": "Broadcaster",
  "접수 상태": "Submission Status",
  "트랙 결과": "Track Result",
  "대기": "Pending",
  "접수대기": "Waiting",
  "심의진행중": "In Review",
  "결과통보": "Result Notified",
  "수정요청": "Revision Requested",
  "결제 확인": "Payment Confirmed",
  "접수 완료": "Submitted",
  "접수 대기": "Waiting",
  "심의 진행": "In Review",
  "결과 전달": "Result Delivered",
};

const phraseTranslations: Array<[RegExp, string]> = [
  [/비회원 조회 코드 화면/g, "Guest Lookup Code Screen"],
  [/방송국별 진행 현황 예시/g, "Broadcaster Progress Example"],
  [/방송국별/g, "Broadcaster"],
  [/뮤직비디오 결과 수령 예시/g, "Music Video Result Example"],
  [/온라인 유통 심의/g, "Online Distribution Review"],
  [/(\d+)개 패키지/g, "$1 Broadcaster Package"],
  [/(\d+)곳 패키지/g, "$1 Broadcaster Package"],
  [/(\d+)원/g, "KRW $1"],
  [/총 결제금액/g, "Total Payment Amount"],
  [/진행중 (\d+)건/g, "$1 active"],
  [/접수한 심의/g, "Submitted reviews"],
  [/아티스트 미입력/g, "Artist not entered"],
  [/제목 미입력/g, "Title not entered"],
  [/요청 ID/g, "Request ID"],
  [/오류 코드/g, "Error Code"],
  [/Supabase 마이그레이션/g, "Supabase migration"],
  [/방송국/g, "Broadcaster"],
  [/뮤직비디오/g, "Music Video"],
  [/음반/g, "Album"],
  [/심의/g, "Review"],
  [/접수/g, "Submission"],
  [/결제/g, "Payment"],
  [/결과/g, "Result"],
];

const translatableAttributes = [
  "placeholder",
  "aria-label",
  "title",
  "alt",
] as const;

function preserveWhitespace(original: string, replacement: string) {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  return `${leading}${replacement}${trailing}`;
}

function translateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const exact = exactTranslations[trimmed];
  if (exact) return preserveWhitespace(value, exact);

  let next = value;
  for (const [pattern, replacement] of phraseTranslations) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function translateTextNode(node: Text) {
  const current = node.nodeValue ?? "";
  const next = translateValue(current);
  if (next !== current) {
    node.nodeValue = next;
  }
}

function translateElement(element: Element) {
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "submit" || type === "button") {
      element.value = translateValue(element.value);
    }
  }

  if (element instanceof HTMLButtonElement) {
    element.value = translateValue(element.value);
  }

  for (const attr of translatableAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      element.setAttribute(attr, translateValue(value));
    }
  }
}

function walkAndTranslate(root: ParentNode) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const parent =
          node.nodeType === Node.TEXT_NODE
            ? node.parentElement
            : node instanceof Element
              ? node
              : null;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (
          parent.closest(
            "script, style, noscript, code, pre, textarea, [data-no-translate]",
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node as Text);
    } else if (node instanceof Element) {
      translateElement(node);
    }
    node = walker.nextNode();
  }
}

function englishPathFor(pathname: string) {
  if (pathname === "/") return "/en";
  if (pathname === "/en" || pathname.startsWith("/en/")) return pathname;

  const prefixes = [
    "/dashboard",
    "/mypage",
    "/track",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/guide",
    "/faq",
    "/support",
    "/forms",
  ];
  const match = prefixes.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? `/en${pathname}` : pathname;
}

function localizeUrl(raw: string) {
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return raw;
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/logout") ||
      url.pathname.startsWith("/pay/inicis")
    ) {
      return raw;
    }
    const nextPathname = englishPathFor(url.pathname);
    if (nextPathname === url.pathname) return raw;
    url.pathname = nextPathname;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw;
  }
}

function localizeLinks(root: ParentNode) {
  const links = root.querySelectorAll?.("a[href]") ?? [];
  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
    const next = localizeUrl(href);
    if (next !== href) {
      link.setAttribute("href", next);
    }
  });
}

export function EnglishLanguagePack() {
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");

  React.useEffect(() => {
    if (!isEnglishRoute) return;

    document.documentElement.lang = "en";

    const apply = (root: ParentNode = document.body) => {
      walkAndTranslate(root);
      localizeLinks(root);
    };

    apply();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof Text) {
            const root = node instanceof Text ? node.parentElement : node;
            if (root) apply(root);
          }
        });

        if (
          mutation.type === "attributes" &&
          mutation.target instanceof Element
        ) {
          translateElement(mutation.target);
          localizeLinks(mutation.target);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title", "alt", "href"],
    });

    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      const next = localizeUrl(href);
      if (next === href) return;
      event.preventDefault();
      window.location.assign(next);
    };

    const originalAlert = window.alert;
    const originalConfirm = window.confirm;
    window.alert = (message?: unknown) => {
      originalAlert.call(window, translateValue(String(message ?? "")));
    };
    window.confirm = (message?: string) =>
      originalConfirm.call(window, translateValue(String(message ?? "")));

    document.addEventListener("click", handleClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      window.alert = originalAlert;
      window.confirm = originalConfirm;
    };
  }, [isEnglishRoute, pathname]);

  return null;
}
