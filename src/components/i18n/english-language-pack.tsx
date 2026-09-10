"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const exactTranslations: Record<string, string> = {
  "멜론 또는 지니의 앨범 링크와 심의용 음원 파일(WAV 또는 ZIP)을 준비해주세요. 링크로 신청서 작성을 대신하며, 음원 파일은 다음 단계에서 첨부하거나 이메일로 보내주세요.": "Prepare your album URL from Melon or Genie and your audio files (WAV or ZIP). The URL replaces the application form. Attach the audio files in the next step or send them by email.",
  "접수한 앨범 URL과 제출한 음원으로 관리자가 심의 자료를 준비합니다.": "Our staff will prepare the review materials using your album URL and submitted audio.",
  "음원 첨부": "Attach Audio",
  "신청 완료": "Submission Complete",
  "온라인 신청서 작성": "Complete Online Application",
  "URL 입력": "Enter Album URL",
  "온라인 신청서 작성 → 음원 첨부 → 결제 → 신청 완료": "Online Application → Attach Audio → Payment → Submission Complete",
  "URL 입력 → 음원 첨부 → 결제 → 신청 완료": "Album URL → Attach Audio → Payment → Submission Complete",
  "앨범 URL을 입력하면, 관리자가 심의 자료를 준비합니다. 별도의 신청서 작성은 필요 없으며, 심의에 사용할 음원 파일(WAV 또는 ZIP)은 다음 단계에서 첨부해주세요.": "Enter your album URL and our staff will prepare the review materials. No separate application form is needed. Attach your audio files for review (WAV or ZIP) in the next step.",
  "업로드가 완료되지 않거나 문제가 생긴 경우 이메일로 음원 파일을 보내주세요.": "If the upload does not complete or you encounter a problem, please send your audio files by email.",
  "업로드가 어려우면 이메일로 음원 제출 가능": "You can submit audio by email if uploading is difficult",
  "결제 확인 후 관리자가 앨범 URL과 제출한 음원으로 심의 자료를 준비합니다.": "Once payment is confirmed, our staff will prepare the review materials using your album URL and submitted audio.",
  "이메일 제출 예정": "Audio to Be Sent by Email",
  "각 앨범의 음원 파일을 업로드하거나 이메일 제출을 선택해주세요.": "Upload audio or choose email delivery for each album.",
  "파일 조회 응답이 지연되고 있습니다. 다시 시도해주세요.": "The file lookup is taking too long. Please try again.",
  "파일 주소를 확인할 수 없습니다.": "We could not retrieve the file URL.",
  "파일을 불러오지 못했습니다. 다시 시도해주세요.": "We could not load the file. Please try again.",
  "파일 열기": "Open File",
  "DOC · DOCX · HWP · PDF 파일과 멜론·지니 URL을 바로 분석할 수 있습니다.": "You can analyze DOC, DOCX, HWP and PDF files, as well as Melon and Genie URLs.",
  "심의자료 전체 형식 처리 설정을 적용해야 합니다. 데이터베이스 마이그레이션 0105를 적용해주세요.": "Full document format support requires database migration 0105.",
  "현재 DOCX와 멜론·지니 URL을 바로 분석할 수 있습니다. DOC·HWP·PDF는 DOCX로 저장해 업로드하거나 문서 변환기 연결 상태를 확인해주세요.": "DOCX files and Melon or Genie URLs can be analyzed now. For DOC, HWP or PDF files, save a DOCX copy or check the document converter connection.",
  "확인 중": "Checking",
  "결제 모듈을 불러오지 못했습니다. 다시 시도해주세요.": "We could not load the payment module. Please try again.",
  "결제 모듈을 실행하지 못했습니다. 다시 시도해주세요.": "We could not open the payment module. Please try again.",
  "모바일 결제 폼을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.": "The mobile payment form is unavailable. Refresh the page and try again.",
  "모바일 결제 화면을 열지 못했습니다. 다시 시도해주세요.": "We could not open mobile checkout. Please try again.",
  "결제 모듈 로딩에 실패했습니다. 잠시 후 다시 시도해주세요.": "The payment module failed to load. Please try again shortly.",
  "업로드 응답이 지연되어 중단했습니다. 다시 시도하거나 이메일로 파일을 보내주세요.": "The upload stopped because the connection stalled. Please try again or send your files by email.",
  "결제 확인 대기": "Awaiting Payment Confirmation",
  "카드 결제와 무통장 입금이 확인된 주문은 완료에 표시됩니다. 입금 확인 전에는 대기에서 확인하세요.": "Confirmed card payments and bank transfers appear under Completed. Bank transfers awaiting confirmation appear under Waiting.",
  "접수 · 심의": "Applications & Reviews",
  "결제 · 주문": "Payments & Orders",
  "음악 · 크레딧": "Music & Credits",
  "내 계정": "My Account",
  "내 음악 관리": "My Music",
  "주문 내역에서 확인하기": "View in Orders",
  "주문내역에서 결제 상태를 확인해주세요.": "Please check the payment status in Orders.",
  "주문 내역 보기": "View Orders",
  "기존 PG 결제 기록입니다. 항목 설명은 이관 당시 자료입니다.": "This is a previous payment record. Item descriptions reflect the information available when it was migrated.",
  "기존 신청서 상태를 이관한 내역입니다. 주문 생성·입금 시각은 별도로 확인되지 않았습니다.": "This record was migrated from the previous application status. The original order and payment times are not available.",
  "기존 결제와 현재 신청서의 소유권·묶음·금액 확인이 필요합니다.": "The previous payment and current application require verification of ownership, grouped items, or amounts.",
  "여러 진행·승인 결제가 연결되어 관리자 확인이 필요합니다.": "Multiple pending or approved payments are linked to this order. Administrator review is required.",
  "카드 결제 진행 중": "Card Payment in Progress",
  "PayPal 결제 진행 중": "PayPal Payment in Progress",
  "실패·취소": "Failed · Canceled",
  "주문내역 보기": "View Orders",
  "입금 신청 후 주문내역에서 계좌와 입금 상태를 확인할 수 있습니다.": "After placing your order, view the bank account and payment status in Orders.",
  "결제와 입금 상태를 확인하고 주문을 관리하세요. 다시 결제할 주문은 장바구니로 돌릴 수 있습니다.": "Track payments and manage your orders. Return an unpaid order to your cart to choose a payment method again.",
  "주문 상태": "Order Status",
  "주문내역을 불러오는 중입니다...": "Loading your orders...",
  "주문 내역이 없습니다.": "You have no orders yet.",
  "해당 상태의 주문이 없습니다.": "No orders have this status.",
  "비회원 조회 코드로 확인": "Look Up a Guest Order",
  "이전 주문을 더 불러와 확인할 수 있습니다.": "Load earlier orders to see more.",
  "주문 번호": "Order Number",
  "심의 내역 보기": "View Review Details",
  "주문 금액": "Order Total",
  "장바구니로 돌리기": "Return to Cart",
  "장바구니로 돌린 주문입니다. 기존 주문 이력은 보관됩니다.": "This order was returned to your cart. Its order history is retained.",
  "이전 주문 더 보기": "Load Earlier Orders",
  "이 주문에 포함된 신청서를 모두 장바구니로 돌립니다. 기존 주문 이력은 남고 결제 수단을 다시 선택할 수 있습니다.": "All applications in this order will be returned to your cart. Your order history will be retained, and you can choose a payment method again.",
  "아직 입금하지 않은 경우에만 진행해주세요. 이미 입금했다면 입금 확인을 기다려주세요.": "Continue only if you have not sent the bank transfer. If you have already paid, please wait for confirmation.",
  "열려 있는 결제창을 먼저 닫아주세요. 진행 중인 결제 요청이 취소됩니다.": "Close any open payment windows first. The pending payment request will be canceled.",
  "주문내역을 불러오지 못했습니다. 다시 시도해주세요.": "We could not load your orders. Please try again.",
  "주문을 장바구니로 돌리지 못했습니다. 다시 시도해주세요.": "We could not return this order to your cart. Please try again.",
  "불러오는 중...": "Loading...",
  "주문 조회 범위를 확인해주세요.": "Check the requested order range.",
  "로그인 또는 비회원 주문 정보가 필요합니다.": "Please log in or provide your guest order details.",
  "주문 조회 정보를 확인해주세요.": "Check your order lookup details.",
  "주문내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.": "We could not load your orders. Please try again shortly.",
  "변경할 주문 정보를 확인해주세요.": "Check the order you want to change.",
  "주문 상태를 변경하지 못했습니다. 새로고침 후 다시 시도해주세요.": "We could not update the order. Refresh the page and try again.",
  "주문 정보를 확인하지 못했습니다.": "We could not check the order details.",
  "주문을 찾을 수 없습니다.": "Order not found.",
  "주문의 소유권을 확인할 수 없습니다.": "We could not verify that this order belongs to you.",
  "현재 주문은 장바구니로 돌릴 수 없습니다. 결제 상태를 확인해주세요.": "This order cannot currently be returned to your cart. Please check its payment status.",
  "주문 상태가 변경되어 장바구니로 돌리지 못했습니다. 새로고침 후 확인해주세요.": "The order status changed, so it could not be returned to your cart. Refresh the page to check its status.",
  "변경된 주문 상태를 확인하지 못했습니다. 새로고침해주세요.": "We could not verify the updated order status. Please refresh the page.",
  "이미 주문이 생성된 신청서입니다. 주문내역에서 확인해주세요.": "This application already has an order. Please check Orders.",
  "입금 대기": "Awaiting Bank Transfer",
  "주문 취소": "Order Canceled",
  "환불 완료": "Refunded",
  "주문내역": "Orders",
  "접수할 앨범 URL 확인": "Check Your Album URL",
  "접수할 앨범 URL": "Album URL to Submit",
  "URL·접수자 정보 수정": "Edit URL and Contact Details",
  "결제 확인 후 관리자가 앨범 URL과 첨부한 음원으로 심의 자료를 준비합니다. URL 접수 추가금은 0원입니다.": "Once payment is confirmed, our staff will prepare review materials using your album URL and uploaded audio. There is no extra charge for URL submission.",
  "발매 여부 · 패키지": "Release Status · Package",
  "URL · 접수자 정보": "URL · Contact Details",
  "음반이 이미 발매되었나요?": "Has your album been released?",
  "발매 여부에 맞춰 필요한 정보만 안내해드려요. 심의 비용은 동일합니다.": "We will guide you through the details needed for your release status. Review fees are the same.",
  "발매 전이에요": "Not Released Yet",
  "이미 발매됐어요": "Already Released",
  "앨범·트랙 정보를 작성하고 음원 파일을 제출해요.": "Fill in your album and track details, then submit your audio files.",
  "신청서 작성 → 파일 첨부 → 접수": "Complete Form → Attach Files → Submit",
  "멜론이나 지니의 앨범 URL로 간편하게 접수해요.": "Apply with your album URL from Melon or Genie.",
  "URL 입력 → 음원 첨부 → 관리자 자료 준비": "Enter URL → Upload Audio → Staff Prepare Materials",
  "URL 접수 추가금 0원": "No Extra Charge for URL Submission",
  "추가 앨범이 등록된 경우 발매 여부는 변경할 수 없습니다.": "Release status cannot be changed after adding another album.",
  "심의를 진행할 방송국을 선택해주세요. 발매 여부에 따른 추가금은 없습니다.": "Choose your broadcasters. There is no extra charge based on release status.",
  "URL 입력으로 계속": "Continue to Album URL",
  "신청서 작성으로 계속": "Continue to Application",
  "URL과 접수자 정보": "Album URL and Contact Details",
  "발매된 음반 간편 접수": "Quick Submission for Released Albums",
  "앨범 URL을 보내주시면 관리자가 앨범·트랙 정보를 확인하고 심의 자료를 준비합니다. 별도의 신청서 작성은 필요 없으며, 심의에 사용할 음원 파일(WAV 또는 ZIP)은 다음 단계에서 첨부해주세요.": "Submit your album URL and our staff will check the album and track details and prepare the review materials. No separate application form is needed. You must upload the audio files for review (WAV or ZIP) in the next step.",
  "멜론·지니 앨범 URL": "Melon or Genie Album URL",
  "멜론·지니 앨범 URL *": "Melon or Genie Album URL *",
  "멜론·지니 앨범 링크": "Melon or Genie Album Link",
  "멜론 또는 지니 앨범 페이지 주소를 붙여넣어주세요": "Paste your Melon or Genie album page URL",
  "곡이나 아티스트 페이지가 아닌 앨범 상세 페이지 주소를 넣어주세요. 멜론·지니 중 하나면 됩니다.": "Use the album detail page, rather than a song or artist page. A URL from either Melon or Genie is enough.",
  "발매된 음반": "Released Album",
  "저장하고 최종 확인": "Save and Review",
  "저장하고 음원 첨부": "Save and Upload Audio",
  "음원 업로드": "Upload Audio",
  "심의에 사용할 전체 음원을 WAV 파일 또는 ZIP 파일로 첨부해주세요.": "Upload all audio files for review as WAV files or a ZIP file.",
  "WAV·ZIP": "WAV · ZIP",
  "앨범 URL의 트랙 순서와 음원 파일 순서 일치": "Match the audio file order to the track order on the album page",
  "음원 파일 업로드 필수": "Audio Upload Required",
  "음원 파일(WAV 또는 ZIP)을 사이트에 업로드해주세요.": "Upload your audio files (WAV or ZIP) on this site.",
  "WAV 파일을 개별로 첨부하거나, 전체 음원을 ZIP 파일로 묶어 업로드해주세요.": "Upload individual WAV files or a ZIP containing all audio files.",
  "업로드가 완료되지 않으면 접수할 수 없습니다. 문제가 계속되면 고객센터로 문의해주세요.": "Your submission cannot proceed until the upload is complete. If the issue continues, please contact support.",
  "발매된 음반 · URL 접수": "Released Album · URL Submission",
  "선택을 확정하면 URL과 접수자 정보 입력으로 이동합니다.": "Confirm to enter your album URL and contact details.",
  "멜론 또는 지니의 앨범 링크를 입력해주세요.": "Enter your Melon or Genie album link.",
  "멜론 또는 지니의 앨범 상세 페이지 URL을 확인해주세요. 곡·아티스트 링크는 사용할 수 없습니다.": "Check your Melon or Genie album detail page URL. Song and artist links are not supported.",
  "발매 여부를 선택하면 알맞은 접수 방법으로 안내합니다.": "Choose your release status to see the right submission steps.",
  "발매 여부를 선택하면 필요한 항목만 안내해드려요.": "Choose your release status to see only the details you need.",
  "공통으로 접수자 이름, 이메일, 연락처가 필요해요.": "Both options require your name, email, and phone number.",
  "발매 전 음반": "Unreleased Albums",
  "신청서와 음원 자료를 준비해주세요.": "Prepare your application form and audio files.",
  "이미 발매된 음반": "Already Released Albums",
  "멜론 또는 지니의 앨범 링크와 심의용 음원 파일(WAV 또는 ZIP)을 준비해주세요. 링크로 신청서 작성을 대신하며, 음원 파일은 사이트에 직접 첨부해야 합니다.": "Prepare your Melon or Genie album link and the audio files for review (WAV or ZIP). The link replaces the application form. You must upload the audio files directly on this site.",
  "추가금 없이 이용하며, 접수한 링크와 첨부한 음원으로 관리자가 심의 자료를 준비합니다.": "There is no extra charge. Our staff will use your link and uploaded audio to prepare the review materials.",
  "발매 음반 · 링크 접수": "Released Album · Link Submission",
  "앨범 링크 확인 대기": "Awaiting Album Link Review",
  "공통: 접수자 이름, 이메일, 연락처": "Both options: applicant name, email, and phone number",
  "발매 전: 신청서와 WAV 음원 또는 전체 음원 ZIP": "Unreleased: application form and WAV audio files or a full audio ZIP",
  "발매 전: 앨범 정보, 트랙별 크레딧, 전체 가사와 외국어 번역": "Unreleased: album details, track credits, complete lyrics, and translations",
  "발매 후: 멜론 또는 지니 앨범 링크로 추가금 없이 접수": "Released: apply with a Melon or Genie album link at no extra charge",
  "발매 후: 신청서는 앨범 링크로 대신하고 WAV 음원 또는 전체 음원 ZIP 첨부": "Released: replace the application form with an album link and upload WAV audio files or a ZIP containing all audio files",
  "발매된 음반은 멜론·지니 링크로 추가금 없이 접수": "Released albums can be submitted by Melon or Genie link at no extra charge",
  "가능합니다. 음반 심의 접수에서 이미 발매된 음반을 선택하고 멜론 또는 지니의 앨범 링크를 입력해주세요. 추가금과 별도의 신청서 작성은 필요 없으며, 심의용 음원 파일(WAV 또는 ZIP)은 사이트에 직접 첨부해주세요. 관리자가 앨범 정보와 첨부한 음원으로 심의 자료를 준비합니다.": "Yes. Choose Already Released in the album review submission and enter a Melon or Genie album link. There is no extra charge or separate application form. You must upload the audio files for review (WAV or ZIP) directly on this site. Our staff will prepare the review materials using the album details and uploaded audio.",
  "본문으로 바로가기": "Skip to content",
  "내 작품의 심의 기록을 한곳에서 관리하세요":
    "Manage your work's review records in one place.",
  "서비스": "Services",
  "어떤 심의가 필요한가요?": "Which review do you need?",
  "구버전 접수": "Legacy Site",
  "유통 · 업로드": "Distribution · Upload",
  "MV 온라인": "Online MV",
  "MV 방송": "Broadcast MV",
  "미리보기": "Preview",
  "가입 완료": "Account Created",
  "코드 찾기": "Find Code",
  "이메일로 시작하기": "Start with Email",
  "필수 항목 전체 동의": "Agree to All Required",
  "만 14세 이상": "Age 14 or Older",
  "개인정보 처리": "Privacy Policy",
  "결제·환불 정책": "Payment · Refund Policy",
  "소식 받기": "Receive Updates",
  "(필수)": "(Required)",
  "(선택)": "(Optional)",
  "보기": "View",
  "링크 보내기": "Send Link",
  "재설정 링크 받기": "Get a Reset Link",
  "가입 이메일을 입력하세요.": "Enter your account email.",
  "링크 확인": "Check Link",
  "변경 완료": "Password Updated",
  "8자 이상 입력": "Use at least 8 characters",
  "변경하기": "Update",
  "메일 발송 중...": "Sending Email...",
  "로그인 중...": "Logging In...",
  "새 재설정 링크 요청하기": "Request a New Reset Link",
  "메일이 보이지 않으면 스팸함을 확인해주세요. 재발송한 경우 가장 최근 메일의 링크를 사용해주세요.": "Check your spam folder if you do not see the email. If you requested another email, use the link in the most recent one.",
  "가입된 이메일이라면 비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.": "If this email is registered, we have sent a password reset email. Please check your inbox.",
  "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.": "Too many login attempts. Please wait and try again.",
  "메일 발송 서비스가 잠시 혼잡합니다. 잠시 후 다시 시도해주세요.": "The email service is temporarily busy. Please try again shortly.",
  "메일 발송 서비스의 전송 한도에 도달했습니다. 잠시 후 다시 시도하거나 고객센터에 문의해주세요.": "The email service has reached its sending limit. Please try again later or contact support.",
  "메일 발송 설정에 문제가 있어 재설정 메일을 보내지 못했습니다. 고객센터에 문의해주세요.": "An email service configuration issue prevented us from sending the reset email. Please contact support.",
  "메일을 요청한 동일한 브라우저에서 링크를 열어주세요. 링크가 만료되었다면 새 링크를 요청해주세요.": "Open the link in the browser where you requested the email. If the link has expired, request a new one.",
  "비밀번호 재설정 링크를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.": "We could not prepare your password reset link. Please try again shortly.",
  "비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.": "We could not send the password reset email. Please try again shortly.",
  "비밀번호가 변경되었습니다.": "Your password has been updated.",
  "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.": "Your password has been updated. Please log in with your new password.",
  "비밀번호가 일치하지 않습니다.": "The passwords do not match.",
  "비밀번호는 128자 이하로 입력해주세요.": "Use a password of 128 characters or fewer.",
  "비밀번호는 8자 이상 입력해주세요.": "Use a password of at least 8 characters.",
  "비밀번호는 8자 이상으로 입력하고, 너무 단순한 비밀번호는 피해주세요.": "Use at least 8 characters and avoid a password that is too simple.",
  "비밀번호를 변경할 수 없습니다. 잠시 후 다시 시도해주세요.": "We could not update your password. Please try again shortly.",
  "비밀번호를 입력해주세요.": "Enter your password.",
  "세션을 확인할 수 없습니다. 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해주세요.": "We could not verify your session. The link may have expired or already been used. Please request a new link.",
  "수신 동의 항목을 확인해주세요.": "Check your communication preferences.",
  "연락처는 40자 이하로 입력해주세요.": "Use 40 characters or fewer for your phone number.",
  "연락처는 7자 이상 입력해주세요.": "Enter a phone number with at least 7 characters.",
  "연락처를 입력해주세요.": "Enter your phone number.",
  "올바른 이메일 주소를 입력해주세요.": "Enter a valid email address.",
  "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.": "Too many requests. Please wait and try again.",
  "유효한 이메일을 입력해주세요.": "Enter a valid email address.",
  "이동 경로가 너무 깁니다.": "The destination path is too long.",
  "이름은 100자 이하로 입력해주세요.": "Use 100 characters or fewer for your name.",
  "이름은 2자 이상 입력해주세요.": "Enter a name with at least 2 characters.",
  "이름을 입력해주세요.": "Enter your name.",
  "이메일 또는 비밀번호를 확인해주세요.": "Check your email or password.",
  "이메일 인증 후 로그인해주세요. 인증 메일이 없다면 고객센터에 문의해주세요.": "Verify your email before logging in. If you cannot find the verification email, contact support.",
  "이메일은 254자 이하로 입력해주세요.": "Use an email address of 254 characters or fewer.",
  "이메일을 입력해주세요.": "Enter your email address.",
  "이미 가입된 이메일입니다. 로그인 또는 비밀번호 재설정을 이용해주세요.": "This email is already registered. Please log in or reset your password.",
  "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.": "We could not connect to the authentication service. Please try again shortly. If the problem continues, contact support.",
  "인증 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.": "The authentication service is temporarily unavailable. Please try again shortly.",
  "인증 서비스 설정을 확인하고 있습니다. 잠시 후 다시 시도해주세요.": "We are checking the authentication service configuration. Please try again shortly.",
  "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.": "We could not send the reset email. Please try again shortly. If the problem continues, contact support.",
  "재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.": "Too many password reset requests. Please wait and try again.",
  "프로필 저장에 실패했습니다.": "We could not save your profile.",
  "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.": "We could not connect to the authentication service. Please try again shortly.",
  "프로필 저장에 실패했습니다. 잠시 후 다시 시도해주세요.": "We could not save your profile. Please try again shortly.",
  "프로필 저장에 실패했습니다. 연결 상태를 확인하고 다시 시도해주세요.": "We could not save your profile. Check your connection and try again.",
  "문의 접수 결과를 확인하지 못했습니다. 연결 상태를 확인하고 잠시 후 다시 시도해주세요.": "We could not confirm your inquiry was received. Check your connection and try again shortly.",
  "저장 중...": "Saving...",
  "변경 중...": "Updating...",
  "프로필이 저장되었습니다.": "Your profile has been saved.",
  "필수 항목에 동의해주세요.": "Please accept the required agreements.",
  "현재 비밀번호와 다른 새 비밀번호를 입력해주세요.": "Choose a new password that differs from your current password.",
  "회사명은 200자 이하로 입력해주세요.": "Use 200 characters or fewer for the company name.",
  "회원가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.": "Too many sign-up requests. Please wait and try again.",
  "회원가입을 완료할 수 없습니다. 입력 내용을 다시 확인해주세요.": "We could not complete your sign-up. Please check your details.",
  "회원가입이 완료되었습니다. 로그인해 주세요.": "Your account has been created. Please log in.",
  "어떻게 도와드릴까요?": "How can we help?",
  "남겨주신 연락처로 답변드릴게요.": "We will reply through your contact details.",
  "무엇이 궁금한가요?": "What can we help with?",
  "필요한 내용을 적어주세요.": "Tell us what you need.",
  "답변받을 연락처": "Contact for reply",
  "보내기": "Send",
  "3단계로 간단하게": "Three Simple Steps",
  "준비": "Prepare",
  "파일 · 기본 정보": "Files · Basic Info",
  "장바구니에서 한 번에": "Pay Together in Cart",
  "마이페이지 · 조회 코드": "My Page · Lookup Code",
  "심의 선택": "Choose a Review",
  "음반 신청": "Apply for Album Review",
  "MV 신청": "Apply for MV Review",
  "핵심 조건": "Key Details",
  "사전 준비 사항": "Preparation",
  "더 궁금한 점": "Need More Help?",
  "2017년부터 이어온 음반·뮤직비디오 심의.":
    "Album and music video reviews since 2017.",
  "핵심 서비스": "Core Services",
  "온라인 접수": "Online Application",
  "실시간 현황": "Live Status",
  "접수부터 결과까지": "From application to results",
  "온라인 결제": "Online Payment",
  "카드 · 모바일": "Card · Mobile",
  "제작 지원": "Production Support",
  "CD · 가사집 · DVD": "CD · Lyric Book · DVD",
  "정식 등록 업체": "Registered Business",
  "등록·증빙 정보": "Registration · Receipts",
  "통신판매업 · 대중문화예술기획업 · 음반·음악영상물제작업":
    "E-commerce · Entertainment Agency · Music and Video Production",
  "세금계산서 · 현금영수증 · 거래내역서 발급":
    "Tax invoices · Cash receipts · Transaction statements",
  "문의": "Contact",
  "비회원 가능": "Guest Checkout",
  "음반 심의 접수": "Album Review Submission",
  "뮤직비디오 심의 접수": "Music Video Review Submission",
  "사전 준비 사항 닫기": "Hide Preparation",
  "예전 사이트 열기": "Open Legacy Site",
  "예전 온사이드 사이트 열기 (새 창)":
    "Open the Legacy Onside Site (New Tab)",
  "구버전과 신버전은 오픈 후 1년간 함께 운영되며, 접수 후 심의 절차는 동일합니다.":
    "The legacy and new sites will run in parallel for one year, and the review process is the same after submission.",
  "로그인 시 자동 저장": "Auto-save When Signed In",
  "음원 · 라디오/TV": "Audio · Radio/TV",
  "방송 송출용 음원을 접수합니다.": "Submit audio for radio and TV broadcast.",
  "유통 · 온라인 업로드": "Distribution · Online Upload",
  "유통·업로드용 등급 심의입니다.": "Rating review for distribution and uploads.",
  "방송국 · TV 송출": "Broadcasters · TV Broadcast",
  "방송국 송출용 영상을 접수합니다.": "Submit video for TV broadcast.",
  "5단계 접수": "5 Steps",
  "영상 규격 확인": "Video Specifications",
  "신청 진행 단계": "Application Steps",
  "전체 진행률": "Overall Progress",
  "작성 방식": "How to Complete",
  "작성 방식 선택": "Choose How to Complete",
  "두 방식 중 하나만 선택하세요.": "Choose one method.",
  "온라인 작성": "Complete Online",
  "화면에서 바로 입력": "Enter Details Here",
  "사이트에서 직접 입력": "Enter Details on the Site",
  "파일로 제출": "Submit a File",
  "양식 작성 후 첨부": "Download, Complete, and Attach",
  "양식을 내려받아 작성 후 첨부": "Download, Complete, and Attach the Form",
  "선택하고 계속": "Continue with Selection",
  "생성형 AI를 사용했나요?": "Did You Use Generative AI?",
  "판단 기준": "How to Decide",
  "패키지 선택": "Choose a Package",
  "장르 조건 있음": "Genre Restrictions",
  "선택 조건": "Eligibility",
  "트랙 정보 직접 입력": "Enter Track Details",
  "멜론 링크로 간편 접수": "Quick Apply with a Melon Link",
  "신청서 양식": "Application Template",
  "다음: 신청서 + 음원 첨부": "Next: Application + Audio",
  "파일 첨부": "Attach Files",
  "신청 내용 확인": "Review Application",
  "최종 점검": "Final Check",
  "변경 확인": "Confirm Change",
  "필수 정보와 트랙별 크레딧": "Required details and track credits",
  "트랙 수, 타이틀곡과 심의 대상곡":
    "Track count, title tracks, and tracks for review",
  "음원·신청서 파일과 결제 금액 변경":
    "Audio, application files, and payment changes",
  "확인 완료": "All Set",
  "수정이 필요한 항목": "Items Requiring Changes",
  "제출 전 확인 권장": "Recommended Before Submission",
  "확인을 권장하는 항목": "Items Recommended for Review",
  "신청 정보를 모두 확인했습니다.":
    "All application details have been checked.",
  "점검 기준": "What We Check",
  "트랙 빠른 입력": "Quick Track Entry",
  "곡별 값은 표에서 비교하고, 가사와 타이틀 설정은 상세 편집에서 입력합니다.":
    "Compare track details in the table, then add lyrics and title-track settings in Details.",
  "빈 참여진 채우기": "Fill Blank Credits",
  "트랙 표 입력": "Track Table Entry",
  "트랙별 곡명, 가수명, 작곡, 작사, 편곡 빠른 입력":
    "Quick entry of song title, performer, composer, lyricist, and arranger for each track",
  "작업": "Actions",
  "상세": "Details",
  "가사 작성 기준": "Lyrics Guidelines",
  "욕설 포함 곡 심의 안내": "Review Guidance for Tracks with Profanity",
  "욕설이 있는 곡은 심의 부적격 대상이며, 한 곡만 포함돼도 앨범 전체 심의가 중단될 수 있습니다. 해당 곡은 제외하고 신청해주세요.":
    "Tracks containing profanity are ineligible for approval. Even one such track may halt the review of the entire album. Please exclude these tracks from your submission.",
  "자동 번역 안내": "Automatic Translation Guidance",
  "직접 번역이 어려운 경우 자동 번역으로 심의 진행 가능합니다.":
    "If translating the lyrics yourself is difficult, you can use automatic translation for the review.",
  "트랙 · 파일 자동 확인": "Automatic Track and File Check",
  "트랙명과 음원 파일명이 모두 연결되었습니다.":
    "Every track has been matched to an audio file.",
  "파일 확인 필요": "Files Need Attention",
  "연결되지 않은 파일": "Unmatched Files",
  "곡명 미입력": "Song Title Missing",
  "ZIP·문서 파일은 파일명 자동 연결에서 제외됩니다.":
    "ZIP and document files are excluded from automatic filename matching.",
  "업로드 도움이 필요하신가요?": "Need Help Uploading?",
  "업로드가 어려우면 파일 없이 진행한 뒤":
    "If upload is difficult, continue without files and email them to",
  "로 보내주세요.": ".",
  "실물 앨범을 발표했다면": "If you released a physical album,",
  "CD 제출 기준 보기 →": "View CD Submission Requirements →",
  "심의 목적과 선택 옵션": "Review purpose and selected options",
  "작성 방식에 맞는 필수 신청 정보":
    "Required application details for the selected method",
  "영상·신청서 파일과 결제 금액":
    "Video, application file, and payment amount",
  "기기에 남아 있는 최신 입력을 지우고 서버 저장본을 사용할까요?":
    "Discard the latest changes saved on this device and use the server copy?",
  "복구본을 사용하지 않음": "Discard Recovered Draft",
  "현재 입력을 이전 저장본으로 되돌릴까요?":
    "Restore the previously saved version and replace the current entries?",
  "이전 저장본 복원": "Restore Previous Version",
  "최근 입력 복구 가능": "Recent Changes Available",
  "복구": "Recover",
  "서버 저장본 사용": "Use Server Copy",
  "저장 중": "Saving",
  "저장 실패": "Save Failed",
  "기기에 저장됨": "Saved on This Device",
  "저장됨": "Saved",
  "재시도": "Retry",
  "이전 저장본": "Previous Version",
  "닫히지 않은 따옴표가 있습니다.": "A quotation mark is not closed.",
  "같은 의미의 열 제목이 중복되어 첫 번째 열만 반영했습니다.":
    "Duplicate column headings were found, so only the first one was applied.",
  "저장할 수 있는 신청서 데이터가 없습니다.":
    "There is no application data to save.",
  "이 기기에 임시 저장하지 못했습니다.":
    "The draft could not be saved on this device.",
  "신청서를 저장하지 못했습니다.": "The application could not be saved.",
  "브라우저 임시 저장을 사용할 수 없습니다.":
    "Browser draft storage is unavailable.",
  "결제 금액 변경": "Payment Amount Changed",
  "패키지 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.":
    "The package or payment amount has changed. Review and confirm the change.",
  "심의 패키지를 선택해주세요.": "Select a review package.",
  "온라인 작성 또는 파일 제출 중 하나를 선택해주세요.":
    "Choose either online entry or file submission.",
  "접수자 연락처": "Applicant Phone",
  "이메일 형식을 확인해주세요.": "Check the email address format.",
  "연락처는 숫자 9~11자리로 입력해주세요.":
    "Enter a phone number containing 9 to 11 digits.",
  "AI 활용 여부": "AI Usage",
  "AI 활용 여부를 선택해주세요.": "Select whether AI was used.",
  "아티스트명(한글)": "Artist Name (Korean)",
  "아티스트명(영문)": "Artist Name (English)",
  "이전 발매곡": "Previous Release",
  "그룹/솔로": "Group / Solo",
  "성별": "Gender",
  "그룹 팀원": "Group Members",
  "한 곡 이상 입력해주세요.": "Enter at least one track.",
  "곡명을 입력해주세요.": "Enter the song title.",
  "이 트랙의 가수명을 입력해주세요.":
    "Enter the performer for this track.",
  "작곡": "Composer",
  "작사": "Lyricist",
  "편곡": "Arranger",
  "작곡자 정보를 입력해주세요.": "Enter the composer.",
  "외국어 가사의 번역본을 입력해주세요.":
    "Enter a translation of the foreign-language lyrics.",
  "타이틀곡": "Title Track",
  "타이틀곡을 한 곡 이상 선택해주세요.":
    "Select at least one title track.",
  "방송 심의 대상곡": "Tracks for Broadcast Review",
  "수록곡이 4곡 이상이면 심의 대상곡 3곡을 선택해주세요.":
    "For releases with four or more tracks, select three tracks for review.",
  "업로드에 실패한 파일을 다시 선택해주세요.":
    "Select the files that failed to upload again.",
  "파일 업로드가 끝날 때까지 기다려주세요.":
    "Wait for all file uploads to finish.",
  "음원 업로드 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.":
    "We could not check the audio upload status. Please try again shortly.",
  "음원 파일을 업로드하거나 이메일 제출을 선택해주세요.":
    "Upload the audio files or choose email submission.",
  "작성한 신청서": "Completed Application Form",
  "작성한 신청서 파일을 함께 첨부해주세요.":
    "Attach the completed application form.",
  "트랙과 음원 수": "Track and Audio File Count",
  "심의 목적": "Review Purpose",
  "뮤직비디오 심의 목적을 선택해주세요.":
    "Select the music video review purpose.",
  "TV 송출 심의를 진행할 방송국을 선택해주세요.":
    "Select the broadcasters for TV broadcast review.",
  "심의 옵션": "Review Options",
  "심의 옵션 변경": "Review Options Changed",
  "심의 옵션 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.":
    "The review options or payment amount have changed. Review and confirm the change.",
  "온라인 심의 옵션을 하나 이상 선택해주세요.":
    "Select at least one online review option.",
  "선택한 심의 옵션과 결제 금액을 확인해주세요.":
    "Review the selected options and payment amount.",
  "뮤직비디오 제목": "Music Video Title",
  "아티스트명 공식 표기": "Official Artist Name",
  "영상 공개일자": "Video Release Date",
  "감독": "Director",
  "주연": "Lead Actor",
  "뮤직비디오 제작사": "Music Video Production Company",
  "소속사": "Agency",
  "앨범명": "Album Title",
  "용도": "Intended Use",
  "곡명(한글)": "Song Title (Korean)",
  "곡명(영문)": "Song Title (English)",
  "곡 정보 공식 표기": "Official Song Information",
  "작곡자": "Composer",
  "줄거리": "Synopsis",
  "담당자명": "Contact Name",
  "영상 파일을 업로드하거나 이메일 제출을 선택해주세요.":
    "Upload the video file or choose email submission.",
  "작성한 신청서 파일을 영상과 함께 첨부해주세요.":
    "Attach the completed application form with the video.",
  "접수 ID를 확인하지 못했습니다.":
    "The application ID could not be verified.",
  "접수 ID를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.":
    "The application ID could not be prepared. Try again shortly.",
  "저장 중 오류가 발생했습니다.": "An error occurred while saving.",
  "서버 저장이 지연되고 있습니다. 입력은 이 기기에 보관했습니다.":
    "Server saving is delayed. Your entries are saved on this device.",
  "옵션 수정": "Edit Options",
  "선택 내역": "Selections",
  "선택된 옵션이 없습니다.": "No options are selected.",
  "접수자 이름을(를) 입력해주세요.": "Enter the applicant name.",
  "접수자 이메일을(를) 입력해주세요.": "Enter the applicant email.",
  "접수자 연락처을(를) 입력해주세요.": "Enter the applicant phone number.",
  "멜론 링크을(를) 입력해주세요.": "Enter the Melon link.",
  "앨범 제목을(를) 입력해주세요.": "Enter the album title.",
  "아티스트명을(를) 입력해주세요.": "Enter the artist name.",
  "아티스트명(한글)을(를) 입력해주세요.":
    "Enter the artist name in Korean.",
  "아티스트명(영문)을(를) 입력해주세요.":
    "Enter the artist name in English.",
  "발매일을(를) 입력해주세요.": "Enter the release date.",
  "장르을(를) 입력해주세요.": "Enter the genre.",
  "유통사을(를) 입력해주세요.": "Enter the distributor.",
  "제작사을(를) 입력해주세요.": "Enter the production company.",
  "이전 발매곡을(를) 입력해주세요.": "Enter the previous release.",
  "그룹/솔로을(를) 입력해주세요.": "Select group or solo.",
  "성별을(를) 입력해주세요.": "Select the gender.",
  "그룹 팀원을(를) 입력해주세요.": "Enter the group members.",
  "뮤직비디오 제목을(를) 입력해주세요.":
    "Enter the music video title.",
  "아티스트명 공식 표기을(를) 입력해주세요.":
    "Enter the official artist name.",
  "영상 공개일자을(를) 입력해주세요.": "Enter the video release date.",
  "감독을(를) 입력해주세요.": "Enter the director.",
  "주연을(를) 입력해주세요.": "Enter the lead actor.",
  "뮤직비디오 제작사을(를) 입력해주세요.":
    "Enter the music video production company.",
  "소속사을(를) 입력해주세요.": "Enter the agency.",
  "앨범명을(를) 입력해주세요.": "Enter the album title.",
  "용도을(를) 입력해주세요.": "Enter the intended use.",
  "곡명(한글)을(를) 입력해주세요.": "Enter the song title in Korean.",
  "곡명(영문)을(를) 입력해주세요.": "Enter the song title in English.",
  "곡 정보 공식 표기을(를) 입력해주세요.":
    "Enter the official song information.",
  "작곡자을(를) 입력해주세요.": "Enter the composer.",
  "줄거리을(를) 입력해주세요.": "Enter the synopsis.",
  "가사을(를) 입력해주세요.": "Enter the lyrics.",
  "담당자명을(를) 입력해주세요.": "Enter the contact name.",
  "이메일을(를) 입력해주세요.": "Enter the email address.",
  "연락처을(를) 입력해주세요.": "Enter the phone number.",
  "예상 기간 · 영업일 기준 최대 3주": "Up to 3 Business Weeks",
  "부가세·증빙 서류 신청 가능": "VAT · Receipt Documents Available",
  "접수 전 취소 조건 확인": "Check Cancellation Terms Before Submission",
  "누락 자료는 보완 후 진행": "Missing Materials Can Be Added Later",
  "✓ 장바구니 준비 완료": "✓ Ready for Cart",
  "여러 건 동시 결제": "Pay for Multiple Applications Together",
  "접수 내역": "Application",
  "결과 확인": "Results",
  "심의 목적 선택": "Choose Review Purpose",
  "멜론·지니·유튜브 등 온라인 유통":
    "Online Distribution: Melon · Genie · YouTube",
  "음원 심의 완료 앨범만 신청 가능": "Albums with Completed Audio Review Only",
  "방송국 선택": "Choose Broadcasters",
  "방송국별 개별 심의": "Reviewed per Broadcaster",
  "옵션 선택": "Choose Options",
  "일반 뮤직비디오 심의": "Standard Music Video Review",
  "파일 준비 기준": "File Checklist",
  "신청서와 음원·CD 트랙 순서 일치":
    "Match the Track Order in the Application, Audio, and CD",
  "음원·CD 트랙 순서 일치": "Match the Audio and CD Track Order",
  "WAV·MP3·ZIP + HWP·DOC·DOCX": "WAV · MP3 · ZIP + HWP · DOC · DOCX",
  "WAV·MP3·ZIP": "WAV · MP3 · ZIP",
  "신청서와 음원 업로드": "Upload Application and Audio",
  "업로드가 어려우면 파일 없이 진행 가능": "Continue Without Files if Upload Is Difficult",
  "심의 신청": "Apply",
  "진행/결과 조회": "Results",
  "매거진 발행": "Magazine",
  "크레딧": "Credits",
  "이용가이드": "Guide",
  "고객센터": "Support",
  "1:1 문의": "1:1 Inquiry",
  "문의 접수": "Submit Inquiry",
  "문의 제목을 입력하세요.": "Enter an inquiry title.",
  "문의 내용을 입력하세요.": "Enter your inquiry.",
  "이메일 또는 연락처": "Email or Phone",
  "답변받을 이메일 또는 전화번호": "Email or phone number for the reply",
  "문의가 접수되었습니다.": "Your inquiry has been submitted.",
  "남겨주신 연락처로 확인 후 안내드리겠습니다.":
    "We will review it and follow up through the contact you provided.",
  "로그인": "Login",
  "로그아웃": "Logout",
  "마이페이지": "My Page",
  "마이페이지 - 나의 크레딧": "My Page - My Credits",
  "마이페이지 - 나의 크레딧 | 온사이드": "My Page - My Credits | Onside",
  "실시간 채팅": "Live Chat",
  "온사이드 실시간 채팅": "Onside Live Chat",
  "관리자와 바로 대화할 수 있습니다.": "Chat directly with the admin.",
  "상담 가능": "Chat Available",
  "상담 진행": "Chat Active",
  "관리자 답변 대기": "Waiting for Admin",
  "사용자 답변 대기": "Waiting for User",
  "상담 종료": "Chat Closed",
  "보통 영업시간 내 답변": "Usually answered during business hours",
  "궁금한 내용을 남기면 관리자 화면으로 바로 전달됩니다. 답변이 오면 이 창에서 이어서 확인할 수 있습니다.":
    "Leave your question and it will be sent to the admin screen. Replies will appear in this chat window.",
  "이름": "Name",
  "메시지를 입력하세요.": "Type your message.",
  "메시지 보내기": "Send Message",
  "지금 신청": "Apply Now",
  "EN": "KR",
  "다크": "Dark",
  "라이트": "Light",
  "결과 조회": "Results",
  "심의 신청부터": "From Submission",
  "결과 확인까지": "to Result Check",
  "TEST - TEST 심의": "TEST - TEST Review",
  "리뉴얼 기념 음반심의 30% 할인": "Renewal Special: 30% Off Album Review",
  "리뉴얼 기념 AlbumReview 30% Discount": "Renewal Special: 30% Off Album Review",
  "할인 금액으로 바로 접수하세요.": "Submit now at the discounted price.",
  "Discount 금액으로 바로 Submission하세요.": "Submit now at the discounted price.",
  "나의 모든 음반·뮤직비디오 심의를 관리하고, 진행 현황을 실시간으로 확인하세요.":
    "Manage all of your album and music video reviews, and check progress in real time.",
  "이전 온사이드도 페이지도 접속가능": "Previous Onside Site Still Available",
  "이전 사이트 사용이 편하시면 구버전에서 신청 가능합니다.":
    "If the previous site is easier for you, you can apply through the legacy version.",
  "신청 유형": "Review Type",
  "필요한 심의만 선택하세요": "Choose the Review You Need",
  "구버전 방식 접수 →": "Legacy submission method →",
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
  "접수": "Submit",
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
  "이전 버전의 온사이드 사이트가 편하신 경우 이전 사이트에서 접수해주셔도 심의는 동일하게 진행이 됩니다.":
    "If the previous Onside site is more convenient, you may submit there and the review will proceed the same way.",
  "예전 온사이드 사이트에서 접수하기": "Submit on Previous Onside Site",
  "예전 온사이드 사이트에서 접수하기 ->": "Submit on Previous Onside Site ->",
  "ALBUM REVIEW 신청": "Album Review Application",
  "MUSIC VIDEO REVIEW 신청": "Music Video Review Application",
  "Album Review 신청": "Album Review Application",
  "Music Video Review 신청": "Music Video Review Application",
  "Submission 방식을 선택하면 바로 신청서를 작성할 수 있습니다.":
    "Choose a submission method to start the application form.",
  "Submission 방식을 선택하면 바로 Application Form를 작성할 수 있습니다.":
    "Choose a submission method to start the application form.",
  "접수 방식을 선택하면 바로 신청서를 작성할 수 있습니다.":
    "Choose a submission method to start the application form.",
  "알아보기": "Learn More",
  "사전 준비 사항 보기": "View Preparation",
  "기존 사이트 접수": "Legacy Site Submission",
  "진행 중": "In Progress",
  "Review 진행중": "Review in Progress",
  "패키지를 선택하세요.": "Select a Package.",
  "포함 Broadcaster과 가격을 확인하고 선택하면 다음 단계로 이동합니다.":
    "Check included broadcasters and price, then select a package to continue.",
  "SUBMISSION 방식": "Submission Method",
  "Submission 방식": "Submission Method",
  "일반 SUBMISSION": "Standard Submission",
  "일반 Submission": "Standard Submission",
  "트랙 정보를 직접 입력하는 기본 Review Submission입니다.":
    "Standard review submission with manually entered track information.",
  "원클릭": "One Click",
  "원클릭 Submission": "One Click Submission",
  "원클릭 접수": "One Click Submission",
  "멜론 링크와 음원 파일만 제출하는 간편 Submission입니다.":
    "A simpler submission using only the Melon link and audio files.",
  "Melon 링크와 Audio 파일만 제출하는 간편 Submission입니다.":
    "A simpler submission using only the Melon link and audio files.",
  "멜론 링크와 음원 파일만 제출하는 간편 접수입니다.":
    "A simpler submission using only the Melon link and audio files.",
  "발매 완료된 앨범의 멜론 링크와 음원 파일만 제출하면 온사이드가 모든 것을 해결합니다.":
    "Submit only the Melon link and audio files for a released album, and Onside handles the rest.",
  "핵심 Broadcaster 3개 Review Submission":
    "Core 3-Broadcaster Review Submission",
  "주요 Broadcaster 7개 Review Submission":
    "Main 7-Broadcaster Review Submission",
  "Broadcaster 10개 Review Submission": "10-Broadcaster Review Submission",
  "Broadcaster 13개 Review Submission": "13-Broadcaster Review Submission",
  "극동방송, 국악방송 추가": "Includes FEBC and Gugak FM",
  "추천 상황: 지상파 핵심만 빠르게 확인하고 싶은 경우":
    "Recommended when you only need the major terrestrial broadcasters.",
  "추천 상황: 기본 방송 홍보용으로 가장 많이 선택":
    "Most selected for standard broadcast promotion.",
  "추천 상황: 전국·종교·교통방송까지 포함하는 기본 확장":
    "Expanded package including national, religious, and traffic broadcasters.",
  "추천 상황: 라디오와 지역 방송까지 넓게 송출하려는 경우":
    "For broader radio and regional broadcast coverage.",
  "추천 상황: CCM·국악 등 특수 Broadcaster까지 필요한 경우":
    "For special broadcasters such as CCM and Korean traditional music.",
  "추천 상황:": "Recommended:",
  "지상파 핵심만 빠르게 확인하고 싶은 경우":
    "Major terrestrial broadcasters only",
  "기본 Broadcast 홍보용으로 가장 많이 선택":
    "Most selected for standard broadcast promotion",
  "기본 방송 홍보용으로 가장 많이 선택":
    "Most selected for standard broadcast promotion",
  "전국·종교·교통Broadcast까지 포함하는 기본 확장":
    "Expanded package including national, religious, and traffic broadcasters",
  "전국·종교·교통방송까지 포함하는 기본 확장":
    "Expanded package including national, religious, and traffic broadcasters",
  "라디오와 지역 Broadcast까지 넓게 Broadcast하려는 경우":
    "For broad radio and regional broadcast coverage",
  "라디오와 지역 방송까지 넓게 송출하려는 경우":
    "For broad radio and regional broadcast coverage",
  "CCM·국악 등 특수 Broadcaster까지 필요한 경우":
    "For special broadcasters such as CCM and Korean traditional music",
  "CCM·국악 등 특수 방송국까지 필요한 경우":
    "For special broadcasters such as CCM and Korean traditional music",
  "극동방송: CCM 음원만 가능": "FEBC: CCM music only",
  "국악방송: 국악 장르만 가능": "Gugak FM: Korean traditional music only",
  "다음 단계": "Next Step",
  "이전 단계": "Previous Step",
  "온라인 신청서 작성하기": "Fill Out Online Application",
  "신청서 다운로드 & 업로드하기": "Download & Upload Application",
  "신청서 파일 작성": "Application File",
  "신청서를 내려받아 작성한 뒤 다음 단계에서 업로드하세요.":
    "Download and complete the application, then upload it in the next step.",
  "HWP 또는 Word 파일 중 편한 형식을 선택하세요. 다운로드를 누르면 파일 업로드 단계로 이동합니다.":
    "Choose HWP or Word. After downloading, you will move to the file upload step.",
  "HWP 다운로드": "Download HWP",
  "Word 다운로드": "Download Word",
  "파일 업로드로 이동": "Go to File Upload",
  "다음 단계 파일 업로드에서 작성한 신청서(HWP/DOC/DOCX)와 음원 파일을 함께 첨부해주세요.":
    "In the next file upload step, attach the completed application (HWP/DOC/DOCX) and audio files.",
  "다음 단계 파일 업로드에서 작성한 신청서(HWP/DOC/DOCX)와 영상 파일을 함께 첨부해주세요.":
    "In the next file upload step, attach the completed application (HWP/DOC/DOCX) and video files.",
  "심의 받을 음원과 작성한 신청서 파일을 업로드해주세요.":
    "Upload the audio files for review and the completed application file.",
  "음원은 WAV/MP3 또는 ZIP, 신청서는 HWP/DOC/DOCX로 첨부하세요.":
    "Attach audio as WAV/MP3 or ZIP, and the application as HWP/DOC/DOCX.",
  "허용 형식: WAV/MP3/ZIP/HWP/DOC/DOCX":
    "Allowed formats: WAV/MP3/ZIP/HWP/DOC/DOCX",
  "방송국 심의 규격에 맞는 영상과 작성한 신청서 파일을 업로드해주세요.":
    "Upload the video that meets broadcaster requirements and the completed application file.",
  "심의에 사용할 최종 영상 파일과 작성한 신청서 파일을 업로드하세요.":
    "Upload the final video for review and the completed application file.",
  "허용 형식: MP4/MOV/WMV/MPG/MPEG/M4V/HWP/DOC/DOCX":
    "Allowed formats: MP4/MOV/WMV/MPG/MPEG/M4V/HWP/DOC/DOCX",
  "허용 형식: MP4/MOV/WMV/MPG/MPEG/M4V + HWP/DOC/DOCX":
    "Allowed formats: MP4/MOV/WMV/MPG/MPEG/M4V + HWP/DOC/DOCX",
  "허용 형식: MP4/MOV/WMV/MPG/MPEG/M4V":
    "Allowed formats: MP4/MOV/WMV/MPG/MPEG/M4V",
  "2GB 이상의 영상도 최대 4GB까지 업로드 가능하며, 어려우면 예전 온사이드 사이트에서 접수해주세요.":
    "Videos over 2 GB can be uploaded up to 4 GB. If upload is difficult, submit on the legacy Onside site.",
  "작성한 신청서 파일(HWP/DOC/DOCX)을 함께 업로드해주세요.":
    "Please also upload the completed application file (HWP/DOC/DOCX).",
  "음원 파일(WAV/MP3/ZIP)을 업로드하거나 파일 없이 진행을 선택해주세요.":
    "Upload audio files (WAV/MP3/ZIP) or choose to continue without files.",
  "음원 파일(WAV/MP3/ZIP)만 업로드할 수 있습니다.":
    "Only audio files (WAV/MP3/ZIP) can be uploaded.",
  "영상 파일(MP4/MOV/WMV/MPG)만 업로드할 수 있습니다.":
    "Only video files (MP4/MOV/WMV/MPG) can be uploaded.",
  "작성한 신청서 파일(HWP/DOC/DOCX)과 영상 파일을 업로드해주세요.":
    "Upload the completed application file (HWP/DOC/DOCX) and video file.",
  "영상 파일 첨부가 정상적으로 완료되지 않는 경우, 파일 없이 다음 단계로 진행하거나 예전 온사이드 사이트에서 접수해주세요.":
    "If the video upload does not complete normally, continue without files or submit on the legacy Onside site.",
  "신청서 다운로드하여 직접 작성한 경우 신청서도 영상과 함께 첨부해주세요.":
    "If you downloaded and completed the application form manually, attach the application form with the video as well.",
  "신청서 저장 중...": "Saving application...",
  "비회원도 Submission할 수 있으며, 로그인 시 마이페이지에서 진행 상황을 확인할 수 있습니다.":
    "Guest submission is available. If you log in, you can check progress from My Page.",
  "비회원도 접수할 수 있으며, 로그인 시 마이페이지에서 진행 상황을 확인할 수 있습니다.":
    "Guest submission is available. If you log in, you can check progress from My Page.",
  "업로드 전 확인": "Before Upload",
  "Music Video Review, 이것만 확인하세요": "Music Video Review Checklist",
  "뮤직비디오 심의, 이것만 확인하세요": "Music Video Review Checklist",
  "영상 파일: MOV 또는 MP4 권장": "Video file: MOV or MP4 recommended",
  "해상도: 1920×1080 권장": "Resolution: 1920x1080 recommended",
  "프레임: 29.97fps 권장": "Frame rate: 29.97 fps recommended",
  "프레임레이트: 29.97fps 권장": "Frame rate: 29.97 fps recommended",
  "TV 송출용은 Broadcaster 제출 조건 확인":
    "For TV broadcast, check broadcaster submission requirements",
  "TV Broadcast용은 Broadcaster 제출 조건 확인":
    "For TV broadcast, check broadcaster submission requirements",
  "티저·쇼츠·퍼포먼스 비디오는 목적에 따라 별도 확인":
    "Teasers, shorts, and performance videos require separate purpose-based review.",
  "멜론·지니·벅스·플로·유튜브 등 유통사 제출이나 온라인 업로드용으로 진행합니다.":
    "For distributor submission or online upload through Melon, Genie, Bugs, FLO, YouTube, and similar services.",
  "TV 송출": "TV Broadcast",
  "Broadcaster 송출 목적은 KBS, MBC, SBS 등 Broadcaster 조건과 편성 여부를 확인한 뒤 Submission합니다.":
    "For TV broadcast, submit after checking broadcaster requirements and programming eligibility for KBS, MBC, SBS, and others.",
  "Broadcaster Broadcast 목적은 KBS, MBC, SBS 등 Broadcaster 조건과 편성 여부를 확인한 뒤 Submission합니다.":
    "For TV broadcast, submit after checking broadcaster requirements and programming eligibility for KBS, MBC, SBS, and others.",
  "조건부 Broadcaster": "Conditional Broadcasters",
  "MBC M, Mnet, ETN은 방송 일정·아티스트 조건·온라인 Review 완료 여부에 따라 별도 확인이 필요합니다.":
    "MBC M, Mnet, and ETN require separate confirmation depending on broadcast schedule, artist conditions, and online review status.",
  "MBC M, Mnet, ETN은 Broadcast 일정·아티스트 조건·Online Review 완료 여부에 따라 별도 확인이 필요합니다.":
    "MBC M, Mnet, and ETN require separate confirmation depending on broadcast schedule, artist conditions, and online review status.",
  "MBC M, Mnet, ETN은 방송 일정·아티스트 조건·온라인 심의 완료 여부에 따라 별도 확인이 필요합니다.":
    "MBC M, Mnet, and ETN require separate confirmation depending on broadcast schedule, artist conditions, and online review status.",
  "목적 선택": "Purpose",
  "Music Video Review 목적을 선택하세요.": "Select the Music Video Review purpose.",
  "TV 송출용 Review와 유통/온라인 업로드 목적 Review를 구분합니다.":
    "Separate TV broadcast review from distribution/online upload review.",
  "TV Broadcast용 Review와 Distribution/Online 업로드 목적 Review를 구분합니다.":
    "Separate TV broadcast review from distribution/online upload review.",
  "REVIEW 목적": "Review Purpose",
  "Review 목적": "Review Purpose",
  "유통사 제출 & 온라인 업로드": "Distributor Submission & Online Upload",
  "온라인 유통을 위한 일반 Music Video Review입니다.":
    "Standard music video review for online distribution.",
  "Online Distribution을 위한 일반 Music Video Review입니다.":
    "Standard music video review for online distribution.",
  "TV 송출 목적의 Review": "TV Broadcast Review",
  "TV 송출 목적의 심의": "TV Broadcast Review",
  "Broadcaster로 개별 Review를 진행해야하며, 음원 Review가 완료된 앨범의 뮤비에 한하여 Review가 가능합니다.":
    "Each broadcaster requires separate review, and review is available only for music videos from albums with completed music review.",
  "Broadcaster로 개별 Review를 진행해야하며, Audio Review가 완료된 앨범의 Music Video에 한하여 Review가 가능합니다.":
    "Each broadcaster requires separate review, and review is available only for music videos from albums with completed music review.",
  "방송국별로 개별 심의를 진행해야하며, 음원 심의가 완료된 앨범의 뮤비에 한하여 심의가 가능합니다.":
    "Each broadcaster requires separate review, and review is available only for music videos from albums with completed music review.",
  "기본 Music Video Review는 바로 신청할 수 있고, Broadcaster 입고 옵션은 조건 확인 후 진행합니다.":
    "Standard music video review can be submitted immediately. Broadcaster delivery options proceed after requirement confirmation.",
  "일반 뮤직비디오 심의는 바로 신청할 수 있고, 방송국의 경우 접수 조건 확인 후 진행합니다.":
    "Standard music video review can be submitted immediately. Broadcaster delivery options proceed after requirement confirmation.",
  "일반 Music Video Review": "Standard Music Video Review",
  "Review 완료 후 등급분류를 영상에 삽입하면 Melon, 지니, 유튜브 등으로 온라인 유통이 가능합니다.":
    "After review, insert the rating mark into the video for online distribution through Melon, Genie, YouTube, and similar services.",
  "Review 완료 후 등급분류를 Video에 삽입하면 Melon, Genie, YouTube 등으로 Online Distribution이 가능합니다.":
    "After review, insert the rating mark into the video for online distribution through Melon, Genie, YouTube, and similar services.",
  "필증과 등급분류 파일이 제공되며, Melon, 지니, 유튜브 등 온라인 유통이 가능합니다.":
    "A certificate and rating file are provided for online distribution through Melon, Genie, YouTube, and similar services.",
  "유통사 제출용": "For Distributor Submission",
  "문의 필요": "Contact Required",
  "MBC M 방송 아티스트에 한해 Review 가능합니다.":
    "Available only for artists scheduled for MBC M broadcast.",
  "MBC M Broadcast 아티스트에 한해 Review 가능합니다.":
    "Available only for artists scheduled for MBC M broadcast.",
  "MBC M 방송 아티스트에 한해 심의 가능합니다.":
    "Available only for artists scheduled for MBC M broadcast.",
  "조건 확인 후 담당자 확인을 거쳐 진행됩니다.":
    "Proceed after requirement check and staff confirmation.",
  "방송 일정이 있는 경우에만 문의해주세요.":
    "Contact us only when a broadcast schedule exists.",
  "ETN 입고 옵션": "ETN Delivery Option",
  "온라인 Review 완료된 영상에 한하여 ETN 방송 '입고'만 가능합니다.":
    "ETN delivery is available only for videos with completed online review.",
  "Online Review 완료된 Video에 한하여 ETN Broadcast '입고'만 가능합니다.":
    "ETN delivery is available only for videos with completed online review.",
  "온라인 심의 완료된 영상에 한하여 ETN 방송 '입고'만 가능합니다.":
    "ETN delivery is available only for videos with completed online review.",
  "TV 송출 목적의 REVIEW": "TV Broadcast Review",
  "Broadcaster 개별 Review가 필요하며, 선택한 Broadcaster만 Submission됩니다.":
    "Separate broadcaster review is required. Only selected broadcasters are submitted.",
  "KBS는 1분 30초 편집본 제출이 필요합니다.":
    "KBS requires a 1 minute 30 second edited version.",
  "Review 완료 후 MBC 방송 송출이 가능합니다.":
    "MBC broadcast is possible after review completion.",
  "Review 완료 후 SBS 방송 송출이 가능합니다.":
    "SBS broadcast is possible after review completion.",
  "심의 완료 후 MBC 방송 송출이 가능합니다.":
    "MBC broadcast is possible after review completion.",
  "심의 완료 후 SBS 방송 송출이 가능합니다.":
    "SBS broadcast is possible after review completion.",
  "Review 완료 후 MBC Broadcast Broadcast이 가능합니다.":
    "MBC broadcast is possible after review completion.",
  "Review 완료 후 SBS Broadcast Broadcast이 가능합니다.":
    "SBS broadcast is possible after review completion.",
  "ETN Music Video 입고": "ETN Music Video Delivery",
  "온라인 Review 완료 후 ETN 방송 입고 가능합니다.":
    "ETN broadcast delivery is possible after online review completion.",
  "Online Review 완료 후 ETN Broadcast 입고 가능합니다.":
    "ETN broadcast delivery is possible after online review completion.",
  "온라인 심의 완료 후 ETN 방송 입고 가능합니다.":
    "ETN broadcast delivery is possible after online review completion.",
  "진행상황": "Progress",
  "접수현황": "Submission Status",
  "접수 현황": "Submission Status",
  "결제완료": "Payment Complete",
  "진행중": "In Progress",
  "완료": "Complete",
  "확인 필요": "Needs Attention",
  "진행 정보 준비 중": "Preparing Progress Details",
  "작성중 신청서": "Draft Application Forms",
  "이어쓰기": "Resume",
  "상세 보기": "Details",
  "상세보기": "Details",
  "장바구니가 비어 있습니다.": "Your cart is empty.",
  "원클릭 음반": "One-click Album",
  "MV · 온라인/방송": "MV · Online/Broadcast",
  "나의 심의 내역": "My Review History",
  "나의 크레딧": "My Credits",
  "크레딧 현황": "Credit Overview",
  "보유 크레딧": "Available Credits",
  "크레딧 사용": "Use Credits",
  "음반 1건 = +1": "1 Album = +1 Credit",
  "1크레딧": "1 Credit",
  "음반심의 결제 완료 건으로 발급되는 온사이드 크레딧을 확인하고 사용하세요.":
    "Check and use Onside credits issued from completed album review payments.",
  "음반심의 결제 완료 건으로 적립된 크레딧을 매거진 발행이나 서비스 이용권으로 사용할 수 있습니다.":
    "Use credits earned from paid album reviews for magazine publication or service requests.",
  "음반심의 결제 완료 건으로 적립된 크레딧을 매거진 발행이나 서비스 이용 요청에 사용할 수 있습니다.":
    "Use credits earned from paid album reviews for magazine publication or service requests.",
  "온사이드의 크레딧으로 필요한 서비스를 이용하세요.":
    "Use Onside credits for the services you need.",
  "결제 완료 음반심의 1건 = 1크레딧":
    "1 paid album review = 1 credit",
  "적립 크레딧은 매거진 발행, 녹음실 이용권 등으로 사용 가능합니다.":
    "Earned credits can be used for magazine publication, studio passes, and more.",
  "총 적립": "Total Earned",
  "결제 완료 및 지급 크레딧": "Paid and Issued Credits",
  "지금 교환 가능한 잔여 크레딧": "Credits Currently Available",
  "매거진 사용": "Magazine Use",
  "매거진 발행 요청에 사용": "Used for magazine requests",
  "이용권 사용": "Service Use",
  "서비스 이용 요청에 사용": "Used for service requests",
  "앨범심의 결제 완료 건마다 크레딧 1개가 발급됩니다. 크레딧은 워터멜론 매거진 발행 요청과 온사이드 연계 서비스 이용에 사용할 수 있습니다.":
    "Each completed album review payment issues 1 credit. Credits can be used for Watermelon magazine requests and Onside partner services.",
  "앨범심의 결제 완료 건마다 크레딧 1개가 발급됩니다. 크레딧은 매거진 발행, 녹음실 이용권 등 관리자가 등록한 온사이드 연계 서비스에 사용할 수 있습니다.":
    "Each completed album review payment issues 1 credit. Credits can be used for magazine publication, studio vouchers, and other Onside partner services registered by admins.",
  "매거진 바로가기": "Open Magazine",
  "매거진 발행 요청": "Magazine Publication Request",
  "매거진 발행 요청하기": "Request Magazine Publication",
  "아티스트·앨범 콘텐츠 발행": "Publish Artist and Album Content",
  "발행 요청하기": "Request Publication",
  "발행 요청": "Request Publication",
  "크레딧 요약": "Credit Summary",
  "크레딧 사용하기": "Use Credits",
  "워터멜론 매거진 발행 요청": "Watermelon Magazine Publication Request",
  "신청 방식": "Request Method",
  "로그인 후 보유 크레딧으로 매거진 등록을 신청할 수 있습니다.":
    "Log in to request a magazine listing with your available credits.",
  "음반심의 접수건 연결 없이 보유 크레딧 1개로 매거진 등록을 신청할 수 있습니다.":
    "You can request a magazine listing with 1 available credit, without linking an album review submission.",
  "현재 사용 가능 크레딧은": "Currently available credits:",
  "앨범명 / 콘텐츠명": "Album / Content Title",
  "매거진에 표시할 제목": "Title to display in the magazine",
  "아티스트명 / 표시명": "Artist / Display Name",
  "아트워크 파일": "Artwork File",
  "선택된 파일 없음": "No file selected",
  "JPG, PNG, WEBP, GIF · 20MB 이하": "JPG, PNG, WEBP, GIF · up to 20MB",
  "멜론 또는 지니 링크": "Melon or Genie Link",
  "유튜브 영상 주소": "YouTube Video URL",
  "사용 가능한 크레딧 없음": "No credits available",
  "매거진 등록 신청이 접수되었습니다. 관리자가 내용을 확인합니다.":
    "Your magazine listing request has been submitted. The admin will review it.",
  "매거진 등록 신청 1회 또는 서비스 이용권 교환 시 잔여 크레딧에서 차감됩니다.":
    "Each magazine listing request or service voucher exchange is deducted from your remaining credits.",
  "매거진 등록 신청 또는 서비스 이용권 교환 시 잔여 크레딧에서 차감됩니다.":
    "Magazine listing requests or service voucher exchanges are deducted from your remaining credits.",
  "자유 신청": "Free-form Request",
  "회원가입 후 크레딧 사용": "Sign Up to Use Credits",
  "앨범심의 결제 완료 1건당 크레딧 1개가 발급됩니다.":
    "1 credit is issued for each completed album review payment.",
  "크레딧으로 워터멜론 매거진 발행 요청과 온사이드 연계 다양한 서비스를 이용할 수 있습니다.":
    "Use credits for Watermelon magazine requests and various Onside partner services.",
  "크레딧으로 워터멜론 매거진 발행 요청, 녹음실 이용권, 관리자가 추가하는 온사이드 연계 서비스를 이용할 수 있습니다.":
    "Use credits for Watermelon magazine requests, studio vouchers, and Onside partner services added by admins.",
  "크레딧 이용권이 발행되었습니다. 쿠폰코드는 보유 크레딧 페이지에서도 확인할 수 있습니다.":
    "Your credit voucher has been issued. You can also find the coupon code on the Available Credits page.",
  "크레딧 이용권이 발행되었습니다. 쿠폰코드를 확인해주세요.":
    "Your credit voucher has been issued. Please check the coupon code.",
  "서비스 이용권 발행 완료": "Service Voucher Issued",
  "서비스 이용 요청 접수": "Service Request Received",
  "서비스 이용 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.":
    "Your service request has been received. Instructions will appear after admin approval.",
  "녹음실 사용 신청 완료": "Studio Use Request Submitted",
  "녹음실 예약 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.":
    "Your studio reservation request has been submitted. Guidance will be shown after admin approval.",
  "적어주신 연락처로 녹음실 사용 안내를 드립니다.":
    "Studio use guidance will be sent to the contact details you entered.",
  "녹음실 예약 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.\n적어주신 연락처로 녹음실 사용 안내를 드립니다.":
    "Your studio booking request has been received. Instructions will appear after admin approval.\nWe will contact you using the contact details you provided.",
  "크레딧 사용 완료": "Credit Use Complete",
  "요청 내역": "Request History",
  "매거진 · 서비스": "Magazine · Services",
  "사용 내역": "Usage History",
  "적립 내역": "Earning History",
  "전체 요청 보기": "View All Requests",
  "요청 내역이 없습니다.": "No request history yet.",
  "요청 내역 보기": "View Request History",
  "크레딧 요청 내역 보기": "View Credit Request History",
  "크레딧 사용 요청 내역": "Credit Use Request History",
  "서비스 이용 신청": "Service Use Request",
  "서비스 이용 요청": "Service Request",
  "서비스 이용 요청하기": "Request a Service",
  "요청하기": "Request",
  "서비스 보기": "View Services",
  "크레딧 사용해서 신청": "Request with Credits",
  "서비스 이용권 신청": "Service Voucher Requests",
  "녹음실 등 연계 서비스 신청":
    "Request linked services such as studios",
  "서비스별 차감": "Varies by service",
  "요청 접수": "Request Received",
  "요청접수": "Request Received",
  "승인/안내 완료": "Approved / Guidance Sent",
  "작성 중": "Writing",
  "사용 완료": "Used",
  "사용완료": "Used",
  "취소됨": "Canceled",
  "국내뉴스": "Domestic News",
  "미디어": "Media",
  "서비스 위치 미입력": "Service Location Missing",
  "사용완료된 이용권": "Used Vouchers",
  "아직 사용완료된 이용권이 없습니다.": "There are no used vouchers yet.",
  "크레딧 적립 내역": "Credit Earning History",
  "결제 완료된 음반심의 건마다 1크레딧이 자동 적립됩니다.":
    "1 credit is automatically earned for each paid album review.",
  "아직 크레딧으로 적립된 음반심의 결제 건이 없습니다.":
    "There are no paid album reviews that earned credits yet.",
  "아직 크레딧으로 접수한 매거진 발행 또는 서비스 이용권 신청이 없습니다.":
    "There are no magazine publication or service requests submitted with credits yet.",
  "아직 크레딧으로 접수한 매거진 발행 또는 서비스 이용 요청이 없습니다.":
    "There are no magazine publication or service requests submitted with credits yet.",
  "발행 페이지 보기": "View Published Page",
  "관리자 메모": "Admin Memo",
  "녹음실 위치 보기": "View Studio Location",
  "희망 날짜": "Preferred Date",
  "희망 시간": "Preferred Time",
  "요청사항": "Request Notes",
  "희망 시간대, 이용 목적, 안내받을 내용 등을 함께 적어주세요.":
    "Enter your preferred time, purpose of use, and any details you need guidance on.",
  "크레딧 적립 내역 페이지": "Credit earning history page",
  "이전 페이지": "Previous page",
  "다음 페이지": "Next page",
  "크레딧 이용권, 매거진 발행 요청, 서비스 이용권 신청을 관리합니다.":
    "Manage credit vouchers, magazine requests, and service voucher requests.",
  "사용처 선택": "Choose How to Use Credits",
  "워터멜론 매거진": "Watermelon Magazine",
  "1크레딧으로 발행 요청": "Request publication with 1 credit",
  "서비스 이용권": "Service Vouchers",
  "녹음실 등 관리자 등록 서비스": "Admin-registered services such as studios",
  "크레딧으로 이용 가능한 서비스": "Services Available with Credits",
  "관리자가 등록한 녹음실 이용권과 온사이드 연계 서비스를 크레딧으로 교환할 수 있습니다. 새 서비스가 추가되면 이 탭에 자동으로 노출됩니다.":
    "Redeem credits for admin-registered studio vouchers and Onside partner services. New services appear in this tab automatically.",
  "사용 가능": "Available",
  "로그인 필요": "Login Required",
  "로그인이 필요합니다.": "Login Required.",
  "기본 신청 비용": "Base Fee",
  "태진 등록 요청": "Request TJ Registration",
  "금영 등록 요청": "Request KY Registration",
  "로그인 후 이용": "Log In to Use",
  "녹음실 살펴보기": "View Studio",
  "크레딧으로 이용권 발행": "Issue Voucher with Credits",
  "크레딧 부족": "Not Enough Credits",
  "현재 교환 가능한 서비스 이용권이 없습니다. 관리자 등록 후 이 탭에 서비스가 표시됩니다.":
    "There are no service vouchers available right now. Services will appear here after an admin registers them.",
  "현재 신청 가능한 서비스가 없습니다.": "There are no services available right now.",
  "서비스 사용": "Service Use",
  "크레딧 서비스 관리": "Credit Service Management",
  "크레딧 사용 서비스와 요청 접수를 관리합니다.":
    "Manage credit-use services and submitted requests.",
  "등록된 서비스": "Registered Services",
  "새 서비스 등록": "Add New Service",
  "서비스명": "Service Name",
  "사용자에게 보이는 서비스 설명": "Service description shown to users",
  "보유 크레딧에서 발행 내역 보기": "View Issued Vouchers in Available Credits",
  "계정정보": "Account Info",
  "접수한 심의의 현재 상태를 확인할 수 있습니다.":
    "Check the current status of your submitted reviews.",
  "심의 기록을 발매 음원 단위로 확인합니다.":
    "View review records by release.",
  "진행 현황을 불러오는 중입니다...": "Loading review progress...",
  "진행 현황 응답이 지연되고 있습니다. 다시 시도해주세요.":
    "The review progress response is delayed. Please try again.",
  "진행 현황을 불러오지 못했습니다.":
    "Could not load review progress.",
  "불러오기 실패": "Loading failed",
  "다시 불러오기": "Retry",
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
  "뮤직비디오": "Music Video",
  "실시간": "Live",
  "전체 심의 완료": "All Reviews Completed",
  "자세히 보기": "View Details",
  "자세히 보기 →": "View Details →",
  "진행률": "Progress",
  "심의 등급": "Review Rating",
  "영상물등급위원회": "Korea Media Rating Board",
  "진행률 : 총 1곳 중 0곳 완료": "Progress: 0 of 1 completed",
  "온사이드 로그인": "Onside Login",
  "온사이드 회원가입": "Onside Sign Up",
  "계정이 없으신가요?": "Don't have an account?",
  "회원가입": "Sign Up",
  "회원가입이 완료되었습니다. 로그인 후 접수와 결과 확인을 이어서 진행할 수 있습니다.":
    "Sign up is complete. Log in to continue submission and result checking.",
  "이메일": "Email",
  "비밀번호": "Password",
  "비밀번호 찾기": "Forgot Password",
  "비회원 Submission 조회하기": "Guest Submission Lookup",
  "비밀번호 재설정": "Reset Password",
  "비밀번호를 다시 설정하세요": "Reset Your Password",
  "가입한 이메일을 입력하면 재설정 링크를 보내드립니다.":
    "Enter your registered email and we will send a reset link.",
  "비회원 Submission 내역을 찾는 경우 비밀번호 재설정이 아니라 조회 코드 찾기를 이용해주세요.":
    "For guest submissions, use lookup code search instead of password reset.",
  "재설정 메일 보내기": "Send Reset Email",
  "로그인으로 돌아가기": "Back to Login",
  "링크를 확인해주세요": "Check Your Link",
  "비밀번호를 재설정한 뒤 새 비밀번호로 로그인해주세요.":
    "Reset your password, then log in with the new password.",
  "유효한 비밀번호 재설정 링크가 아닙니다. 메일의 링크를 다시 클릭해주세요.":
    "This is not a valid password reset link. Please click the link in the email again.",
  "새 비밀번호": "New Password",
  "새 비밀번호 확인": "Confirm New Password",
  "비밀번호 변경하기": "Change Password",
  "이메일 주소": "Email Address",
  "비밀번호 확인": "Confirm Password",
  "계정 만들기": "Create Account",
  "약관 동의": "Agreement",
  "이용약관 보기": "View Terms",
  "개인정보처리방침 보기": "View Privacy Policy",
  "만 14세 이상입니다.": "I am at least 14 years old.",
  "이용약관에 동의합니다.": "I agree to the Terms of Use.",
  "개인정보처리방침에 동의합니다.": "I agree to the Privacy Policy.",
  "Payment/환불 정책을 확인했습니다.": "I have checked the payment/refund policy.",
  "Review 안내 및 서비스 소식 수신에 동의합니다. (선택)":
    "I agree to receive review notices and service news. (Optional)",
  "이미 계정이 있나요? Login": "Already have an account? Login",
  "이미 계정이 있나요?": "Already have an account?",
  "Review Submission와 Payment, Result 통보, 승인 기록 아카이브까지 온사이드에서 한 번에 관리하세요.":
    "Manage review submissions, payments, result notices, and approval archives in Onside.",
  "Review Submission와 Payment, Result 통보, 승인 기록 아카이브까지 Onside에서 한 번에 관리하세요.":
    "Manage review submissions, payments, result notices, and approval archives in Onside.",
  "심의 접수와 결제, 결과 통보, 승인 기록 아카이브까지 온사이드에서 한 번에 관리하세요.":
    "Manage review submissions, payments, result notices, and approval archives in Onside.",
  "회원가입은 이메일과 비밀번호만으로 시작하고, 신청자명·연락처·회사·세금계산서 정보는 실제 Review 신청 단계에서 받습니다.":
    "Sign up starts with only email and password. Applicant, phone, company, and tax invoice details are collected during the actual review application.",
  "회원가입은 이메일과 비밀번호만으로 시작하고, Applicant Name·연락처·회사·Tax Invoice 정보는 실제 Review 신청 단계에서 받습니다.":
    "Sign up starts with only email and password. Applicant, phone, company, and tax invoice details are collected during the actual review application.",
  "이미 계정이 있으신가요?": "Already have an account?",
  "으로 이동하세요.": "to continue.",
  "결제하기": "Payment",
  "수정하기": "Edit",
  "결제가 취소되었습니다.": "Payment was canceled.",
  "결제에 실패했습니다.": "Payment failed.",
  "결제가 완료되었습니다.": "Payment completed.",
  "결제가 완료되지 않았습니다.": "Payment was not completed.",
  "원클릭 접수 안내": "One-Click Submission",
  "이미 발매된 음원만 신청할 수 있습니다.":
    "Only released music is eligible.",
  "필수 제출 항목": "Required Items",
  "멜론 링크": "Melon Link",
  "접수자 정보": "Applicant Details",
  "음원 파일": "Audio File",
  "24시간 내 확인 · 입금자명이 다르면 문의해주세요.":
    "Confirmed within 24 hours · Contact us if the depositor name differs.",
  "유효하지 않은 접수 ID입니다.": "Invalid Submission ID.",
  "유효하지 않은 Submission ID입니다.": "Invalid Submission ID.",
  "결제를 다시 진행할 접수 ID를 확인할 수 없습니다. 신청 내역에서 결제하기를 다시 눌러주세요.":
    "We could not identify the submission ID for retrying payment. Please open payment again from your submission history.",
  "Payment를 다시 진행할 Submission ID를 확인할 수 없습니다. 신청 내역에서 Payment하기를 다시 눌러주세요.":
    "We could not identify the submission ID for retrying payment. Please open payment again from your submission history.",
  "접수 내역을 찾을 수 없습니다.":
    "Submission not found.",
  "결제를 다시 진행할 신청 내역을 불러오지 못했습니다. 신청 내역에서 다시 시도해주세요.":
    "We could not load the submission for retrying payment. Please try again from your submission history.",
  "접수 권한이 없습니다.": "You do not have access to this submission.",
  "이 접수를 결제할 수 있는 계정으로 로그인했거나 비회원 조회 링크로 접근했는지 확인해주세요.":
    "Please check that you are logged in with the account that can pay for this submission or that you used the guest lookup link.",
  "이 접수를 열람할 수 있는 계정으로 로그인했는지 확인해주세요.":
    "Please check that you are logged in with the account that can view this submission.",
  "접수 상세를 불러올 수 없습니다.":
    "Could Not Load Submission Detail.",
  "요청한 접수 ID가 존재하지 않거나 조회 권한이 없습니다.":
    "The requested submission ID does not exist or you do not have permission to view it.",
  "URL에 접수 ID가 포함되어 있는지 확인해주세요.":
    "Please check that the URL includes a submission ID.",
  "URL에 Submission ID가 포함되어 있는지 확인해주세요.":
    "Please check that the URL includes a submission ID.",
  "입력 없음": "No Input",
  "로그인 후 다시 시도": "Log In and Try Again",
  "나의 심의 내역으로 돌아가기": "Back to My Review History",
  "나의 Review 내역으로 돌아가기": "Back to My Review History",
  "접수 상세로": "Go to Submission Detail",
  "접수 현황으로": "Go to Submission Status",
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
  "장바구니": "Cart",
  "장바구니에 담기": "Add to Cart",
  "담고 결제하기": "Add and Pay",
  "신청서를 장바구니에 담았습니다.": "Application Added to Cart.",
  "신청서는 장바구니에 보관됩니다.":
    "The application remains in your cart.",
  "결제에 실패했습니다. 신청서는 장바구니에 보관됩니다.":
    "Payment failed. The application remains in your cart.",
  "마이페이지 - 장바구니": "My Page - Cart",
  "마이페이지 - 장바구니 | 온사이드": "My Page - Cart | Onside",
  "작성 완료된 미결제 신청서를 담아 두고 한 번에 결제할 수 있습니다.":
    "Keep completed unpaid applications here and pay for them together.",
  "장바구니를 불러오는 중입니다...": "Loading your cart...",
  "장바구니에 담긴 미결제 신청서가 없습니다.":
    "There are no unpaid applications in your cart.",
  "새 신청서 작성": "Create a New Application",
  "전체 선택": "Select All",
  "전체 해제": "Clear All",
  "선택 삭제": "Delete Selected",
  "삭제 중": "Deleting",
  "삭제할 임시저장 신청서를 확인하지 못했습니다. 다시 시도해주세요.":
    "The saved draft could not be identified. Please try again.",
  "임시저장 삭제에 실패했습니다. 다시 시도해주세요.":
    "The saved draft could not be deleted. Please try again.",
  "수정": "Edit",
  "삭제": "Delete",
  "삭제 확인": "Confirm Deletion",
  "취소": "Cancel",
  "결제 요약": "Payment Summary",
  "선택한 신청서": "Selected Applications",
  "총 결제 금액": "Total Payment",
  "선택 결제하기": "Pay for Selected Items",
  "결제 준비 중": "Preparing Payment",
  "결제 다시 선택": "Choose Payment Again",
  "변경 중": "Updating",
  "아직 입금하지 않았다면 입금 신청을 취소하고 결제 수단을 다시 선택할 수 있습니다.":
    "If you have not transferred the payment, you can cancel the bank-transfer request and choose a payment method again.",
  "이미 입금했다면 입금 확인을 기다려주세요.":
    "If you have already transferred the payment, please wait for deposit verification.",
  "결제 수단을 다시 선택할 수 없습니다. 잠시 후 다시 시도해주세요.":
    "Payment selection could not be reopened. Please try again shortly.",
  "같은 사이트에서 다시 요청해주세요.": "Please try again from this site.",
  "결제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.":
    "Too many payment requests. Please try again shortly.",
  "결제 수단을 다시 선택할 신청서를 확인해주세요.":
    "Select the applications whose payment method you want to choose again.",
  "신청서 정보를 확인하지 못했습니다.": "The application details could not be verified.",
  "신청서의 소유권을 확인할 수 없습니다.": "Application ownership could not be verified.",
  "함께 작성한 앨범 묶음 전체의 결제 수단을 다시 선택해주세요.":
    "Choose the payment method again for the entire album group.",
  "결제 또는 심의 상태가 변경되었습니다. 입금 전인 무통장 신청만 취소할 수 있습니다.":
    "The payment or review status has changed. Only bank-transfer requests awaiting payment can be canceled.",
  "무통장 입금 신청을 취소하지 못했습니다. 잠시 후 다시 시도해주세요.":
    "The bank-transfer request could not be canceled. Please try again shortly.",
  "변경된 결제 상태를 확인하지 못했습니다. 장바구니를 새로고침해주세요.":
    "The updated payment status could not be verified. Please refresh your cart.",
  "무통장 입금으로 선택": "Continue with Bank Transfer",
  "계좌": "Account",
  "입금 금액": "Transfer Amount",
  "패키지 미지정": "Package Not Selected",
  "금액 확인 필요": "Amount Requires Review",
  "확인이 필요합니다.": "Action Required",
  "완료되었습니다.": "Completed",
  "안내": "Notice",
  "결제할 신청서를 선택해주세요.": "Select at least one application to pay.",
  "결제 금액을 확인할 수 없습니다.": "The payment amount could not be verified.",
  "신청서가 장바구니에 담겼습니다. 결제할 신청서를 선택해주세요.":
    "The application was added to your cart. Select the applications you want to pay for.",
  "선택한 신청서를 한 번에 입금 대기 상태로 변경합니다.":
    "Move all selected applications to bank-transfer pending status.",
  "선택한 신청서를 KG이니시스 카드 결제로 한 번에 결제합니다.":
    "Pay for all selected applications together by card through KG Inicis.",
  "이 장바구니 항목을 삭제할까요? 연결된 접수 현황도 함께 삭제되며 복구할 수 없습니다.":
    "Delete this cart item? Its linked submission status will also be deleted and cannot be restored.",
  "장바구니 항목이 삭제되었습니다.": "The cart item was deleted.",
  "장바구니 항목 삭제에 실패했습니다.": "The cart item could not be deleted.",
  "장바구니 항목 삭제 중 오류가 발생했습니다.":
    "An error occurred while deleting the cart item.",
  "무통장 입금 대기 상태로 변경되었습니다. 아래 계좌로 총액을 입금해주세요.":
    "Bank-transfer pending status is set. Please transfer the total amount to the account below.",
  "결제가 완료되지 않았습니다. 신청서는 장바구니에 유지됩니다.":
    "Payment was not completed. Your applications remain in the cart.",
  "결제가 취소되었습니다. 신청서는 장바구니에 유지됩니다.":
    "Payment was canceled. Your applications remain in the cart.",
  "방송국 패키지 선택": "Broadcaster Package",
  "신청서 작성": "Application Form",
  "기본 정보": "Basic Information",
  "트랙 정보": "Track Information",
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
  "가수명": "Performer",
  "가수명 *": "Performer *",
  "모든 트랙의 가수명을 입력해주세요.":
    "Enter a performer for every track.",
  "번역": "Translation",
  "메모": "Memo",
  "저장": "Save",
  "임시 저장": "Save Draft",
  "트랙 임시 저장": "Save Track Draft",
  "저장하고 다음 단계": "Save and Continue",
  "저장하고 파일 업로드": "Save and Upload Files",
  "기본 정보 수정": "Edit Basic Information",
  "같은 참여진으로 추가": "Add with Same Credits",
  "빈 트랙 추가": "Add Blank Track",
  "현재 참여진을 빈칸에 적용": "Fill Blank Credits",
  "선택을 확정하면 기본 정보 단계로 이동합니다.":
    "Confirm your choice to continue to basic information.",
  "선택을 확정하면 작성 방식 단계로 이동합니다.":
    "Confirm your choice to continue to the form method step.",
  "다음": "Next",
  "이전": "Previous",
  "제출": "Submit",
  "접수하기": "Submit",
  "신청하기": "Apply",
  "확인": "OK",
  "현재 파일": "Current File",
  "다운로드": "Download",
  "심의 상세": "Review Detail",
  "접수 정보": "Submission Information",
  "방송국별 진행표": "Broadcaster Progress",
  "심의 진행 상황": "Review Progress",
  "심의 결과": "Review Result",
  "필증": "Certificate",
  "가이드": "Guide",
  "결과": "Result",
  "상태": "Status",
  "업데이트": "Updated",
  "방송국": "Broadcaster",
  "접수 상태": "Submission Status",
  "적격/부적격": "Eligible/Ineligible",
  "대기": "Pending",
  "접수대기": "Waiting",
  "접수완료": "Submitted",
  "심의진행중": "Submitted",
  "최종 통보": "Final Notice",
  "결과 반영 대기": "Result Pending",
  "결과 반영 완료": "Result Reflected",
  "적격": "Approved",
  "부적격": "Rejected",
  "부분 적격": "Partially Approved",
  "수정요청": "Revision Requested",
  "결제 확인": "Payment Confirmed",
  "입금 확인 중": "Verifying Deposit",
  "현재 상태": "Current Status",
  "심의 진행 단계": "Review Progress",
  "신청서 작성 및 제출": "Application Submitted",
  "방송사 접수": "Broadcaster Submission",
  "적격/부적격 통보": "Eligibility Results",
  "방송사별 결과 대기": "Awaiting Broadcaster Results",
  "방송사별 결과 순차 반영": "Updating Broadcaster Results",
  "방송사별 결과 반영 완료": "Broadcaster Results Complete",
  "진행": "In Progress",
  "신청서 확인": "View Application",
  "접수 완료": "Submitted",
  "접수 대기": "Waiting",
  "심의 진행": "In Review",
  "결과 전달": "Result Delivered",
  "총 PAYMENT 금액": "Total Payment Amount",
  "총 Payment 금액": "Total Payment Amount",
  "영상 제목": "Video Title",
  "영상 파일": "Video File",
  "영상": "Video",
  "원": "KRW",
  "✓ 선택됨": "Selected",
  "CBS 기독교방송": "CBS Christian Broadcasting",
  "WBS 원음방송": "WBS Won Buddhism Broadcasting",
  "TBS 교통방송": "TBS Traffic Broadcasting",
  "PBC 평화방송": "PBC Peace Broadcasting",
  "BBS 불교방송": "BBS Buddhist Broadcasting",
  "ARIRANG 방송": "Arirang Broadcasting",
  "Arirang 방송": "Arirang Broadcasting",
  "경인 IFM": "Gyeongin iFM",
  "경인 iFM": "Gyeongin iFM",
  "TBN 한국교통방송": "TBN Korea Transportation Broadcasting",
  "KISS 디지털 라디오 음악방송": "KISS Digital Radio",
  "극동방송": "FEBC",
  "국악방송": "Gugak FM",
  "상담시간 10:00 ~ 18:00 (주말/공휴일 휴무)":
    "Support Hours 10:00-18:00 (Closed weekends and holidays)",
  "전화": "Phone",
  "입금 계좌": "Bank Account",
  "국민은행 073001-04-276967 · 예금주 빈티지하우스":
    "Kookmin Bank 073001-04-276967 · Account Holder Vintage House",
  "사이트 링크": "Site Links",
  "펼치기": "Expand",
  "접기": "Collapse",
  "닫기": "Close",
  "약관/정책": "Terms / Policies",
  "사업자 정보": "Business Information",
  "회사소개": "Company",
  "심의 안내": "Review Guide",
  "이용약관": "Terms of Use",
  "개인정보처리방침": "Privacy Policy",
  "환불/취소 규정": "Refund / Cancellation Policy",
  "파일 보관/삭제 정책": "File Storage / Deletion Policy",
  "제휴안내": "Partnership",
  "회사명:": "Company:",
  "대표자:": "Representative:",
  "주소:": "Address:",
  "사업자등록번호:": "Business Registration No.:",
  "통신판매업신고번호:": "Mail-order Business No.:",
  "개인정보 보호책임자:": "Privacy Officer:",
  "호스팅 제공자:": "Hosting Provider:",
  "(주)빈티지하우스": "Vintage House Co., Ltd.",
  "(주)Vintage House": "Vintage House Co., Ltd.",
  "주식회사 빈티지하우스": "Vintage House Co., Ltd.",
  "주식회사 Vintage House": "Vintage House Co., Ltd.",
  "정준영": "Jung Junyoung",
  "경기도 김포시 사우중로74번길 29 (사우동) 시그마프라자 7층 뮤직스튜디오":
    "7F Music Studio, Sigma Plaza, 29 Saujung-ro 74beon-gil, Gimpo-si, Gyeonggi-do, Korea",
  "(주)가비아인터넷서비스": "Gabia Internet Service Co., Ltd.",
  "Copyright © (주)빈티지하우스. All Rights Reserved.":
    "Copyright © Vintage House Co., Ltd. All Rights Reserved.",
  "Copyright © (주)Vintage House. All Rights Reserved.":
    "Copyright © Vintage House Co., Ltd. All Rights Reserved.",
  "자주 묻는 질문": "Frequently Asked Questions",
  "Preparation, Payment, 진행 확인, Result 수령에서 자주 묻는 내용을 정리했습니다.":
    "Frequently asked questions about required materials, payment, progress tracking, and result delivery.",
  "사전 준비 사항, Payment, 진행 확인, Result 수령에서 자주 묻는 내용을 정리했습니다.":
    "Frequently asked questions about required materials, payment, progress tracking, and result delivery.",
  "사전 준비 사항, 결제, 진행 확인, 결과 수령에서 자주 묻는 내용을 정리했습니다.":
    "Frequently asked questions about required materials, payment, progress tracking, and result delivery.",
  "자료 준비": "Materials",
  "열기": "Open",
  "고객센터 보기": "View Support",
  "지금 Review 신청": "Apply Now",
  "Review 안내": "Review Guide",
  "Album과 Music Video Review 흐름, Preparation, 자주 묻는 질문을 정리했습니다.":
    "Review flow, required materials, and FAQs for album and music video review.",
  "Album과 Music Video Review 흐름, 사전 준비 사항, 자주 묻는 질문을 정리했습니다.":
    "Review flow, required materials, and FAQs for album and music video review.",
  "음반·뮤직비디오 심의의 공통 흐름, 유형별 차이, 준비 항목을 정리했습니다.":
    "Common review flow, service differences, and preparation items for album and music video review.",
  "심의 진행 흐름": "Review Process",
  "음반은 음원·가사·앨범 정보, 뮤직비디오는 영상 파일과 송출 목적을 정리합니다.":
    "For albums, prepare audio, lyrics, and album information. For music videos, prepare the video file and release purpose.",
  "신청·결제": "Application and Payment",
  "온라인 신청서 작성 후 카드 결제 또는 무통장 입금을 선택합니다.":
    "After completing the online application, choose card payment or bank transfer.",
  "진행·결과 확인": "Progress and Result Check",
  "마이페이지 또는 조회 코드로 진행 현황과 결과 파일을 확인합니다.":
    "Check progress and result files from My Page or with a lookup code.",
  "유형별 핵심 안내": "Review Type Highlights",
  "TV·라디오 송출 전 방송국이 음원, 가사, 앨범 정보를 확인합니다.":
    "Broadcasters check audio, lyrics, and album information before TV or radio broadcast.",
  "주요·지역 방송국별 일정 상이":
    "Schedules vary by major and regional broadcasters",
  "발매 전·후 접수 가능": "Available before or after release",
  "음반심의 신청하기": "Apply for Album Review",
  "뮤직비디오 심의": "Music Video Review",
  "온라인 유통, 업로드, TV 송출 목적에 맞춰 영상 등급과 제출 조건을 확인합니다.":
    "Checks video rating and submission requirements for online distribution, upload, or TV broadcast.",
  "온라인용은 유통 제출 중심": "Online review focuses on distribution submission",
  "TV 송출용은 방송국별 조건 확인":
    "TV broadcast review requires checking each broadcaster's conditions",
  "뮤직비디오 심의 신청하기": "Apply for Music Video Review",
  "AlbumReview, 이렇게 진행됩니다": "How Album Review Works",
  "AlbumReview란?": "What Is Album Review?",
  "TV·라디오 송출 전 Broadcaster이 음원, 가사, 앨범 정보를 확인하는 절차입니다.":
    "A process where broadcasters check music, lyrics, and album information before TV or radio broadcast.",
  "TV·라디오 Broadcast 전 Broadcaster이 Audio, Lyrics, 앨범 정보를 확인하는 절차입니다.":
    "A process where broadcasters check music, lyrics, and album information before TV or radio broadcast.",
  "TV·라디오 송출 전 방송국이 음원, 가사, 앨범 정보를 확인하는 절차입니다.":
    "A process where broadcasters check music, lyrics, and album information before TV or radio broadcast.",
  "Broadcaster Review 현황": "Broadcaster Review Status",
  "MBC, SBS, KBS 등 주요 Broadcaster과 지역 Broadcaster로 Submission·Result 일정이 다릅니다.":
    "Submission and result schedules vary by major and regional broadcasters such as MBC, SBS, and KBS.",
  "Result 기간: Submission 후 1일~최대 3주":
    "Result timeline: 1 day to up to 3 weeks after submission",
  "발매 전·후 모두 Submission 가능": "Available before or after release",
  "Release 전·후 모두 Submission 가능": "Available before or after release",
  "일부 Broadcaster은 직접 제출 기준":
    "Some broadcasters require direct submission standards",
  "온사이드의 Review 대행": "Onside Review Support",
  "Onside의 Review 대행": "Onside Review Support",
  "Submission, 자료 확인, Payment, Result 안내를 한 흐름으로 관리합니다.":
    "Submission, material check, payment, and result guidance are managed in one flow.",
  "Submission, Materials 확인, Payment, Result 안내를 한 흐름으로 관리합니다.":
    "Submission, material check, payment, and result guidance are managed in one flow.",
  "온라인 Submission·카드 Payment 지원":
    "Online submission and card payment supported",
  "Online Submission·카드 Payment 지원":
    "Online submission and card payment supported",
  "온라인 접수·카드 결제 지원":
    "Online submission and card payment supported",
  "디지털 Album은 Review용 CD·가사집 제작 지원":
    "Review CD and lyric booklet support for digital albums",
  "디지털 Album은 Review용 CD·Lyrics집 제작 지원":
    "Review CD and lyric booklet support for digital albums",
  "디지털 음반은 심의용 CD·가사집 제작 지원":
    "Review CD and lyric booklet support for digital albums",
  "진행 현황과 Result를 개별 페이지에서 확인":
    "Check progress and results on each detail page",
  "ALBUMREVIEW 신청하러 가기": "Apply for Album Review",
  "AlbumReview 신청하러 가기": "Apply for Album Review",
  "Music Video Review, 이렇게 진행됩니다": "How Music Video Review Works",
  "Music Video Review란?": "What Is Music Video Review?",
  "유통, 온라인 업로드, TV 송출 목적에 맞춰 영상 등급과 제출 조건을 확인합니다.":
    "Checks video rating and submission requirements for distribution, online upload, or TV broadcast.",
  "Broadcaster 및 영등위 Review 현황":
    "Broadcaster and Rating Board Review Status",
  "Broadcaster 및 Korea Media Rating Board Review 현황":
    "Broadcaster and Rating Board Review Status",
  "온라인용은 유통 제출 중심, TV 송출용은 Broadcaster 개별 조건 확인이 필요합니다.":
    "Online review focuses on distribution submission. TV broadcast review requires checking each broadcaster's conditions.",
  "Online용은 Distribution 제출 중심, TV Broadcast용은 Broadcaster 개별 조건 확인이 필요합니다.":
    "Online review focuses on distribution submission. TV broadcast review requires checking each broadcaster's conditions.",
  "온라인용은 유통 제출 중심, TV 송출용은 방송국별 개별 조건 확인이 필요합니다.":
    "Online review focuses on distribution submission. TV broadcast review requires checking each broadcaster's conditions.",
  "온사이드의 뮤비 Review 대행": "Onside MV Review Support",
  "Onside의 Music Video Review 대행": "Onside MV Review Support",
  "신청서 작성, 파일 제출, Result 안내를 목적별로 정리해 진행합니다.":
    "Application, file submission, and result guidance are organized by purpose.",
  "Application Form 작성, 파일 제출, Result 안내를 목적별로 정리해 진행합니다.":
    "Application, file submission, and result guidance are organized by purpose.",
  "신청서 작성, 파일 제출, 결과 안내를 목적별로 정리해 진행합니다.":
    "Application, file submission, and result guidance are organized by purpose.",
  "온라인 신청서와 파일 업로드 지원":
    "Online application and file upload support",
  "Broadcaster Submission 전 자료 확인":
    "Material check before broadcaster submission",
  "Broadcaster Submission 전 Materials 확인":
    "Material check before broadcaster submission",
  "Result 파일과 진행 현황 제공":
    "Result files and progress tracking provided",
  "결과 파일과 진행 현황 제공":
    "Result files and progress tracking provided",
  "MUSIC VIDEO REVIEW 신청하러 가기": "Apply for Music Video Review",
  "Music Video Review 신청하러 가기": "Apply for Music Video Review",
  "신청 전 준비": "Pre-Submission Preparation",
  "Album Review 사전 준비 사항": "Album Review Preparation",
  "WAV 음원 또는 전체 음원 ZIP": "WAV audio or complete audio ZIP",
  "전체 가사: 반복 후렴, 코러스, 나레이션 포함":
    "Full lyrics including repeated hooks, chorus, and narration",
  "외국어 가사 번역": "Foreign-language lyric translation",
  "앨범명, 아티스트명, 발매일, 장르, 유통사, 제작사":
    "Album title, artist name, release date, genre, distributor, production company",
  "트랙 순서와 실제 발매 앨범의 CD/유통 순서 일치":
    "Track order must match the actual CD/distribution release order",
  "Music Video Review 사전 준비 사항": "Music Video Review Preparation",
  "온라인 유통용/TV 송출용 목적 구분":
    "Separate online distribution and TV broadcast purposes",
  "TV 송출용은 Broadcaster 제출 규격과 편성 조건 확인":
    "For TV broadcast, check broadcaster submission format and programming requirements",
  "TV 송출용은 방송국별 제출 규격과 편성 조건 확인":
    "For TV broadcast, check broadcaster submission format and programming requirements",
  "Result 확인": "Result Check",
  "Review Result가 늦어지는 이유는 무엇인가요?":
    "Why are review results delayed?",
  "심의 결과가 늦어지는 이유는 무엇인가요?":
    "Why are review results delayed?",
  "방송사 내부 일정과 심의 물량에 따라 지연될 수 있습니다. 진행 현황은 조회 코드 또는 마이페이지에서 방송국별로 업데이트됩니다.":
    "Delays can happen depending on broadcaster schedules and review volume. Progress is updated by broadcaster through the lookup code page or My Page.",
  "Broadcast사 내부 일정과 Review 물량에 따라 지연될 수 있습니다. 진행 현황은 조회 코드 또는 마이페이지에서 Broadcaster로 업데이트됩니다.":
    "Delays can happen depending on broadcaster schedules and review volume. Progress is updated by broadcaster through the lookup code page or My Page.",
  "온사이드는 정식 업체인가요?": "Is Onside an official business?",
  "네. 온사이드는 2017년부터 음반·뮤직비디오 심의 대행을 진행했으며, 현재 (주)빈티지하우스에서 운영합니다. 세금계산서, 현금영수증, 거래내역서 발급이 가능합니다.":
    "Yes. Onside has supported album and music video review submissions since 2017 and is currently operated by Vintage House Co., Ltd. Tax invoices, cash receipts, and transaction statements can be issued.",
  "네. Onside는 2017년부터 Album·Music Video Review 대행을 진행했으며, 현재 (주)Vintage House에서 운영합니다. Tax Invoice, 현금영수증, 거래내역서 발급이 가능합니다.":
    "Yes. Onside has supported album and music video review submissions since 2017 and is currently operated by Vintage House Co., Ltd. Tax invoices, cash receipts, and transaction statements can be issued.",
  "국악방송, 극동방송 신청도 가능한가요?":
    "Can I apply to Gugak FM or FEBC?",
  "가능합니다. 국악방송은 국악, 극동방송은 CCM 중심이라 장르 적합성과 추가 비용을 먼저 확인합니다.":
    "Yes. Gugak FM focuses on Korean traditional music and FEBC focuses on CCM, so genre fit and any additional cost are checked first.",
  "가능합니다. Gugak FM은 국악, FEBC은 CCM 중심이라 장르 적합성과 추가 비용을 먼저 확인합니다.":
    "Yes. Gugak FM focuses on Korean traditional music and FEBC focuses on CCM, so genre fit and any additional cost are checked first.",
  "2장 이상의 앨범은 할인혜택이 있나요?":
    "Is there a discount for two or more albums?",
  "동일 접수에서 여러 앨범을 진행하면 2번째 앨범부터 기준 금액의 50%로 접수됩니다. 최종 확인 화면에서 총액을 확인하세요.":
    "When multiple albums are submitted in the same request, the second album and onward are charged at 50% of the base amount. Check the total on the final confirmation screen.",
  "동일 접수에서 여러 앨범을 진행하면 2번째 앨범부터 현재 적용가격의 50%로 접수됩니다. 최종 확인 화면에서 총액을 확인하세요.":
    "When multiple albums are submitted in the same request, the second album and onward are charged at 50% of the currently applied price. Check the total on the final confirmation screen.",
  "동일 Submission에서 여러 앨범을 진행하면 2번째 앨범부터 기준 금액의 50%로 Submission됩니다. 최종 확인 화면에서 총액을 확인하세요.":
    "When multiple albums are submitted in the same request, the second album and onward are charged at 50% of the base amount. Check the total on the final confirmation screen.",
  "Review Result는 어떻게 확인하나요?": "How do I check review results?",
  "심의 결과는 어떻게 확인하나요?": "How do I check review results?",
  "접수 후 발급되는 조회 코드로 확인합니다. 로그인 접수는 마이페이지에 저장되며, 결과 파일 안내도 함께 표시됩니다.":
    "Use the lookup code issued after submission. Logged-in submissions are saved to My Page, and result file guidance is shown there as well.",
  "Submission 후 발급되는 조회 코드로 확인합니다. 로그인 Submission는 마이페이지에 저장되며, Result 파일 안내도 함께 표시됩니다.":
    "Use the lookup code issued after submission. Logged-in submissions are saved to My Page, and result file guidance is shown there as well.",
  "Review 신청은 언제 이루어지나요?": "When is the review submitted?",
  "심의 신청은 언제 이루어지나요?": "When is the review submitted?",
  "자료와 결제 확인 후 접수합니다. 서울권은 보통 3영업일 이내, 경기권은 7영업일 이내 접수를 목표로 하며 결과는 최대 3주까지 걸릴 수 있습니다.":
    "Submission starts after materials and payment are confirmed. Seoul-area submissions usually target within 3 business days, Gyeonggi-area submissions within 7 business days, and results may take up to 3 weeks.",
  "Materials와 Payment 확인 후 Submission합니다. 서울권은 보통 3영업일 이내, 경기권은 7영업일 이내 Submission를 목표로 하며 Result는 최대 3주까지 걸릴 수 있습니다.":
    "Submission starts after materials and payment are confirmed. Seoul-area submissions usually target within 3 business days, Gyeonggi-area submissions within 7 business days, and results may take up to 3 weeks.",
  "긴급 Review가 가능한가요?": "Is urgent review available?",
  "긴급 심의가 가능한가요?": "Is urgent review available?",
  "일정과 방송국 조건에 따라 다릅니다. 긴급 접수는 추가 비용이 발생할 수 있어 신청 전 문의가 필요합니다.":
    "It depends on schedule and broadcaster requirements. Rush submission may require an additional fee, so please contact us before applying.",
  "일정과 Broadcaster 조건에 따라 다릅니다. 긴급 Submission는 추가 비용이 발생할 수 있어 신청 전 문의가 필요합니다.":
    "It depends on schedule and broadcaster requirements. Rush submission may require an additional fee, so please contact us before applying.",
  "CD로 발매된 앨범은 실제 CD를 보내야 하나요?":
    "Do I need to send a physical CD for CD releases?",
  "정식 CD 발매 앨범은 실제 CD가 필요할 수 있습니다. CD가 없으면 심의용 CD 제작을 지원하지만, 방송사 요청 시 재접수가 필요할 수 있습니다.":
    "Official CD releases may require a physical CD. If you do not have one, we can support review CD production, but broadcaster requests may require resubmission.",
  "정식 CD Release 앨범은 실제 CD가 필요할 수 있습니다. CD가 없으면 Review용 CD 제작을 지원하지만, Broadcast사 요청 시 재Submission가 필요할 수 있습니다.":
    "Official CD releases may require a physical CD. If you do not have one, we can support review CD production, but broadcaster requests may require resubmission.",
  "발매 예정인 앨범도 Review 가능한가요?":
    "Can unreleased albums be reviewed?",
  "발매 예정인 앨범도 심의 가능한가요?":
    "Can unreleased albums be reviewed?",
  "Release 예정인 앨범도 Review 가능한가요?":
    "Can unreleased albums be reviewed?",
  "가능합니다. 정확한 발매일이 있으면 가장 안정적이며, 임의 발매일은 일부 방송사에서 보완 요청이 생길 수 있습니다.":
    "Yes. A confirmed release date is the most stable option. Estimated release dates may trigger supplement requests from some broadcasters.",
  "가능합니다. 정확한 Release일이 있으면 가장 안정적이며, 임의 Release일은 일부 Broadcast사에서 보완 요청이 생길 수 있습니다.":
    "Yes. A confirmed release date is the most stable option. Estimated release dates may trigger supplement requests from some broadcasters.",
  "이미 발매된 앨범도 Review 가능한가요?":
    "Can already released albums be reviewed?",
  "이미 발매된 앨범도 심의 가능한가요?":
    "Can already released albums be reviewed?",
  "이미 Release된 앨범도 Review 가능한가요?":
    "Can already released albums be reviewed?",
  "가능합니다. 음원, 가사, 앨범 정보가 실제 발매 내용과 일치하면 접수할 수 있습니다.":
    "Yes. You can submit if the audio, lyrics, and album information match the actual release.",
  "가능합니다. Audio, Lyrics, 앨범 정보가 실제 Release 내용과 일치하면 Submission할 수 있습니다.":
    "Yes. You can submit if the audio, lyrics, and album information match the actual release.",
  "Payment는 어떻게 하나요?": "How do I pay?",
  "결제는 어떻게 하나요?": "How do I pay?",
  "온라인 신청 단계에서 카드 결제 또는 무통장 입금을 선택합니다. 결제 전 심의 종류, 방송국, 총액을 다시 확인합니다.":
    "Choose card payment or bank transfer during online application. Before payment, review the review type, broadcasters, and total amount again.",
  "Online 신청 단계에서 카드 Payment 또는 무통장 입금을 선택합니다. Payment 전 Review 종류, Broadcaster, 총액을 다시 확인합니다.":
    "Choose card payment or bank transfer during online application. Before payment, review the review type, broadcasters, and total amount again.",
  "가사는 어느 정도까지 제출해야 하나요?":
    "How complete do the lyrics need to be?",
  "코러스, 나레이션, 반복 후렴을 포함한 전체 가사가 필요합니다. 외국어 가사는 번역도 함께 제출해야 합니다.":
    "Full lyrics are required, including choruses, narration, and repeated hooks. Foreign-language lyrics must include a translation.",
  "코러스, 나레이션, 반복 후렴을 포함한 전체 Lyrics가 필요합니다. 외국어 Lyrics는 Translation도 함께 제출해야 합니다.":
    "Full lyrics are required, including choruses, narration, and repeated hooks. Foreign-language lyrics must include a translation.",
  "MV 온라인용과 TV 송출용은 무엇이 다른가요?":
    "What is the difference between MV online and TV broadcast review?",
  "MV Online용과 TV Broadcast용은 무엇이 다른가요?":
    "What is the difference between MV online and TV broadcast review?",
  "온라인용은 유통사 제출·업로드 목적입니다. TV 송출용은 방송국별 편성, 제출 규격, 로고·등급분류 조건을 별도로 확인합니다.":
    "Online review is for distributor submission and upload. TV broadcast review separately checks broadcaster programming, submission specs, logos, and rating mark requirements.",
  "Online용은 Distribution사 제출·업로드 목적입니다. TV Broadcast용은 Broadcaster 편성, 제출 규격, 로고·등급분류 조건을 별도로 확인합니다.":
    "Online review is for distributor submission and upload. TV broadcast review separately checks broadcaster programming, submission specs, logos, and rating mark requirements.",
  "Submission 전후로 필요한 문의를 한 곳에서 확인하세요":
    "Find pre- and post-submission support in one place.",
  "접수 전후로 필요한 문의를 한 곳에서 확인하세요":
    "Find pre- and post-submission support in one place.",
  "온라인 Submission를 기본으로 운영하며, 파일 업로드가 어려운 경우 예전 온사이드 사이트도 안내합니다.":
    "Online submission is the default. If file upload is difficult, we also guide users to the legacy Onside site.",
  "Online Submission를 기본으로 운영하며, 파일 업로드가 어려운 경우 Legacy Onside 사이트도 안내합니다.":
    "Online submission is the default. If file upload is difficult, we also guide users to the legacy Onside site.",
  "온라인 접수를 기본으로 운영하며, 파일 업로드가 어려운 경우 예전 온사이드 사이트도 안내합니다.":
    "Online submission is the default. If file upload is difficult, we also guide users to the legacy Onside site.",
  "신청 전 상담": "Pre-Submission Consultation",
  "목적과 송출처에 맞는 Review 유형을 확인합니다.":
    "Confirm the review type that matches your purpose and broadcast destination.",
  "목적과 Broadcast처에 맞는 Review 유형을 확인합니다.":
    "Confirm the review type that matches your purpose and broadcast destination.",
  "자료 보완": "Material Supplement",
  "가사, 번역, 영상 규격, CD 제출 여부를 확인합니다.":
    "Check lyrics, translations, video specs, and CD submission requirements.",
  "Result/코드 문의": "Result / Code Inquiry",
  "조회 코드와 Result 파일 확인을 도와드립니다.":
    "We help you check lookup codes and result files.",
  "조회 코드와 결과 파일 확인을 도와드립니다.":
    "We help you check lookup codes and result files.",
  "전화 010-8436-9035": "Phone 010-8436-9035",
  "빠른 이동": "Quick Links",
  "온라인 Review 신청": "Online Review Application",
  "Online Review 신청": "Online Review Application",
  "예전 온사이드 바로가기": "Legacy Onside",
  "Old Onside": "Old Onside",
  "온라인 신청과 중복으로 진행하지 말고, 예전 온사이드 사이트에서 접수해주세요.":
    "Do not submit twice. Submit on the legacy Onside site if you prefer the old flow.",
  "Online 신청과 중복으로 진행하지 말고, Legacy Onside 사이트에서 Submission해주세요.":
    "Do not submit twice. Submit on the legacy Onside site if you prefer the old flow.",
  "예전 온사이드 사이트에서 접수해주세요.": "Submit on the legacy Onside site.",
  "예전 온사이드 사이트에서 SUBMISSION": "Submit on the Legacy Site",
  "Legacy Onside 사이트에서 Submission": "Submit on the Legacy Site",
  "진행 현황과 Payment 기록 관리는 온라인 Submission가 더 빠릅니다.":
    "Online submission is faster for progress tracking and payment records.",
  "진행 현황과 Payment 기록 관리는 Online Submission가 더 빠릅니다.":
    "Online submission is faster for progress tracking and payment records.",
  "Album Review 접수": "Album Review Submission",
  "예전 사이트에서 동일하게 접수할 수 있습니다.": "You can submit through the legacy site as well.",
  "Music Video Review 접수": "Music Video Review Submission",
  "필독": "Required Reading",
  "예전 온사이드 사이트에서도 음반·뮤직비디오 심의 접수가 가능합니다.":
    "Album and music video review submissions are also available on the legacy Onside site.",
  "접수 방식만 다르고 심의 진행은 동일하게 처리됩니다.":
    "Only the submission flow differs; the review process is handled the same way.",
  "새 온사이드에서는 신청, 결제, 진행 현황, 결과 확인을 한 곳에서 처리할 수 있습니다.":
    "The new Onside handles application, payment, progress, and result checks in one place.",
  "예전 사이트 이용이 더 편하신 경우에만 위 바로가기 버튼을 사용해주세요.":
    "Use the button above only if the legacy site is more comfortable for you.",
  "로 보내주시면 접수 안내를 드립니다.":
    "for submission guidance.",
  "로 보내주시면 Submission 안내를 드립니다.":
    "for submission guidance.",
  "신청서와 음원/영상 파일을 모두 보내셔야 Submission가 가능합니다.":
    "Both the form and audio/video files are required for submission.",
  "Application Form와 Audio/Video 파일을 모두 보내셔야 Submission가 가능합니다.":
    "Both the form and audio/video files are required for submission.",
  "신청서와 음원/영상 파일을 모두 보내셔야 접수가 가능합니다.":
    "Both the form and audio/video files are required for submission.",
  "Application Form와 음원/Video files을 모두 보내셔야 Submission가 available.":
    "Both the form and audio/video files are required for submission.",
  "메일 제목 템플릿": "Email Subject Template",
  "[AlbumReview 신청] 아티스트명 / 앨범명 / 신청자명":
    "[Album Review Application] Artist / Album / Applicant",
  "[AlbumReview 신청] Artist Name / Album Title / Applicant Name":
    "[Album Review Application] Artist / Album / Applicant",
  "[음반심의 신청] 아티스트명 / 앨범명 / 신청자명":
    "[Album Review Application] Artist / Album / Applicant",
  "[AlbumReview 신청] artist명 / album명 / Applicant Name":
    "[Album Review Application] Artist / Album / Applicant",
  "[Music VideoReview 신청] 아티스트명 / 곡명 / 온라인용 또는 TV송출용":
    "[Music Video Review Application] Artist / Song / Online or TV Broadcast",
  "[Music VideoReview 신청] Artist Name / Song Title / Online용 또는 TVBroadcast용":
    "[Music Video Review Application] Artist / Song / Online or TV Broadcast",
  "[뮤직비디오심의 신청] 아티스트명 / 곡명 / 온라인용 또는 TV송출용":
    "[Music Video Review Application] Artist / Song / Online or TV Broadcast",
  "[Music VideoReview 신청] artist명 / Song Title / Online용 또는 TVBroadcast용":
    "[Music Video Review Application] Artist / Song / Online or TV Broadcast",
  "첨부 체크리스트": "Attachment Checklist",
  "신청서": "Application Form",
  "음원 WAV": "Audio WAV",
  "번역 가사": "Translated Lyrics",
  "사업자등록증/세금계산서 정보":
    "Business registration / Tax invoice information",
  "이전 Submission": "Previous Submission",
  "다음 Submission": "Next Submission",
  "이전 Review 진행 상태": "Previous Review Progress",
  "다음 Review 진행 상태": "Next Review Progress",
  "이전 배너": "Previous Banner",
  "다음 배너": "Next Banner",
  "마하픽스": "Maha Fix",
  "2023-경기김포-1524": "2023-Gyeonggi Gimpo-1524",
};

const phraseTranslations: Array<[RegExp, string]> = [
  [/(\d+)초 후 다시 보내기/g, "Resend in $1 seconds"],
  [/\(현재 단계\)/g, "(Current step)"],
  [/현재\s*(\d+)단계/g, "Current Step $1"],
  [/확인 필요\s*(\d+)/g, "$1 Issues"],
  [/확인 권장\s*(\d+)/g, "$1 Recommendations"],
  [/선택 내역\s*(\d+)건/g, "$1 Selected"],
  [/(\d+)\/(\d+)곡 연결/g, "$1/$2 Tracks Matched"],
  [/트랙\s*(\d+)\s*상세 편집/g, "Track $1 Details"],
  [/(\d+)번 트랙 · 곡명/g, "Track $1 · Song Title"],
  [/(\d+)번 트랙 · 가수명/g, "Track $1 · Performer"],
  [/(\d+)번 트랙 · 작곡/g, "Track $1 · Composer"],
  [/(\d+)번 트랙 · 번역 가사/g, "Track $1 · Translated Lyrics"],
  [/(\d+)번 트랙 곡명/g, "Track $1 Song Title"],
  [/(\d+)번 트랙 가수명/g, "Track $1 Performer"],
  [/(\d+)번 트랙 작곡/g, "Track $1 Composer"],
  [/(\d+)번 트랙 작사/g, "Track $1 Lyricist"],
  [/(\d+)번 트랙 편곡/g, "Track $1 Arranger"],
  [/(\d+)번 트랙 위로 이동/g, "Move Track $1 Up"],
  [/(\d+)번 트랙 아래로 이동/g, "Move Track $1 Down"],
  [/(\d+)번 트랙 삭제/g, "Delete Track $1"],
  [/(\d+)\.\s*곡명 미입력/g, "$1. Song Title Missing"],
  [/반영하지 않는 열:\s*(.+)/g, "Ignored columns: $1"],
  [/저장됨\s*·\s*(.+)/g, "Saved · $1"],
  [/파일\s*(\d+)/g, "File $1"],
  [/(\d+)개 트랙에 음원\s*(\d+)개가 첨부되었습니다\. 누락 또는 중복 여부를 확인해주세요\./g,
    "$2 audio files are attached for $1 tracks. Check for missing or duplicate files."],
  [/앨범\s*(\d+)\s*·\s*추가\s*(\d+)건/g, "$1 Albums · $2 Additional"],
  [/추가\s*(\d+)건/g, "$1 Additional"],
  [/(\d+)건 대기/g, "$1 pending"],
  [/(\d+)개 비회원 신청서를 로그인 계정의 장바구니로 연결했습니다\./g,
    "$1 guest applications were moved to your account cart."],
  [/(\d+)개 장바구니 항목이 삭제되었습니다\./g,
    "$1 cart items were deleted."],
  [/같은 신청서의 앨범 (\d+)건이 함께 변경됩니다\./g,
    "All $1 albums in this application will be updated together."],
  [/선택한 (\d+)개 장바구니 항목을 삭제할까요\? 연결된 접수 현황도 함께 삭제되며 복구할 수 없습니다\./g,
    "Delete the $1 selected cart items? Their linked submission statuses will also be deleted and cannot be restored."],
  [/최근 수정/g, "Last updated"],
  [/진행률\s*:\s*총\s*(\d+)곳\s*중\s*(\d+)곳\s*완료/g, "Progress: $2 of $1 completed"],
  [/총\s*(\d+)곳\s*중\s*(\d+)곳\s*완료/g, "$2 of $1 completed"],
  [/보유\s*크레딧\s*([\d,]+)개/g, "$1 available credits"],
  [/총\s*([\d,]+)건/g, "Total $1"],
  [/요청일\s*/g, "Requested "],
  [/희망일\s*/g, "Preferred date "],
  [/사용완료\s*/g, "Used "],
  [/발매일\s*/g, "Release date "],
  [/적립일\s*/g, "Earned "],
  [/관리자\s*메모\s*:/g, "Admin memo:"],
  [/\+1\s*크레딧/g, "+1 credit"],
  [/Copyright © \(주\)Vintage House\. All Rights Reserved\./g, "Copyright © Vintage House Co., Ltd. All Rights Reserved."],
  [/\(주\)Vintage House/g, "Vintage House Co., Ltd."],
  [/\(주\)빈티지하우스/g, "Vintage House Co., Ltd."],
  [/\(주\)가비아인터넷서비스/g, "Gabia Internet Service Co., Ltd."],
  [/정준영/g, "Jung Junyoung"],
  [/Album Review 신청/g, "Album Review Application"],
  [/Music Video Review 신청/g, "Music Video Review Application"],
  [/Submission 방식/g, "Submission Method"],
  [/Review 목적/g, "Review Purpose"],
  [/이메일 Submission/g, "Email Submission"],
  [/Legacy 사이트에서 Submission/g, "Submit on the Legacy Site"],
  [/Online Review 신청/g, "Online Review Application"],
  [/Online Submission가/g, "Online submission is"],
  [/Online Submission를/g, "Online submission"],
  [/Application Form를/g, "the application form"],
  [/Application Form와/g, "the application form and"],
  [/Audio\/Video을/g, "audio/video files"],
  [/Audio\/Video 파일/g, "audio/video files"],
  [/Audio 파일/g, "audio files"],
  [/Video 파일/g, "video files"],
  [/파일/g, "files"],
  [/TV Broadcast용은/g, "For TV broadcast,"],
  [/TV Broadcast용/g, "TV broadcast"],
  [/Online용/g, "Online review"],
  [/Broadcast용/g, "broadcast"],
  [/Review용/g, "review"],
  [/Submission를/g, "submission"],
  [/Submission가/g, "submission"],
  [/Submission은/g, "submission"],
  [/Payment는/g, "payment"],
  [/Result는/g, "results"],
  [/Result를/g, "results"],
  [/Result 수령/g, "result delivery"],
  [/진행 확인/g, "progress tracking"],
  [/현금영수증/g, "cash receipts"],
  [/거래내역서/g, "transaction statements"],
  [/총액/g, "total amount"],
  [/기준 금액/g, "base amount"],
  [/추가 비용/g, "additional cost"],
  [/장르 적합성/g, "genre fit"],
  [/서울권/g, "Seoul area"],
  [/경기권/g, "Gyeonggi area"],
  [/영업일/g, "business days"],
  [/최종 확인 화면/g, "final confirmation screen"],
  [/확인하세요/g, "check it"],
  [/가능합니다/g, "available"],
  [/필요합니다/g, "required"],
  [/필요할 수 있습니다/g, "may be required"],
  [/발급/g, "issuance"],
  [/보완 요청/g, "supplement request"],
  [/재Submission/g, "resubmission"],
  [/재접수/g, "resubmission"],
  [/완료/g, "completed"],
  [/입고/g, "delivery"],
  [/등급분류/g, "rating mark"],
  [/아티스트/g, "artist"],
  [/앨범/g, "album"],
  [/방식/g, "method"],
  [/추천 상황/g, "Recommended"],
  [/지상파/g, "major terrestrial broadcasters"],
  [/홍보/g, "promotion"],
  [/전국·종교·교통/g, "nationwide, religious, and traffic"],
  [/라디오와 지역/g, "radio and regional"],
  [/특수/g, "special"],
  [/국악/g, "Korean traditional music"],
  [/CBS 기독교방송/g, "CBS Christian Broadcasting"],
  [/WBS 원음방송/g, "WBS Won Buddhism Broadcasting"],
  [/TBS 교통방송/g, "TBS Traffic Broadcasting"],
  [/PBC 평화방송/g, "PBC Peace Broadcasting"],
  [/BBS 불교방송/g, "BBS Buddhist Broadcasting"],
  [/ARIRANG 방송/g, "Arirang Broadcasting"],
  [/Arirang 방송/g, "Arirang Broadcasting"],
  [/경인 IFM/g, "Gyeongin iFM"],
  [/경인 iFM/g, "Gyeongin iFM"],
  [/TBN 한국교통방송/g, "TBN Korea Transportation Broadcasting"],
  [/KISS 디지털 라디오 음악방송/g, "KISS Digital Radio"],
  [/극동방송/g, "FEBC"],
  [/국악방송/g, "Gugak FM"],
  [/비회원 조회 코드 화면/g, "Guest Lookup Code Screen"],
  [/방송국별 진행 현황 예시/g, "Broadcaster Progress Example"],
  [/방송국별/g, "Broadcaster"],
  [/뮤직비디오 결과 수령 예시/g, "Music Video Result Example"],
  [/온라인 유통 심의/g, "Online Distribution Review"],
  [/(\d+)개 패키지/g, "$1 Broadcaster Package"],
  [/(\d+)곳 패키지/g, "$1 Broadcaster Package"],
  [/포함 방송국\s*(\d+)개/g, "$1 Broadcasters Included"],
  [/([\d,]+)원/g, "KRW $1"],
  [/총 결제금액/g, "Total Payment Amount"],
  [/진행중 (\d+)건/g, "$1 active"],
  [/(\d+)곡 대기/g, "$1 tracks pending"],
  [/([\d,]+)건/g, "$1 items"],
  [/접수한 심의/g, "Submitted reviews"],
  [/아티스트 미입력/g, "Artist not entered"],
  [/제목 미입력/g, "Title not entered"],
  [/요청 ID/g, "Request ID"],
  [/오류 코드/g, "Error Code"],
  [/Supabase 마이그레이션/g, "Supabase migration"],
  [/방송국/g, "Broadcaster"],
  [/영상물등급위원회/g, "Korea Media Rating Board"],
  [/영등위/g, "Korea Media Rating Board"],
  [/멜론/g, "Melon"],
  [/지니/g, "Genie"],
  [/벅스/g, "Bugs"],
  [/플로/g, "FLO"],
  [/유튜브/g, "YouTube"],
  [/온사이드/g, "Onside"],
  [/빈티지하우스/g, "Vintage House"],
  [/국민은행/g, "Kookmin Bank"],
  [/예금주/g, "Account Holder"],
  [/상담시간/g, "Support Hours"],
  [/주말\/공휴일 휴무/g, "Closed weekends and holidays"],
  [/구버전/g, "Legacy"],
  [/신청서/g, "Application Form"],
  [/온라인/g, "Online"],
  [/송출/g, "Broadcast"],
  [/방송/g, "Broadcast"],
  [/유통/g, "Distribution"],
  [/가사/g, "Lyrics"],
  [/가수/g, "Performer"],
  [/번역/g, "Translation"],
  [/자료/g, "Materials"],
  [/사전 준비 사항/g, "Preparation"],
  [/할인/g, "Discount"],
  [/혜택/g, "Benefit"],
  [/발매/g, "Release"],
  [/앨범명/g, "Album Title"],
  [/곡명/g, "Song Title"],
  [/아티스트명/g, "Artist Name"],
  [/신청자명/g, "Applicant Name"],
  [/세금계산서/g, "Tax Invoice"],
  [/뮤직비디오/g, "Music Video"],
  [/뮤비/g, "Music Video"],
  [/음원/g, "Audio"],
  [/영상/g, "Video"],
  [/음반/g, "Album"],
  [/심의/g, "Review"],
  [/접수/g, "Submission"],
  [/결제/g, "Payment"],
  [/결과/g, "Result"],
  [/크레딧/g, "credits"],
  [/관리자/g, "admin"],
  [/매거진/g, "magazine"],
  [/이용권/g, "service pass"],
  [/요청/g, "request"],
  [
    /\b([A-Za-z][A-Za-z0-9 /&().,'-]*)(?:을|를|이|가|은|는|와|과|의|에서|으로|로|에|까지|부터|만|도|용|용은|용과|가|를)\b/g,
    "$1",
  ],
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

const koreanTextPattern = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]/;
const phraseTranslationCache = new Map<string, string>();
const maxCachedPhraseTranslations = 256;

function translateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const exact = exactTranslations[trimmed];
  if (exact) return preserveWhitespace(value, exact);
  // Every phrase pattern contains Korean. English labels, dates, URLs and
  // previously translated text cannot match and need no regex scan.
  if (!koreanTextPattern.test(value)) return value;
  const cached = phraseTranslationCache.get(value);
  if (cached !== undefined) return cached;

  let next = value;
  for (const [pattern, replacement] of phraseTranslations) {
    next = next.replace(pattern, replacement);
  }
  const translatedTrimmed = next.trim();
  const translatedExact = exactTranslations[translatedTrimmed];
  const result = translatedExact ? preserveWhitespace(next, translatedExact) : next;
  // Bound retained text when counters, filenames or user content keep changing.
  if (value.length <= 2048) {
    if (phraseTranslationCache.size >= maxCachedPhraseTranslations) {
      const oldestKey = phraseTranslationCache.keys().next().value;
      if (oldestKey !== undefined) phraseTranslationCache.delete(oldestKey);
    }
    phraseTranslationCache.set(value, result);
  }
  return result;
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
      const nextValue = translateValue(element.value);
      if (nextValue !== element.value) {
        element.value = nextValue;
      }
    }
  }

  if (element instanceof HTMLButtonElement) {
    const nextValue = translateValue(element.value);
    if (nextValue !== element.value) {
      element.value = nextValue;
    }
  }

  for (const attr of translatableAttributes) {
    const value = element.getAttribute(attr);
    if (value) {
      const nextValue = translateValue(value);
      if (nextValue !== value) {
        element.setAttribute(attr, nextValue);
      }
    }
  }
}

function walkAndTranslate(root: Node) {
  if (root instanceof Text) {
    if (!root.parentElement?.closest("script, style, noscript, code, pre, textarea, [data-no-translate]")) {
      translateTextNode(root);
    }
    return;
  }
  // TreeWalker starts with the root's children. Handle the changed/inserted
  // element itself as well, including its placeholder and accessible label.
  if (root instanceof Element) {
    if (root.closest("script, style, noscript, code, pre, [data-no-translate]")) return;
    translateElement(root);
    if (root.closest("textarea")) return;
  }
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
        // Translate labels and placeholders on a textarea element, but keep its
        // editable text node out of the translation walk so user input is never
        // rewritten.
        if (
          node instanceof HTMLTextAreaElement &&
          !node.closest("script, style, noscript, code, pre, [data-no-translate]")
        ) {
          return NodeFilter.FILTER_ACCEPT;
        }
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
    "/submissions",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/magazine",
    "/guide",
    "/faq",
    "/support",
    "/forms",
    "/about",
    "/apply",
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

function localizeLink(link: Element) {
  if (!link.matches("a[href]") || link.matches("[data-no-localize]")) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
  const next = localizeUrl(href);
  if (next !== href) link.setAttribute("href", next);
}

function localizeLinks(root: Node) {
  if (!(root instanceof Element)) return;
  localizeLink(root);
  root.querySelectorAll("a[href]").forEach(localizeLink);
}

function translateDocumentMetadata() {
  const nextTitle = translateValue(document.title);
  if (nextTitle !== document.title) {
    document.title = nextTitle;
  }
}

export function EnglishLanguagePack() {
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");

  React.useEffect(() => {
    if (!isEnglishRoute) return;

    document.documentElement.lang = "en";

    const apply = (root: Node = document.body) => {
      walkAndTranslate(root);
      localizeLinks(root);
    };

    const observeOptions: MutationObserverInit = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title", "alt", "href"],
    };
    const pendingRoots = new Set<Node>();
    const pendingAttributes = new Set<Element>();
    let animationFrameId: number | null = null;
    let timeoutId: number | null = null;
    let observer: MutationObserver | null = null;

    const hasPendingAncestor = (node: Node) => {
      let parent = node.parentNode;
      while (parent) {
        if (pendingRoots.has(parent)) return true;
        parent = parent.parentNode;
      }
      return false;
    };

    const flush = () => {
      animationFrameId = null;
      const roots = Array.from(pendingRoots).filter(
        (root) => root.isConnected && !hasPendingAncestor(root),
      );
      const attributes = Array.from(pendingAttributes).filter(
        (element) => element.isConnected && !pendingRoots.has(element) && !hasPendingAncestor(element),
      );

      observer?.disconnect();
      translateDocumentMetadata();
      roots.forEach((root) => apply(root));
      attributes.forEach((element) => {
        if (!element.closest("script, style, noscript, code, pre, [data-no-translate]")) {
          translateElement(element);
        }
        localizeLink(element);
      });
      pendingRoots.clear();
      pendingAttributes.clear();
      observer?.observe(document.body, observeOptions);
    };

    const schedule = (root: Node, attributesOnly = false) => {
      if (!root.isConnected) return;
      if (attributesOnly && root instanceof Element) {
        pendingAttributes.add(root);
      } else {
        pendingRoots.add(root);
      }
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(flush);
    };

    const startTranslation = () => {
      timeoutId = null;
      translateDocumentMetadata();
      apply();
      observer?.observe(document.body, observeOptions);
    };

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          schedule(mutation.target);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof Text) {
            schedule(node);
          }
        });

        if (
          mutation.type === "attributes" &&
          mutation.target instanceof Element
        ) {
          schedule(mutation.target, true);
        }
      }
    });

    // This mutates text nodes outside React. Wait long enough for streamed
    // client islands to hydrate first, otherwise React reports text mismatches.
    timeoutId = window.setTimeout(startTranslation, 2500);

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
      if (anchor.matches("[data-no-localize]")) return;
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
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      observer?.disconnect();
      pendingRoots.clear();
      pendingAttributes.clear();
      document.removeEventListener("click", handleClick, true);
      window.alert = originalAlert;
      window.confirm = originalConfirm;
      document.documentElement.lang = "ko";
    };
  }, [isEnglishRoute, pathname]);

  return null;
}
