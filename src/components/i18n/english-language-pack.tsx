"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const exactTranslations: Record<string, string> = {
  "심의 신청": "Apply",
  "진행/결과 조회": "Progress / Results",
  "매거진 발행": "Magazine",
  "크레딧": "Credits",
  "이용가이드": "Guide",
  "고객센터": "Support",
  "로그인": "Login",
  "로그아웃": "Logout",
  "마이페이지": "My Page",
  "지금 신청": "Apply Now",
  "EN": "KR",
  "다크": "Dark",
  "라이트": "Light",
  "결과 조회": "Results",
  "심의 신청부터": "From Submission",
  "결과 확인까지": "to Result Check",
  "TEST - TEST 심의": "TEST - TEST Review",
  "음반·뮤직비디오 심의를 온라인으로 접수하고, 진행 현황과 결과 파일을 한 곳에서 확인하세요.":
    "Submit album and music video reviews online, then check progress and result files in one place.",
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
  "예전 온사이드 주소 바로가기": "Open Previous Onside Site",
  "예전 온사이드 주소 바로가기 →": "Open Previous Onside Site →",
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
  "2GB 이상의 영상도 최대 4GB까지 업로드 가능하며, 어려우면 예전 온사이드 사이트에서 접수해주세요.":
    "Videos over 2 GB can be uploaded up to 4 GB. If upload is difficult, submit on the legacy Onside site.",
  "작성한 신청서 파일(HWP/DOC/DOCX)을 함께 업로드해주세요.":
    "Please also upload the completed application file (HWP/DOC/DOCX).",
  "음원 파일(WAV/MP3/ZIP)을 업로드하거나 파일 없이 진행을 선택해주세요.":
    "Upload audio files (WAV/MP3/ZIP) or choose to continue without files.",
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
  "기본 뮤직비디오 심의는 바로 신청할 수 있고, 방송국 입고 옵션은 조건 확인 후 진행합니다.":
    "Standard music video review can be submitted immediately. Broadcaster delivery options proceed after requirement confirmation.",
  "일반 Music Video Review": "Standard Music Video Review",
  "Review 완료 후 등급분류를 영상에 삽입하면 Melon, 지니, 유튜브 등으로 온라인 유통이 가능합니다.":
    "After review, insert the rating mark into the video for online distribution through Melon, Genie, YouTube, and similar services.",
  "Review 완료 후 등급분류를 Video에 삽입하면 Melon, Genie, YouTube 등으로 Online Distribution이 가능합니다.":
    "After review, insert the rating mark into the video for online distribution through Melon, Genie, YouTube, and similar services.",
  "심의 완료 후 등급분류를 영상에 삽입하면 Melon, 지니, 유튜브 등으로 온라인 유통이 가능합니다.":
    "After review, insert the rating mark into the video for online distribution through Melon, Genie, YouTube, and similar services.",
  "문의 필요": "Contact Required",
  "MBC M 방송 아티스트에 한해 Review 가능합니다.":
    "Available only for artists scheduled for MBC M broadcast.",
  "MBC M Broadcast 아티스트에 한해 Review 가능합니다.":
    "Available only for artists scheduled for MBC M broadcast.",
  "MBC M 방송 아티스트에 한해 심의 가능합니다.":
    "Available only for artists scheduled for MBC M broadcast.",
  "조건 확인하기 후 담당자 확인을 거쳐 진행됩니다.":
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
  "작성중 신청서": "Draft Application Forms",
  "나의 심의 내역": "My Review History",
  "음반심의 결제 완료 건으로 발급되는 온사이드 크레딧을 확인하고 사용하세요.":
    "Check and use Onside credits issued from completed album review payments.",
  "앨범심의 1건 = 1크레딧": "1 album review = 1 credit",
  "매거진 1회 발행 요청": "1 magazine request",
  "국내뉴스 / 미디어 선택": "Domestic News / Media",
  "4개 언어 발행": "Published in 4 languages",
  "발매 후 신청 가능": "Available after release",
  "발매일 기준 3일 내 목표": "Targeted within 3 days of release",
  "음반심의 1건으로 크레딧을 받고, 필요한 서비스를 이용하세요.":
    "Earn credits from album reviews and use them for services.",
  "앨범심의 결제 완료 건마다 크레딧 1개가 발급됩니다. 크레딧은 워터멜론 매거진 발행 요청과 온사이드 연계 서비스 이용에 사용할 수 있습니다.":
    "Each completed album review payment issues 1 credit. Credits can be used for Watermelon magazine requests and Onside partner services.",
  "매거진 바로가기": "Open Magazine",
  "발행 요청하기": "Request Publication",
  "회원가입 후 크레딧 사용": "Sign Up to Use Credits",
  "앨범심의 결제 완료 1건당 크레딧 1개가 발급됩니다.":
    "1 credit is issued for each completed album review payment.",
  "크레딧으로 워터멜론 매거진 발행 요청과 온사이드 연계 다양한 서비스를 이용할 수 있습니다.":
    "Use credits for Watermelon magazine requests and various Onside partner services.",
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
  "Materials, Payment, 진행 확인, Result 수령에서 자주 묻는 내용을 정리했습니다.":
    "Frequently asked questions about required materials, payment, progress tracking, and result delivery.",
  "준비물, Payment, 진행 확인, Result 수령에서 자주 묻는 내용을 정리했습니다.":
    "Frequently asked questions about required materials, payment, progress tracking, and result delivery.",
  "준비물, 결제, 진행 확인, 결과 수령에서 자주 묻는 내용을 정리했습니다.":
    "Frequently asked questions about required materials, payment, progress tracking, and result delivery.",
  "자료 준비": "Materials",
  "열기": "Open",
  "고객센터 보기": "View Support",
  "지금 Review 신청": "Apply Now",
  "Review 안내": "Review Guide",
  "Album과 Music Video Review 흐름, Materials, 자주 묻는 질문을 정리했습니다.":
    "Review flow, required materials, and FAQs for album and music video review.",
  "Album과 Music Video Review 흐름, 준비물, 자주 묻는 질문을 정리했습니다.":
    "Review flow, required materials, and FAQs for album and music video review.",
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
  "신청 전 준비물 체크리스트": "Pre-Submission Checklist",
  "Album Review 준비물": "Album Review Materials",
  "WAV 음원 또는 전체 음원 ZIP": "WAV audio or complete audio ZIP",
  "전체 가사: 반복 후렴, 코러스, 나레이션 포함":
    "Full lyrics including repeated hooks, chorus, and narration",
  "외국어 가사 번역": "Foreign-language lyric translation",
  "앨범명, 아티스트명, 발매일, 장르, 유통사, 제작사":
    "Album title, artist name, release date, genre, distributor, production company",
  "트랙 순서와 실제 발매 앨범의 CD/유통 순서 일치":
    "Track order must match the actual CD/distribution release order",
  "Music Video Review 준비물": "Music Video Review Materials",
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
  [/진행률\s*:\s*총\s*(\d+)곳\s*중\s*(\d+)곳\s*완료/g, "Progress: $2 of $1 completed"],
  [/총\s*(\d+)곳\s*중\s*(\d+)곳\s*완료/g, "$2 of $1 completed"],
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
  [/([\d,]+)원/g, "KRW $1"],
  [/총 결제금액/g, "Total Payment Amount"],
  [/진행중 (\d+)건/g, "$1 active"],
  [/(\d+)곡 대기/g, "$1 tracks pending"],
  [/(\d+)건/g, "$1 items"],
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
  [/번역/g, "Translation"],
  [/자료/g, "Materials"],
  [/준비물/g, "Materials"],
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

function translateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const exact = exactTranslations[trimmed];
  if (exact) return preserveWhitespace(value, exact);

  let next = value;
  for (const [pattern, replacement] of phraseTranslations) {
    next = next.replace(pattern, replacement);
  }
  const translatedTrimmed = next.trim();
  const translatedExact = exactTranslations[translatedTrimmed];
  return translatedExact ? preserveWhitespace(next, translatedExact) : next;
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
    "/magazine",
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
    if (link.matches("[data-no-localize]")) return;
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
    const observeOptions: MutationObserverInit = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title", "alt", "href"],
    };
    const pendingRoots = new Set<ParentNode>();
    let animationFrameId: number | null = null;
    let observer: MutationObserver | null = null;

    const flush = () => {
      animationFrameId = null;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();

      observer?.disconnect();
      roots.forEach((root) => apply(root));
      observer?.observe(document.body, observeOptions);
    };

    const schedule = (root: ParentNode | null) => {
      if (!root) return;
      pendingRoots.add(root);
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(flush);
    };

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          schedule(mutation.target.parentElement);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof Text) {
            const root = node instanceof Text ? node.parentElement : node;
            schedule(root);
          }
        });

        if (
          mutation.type === "attributes" &&
          mutation.target instanceof Element
        ) {
          schedule(mutation.target);
        }
      }
    });

    observer.observe(document.body, observeOptions);

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
      observer?.disconnect();
      document.removeEventListener("click", handleClick, true);
      window.alert = originalAlert;
      window.confirm = originalConfirm;
    };
  }, [isEnglishRoute, pathname]);

  return null;
}
