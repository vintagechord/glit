alter table public.submissions
  add column if not exists payment_document_type text,
  add column if not exists cash_receipt_purpose text,
  add column if not exists cash_receipt_phone text,
  add column if not exists cash_receipt_business_number text,
  add column if not exists tax_invoice_business_number text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_payment_document_type_check'
  ) then
    alter table public.submissions
      add constraint submissions_payment_document_type_check
      check (
        payment_document_type is null
        or payment_document_type in ('CASH_RECEIPT', 'TAX_INVOICE')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_cash_receipt_purpose_check'
  ) then
    alter table public.submissions
      add constraint submissions_cash_receipt_purpose_check
      check (
        cash_receipt_purpose is null
        or cash_receipt_purpose in (
          'PERSONAL_INCOME_DEDUCTION',
          'BUSINESS_EXPENSE_PROOF'
        )
      );
  end if;
end $$;
