import Link from "next/link";

export function ManualEmailSupport({ english, purpose }: {
  english: boolean;
  purpose: "password" | "lookup";
}) {
  const password = purpose === "password";
  return (
    <div className="rounded-[8px] border border-border bg-background/70 p-4 text-sm leading-6" role="note">
      <p className="font-semibold">{password
        ? english
          ? "Automated email is not available yet. Contact support for password reset help."
          : "현재 이메일 자동 발송을 제공하지 않습니다. 비밀번호 재설정은 고객센터에 문의해주세요."
        : english
          ? "Lookup codes cannot currently be sent by email. Contact support if you need help finding your code."
          : "현재 조회 코드 이메일 발송을 제공하지 않습니다. 조회 코드 확인은 고객센터에 문의해주세요."}</p>
      <p className="mt-2 text-muted-foreground">{password
        ? english ? "Have your account email and inquiry details ready." : "가입한 이메일과 문의 내용을 준비해주세요."
        : english ? "Have your applicant name and application ID ready. You can still use a saved lookup code above." : "접수자 이름과 접수번호를 준비해주세요. 보관한 조회 코드는 위에서 바로 사용할 수 있습니다."}</p>
      <Link href={`${english ? "/en" : ""}/support`} className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
        {english ? "Contact Support" : "고객센터 문의"}
      </Link>
    </div>
  );
}
